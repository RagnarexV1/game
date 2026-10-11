import Phaser from 'phaser'
import type { MapSystem } from '../engine/MapSystem'
import type { WorldState } from '../engine/WorldState'
import { TILE_SPRITES } from './LocalMapView'
import { GAME_W, GAME_H } from './Layout'
import terrainData from '../data/terrain.json'

// Full-screen "Traveller's Log", modelled on the original game's parchment map:
// a Dutch house on the left whose windows are its rooms, the garden and the
// halls on the right, and yellow arrows from the house to the special levels
// in dark-brown patches. The layout is always drawn; a slot gets a miniature
// of its map only once visited, showing just the tiles explored so far, and
// the current map is outlined in a slowly blinking white border.

const PATCH       = 0x9a6034   // dark-brown areas, as in the original
const PATCH_EMPTY = 0x7e4a24   // unvisited slot inside a patch
const GLASS       = 0x2e3a44   // unvisited window in the house
const ARROW       = 0xffe020

const BRICK       = 0xc9a77c
const BRICK_LINE  = 0xa88a60
const ROOF        = 0x4e4642
const ROOF_LINE   = 0x37302d
const FRAME       = 0x34363a
const TRIM        = 0xd8d8d0
const PAVING      = 0x8e8a86

const MAP_TW = 80
const MAP_TH = 20

interface Slot { key: string; name: string; x: number; y: number; w: number; h: number; window?: boolean }

const slot = (key: string, name: string, x: number, y: number, window = false, w = 128, h = 32): Slot =>
  ({ key, name, x, y, w, h, window })

// Garden and hall grids use larger miniatures, like the original's world map
const GW = 152, GH = 38
const grid = (prefix: string, name: string, x0: number, y0: number): Slot[] => {
  const out: Slot[] = []
  for (let cy = 0; cy < 3; cy++)
    for (let cx = 0; cx < 3; cx++)
      out.push({ key: `${prefix}_${cx}_${cy}`, name: `${name} (${cx + 1},${cy + 1})`, x: x0 + cx * (GW + 8), y: y0 + cy * (GH + 8), w: GW, h: GH })
  return out
}

// Brick walls of the house, left gable to right section
const HOUSE_L = 440, HOUSE_R = 980
// Carport shed's left edge: far enough right for its roof to reach the house's front corner (the downpipe)
const CARPORT_X = 382
// Front door, left of its frame
const DOOR_X = 590

const GARDEN = { x: 1020, y: 288 }
const HALL   = { x: 1020, y: 568 }
const POND   = { x: 1220, y: 144 }

const SLOTS: Slot[] = [
  // House: attic (gable loft and the dormer)
  slot('area_loft',            'Loft',                  496, 270, true),
  slot('area_loft3',           'Peter and the Wolf',    756, 252, true),
  // House: first floor
  slot('area_bathroom_top',    'Bathroom',              488, 358, true, 100),
  slot('area_bathroom_bottom', 'Bathroom (lower)',      488, 402, true, 100),
  slot('area_study',           'Study Room',            602, 374, true, 66),
  slot('area_bedroom',         "Mar's bedroom",         700, 368, true),
  slot('area_bedroom_lower',   "Mar's bedroom (lower)", 840, 368, true),
  // House: ground floor, the pantry across the full width (4:1 like the map)
  slot('area_pantry',          'Pantry',                696, 488, true, 268, 67),
  // Carport shed and driveway
  slot('area_garage_top',      'Garage',                CARPORT_X + 18, 504, true),
  slot('area_garage_bottom',   'Garage (back)',         CARPORT_X + 18, 550, true),
  // Spans the width of the house below it, at the map's 4:1 aspect ratio
  slot('area_driveway',        'Driveway',              HOUSE_L, 656, false, HOUSE_R - HOUSE_L, (HOUSE_R - HOUSE_L) / 4),
  // Special levels (dark-brown patches)
  slot('area_chaos',           "Eric's bedroom",        110, 370),
  slot('area_upper_hall_left', 'Upper Hall (left)',     110, 424),
  slot('area_upper_hall_right','Upper Hall (right)',    246, 424),
  // Kitchen: between the garden and the halls
  slot('area_kitchen',         'Kitchen',               GARDEN.x + (3 * GW + 16 - 128) / 2, GARDEN.y + 3 * (GH + 8) + 51),
  // On the grey paving left of the driveway
  slot('area_tub_enclosure',   'Tub Enclosure',         260, 712),
  slot('area_stairs',          'Stairs',                HALL.x + GW + 8 + (GW - 128) / 2, HALL.y + 3 * (GH + 8) + 28),
  slot('area_stairs_upper',    'Upper Stairs',          110, 190),
  slot('area_pond1',           'Pond',                  POND.x,       POND.y),
  slot('area_pond2',           'Underwater Caves',      POND.x + 140, POND.y),
  slot('area_pond3',           'Pond Depths',           POND.x + 140, POND.y + 42),
  // Garden (right) with the halls below it
  ...grid('forest', 'Garden', GARDEN.x, GARDEN.y),
  ...grid('hall',   'Hall',   HALL.x,   HALL.y),
]

// [fromX, fromY, toX, toY] — yellow arrows between the house, garden and what lies beyond
const ARROWS: Array<[number, number, number, number]> = [
  [448, 386, 252, 386],    // Eric's door → Eric's bedroom
  [995, 592, 1080, 434],   // bush beside the house → garden, from below
  [640, 600, 1012, 630],   // front door → halls
]

const TERRAIN_COLORS: Record<string, string> = Object.fromEntries(
  (terrainData as Array<{ id: string; color?: string }>).map(d => [d.id, d.color ?? '#404040']),
)

export class TravellersLog {
  private container: Phaser.GameObjects.Container | null = null
  private blinkTween: Phaser.Tweens.Tween | null = null
  private colorCache = new Map<string, number>()
  private sampleCanvas = document.createElement('canvas')

  constructor(private scene: Phaser.Scene) {}

  isVisible(): boolean { return this.container !== null }

  /** Toggle the log. `currentKey` is the snapshot key of the map the player is on. */
  show(worldState: WorldState, map: MapSystem, currentKey: string): void {
    if (this.container) { this.hide(); return }
    this.render(worldState, map, currentKey)
  }

  hide(): void {
    this.blinkTween?.remove()
    this.blinkTween = null
    this.container?.destroy()
    this.container = null
  }

  private render(ws: WorldState, map: MapSystem, currentKey: string): void {
    const scene = this.scene
    const c = scene.add.container(0, 0).setDepth(1100)
    this.container = c

    // Swallow clicks so nothing underneath reacts; any click closes the log
    const blocker = scene.add.zone(0, 0, GAME_W, GAME_H).setOrigin(0, 0).setInteractive()
    blocker.on('pointerdown', () => this.hide())
    c.add(blocker)

    const black = scene.add.graphics()
    black.fillStyle(0x000000)
    black.fillRect(0, 0, GAME_W, GAME_H)
    c.add(black)
    if (scene.textures.exists('ui_travellers_log'))
      c.add(scene.add.image(0, 0, 'ui_travellers_log').setOrigin(0, 0).setDisplaySize(GAME_W, GAME_H))

    const g = scene.add.graphics()
    c.add(g)
    this.drawPatches(g)
    this.drawHouse(g)

    for (const s of SLOTS) {
      const tiles = s.key === currentKey
        ? this.liveTiles(map)
        : ws.cellSnapshots.get(s.key)?.tiles
      const visited = !!tiles

      if (s.window) {
        g.fillStyle(FRAME)
        g.fillRect(s.x - 5, s.y - 5, s.w + 10, s.h + 10)
      }
      if (visited) {
        c.add(scene.add.image(s.x, s.y, this.buildMiniature(s.key, tiles, s.window ? GLASS : PATCH_EMPTY))
          .setOrigin(0, 0).setDisplaySize(s.w, s.h))
      } else {
        g.fillStyle(s.window ? GLASS : PATCH_EMPTY)
        g.fillRect(s.x, s.y, s.w, s.h)
      }

      const hit = scene.add.zone(s.x, s.y, s.w, s.h).setOrigin(0, 0).setInteractive()
      hit.on('pointerdown', () => this.hide())
      c.add(hit)
    }

    const top = scene.add.graphics()
    c.add(top)
    for (const [x1, y1, x2, y2] of ARROWS) this.drawArrow(top, x1, y1, x2, y2)

    // Current map: slowly blinking white border, drawn last so it sits above the miniature
    const cur = SLOTS.find(s => s.key === currentKey)
    if (cur) {
      const border = scene.add.graphics()
      border.lineStyle(3, 0xffffff)
      border.strokeRect(cur.x - 2, cur.y - 2, cur.w + 4, cur.h + 4)
      c.add(border)
      this.blinkTween = scene.tweens.add({
        targets: border, alpha: 0.1, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      })
    }
  }

  // ─── Miniatures ─────────────────────────────────────────────────────────────

  private liveTiles(map: MapSystem): Array<{ defId: string; explored: boolean }> {
    const out: Array<{ defId: string; explored: boolean }> = []
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const t = map.getTile(x, y)
        out.push({ defId: t?.defId ?? 'wall', explored: t?.explored ?? false })
      }
    return out
  }

  // Unexplored tiles take the slot's empty colour, so the log never gives away unseen layout
  private buildMiniature(key: string, tiles: Array<{ defId: string; explored: boolean }>, hidden: number): string {
    const texKey = `travlog_${key}`
    const canvas = document.createElement('canvas')
    canvas.width = MAP_TW
    canvas.height = MAP_TH
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(MAP_TW, MAP_TH)
    for (let i = 0; i < MAP_TW * MAP_TH && i < tiles.length; i++) {
      const tx = i % MAP_TW, ty = Math.floor(i / MAP_TW)
      const col = tiles[i].explored ? this.tileColor(tiles[i].defId, tx, ty) : hidden
      img.data[i * 4]     = (col >> 16) & 0xff
      img.data[i * 4 + 1] = (col >> 8) & 0xff
      img.data[i * 4 + 2] = col & 0xff
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (this.scene.textures.exists(texKey)) this.scene.textures.remove(texKey)
    this.scene.textures.addCanvas(texKey, canvas)
    return texKey
  }

  private tileColor(defId: string, tx: number, ty: number): number {
    if (defId === 'void' || defId === 'stairs_wall') return 0x000000
    if (defId === 'stairs_floor') {
      // Same rainbow banding the local map uses for the stairs
      const f = (tx + (MAP_TH - 1 - ty)) / (MAP_TW + MAP_TH - 2)
      return f < 0.33 ? 0xd03030 : f < 0.66 ? 0xe0c030 : 0x3060d0
    }
    const cached = this.colorCache.get(defId)
    if (cached !== undefined) return cached
    const spriteKey = TILE_SPRITES[defId] ?? `terrain_${defId}`
    const color = this.averageTextureColor(spriteKey)
      ?? Phaser.Display.Color.HexStringToColor(TERRAIN_COLORS[defId] ?? '#404040').color
    this.colorCache.set(defId, color)
    return color
  }

  /** Mean colour of a texture's opaque pixels, or null if it can't be sampled. */
  private averageTextureColor(key: string): number | null {
    if (!this.scene.textures.exists(key)) return null
    const frame = this.scene.textures.getFrame(key)
    const src = frame?.source.image as CanvasImageSource | undefined
    if (!frame || !src) return null
    const S = 8
    const cv = this.sampleCanvas
    cv.width = S
    cv.height = S
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, S, S)
    try {
      ctx.drawImage(src, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, S, S)
      const d = ctx.getImageData(0, 0, S, S).data
      let r = 0, gg = 0, b = 0, n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++
      }
      if (n === 0) return null
      return (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n)
    } catch {
      return null
    }
  }

  // ─── Backdrop drawing ───────────────────────────────────────────────────────

  private drawArrow(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
    const a = Math.atan2(y2 - y1, x2 - x1)
    const head = 12
    g.lineStyle(3, ARROW)
    g.lineBetween(x1, y1, x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6)
    g.fillStyle(ARROW)
    g.fillTriangle(
      x2, y2,
      x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head,
      x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head,
    )
  }

  /** Irregular dark-brown blob around a rectangle, like the original's patches. */
  private patch(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillStyle(PATCH)
    g.fillRoundedRect(x, y, w, h, 14)
    g.fillRoundedRect(x + w * 0.15, y - 5, w * 0.5, h + 10, 12)
    g.fillRoundedRect(x - 5, y + h * 0.2, w + 10, h * 0.5, 10)
  }

  private drawPatches(g: Phaser.GameObjects.Graphics): void {
    const pad = 14
    // Garden and halls: one big patch each
    this.patch(g, GARDEN.x - pad, GARDEN.y - pad, 3 * GW + 16 + 2 * pad, 3 * GH + 16 + 2 * pad)
    this.patch(g, HALL.x - pad, HALL.y - pad, 3 * GW + 16 + 2 * pad, 3 * GH + 16 + 2 * pad)
    // Underwater: the pond levels share one patch
    this.patch(g, POND.x - pad, POND.y - pad, 268 + 2 * pad, 74 + 2 * pad)
    // Upper hall: both cells share one patch
    const uh = SLOTS.find(sl => sl.key === 'area_upper_hall_left')!
    this.patch(g, uh.x - pad, uh.y - 10, 2 * uh.w + 8 + 2 * pad, uh.h + 20)
    // Single special levels
    for (const key of ['area_chaos', 'area_kitchen', 'area_stairs', 'area_stairs_upper']) {
      const s = SLOTS.find(sl => sl.key === key)!
      this.patch(g, s.x - pad, s.y - 10, s.w + 2 * pad, s.h + 20)
    }
  }

  private drawHouse(g: Phaser.GameObjects.Graphics): void {
    const eaves = 330, ground = 640
    // Paving runs on under the driveway miniature
    const PAVE_H = 176
    const peak = { x: 560, y: 170 }

    // Driveway paving in front of house and carport
    g.fillStyle(PAVING)
    g.fillRect(200, ground, 800, PAVE_H)
    g.lineStyle(1, 0x6e6a66, 0.7)
    for (let y = ground + 16; y < ground + PAVE_H; y += 16) g.lineBetween(200, y, 1000, y)
    for (let y = ground; y < ground + PAVE_H; y += 16)
      for (let x = 200 + ((y - ground) / 16 % 2) * 20; x < 1000; x += 40) g.lineBetween(x, y, x, y + 16)

    // Right-hand roof face, running back from the gable to the right
    g.fillStyle(ROOF)
    g.fillTriangle(peak.x, peak.y, 960, peak.y, 1000, eaves)
    g.fillTriangle(peak.x, peak.y, 1000, eaves, 680, eaves)
    g.lineStyle(1, ROOF_LINE)
    for (let y = peak.y + 12; y < eaves; y += 12) {
      const t = (y - peak.y) / (eaves - peak.y)
      g.lineBetween(peak.x + t * 120, y, 960 + t * 40, y)
    }

    // Chimney
    g.fillStyle(0x8a5a3c)
    g.fillRect(880, 178, 30, 56)
    g.fillStyle(0x3a2a20)
    g.fillRect(876, 172, 38, 8)

    // Dormer (dakkapel) on the roof face
    g.fillStyle(0x5a5a5e)
    g.fillRect(740, 236, 160, 64)
    g.fillStyle(TRIM)
    g.fillRect(734, 230, 172, 7)

    // Brick walls: right section and gable section
    g.fillStyle(BRICK)
    g.fillRect(680, eaves, 300, ground - eaves)
    g.fillRect(440, eaves, 240, ground - eaves)
    g.fillTriangle(420, eaves, 700, eaves, peak.x, peak.y)
    g.lineStyle(1, BRICK_LINE, 0.55)
    for (let y = eaves + 8; y < ground; y += 8) g.lineBetween(440, y, 980, y)
    for (let y = peak.y + 16; y < eaves; y += 8) {
      const half = ((y - peak.y) / (eaves - peak.y)) * 140
      g.lineBetween(peak.x - half, y, peak.x + half, y)
    }
    // Downpipe between gable and right section
    g.fillStyle(0x7a7672)
    g.fillRect(677, eaves, 6, ground - eaves)
    // Gable roof edges (overhang) with white fascia
    g.lineStyle(7, ROOF)
    g.lineBetween(410, eaves + 6, peak.x, peak.y - 4)
    g.lineBetween(peak.x, peak.y - 4, 710, eaves + 6)
    g.lineStyle(2, TRIM)
    g.lineBetween(414, eaves + 8, peak.x, peak.y + 2)
    // Eaves gutter on the right section
    g.fillStyle(TRIM)
    g.fillRect(680, eaves - 4, 320, 6)

    // Eric's small door/window on the gable's first floor
    g.fillStyle(FRAME)
    g.fillRect(452, 360, 26, 54)
    g.fillStyle(GLASS)
    g.fillRect(456, 364, 18, 46)

    // Balcony in front of Mar's lower bedroom
    g.fillStyle(TRIM)
    g.fillRect(700, 446, 300, 8)
    g.fillStyle(0x2e3036)
    g.fillRect(700, 412, 300, 6)
    for (let y = 422; y < 446; y += 8) g.fillRect(700, y, 300, 4)

    // Front door
    g.fillStyle(FRAME)
    g.fillRect(DOOR_X, 540, 46, ground - 540)
    g.fillStyle(GLASS)
    g.fillRect(DOOR_X + 8, 548, 12, 50)
    g.fillStyle(0xc0c0c0)
    g.fillCircle(DOOR_X + 38, 594, 3)

    // Bush by the front window
    g.fillStyle(0x3e6a2e)
    g.fillCircle(980, ground - 20, 24)
    g.fillCircle(960, ground - 8, 16)

    // Carport: shed with a flat roof extending to posts at the front
    g.fillStyle(0xb8b4ae)
    const cx = CARPORT_X
    g.fillRect(cx, 480, 172, ground - 480)
    g.fillStyle(0x8a8680)
    for (let x = cx + 8; x < cx + 166; x += 22) g.fillRect(x, 590, 10, ground - 590)
    g.fillStyle(0xb0aca6)
    g.fillRect(cx + 180, 480, 10, ground - 480)
    g.fillRect(cx + 276, 480, 10, ground - 480)
    g.fillStyle(TRIM)
    g.fillRect(cx - 14, 466, 312, 16)
    g.lineStyle(2, 0x6e6a66)
    g.strokeRect(cx - 14, 466, 312, 16)
  }
}
