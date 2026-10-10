import type { MapTile, TileDef, Vec2 } from '../types'
import terrainData from '../data/terrain.json'

export class MapSystem {
  readonly width: number
  readonly height: number
  private tiles: MapTile[][]
  private tileDefs: Map<string, TileDef>

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.tileDefs = new Map()
    for (const def of terrainData as TileDef[]) {
      this.tileDefs.set(def.id, def)
    }
    this.tiles = []
    for (let y = 0; y < height; y++) {
      this.tiles[y] = []
      for (let x = 0; x < width; x++) {
        this.tiles[y][x] = { defId: 'wall', explored: false, visible: false }
      }
    }
  }

  getTile(x: number, y: number): MapTile | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null
    return this.tiles[y][x]
  }

  getDef(defId: string): TileDef | undefined {
    return this.tileDefs.get(defId)
  }

  getTileDef(x: number, y: number): TileDef | null {
    const tile = this.getTile(x, y)
    if (!tile) return null
    return this.tileDefs.get(tile.defId) ?? null
  }

  setTile(x: number, y: number, defId: string): void {
    const tile = this.getTile(x, y)
    if (tile) tile.defId = defId
  }

  isWalkable(x: number, y: number): boolean {
    const def = this.getTileDef(x, y)
    return def?.walkable ?? false
  }

  isTransparent(x: number, y: number): boolean {
    const def = this.getTileDef(x, y)
    return def?.transparent ?? false
  }

  isInBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  markExplored(x: number, y: number): void {
    const tile = this.getTile(x, y)
    if (tile) tile.explored = true
  }

  setVisible(x: number, y: number, visible: boolean): void {
    const tile = this.getTile(x, y)
    if (tile) tile.visible = visible
  }

  reset(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y][x] = { defId: 'wall', explored: false, visible: false }
      }
    }
  }

  clearVisibility(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y][x].visible = false
      }
    }
  }

  computeFOV(originX: number, originY: number, radius: number): void {
    this.clearVisibility()
    const tile = this.getTile(originX, originY)
    if (tile) {
      tile.visible = true
      tile.explored = true
      tile.mapped = false
    }

    // Shadowcasting FOV - 8 octants
    for (let octant = 0; octant < 8; octant++) {
      this.castLight(originX, originY, radius, 1, 1.0, 0.0, octant)
    }
  }

  private castLight(
    cx: number, cy: number, radius: number,
    row: number, startSlope: number, endSlope: number,
    octant: number
  ): void {
    if (startSlope < endSlope) return
    const radiusSq = radius * radius
    let newStart = 0

    for (let j = row; j <= radius; j++) {
      let blocked = false
      for (let dx = -j; dx <= 0; dx++) {
        const dy = -j
        const lSlope = (dx - 0.5) / (dy + 0.5)
        const rSlope = (dx + 0.5) / (dy - 0.5)

        if (startSlope < rSlope) continue
        if (endSlope > lSlope) break

        const [mx, my] = this.transformOctant(dx, dy, octant)
        const ax = cx + mx
        const ay = cy + my

        if (dx * dx + dy * dy < radiusSq && this.isInBounds(ax, ay)) {
          const tile = this.getTile(ax, ay)
          if (tile) {
            tile.visible = true
            tile.explored = true
            tile.mapped = false
          }
        }

        if (blocked) {
          if (!this.isTransparent(ax, ay)) {
            newStart = rSlope
          } else {
            blocked = false
            startSlope = newStart
          }
        } else if (!this.isTransparent(ax, ay) && j < radius) {
          blocked = true
          this.castLight(cx, cy, radius, j + 1, startSlope, lSlope, octant)
          newStart = rSlope
        }
      }
      if (blocked) break
    }
  }

  private transformOctant(dx: number, dy: number, octant: number): [number, number] {
    switch (octant) {
      case 0: return [dx, dy]
      case 1: return [dy, dx]
      case 2: return [-dy, dx]
      case 3: return [-dx, dy]
      case 4: return [-dx, -dy]
      case 5: return [-dy, -dx]
      case 6: return [dy, -dx]
      case 7: return [dx, -dy]
      default: return [dx, dy]
    }
  }

  loadFromStrings(rows: string[]): void {
    const charMap: Record<string, string> = {
      '#': 'wall',
      '.': 'grass',
      '@': 'grass',
      'M': 'grass',
      '+': 'door_closed',
      '>': 'stairs_down',
      '<': 'stairs_up',
    }
    for (let y = 0; y < rows.length && y < this.height; y++) {
      for (let x = 0; x < rows[y].length && x < this.width; x++) {
        const ch = rows[y][x]
        this.setTile(x, y, charMap[ch] ?? 'grass')
      }
    }
  }

  getNeighbors(x: number, y: number): Vec2[] {
    const dirs: Vec2[] = [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: -1, y: 0 }, { x: 1, y: 0 },
    ]
    return dirs
      .map(d => ({ x: x + d.x, y: y + d.y }))
      .filter(p => this.isInBounds(p.x, p.y))
  }
}
