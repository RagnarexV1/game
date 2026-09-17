import Phaser from 'phaser'
import type { MapSystem } from '../engine/MapSystem'
import type { Player } from '../entities/Player'
import type { Monster } from '../entities/Monster'
import type { FloorItem } from '../entities/FloorItem'
import itemData from '../data/items.json'

// Fallback inv-category sprite for items without a specific floor sprite
const INV_SPRITES: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const def of itemData as Array<{ id: string; type: string }>) {
    if (def.id === 'amulet') { m[def.id] = 'inv_amulet'; continue }
    switch (def.type) {
      case 'weapon':     m[def.id] = 'inv_weapon'; break
      case 'armor':      m[def.id] = 'inv_armour'; break
      case 'scroll':     m[def.id] = 'inv_scroll'; break
      case 'gold':       m[def.id] = 'inv_null';   break
      case 'drink':      m[def.id] = 'inv_potion'; break
      case 'eat':        m[def.id] = 'inv_food';   break
      case 'ring':       m[def.id] = 'inv_ring';   break
      case 'wand':       m[def.id] = 'inv_wand';   break
      case 'tool':       m[def.id] = 'inv_tool';   break
      default:           m[def.id] = 'inv_null';   break
    }
  }
  return m
})()

const TILE = 32

const TILE_SPRITES: Record<string, string> = {
  floor:        'terrain_floor',
  grass:        'terrain_grass',
  wall:         'terrain_wall_x',
  berg:         'terrain_berg',
  water:        'terrain_water',
  waterbodem:   'terrain_waterbodem',
  tree:         'terrain_tree',
  tree_dead:    'terrain_tree_dead',
  door_closed:  'terrain_door',
  door_open:    'terrain_grass',
  stairs_up:    'terrain_stairs_up',
  stairs_down:  'terrain_stairs_up',
  lava:         'terrain_lava',
  mud:          'terrain_mud',
  carpet:       'terrain_carpet',
  exit_right:   'terrain_next_right',
  exit_left:    'terrain_next_left',
  exit_down:    'terrain_next_down',
  exit_up:      'terrain_next_up',
  sand:         'terrain_mud',
  wall_up:          'terrain_wall_up',
  wall_down:        'terrain_wall_down',
  wall_left:        'terrain_wall_left',
  wall_right:       'terrain_wall_right',
  wall_corner_tl:   'terrain_corner_tl',
  wall_corner_tr:   'terrain_corner_tr',
  wall_corner_bl:   'terrain_corner_bl',
  wall_corner_br:   'terrain_corner_br',
  exit_kitchen:     'terrain_next_down',
  exit_garage:      'terrain_next_down',
  tegel_wit:        'terrain_tegel_wit',
  tegel_bruin:      'terrain_tegel_bruin',
  toilet:           'terrain_toilet',
  wcrol:            'terrain_wcrol',
  water_bath:       'terrain_water',
  exit_bathroom:    'terrain_door',
  bath_exit_left:   'terrain_next_left',
  bath_exit_down:   'terrain_next_down',
  bath_exit_up:     'terrain_next_up',
  portal:           'terrain_portal',
  kraan:            'terrain_kraan',
  crypt:            'terrain_crypt',
  garage_exit_up:   'terrain_next_up',
  garage_exit_down: 'terrain_next_down',
  portal_garage:        'terrain_portal',
  portal_underground:   'terrain_portal',
  hall_wall:            'terrain_hall_wall',
  underground_exit_up: 'terrain_next_up',
  vulkaan:              'terrain_vulkaan',
  portal_chaos:         'terrain_portal',
  tapijt3:              'terrain_tapijt3',
  muurM:                'terrain_wall_m',
  muur_up_v:            'terrain_wall_up_v',
  muur_down_v:          'terrain_wall_down_v',
  muur_left_v:          'terrain_wall_left_v',
  muur_right_v:         'terrain_wall_right_v',
  muur_corner_tl_v:     'terrain_corner_tl_v',
  muur_corner_tr_v:     'terrain_corner_tr_v',
  muur_corner_bl_v:     'terrain_corner_bl_v',
  muur_corner_br_v:     'terrain_corner_br_v',
  muur_door_bottom_v:   'terrain_door_bottom_v',
  muur_up_t:            'terrain_wall_up',
  muur_down_t:          'terrain_wall_down',
  muur_left_t:          'terrain_wall_left',
  muur_right_t:         'terrain_wall_right',
  muur_corner_tl_t:     'terrain_corner_tl',
  muur_corner_tr_t:     'terrain_corner_tr',
  muur_corner_bl_t:     'terrain_corner_bl',
  muur_corner_br_t:     'terrain_corner_br',
  muur_door_bottom_t:   'terrain_door_bottom',
  flame:                'terrain_flame',
  bedroom_exit:         'terrain_portal',
  portal_bedroom:       'terrain_portal',
  portal_stairs:        'terrain_portal',
  portal_stairs_up:     'terrain_stairs_up',
  stairs_exit_down:     'terrain_next_down',
  stairs_exit_up:       'terrain_next_up',
  bedroom_stairs_down:  'terrain_next_down',
  bedroom_stairs_up:    'terrain_next_up',
  kitchen_tile1:        'terrain_kitchen_tile1',
  kitchen_tile2:        'terrain_kitchen_tile2',
  kitchen_tile3:        'terrain_kitchen_tile3',
  kitchen_tile4:        'terrain_kitchen_tile4',
  kitchen_exit:         'terrain_next_down',
  kitchen_exit_top:     'terrain_next_up',
  portal_cellar:        'terrain_portal',
  cellar_exit:          'terrain_next_up',
  vortex_portal:        'ui_vortex',
  loft_floor:           'terrain_lego_green',
  loft_wall:            'terrain_lego_black',
  portal_loft:          'terrain_portal',
  loft_exit:            'terrain_next_up',
  loft_water:           'terrain_lego_blue',
  loft_tree:            'terrain_tree',
  portal_loft3:         'terrain_portal',
  loft3_exit:           'terrain_next_left',
  lego_blue:            'terrain_lego_blue',
  lego_brown:           'terrain_lego_brown',
  lego_red:             'terrain_lego_red',
  lego_grey:            'terrain_lego_grey',
  portal_study:         'terrain_portal',
  study_exit:           'terrain_next_down',
  portal_pantry:        'terrain_portal',
  pantry_exit:          'terrain_next_up',
  study_pool:           'terrain_water',
  study_pool_green:     'terrain_water_green',
  study_pool_yellow:    'terrain_water_yellow',
  driveway:                 'terrain_mud',
  garage_portal_driveway:   'terrain_portal',
  hall_portal_driveway:     'terrain_portal',
  bedroom_portal_driveway:  'terrain_portal',
  driveway_exit_garage:     'terrain_next_up',
  driveway_exit_hall:       'terrain_next_up',
  driveway_exit_balcony:    'terrain_next_up',
  garage_exit_driveway:     'terrain_next_down',
}

const ITEM_SPRITES: Record<string, string> = {
  ericgras:         'item_ericgras',
  petergras:        'item_petergras',
  scroll_blank:       'item_scroll',
  scroll_teleport:    'item_scroll',
  scroll_alliance:    'item_scroll',
  scroll_cartography: 'item_scroll',
  scroll_transport:   'item_scroll',
  scroll_timestop:    'item_scroll',
  scroll_twelvegates: 'item_scroll',
  scroll_extinction:  'item_scroll',
  scroll_knowledge:   'item_scroll',
  relic_scroll_1:     'item_scroll',
  relic_scroll_2:     'item_scroll',
  relic_scroll_3:     'item_scroll',
  health_potion:          'item_potion',
  speed_potion:           'item_potion',
  phasing_potion:         'item_potion',
  depredation_potion:     'item_potion',
  strength_potion:        'item_potion',
  experience_potion:      'item_potion',
  blindness_potion:       'item_potion',
  translucence_potion:    'item_potion',
  second_life_potion:     'item_potion',
  invulnerability_potion: 'item_potion',
  music_potion:           'item_potion',
  transformation_potion:  'item_potion',
  mystery_potion:         'item_potion',
  empty_vial:          'item_emptyvial',
  branch:           'item_branch',
  knife:            'item_knife',
  bijl:             'item_axe',
  tuinschaar:       'item_tuinschaar',
  kruk:             'item_kruk',
  wasknijper:       'item_wasknijper',
  wasknijperbom:    'item_wasknijperbom',
  stop:             'terrain_stop',
  toiletBrush:      'item_toiletBrush',
  mirrorshield:     'item_mirrorshield',
  ninjabroek:       'item_ninjabroek',
  tuinhandschoen:   'item_tuinhandschoen',
  amulet:           'item_amulet',
  banaan:           'item_banaan',
  lekkervisje:      'item_lekkervisje',
  sinaasappel:      'item_sinaasappel',
  pannenkoeken:     'item_pannenkoeken',
  flying_flippo:    'item_flying_flippo',
  madelief:         'item_madelief',
  theedoek:         'item_theedoek',
  remote:           'item_remote',
  boterham:         'item_boterham',
  stroopwafels:     'item_stroopwafels',
  speculaas:        'item_speculaas',
  speculaas_bad:    'item_speculaas',
  sprits:           'item_sprits',
  dropje:           'item_dropje',
  postzegelRex:     'item_postzegelRex',
  postzegelStego:   'item_postzegelStego',
  postzegelStoom:   'item_postzegelStoom',
  gold_coin:        'item_coin',
  bracers:          'item_bracers',
  chain_mail:       'item_chainmail',
  leather_armor:    'item_leatherArmor',
  crossbow:         'item_crossbow',
  gorget:           'item_gorget',
  helmet:           'item_helmet',
  rubberboots:      'item_rubberboots',
  katana:           'item_katana',
  mace:             'item_mace',
  pickaxe:          'item_pickaxe',
  redcape:          'item_redcape',
  ring:               'item_ring',
  ring_hastening:     'item_ring',
  ring_famine:        'item_ring',
  ring_invisibility:  'item_ring',
  ring_cold:          'item_ring',
  silversword:      'item_silversword',
  wand:             'item_wand',
  vaas:             'item_vaas',
  widget2:          'item_widget2',
  pannenkoek:       'item_pannenkoek',
  mispel:           'item_mispel',
  clay:             'item_clay',
  lego1:            'item_lego1',
  lego2:            'item_lego2',
  lego3:            'item_lego3',
  propje:           'item_propje',
  gong:             'item_gong',
  gompie:           'item_gompie',
  mjollnir:         'item_mjollnir',
}

const MONSTER_SPRITES: Record<string, string> = {
  snail:     'monster_slak',
  hagedis:   'monster_hagedis',
  skunk:     'monster_stinkdier',
  dwarf:     'monster_dwarf',
  eendGroen: 'monster_eendGroen',
  eendRood:  'monster_eendRood',
  egel:      'monster_egel',
  hamster:    'monster_hamster',
  guineapig:  'monster_guineapig',
  duif:      'monster_duif',
  blauwkip:  'monster_blauwkip',
  eric:      'monster_eric',
  tetra:     'monster_tetra',
  peter:     'monster_peter',
  mam:       'monster_mam',
  pap2:      'monster_pap2',
  mar:         'monster_mar',
  mar_bedroom: 'monster_mar',
  sas:       'monster_sas',
  koe:       'monster_koe',
  magician:         'monster_magician',
  summoner:         'monster_summoner',
  swordsman: 'monster_swordsman',
  firedragon:'monster_firedragon',
  icedragon: 'monster_icedragon',
  hela:      'monster_hela',
  paard:     'monster_paard',
  mier:      'monster_mier',
  mol:       'monster_mol',
  worm:      'monster_worm',
  schaap:    'monster_schaap',
  sorcerer:  'monster_sorcerer',
  wizard:    'monster_wizard',
  lorkest:   'monster_lorkest',
  qivuit:    'monster_qivuit',
  jormungand:'monster_jormungand',
  vis:       'monster_vis',
  squid:       'monster_squid',
  silvervisje: 'monster_silvervisje',
  pissebed:    'monster_pissebed',
  bat:         'monster_bat',
  lowerdwarf:  'monster_lowerdwarf',
  cactus:      'monster_cactus',
  secitt:      'monster_secitt',
  watcher:     'monster_watcher',
  wierdfume:   'monster_wierdfume',
  rat:         'monster_rat',
  wilddog:     'monster_wilddog',
  wildboar:    'monster_wildboar',
  ogre:        'monster_ogre',
  spirit:      'monster_spirit',
  car:         'monster_car',
  guardian:    'monster_guardian',
  eric_trader: 'monster_eric',
  muddman:     'monster_muddman',
  nymph:       'monster_nymph',
  cat:         'monster_cat',
  wolf:        'monster_wolf',
  stinkdier:   'monster_stinkdier',
}

type RenderObject = Phaser.GameObjects.GameObject

export class LocalMapView {
  private pool: RenderObject[] = []
  private bg: Phaser.GameObjects.Graphics
  private _isBedroomMap = false

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private map: MapSystem,
  ) {
    // Black background — stays always
    this.bg = scene.add.graphics()
    this.bg.fillStyle(0x000000)
    this.bg.fillRect(x, y, w, h)
    this.bg.setDepth(0)

    // Mask graphics — depth -1 keeps it behind the black bg (depth 0) so it's
    // invisible to the player but still rendered to the WebGL stencil buffer,
    // which is required for GeometryMask to actually clip masked objects.
    const maskGfx = scene.add.graphics()
    maskGfx.fillStyle(0xffffff)
    maskGfx.fillRect(x, y, w, h)
    maskGfx.setDepth(-1)
    const mask = new Phaser.Display.Masks.GeometryMask(scene, maskGfx)

    // We'll apply the mask per-object at render time
    this._mask = mask
  }

  groundDecorations: Array<{ tx: number; ty: number; key: string }> = []

  private _mask: Phaser.Display.Masks.GeometryMask
  private lastCamOffX = 0
  private lastCamOffY = 0

  getMask(): Phaser.Display.Masks.GeometryMask { return this._mask }

  renderBombs(bombs: Array<{tx: number; ty: number}>): void {
    const { x, y, w, h } = this
    for (const bomb of bombs) {
      const bsx = x + this.lastCamOffX + bomb.tx * TILE
      const bsy = y + this.lastCamOffY + bomb.ty * TILE
      if (bsx + TILE < x || bsy + TILE < y || bsx > x + w || bsy > y + h) continue
      const img = this.scene.add.image(bsx, bsy, 'stairs_banaan').setOrigin(0, 0).setDepth(5)
      img.setMask(this._mask)
      this.pool.push(img)
    }
  }

  getTileAt(screenX: number, screenY: number): { tx: number; ty: number } | null {
    if (screenX < this.x || screenX >= this.x + this.w ||
        screenY < this.y || screenY >= this.y + this.h) return null
    const tx = Math.floor((screenX - this.x - this.lastCamOffX) / TILE)
    const ty = Math.floor((screenY - this.y - this.lastCamOffY) / TILE)
    if (!this.map.isInBounds(tx, ty)) return null
    return { tx, ty }
  }

  getTileScreenPos(tx: number, ty: number): { sx: number; sy: number } {
    return {
      sx: this.x + this.lastCamOffX + tx * TILE,
      sy: this.y + this.lastCamOffY + ty * TILE,
    }
  }

  animateThrow(
    defId: string,
    fromTileX: number, fromTileY: number,
    toTileX: number, toTileY: number,
    onComplete: () => void,
  ): void {
    const from = this.getTileScreenPos(fromTileX, fromTileY)
    const to   = this.getTileScreenPos(toTileX,   toTileY)

    const spriteKey = ITEM_SPRITES[defId] ?? INV_SPRITES[defId]
    let projectile: Phaser.GameObjects.Image | Phaser.GameObjects.Text
    let targetX: number, targetY: number

    if (spriteKey && this.scene.textures.exists(spriteKey)) {
      projectile = this.scene.add.image(from.sx, from.sy, spriteKey).setOrigin(0, 0).setDepth(10)
      projectile.setMask(this._mask)
      targetX = to.sx
      targetY = to.sy
    } else {
      const { glyph, color } = this.itemGlyph(defId)
      projectile = this.scene.add.text(from.sx + 6, from.sy + 6, glyph, {
        fontSize: '18px', color, fontFamily: 'monospace',
      }).setDepth(10).setMask(this._mask)
      targetX = to.sx + 6
      targetY = to.sy + 6
    }

    const dx = toTileX - fromTileX
    const dy = toTileY - fromTileY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const duration = Math.max(160, Math.min(120 * dist, 700))

    this.scene.tweens.add({
      targets: projectile,
      x: targetX,
      y: targetY,
      duration,
      ease: 'Linear',
      onComplete: () => {
        projectile.destroy()
        onComplete()
      },
    })
  }

  render(
    player: Player,
    monsters: Monster[],
    floorItems: FloorItem[],
    corpses: Array<{ x: number; y: number }> = [],
  ): void {
    // Destroy previous pool
    for (const obj of this.pool) obj.destroy()
    this.pool = []

    const { x, y, w, h } = this

    // Camera: center on player
    const camOffX = Math.floor(w / 2) - player.x * TILE - TILE / 2
    const camOffY = Math.floor(h / 2) - player.y * TILE - TILE / 2
    this.lastCamOffX = camOffX
    this.lastCamOffY = camOffY

    const mapW = this.map.width
    const mapH = this.map.height

    // In underground the background is hall_wall; use it as base fallback instead of grass
    let isBathroomMap = false
    let isBedroomMap = false
    for (let ty = 0; ty < mapH && !isBathroomMap; ty++)
      for (let tx = 0; tx < mapW && !isBathroomMap; tx++) {
        const d = this.map.getTile(tx, ty)?.defId
        if (d === 'tegel_wit' || d === 'tegel_bruin') isBathroomMap = true
      }
    for (let ty = 0; ty < mapH && !isBedroomMap; ty++)
      for (let tx = 0; tx < mapW && !isBedroomMap; tx++) {
        if (this.map.getTile(tx, ty)?.defId === 'tapijt3') isBedroomMap = true
      }
    if (isBedroomMap) isBathroomMap = false
    this._isBedroomMap = isBedroomMap
    let isStudyMap = false
    for (let ty = 0; ty < mapH && !isStudyMap; ty++)
      for (let tx = 0; tx < mapW && !isStudyMap; tx++) {
        if (this.map.getTile(tx, ty)?.defId === 'carpet') isStudyMap = true
      }
    const bgBase = this.map.getTile(0, 0)?.defId === 'hall_wall' ? 'terrain_hall_wall'
      : isBathroomMap ? 'terrain_hall_wall'
      : isBedroomMap ? 'terrain_tapijt3'
      : isStudyMap ? 'terrain_carpet'
      : 'terrain_grass'

    // Tiles
    for (let ty = 0; ty < mapH; ty++) {
      for (let tx = 0; tx < mapW; tx++) {
        const tile = this.map.getTile(tx, ty)
        if (!tile?.explored) continue

        const sx = x + camOffX + tx * TILE
        const sy = y + camOffY + ty * TILE

        // Cull off-screen
        if (sx + TILE < x || sy + TILE < y || sx > x + w || sy > y + h) continue

        // Stairs: colored tile sprites based on diagonal band position
        if (tile.defId === 'stairs_wall' || tile.defId === 'void') {
          // black — covered by scene bg, nothing to draw
          continue
        }
        if (tile.defId === 'stairs_floor') {
          const diagPos = tx + (mapH - 1 - ty)
          const fraction = diagPos / (mapW + mapH - 2)
          const key = fraction < 0.33 ? 'stairs_red' : fraction < 0.66 ? 'stairs_yellow' : 'stairs_blue'
          const img = this.scene.add.image(sx, sy, key).setOrigin(0, 0).setDepth(1)
          if (!tile.visible) img.setTint(0x404060)
          this.pool.push(img)
          continue
        }

        // Vortex portal: base + vortex sprite + water overlay when in bathroom context
        if (tile.defId === 'vortex_portal') {
          const visible = tile.visible
          const nbrs = [
            this.map.getTile(tx - 1, ty)?.defId,
            this.map.getTile(tx + 1, ty)?.defId,
            this.map.getTile(tx, ty - 1)?.defId,
            this.map.getTile(tx, ty + 1)?.defId,
          ]
          const isBathroom = nbrs.some(d => d === 'tegel_wit' || d === 'tegel_bruin' || d === 'water_bath' || d === 'kraan')
          const baseKey = isBathroom ? 'terrain_tegel_wit' : 'terrain_floor'

          const base = this.scene.add.image(sx, sy, baseKey).setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)

          if (this.scene.textures.exists('ui_vortex')) {
            const vortex = this.scene.add.image(sx, sy, 'ui_vortex').setOrigin(0, 0).setDepth(1.5)
            vortex.setMask(this._mask)
            if (!visible) vortex.setTint(0x404060)
            this.pool.push(vortex)
          }

          if (isBathroom && this.scene.textures.exists('terrain_water')) {
            const water = this.scene.add.image(sx, sy, 'terrain_water').setOrigin(0, 0).setDepth(2)
            water.setMask(this._mask)
            water.setAlpha(visible ? 0.55 : 0.25)
            this.pool.push(water)
          }
          continue
        }

        const def = this.map.getDef(tile.defId)
        if (!def) continue

        const spriteKey = this.wallSprite(tile.defId, tx, ty)
        const visible = tile.visible
        const needsGrassBase = tile.defId === 'tree' || tile.defId === 'tree_dead' || tile.defId === 'berg' ||
          tile.defId === 'exit_right' || tile.defId === 'exit_left' ||
          tile.defId === 'exit_down'  || tile.defId === 'exit_up'   ||
          tile.defId === 'wall_up'    || tile.defId === 'wall_down' ||
          tile.defId === 'wall_left'  || tile.defId === 'wall_right' ||
          tile.defId === 'wall_corner_tl' || tile.defId === 'wall_corner_tr' ||
          tile.defId === 'wall_corner_bl' || tile.defId === 'wall_corner_br' ||
          tile.defId === 'door_closed' || tile.defId === 'exit_bathroom' || tile.defId === 'portal' ||
          tile.defId === 'portal_garage' || tile.defId === 'portal_underground' ||
          tile.defId === 'portal_bedroom' || tile.defId === 'portal_stairs' || tile.defId === 'portal_stairs_up' ||
          tile.defId === 'portal_cellar' || tile.defId === 'portal_loft' || tile.defId === 'portal_loft3' ||
          tile.defId === 'portal_study' || tile.defId === 'portal_pantry'
        const needsFloorBase = tile.defId === 'exit_kitchen' || tile.defId === 'exit_garage' ||
          tile.defId === 'kitchen_exit_top' || tile.defId === 'kitchen_exit' ||
          tile.defId === 'crypt' || tile.defId === 'garage_exit_up' || tile.defId === 'garage_exit_down' ||
          tile.defId === 'cellar_exit' || tile.defId === 'pantry_exit' ||
          tile.defId === 'garage_portal_driveway' || tile.defId === 'hall_portal_driveway' ||
          tile.defId === 'driveway_exit_garage' || tile.defId === 'driveway_exit_hall' ||
          tile.defId === 'garage_exit_driveway'
        const needsBathroomBase = tile.defId === 'toilet' || tile.defId === 'wcrol' ||
          tile.defId === 'bath_exit_left' || tile.defId === 'bath_exit_down' || tile.defId === 'bath_exit_up' ||
          tile.defId === 'kraan'
        const needsTapijt3Base = tile.defId === 'bedroom_exit' || tile.defId === 'flame'
          || tile.defId === 'bedroom_stairs_down' || tile.defId === 'bedroom_stairs_up'
          || tile.defId === 'bedroom_portal_driveway' || tile.defId === 'driveway_exit_balcony'
        const needsLoftBase = tile.defId === 'loft_exit' || tile.defId === 'loft_tree' || tile.defId === 'loft3_exit'
        const needsCarpetBase = tile.defId === 'study_exit'

        if (needsGrassBase) {
          const nbrs4 = [
            this.map.getTile(tx - 1, ty)?.defId,
            this.map.getTile(tx + 1, ty)?.defId,
            this.map.getTile(tx, ty - 1)?.defId,
            this.map.getTile(tx, ty + 1)?.defId,
          ]
          const isDoorTile = tile.defId === 'door_closed' || tile.defId === 'exit_bathroom'
          const baseKey = isBathroomMap && isDoorTile ? 'terrain_tegel_wit'
            : isBathroomMap ? 'terrain_hall_wall'
            : nbrs4.some(d => d === 'tegel_wit') ? 'terrain_tegel_wit'
            : nbrs4.some(d => d === 'hall_wall') ? 'terrain_hall_wall'
            : this.hasTapijt3Neighbor(tx, ty) ? 'terrain_tapijt3'
            : bgBase
          const base = this.scene.add.image(sx, sy, baseKey).setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }
        if (needsFloorBase) {
          const base = this.scene.add.image(sx, sy, 'terrain_floor').setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }
        if (needsBathroomBase) {
          const base = this.scene.add.image(sx, sy, 'terrain_tegel_wit').setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }
        if (needsTapijt3Base) {
          const base = this.scene.add.image(sx, sy, 'terrain_tapijt3').setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }
        if (needsLoftBase) {
          const base = this.scene.add.image(sx, sy, 'terrain_lego_green').setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }
        if (needsCarpetBase) {
          const base = this.scene.add.image(sx, sy, 'terrain_carpet').setOrigin(0, 0).setDepth(1)
          base.setMask(this._mask)
          if (!visible) base.setTint(0x404060)
          this.pool.push(base)
        }

        if (spriteKey && this.scene.textures.exists(spriteKey)) {
          const img = this.scene.add.image(sx, sy, spriteKey).setOrigin(0, 0).setDepth(needsGrassBase || needsBathroomBase || needsFloorBase || needsTapijt3Base || needsLoftBase || needsCarpetBase ? 2 : 1)
          img.setMask(this._mask)
          if (!visible) img.setTint(0x404060)
          this.pool.push(img)
        } else {
          const color = visible ? def.color : '#404060'
          const t = this.scene.add.text(sx + 4, sy + 4, def.glyph, {
            fontSize: '20px', color, fontFamily: 'monospace',
          }).setDepth(1).setMask(this._mask)
          this.pool.push(t)
        }
      }
    }

    // Ground decorations — above floor, below entities
    for (const dec of this.groundDecorations) {
      const sx = x + camOffX + dec.tx * TILE
      const sy = y + camOffY + dec.ty * TILE
      if (sx + TILE < x || sy + TILE < y || sx > x + w || sy > y + h) continue
      const tile = this.map.getTile(dec.tx, dec.ty)
      if (!tile?.explored) continue
      if (this.scene.textures.exists(dec.key)) {
        const img = this.scene.add.image(sx + TILE / 2, sy + TILE / 2, dec.key)
          .setOrigin(0.5, 0.5).setDepth(1.5)
        img.setMask(this._mask)
        if (!tile.visible) img.setTint(0x404060)
        this.pool.push(img)
      }
    }

    // Corpses — rendered just above the floor tile
    for (const c of corpses) {
      const tile = this.map.getTile(c.x, c.y)
      if (!tile?.explored) continue
      const sx = x + camOffX + c.x * TILE
      const sy = y + camOffY + c.y * TILE
      if (sx + TILE < x || sy + TILE < y || sx > x + w || sy > y + h) continue

      const img = this.scene.add.image(sx, sy, 'monster_killed').setOrigin(0, 0).setDepth(2.5)
      img.setMask(this._mask)
      if (!tile.visible) img.setTint(0x404060)
      this.pool.push(img)
    }

    // Floor items
    for (const fi of floorItems) {
      const tile = this.map.getTile(fi.x, fi.y)
      if (!tile?.visible) continue
      const sx = x + camOffX + fi.x * TILE
      const sy = y + camOffY + fi.y * TILE

      const isOnWater = tile.defId === 'water'
      const itemDepth = isOnWater ? 0.5 : 2.5

      const spriteKey = ITEM_SPRITES[fi.item.defId] ?? INV_SPRITES[fi.item.defId]
      if (spriteKey && this.scene.textures.exists(spriteKey)) {
        const img = this.scene.add.image(sx, sy, spriteKey).setOrigin(0, 0).setDepth(itemDepth)
        img.setMask(this._mask)
        this.pool.push(img)
      } else {
        const { glyph, color } = this.itemGlyph(fi.item.defId)
        const t = this.scene.add.text(sx + 6, sy + 6, glyph, {
          fontSize: '18px', color, fontFamily: 'monospace',
        }).setDepth(itemDepth).setMask(this._mask)
        this.pool.push(t)
      }
    }

    // Monsters
    for (const m of monsters) {
      const tile = this.map.getTile(m.x, m.y)
      if (!tile?.visible) continue
      const sx = x + camOffX + m.x * TILE
      const sy = y + camOffY + m.y * TILE

      const baseSpriteKey = MONSTER_SPRITES[m.defId]
      const tileUnder = this.map.getTile(m.x, m.y)?.defId
      const isOnWater = tileUnder === 'water_bath' || tileUnder === 'water'
      const spriteKey = (m.defId === 'eric' && isOnWater) ? 'monster_eric_water' : baseSpriteKey
      if (spriteKey && this.scene.textures.exists(spriteKey)) {
        const img = this.scene.add.image(sx, sy, spriteKey).setOrigin(0, 0).setDepth(3)
        img.setMask(this._mask)
        this.pool.push(img)
      } else {
        const t = this.scene.add.text(sx + 4, sy + 4, m.glyph, {
          fontSize: '20px', color: m.color, fontFamily: 'monospace',
        }).setDepth(3).setMask(this._mask)
        this.pool.push(t)
      }
    }

    // Player
    const px = x + camOffX + player.x * TILE
    const py = y + camOffY + player.y * TILE
    if (this.scene.textures.exists(player.spriteKey)) {
      const img = this.scene.add.image(px, py, player.spriteKey).setOrigin(0, 0).setDepth(4)
      img.setMask(this._mask)
      this.pool.push(img)
    } else {
      const t = this.scene.add.text(px + 4, py + 4, '@', {
        fontSize: '20px', color: '#ffffff', fontFamily: 'monospace',
      }).setDepth(4).setMask(this._mask)
      this.pool.push(t)
    }
  }

  private itemGlyph(defId: string): { glyph: string; color: string } {
    const map: Record<string, { glyph: string; color: string }> = {
      branch:            { glyph: ')', color: '#8a5a32' },
      mjollnir:          { glyph: ')', color: '#8080ff' },
      knife:             { glyph: ')', color: '#ffffff' },
      bijl:              { glyph: ')', color: '#c08000' },
      tuinschaar:        { glyph: ')', color: '#80c080' },
      kruk:              { glyph: ')', color: '#c0a060' },
      wasknijper:        { glyph: ')', color: '#e0e0e0' },
      wasknijperbom:     { glyph: '*', color: '#ff8000' },
      toiletBrush:       { glyph: ')', color: '#c0c040' },
      leather_armor:     { glyph: '[', color: '#c08040' },
      chain_mail:        { glyph: '[', color: '#a0a0a0' },
      mirrorshield:      { glyph: '[', color: '#e0e0ff' },
      ninjabroek:        { glyph: '[', color: '#404040' },
      tuinhandschoen:    { glyph: '[', color: '#60a060' },
      amulet:            { glyph: '"', color: '#ffd700' },
      health_potion:     { glyph: '!', color: '#ff4040' },
      second_life_potion: { glyph: '!', color: '#ff80c0' },
      ericgras:          { glyph: '%', color: '#60c040' },
      petergras:         { glyph: '%', color: '#40a060' },
      banaan:            { glyph: '%', color: '#ffee00' },
      sinaasappel:       { glyph: '%', color: '#ff8800' },
      pannenkoeken:      { glyph: '%', color: '#e0a060' },
      boterham:          { glyph: '%', color: '#d0b060' },
      stroopwafels:      { glyph: '%', color: '#c08040' },
      speculaas:         { glyph: '%', color: '#c06820' },
      sprits:            { glyph: '%', color: '#e0d080' },
      dropje:            { glyph: '%', color: '#202020' },
      scroll_blank:        { glyph: '?', color: '#c0c080' },
      scroll_teleport:     { glyph: '?', color: '#c0c080' },
      scroll_alliance:     { glyph: '?', color: '#c0c080' },
      scroll_cartography:  { glyph: '?', color: '#c0c080' },
      scroll_transport:    { glyph: '?', color: '#c0c080' },
      scroll_timestop:     { glyph: '?', color: '#c0c080' },
      scroll_twelvegates:  { glyph: '?', color: '#c0c080' },
      scroll_extinction:   { glyph: '?', color: '#c0c080' },
      scroll_knowledge:    { glyph: '?', color: '#c0c080' },
      relic_scroll_1:      { glyph: '?', color: '#ffd080' },
      relic_scroll_2:      { glyph: '?', color: '#ffd080' },
      relic_scroll_3:      { glyph: '?', color: '#ffd080' },
      postzegelRex:      { glyph: '~', color: '#ff6040' },
      postzegelStego:    { glyph: '~', color: '#40c080' },
      postzegelStoom:    { glyph: '~', color: '#80c0e0' },
      gold_coin:         { glyph: '$', color: '#ffcc00' },
    }
    return map[defId] ?? { glyph: '?', color: '#c0c0c0' }
  }

  private hasTapijt3Neighbor(x: number, y: number): boolean {
    const carpet = new Set(['tapijt3', 'bedroom_stairs_down', 'bedroom_stairs_up'])
    return [
      this.map.getTile(x-1,y),   this.map.getTile(x+1,y),
      this.map.getTile(x,y-1),   this.map.getTile(x,y+1),
      this.map.getTile(x-1,y-1), this.map.getTile(x+1,y-1),
      this.map.getTile(x-1,y+1), this.map.getTile(x+1,y+1),
    ].some(t => t?.defId !== undefined && carpet.has(t.defId))
  }

  private wallSprite(defId: string, x: number, y: number): string | null {
    const v = this._isBedroomMap || this.hasTapijt3Neighbor(x, y)
    if (defId === 'door_closed') {
      const l = this.map.getTile(x - 1, y)?.defId
      const r = this.map.getTile(x + 1, y)?.defId
      const u = this.map.getTile(x, y - 1)?.defId
      const d = this.map.getTile(x, y + 1)?.defId
      if (l === 'wall_up'    || r === 'wall_up'    || l === 'wall_corner_tl' || r === 'wall_corner_tr') return v ? 'terrain_door_top_v'    : 'terrain_door_top'
      if (l === 'wall_down'  || r === 'wall_down'  || l === 'wall_corner_bl' || r === 'wall_corner_br') return v ? 'terrain_door_bottom_v' : 'terrain_door_bottom'
      if (u === 'wall_left'  || d === 'wall_left'  || u === 'wall_corner_tl' || d === 'wall_corner_bl') return v ? 'terrain_door_left_v'   : 'terrain_door_left'
      if (u === 'wall_right' || d === 'wall_right' || u === 'wall_corner_tr' || d === 'wall_corner_br') return v ? 'terrain_door_right_v'  : 'terrain_door_right'
      return v ? 'terrain_door_top_v' : 'terrain_door_top'
    }

    if (defId !== 'wall') {
      if (v) {
        const V: Record<string, string> = {
          wall_corner_tl: 'terrain_corner_tl_v', wall_corner_tr: 'terrain_corner_tr_v',
          wall_corner_bl: 'terrain_corner_bl_v', wall_corner_br: 'terrain_corner_br_v',
          wall_up:    'terrain_wall_up_v',  wall_down:  'terrain_wall_down_v',
          wall_left:  'terrain_wall_left_v', wall_right: 'terrain_wall_right_v',
        }
        if (defId in V) return V[defId]
      }
      return TILE_SPRITES[defId] ?? null
    }

    const u = !this.map.isWalkable(x,     y - 1)
    const d = !this.map.isWalkable(x,     y + 1)
    const l = !this.map.isWalkable(x - 1, y)
    const r = !this.map.isWalkable(x + 1, y)

    if (u && d && l && r) return 'terrain_wall_x'
    if (u && d)           return 'terrain_wall_v'
    if (l && r)           return 'terrain_wall_h'
    return 'terrain_wall_m'
  }
}
