import Phaser from 'phaser'
import { MapSystem } from '../engine/MapSystem'
import { TurnManager } from '../engine/TurnManager'
import { MessageLog } from '../engine/MessageLog'
import { CombatSystem } from '../engine/CombatSystem'
import { InventorySystem } from '../engine/InventorySystem'
import { EquipmentSystem } from '../engine/EquipmentSystem'
import { SaveSystem } from '../engine/SaveSystem'
import type { GameSaveData } from '../engine/SaveSystem'
import { LeaderboardSystem } from '../engine/LeaderboardSystem'
import type { LeaderboardEntry } from '../engine/LeaderboardSystem'
import { generateForestMap, generateBathroomTopMap, generateBathroomBottomMap, generateGarageTopMap, generateGarageBottomMap, generateUndergroundMap, generateChaosMap, mutateChaosMap, generateBedroomMap, generateBedroomLowerMap, generateKitchenMap, generateCellarMap, generateLoftMap, generateLoft3Map, generateStudyMap, generatePantryMap, generatePond1Map, generatePond2Map, generatePond3Map } from '../engine/MapGenerator'
import { WorldState } from '../engine/WorldState'
import { Player } from '../entities/Player'
import { Monster } from '../entities/Monster'
import { FloorItem } from '../entities/FloorItem'
import { StatsPanel } from '../ui/StatsPanel'
import { ActionPanel } from '../ui/ActionPanel'
import { MessagePanel } from '../ui/MessagePanel'
import { WorldMapView } from '../ui/WorldMapView'
import { LocalMapView } from '../ui/LocalMapView'
import { InventoryScreen } from '../ui/InventoryScreen'
import { SelfScreen } from '../ui/SelfScreen'
import {
  GAME_W, GAME_H, TILE,
  STATS_X, STATS_Y, STATS_W, STATS_H,
  BUTTONS_X, BUTTONS_Y, BUTTONS_W, BUTTONS_H,
  LOCAL_MAP_X, LOCAL_MAP_Y, LOCAL_MAP_W, LOCAL_MAP_H,
  MSG_X, MSG_Y, MSG_W, MSG_H,
  WORLD_MAP_X, WORLD_MAP_Y, WORLD_MAP_W, WORLD_MAP_H,
} from '../ui/Layout'
import monsterData from '../data/monsters.json'
import type { ItemInstance, MonsterDef } from '../types'

const MIX_RECIPES: Array<{ a: string; b: string; result: string }> = [
  { a: 'health_potion',      b: 'strength_potion',    result: 'invulnerability_potion' },
  { a: 'speed_potion',       b: 'translucence_potion', result: 'second_life_potion'    },
  { a: 'experience_potion',  b: 'phasing_potion',      result: 'transformation_potion' },
  { a: 'depredation_potion', b: 'blindness_potion',    result: 'music_potion'          },
]
const SKILLED_POOL  = ['second_life_potion', 'invulnerability_potion', 'music_potion', 'transformation_potion']
const MYSTERY_POOL  = ['speed_potion', 'phasing_potion', 'depredation_potion', 'strength_potion', 'experience_potion', 'blindness_potion', 'translucence_potion']

const MAP_W = 80
const MAP_H = 20

export class GameScene extends Phaser.Scene {
  private mapSystem!: MapSystem
  private turnManager!: TurnManager
  private messageLog!: MessageLog
  private combat!: CombatSystem
  private inventory!: InventorySystem
  private equipment!: EquipmentSystem
  private saveSystem!: SaveSystem

  private worldState!: WorldState

  private player!: Player
  private monsters: Monster[] = []
  private companions: Monster[] = []
  private floorItems: FloorItem[] = []
  private corpses: Array<{ x: number; y: number }> = []

  private statsPanel!: StatsPanel
  private actionPanel!: ActionPanel
  private messagePanel!: MessagePanel
  private worldMapView!: WorldMapView
  private localMapView!: LocalMapView
  private inventoryScreen!: InventoryScreen
  private selfScreen!: SelfScreen

  private inputBlocked = false
  private lookMode = false
  private lastKilledBy: string | null = null
  private bathroomFlooded = false
  private bathroomDrained = false

  private readonly QUEST_TARGETS: Record<string, { npcId: string; message: string }> = {
    relic_scroll_1: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    relic_scroll_2: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    relic_scroll_3: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    postzegelRex:   { npcId: 'pap2',  message: 'Pap excitedly adds the Rex stamp to his collection!' },
    postzegelStego: { npcId: 'pap2',  message: 'Pap excitedly adds the Stego stamp to his collection!' },
    postzegelStoom: { npcId: 'pap2',  message: 'Pap excitedly adds the Steam stamp to his collection!' },
    sinaasappel:    { npcId: 'mam',   message: 'Mam happily accepts the orange. "Thank you, dear!"' },
    vaas:           { npcId: 'mam',   message: 'Mam\'s eyes light up. "A blue vase! Oh, it\'s perfect!"' },
    ericgras:       { npcId: 'paard', message: 'The horse eagerly chomps on the Ericgras.' },
    petergras:      { npcId: 'paard', message: 'The horse sniffs the Petergras and reluctantly eats it.' },
    widget2:        { npcId: 'eric',  message: 'Eric\'s eyes light up. "Where did you find him?! I\'ll teach you to swim as a thank you!"' },
  }
  private lookCursor: Phaser.GameObjects.Graphics | null = null
  private throwMode = false
  private zapMode = false
  private panicOverlay: Phaser.GameObjects.Image | null = null
  private locationOverlay: Phaser.GameObjects.Image | null = null
  private locationOverlayDismiss: (() => void) | null = null
  private visitedAreaTypes = new Set<string>()
  private pendingThrowItem: ItemInstance | null = null
  private digMode = false
  private trimMode = false
  private digProgress: { dx: number; dy: number; turnsLeft: number } | null = null

  private ericChamberEntered = false
  private traderUnpaid = new Set<string>()

  private stairsBombs: Array<{tx: number; ty: number; dx: number}> = []
  private stairsBombFallExtra = 0

  private forestMusic:   Phaser.Sound.BaseSound | null = null
  private loftMusic:     Phaser.Sound.BaseSound | null = null
  private hallMusic:     Phaser.Sound.BaseSound | null = null
  private bathroomMusic: Phaser.Sound.BaseSound | null = null
  private bedroomMusic:  Phaser.Sound.BaseSound | null = null
  private pondMusic:     Phaser.Sound.BaseSound | null = null
  private musicVolume = 0.5

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    this.inputBlocked = false
    this.throwMode = false
    this.zapMode = false
    this.pendingThrowItem = null
    this.monsters    = []
    this.companions  = []
    this.floorItems  = []
    this.corpses     = []
    this.cameras.main.setBackgroundColor(0x000000)
    this.initSystems()
    this.buildMap()
    this.buildUI()
    this.setupInput()
    this.updateFOV()

    // Initial render
    this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    this.statsPanel.update(this.player, this.turnManager.getTurn())
    this.statsPanel.setRealm('Garden')

    this.messageLog.add("Welcome to Ragnarex!", '#00ffff')
    this.messageLog.add("Arrow keys=move/attack  Enter=pickup  I=Inventory  P=Drop  W=Wear  V=Remove  H=Wield  T=Throw  R=Read  E=Eat  D=Drink  U=Use  Z=Zap  .=wait", '#808080')

    this.forestMusic   = this.sound.add('music_forest',   { loop: true, volume: 0.5 })
    this.loftMusic     = this.sound.add('music_garden',   { loop: true, volume: 0.5 })
    this.hallMusic     = this.sound.add('music_hall',     { loop: true, volume: 0.5 })
    this.bathroomMusic = this.sound.add('music_bathroom', { loop: true, volume: 0.5 })
    this.bedroomMusic  = this.sound.add('music_bedroom',  { loop: true, volume: 0.5 })
    this.pondMusic     = this.sound.add('music_pond',     { loop: true, volume: 0.5 })
    this.updateMusic(null)

    if (this.saveSystem.hasGame()) this.showContinueDialog()
  }

  private updateMusic(area: string | null): void {
    const inForest   = area === null
    const inLoft     = area === 'loft' || area === 'loft3'
    const inHall     = area === 'underground'
    const inBathroom = area === 'bathroom_top' || area === 'bathroom_bottom'
    const inBedroom  = area === 'bedroom' || area === 'bedroom_lower'
    const inPond     = area === 'pond1' || area === 'pond2' || area === 'pond3'
    if (!this.forestMusic?.isPlaying   && inForest)   this.forestMusic?.play()
    if (!this.loftMusic?.isPlaying     && inLoft)     this.loftMusic?.play()
    if (!this.hallMusic?.isPlaying     && inHall)     this.hallMusic?.play()
    if (!this.bathroomMusic?.isPlaying && inBathroom) this.bathroomMusic?.play()
    if (!this.bedroomMusic?.isPlaying  && inBedroom)  this.bedroomMusic?.play()
    if (!this.pondMusic?.isPlaying     && inPond)     this.pondMusic?.play()
    if (!inForest)   this.forestMusic?.stop()
    if (!inLoft)     this.loftMusic?.stop()
    if (!inHall)     this.hallMusic?.stop()
    if (!inBathroom) this.bathroomMusic?.stop()
    if (!inBedroom)  this.bedroomMusic?.stop()
    if (!inPond)     this.pondMusic?.stop()
  }

  // ─── Stairs level ────────────────────────────────────────────────────────────

  private buildStairsSpawnPoints(entry: 'top' | 'bottom' = 'top'): { player: {x:number;y:number}; monsters: []; items: [] } {
    const W = MAP_W, H = MAP_H
    const walkable: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(true))

    try {
      const src = this.textures.get('stairs_bg').getSourceImage() as HTMLImageElement
      const imgW = src.naturalWidth || 624
      const imgH = src.naturalHeight || 200
      const canvas = document.createElement('canvas')
      canvas.width = imgW
      canvas.height = imgH
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      const imgData = ctx.getImageData(0, 0, imgW, imgH)
      const tileW = imgW / W
      const tileH = imgH / H
      for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
          const px = Math.min(imgW - 1, Math.floor(tx * tileW + tileW / 2))
          const py = Math.min(imgH - 1, Math.floor(ty * tileH + tileH / 2))
          const idx = (py * imgW + px) * 4
          walkable[ty][tx] = imgData.data[idx] + imgData.data[idx + 1] + imgData.data[idx + 2] >= 60
        }
      }
    } catch (e) {
      console.warn('Stairs pixel read failed, using all-walkable fallback', e)
    }

    for (let ty = 0; ty < H; ty++)
      for (let tx = 0; tx < W; tx++)
        this.mapSystem.setTile(tx, ty, walkable[ty][tx] ? 'stairs_floor' : 'stairs_wall')

    // All tiles always visible — no fog in stairs
    for (let ty = 0; ty < H; ty++)
      for (let tx = 0; tx < W; tx++) {
        const t = this.mapSystem.getTile(tx, ty)
        if (t) { t.explored = true; t.visible = true }
      }

    // Exit at bottom-right (going down reached here)
    const exitBottom = (() => {
      for (let ty = H - 1; ty >= H - 5; ty--)
        for (let tx = W - 2; tx >= 1; tx--)
          if (walkable[ty][tx]) return { x: tx, y: ty }
      return { x: Math.floor(W / 2), y: H - 2 }
    })()
    this.mapSystem.setTile(exitBottom.x, exitBottom.y, 'stairs_exit')

    // Exit at top-right (going up reached here)
    const exitTop = (() => {
      for (let ty = 0; ty < 5; ty++)
        for (let tx = W - 2; tx >= 1; tx--)
          if (walkable[ty][tx]) return { x: tx, y: ty }
      return { x: Math.floor(W / 2), y: 0 }
    })()
    this.mapSystem.setTile(exitTop.x, exitTop.y, 'stairs_exit')

    // Player spawns at top-left (going down) or bottom-left (going up)
    const playerPos = entry === 'bottom'
      ? (() => {
          for (let ty = H - 1; ty >= H - 5; ty--)
            for (let tx = 1; tx < W - 1; tx++)
              if (walkable[ty][tx]) return { x: tx, y: ty }
          return { x: Math.floor(W / 2), y: H - 2 }
        })()
      : (() => {
          for (let ty = 0; ty < 5; ty++)
            for (let tx = 1; tx < W - 1; tx++)
              if (walkable[ty][tx]) return { x: tx, y: ty }
          return { x: Math.floor(W / 2), y: 1 }
        })()

    return { player: playerPos, monsters: [], items: [] }
  }

  private randomBombDx(): number {
    const r = Math.random()
    return r < 1 / 3 ? -1 : r < 2 / 3 ? 0 : 1
  }

  private startBombSpawner(): void {
    this.stairsBombs = []
    this.stairsBombFallExtra = 0
    for (let ty = 0; ty < MAP_H; ty += 2) {
      const count = 5 + Math.floor(Math.random() * 5)
      for (let i = 0; i < count; i++) {
        this.stairsBombs.push({ tx: Math.floor(Math.random() * MAP_W), ty, dx: this.randomBombDx() })
      }
    }
  }

  private stopBombSpawner(): void {
    this.stairsBombs = []
  }

  private advanceBombs(): void {
    const fall = 1 + this.stairsBombFallExtra
    this.stairsBombFallExtra = 0
    for (let i = this.stairsBombs.length - 1; i >= 0; i--) {
      const b = this.stairsBombs[i]
      b.ty += fall
      b.tx += b.dx * fall
      if (b.ty >= MAP_H || b.tx < 0 || b.tx >= MAP_W) { this.stairsBombs.splice(i, 1); continue }
      if (b.tx === this.player.x && b.ty === this.player.y) {
        const dmg = 20
        this.player.hp = Math.max(0, this.player.hp - dmg)
        if (!this.player.isAlive()) this.lastKilledBy = 'stair bomb'
        this.messageLog.add(`A banaan hits you! (-${dmg} HP)`, '#ff4000')
        this.statsPanel.update(this.player, this.turnManager.getTurn())
        this.stairsBombs.splice(i, 1)
        if (!this.player.isAlive()) {
          if (this.player.secondLife) {
            this.player.secondLife = false
            this.player.hp = this.player.maxHp
            this.messageLog.add('The Gods decided to give you a second chance.', '#ffd080')
          } else { this.gameOver(`Killed by ${this.lastKilledBy}`) }
        }
      }
    }
    // Spawn new bananen at ty=0 across full map width
    const newCount = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < newCount; i++) {
      this.stairsBombs.push({ tx: Math.floor(Math.random() * MAP_W), ty: 0, dx: this.randomBombDx() })
    }
  }

  // ─── Systems ────────────────────────────────────────────────────────────────

  private initSystems(): void {
    this.messageLog  = new MessageLog()
    this.mapSystem   = new MapSystem(MAP_W, MAP_H)
    this.turnManager = new TurnManager()
    this.inventory   = new InventorySystem(this.messageLog)
    this.equipment   = new EquipmentSystem(this.messageLog, this.inventory)
    this.combat      = new CombatSystem(this.messageLog)
    this.saveSystem  = new SaveSystem()
    this.worldState  = new WorldState()

    this.player = new Player()
    this.player.setSystems(this.equipment, this.inventory)
    this.turnManager.addActor(this.player)

    for (const defId of ['dagger', 'leather_armor', 'health_potion', 'boterham', 'health_potion']) {
      this.player.inventory.push(this.inventory.createInstance(defId))
    }
  }

  private buildMap(): void {
    const { player, monsters, items } = generateForestMap(
      this.mapSystem, this.worldState.cx, this.worldState.cy, this.worldState,
    )
    this.player.x = player.x
    this.player.y = player.y
    this.spawnEntities(monsters, items)
  }

  private spawnEntities(
    monsters: Array<{ x: number; y: number; defId: string; message?: string }>,
    items: Array<{ x: number; y: number; defId: string; qty?: number }>,
  ): void {
    const defs = new Map<string, MonsterDef>()
    for (const d of monsterData as MonsterDef[]) defs.set(d.id, d)

    for (const ms of monsters) {
      if (ms.x === this.player.x && ms.y === this.player.y) continue
      const def = defs.get(ms.defId) ?? (monsterData[0] as MonsterDef)
      const m = new Monster(def, ms.x, ms.y)
      if (ms.message) m.message = ms.message
      m.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (monster) => this.handleMonsterAttack(monster),
      )
      m.energy = 0; m.speed = m.speed * 100
      if (ms.defId === 'secitt') m.onSplit = (mon) => this.spawnSecitt(mon)
      if (ms.defId === 'muddman') m.onAfterMove = (fx, fy) => this.mapSystem.setTile(fx, fy, 'mud')
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }

    for (const it of items) {
      const instance = this.inventory.createInstance(it.defId, it.qty ?? 1)
      this.floorItems.push(new FloorItem(it.x, it.y, instance))
    }
  }

  private spawnSecitt(parent: Monster): void {
    if (this.monsters.filter(m => m.defId === 'secitt').length >= 12) return
    const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
    for (const [dx, dy] of dirs) {
      const nx = parent.x + dx, ny = parent.y + dy
      if (!this.mapSystem.isWalkable(nx, ny)) continue
      if (this.getMonsterAt(nx, ny) !== null) continue
      if (nx === this.player.x && ny === this.player.y) continue
      const def = (monsterData as MonsterDef[]).find(d => d.id === 'secitt')
      if (!def) return
      const spawn = new Monster(def, nx, ny)
      spawn.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (monster) => this.handleMonsterAttack(monster),
      )
      spawn.energy = 0
      spawn.speed = spawn.speed * 100
      spawn.onSplit = (m) => this.spawnSecitt(m)
      this.monsters.push(spawn)
      this.turnManager.addActor(spawn)
      this.messageLog.add('A Secitt splits!', '#ff40ff')
      return
    }
  }

  private firstEntryTile(fromDir: 'right'|'left'|'down'|'up', coord: number): { x: number, y: number } {
    const special = (id: string) => id.startsWith('exit_') || id === 'berg'
    switch (fromDir) {
      case 'right': {
        const y = Math.max(1, Math.min(MAP_H - 2, coord))
        for (let x = 1; x < MAP_W; x++) {
          const t = this.mapSystem.getTile(x, y)
          if (t && this.mapSystem.isWalkable(x, y) && !special(t.defId)) return { x, y }
        }
        return { x: 3, y: Math.floor(MAP_H / 2) }
      }
      case 'left': {
        const y = Math.max(1, Math.min(MAP_H - 2, coord))
        for (let x = MAP_W - 2; x >= 0; x--) {
          const t = this.mapSystem.getTile(x, y)
          if (t && this.mapSystem.isWalkable(x, y) && !special(t.defId)) return { x, y }
        }
        return { x: MAP_W - 4, y: Math.floor(MAP_H / 2) }
      }
      case 'down': {
        const x = Math.max(1, Math.min(MAP_W - 2, coord))
        for (let y = 1; y < MAP_H; y++) {
          const t = this.mapSystem.getTile(x, y)
          if (t && this.mapSystem.isWalkable(x, y) && !special(t.defId)) return { x, y }
        }
        return { x: Math.floor(MAP_W / 2), y: 3 }
      }
      case 'up': {
        const x = Math.max(1, Math.min(MAP_W - 2, coord))
        for (let y = MAP_H - 2; y >= 0; y--) {
          const t = this.mapSystem.getTile(x, y)
          if (t && this.mapSystem.isWalkable(x, y) && !special(t.defId)) return { x, y }
        }
        return { x: Math.floor(MAP_W / 2), y: MAP_H - 4 }
      }
    }
  }

  private transitionCell(dx: number, dy: number, fromDir: 'right'|'left'|'down'|'up', entryCoord: number): void {
    this.player.itemVision = false
    this.saveCellSnapshot(this.forestKey())
    this.worldState.go(dx, dy)
    this.ericChamberEntered = false
    this.traderUnpaid.clear()

    // Save companions before clearing
    const savedCompanions = this.companions.slice()

    // Clear existing entities
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters   = []
    this.companions = []
    this.floorItems = []
    this.corpses    = []

    this.mapSystem.reset()
    if (!this.tryRestoreFromSnapshot(this.forestKey())) {
      const { monsters, items } = generateForestMap(
        this.mapSystem, this.worldState.cx, this.worldState.cy, this.worldState,
      )
      this.spawnEntities(monsters, items)
    }

    if (this.worldState.cx === 0 && this.worldState.cy === 0 && this.worldState.widgetFound) {
      const mar = this.monsters.find(m => m.defId === 'mar')
      if (mar && !mar.message) { mar.message = "So, what's next?"; mar.hasSpoken = false }
    }

    // Entry position: same x (up/down) or y (left/right), first walkable non-exit tile from border
    const entry = this.firstEntryTile(fromDir, entryCoord)
    this.player.x = entry.x
    this.player.y = entry.y

    // Re-add companions near the player's entry position
    for (const companion of savedCompanions) {
      const pos = this.findSpotNearPlayer()
      companion.x = pos.x
      companion.y = pos.y
      companion.energy = 0
      companion.hasSpoken = false
      companion.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (m) => this.handleMonsterAttack(m),
      )
      this.monsters.push(companion)
      this.companions.push(companion)
      this.turnManager.addActor(companion)
    }

    const label = { right: 'east', left: 'west', down: 'south', up: 'north' }
    const {cx, cy} = this.worldState
    const realm = (cx === 0 && cy === 1) ? 'Mispelheim' : 'Garden'
    this.messageLog.add(`You travel ${label[fromDir]}.`, '#00c0ff')
    this.statsPanel.setRealm(realm)
    this.endPlayerTurn()
  }

  private undergroundEntryTile(fromDir: 'right'|'left'|'down'|'up'): { x: number; y: number } {
    switch (fromDir) {
      case 'right': // moved right → new cell entered from left border → find exit_left
        for (let y = 1; y < MAP_H - 1; y++)
          if (this.mapSystem.getTile(0, y)?.defId === 'exit_left') return { x: 1, y }
        return { x: 2, y: Math.floor(MAP_H / 2) }
      case 'left': // moved left → entered from right border → find exit_right
        for (let y = 1; y < MAP_H - 1; y++)
          if (this.mapSystem.getTile(MAP_W - 1, y)?.defId === 'exit_right') return { x: MAP_W - 2, y }
        return { x: MAP_W - 3, y: Math.floor(MAP_H / 2) }
      case 'down': // moved down → entered from top border → find exit_up
        for (let x = 1; x < MAP_W - 1; x++)
          if (this.mapSystem.getTile(x, 0)?.defId === 'exit_up') return { x, y: 1 }
        return { x: Math.floor(MAP_W / 2), y: 2 }
      case 'up': // moved up → entered from bottom border → find exit_down
        for (let x = 1; x < MAP_W - 1; x++)
          if (this.mapSystem.getTile(x, MAP_H - 1)?.defId === 'exit_down') return { x, y: MAP_H - 2 }
        return { x: Math.floor(MAP_W / 2), y: MAP_H - 3 }
    }
  }

  private transitionUndergroundCell(dx: number, dy: number, fromDir: 'right'|'left'|'down'|'up'): void {
    this.player.itemVision = false
    this.saveCellSnapshot(this.ugKey())
    this.worldState.goUnderground(dx, dy)

    const savedCompanions = this.companions.slice()
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters   = []
    this.companions = []
    this.floorItems = []
    this.corpses    = []

    this.mapSystem.reset()
    if (!this.tryRestoreFromSnapshot(this.ugKey())) {
      const ugResult = generateUndergroundMap(
        this.mapSystem,
        this.worldState.ucx, this.worldState.ucy, this.worldState.UGRID,
        this.worldState.undergroundSeed,
      )
      this.spawnEntities(ugResult.monsters, ugResult.items)
    }

    const entry = this.undergroundEntryTile(fromDir)
    this.player.x = entry.x
    this.player.y = entry.y

    for (const companion of savedCompanions) {
      const pos = this.findSpotNearPlayer()
      companion.x = pos.x; companion.y = pos.y
      companion.energy = 0; companion.hasSpoken = false
      companion.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (m) => this.handleMonsterAttack(m),
      )
      this.monsters.push(companion)
      this.companions.push(companion)
      this.turnManager.addActor(companion)
    }

    const label = { right: 'east', left: 'west', down: 'south', up: 'north' }
    this.messageLog.add(
      `You move ${label[fromDir]} underground. Cell (${this.worldState.ucx+1},${this.worldState.ucy+1}) of ${this.worldState.UGRID}×${this.worldState.UGRID}`,
      '#a060c0',
    )
    this.statsPanel.setRealm('Hall')
    this.endPlayerTurn()
  }

  private transitionToArea(area: 'bathroom_top' | 'bathroom_bottom' | 'garage_top' | 'garage_bottom' | 'underground' | 'chaos' | 'bedroom' | 'bedroom_lower' | 'stairs' | 'kitchen' | 'cellar' | 'loft' | 'loft3' | 'study' | 'pantry' | 'pond1' | 'pond2' | 'pond3', fromDir?: 'down' | 'up', entryCoord?: number, exactEntry?: { x: number; y: number }): void {
    this.player.itemVision = false
    this.ericChamberEntered = false
    this.traderUnpaid.clear()
    this.localMapView.groundDecorations = []
    this.saveCellSnapshot(this.worldState.currentArea === null ? this.forestKey() : this.areaKey(this.worldState.currentArea))
    const savedCompanions = this.companions.slice()
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters   = []
    this.companions = []
    this.floorItems = []
    this.corpses    = []
    this.mapSystem.reset()

    if (this.worldState.currentArea === null) this.worldState.enterArea(area)
    else this.worldState.currentArea = area
    this.bathroomFlooded = false
    this.bathroomDrained = false

    const result = area === 'bathroom_top'  ? generateBathroomTopMap(this.mapSystem)
      : area === 'bathroom_bottom'          ? generateBathroomBottomMap(this.mapSystem)
      : area === 'garage_top'              ? generateGarageTopMap(this.mapSystem)
      : area === 'garage_bottom'           ? generateGarageBottomMap(this.mapSystem)
      : area === 'chaos'                   ? generateChaosMap(this.mapSystem)
      : area === 'bedroom'                 ? generateBedroomMap(this.mapSystem)
      : area === 'bedroom_lower'           ? generateBedroomLowerMap(this.mapSystem)
      : area === 'stairs'                  ? this.buildStairsSpawnPoints(fromDir === 'up' ? 'bottom' : 'top')
      : area === 'kitchen'                 ? generateKitchenMap(this.mapSystem)
      : area === 'cellar'                ? generateCellarMap(this.mapSystem)
      : area === 'loft'                  ? generateLoftMap(this.mapSystem)
      : area === 'loft3'                 ? generateLoft3Map(this.mapSystem)
      : area === 'study'                 ? generateStudyMap(this.mapSystem)
      : area === 'pantry'               ? generatePantryMap(this.mapSystem)
      : area === 'pond1'                ? generatePond1Map(this.mapSystem)
      : area === 'pond2'                ? generatePond2Map(this.mapSystem)
      : area === 'pond3'                ? generatePond3Map(this.mapSystem)
      :                                      generateUndergroundMap(this.mapSystem, this.worldState.ucx, this.worldState.ucy, this.worldState.UGRID, this.worldState.undergroundSeed)

    if (area === 'pond3') {
      const gongDec = [{ tx: 6, ty: 15, key: 'item_gong' }]
      this.localMapView.groundDecorations = gongDec
      this.worldMapView.groundDecorations = [{ tx: 6, ty: 15, key: 'inv_tool' }]
    } else {
      this.worldMapView.groundDecorations = []
    }

    if (!this.tryRestoreFromSnapshot(this.areaKey(area))) {
      this.spawnEntities(result.monsters, result.items)
    }

    if (area === 'kitchen') {
      const mam = this.monsters.find(m => m.defId === 'mam')
      if (mam && this.worldState.mamHasVase) {
        mam.message = 'La la la la! La la la laaaa!'
      } else if (mam && this.worldState.mamHasOrange) {
        mam.message = 'La la la la! La la laaaa! ...oh, if only I had a blue vase to put these flowers in.'
      }
    }

    const entry = exactEntry
      ?? ((fromDir !== undefined && entryCoord !== undefined)
        ? this.firstEntryTile(fromDir, entryCoord)
        : result.player)
    this.player.x = entry.x
    this.player.y = entry.y

    for (const companion of savedCompanions) {
      const pos = this.findSpotNearPlayer()
      companion.x = pos.x; companion.y = pos.y
      companion.energy = 0; companion.hasSpoken = false
      companion.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (m) => this.handleMonsterAttack(m),
      )
      this.monsters.push(companion)
      this.companions.push(companion)
      this.turnManager.addActor(companion)
    }

    const msg = area === 'bathroom_top'    ? 'You enter the bathroom.'
      : area === 'bathroom_bottom'         ? 'You descend into the bath room.'
      : area === 'garage_top'             ? 'You enter the garage.'
      : area === 'garage_bottom'          ? 'You descend into the lower garage.'
      : area === 'chaos'                  ? "You enter Eric's bedroom."
      : area === 'bedroom'               ? "You step into Mar's bedroom."
      : area === 'bedroom_lower'         ? 'You descend into the lower bedroom.'
      : area === 'stairs'                ? 'You step onto the rainbow staircase!'
      : area === 'kitchen'               ? 'You enter the kitchen.'
      : area === 'cellar'                ? 'Darkness surrounds you.'
      : area === 'loft'                  ? 'You climb up into the loft.'
      : area === 'loft3'                 ? 'You venture deeper into the loft.'
      : area === 'study'                 ? 'You enter the study room.'
      : area === 'pantry'               ? 'You step into the pantry.'
      : area === 'pond1'                ? 'You enter the pond.'
      : area === 'pond2'                ? 'You swim deeper into the underwater caves.'
      : area === 'pond3'                ? 'You descend into the depths.'
      :                                     'You descend underground.'
    this.messageLog.add(msg, area === 'chaos' ? '#ff40ff' : (area === 'bedroom' || area === 'bedroom_lower') ? '#ff80ff' : area === 'stairs' ? '#ffaa00' : area === 'kitchen' ? '#e0c080' : area === 'cellar' ? '#404080' : (area === 'loft' || area === 'loft3') ? '#40c040' : (area === 'pond1' || area === 'pond2' || area === 'pond3') ? '#103060' : '#80c0ff')
    const realm = area === 'bathroom_top' ? 'Bathroom'
      : area === 'bathroom_bottom'        ? 'Bathroom'
      : area === 'garage_top'            ? 'Garage'
      : area === 'garage_bottom'         ? 'Garage'
      : area === 'chaos'                 ? "Eric's bedroom"
      : (area === 'bedroom' || area === 'bedroom_lower') ? 'Bedroom'
      : area === 'stairs'              ? 'Stairs'
      : area === 'kitchen'             ? 'Kitchen'
      : area === 'cellar'              ? 'Cellar'
      : area === 'loft'               ? 'Loft'
      : area === 'loft3'              ? 'Peter and the Wolf'
      : area === 'study'             ? 'Study Room'
      : area === 'pantry'           ? 'Pantry'
      : area === 'pond1'            ? 'Pond'
      : area === 'pond2'            ? 'Underwater Caves'
      : area === 'pond3'            ? 'Pond Depths'
      :                                    'Hall'
    this.statsPanel.setRealm(realm)
    if (area === 'stairs') this.startBombSpawner()
    const type = this.areaType(area)
    if (!this.visitedAreaTypes.has(type)) {
      this.visitedAreaTypes.add(type)
      this.stopAllMusic()
      this.showLocationOverlay(type, () => this.updateMusic(area))
    } else {
      this.updateMusic(area)
    }
    this.endPlayerTurn()
  }

  private saveBathroomFloodState(): void {
    const tiles: Array<{ x: number; y: number }> = []
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (this.mapSystem.getTile(x, y)?.defId === 'water_bath')
          tiles.push({ x, y })
    this.worldState.bathroomFloodTiles = tiles
  }

  private restoreBathroomFloodState(): void {
    for (const { x, y } of this.worldState.bathroomFloodTiles)
      this.mapSystem.setTile(x, y, 'water_bath')
  }

  private forestKey(): string { return `forest_${this.worldState.cx}_${this.worldState.cy}` }
  private ugKey(): string { return `underground_${this.worldState.ucx}_${this.worldState.ucy}` }
  private areaKey(area: string): string {
    return area === 'underground' ? this.ugKey() : `area_${area}`
  }

  private saveCellSnapshot(key: string): void {
    const tiles: Array<{ defId: string; explored: boolean }> = []
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const t = this.mapSystem.getTile(x, y)!
        tiles.push({ defId: t.defId, explored: t.explored })
      }
    const companionIds = new Set(this.companions.map(c => c.id))
    const monsters = this.monsters
      .filter(m => !companionIds.has(m.id))
      .map(m => ({ defId: m.defId, x: m.x, y: m.y, hp: m.hp, message: m.message, hasSpoken: m.hasSpoken, stunTurns: m.stunTurns }))
    const items = this.floorItems.map(fi => ({ x: fi.x, y: fi.y, defId: fi.item.defId, qty: fi.item.quantity }))
    this.worldState.cellSnapshots.set(key, { tiles, monsters, items })
  }

  private tryRestoreFromSnapshot(key: string): boolean {
    const snap = this.worldState.cellSnapshots.get(key)
    if (!snap) return false
    let i = 0
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.mapSystem.getTile(x, y)!
        tile.defId = snap.tiles[i].defId
        tile.explored = snap.tiles[i].explored
        i++
      }
    const defs = new Map<string, MonsterDef>()
    for (const d of monsterData as MonsterDef[]) defs.set(d.id, d)
    for (const ms of snap.monsters) {
      const def = defs.get(ms.defId) ?? (monsterData[0] as MonsterDef)
      const m = new Monster(def, ms.x, ms.y)
      m.hp = ms.hp
      if (ms.message !== undefined) m.message = ms.message
      m.hasSpoken = ms.hasSpoken
      m.stunTurns = ms.stunTurns
      m.setContext(this.mapSystem, this.player, (mx, my) => this.getMonsterAt(mx, my), (monster) => this.handleMonsterAttack(monster))
      m.energy = 0
      m.speed = m.speed * 100
      if (ms.defId === 'secitt') m.onSplit = (mon) => this.spawnSecitt(mon)
      if (ms.defId === 'muddman') m.onAfterMove = (fx, fy) => this.mapSystem.setTile(fx, fy, 'mud')
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }
    for (const it of snap.items)
      this.floorItems.push(new FloorItem(it.x, it.y, this.inventory.createInstance(it.defId, it.qty)))
    return true
  }

  private floodBathroom(): void {
    let tapExists = false
    for (let y = 0; y < MAP_H && !tapExists; y++)
      for (let x = 0; x < MAP_W && !tapExists; x++)
        if (this.mapSystem.getTile(x, y)?.defId === 'kraan') tapExists = true

    if (!tapExists && this.player.inventory.some(i => i.defId === 'stop')) {
      const waterTiles: Array<{ x: number; y: number }> = []
      for (let y = 0; y < MAP_H; y++)
        for (let x = 0; x < MAP_W; x++)
          if (this.mapSystem.getTile(x, y)?.defId === 'water_bath') waterTiles.push({ x, y })
      if (waterTiles.length === 0) {
        if (!this.bathroomDrained) {
          this.bathroomDrained = true
          this.messageLog.add('The bathroom has fully drained.', '#4090d0')
        }
        return
      }
      for (let i = waterTiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[waterTiles[i], waterTiles[j]] = [waterTiles[j], waterTiles[i]]
      }
      for (const { x, y } of waterTiles.slice(0, 2))
        this.mapSystem.setTile(x, y, 'tegel_wit')
      return
    }

    if (!tapExists) return

    const noFlood = new Set(['water_bath', 'bath_exit_up', 'bath_exit_down', 'bath_exit_left', 'kraan', 'vortex_portal'])
    const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]
    const seen = new Set<string>()
    const candidates: Array<{ x: number; y: number }> = []

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.mapSystem.getTile(x, y)?.defId !== 'water_bath') continue
        for (const { dx, dy } of dirs) {
          const nx = x + dx, ny = y + dy
          const t = this.mapSystem.getTile(nx, ny)
          if (!t || !this.mapSystem.isWalkable(nx, ny) || noFlood.has(t.defId)) continue
          const k = `${nx},${ny}`
          if (seen.has(k)) continue
          seen.add(k)
          candidates.push({ x: nx, y: ny })
        }
      }
    }

    if (candidates.length === 0) {
      if (!this.bathroomFlooded) {
        this.bathroomFlooded = true
        this.messageLog.add('The room is completely flooded!', '#4090d0')
      }
      return
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }
    for (const { x, y } of candidates.slice(0, 2))
      this.mapSystem.setTile(x, y, 'water_bath')
  }

  private transitionFromArea(): void {
    this.player.itemVision = false
    this.ericChamberEntered = false
    this.traderUnpaid.clear()
    this.updateMusic(null)
    if (this.worldState.currentArea === 'stairs') this.stopBombSpawner()
    this.saveCellSnapshot(this.areaKey(this.worldState.currentArea!))
    const areaLeft = this.worldState.currentArea
    const savedCompanions = this.companions.slice()
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters   = []
    this.companions = []
    this.floorItems = []
    this.corpses    = []
    this.mapSystem.reset()

    this.worldState.exitArea()

    if (!this.tryRestoreFromSnapshot(this.forestKey())) {
      const { monsters, items } = generateForestMap(
        this.mapSystem, this.worldState.cx, this.worldState.cy, this.worldState,
      )
      this.spawnEntities(monsters, items)
    }
    this.player.x = this.worldState.savedPlayerX
    this.player.y = this.worldState.savedPlayerY

    for (const companion of savedCompanions) {
      const pos = this.findSpotNearPlayer()
      companion.x = pos.x; companion.y = pos.y
      companion.energy = 0; companion.hasSpoken = false
      companion.setContext(
        this.mapSystem, this.player,
        (mx, my) => this.getMonsterAt(mx, my),
        (m) => this.handleMonsterAttack(m),
      )
      this.monsters.push(companion)
      this.companions.push(companion)
      this.turnManager.addActor(companion)
    }

    const leaveMsg = areaLeft?.startsWith('bathroom') ? 'You leave the bathroom.'
      : areaLeft === 'underground' ? 'You climb back to the surface.'
      : areaLeft === 'chaos' ? 'You leave the chaos realm.'
      : areaLeft === 'bedroom' ? "You leave Mar's bedroom."
      : areaLeft === 'stairs' ? 'You survived the staircase.'
      : areaLeft === 'kitchen' ? 'You leave the kitchen.'
      : 'You leave the garage.'
    this.messageLog.add(leaveMsg, '#80c0ff')
    this.statsPanel.setRealm('Garden')
    this.endPlayerTurn()
  }

  // ─── UI ─────────────────────────────────────────────────────────────────────

  private buildUI(): void {
    this.drawPanelBorders()

    this.statsPanel = new StatsPanel(this, STATS_X, STATS_Y, STATS_W, STATS_H)

    this.actionPanel = new ActionPanel(this, BUTTONS_X, BUTTONS_Y, BUTTONS_W, BUTTONS_H)

    this.events.off('btn-action')
    this.events.on('btn-action', (action: string) => {
      const inv = this.inventoryScreen
      const toggleInv = (mode: string) => {
        if (inv.isVisible() && inv.getMode() === mode) { inv.hide(); return }
        inv.show(this.player, mode as Parameters<typeof inv.show>[1])
      }
      switch (action) {
        case 'pack':    inv.isVisible() && inv.getMode() === 'all' ? inv.hide() : this.openInventory(); break
        case 'wear':    toggleInv('wear');   break
        case 'remove':  toggleInv('remove'); break
        case 'wield':   toggleInv('wield');  break
        case 'eat':     toggleInv('eat');    break
        case 'drink':   toggleInv('drink');  break
        case 'mix':     toggleInv('mix');    break
        case 'read':    toggleInv('read');   break
        case 'useitem': toggleInv('use');    break
        case 'throw':   toggleInv('throw');  break
        case 'zap':     this.tryStartZap();  break
        case 'drop':    toggleInv('drop');   break
        case 'pay': {
          if (this.traderUnpaid.size > 0) {
            this.inventoryScreen.show(this.player, 'pay', this.traderUnpaid)
          } else {
            this.messageLog.add('Nothing to pay for.', '#808080')
          }
          break
        }
        case 'pickup':   this.tryPickup();     break
        case 'examine':  toggleInv('examine'); break
        case 'playback': this.messagePanel.scrollUp(); break
        case 'lookat':   this.lookMode ? this.exitLookMode() : this.enterLookMode(); break
        case 'panic':     this.panicOverlay ? this.hidePanic() : this.showPanic(); break
        case 'settings':  this.showSettingsPanel(); break
        case 'quit':      this.showQuitConfirm(); break
        case 'copyright': this.messageLog.add('RAGNAREX version 1.0 (c) Copyright 2026 by Eric Wessels', '#ffff80'); break
        case 'dig':       this.startDig(); break
        case 'self':      this.selfScreen.show(this.player, this.inventory); break
      }
    })

    this.messagePanel = new MessagePanel(this, MSG_X, MSG_Y, MSG_W, MSG_H)
    this.messageLog.onChange(entries => {
      this.messagePanel.setEntries(entries)
      this.statsPanel.update(this.player, this.turnManager.getTurn())
    })

    this.worldMapView = new WorldMapView(
      this, WORLD_MAP_X, WORLD_MAP_Y, WORLD_MAP_W, WORLD_MAP_H, this.mapSystem,
    )
    this.localMapView = new LocalMapView(
      this, LOCAL_MAP_X, LOCAL_MAP_Y, LOCAL_MAP_W, LOCAL_MAP_H, this.mapSystem,
    )

    this.selfScreen = new SelfScreen(this)

    this.inventoryScreen = new InventoryScreen(
      this, this.inventory, this.equipment, this.messageLog,
    )
    this.inventoryScreen.onRead = (item, player) => {
      const def = this.inventory.getDef(item.defId)
      if (!def) return
      const text = def.scrollText ?? def.description
      this.messageLog.add(`You read ${def.name}:`, '#c0c080')
      this.messageLog.add(`"${text}"`, def.relic ? '#ffd080' : '#e0e060')
      if (def.relic) {
        this.messageLog.add('You decide to keep this important looking message.', '#ffd080')
      } else {
        if (item.quantity > 1) {
          item.quantity--
        } else {
          this.inventory.removeFromInventory(player.inventory, item.instanceId)
        }
        this.messageLog.add('The scroll crumbles to dust.', '#808060')
      }
      if (item.defId === 'scroll_teleport') {
        const candidates: { x: number; y: number }[] = []
        for (let ty = 0; ty < this.mapSystem.height; ty++) {
          for (let tx = 0; tx < this.mapSystem.width; tx++) {
            if (this.mapSystem.isWalkable(tx, ty) && this.getMonsterAt(tx, ty) === null
                && !(tx === player.x && ty === player.y)) {
              candidates.push({ x: tx, y: ty })
            }
          }
        }
        if (candidates.length > 0) {
          const pos = candidates[Math.floor(Math.random() * candidates.length)]
          player.x = pos.x
          player.y = pos.y
          this.messageLog.add('You vanish in a flash of light and reappear elsewhere!', '#8080ff')
        }
      }

      if (item.defId === 'scroll_cartography') {
        for (let ty = 0; ty < this.mapSystem.height; ty++) {
          for (let tx = 0; tx < this.mapSystem.width; tx++) {
            const tile = this.mapSystem.getTile(tx, ty)
            if (tile) tile.explored = true
          }
        }
        this.messageLog.add('The layout of this place burns itself into your mind.', '#80c0ff')
      }

      if (item.defId === 'scroll_alliance') {
        player.allianceTurns = 20
        this.messageLog.add('The monsters regard you with sudden kinship. (20 turns)', '#80ff80')
      }

      if (item.defId === 'scroll_transport') {
        this.inventoryScreen.hide()
        this.transitionToArea('pantry')
        return
      }

      if (item.defId === 'scroll_timestop') {
        player.timestopTurns = 5
        this.messageLog.add('Time freezes around you. (5 turns)', '#c0c0ff')
      }

      if (item.defId === 'scroll_twelvegates') {
        const pool = ['snail', 'hagedis', 'egel', 'troll', 'bat', 'rat', 'wilddog', 'wolf', 'ogre', 'spirit', 'muddman', 'pissebed']
        const candidates: { x: number; y: number }[] = []
        for (let ty = 0; ty < this.mapSystem.height; ty++) {
          for (let tx = 0; tx < this.mapSystem.width; tx++) {
            if (this.mapSystem.isWalkable(tx, ty) && this.getMonsterAt(tx, ty) === null
                && !(tx === player.x && ty === player.y)) {
              candidates.push({ x: tx, y: ty })
            }
          }
        }
        candidates.sort((a, b) =>
          (Math.abs(a.x - player.x) + Math.abs(a.y - player.y)) -
          (Math.abs(b.x - player.x) + Math.abs(b.y - player.y))
        )
        const slots = candidates.slice(0, 20)
        const spawnCount = Math.min(12, slots.length)
        for (let i = 0; i < spawnCount; i++) {
          const defId = pool[Math.floor(Math.random() * pool.length)]
          this.spawnEntities([{ x: slots[i].x, y: slots[i].y, defId }], [])
        }
        this.messageLog.add(`${spawnCount} monsters pour through the gates!`, '#ff8040')
      }

      this.inventoryScreen.hide()
      this.endPlayerTurn()
    }

    this.inventoryScreen.onMix = (item1, item2, player) => {
      const def1 = this.inventory.getDef(item1.defId)
      const def2 = this.inventory.getDef(item2.defId)
      if (!def1 || !def2) return

      if (item1.quantity > 1) item1.quantity--
      else this.inventory.removeFromInventory(player.inventory, item1.instanceId)
      if (item2.quantity > 1) item2.quantity--
      else this.inventory.removeFromInventory(player.inventory, item2.instanceId)

      let resultId: string
      if (player.hasSkill('mixing')) {
        const recipe = MIX_RECIPES.find(r =>
          (r.a === item1.defId && r.b === item2.defId) ||
          (r.a === item2.defId && r.b === item1.defId)
        )
        resultId = recipe
          ? recipe.result
          : SKILLED_POOL[Math.floor(Math.random() * SKILLED_POOL.length)]
      } else {
        resultId = 'mystery_potion'
      }

      const result = this.inventory.createInstance(resultId)
      player.inventory.push(result)
      const resultDef = this.inventory.getDef(resultId)
      this.messageLog.add(
        `You mix the ${def1.name} and ${def2.name} into a ${resultDef?.name} potion!`,
        '#AA5500',
      )
      this.inventoryScreen.hide()
      this.endPlayerTurn()
    }

    this.inventoryScreen.onConsume = (item, player) => {
      const def = this.inventory.getDef(item.defId)
      if (!def) return
      if (item.defId === 'second_life_potion') {
        player.secondLife = true
        this.messageLog.add('You feel watched over by divine forces.', '#ffd080')
      } else if (item.defId === 'strength_potion') {
        player.str += 2
        this.messageLog.add('You feel stronger! (STR +2)', '#ff8040')
      } else if (item.defId === 'experience_potion') {
        player.gainXP(100)
        this.messageLog.add('Wisdom floods your mind. (+100 XP)', '#40ff80')
      } else if (item.defId === 'depredation_potion') {
        player.itemVision = true
        for (const fi of this.floorItems) {
          const t = this.mapSystem.getTile(fi.x, fi.y)
          if (t) t.explored = true
        }
        this.messageLog.add('Your senses sharpen. You perceive all nearby items.', '#c0a0ff')
      } else if (item.defId === 'invulnerability_potion') {
        player.hp = player.maxHp
        this.messageLog.add('You feel invulnerable! (HP fully restored)', '#ffff80')
      } else if (item.defId === 'transformation_potion') {
        player.str += 3
        player.maxHp += 20
        player.hp = Math.min(player.maxHp, player.hp + 20)
        this.messageLog.add('Your form shifts. You feel transformed! (STR +3, Max HP +20)', '#40ffff')
      } else if (item.defId === 'speed_potion') {
        player.speed += 100
        this.messageLog.add(`Your feet move like the wind! (Speed +100 → ${player.speed})`, '#ffff40')
      } else if (item.defId === 'phasing_potion') {
        this.messageLog.add('You feel briefly out of phase with reality.', '#8080ff')
      } else if (item.defId === 'blindness_potion') {
        this.messageLog.add('Everything goes dark!', '#200020')
      } else if (item.defId === 'translucence_potion') {
        this.messageLog.add('You can see through your own hands.', '#c0c0ff')
      } else if (item.defId === 'music_potion') {
        this.messageLog.add('Ethereal music fills your mind.', '#ff40ff')
      } else if (item.defId === 'mystery_potion') {
        const poolId = MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)]
        if (poolId === 'strength_potion') {
          player.str += 2
          this.messageLog.add('The Mystery potion tingles. You feel stronger! (STR +2)', '#808080')
        } else if (poolId === 'experience_potion') {
          player.gainXP(100)
          this.messageLog.add('The Mystery potion glows briefly. (+100 XP)', '#808080')
        } else if (poolId === 'depredation_potion') {
          player.itemVision = true
          for (const fi of this.floorItems) {
            const t = this.mapSystem.getTile(fi.x, fi.y)
            if (t) t.explored = true
          }
          this.messageLog.add('The Mystery potion sharpens your senses. You perceive all nearby items.', '#808080')
        } else if (poolId === 'speed_potion') {
          if (player.spriteKey === 'player_pink') {
            player.spriteKey = 'player'
            this.messageLog.add('The Mystery potion fizzes. The pink fades — you feel like yourself again.', '#808080')
          } else {
            player.spriteKey = 'player_pink'
            this.messageLog.add('The Mystery potion fizzes. Your belly turns a vivid pink!', '#ff80c0')
          }
        } else if (poolId === 'phasing_potion') {
          this.messageLog.add('The Mystery potion shimmers. You feel briefly incorporeal.', '#808080')
        } else if (poolId === 'blindness_potion') {
          this.messageLog.add('The Mystery potion stings your eyes. Everything blurs.', '#808080')
        } else if (poolId === 'translucence_potion') {
          this.messageLog.add('The Mystery potion glows. You become harder to see.', '#808080')
        }
      } else if (item.defId === 'banaan') {
        const dmg = 20
        player.hp = Math.max(0, player.hp - dmg)
        this.messageLog.add(`You eat the banana. You feel exploding sensations in your tummy! (-${dmg} HP)`, '#ffee00')
        if (!player.isAlive()) {
          this.lastKilledBy = 'banana poisoning'
          this.inventory.removeFromInventory(player.inventory, item.instanceId)
          this.inventoryScreen.hide()
          this.gameOver(`Killed by eating a banana`)
          return
        }
      } else if (item.defId === 'clay') {
        player.clayProtection = 50
        player.petrifyCountdown = 0
        this.messageLog.add('You eat the clay. Your flesh hardens against petrification.', '#c09060')
      } else if (item.defId === 'mispel') {
        player.drunkTurns = 20
        player.food = Math.max(0, Math.min(player.maxFood, player.food + (def.foodAmount ?? 0)))
        player.hp   = Math.max(0, Math.min(player.maxHp,   player.hp   + (def.healAmount ?? 0)))
        this.messageLog.add('You eat the mispel. Your head starts spinning!', '#c0a0ff')
      } else if (def.type === 'eat') {
        const prevFood = player.food
        const prevHp   = player.hp
        player.food = Math.max(0, Math.min(player.maxFood, player.food + (def.foodAmount ?? 0)))
        player.hp   = Math.max(0, Math.min(player.maxHp,   player.hp   + (def.healAmount ?? 0)))
        const foodDelta = player.food - prevFood
        const hpDelta   = player.hp   - prevHp
        const parts: string[] = []
        if (foodDelta !== 0) parts.push(`${foodDelta > 0 ? '+' : ''}${foodDelta} food`)
        if (hpDelta   !== 0) parts.push(`${hpDelta   > 0 ? '+' : ''}${hpDelta} HP`)
        const suffix = parts.length ? ` (${parts.join(', ')})` : ''
        const harmful = foodDelta < 0 || hpDelta < 0
        const baseMsg = def.eatMessage ?? `You eat the ${def.name}.`
        this.messageLog.add(`${baseMsg}${suffix}`, harmful ? '#ff8040' : '#80c040')
      } else if (def.healAmount) {
        const healed = Math.min(def.healAmount, player.maxHp - player.hp)
        player.hp = Math.min(player.maxHp, player.hp + def.healAmount)
        this.messageLog.add(`You drink the ${def.name}. (+${healed} HP)`, '#ff6060')
      } else {
        this.messageLog.add(`You drink the ${def.name}.`, '#ff6060')
      }
      if (item.quantity > 1) {
        item.quantity--
      } else {
        this.inventory.removeFromInventory(player.inventory, item.instanceId)
      }
      this.inventoryScreen.hide()
      this.endPlayerTurn()
    }

    this.inventoryScreen.onUse = (item, player) => {
      const quest = this.QUEST_TARGETS[item.defId]
      const def = this.inventory.getDef(item.defId)

      if (item.defId === 'tuinschaar') {
        this.inventoryScreen.hide()
        this.trimMode = true
        this.messageLog.add('Trim which tree? (arrow keys, Esc to cancel)', '#80ff80')
        return
      }

      if (item.defId === 'empty_vial') {
        const tile = this.mapSystem.getTile(player.x, player.y)
        const studyPools = ['study_pool', 'study_pool_green', 'study_pool_yellow']
        if (tile && studyPools.includes(tile.defId)) {
          const BASIC_POTIONS = ['health_potion', 'speed_potion', 'phasing_potion', 'depredation_potion', 'strength_potion', 'experience_potion', 'blindness_potion', 'translucence_potion']
          const resultId = BASIC_POTIONS[Math.floor(Math.random() * BASIC_POTIONS.length)]
          this.inventory.removeFromInventory(player.inventory, item.instanceId)
          this.inventory.addToInventory(player.inventory, this.inventory.createInstance(resultId))
          const resultDef = this.inventory.getDef(resultId)
          this.messageLog.add(`You fill the vial. It becomes a ${resultDef?.name ?? resultId}!`, '#80c0ff')
          this.inventoryScreen.hide()
          this.endPlayerTurn()
          return
        }
        this.messageLog.add('You need to stand on a pool to fill the vial.', '#808080')
        this.inventoryScreen.hide()
        return
      }

      if (!quest) {
        this.messageLog.add(`You can't use the ${def?.name ?? item.defId} here.`, '#808080')
        this.inventoryScreen.hide()
        return
      }
      const target = this.monsters.find(m => m.defId === quest.npcId && m.isAlive()) ?? null
      if (!target) {
        this.messageLog.add(`You need to find someone who wants the ${def?.name ?? item.defId}.`, '#808080')
        this.inventoryScreen.hide()
        return
      }
      
      const dist = Math.max(Math.abs(target.x - player.x), Math.abs(target.y - player.y))
      if (dist > 1) {
        this.messageLog.add(`You need to be next to ${target.name} to give this.`, '#808080')
        this.inventoryScreen.hide()
        return
      }
      // Gate: vase requires orange first
      if (item.defId === 'vaas' && !this.worldState.mamHasOrange) {
        this.messageLog.add('Mam is busy coughing. She doesn\'t notice your gift.', '#808080')
        this.inventoryScreen.hide()
        return
      }

      this.inventory.removeFromInventory(player.inventory, item.instanceId)
      this.messageLog.add(quest.message, '#ffd080')
      this.inventoryScreen.hide()

      let questComplete = true

      // Pap rewards mixing skill after receiving all 3 stamps
      if (quest.npcId === 'pap2' && !player.hasSkill('mixing')) {
        const stampIds = ['postzegelRex', 'postzegelStego', 'postzegelStoom']
        const remaining = player.inventory.filter(i => stampIds.includes(i.defId)).length
        if (remaining === 0) {
          player.learnSkill('mixing')
          this.messageLog.add('"You have completed my collection!" Pap teaches you the art of mixing potions.', '#ffd080')
          this.messageLog.add('You learned the skill: Mixing!', '#40ff80')
        } else {
          questComplete = false
        }
      }

      // Mar unlocks the ritual after receiving all 3 fragments
      if (quest.npcId === 'mar_bedroom' && !player.hasSkill('ritual_begun')) {
        const scrollIds = ['relic_scroll_1', 'relic_scroll_2', 'relic_scroll_3']
        const remaining = player.inventory.filter(i => scrollIds.includes(i.defId)).length
        if (remaining === 0) {
          player.learnSkill('ritual_begun')
          this.messageLog.add('Mar: "Thank you, we can now commence the sacrificial ritual."', '#ffd080')
          // Mar steps aside from the doorway into the corridor side
          target.x -= 1
          target.y -= 1
          target.message = 'Enter. The ritual awaits.'
          target.hasSpoken = false
        } else {
          questComplete = false
        }
      }

      if (questComplete) {
        player.gainXP(500)
        this.messageLog.add('Quest complete! (+500 XP)', '#40ff80')
      }

      // Eric teaches swimming when given the widget
      if (quest.npcId === 'eric' && item.defId === 'widget2' && !player.hasSkill('diving')) {
        player.learnSkill('swimming')
        player.learnSkill('diving')
        this.messageLog.add('Eric teaches you his secret swimming technique.', '#ffd080')
        this.messageLog.add('You learned the skill: Swimming!', '#40ff80')
        this.worldState.widgetFound = true
        const mar = this.monsters.find(m => m.defId === 'mar')
        if (mar) { mar.message = "So, what's next?"; mar.hasSpoken = false }
      }

      // Mam quests
      if (quest.npcId === 'mam') {
        if (item.defId === 'sinaasappel') {
          this.worldState.mamHasOrange = true
          this.messageLog.add('You drink the remaining juice. (Max HP +15)', '#ff80c0')
          target.message = 'La laa, la-lala laa, la lala laaaa la lala la la laaa!'
          player.maxHp += 15
          player.hp = Math.min(player.hp + 15, player.maxHp)
          target.hasSpoken = false
        } else if (item.defId === 'vaas') {
          this.worldState.mamHasVase = true
          target.message = 'La, la, la, laa la la laaaaa!'
          target.hasSpoken = false
          player.maxHp += 25
          player.hp = Math.min(player.hp + 25, player.maxHp)
          this.messageLog.add('Mam\'s joy fills your heart. (Max HP +25)', '#ff80c0')
          if (!player.hasSkill('singing')) {
            player.learnSkill('singing')
            this.messageLog.add('Mam teaches you her favourite song.', '#ff80c0')
            this.messageLog.add('You learned the skill: Singing!', '#40ff80')
          }
        }
      }

      // Special post-give effects for the horse
      if (quest.npcId === 'paard') {
        if (item.defId === 'petergras') {
          target.hp = 0
          this.removeMonster(target)
          this.messageLog.add('The horse staggers and collapses. The petergras was poisonous!', '#ff4040')
        } else if (item.defId === 'ericgras') {
          target.aiType = 'follow'
          if (!this.companions.includes(target)) this.companions.push(target)
          this.messageLog.add('The horse nuzzles you warmly. It will follow you from now on!', '#ffd080')
        }
      }

      this.endPlayerTurn()
    }

    this.inventoryScreen.onThrow = (item, _player) => {
      this.pendingThrowItem = item
      this.throwMode = true
      this.inventoryScreen.hide()
      const def = this.inventory.getDef(item.defId)
      this.messageLog.add(`Throw the ${def?.name ?? item.defId} in which direction?`, '#ffaa00')
    }

    this.inventoryScreen.unpaidItems = this.traderUnpaid

    this.inventoryScreen.onDrop = (item, player) => {
      const idx = player.inventory.indexOf(item)
      if (idx === -1) return
      player.inventory.splice(idx, 1)
      this.floorItems.push(new FloorItem(player.x, player.y, item))
      const name = this.inventory.getItemName(item)
      this.messageLog.add(`You drop the ${name}.`, '#c0c0c0')
      if (this.traderUnpaid.has(item.instanceId)) {
        this.traderUnpaid.delete(item.instanceId)
        this.checkTraderDoor()
      }
      this.inventoryScreen.refresh(player)
      this.endPlayerTurn()
    }

    this.inventoryScreen.onPay = (item, player) => {
      const def = this.inventory.getDef(item.defId)
      const price = def?.value ?? 0
      if (player.gold < price) {
        this.messageLog.add(`Not enough gold! ${def?.name ?? item.defId} costs ${price}g.`, '#ff8040')
        this.inventoryScreen.refresh(player)
        return
      }
      player.gold -= price
      this.traderUnpaid.delete(item.instanceId)
      this.messageLog.add(`You pay ${price}g for the ${def?.name ?? item.defId}.`, '#ffd080')
      this.checkTraderDoor()
      if (this.traderUnpaid.size === 0) {
        this.inventoryScreen.hide()
      } else {
        this.inventoryScreen.refresh(player)
      }
      this.endPlayerTurn()
    }

    this.turnManager.onTurn(() => {
      if (this.player.petrified > 0) this.player.petrified--
      if (this.player.clayProtection > 0) this.player.clayProtection--
      if (this.player.allianceTurns > 0) {
        this.player.allianceTurns--
        if (this.player.allianceTurns === 0) {
          this.messageLog.add('The monsters no longer regard you as kin.', '#ff8080')
        }
      }
      if (this.player.petrifyCountdown > 0) {
        this.player.petrifyCountdown--
        if (this.player.petrifyCountdown === 0) {
          this.lastKilledBy = 'petrification'
          this.messageLog.add('Your flesh turns completely to stone.', '#a0a0a0')
          if (this.player.secondLife) {
            this.player.secondLife = false
            this.player.hp = this.player.maxHp
            this.player.petrified = 0
            this.messageLog.add('The Gods decided to give you a second chance.', '#ffd080')
          } else {
            this.gameOver('Turned to stone')
          }
        } else if (this.player.petrifyCountdown <= 5) {
          this.messageLog.add(`Your skin is hardening. Turning to stone in ${this.player.petrifyCountdown} turn${this.player.petrifyCountdown === 1 ? '' : 's'}!`, '#c06040')
        } else if (this.player.petrifyCountdown === 10) {
          this.messageLog.add('Your limbs feel stiff and heavy. (10 turns left)', '#c08060')
        } else if (this.player.petrifyCountdown === 25) {
          this.messageLog.add('Your skin is turning grey. (25 turns left)', '#b0a090')
        } else if (this.player.petrifyCountdown === 50) {
          this.messageLog.add("The Watcher's curse spreads through you. (50 turns left)", '#a0a0a0')
        }
      }
      for (const m of this.monsters) {
        if (m.defId === 'watcher' && m.isAlive() && this.mapSystem.getTile(m.x, m.y)?.visible) {
          if (this.player.equipment.shield?.defId === 'mirrorshield') {
            this.messageLog.add("The Watcher's gaze reflects off your mirror shield!", '#c0e0ff')
            m.hp = Math.max(0, m.hp - 10)
          } else if (this.player.clayProtection > 0) {
            this.messageLog.add("The Watcher's gaze washes over you. The clay protects you.", '#c09060')
          } else if (this.player.petrifyCountdown === 0) {
            this.player.petrifyCountdown = 100
            this.messageLog.add("The Watcher's gaze locks onto you! You will turn to stone in 100 turns!", '#a0a0a0')
          }
        }
        if (m.defId === 'wierdfume' && m.isAlive()) {
          const dist = Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y))
          if (dist <= 1) {
            const roll = Math.floor(Math.random() * 6)
            if (roll === 0) {
              this.player.gender = this.player.gender === 'male' ? 'female' : 'male'
              this.messageLog.add(`The weird fumes warp your form. You are now ${this.player.gender}!`, '#80ff40')
            } else if (roll === 1 && this.player.extraFingers < 2) {
              this.player.extraFingers++
              this.messageLog.add(`The weird fumes mutate you. You grow an extra finger! (${6 + this.player.extraFingers} fingers total)`, '#80ff40')
            }
          }
        }
      }
      if (this.worldState.currentArea === 'stairs') this.advanceBombs()
      this.statsPanel.update(this.player, this.turnManager.getTurn())
      this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
      if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
      this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    })
  }

  private drawPanelBorders(): void {
    const g = this.add.graphics()

    // Dark message log strip spanning full width at bottom
    g.fillStyle(0x101010)
    g.fillRect(MSG_X, MSG_Y, MSG_W, MSG_H)

    // Horizontal dividers
    g.lineStyle(2, 0x606060)
    g.lineBetween(0, WORLD_MAP_H, GAME_W, WORLD_MAP_H)  // world map / panels
    g.lineBetween(0, MSG_Y, GAME_W, MSG_Y)               // panels / message log

    // Vertical dividers between the three panel columns
    g.lineStyle(1, 0x707070)
    g.lineBetween(STATS_W, WORLD_MAP_H, STATS_W, MSG_Y)
    g.lineBetween(BUTTONS_X, WORLD_MAP_H, BUTTONS_X, MSG_Y)
  }

  // ─── Input ──────────────────────────────────────────────────────────────────

  private setupInput(): void {
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'r' && event.ctrlKey) {
        event.preventDefault()
        this.stopAllMusic()
        this.scene.restart()
        return
      }

      if (this.locationOverlay) { this.hideLocationOverlay(); return }

      if (this.inputBlocked) return

      if (event.key === 'Escape') {
        if (this.panicOverlay) { this.hidePanic(); return }
        if (this.selfScreen.isVisible()) { this.selfScreen.hide(); return }
        if (this.lookMode) { this.exitLookMode(); return }
      }

      // Self screen swallows all keys when open
      if (this.selfScreen.isVisible()) return

      // Inventory screen swallows keys when open
      if (this.inventoryScreen.isVisible()) {
        const handled = this.inventoryScreen.handleKey(event, this.player)
        if (handled) return
        // P with item selected = drop
        if ((event.key === 'p' || event.key === 'P') && this.player.inventory.length > 0) {
          this.tryDropSelected()
          this.inventoryScreen.refresh(this.player)
        }
        return
      }

      if (this.trimMode) {
        if (event.key === 'Escape') {
          this.trimMode = false
          this.messageLog.add('Cancelled.', '#808080')
          return
        }
        const trimDirMap: Record<string, [number, number]> = {
          'ArrowUp': [0, -1], '8': [0, -1],
          'ArrowDown': [0, 1], '2': [0, 1],
          'ArrowLeft': [-1, 0], '4': [-1, 0],
          'ArrowRight': [1, 0], '6': [1, 0],
          'Home': [-1, -1], '7': [-1, -1],
          'PageUp': [1, -1], '9': [1, -1],
          'End': [-1, 1], '1': [-1, 1],
          'PageDown': [1, 1], '3': [1, 1],
        }
        const dir = trimDirMap[event.key]
        if (dir) {
          this.trimMode = false
          this.trimTree(dir[0], dir[1])
        }
        return
      }

      if (this.digMode) {
        if (event.key === 'Escape') {
          this.digMode = false
          this.messageLog.add('Cancelled.', '#808080')
          return
        }
        const digDirMap: Record<string, [number, number]> = {
          'ArrowUp': [0, -1], '8': [0, -1],
          'ArrowDown': [0, 1], '2': [0, 1],
          'ArrowLeft': [-1, 0], '4': [-1, 0],
          'ArrowRight': [1, 0], '6': [1, 0],
          'Home': [-1, -1], '7': [-1, -1],
          'PageUp': [1, -1], '9': [1, -1],
          'End': [-1, 1], '1': [-1, 1],
          'PageDown': [1, 1], '3': [1, 1],
        }
        const dir = digDirMap[event.key]
        if (dir) {
          this.startDigging(dir[0], dir[1])
          this.digMode = false
        }
        return
      }

      if (this.digProgress) {
        if (event.key === 'Escape') {
          this.digProgress = null
          this.messageLog.add('You stop digging.', '#808080')
        }
        return
      }

      if (this.throwMode) {
        if (event.key === 'Escape') {
          this.throwMode = false
          this.pendingThrowItem = null
          this.messageLog.add('Cancelled.', '#808080')
          return
        }
        const throwDirMap: Record<string, [number, number]> = {
          'ArrowUp': [0, -1], '8': [0, -1],
          'ArrowDown': [0, 1], '2': [0, 1],
          'ArrowLeft': [-1, 0], '4': [-1, 0],
          'ArrowRight': [1, 0], '6': [1, 0],
          'Home': [-1, -1], '7': [-1, -1],
          'PageUp': [1, -1], '9': [1, -1],
          'End': [-1, 1], '1': [-1, 1],
          'PageDown': [1, 1], '3': [1, 1],
        }
        const dir = throwDirMap[event.key]
        if (dir) {
          this.throwWeapon(this.pendingThrowItem!, dir[0], dir[1])
          this.throwMode = false
          this.pendingThrowItem = null
        }
        return
      }

      if (this.zapMode) {
        if (event.key === 'Escape') {
          this.zapMode = false
          this.messageLog.add('Cancelled.', '#808080')
          return
        }
        const zapDirMap: Record<string, [number, number]> = {
          'ArrowUp': [0, -1], '8': [0, -1],
          'ArrowDown': [0, 1], '2': [0, 1],
          'ArrowLeft': [-1, 0], '4': [-1, 0],
          'ArrowRight': [1, 0], '6': [1, 0],
          'Home': [-1, -1], '7': [-1, -1],
          'PageUp': [1, -1], '9': [1, -1],
          'End': [-1, 1], '1': [-1, 1],
          'PageDown': [1, 1], '3': [1, 1],
        }
        const dir = zapDirMap[event.key]
        if (dir) {
          this.zapRay(dir[0], dir[1])
          this.zapMode = false
        }
        return
      }

      switch (event.key) {
        case 'ArrowUp':    case '8': this.tryMove( 0, -1); break
        case 'ArrowDown':  case '2': this.tryMove( 0,  1); break
        case 'ArrowLeft':  case '4': this.tryMove(-1,  0); break
        case 'ArrowRight': case '6': this.tryMove( 1,  0); break
        case 'Home':     case '7': this.tryMove(-1, -1); break
        case 'PageUp':   case '9': this.tryMove( 1, -1); break
        case 'End':      case '1': this.tryMove(-1,  1); break
        case 'PageDown': case '3': this.tryMove( 1,  1); break
        case 'Enter': this.tryPickup(); break
        case 'i': case 'I': this.openInventory(); break
        case 'w': case 'W': this.inventoryScreen.show(this.player, 'wear');   break
        case 'e': case 'E': this.inventoryScreen.show(this.player, 'eat');    break
        case 'd': case 'D': this.inventoryScreen.show(this.player, 'drink');  break
        case 'r': case 'R': this.inventoryScreen.show(this.player, 'read');   break
        case 'v': case 'V': this.inventoryScreen.show(this.player, 'remove'); break
        case 'h': case 'H': this.inventoryScreen.show(this.player, 'wield');  break
        case 'p': case 'P': this.inventoryScreen.isVisible() && this.inventoryScreen.getMode() === 'drop' ? this.inventoryScreen.hide() : this.inventoryScreen.show(this.player, 'drop'); break
        case 't': case 'T': this.openThrowMenu(); break
        case 'u': case 'U': this.inventoryScreen.show(this.player, 'use'); break
        case 'z': case 'Z': this.tryStartZap(); break
        case 'l': case 'L': this.lookMode ? this.exitLookMode() : this.enterLookMode(); break
        case '.': case '5': this.passTime();   break
      }
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.lookMode || !this.lookCursor) return
      const pos = this.localMapView.getTileAt(pointer.x, pointer.y)
      this.lookCursor.clear()
      if (pos) {
        const { sx, sy } = this.localMapView.getTileScreenPos(pos.tx, pos.ty)
        this.lookCursor.lineStyle(1, 0xffff00, 0.9)
        this.lookCursor.strokeRect(sx, sy, TILE - 1, TILE - 1)
      }
    })

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.lookMode) return
      const pos = this.localMapView.getTileAt(pointer.x, pointer.y)
      if (pos) {
        this.lookAt(pos.tx, pos.ty)
        this.exitLookMode()
      }
    })
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  private tryMove(dx: number, dy: number): void {
    if (this.player.petrified > 0) {
      this.messageLog.add('You are turned to stone! You cannot move.', '#a0a0a0')
      this.endPlayerTurn()
      return
    }
    if (this.player.drunkTurns > 0) {
      const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
      const r = dirs[Math.floor(Math.random() * dirs.length)]
      dx = r[0]
      dy = r[1]
    }
    const standingTile = this.mapSystem.getTile(this.player.x, this.player.y)
    if (standingTile?.defId === 'mud' && this.player.equipment.feet?.defId !== 'rubberboots') {
      if (Math.random() < 0.8) {
        this.messageLog.add('You slip in the mud.', '#8b6040')
        this.endPlayerTurn()
        return
      }
    }
    if (dy > 0 && this.worldState?.currentArea === 'stairs') this.stairsBombFallExtra = 1
    const nx = this.player.x + dx
    const ny = this.player.y + dy

    const monster = this.getMonsterAt(nx, ny)
    if (monster) {
      if (monster.defId === 'mar_bedroom' && !this.player.hasSkill('ritual_begun')) {
        this.messageLog.add('Mar: "I lost three important scrolls, did you find them?"', '#80ff80')
        this.endPlayerTurn()
        return
      }
      if (monster.aiType === 'friendly' || monster.aiType === 'follow') {
        if (monster.message && !monster.hasSpoken) {
          this.messageLog.add(`${monster.name}: "${monster.message}"`, '#80ff80')
          monster.hasSpoken = true
        } else if (monster.defId === 'car') {
          this.messageLog.add(`You don't have the keys.`, '#60c060')
        } else {
          this.messageLog.add(`The ${monster.name} steps aside.`, '#60c060')
          if (monster.defId !== 'paard' && monster.defId !== 'mar_bedroom') {
            monster.x = this.player.x
            monster.y = this.player.y
            this.player.x = nx
            this.player.y = ny
          }
        }
        this.endPlayerTurn()
        return
      }
      if (monster.defId === 'eric_trader') {
        this.messageLog.add('You give Eric the Trader a high five!', '#ffd080')
        this.endPlayerTurn()
        return
      }
      if (monster.aiType === 'flee_on_touch') {
        this.messageLog.add('The guinea pig squeaks and scurries away!', '#c0a060')
        this.guineaPigFlee(monster, () => this.endPlayerTurn())
        return
      }
      if (monster.npc) {
        this.messageLog.add(`You can't attack ${monster.name}.`, '#808080')
        this.endPlayerTurn()
        return
      }
      const result = this.combat.playerAttacks(this.player, monster)
      if (monster.defId === 'cactus' && monster.isAlive()) {
        const thornDmg = 5
        this.player.hp = Math.max(0, this.player.hp - thornDmg)
        this.messageLog.add(`You hurt yourself! (-${thornDmg} HP)`, '#60a040')
        if (!this.player.isAlive()) this.lastKilledBy = 'cactus spines'
      }
      if (result.killed) this.removeMonster(monster)
      this.endPlayerTurn()
      return
    }

    // Map transitions
    const tile = this.mapSystem.getTile(nx, ny)
    const isUnderground = this.worldState.currentArea === 'underground'
    if (tile?.defId === 'exit_right') {
      if (isUnderground) this.transitionUndergroundCell( 1,  0, 'right')
      else this.transitionCell( 1,  0, 'right', this.player.y)
      return
    }
    if (tile?.defId === 'exit_left') {
      if (isUnderground) this.transitionUndergroundCell(-1,  0, 'left')
      else this.transitionCell(-1,  0, 'left',  this.player.y)
      return
    }
    if (tile?.defId === 'exit_down') {
      if (isUnderground) this.transitionUndergroundCell( 0,  1, 'down')
      else this.transitionCell( 0,  1, 'down',  this.player.x)
      return
    }
    if (tile?.defId === 'exit_up') {
      if (isUnderground) this.transitionUndergroundCell( 0, -1, 'up')
      else this.transitionCell( 0, -1, 'up',    this.player.x)
      return
    }
    if (tile?.defId === 'exit_bathroom' || tile?.defId === 'portal') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('bathroom_top')
      return
    }
    if (tile?.defId === 'bath_exit_left') { this.transitionFromArea(); return }
    if (tile?.defId === 'bath_exit_down') { this.transitionToArea('bathroom_bottom', 'down', this.player.x); return }
    if (tile?.defId === 'bath_exit_up')   { this.transitionToArea('bathroom_top',    'up',   this.player.x); return }
    if (tile?.defId === 'stairs_up' && this.worldState.currentArea === 'underground') {
      this.transitionFromArea()
      return
    }
    if (tile?.defId === 'portal_underground') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.worldState.ucx = 0
      this.worldState.ucy = 0
      this.transitionToArea('underground')
      return
    }
    if (tile?.defId === 'portal_chaos') {
      if (this.worldState.currentArea === 'chaos') {
        this.transitionFromArea()
      } else {
        this.worldState.savedPlayerX = this.player.x
        this.worldState.savedPlayerY = this.player.y
        this.transitionToArea('chaos')
      }
      return
    }
    if (tile?.defId === 'portal_garage') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('garage_top')
      return
    }
    if (tile?.defId === 'portal_bedroom') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('bedroom')
      return
    }
    if (tile?.defId === 'bedroom_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'bedroom_stairs_down') {
      this.transitionToArea('bedroom_lower', 'down', this.player.x)
      return
    }
    if (tile?.defId === 'bedroom_stairs_up') {
      this.transitionToArea('bedroom', 'up', this.player.x)
      return
    }
    if (tile?.defId === 'portal_stairs') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('stairs')
      return
    }
    if (tile?.defId === 'portal_stairs_up') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('stairs', 'up')
      return
    }
    if (tile?.defId === 'stairs_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'garage_exit_down') { this.transitionToArea('garage_bottom', 'down', this.player.x); return }
    if (tile?.defId === 'garage_exit_up') {
      if (this.worldState.currentArea === 'garage_top')    { this.transitionFromArea(); return }
      if (this.worldState.currentArea === 'garage_bottom') { this.transitionToArea('garage_top', 'up', this.player.x); return }
    }
    if (tile?.defId === 'portal_cellar') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('cellar')
      return
    }
    if (tile?.defId === 'portal_loft') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('loft')
      return
    }
    if (tile?.defId === 'portal_loft3') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('loft3')
      return
    }
    if (tile?.defId === 'portal_pantry') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('pantry')
      return
    }
    if (tile?.defId === 'pantry_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'portal_study') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('study')
      return
    }
    if (tile?.defId === 'study_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'portal_pond') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('pond1')
      return
    }
    if (tile?.defId === 'pond_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'loft_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'loft3_exit') { this.transitionFromArea(); return }
    if (tile?.defId === 'cellar_exit') { this.transitionToArea('bathroom_bottom'); return }
    if (tile?.defId === 'vortex_portal') {
      if (this.worldState.currentArea === 'cellar') { this.transitionToArea('bathroom_bottom', undefined, undefined, { x: 2, y: 9 }); return }
      if (this.worldState.currentArea === 'bathroom_bottom') { this.transitionToArea('cellar'); return }
    }
    if (tile?.defId === 'pond_exit_right') {
      if (this.worldState.currentArea === 'pond1') { this.transitionToArea('pond2'); return }
      return
    }
    if (tile?.defId === 'pond_exit_down') {
      if (this.worldState.currentArea === 'pond2') { this.transitionToArea('pond3', undefined, undefined, { x: 78, y: 1 }); return }
      return
    }
    if (tile?.defId === 'pond_exit_up') {
      if (this.worldState.currentArea === 'pond3') { this.transitionToArea('pond2', undefined, undefined, { x: 78, y: 18 }); return }
      this.transitionToArea('pond1', undefined, undefined, { x: 77, y: 16 }); return
    }
    if (tile?.defId === 'pond_exit_left') {
      if (this.worldState.currentArea === 'pond2') { this.transitionToArea('pond1', undefined, undefined, { x: 77, y: 16 }); return }
      return
    }

    // Water: requires Diving skill (must first learn Swimming, then Diving)
    if (tile?.defId === 'water' || tile?.defId === 'loft_water') {
      if (this.player.hasSkill('diving')) {
        this.player.x = nx
        this.player.y = ny
        this.endPlayerTurn()
      } else {
        this.messageLog.add(
          this.player.hasSkill('swimming')
            ? 'You can swim but not dive.'
            : 'You cannot swim.',
          '#4080ff',
        )
      }
      return
    }

    if (tile?.defId === 'exit_kitchen') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('kitchen')
      return
    }
    if (tile?.defId === 'exit_garage') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('garage_top')
      return
    }
    if (tile?.defId === 'kitchen_exit') {
      this.worldState.ucx = 0
      this.worldState.ucy = 0
      this.transitionToArea('underground')
      return
    }
    if (tile?.defId === 'kitchen_exit_top') { this.transitionFromArea(); return }

    if (!this.mapSystem.isWalkable(nx, ny) && this.player.phasingTurns <= 0) {
      return
    }

    this.player.x = nx
    this.player.y = ny
    this.endPlayerTurn()
  }

  private checkTraderDoor(): void {
    if (this.traderUnpaid.size === 0) {
      if (this.mapSystem.getTile(54, 11)?.defId === 'muur_down_t') {
        this.mapSystem.setTile(54, 11, 'muur_door_bottom_t')
        this.messageLog.add('The doors open again.', '#c09060')
      }
    }
  }

  private tryPickup(): void {
    const items = this.floorItems.filter(fi => fi.x === this.player.x && fi.y === this.player.y)
    if (items.length === 0) {
      this.messageLog.add('Nothing here to pick up.', '#808080')
      return
    }
    const fi = items[0]
    const def = this.inventory.getDef(fi.item.defId)
    if (fi.item.defId === 'pannenkoek') {
      this.floorItems.splice(this.floorItems.indexOf(fi), 1)
      this.messageLog.add('You add the pancake back to your pile.', '#e0a060')
      this.endPlayerTurn()
      return
    }
    if (def?.type === 'gold') {
      const amount = (def.goldValue ?? 1) * fi.item.quantity
      this.player.gold += amount
      this.messageLog.add(`You pick up ${amount} gold coins.`, '#ffcc00')
    } else {
      this.inventory.addToInventory(this.player.inventory, fi.item)
    }
    this.floorItems.splice(this.floorItems.indexOf(fi), 1)
    const inForestChamber = this.worldState.cx === 1 && this.worldState.cy === 1 &&
        this.worldState.currentArea === null &&
        this.player.x >= 51 && this.player.x <= 57 &&
        this.player.y >= 7 && this.player.y <= 10
    const inTraderChamber = inForestChamber || this.worldState.currentArea === 'pantry'
    if (inTraderChamber) {
      if (def?.type !== 'gold') this.traderUnpaid.add(fi.item.instanceId)
      if (inForestChamber && this.mapSystem.getTile(54, 11)?.defId === 'muur_door_bottom_t') {
        this.mapSystem.setTile(54, 11, 'muur_down_t')
        this.messageLog.add('The doors close.', '#c09060')
      }
    }
    this.endPlayerTurn()
  }

  private tryDrop(): void {
    if (this.player.inventory.length === 0) {
      this.messageLog.add('Your pack is empty.', '#808080')
      return
    }
    const item = this.player.inventory[this.player.inventory.length - 1]
    this.player.inventory.pop()
    this.floorItems.push(new FloorItem(this.player.x, this.player.y, item))
    const name = this.inventory.getItemName(item)
    this.messageLog.add(`You drop the ${name}.`, '#c0c0c0')
    this.endPlayerTurn()
  }

  private tryDropSelected(): void {
    // Drop from inventory screen (last item for now — inventory screen sets selection)
    this.tryDrop()
  }

  private openThrowMenu(): void {
    const hasThrowable = this.player.inventory.some(i => {
      const def = this.inventory.getDef(i.defId)
      return def?.type === 'weapon' || def?.throwable
    })
    if (!hasThrowable) {
      this.messageLog.add('Nothing to throw.', '#808080')
      return
    }
    this.inventoryScreen.show(this.player, 'throw')
  }

  private tryStartZap(): void {
    const remote = this.player.inventory.find(i => i.defId === 'remote')
    if (!remote) {
      this.messageLog.add('You have nothing to zap with.', '#808080')
      return
    }
    this.zapMode = true
    this.messageLog.add('Zap in which direction?', '#ff4080')
  }

  private zapRay(dx: number, dy: number): void {
    const maxDist = Math.min(8, Math.max(1, Math.floor((this.player.str * 2) / 1)))
    let hit = false
    for (let i = 1; i <= maxDist; i++) {
      const nx = this.player.x + dx * i
      const ny = this.player.y + dy * i
      const tile = this.mapSystem.getTile(nx, ny)
      if (!tile || !this.mapSystem.isWalkable(nx, ny)) break
      const monster = this.getMonsterAt(nx, ny)
      if (monster && monster.isAlive()) {
        monster.stunTurns += 3
        this.messageLog.add(`The infrared beam hits the ${monster.name}! (stunned 3 turns)`, '#ff4080')
        hit = true
      }
    }
    if (!hit) this.messageLog.add('The infrared beam dissipates harmlessly.', '#ff4080')
    this.endPlayerTurn()
  }

  private throwWeapon(item: ItemInstance, dx: number, dy: number): void {
    const def = this.inventory.getDef(item.defId)
    if (!def) return

    // Pancakes: throw a single pannenkoek without consuming the stack
    if (item.defId === 'pannenkoeken') {
      const single = this.inventory.createInstance('pannenkoek', 1)
      this.throwWeapon(single, dx, dy)
      return
    }

    if (item.defId === 'banaan') {
      const maxDist = Math.min(8, Math.max(1, Math.floor((this.player.str * 2) / 1)))
      let landX = this.player.x
      let landY = this.player.y
      for (let i = 1; i <= maxDist; i++) {
        const nx = this.player.x + dx * i
        const ny = this.player.y + dy * i
        const tile = this.mapSystem.getTile(nx, ny)
        if (!tile || (!this.mapSystem.isWalkable(nx, ny) && tile.defId !== 'water')) break
        landX = nx
        landY = ny
      }
      this.inventory.removeFromInventory(this.player.inventory, item.instanceId)
      this.messageLog.add('You throw the banana!', '#ffee00')
      this.localMapView.animateThrow(
        'banaan',
        this.player.x, this.player.y,
        landX, landY,
        () => this.bananaExplode(landX, landY, true, () => this.endPlayerTurn()),
      )
      return
    }

    const weight = Math.max(1, def.weight ?? 1)
    const maxDist = Math.min(8, Math.max(1, Math.floor((this.player.str * 2) / weight)))

    this.inventory.removeFromInventory(this.player.inventory, item.instanceId)

    let landX = this.player.x
    let landY = this.player.y

    for (let i = 1; i <= maxDist; i++) {
      const nx = this.player.x + dx * i
      const ny = this.player.y + dy * i
      const tile = this.mapSystem.getTile(nx, ny)
      if (!tile) break

      const isWater = tile.defId === 'water'
      if (!this.mapSystem.isWalkable(nx, ny) && !isWater) break
      if (tile.defId === 'exit_right' || tile.defId === 'exit_left' ||
          tile.defId === 'exit_up'    || tile.defId === 'exit_down') break

      landX = nx
      landY = ny

      const monster = this.getMonsterAt(nx, ny)
      if (monster && (monster.aiType === 'friendly' || monster.aiType === 'follow' || monster.npc)) {
        this.messageLog.add(`You kindly throw the ${def.name} around ${monster.name}.`, '#80c080')
      } else if (monster) {
        if (item.defId === 'pannenkoek') {
          monster.stunTurns = 3
          this.messageLog.add(`The pannenkoek splats over ${monster.name}'s face! (blinded 3 turns)`, '#e0a060')
          landX = nx; landY = ny
          break
        } else if (item.defId === 'mispel') {
          this.messageLog.add(`The mispel splatters on the ${monster.name}!`, '#806040')
          landX = nx; landY = ny
          break
        } else {
          const dmg = Math.max(1, def.damage ?? 1)
          monster.hp = Math.max(0, monster.hp - dmg)
          this.messageLog.add(`The ${def.name} hits the ${monster.name}! (${dmg} dmg)`, '#ff8040')
          if (!monster.isAlive()) {
            this.removeMonster(monster)
            this.messageLog.add(`The ${monster.name} is slain!`, '#ff4040')
          }
        }
      }

      if (isWater) break
    }

    // mispel always disappears after throw (splashes)
    if (item.defId === 'mispel') {
      this.messageLog.add(`You throw the ${def.name}. It splatters and disappears.`, '#806040')
      this.localMapView.animateThrow(
        item.defId,
        this.player.x, this.player.y,
        landX === this.player.x ? this.player.x + dx : landX,
        landY === this.player.y ? this.player.y + dy : landY,
        () => { this.endPlayerTurn() },
      )
      return
    }

    if (landX === this.player.x && landY === this.player.y) {
      this.messageLog.add(`You throw the ${def.name} but it lands at your feet.`, '#c0c0c0')
      this.floorItems.push(new FloorItem(landX, landY, item))
      this.endPlayerTurn()
      return
    }

    this.messageLog.add(`You throw the ${def.name}.`, '#c0c0c0')

    this.localMapView.animateThrow(
      item.defId,
      this.player.x, this.player.y,
      landX, landY,
      () => {
        this.floorItems.push(new FloorItem(landX, landY, item))
        this.endPlayerTurn()
      },
    )
  }

  private bananaExplode(x: number, y: number, spawnSubs: boolean, onDone: () => void): void {
    const dmg = 3
    const monster = this.getMonsterAt(x, y)
    if (monster && monster.isAlive() && !monster.npc) {
      monster.hp = Math.max(0, monster.hp - dmg)
      this.messageLog.add(`Banana explodes on ${monster.name}! (-${dmg} HP)`, '#ffee00')
      if (!monster.isAlive()) {
        this.removeMonster(monster)
        this.messageLog.add(`The ${monster.name} is slain!`, '#ff4040')
      }
    }
    if (!spawnSubs) {
      onDone()
      return
    }
    const allDirs: Array<[number, number]> = [
      [0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1],
    ]
    for (let i = allDirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[allDirs[i], allDirs[j]] = [allDirs[j], allDirs[i]]
    }
    const dirs = allDirs.slice(0, 4)
    this.messageLog.add('The banana splits into 4!', '#ffee00')
    let remaining = dirs.length
    for (const [ddx, ddy] of dirs) {
      this.throwBananaFrom(x, y, ddx, ddy, () => {
        remaining--
        if (remaining === 0) onDone()
      })
    }
  }

  private throwBananaFrom(fromX: number, fromY: number, dx: number, dy: number, onDone: () => void): void {
    let landX = fromX
    let landY = fromY
    for (let i = 1; i <= 5; i++) {
      const nx = fromX + dx * i
      const ny = fromY + dy * i
      const tile = this.mapSystem.getTile(nx, ny)
      if (!tile || (!this.mapSystem.isWalkable(nx, ny) && tile.defId !== 'water')) break
      landX = nx
      landY = ny
    }
    this.localMapView.animateThrow('banaan', fromX, fromY, landX, landY,
      () => this.bananaExplode(landX, landY, false, onDone),
    )
  }


  private guineaPigFlee(monster: Monster, onDone: () => void): void {
    let step = 0
    const doStep = () => {
      monster.fleeStep()
      this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
      step++
      if (step < 3) {
        this.time.delayedCall(120, doStep)
      } else {
        onDone()
      }
    }
    doStep()
  }

  private openInventory(): void {
    this.inventoryScreen.show(this.player)
  }

  private showPanic(): void {
    if (this.panicOverlay) return
    const img = this.add.image(0, 0, 'ui_panic').setOrigin(0, 0)
    img.setDisplaySize(GAME_W, GAME_H)
    img.setDepth(1000)
    img.setInteractive()
    img.on('pointerdown', () => this.hidePanic())
    this.panicOverlay = img
  }

  private hidePanic(): void {
    this.panicOverlay?.destroy()
    this.panicOverlay = null
  }

  private stopAllMusic(): void {
    this.forestMusic?.stop()
    this.loftMusic?.stop()
    this.hallMusic?.stop()
    this.bathroomMusic?.stop()
    this.bedroomMusic?.stop()
    this.pondMusic?.stop()
  }



  private showLocationOverlay(area: string, onDismiss?: () => void): void {
    const key = `loc_${area}`
    if (!this.textures.exists(key)) { onDismiss?.(); return }
    const img = this.add.image(0, 0, key).setOrigin(0, 0)
    img.setDisplaySize(GAME_W, GAME_H)
    img.setDepth(1100)
    img.setInteractive()
    img.on('pointerdown', () => this.hideLocationOverlay())
    this.locationOverlay = img
    this.locationOverlayDismiss = onDismiss ?? null
  }

  private hideLocationOverlay(): void {
    this.locationOverlay?.destroy()
    this.locationOverlay = null
    const cb = this.locationOverlayDismiss
    this.locationOverlayDismiss = null
    cb?.()
  }

  private areaType(area: string): string {
    if (area === 'bathroom_top' || area === 'bathroom_bottom') return 'bathroom'
    if (area === 'garage_top'   || area === 'garage_bottom')   return 'garage'
    if (area === 'bedroom'      || area === 'bedroom_lower')   return 'bedroom'
    if (area === 'loft'         || area === 'loft3')           return 'loft'
    if (area === 'pond1'        || area === 'pond2' || area === 'pond3') return 'pond'
    return area
  }

  private passTime(): void {
    this.messageLog.add('You wait.', '#606060')
    this.endPlayerTurn()
  }

  private hasHeatResistance(): boolean {
    if (this.player.hasSkill('heat_resistance')) return true
    return Object.values(this.player.equipment).some(
      item => item && this.inventory.getDef(item.defId)?.heatResistance === true
    )
  }

  private hasFamineRing(): boolean {
    return Object.values(this.player.equipment).some(item => item?.defId === 'ring_famine')
  }

  // ─── Turn management ────────────────────────────────────────────────────────

  private endPlayerTurn(): void {
    this.updateFOV()
    if (this.player.timestopTurns > 0) {
      this.player.timestopTurns--
      if (this.player.timestopTurns === 0) this.messageLog.add('Time resumes.', '#c0c0ff')
      for (const m of this.monsters) { if (m.isAlive()) m.stunTurns += 2 }
    }
    if (this.player.drunkTurns > 0) {
      this.player.drunkTurns--
      if (this.player.drunkTurns === 0) this.messageLog.add('Your head clears. You are sober again.', '#c0e0ff')
    }
    if (this.player.phasingTurns > 0) {
      this.player.phasingTurns--
      if (this.player.phasingTurns === 0) this.messageLog.add('You feel solid again.', '#c0c0ff')
    }
    this.player.energy -= 100
    if (this.player.energy >= 100) {
      // Player has leftover energy — extra turn before world ticks
      this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
      if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
      this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
      this.statsPanel.update(this.player, this.turnManager.getTurn())
      if (this.inventoryScreen.isVisible()) this.inventoryScreen.refresh(this.player)
      return
    }
    // World ticks until player accumulates enough energy to act again
    while (this.player.energy < 100) {
      this.turnManager.processTurn()
    }
    for (const m of [...this.monsters]) {
      if (!m.isAlive()) this.removeMonster(m)
    }
    const turn = this.turnManager.getTurn()
    if (turn % 3 === 0 && this.player.hp < this.player.maxHp) {
      this.player.hp = Math.min(this.player.hp + 1, this.player.maxHp)
    }
    if (turn % 15 === 0 && this.player.food > 0) {
      this.player.food = Math.max(0, this.player.food - 1)
      if (this.player.food === 0) {
        this.messageLog.add('You are starving to death!', '#ff4000')
        this.player.hp = 0
        this.lastKilledBy = 'starvation'
      }
    }
    if (turn % 5 === 0 && this.player.food > 0 && this.hasFamineRing()) {
      this.player.food = Math.max(0, this.player.food - 1)
      if (this.player.food === 0) {
        this.messageLog.add('You are starving to death!', '#ff4000')
        this.player.hp = 0
        this.lastKilledBy = 'starvation'
      }
    }
    if (this.mapSystem.getTile(this.player.x, this.player.y)?.defId === 'flame' && !this.hasHeatResistance()) {
      this.messageLog.add('The pentagram flames scorch you! (-10 HP)', '#ff4000')
      this.player.hp -= 10
      if (!this.player.isAlive()) this.lastKilledBy = 'pentagram flames'
    }
    if (this.mapSystem.getTile(this.player.x, this.player.y)?.defId === 'lava' && !this.hasHeatResistance()) {
      this.messageLog.add('PAPAPICHOU!!', '#ff0000')
      this.player.hp -= 50
      if (!this.player.isAlive()) this.lastKilledBy = 'lava'
    }
    const legoHere = this.floorItems.find(fi =>
      fi.x === this.player.x && fi.y === this.player.y &&
      this.inventory.getDef(fi.item.defId)?.lego
    )
    if (legoHere) {
      const legoDef = this.inventory.getDef(legoHere.item.defId)
      this.player.hp = Math.max(0, this.player.hp - 1)
      this.messageLog.add(`You step on the ${legoDef?.name ?? 'lego brick'}! OUCH! (-1 HP)`, '#ffff40')
      if (!this.player.isAlive()) this.lastKilledBy = 'lego brick'
    }
    if (this.worldState.currentArea === 'bathroom_bottom') this.floodBathroom()
    if (this.worldState.currentArea === 'chaos') mutateChaosMap(this.mapSystem, this.player.x, this.player.y)
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
    this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    this.statsPanel.update(this.player, turn)
    if (this.inventoryScreen.isVisible()) this.inventoryScreen.refresh(this.player)
    this.checkDuckMessages()
    this.notifyItemsUnderfoot()
    if (!this.ericChamberEntered &&
        ((this.worldState.cx === 1 && this.worldState.cy === 1 &&
          this.worldState.currentArea === null &&
          this.player.x >= 51 && this.player.x <= 57 &&
          this.player.y >= 7 && this.player.y <= 10)
        || this.worldState.currentArea === 'pantry')) {
      this.ericChamberEntered = true
      this.messageLog.add('Eric the trader welcomes you!', '#ffd080')
    }
    if (!this.player.isAlive()) {
      if (this.player.secondLife) {
        this.player.secondLife = false
        this.player.hp = this.player.maxHp
        this.messageLog.add('The Gods decided to give you a second chance.', '#ffd080')
        this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
        if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
        this.statsPanel.update(this.player, this.turnManager.getTurn())
        if (this.inventoryScreen.isVisible()) this.inventoryScreen.refresh(this.player)
      } else {
        this.gameOver(this.lastKilledBy ? `Killed by ${this.lastKilledBy}` : 'Unknown')
      }
    }
    if (this.digProgress && this.player.isAlive()) {
      this.advanceDig()
    }
  }

  private trimTree(dx: number, dy: number): void {
    const tx = this.player.x + dx
    const ty = this.player.y + dy
    const tile = this.mapSystem.getTile(tx, ty)
    if (!tile || (tile.defId !== 'tree' && tile.defId !== 'tree_dead')) {
      this.messageLog.add('There is no tree there to trim.', '#808080')
      return
    }
    this.mapSystem.setTile(tx, ty, 'grass')
    this.messageLog.add('You trim the tree.', '#80ff80')
    this.updateFOV()
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    this.endPlayerTurn()
  }

  private startDig(): void {
    const hasPickaxe = this.player.inventory.some(i => i.defId === 'pickaxe')
    if (!hasPickaxe) {
      this.messageLog.add('You need a pick axe to dig.', '#808080')
      return
    }
    this.digMode = true
    this.messageLog.add('Dig in which direction? (arrow keys, Esc to cancel)', '#c0c0ff')
  }

  private startDigging(dx: number, dy: number): void {
    const tx = this.player.x + dx
    const ty = this.player.y + dy
    const tile = this.mapSystem.getTile(tx, ty)
    const indestructible = ['muur_up_t', 'muur_down_t', 'muur_left_t', 'muur_right_t',
      'muur_corner_tl_t', 'muur_corner_tr_t', 'muur_corner_bl_t', 'muur_corner_br_t']
    if (tile && indestructible.includes(tile.defId)) {
      this.messageLog.add('These walls cannot be destroyed.', '#808080')
      return
    }
    const diggable = ['wall', 'wall_up', 'wall_down', 'wall_left', 'wall_right', 'wall_corner_tl', 'wall_corner_tr', 'wall_corner_bl', 'wall_corner_br', 'tree', 'tree_dead', 'hall_wall', 'kraan']
    if (!tile || !diggable.includes(tile.defId)) {
      this.messageLog.add('There is nothing to dig there.', '#808080')
      return
    }
    this.digProgress = { dx, dy, turnsLeft: 10 }
    this.messageLog.add('You start digging...', '#c0a040')
    this.endPlayerTurn()
  }

  private advanceDig(): void {
    const hostileVisible = this.monsters.some(m => {
      if (m.aiType === 'friendly' || m.aiType === 'follow') return false
      const tile = this.mapSystem.getTile(m.x, m.y)
      return tile?.visible ?? false
    })
    if (hostileVisible) {
      this.digProgress = null
      this.messageLog.add('A monster interrupted your digging!', '#ff8040')
      return
    }

    this.digProgress!.turnsLeft--

    if (this.digProgress!.turnsLeft <= 0) {
      const tx = this.player.x + this.digProgress!.dx
      const ty = this.player.y + this.digProgress!.dy
      const tile = this.mapSystem.getTile(tx, ty)
      const isTree = tile?.defId === 'tree' || tile?.defId === 'tree_dead'
      const isHallWall = tile?.defId === 'hall_wall'
      const isKraan = tile?.defId === 'kraan'
      this.mapSystem.setTile(tx, ty, isTree ? 'grass' : isHallWall ? 'tegel_wit' : isKraan ? 'tegel_bruin' : 'floor')
      this.messageLog.add(isKraan ? 'You smash the tap! The water stops.' : 'You break through!', '#c0ff80')
      this.digProgress = null
      this.updateFOV()
      this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
      if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
      this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    } else {
      this.messageLog.add(`Digging... (${this.digProgress!.turnsLeft} turns left)`, '#c0a040')
      this.time.delayedCall(250, () => {
        if (this.digProgress) this.endPlayerTurn()
      })
    }
  }

  private checkDuckMessages(): void {
    for (const m of this.monsters) {
      if (!m.message || !m.isAlive()) continue
      const adjacent = Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y)) === 1
      if (adjacent && !m.hasSpoken) {
        this.messageLog.add(`${m.name}: "${m.message}"`, '#80ff80')
        m.hasSpoken = true
      } else if (!adjacent) {
        m.hasSpoken = false
      }
    }
  }

  private notifyItemsUnderfoot(): void {
    const here = this.floorItems.filter(fi => fi.x === this.player.x && fi.y === this.player.y)
    if (here.length === 0) return
    for (const fi of here) {
      const def = this.inventory.getDef(fi.item.defId)
      const name = def?.name ?? fi.item.defId
      const qty  = fi.item.quantity > 1 ? ` (${fi.item.quantity})` : ''
      this.messageLog.add(`You see here: ${name}${qty}.`, '#c8a060')
    }
  }

  private updateFOV(): void {
    if (this.worldState.currentArea === 'stairs') return  // always fully visible
    const area = this.worldState.currentArea
    const isGarage = area === 'garage_top' || area === 'garage_bottom'
    const isCellar = area === 'cellar'
    const radius = (isGarage || isCellar) ? 3
      : area === 'pond3' ? 3
      : area === 'pond2' ? 4
      : 5
    this.mapSystem.computeFOV(this.player.x, this.player.y, radius)
  }

  // ─── Monster helpers ────────────────────────────────────────────────────────

  private handleMonsterAttack(monster: Monster): void {
    this.combat.monsterAttacks(monster, this.player)
    if (!this.player.isAlive()) this.lastKilledBy = monster.name
    this.statsPanel.update(this.player, this.turnManager.getTurn())
  }

  private findSpotNearPlayer(): { x: number; y: number } {
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const nx = this.player.x + dx
          const ny = this.player.y + dy
          if (this.mapSystem.isWalkable(nx, ny) && this.getMonsterAt(nx, ny) === null) {
            return { x: nx, y: ny }
          }
        }
      }
    }
    return { x: this.player.x + 1, y: this.player.y }
  }

  private getMonsterAt(x: number, y: number): Monster | null {
    return this.monsters.find(m => m.x === x && m.y === y && m.isAlive()) ?? null
  }

  private removeMonster(monster: Monster): void {
    this.corpses.push({ x: monster.x, y: monster.y })
    this.turnManager.removeActor(monster.id)
    this.monsters   = this.monsters.filter(m => m.id !== monster.id)
    this.companions = this.companions.filter(m => m.id !== monster.id)
    if (monster.xpValue > 0) {
      const def = (monsterData as MonsterDef[]).find(d => d.id === monster.defId)
      if (def?.dropType && Math.random() < 0.5) {
        const pool = this.inventory.getDefsByType(def.dropType)
        if (pool.length > 0) {
          const drop = pool[Math.floor(Math.random() * pool.length)]
          this.floorItems.push(new FloorItem(monster.x, monster.y, this.inventory.createInstance(drop.id)))
        }
      }
    }
  }

  // ─── Look mode ──────────────────────────────────────────────────────────────

  private enterLookMode(): void {
    this.lookMode = true
    this.lookCursor = this.add.graphics().setDepth(50)
    this.messageLog.add('Look mode — click a tile.  L or ESC to cancel.', '#00c0ff')
  }

  private exitLookMode(): void {
    this.lookMode = false
    this.lookCursor?.destroy()
    this.lookCursor = null
  }

  private lookAt(tx: number, ty: number): void {
    const tile = this.mapSystem.getTile(tx, ty)
    if (!tile || !tile.explored) {
      this.messageLog.add('That area is unexplored.', '#606060')
      return
    }

    const def = this.mapSystem.getDef(tile.defId)
    const tileName = def?.name ?? tile.defId

    if (!tile.visible) {
      this.messageLog.add(`You remember: ${tileName}.`, '#808080')
      return
    }

    this.messageLog.add(`Terrain: ${tileName}.`, '#a0c0a0')

    const monster = this.monsters.find(m => m.x === tx && m.y === ty && m.isAlive())
    if (monster) {
      const mdef = (monsterData as MonsterDef[]).find(d => d.id === monster.defId)
      const line = mdef
        ? `${mdef.name} — ${mdef.description}`
        : monster.defId
      this.messageLog.add(line, '#ff8080')
    }

    if (this.corpses.some(c => c.x === tx && c.y === ty)) {
      this.messageLog.add('A slain creature lies here.', '#807050')
    }

    for (const fi of this.floorItems.filter(f => f.x === tx && f.y === ty)) {
      if (fi.item.defId === 'petergras') {
        this.messageLog.add('Petergras died just by looking at it.', '#808060')
        this.floorItems = this.floorItems.filter(f => f !== fi)
        this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
        continue
      }
      const idef = this.inventory.getDef(fi.item.defId)
      const line = idef
        ? `${idef.name} — ${idef.description}`
        : fi.item.defId
      this.messageLog.add(line, '#ffcc80')
    }
  }

  // ─── Game over ──────────────────────────────────────────────────────────────

  private cellName(): string {
    const names: Record<string, string> = {
      '0,0': 'The Lake Forest',
      '1,0': 'The Northern Plains',
      '2,0': 'The Sandy Wastes',
      '0,1': 'The Western Woods',
      '1,1': 'The Heartlands',
      '2,1': 'The Eastern Reaches',
      '0,2': 'The Kitchen Quarter',
      '1,2': 'The Southern Halls',
      '2,2': 'The Far South',
    }
    const key = `${this.worldState.cx},${this.worldState.cy}`
    return names[key] ?? `World (${this.worldState.cx + 1},${this.worldState.cy + 1})`
  }

  private collectSaveData(): GameSaveData {
    const currentKey = this.worldState.currentArea !== null
      ? this.areaKey(this.worldState.currentArea)
      : this.forestKey()
    this.saveCellSnapshot(currentKey)
    const snapshots: GameSaveData['cellSnapshots'] = {}
    for (const [k, v] of this.worldState.cellSnapshots) snapshots[k] = v
    return {
      version: 2,
      turn: this.turnManager.getTurn(),
      player: {
        x: this.player.x, y: this.player.y, name: this.player.name, gender: this.player.gender,
        hp: this.player.hp, maxHp: this.player.maxHp, str: this.player.str, mag: this.player.mag,
        food: this.player.food, maxFood: this.player.maxFood, exp: this.player.exp,
        con: this.player.con, luck: this.player.luck, gold: this.player.gold, level: this.player.level,
        secondLife: this.player.secondLife, spriteKey: this.player.spriteKey,
        petrified: this.player.petrified, petrifyCountdown: this.player.petrifyCountdown,
        clayProtection: this.player.clayProtection, extraFingers: this.player.extraFingers,
        extraEyes: this.player.extraEyes, race: this.player.race, playerClass: this.player.playerClass,
        morality: this.player.morality, diagnostics: [...this.player.diagnostics],
        inventory: this.player.inventory.map(i => ({ ...i })),
        equipment: JSON.parse(JSON.stringify(this.player.equipment)),
        skills: [...this.player.skills],
      },
      worldState: {
        cx: this.worldState.cx, cy: this.worldState.cy,
        ucx: this.worldState.ucx, ucy: this.worldState.ucy,
        currentArea: this.worldState.currentArea,
        savedCx: this.worldState.savedCx, savedCy: this.worldState.savedCy,
        savedPlayerX: this.worldState.savedPlayerX, savedPlayerY: this.worldState.savedPlayerY,
        mamHasOrange: this.worldState.mamHasOrange, mamHasVase: this.worldState.mamHasVase, widgetFound: this.worldState.widgetFound,
      },
      currentMapKey: currentKey,
      cellSnapshots: snapshots as GameSaveData['cellSnapshots'],
    }
  }

  private restoreFromSave(data: GameSaveData): void {
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters = []; this.companions = []; this.floorItems = []; this.corpses = []
    this.turnManager.reset()

    const p = data.player
    this.player.x = p.x; this.player.y = p.y; this.player.name = p.name; this.player.gender = p.gender
    this.player.hp = p.hp; this.player.maxHp = p.maxHp; this.player.str = p.str; this.player.mag = p.mag
    this.player.food = p.food; this.player.maxFood = p.maxFood; this.player.exp = p.exp
    this.player.con = p.con; this.player.luck = p.luck; this.player.gold = p.gold; this.player.level = p.level
    this.player.secondLife = p.secondLife; this.player.spriteKey = p.spriteKey
    this.player.petrified = p.petrified; this.player.petrifyCountdown = p.petrifyCountdown
    this.player.clayProtection = p.clayProtection; this.player.extraFingers = p.extraFingers
    this.player.extraEyes = p.extraEyes; this.player.race = p.race; this.player.playerClass = p.playerClass
    this.player.morality = p.morality; this.player.diagnostics = [...p.diagnostics]
    this.player.inventory = p.inventory.map(i => ({ ...i }))
    this.player.equipment = JSON.parse(JSON.stringify(p.equipment))
    this.player.skills = new Set(p.skills)
    this.turnManager.addActor(this.player)
    this.turnManager.setTurn(data.turn)

    const ws = data.worldState
    this.worldState.cx = ws.cx; this.worldState.cy = ws.cy
    this.worldState.ucx = ws.ucx; this.worldState.ucy = ws.ucy
    this.worldState.currentArea = ws.currentArea
    this.worldState.savedCx = ws.savedCx; this.worldState.savedCy = ws.savedCy
    this.worldState.savedPlayerX = ws.savedPlayerX; this.worldState.savedPlayerY = ws.savedPlayerY
    this.worldState.mamHasOrange = ws.mamHasOrange; this.worldState.mamHasVase = ws.mamHasVase; this.worldState.widgetFound = ws.widgetFound ?? false

    this.worldState.cellSnapshots.clear()
    for (const [k, v] of Object.entries(data.cellSnapshots)) this.worldState.cellSnapshots.set(k, v)

    this.mapSystem.reset()
    this.tryRestoreFromSnapshot(data.currentMapKey)

    if (!this.worldState.currentArea && this.worldState.cx === 0 && this.worldState.cy === 0 && this.worldState.widgetFound) {
      const mar = this.monsters.find(m => m.defId === 'mar')
      if (mar && !mar.message) { mar.message = "So, what's next?"; mar.hasSpoken = false }
    }

    const areaRealm: Record<string, string> = {
      bathroom_top: 'Bathroom', bathroom_bottom: 'Bathroom',
      garage_top: 'Garage', garage_bottom: 'Garage',
      underground: 'Hall', chaos: "Eric's bedroom",
      bedroom: 'Bedroom', bedroom_lower: 'Bedroom',
      stairs: 'Stairs', kitchen: 'Kitchen',
    }
    const realm = ws.currentArea ? (areaRealm[ws.currentArea] ?? ws.currentArea) : 'Garden'

    this.updateFOV()
    this.worldMapView.render(this.player, this.monsters, this.floorItems, ws.currentArea === 'garage_top' || ws.currentArea === 'garage_bottom', ws.currentArea === 'stairs')
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    this.statsPanel.update(this.player, this.turnManager.getTurn())
    this.statsPanel.setRealm(realm)
    this.updateMusic(ws.currentArea)
    this.messageLog.add('Game restored. Welcome back, ' + p.name + '!', '#50c0ff')
    this.inputBlocked = false
  }

  private showContinueDialog(): void {
    this.inputBlocked = true
    const bx = GAME_W / 2, by = GAME_H / 2
    const box = this.add.graphics()
      .fillStyle(0x1a1a1a, 0.95).fillRect(bx - 260, by - 80, 520, 160).setDepth(500)
    const title = this.add.text(bx, by - 35, 'Continue saved game?', {
      fontSize: '26px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)
    const contBtn = this.add.text(bx - 110, by + 30, '[C]  Continue', {
      fontSize: '24px', color: '#50c0ff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })
    const newBtn = this.add.text(bx + 110, by + 30, '[N]  New game', {
      fontSize: '24px', color: '#ffaa44', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })
    const cleanup = () => {
      box.destroy(); title.destroy(); contBtn.destroy(); newBtn.destroy()
      this.input.keyboard!.off('keydown-C', cont)
      this.input.keyboard!.off('keydown-N', newGame)
      this.input.keyboard!.off('keydown-ESC', newGame)
    }
    const cont = () => {
      cleanup()
      const save = this.saveSystem.loadGame()
      if (save) this.restoreFromSave(save)
      else this.inputBlocked = false
    }
    const newGame = () => {
      cleanup()
      this.saveSystem.deleteGame()
      this.inputBlocked = false
    }
    contBtn.on('pointerdown', cont); newBtn.on('pointerdown', newGame)
    this.input.keyboard!.on('keydown-C', cont)
    this.input.keyboard!.on('keydown-N', newGame)
    this.input.keyboard!.on('keydown-ESC', newGame)
  }

  private showSettingsPanel(): void {
    this.inputBlocked = true
    const bx = GAME_W / 2
    const by = GAME_H / 2

    const box = this.add.graphics()
      .fillStyle(0x1a1a1a, 0.95)
      .fillRect(bx - 270, by - 110, 540, 220)
      .setDepth(500)

    const title = this.add.text(bx, by - 70, 'Settings', {
      fontSize: '28px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)

    const label = this.add.text(bx - 210, by - 15, 'Music volume', {
      fontSize: '18px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setDepth(501)

    const trackX = bx - 210
    const trackY = by + 30
    const trackW = 420
    const trackH = 6

    const trackBg = this.add.graphics().setDepth(501)
      .fillStyle(0x444444).fillRect(trackX, trackY - trackH / 2, trackW, trackH)

    const trackFill = this.add.graphics().setDepth(501)
    const handle    = this.add.graphics().setDepth(502)

    const drawSlider = (vol: number) => {
      trackFill.clear().fillStyle(0x50c0ff)
        .fillRect(trackX, trackY - trackH / 2, trackW * vol, trackH)
      handle.clear().fillStyle(0xffffff)
        .fillCircle(trackX + trackW * vol, trackY, 10)
    }
    drawSlider(this.musicVolume)

    const zone = this.add.zone(trackX, trackY - 15, trackW, 30)
      .setOrigin(0, 0).setDepth(502).setInteractive()

    let dragging = false
    const updateVol = (px: number) => {
      const vol = Phaser.Math.Clamp((px - trackX) / trackW, 0, 1)
      this.musicVolume = vol
      drawSlider(vol)
      for (const m of [this.forestMusic, this.loftMusic, this.hallMusic, this.bathroomMusic, this.bedroomMusic, this.pondMusic]) {
        if (m) (m as Phaser.Sound.WebAudioSound).setVolume(vol)
      }
    }

    const onMove = (ptr: Phaser.Input.Pointer) => { if (dragging) updateVol(ptr.x) }
    const onUp   = () => { dragging = false }

    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => { dragging = true; updateVol(ptr.x) })
    this.input.on('pointermove', onMove)
    this.input.on('pointerup',   onUp)

    const closeBtn = this.add.text(bx, by + 80, '[Esc]  Close', {
      fontSize: '22px', color: '#50c050', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })

    const cleanup = () => {
      box.destroy(); title.destroy(); label.destroy()
      trackBg.destroy(); trackFill.destroy(); handle.destroy(); zone.destroy()
      closeBtn.destroy()
      this.input.off('pointermove', onMove)
      this.input.off('pointerup',   onUp)
      this.input.keyboard!.off('keydown-ESC', close)
      this.inputBlocked = false
    }
    const close = () => cleanup()

    closeBtn.on('pointerdown', close)
    this.input.keyboard!.on('keydown-ESC', close)
  }

  private showQuitConfirm(): void {
    this.inputBlocked = true

    const bx = GAME_W / 2
    const by = GAME_H / 2
    const box = this.add.graphics()
      .fillStyle(0x1a1a1a, 0.95)
      .fillRect(bx - 320, by - 120, 640, 250)
      .setDepth(500)

    const title = this.add.text(bx, by - 70, 'Give up and face defeat?', {
      fontSize: '28px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)

    const saveBtn = this.add.text(bx, by - 15, '[S]  Save & continue later', {
      fontSize: '24px', color: '#50c0ff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })

    const yesBtn = this.add.text(bx - 140, by + 55, '[Y]  Yes, I give up', {
      fontSize: '24px', color: '#ff5050', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })

    const noBtn = this.add.text(bx + 140, by + 55, '[N]  Keep fighting', {
      fontSize: '24px', color: '#50c050', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501).setInteractive({ useHandCursor: true })

    const cleanup = () => {
      box.destroy(); title.destroy(); saveBtn.destroy(); yesBtn.destroy(); noBtn.destroy()
      this.input.keyboard!.off('keydown-S', save)
      this.input.keyboard!.off('keydown-Y', yes)
      this.input.keyboard!.off('keydown-N', no)
      this.input.keyboard!.off('keydown-ESC', no)
    }

    const save = () => {
      cleanup()
      this.saveSystem.saveGame(this.collectSaveData())
      this.messageLog.add('Game saved! Your journey continues another day.', '#50c0ff')
      this.inputBlocked = false
    }
    const yes = () => { cleanup(); this.gameOver(`Gave up`) }
    const no  = () => { cleanup(); this.inputBlocked = false }

    saveBtn.on('pointerdown', save)
    yesBtn.on('pointerdown', yes)
    noBtn.on('pointerdown', no)
    this.input.keyboard!.on('keydown-S', save)
    this.input.keyboard!.on('keydown-Y',   yes)
    this.input.keyboard!.on('keydown-N',   no)
    this.input.keyboard!.on('keydown-ESC', no)
  }

  private gameOver(cause?: string): void {
    this.inputBlocked = true
    this.stopAllMusic()

    const lb = new LeaderboardSystem()
    const AREA_NAMES: Record<string, string> = {
      bathroom_top: 'Bathroom', bathroom_bottom: 'Deep Bathroom',
      garage_top: 'Garage', garage_bottom: 'Lower Garage',
      underground: 'Underground', chaos: "Eric's bedroom",
      bedroom: "Mar's Bedroom", stairs: 'Rainbow Stairs',
    }
    const area = this.worldState.currentArea
    const level = area ? (AREA_NAMES[area] ?? area) : this.cellName()
    const entries = lb.addEntry({
      name:  this.player.name,
      score: this.player.exp,
      level,
      hp:    this.player.hp,
      maxHp: this.player.maxHp,
      cause: cause ?? 'Unknown',
    })

    // Full-screen defeat image
    this.add.image(GAME_W / 2, GAME_H / 2, 'ui_defeat')
      .setDisplaySize(GAME_W, GAME_H)
      .setDepth(200)

    // Dark overlay for text legibility
    this.add.graphics()
      .fillStyle(0x000000, 0.55)
      .fillRect(0, 0, GAME_W, GAME_H)
      .setDepth(201)

    // Leaderboard title
    this.add.text(GAME_W / 2, 60, 'HALL OF DEFEAT', {
      fontSize: '40px', color: '#c8a000', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(202)

    // Column positions
    const CX = { rank: 220, score: 390, name: 415, world: 650, hp: 870, cause: 970 }
    const col = (x: number, y: number, text: string, color: string, rightAlign = false) =>
      this.add.text(x, y, text, { fontSize: '22px', color, fontFamily: 'monospace' })
        .setOrigin(rightAlign ? 1 : 0, 0).setDepth(202)

    // Column headers
    col(CX.rank,  120, '#',     '#888888')
    col(CX.score, 120, 'SCORE', '#888888', true)
    col(CX.name,  120, 'NAME',  '#888888')
    col(CX.world, 120, 'WORLD', '#888888')
    col(CX.hp,    120, 'HP',    '#888888')
    col(CX.cause, 120, 'CAUSE', '#888888')

    // Entries — top 15, or top 10 + dots + player context
    const playerScore = this.player.exp
    const playerName  = this.player.name
    const playerCause = cause ?? 'Unknown'
    const playerIdx   = entries.findIndex(
      e => e.score === playerScore && e.name === playerName && e.cause === playerCause
    )

    type DisplayRow = { entry: LeaderboardEntry; rank: number } | 'dots'
    const rows: DisplayRow[] = []

    if (playerIdx < 15) {
      entries.slice(0, 15).forEach((e, i) => rows.push({ entry: e, rank: i + 1 }))
    } else {
      entries.slice(0, 10).forEach((e, i) => rows.push({ entry: e, rank: i + 1 }))
      rows.push('dots')
      const start = Math.max(10, playerIdx - 2)
      const end   = Math.min(entries.length - 1, playerIdx + 2)
      for (let i = start; i <= end; i++) rows.push({ entry: entries[i], rank: i + 1 })
    }

    rows.forEach((row, i) => {
      const y = 158 + i * 36
      if (row === 'dots') { col(CX.rank, y, '...', '#888888'); return }
      const { entry: e, rank } = row
      const isPlayer = rank === playerIdx + 1
      const style = isPlayer ? 'bold' : 'normal'
      const tint = (c: string) => isPlayer ? '#ff4040' : c
      const addText = (x: number, text: string, color: string, rightAlign = false) =>
        this.add.text(x, y, text, { fontSize: '22px', color: tint(color), fontFamily: 'monospace', fontStyle: style })
          .setOrigin(rightAlign ? 1 : 0, 0).setDepth(202)
      addText(CX.rank,  `#${rank}`,           '#e0e0e0')
      addText(CX.score, String(e.score),      '#ffcc00', true)
      addText(CX.name,  e.name,               '#e0e0e0')
      addText(CX.world, e.level,              '#80c0ff')
      addText(CX.hp,    `${e.hp}/${e.maxHp}`, '#ff8080')
      addText(CX.cause, e.cause ?? '—',       '#c0c080')
    })

    // Restart prompt
    this.add.text(GAME_W / 2, GAME_H - 50, 'Press R to try again', {
      fontSize: '30px', color: '#ff4040', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(202)

    this.input.keyboard!.once('keydown-R', () => this.scene.restart())
  }
}
