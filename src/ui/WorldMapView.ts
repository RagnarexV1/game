import Phaser from 'phaser'
import type { MapSystem } from '../engine/MapSystem'
import type { Player } from '../entities/Player'
import type { Monster } from '../entities/Monster'
import type { FloorItem } from '../entities/FloorItem'
import itemData from '../data/items.json'

const ITEM_TYPE_SPRITES: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const def of itemData as Array<{ id: string; type: string }>) {
    if (def.id === 'amulet') { m[def.id] = 'inv_amulet'; continue }
    switch (def.type) {
      case 'weapon': m[def.id] = 'inv_weapon'; break
      case 'armor':  m[def.id] = 'inv_armour'; break
      case 'scroll': m[def.id] = 'inv_scroll'; break
      case 'drink':  m[def.id] = 'inv_potion'; break
      case 'eat':    m[def.id] = 'inv_food';   break
      case 'ring':   m[def.id] = 'inv_ring';   break
      case 'wand':   m[def.id] = 'inv_wand';   break
      case 'tool':   m[def.id] = 'inv_tool';   break
      default:       m[def.id] = 'inv_null';   break
    }
  }
  return m
})()

const TERRAIN_ICONS: Record<string, string> = {
  berg:          'inv_mountain',
  tree:          'inv_tree',
  tree_dead:     'inv_tree',
  exit_right:    'inv_next_right',
  exit_left:     'inv_next_left',
  exit_down:     'inv_next_down',
  exit_up:       'inv_next_up',
  exit_kitchen:  'inv_next_down',
  exit_garage:   'inv_next_down',
  crypt:         'inv_crypt',
  vortex_portal: 'ui_inv_vortex',
}

export class WorldMapView {
  private graphics: Phaser.GameObjects.Graphics
  private playerSprite: Phaser.GameObjects.Image | null = null
  private itemPool: Phaser.GameObjects.Image[] = []
  private monsterPool: Phaser.GameObjects.Text[] = []
  private terrainPool: Phaser.GameObjects.Image[] = []
  private tileSize: number
  private offsetX: number
  private offsetY: number

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private map: MapSystem,
  ) {
    // Background
    const bg = scene.add.graphics()
    bg.fillStyle(0x050a0a)
    bg.fillRect(x, y, w, h)

    this.graphics = scene.add.graphics()

    // Fit the whole map into the world map panel
    const tsByW = Math.floor(w / map.width)
    const tsByH = Math.floor(h / map.height)
    this.tileSize = Math.max(6, Math.min(tsByW, tsByH))

    // Center
    this.offsetX = x + Math.floor((w - map.width  * this.tileSize) / 2)
    this.offsetY = y + Math.floor((h - map.height * this.tileSize) / 2)
  }

  render(player: Player, monsters: Monster[], floorItems: FloorItem[], torchlightOnly = false, isStairs = false): void {
    const g = this.graphics
    g.clear()

    // Stairs: show rainbow image fixed in the world map area
    if (isStairs && this.scene.textures.exists('stairs_bg')) {
      for (const img of this.terrainPool) img.destroy()
      this.terrainPool = []
      for (const img of this.itemPool) img.destroy()
      this.itemPool = []
      for (const t of this.monsterPool) t.destroy()
      this.monsterPool = []

      const bgImg = this.scene.add.image(this.x, this.y, 'stairs_bg')
        .setOrigin(0, 0).setDisplaySize(this.w, this.h).setDepth(1)
      this.terrainPool.push(bgImg)

      // Player dot proportional to position
      const plx = this.x + (player.x / this.map.width)  * this.w
      const ply = this.y + (player.y / this.map.height) * this.h
      if (!this.playerSprite && this.scene.textures.exists('ui_user_location')) {
        this.playerSprite = this.scene.add.image(0, 0, 'ui_user_location')
          .setDisplaySize(this.tileSize, this.tileSize).setDepth(10)
      }
      if (this.playerSprite) this.playerSprite.setPosition(plx, ply).setOrigin(0, 0)
      return
    }

    const ts  = this.tileSize
    const ox  = this.offsetX
    const oy  = this.offsetY
    const mW  = this.map.width
    const mH  = this.map.height

    // Draw ALL tiles — unexplored dimmed, explored normal, visible bright
    for (let ty = 0; ty < mH; ty++) {
      for (let tx = 0; tx < mW; tx++) {
        const tile = this.map.getTile(tx, ty)
        if (!tile) continue

        if (torchlightOnly ? !tile.visible : !tile.explored) continue

        const baseColor = this.defColor(tile.defId)
        const color = (torchlightOnly || tile.visible)
          ? baseColor
          : this.scaleColor(baseColor, 0.45)

        g.fillStyle(color)
        g.fillRect(ox + tx * ts, oy + ty * ts, ts, ts)
      }
    }

    // Grid lines (only if tiles are large enough)
    if (ts >= 8) {
      g.lineStyle(1, 0x000000, 0.3)
      for (let tx = 0; tx <= mW; tx++) g.lineBetween(ox + tx * ts, oy, ox + tx * ts, oy + mH * ts)
      for (let ty = 0; ty <= mH; ty++) g.lineBetween(ox, oy + ty * ts, ox + mW * ts, oy + ty * ts)
    }

    // Terrain icons — exits, mountains, trees
    for (const img of this.terrainPool) img.destroy()
    this.terrainPool = []
    for (let ty = 0; ty < mH; ty++) {
      for (let tx = 0; tx < mW; tx++) {
        const tile = this.map.getTile(tx, ty)
        if (torchlightOnly ? !tile?.visible : !tile?.explored) continue
        const iconKey = TERRAIN_ICONS[tile!.defId]
        if (!iconKey || !this.scene.textures.exists(iconKey)) continue
        const img = this.scene.add.image(ox + tx * ts, oy + ty * ts, iconKey)
          .setOrigin(0, 0).setDisplaySize(ts, ts).setDepth(1)
        if (!torchlightOnly && !tile!.visible) img.setAlpha(0.45)
        this.terrainPool.push(img)
      }
    }

    // Floor items — inv category icon
    for (const img of this.itemPool) img.destroy()
    this.itemPool = []
    for (const fi of floorItems) {
      const tile = this.map.getTile(fi.x, fi.y)
      if (torchlightOnly ? !tile?.visible : !tile?.explored) continue
      const spriteKey = ITEM_TYPE_SPRITES[fi.item.defId] ?? 'inv_null'
      if (!this.scene.textures.exists(spriteKey)) continue
      const img = this.scene.add.image(ox + fi.x * ts, oy + fi.y * ts, spriteKey)
        .setOrigin(0, 0).setDisplaySize(ts, ts).setDepth(2)
      this.itemPool.push(img)
    }

    // Monsters — glyph (only visible)
    for (const t of this.monsterPool) t.destroy()
    this.monsterPool = []
    for (const m of monsters) {
      const tile = this.map.getTile(m.x, m.y)
      if (!tile?.visible) continue
      const t = this.scene.add.text(ox + m.x * ts, oy + m.y * ts, m.glyph, {
        fontSize: `${ts}px`, color: m.color, fontFamily: 'monospace',
      }).setOrigin(0, 0).setDepth(3)
      this.monsterPool.push(t)
    }

    // Player — userLocation sprite (or white dot fallback)
    const plx = ox + player.x * ts
    const ply = oy + player.y * ts

    if (!this.playerSprite && this.scene.textures.exists('ui_user_location')) {
      this.playerSprite = this.scene.add.image(0, 0, 'ui_user_location')
      this.playerSprite.setDisplaySize(ts, ts)
      this.playerSprite.setDepth(10)
    }

    if (this.playerSprite) {
      this.playerSprite.setPosition(plx, ply).setOrigin(0, 0)
    } else {
      g.fillStyle(0xffffff)
      g.fillRect(plx + Math.floor(ts / 2) - 1, ply, 2, ts)
      g.fillRect(plx, ply + Math.floor(ts / 2) - 1, ts, 2)
    }
  }

  private defColor(defId: string): number {
    const colors: Record<string, number> = {
      grass:       0x2a5e2a,
      floor:       0x383838,
      wall:        0x606060,
      berg:        0x848484,
      water:       0x1a4070,
      tree:        0x1a4a1a,
      tree_dead:   0x4a3010,
      door_closed: 0x7a4822,
      door_open:   0x7a4822,
      stairs_up:   0x909090,
      stairs_down: 0x909090,
      lava:         0x903010,
      mud:          0x4a3010,
      carpet:       0x603060,
      sand:         0x8a6a30,
      wall_down:    0x606060,
      exit_kitchen:   0x804020,
      exit_garage:    0x607080,
      tegel_wit:      0xc0c0c0,
      tegel_bruin:    0x6a3a10,
      water_bath:     0x1a4070,
      toilet:         0xa0a0c0,
      wcrol:          0xb0b080,
      kraan:          0x808080,
      stop:           0xa06020,
      crypt:          0x404050,
      garage_exit_up: 0x806040,
      garage_exit_down: 0x806040,
      portal_garage:  0x2070c0,
      exit_bathroom:  0x7a4822,
      bath_exit_left: 0x804000,
      bath_exit_down: 0x804000,
      bath_exit_up:   0x804000,
      portal:         0x5010a0,
    }
    return colors[defId] ?? 0x404040
  }

  private scaleColor(color: number, f: number): number {
    const r = Math.round(((color >> 16) & 0xff) * f)
    const g = Math.round(((color >> 8)  & 0xff) * f)
    const b = Math.round((color & 0xff) * f)
    return (r << 16) | (g << 8) | b
  }
}
