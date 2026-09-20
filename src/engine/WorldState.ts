export interface CellSnapshot {
  tiles: Array<{ defId: string; explored: boolean }>
  monsters: Array<{ defId: string; x: number; y: number; hp: number; message?: string; hasSpoken: boolean; stunTurns: number }>
  items: Array<{ x: number; y: number; defId: string; qty: number }>
}

export class WorldState {
  cx = 0
  cy = 0
  readonly GRID = 3

  ucx = 0
  ucy = 0
  readonly UGRID = 3

  undergroundExplored = new Map<string, boolean[]>()
  cellSnapshots = new Map<string, CellSnapshot>()

  currentArea: string | null = null
  savedCx = 0
  savedCy = 0
  savedPlayerX = 0
  savedPlayerY = 0
  bathroomFloodTiles: Array<{ x: number; y: number }> = []
  mamHasOrange = false
  mamHasVase   = false
  widgetFound  = false
  peterWarned  = false

  hasRight() { return this.cx < this.GRID - 1 }
  hasLeft()  { return this.cx > 0 }
  hasDown()  { return this.cy < this.GRID - 1 }
  hasUp()    { return this.cy > 0 }

  go(dx: number, dy: number): void {
    this.cx = Math.max(0, Math.min(this.GRID - 1, this.cx + dx))
    this.cy = Math.max(0, Math.min(this.GRID - 1, this.cy + dy))
  }

  goUnderground(dx: number, dy: number): void {
    this.ucx = Math.max(0, Math.min(this.UGRID - 1, this.ucx + dx))
    this.ucy = Math.max(0, Math.min(this.UGRID - 1, this.ucy + dy))
  }

  enterArea(area: string): void {
    this.savedCx = this.cx
    this.savedCy = this.cy
    this.currentArea = area
  }

  exitArea(): void {
    this.cx = this.savedCx
    this.cy = this.savedCy
    this.currentArea = null
  }

  get seed(): number {
    return this.cy * 7 + this.cx * 31 + 100
  }

  get undergroundSeed(): number {
    return this.ucy * 53 + this.ucx * 97 + 2000
  }
}
