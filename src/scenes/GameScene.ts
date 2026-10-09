import Phaser from 'phaser'
import { MapSystem } from '../engine/MapSystem'
import { TurnManager } from '../engine/TurnManager'
import { MessageLog } from '../engine/MessageLog'
import { CombatSystem, playerHitChance } from '../engine/CombatSystem'
import { InventorySystem, REMOTE_CHARGES, BAD_SPECULAAS_CHANCE, itemDamage, itemValue, rollWandCharges } from '../engine/InventorySystem'
import { EquipmentSystem } from '../engine/EquipmentSystem'
import { SaveSystem } from '../engine/SaveSystem'
import type { GameSaveData } from '../engine/SaveSystem'
import { LeaderboardSystem } from '../engine/LeaderboardSystem'
import type { LeaderboardEntry } from '../engine/LeaderboardSystem'
import { generateForestMap, generateBathroomTopMap, generateBathroomBottomMap, generateGarageTopMap, generateGarageBottomMap, generateHallMap, generateChaosMap, mutateChaosMap, chaosPartyArea, chaosPartyRing, generateBedroomMap, generateBedroomLowerMap, generateKitchenMap, generateTubEnclosureMap, generateLoftMap, generateLoft3Map, generateStudyMap, generateLoftStairsMap, generatePantryMap, generatePond1Map, generatePond2Map, generatePond3Map, generateDrivewayMap, generateUpperHallMap, peterPatrolLoop, type SpawnPoints } from '../engine/MapGenerator'
import { WorldState, type ClarinetLocation } from '../engine/WorldState'
import { placeSingleItemRandomly, isSpecialTile, pickAreaItem, EXCLUDE_IDS, isHiddenUnderWater } from '../engine/ItemPlacement'
import { AREA_MONSTERS, areaInfo } from '../engine/SpawnTables'
import { Player } from '../entities/Player'
import { Monster } from '../entities/Monster'
import { FloorItem } from '../entities/FloorItem'
import { StatsPanel } from '../ui/StatsPanel'
import { ActionPanel } from '../ui/ActionPanel'
import { MessagePanel } from '../ui/MessagePanel'
import { WorldMapView } from '../ui/WorldMapView'
import { LocalMapView } from '../ui/LocalMapView'
import { InventoryScreen, sellPrice } from '../ui/InventoryScreen'
import { SelfScreen } from '../ui/SelfScreen'
import { SkillScreen, SKILL_LIST } from '../ui/SkillScreen'
import { QuestScreen } from '../ui/QuestScreen'
import { TravellersLog } from '../ui/TravellersLog'
import {
  GAME_W, GAME_H, TILE,
  STATS_X, STATS_Y, STATS_W, STATS_H,
  BUTTONS_X, BUTTONS_Y, BUTTONS_W, BUTTONS_H,
  LOCAL_MAP_X, LOCAL_MAP_Y, LOCAL_MAP_W, LOCAL_MAP_H,
  MSG_X, MSG_Y, MSG_W, MSG_H,
  WORLD_MAP_X, WORLD_MAP_Y, WORLD_MAP_W, WORLD_MAP_H,
} from '../ui/Layout'
import monsterData from '../data/monsters.json'
import itemData from '../data/items.json'
import type { ItemInstance, ItemDef, MonsterDef } from '../types'

import { MIX_RECIPES, SKILLED_POOL, MYSTERY_POOL, POWERFUL_MONSTER_IDS } from '../data/mixRecipes'

const MAP_W = 80
const MAP_H = 20

// Where a new game starts in the top-left garden cell (room 4's centre, see generateForestMap)
const GARDEN_START = { x: 68, y: 5 }

const LEGO_DAMAGE = 3
// Deep water: only divers, or anyone floating on a Gompie, can move over it
const WATER_TILES = new Set(['water', 'loft_water', 'water_bath'])
// Chance that you spring your own Clothespin Trap when stepping on it (anyone else always does)
const OWN_TRAP_CHANCE = 0.1

// Each juicy fish given to Lex buys this many extra turns; a warning shows every interval.
const LEX_FISH_BONUS_TURNS = 300
const TIME_WARNING_INTERVAL = 5000
const SUMMON_INTERVAL = 5

// TESTING: put one of every item from items.json in the player's inventory on a new game. Set to false before release.
const TEST_ALL_ITEMS = false

// Start screen splash shows once per page load (not on restart after victory/death)
let startScreenShown = false

// Upper hall arrows and the matching arrow back from each room
const UPPER_HALL_LINKS = [
  { hall: 'upper_hall_left',  hallTile: 'upper_hall_exit_chaos',    room: 'chaos',         roomTile: 'chaos_exit_upper_hall' },
  { hall: 'upper_hall_left',  hallTile: 'upper_hall_exit_bathroom', room: 'bathroom_top',  roomTile: 'bath_exit_upper_hall' },
  { hall: 'upper_hall_right', hallTile: 'upper_hall_exit_study',    room: 'study',         roomTile: 'study_exit_upper_hall' },
  { hall: 'upper_hall_right', hallTile: 'upper_hall_exit_mar',      room: 'bedroom_lower', roomTile: 'mar_exit_upper_hall' },
] as const

// Dug map-edge arrow → the arrow placed on the next map's facing edge
const DUG_EXIT_BACK: Record<string, string> = {
  exit_right: 'exit_left', exit_left: 'exit_right', exit_down: 'exit_up', exit_up: 'exit_down',
  pond_exit_right: 'pond_exit_left', pond_exit_left: 'pond_exit_right',
  pond_exit_down: 'pond_exit_up', pond_exit_up: 'pond_exit_down',
}

type Side = 'left' | 'right' | 'up' | 'down'
type EdgeEnd = { area: 'garage_top' | 'garage_bottom' | 'kitchen' | 'hall' | 'study' | 'bedroom_lower'; side: Side }

// Map edges without an arrow that still lead next door when dug, tunnelled or
// phased through (both ways). The hall end is always its top-left cell.
const EDGE_LINKS: Array<[EdgeEnd, EdgeEnd]> = [
  [{ area: 'garage_top',    side: 'right' }, { area: 'kitchen',       side: 'left' }],
  [{ area: 'garage_bottom', side: 'right' }, { area: 'hall',          side: 'left' }],
  [{ area: 'study',         side: 'left'  }, { area: 'bedroom_lower', side: 'right' }],
]

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
  // Companions waiting outside the pond levels (see bringCompanions)
  private parkedCompanions: Monster[] = []
  private floorItems: FloorItem[] = []
  private corpses: Array<{ x: number; y: number }> = []

  private statsPanel!: StatsPanel
  private actionPanel!: ActionPanel
  private messagePanel!: MessagePanel
  private worldMapView!: WorldMapView
  private localMapView!: LocalMapView
  private inventoryScreen!: InventoryScreen
  private selfScreen!: SelfScreen
  private skillScreen!: SkillScreen
  private questScreen!: QuestScreen
  private travellersLog!: TravellersLog

  // Cheats, toggled by typing a secret code in the quest screen
  private godMode = false
  private cheatItemIds: string[] = []
  private cheatSkillIds: string[] = []

  private inputBlocked = false
  private phoneOverlay: Phaser.GameObjects.Image | null = null
  private phoneHangUpReady = false
  private phoneSound: Phaser.Sound.BaseSound | null = null
  // Sas leading the player by the hand to the dead horse (no player control meanwhile)
  private sasWalk: { sas: Monster; lex: Monster | null; path: Array<{ x: number; y: number }>; onDriveway: boolean } | null = null
  private werewolfMoveScheduled = false
  private lookMode = false
  private teleportPicking = false
  private teleportPickReady = false
  private lastKilledBy: string | null = null
  private bathroomFlooded = false
  private bathroomDrained = false

  private readonly QUEST_TARGETS: Record<string, { npcId: string; message: string }> = {
    relic_scroll_1: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    relic_scroll_2: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    relic_scroll_3: { npcId: 'mar_bedroom', message: 'Mar takes the ancient fragment, eyes wide with wonder.' },
    postzegelRex:   { npcId: 'pap2',  message: 'Dad excitedly adds the Rex stamp to his collection!' },
    postzegelStego: { npcId: 'pap2',  message: 'Dad excitedly adds the Stego stamp to his collection!' },
    postzegelStoom: { npcId: 'pap2',  message: 'Dad excitedly adds the Steam stamp to his collection!' },
    sinaasappel:    { npcId: 'mam',   message: 'Mom happily accepts the orange. "Thank you, dear!"' },
    vaas:           { npcId: 'mam',   message: 'Mom\'s eyes light up. "A blue vase! Oh, it\'s perfect!"' },
    ericgras:       { npcId: 'paard', message: 'The horse eagerly chomps on the Ericgrass.' },
    petergras:      { npcId: 'paard', message: 'The horse sniffs the Petergrass and reluctantly eats it.' },
    widget2:        { npcId: 'eric',  message: 'Eric\'s eyes light up. "Where did you find him?! I\'ll teach you to swim and dive as a thank you!"' },
    lekkervisje:    { npcId: 'lex',   message: 'Lex grabs the juicy fish and gets thoroughly distracted by it.' },
  }
  private lookCursor: Phaser.GameObjects.Graphics | null = null
  private throwMode = false
  private zapMode = false
  private panicOverlay: Phaser.GameObjects.Image | null = null
  private locationOverlay: Phaser.GameObjects.Image | null = null
  private locationOverlayDismiss: (() => void) | null = null
  private locationOverlayExtras: Phaser.GameObjects.GameObject[] = []
  private visitedAreaTypes = new Set<string>()
  private pendingThrowItem: ItemInstance | null = null
  private pendingZapItem: ItemInstance | null = null
  private digMode = false
  private trimMode = false
  private digProgress: { dx: number; dy: number; turnsLeft: number } | null = null
  private pendingDugEntry: { side: Side; coord: number; backTile: string } | null = null
  // Phasing across a map edge: arrive on this side of the next map, at the same x/y, without arrows
  private pendingEdgeEntry: { side: Side; coord: number } | null = null
  // The map edge the arrow being stepped on lies on, and its x/y along that edge (see alignEdgeEntry)
  private edgeCross: { side: Side; coord: number } | null = null

  // Dad was in sight at the end of the last turn (the Smurf tune plays when he comes into view)
  private dadInSight = false
  private smurfSound: Phaser.Sound.BaseSound | null = null
  // Speed at 300+ warns once, until the player slows down again
  private speedWarned = false
  // Where the player and each monster stood at the last trap check, so only stepping onto a trap springs it
  private lastPlayerTile = ''
  private lastMonsterTiles = new Map<string, string>()

  private ericChamberEntered = false
  private traderUnpaid = new Set<string>()
  // Unpaid items that got consumed (potion drunk, scroll read, ...) before being paid for.
  // Kept here so the pay screen can still list them and charge the player, even though
  // the item itself no longer exists in the inventory.
  private traderUnpaidGhosts = new Map<string, ItemInstance>()

  private stairsBombs: Array<{tx: number; ty: number; dx: number}> = []
  private stairsBombFallExtra = 0
  // Player's tile before their last step: the blocking horse pushes them back to that side
  private preMove: { x: number; y: number } | null = null
  private stairsOrigin: string | null = null

  private forestMusic:   Phaser.Sound.BaseSound | null = null
  private loftMusic:     Phaser.Sound.BaseSound | null = null
  private hallMusic:     Phaser.Sound.BaseSound | null = null
  private bathroomMusic: Phaser.Sound.BaseSound | null = null
  private bedroomMusic:  Phaser.Sound.BaseSound | null = null
  private pondMusic:     Phaser.Sound.BaseSound | null = null
  private stairsMusic:   Phaser.Sound.BaseSound | null = null
  private defeatMusic:   Phaser.Sound.BaseSound | null = null
  private musicVolume = 0.5

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    this.inputBlocked = false
    this.phoneOverlay = null
    this.phoneHangUpReady = false
    this.phoneSound = null
    this.throwMode = false
    this.zapMode = false
    this.pendingThrowItem = null
    this.monsters    = []
    this.companions  = []
    this.parkedCompanions = []
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
    this.stairsMusic   = this.sound.add('music_stairs',   { loop: true, volume: 0.5 })
    this.defeatMusic   = this.sound.add('music_defeat',   { loop: true, volume: 0.5 })
    const afterStart = () => {
      this.updateMusic(null)
      if (this.saveSystem.hasGame()) this.showContinueDialog()
    }
    if (!startScreenShown) {
      startScreenShown = true
      // Start screen → intro (falling sound on dismiss) → garden splash → game.
      // Deferred so the key that dismisses one splash doesn't also hit the next screen.
      this.showLocationOverlay('start', () => this.time.delayedCall(0, () =>
        this.showLocationOverlay('intro', () => {
          const fall = this.sound.add('snd_falling')
          fall.once('complete', () => fall.destroy())
          fall.play()
          const fallMs = (fall.duration || 1.5) * 1000
          this.time.delayedCall(0, () => {
            this.showLocationOverlay('garden', () => this.time.delayedCall(0, afterStart))
            this.tumbleRexOntoOverlay(fallMs)
          })
        })))
    } else {
      afterStart()
    }
  }

  private updateMusic(area: string | null): void {
    const inForest   = area === null
    const inLoft     = area === 'loft' || area === 'loft3' || area === 'loft_stairs'
    const inHall     = area === 'hall' || area === 'upper_hall_left' || area === 'upper_hall_right'
    const inBathroom = area === 'bathroom_top' || area === 'bathroom_bottom'
    const inBedroom  = area === 'bedroom' || area === 'bedroom_lower'
    const inPond     = area === 'pond1' || area === 'pond2' || area === 'pond3'
    const inStairs   = area === 'stairs'
    if (!this.forestMusic?.isPlaying   && inForest)   this.forestMusic?.play()
    if (!this.loftMusic?.isPlaying     && inLoft)     this.loftMusic?.play()
    // The hall stays silent for the rest of the game once the horse has died
    if (!this.hallMusic?.isPlaying     && inHall && !this.worldState.horseDead) this.hallMusic?.play()
    if (!this.bathroomMusic?.isPlaying && inBathroom) this.bathroomMusic?.play()
    if (!this.bedroomMusic?.isPlaying  && inBedroom)  this.bedroomMusic?.play()
    if (!this.pondMusic?.isPlaying     && inPond)     this.pondMusic?.play()
    if (!this.stairsMusic?.isPlaying   && inStairs)   this.stairsMusic?.play()
    if (!inForest)   this.forestMusic?.stop()
    if (!inLoft)     this.loftMusic?.stop()
    if (!inHall)     this.hallMusic?.stop()
    if (!inBathroom) this.bathroomMusic?.stop()
    if (!inBedroom)  this.bedroomMusic?.stop()
    if (!inPond)     this.pondMusic?.stop()
    if (!inStairs)   this.stairsMusic?.stop()
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

    // Exit row at bottom (going down reached here) — every walkable tile in the
    // bottom-most walkable row becomes an exit
    const exitRowBottom = (() => {
      for (let ty = H - 1; ty >= H - 5; ty--)
        if (walkable[ty].some((w, tx) => w && tx >= 1 && tx <= W - 2)) return ty
      return H - 2
    })()
    for (let tx = 1; tx <= W - 2; tx++)
      if (walkable[exitRowBottom][tx]) this.mapSystem.setTile(tx, exitRowBottom, 'stairs_exit_down')

    // Exit row at top (going up reached here) — every walkable tile in the
    // top-most walkable row becomes an exit
    const exitRowTop = (() => {
      for (let ty = 0; ty < 5; ty++)
        if (walkable[ty].some((w, tx) => w && tx >= 1 && tx <= W - 2)) return ty
      return 0
    })()
    for (let tx = 1; tx <= W - 2; tx++)
      if (walkable[exitRowTop][tx]) this.mapSystem.setTile(tx, exitRowTop, 'stairs_exit_up')

    // Player spawns at top-left (going down) or bottom-left (going up) —
    // must land on plain floor, not on an exit-row tile it just walked in on
    const isSpawnFloor = (tx: number, ty: number) => this.mapSystem.getTile(tx, ty)?.defId === 'stairs_floor'
    const playerPos = entry === 'bottom'
      ? (() => {
          for (let ty = H - 1; ty >= H - 5; ty--)
            for (let tx = 1; tx < W - 1; tx++)
              if (isSpawnFloor(tx, ty)) return { x: tx, y: ty }
          return { x: Math.floor(W / 2), y: H - 2 }
        })()
      : (() => {
          for (let ty = 0; ty < 5; ty++)
            for (let tx = 1; tx < W - 1; tx++)
              if (isSpawnFloor(tx, ty)) return { x: tx, y: ty }
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
      // Walking into a banana or being passed by one on its way down both count as a hit
      let hit = b.tx === this.player.x && b.ty === this.player.y
      for (let step = 0; step < fall && !hit; step++) {
        b.ty++
        b.tx += b.dx
        hit = b.tx === this.player.x && b.ty === this.player.y
      }
      if (!hit && (b.ty >= MAP_H || b.tx < 0 || b.tx >= MAP_W)) { this.stairsBombs.splice(i, 1); continue }
      if (hit) {
        if (this.isInvulnerable()) {
          this.messageLog.add('A banaan bounces off you harmlessly!', '#ffff80')
          this.stairsBombs.splice(i, 1)
          continue
        }
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
    this.messageLog.transform = (text) => this.player?.blindTurns > 0 ? this.blindText(text) : text
    this.mapSystem   = new MapSystem(MAP_W, MAP_H)
    this.turnManager = new TurnManager()
    this.inventory   = new InventorySystem(this.messageLog)
    this.equipment   = new EquipmentSystem(this.messageLog, this.inventory)
    this.combat      = new CombatSystem(this.messageLog)
    this.saveSystem  = new SaveSystem()
    this.worldState  = new WorldState()

    this.player = new Player()
    this.player.setSystems(this.equipment, this.inventory)
    this.player.onLevelUp = (level) => this.messageLog.add(`Welcome to experience level ${level}!`, '#40ff80')
    this.turnManager.addActor(this.player)

    for (const defId of ['leather_armor', 'health_potion', 'boterham', 'health_potion']) {
      this.player.inventory.push(this.inventory.createInstance(defId))
    }
    if (TEST_ALL_ITEMS) this.addAllItems()
  }

  // One of every item from items.json; returns the new instance ids
  private addAllItems(): string[] {
    const ids: string[] = []
    for (const def of this.inventory.getAllDefs()) {
      if (def.id === 'wand') continue  // generic placeholder; real wands are listed separately
      const item = this.inventory.createInstance(def.id)
      this.player.inventory.push(item)
      ids.push(item.instanceId)
    }
    return ids
  }

  // Secret quest-screen codes: the two toggles, plus ragna<map> warps.
  // 3x3 maps number their cells 1-9 row by row; 2x1 maps are 1 (top/left) and 2.
  private cheatActions(): Record<string, () => void> {
    const actions: Record<string, () => void> = {
      odogodogodog: () => this.toggleCheat('god'),
      ikzalaltijdaardigtegenericzijn: () => this.toggleCheat('items'),
      peterisdom: () => this.toggleCheat('skills'),
    }
    for (let n = 1; n <= 9; n++) {
      const cx = (n - 1) % 3, cy = Math.floor((n - 1) / 3)
      actions[`ragnagarden${n}`] = () => this.cheatWarp({ area: null, cx, cy, x: -1, y: -1 })
      actions[`ragnahall${n}`]   = () => this.cheatWarp({ area: 'hall', ucx: cx, ucy: cy, x: -1, y: -1 })
    }
    const AREAS: Record<string, Parameters<GameScene['transitionToArea']>[0]> = {
      bathroom1: 'bathroom_top', bathroom2: 'bathroom_bottom',
      garage1: 'garage_top', garage2: 'garage_bottom',
      bedroom1: 'bedroom', bedroom2: 'bedroom_lower',
      upperhall1: 'upper_hall_left', upperhall2: 'upper_hall_right',
      ericsbedroom: 'chaos', kitchen: 'kitchen', stairs: 'stairs', tub: 'tub_enclosure',
      loft: 'loft', peterandthewolf: 'loft3', atticstairs: 'loft_stairs', study: 'study',
      pantry: 'pantry', driveway: 'driveway', pond: 'pond1', caves: 'pond2', depths: 'pond3',
    }
    for (const [name, area] of Object.entries(AREAS)) {
      actions[`ragna${name}`] = () => {
        this.questScreen.hide()
        if (this.worldState.currentArea === null) {
          this.worldState.savedPlayerX = this.player.x
          this.worldState.savedPlayerY = this.player.y
        }
        if (area === 'stairs') this.stairsOrigin = 'hall'
        this.transitionToArea(area)
      }
    }
    return actions
  }

  // Garden and hall cells: warp in like the clarinet, landing on the map's own spawn tile
  private cheatWarp(loc: ClarinetLocation): void {
    this.questScreen.hide()
    this.clarinetWarp(loc, true)
  }

  private toggleCheat(cheat: 'god' | 'items' | 'skills'): void {
    if (cheat === 'skills') {
      if (this.cheatSkillIds.length === 0) {
        const all = [...SKILL_LIST.map(s => s.id), 'swimming', 'diving']
        this.cheatSkillIds = all.filter(id => !this.player.hasSkill(id))
        for (const id of this.cheatSkillIds) this.player.learnSkill(id)
        this.messageLog.add('You know all the skills.', '#ffff80')
      } else {
        for (const id of this.cheatSkillIds) this.player.skills.delete(id)
        this.cheatSkillIds = []
        this.messageLog.add('Cheat skills forgotten.', '#ffff80')
      }
    } else if (cheat === 'god') {
      this.godMode = !this.godMode
      this.messageLog.add(`God mode ${this.godMode ? 'activated' : 'deactivated'}.`, '#ffff80')
    } else if (this.cheatItemIds.length === 0) {
      this.cheatItemIds = this.addAllItems()
      this.messageLog.add('All items added to your inventory.', '#ffff80')
    } else {
      // Equipped cheat items stay; unequipping here would skip their stat bookkeeping
      for (const id of this.cheatItemIds) this.inventory.removeFromInventory(this.player.inventory, id)
      this.cheatItemIds = []
      this.messageLog.add('Cheat items removed from your inventory.', '#ffff80')
    }
    this.statsPanel.update(this.player, this.turnManager.getTurn())
  }

  private buildMap(): void {
    const { player, monsters, items } = generateForestMap(
      this.mapSystem, this.worldState.cx, this.worldState.cy, this.worldState,
    )
    this.player.x = player.x
    this.player.y = player.y
    this.spawnMapEntities(monsters, items)
  }

  // First-time spawn for a freshly generated map: adds any quest items (vase,
  // stamps, …) and wandering family NPCs rolled to this area/cell this game,
  // then spawns everything.
  private spawnMapEntities(
    monsters: Array<{ x: number; y: number; defId: string; message?: string }>,
    items: Array<{ x: number; y: number; defId: string; qty?: number }>,
  ): void {
    const ws = this.worldState
    const area = ws.currentArea
    const [siteArea, cx, cy] = area === null ? ['forest', ws.cx, ws.cy]
      : area === 'hall'                      ? ['hall', ws.ucx, ws.ucy]
      :                                        [area, undefined, undefined]
    const allItems = [...items]
    const allMonsters = [...monsters]
    const occupied = () => [{ x: this.player.x, y: this.player.y }, ...allMonsters, ...allItems]

    for (const defId of ws.questItemsFor(siteArea, cx, cy)) {
      const placed = placeSingleItemRandomly(this.mapSystem, Math.random, defId, occupied())
      if (placed) allItems.push(placed)
    }

    const npcIds = ws.npcsFor(siteArea, cx, cy)
    // Eric drops in on a third of all maps — never the cellar, pantry or driveway, and
    // the chaos map (his bedroom) and the centre garden (his shop) always have him already.
    const ericHome = ['tub_enclosure', 'pantry', 'chaos', 'driveway'].includes(siteArea) || (siteArea === 'forest' && cx === 1 && cy === 1)
    if (!ericHome && Math.random() < 1 / 3) npcIds.push('eric')
    for (const defId of npcIds) {
      const placed = placeSingleItemRandomly(this.mapSystem, Math.random, defId, occupied())
      if (placed) allMonsters.push({ x: placed.x, y: placed.y, defId })
    }

    allMonsters.push(...this.salamanderSpots(occupied()))

    this.spawnEntities(allMonsters, allItems)
    this.refreshMamMessage()
  }

  // Mom's line follows the birthday quest, wherever she turns up
  private refreshMamMessage(): void {
    const message = this.worldState.mamHasVase ? 'La la la la! La la la laaaa!'
      : this.worldState.mamHasOrange ? 'La la la la! La la laaaa! ...oh, if only I had a blue vase to put these flowers in.'
      : 'Cough... Orange juice... Cough... Cough...'
    for (const mam of this.monsters.filter(m => m.defId === 'mam')) mam.message = message
  }

  // One to three salamanders on dry land right beside the water, on maps with a fair bit of it
  private salamanderSpots(occupied: Array<{ x: number; y: number }>): Array<{ x: number; y: number; defId: string }> {
    const isWater = (x: number, y: number) => {
      const id = this.mapSystem.getTile(x, y)?.defId
      return id === 'water' || id === 'water_bath'
    }
    const taken = new Set(occupied.map(p => `${p.x},${p.y}`))
    let waterTiles = 0
    const shore: Array<{ x: number; y: number }> = []
    for (let y = 1; y < this.mapSystem.height - 1; y++)
      for (let x = 1; x < this.mapSystem.width - 1; x++) {
        if (isWater(x, y)) { waterTiles++; continue }
        const tile = this.mapSystem.getTile(x, y)
        if (!tile || !this.mapSystem.isWalkable(x, y) || isSpecialTile(tile.defId) || taken.has(`${x},${y}`)) continue
        if (Math.abs(x - this.player.x) < 5 && Math.abs(y - this.player.y) < 3) continue
        if (isWater(x + 1, y) || isWater(x - 1, y) || isWater(x, y + 1) || isWater(x, y - 1)) shore.push({ x, y })
      }
    if (waterTiles < 6 || shore.length === 0) return []
    const spots: Array<{ x: number; y: number; defId: string }> = []
    const count = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count && shore.length > 0; i++) {
      const [p] = shore.splice(Math.floor(Math.random() * shore.length), 1)
      spots.push({ x: p.x, y: p.y, defId: 'salamander' })
    }
    return spots
  }

  private spawnEntities(
    monsters: Array<{ x: number; y: number; defId: string; message?: string }>,
    items: Array<{ x: number; y: number; defId: string; qty?: number }>,
  ): void {
    const defs = new Map<string, MonsterDef>()
    for (const d of monsterData as MonsterDef[]) defs.set(d.id, d)

    for (const ms of monsters) {
      if (this.worldState.extinctRaces.has(ms.defId)) continue
      if (ms.defId === 'paard' && this.worldState.horseQuestDone) continue
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
      this.attachMonsterHooks(m)
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }

    for (const it of items) {
      const instance = this.inventory.createInstance(it.defId, it.qty ?? 1)
      this.floorItems.push(new FloorItem(it.x, it.y, instance))
    }
  }

  // Per-kind behaviour wired up whenever a monster is (re)created on the map
  private attachMonsterHooks(m: Monster): void {
    if (m.defId === 'secitt') m.onSplit = (mon) => this.spawnSecitt(mon)
    if (m.defId === 'muddman') m.onAfterMove = (fx, fy) => this.mapSystem.setTile(fx, fy, 'mud')
    if (m.defId === 'klopper') m.onAfterMove = (fx, fy) => {
      if (this.mapSystem.getTile(fx, fy)?.defId === 'tree') this.mapSystem.setTile(fx, fy, 'tree_down')
    }
    // Peter runs laps around the lego hexagon on "Peter and the Wolf"
    if (m.defId === 'peter' && this.worldState.currentArea === 'loft3') m.patrolPath = peterPatrolLoop()
    if (m.defId === 'lex') m.turnOverride = () => this.lexSeekFish(m)
  }

  // Once the horse quest is over (fed or poisoned), the other copy of the horse
  // waiting in the hall stops blocking the way.
  private removeWaitingHorses(): void {
    for (const snap of this.worldState.cellSnapshots.values())
      snap.monsters = snap.monsters.filter(m => m.defId !== 'paard')
  }

  // Coming in from the driveway before the horse quest is done: the horse also
  // stands guard in the bottom-right hall cell, right in front of the player.
  private placeDrivewayHorse(): void {
    if (this.worldState.horseQuestDone || this.worldState.extinctRaces.has('paard')) return
    if (this.monsters.some(m => m.defId === 'paard')) return
    // Nearest free tile on a row above the player: the horse shadows the player's
    // column along its own row, so it must never share the player's row
    const dist = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - this.player.x), Math.abs(p.y - this.player.y))
    const spot = this.freeSpots((_x, y) => y < this.player.y).sort((a, b) => dist(a) - dist(b))[0]
      ?? this.findSpotNearPlayer()
    this.spawnEntities([{ x: spot.x, y: spot.y, defId: 'paard' }], [])
    this.messageLog.add('The horse is here too, blocking your way!', '#c08040')
  }

  // Standing next to Sas on the driveway after the horse died of Petergrass: she
  // takes the player by the hand and walks them to the carcass. Lex tags along
  // unless he is busy with a juicy fish.
  private checkSasHorseWalk(): void {
    if (this.sasWalk || this.worldState.sasMourned || !this.worldState.deadHorseSite) return
    if (this.worldState.currentArea !== 'driveway' || !this.player.isAlive()) return
    const sas = this.monsters.find(m => m.defId === 'sas' && m.isAlive())
    if (!sas || Math.max(Math.abs(sas.x - this.player.x), Math.abs(sas.y - this.player.y)) > 1) return
    const exit = { x: MAP_W - 1, y: 1 }  // hall arrows in the driveway's top-right corner
    const path = this.sasPath(sas, (x, y) => x === exit.x && y === exit.y)
    if (!path) return
    const lex = this.monsters.find(m => m.defId === 'lex' && m.isAlive() && !m.eatingFish && m.stunTurns <= 0) ?? null
    this.worldState.sasMourned = true
    this.sasWalk = { sas, lex, path, onDriveway: true }
    this.inputBlocked = true
    if (this.inventoryScreen.isVisible()) this.inventoryScreen.hide()
    this.messageLog.add('Sas looks at you with tears in her eyes and takes you by the hand.', '#ffff80')
    if (lex) this.messageLog.add('Lex trots after you.', '#c0c0c0')
    this.scheduleSasStep()
  }

  // Shortest walk for Sas from her tile to the first tile satisfying `isGoal`
  // (excluding her own tile). Doors are fine; other transit tiles only as goal.
  private sasPath(from: { x: number; y: number }, isGoal: (x: number, y: number) => boolean): Array<{ x: number; y: number }> | null {
    const prev = new Map<number, number>()
    const key = (x: number, y: number) => y * MAP_W + x
    const start = key(from.x, from.y)
    prev.set(start, -1)
    const queue = [start]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const cx = cur % MAP_W, cy = Math.floor(cur / MAP_W)
      if (cur !== start && isGoal(cx, cy)) {
        const path: Array<{ x: number; y: number }> = []
        for (let k = cur; k !== start; k = prev.get(k)!) path.unshift({ x: k % MAP_W, y: Math.floor(k / MAP_W) })
        return path
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy
          if (!this.mapSystem.isInBounds(nx, ny) || prev.has(key(nx, ny))) continue
          if (!this.mapSystem.isWalkable(nx, ny)) continue
          const id = this.mapSystem.getTile(nx, ny)!.defId
          if (isSpecialTile(id) && !id.startsWith('door') && !isGoal(nx, ny)) continue
          prev.set(key(nx, ny), cur)
          queue.push(key(nx, ny))
        }
    }
    return null
  }

  private scheduleSasStep(): void {
    this.time.delayedCall(250, () => this.sasStep())
  }

  // One step of the walk: Sas moves along her path, the player takes her old
  // tile, Lex takes the player's old one; everyone else gets out of her way.
  private sasStep(): void {
    const walk = this.sasWalk
    if (!walk) return
    if (this.locationOverlay) { this.scheduleSasStep(); return }
    const { sas, lex } = walk
    const next = walk.path.shift()
    if (!next) {
      if (walk.onDriveway) this.sasEnterHorseMap()
      else this.finishSasWalk()
      return
    }
    const blocker = this.getMonsterAt(next.x, next.y)
    if (blocker && blocker !== sas && blocker !== lex) this.shoveAside(blocker, walk.path)

    const sasFrom = { x: sas.x, y: sas.y }
    const playerFrom = { x: this.player.x, y: this.player.y }
    sas.x = next.x; sas.y = next.y
    if (this.mapSystem.getTile(next.x, next.y)?.defId === 'door_closed') this.mapSystem.setTile(next.x, next.y, 'door_open')
    this.player.x = sasFrom.x; this.player.y = sasFrom.y
    if (lex) {
      if (Math.max(Math.abs(lex.x - playerFrom.x), Math.abs(lex.y - playerFrom.y)) <= 1) { lex.x = playerFrom.x; lex.y = playerFrom.y }
      else lex.stepToward(playerFrom.x, playerFrom.y)
    }

    // Everyone else keeps two tiles clear of Sas and off the stretch she is about to walk
    const ahead = walk.path.slice(0, 3)
    for (const m of this.monsters) {
      if (m === sas || m === lex || !m.isAlive()) continue
      const near = Math.max(Math.abs(m.x - sas.x), Math.abs(m.y - sas.y)) <= 2
      if (near || ahead.some(p => p.x === m.x && p.y === m.y)) this.fleeFromSas(m, sas, ahead)
    }

    this.refreshMapViews()
    this.scheduleSasStep()
  }

  private isFreeForFlee(x: number, y: number, avoid: Array<{ x: number; y: number }>): boolean {
    if (!this.mapSystem.isWalkable(x, y) || isSpecialTile(this.mapSystem.getTile(x, y)!.defId)) return false
    if (x === this.player.x && y === this.player.y) return false
    if (this.getMonsterAt(x, y)) return false
    return !avoid.some(p => p.x === x && p.y === y)
  }

  // Step to the neighbouring tile farthest from Sas that is off her path
  private fleeFromSas(m: Monster, sas: Monster, ahead: Array<{ x: number; y: number }>): void {
    const dist = (x: number, y: number) => Math.max(Math.abs(x - sas.x), Math.abs(y - sas.y))
    const onPath = ahead.some(p => p.x === m.x && p.y === m.y)
    let best: { x: number; y: number } | null = null
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = m.x + dx, ny = m.y + dy
        if ((dx === 0 && dy === 0) || !this.isFreeForFlee(nx, ny, ahead)) continue
        // Never closer to her, unless that is the only way off her path
        if (dist(nx, ny) < dist(m.x, m.y) && !onPath) continue
        if (!best || dist(nx, ny) > dist(best.x, best.y)) best = { x: nx, y: ny }
      }
    if (best) { m.x = best.x; m.y = best.y }
  }

  // A monster that could not get out of the way in time is pushed to the nearest free tile off the path
  private shoveAside(m: Monster, path: Array<{ x: number; y: number }>): void {
    const dist = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y))
    const spot = this.freeSpots((x, y) => !path.some(p => p.x === x && p.y === y) && !(x === m.x && y === m.y))
      .sort((a, b) => dist(a) - dist(b))[0]
    if (spot) { m.x = spot.x; m.y = spot.y }
  }

  // Through the hall arrows straight onto the map where the horse lies, entering
  // from its bottom or right edge, with Sas in front and the player (and Lex) behind.
  private sasEnterHorseMap(): void {
    const walk = this.sasWalk!
    const site = this.worldState.deadHorseSite!
    const followers = [walk.sas, ...(walk.lex ? [walk.lex] : [])]
    for (const m of followers) this.turnManager.removeActor(m.id)
    this.monsters = this.monsters.filter(m => !followers.includes(m))

    const hall = /^hall_(\d+)_(\d+)$/.exec(site.key)
    if (hall) {
      this.worldState.ucx = Number(hall[1]); this.worldState.ucy = Number(hall[2])
      this.transitionToArea('hall')
    } else if (site.key.startsWith('area_')) {
      this.transitionToArea(site.key.slice(5) as Parameters<GameScene['transitionToArea']>[0])
    }
    if (this.currentMapKey() !== site.key) { this.finishSasWalk(); return }

    // Nearest tile along the bottom/right edge from which the horse can be reached
    const atEdge = (x: number, y: number) => (x >= MAP_W - 2 || y >= MAP_H - 2) && !this.getMonsterAt(x, y)
    const toEdge = this.sasPath(site, atEdge)
    const start = toEdge?.[toEdge.length - 1]
    if (!toEdge || !start) { this.finishSasWalk(); return }
    // Her route runs back along that path, stopping beside the horse
    walk.path = toEdge.slice(0, -1).reverse()
    walk.onDriveway = false

    const occupied = [start]
    const behind = (from: { x: number; y: number }) => {
      let best: { x: number; y: number } | null = null
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = from.x + dx, ny = from.y + dy
          if (!this.mapSystem.isWalkable(nx, ny) || this.getMonsterAt(nx, ny)) continue
          if (occupied.some(p => p.x === nx && p.y === ny) || walk.path.some(p => p.x === nx && p.y === ny)) continue
          // Prefer the tile closest to the edge she came in from
          if (!best || nx + ny > best.x + best.y) best = { x: nx, y: ny }
        }
      return best ?? from
    }
    walk.sas.x = start.x; walk.sas.y = start.y
    const p = behind(start)
    occupied.push(p)
    this.player.x = p.x; this.player.y = p.y
    if (walk.lex) { const l = behind(p); walk.lex.x = l.x; walk.lex.y = l.y }

    for (const m of followers) {
      m.energy = 0
      m.setContext(this.mapSystem, this.player, (mx, my) => this.getMonsterAt(mx, my), (mm) => this.handleMonsterAttack(mm))
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }
    this.refreshMapViews()
    this.scheduleSasStep()
  }

  private finishSasWalk(): void {
    const walk = this.sasWalk
    this.sasWalk = null
    this.inputBlocked = false
    if (walk && !walk.onDriveway) {
      walk.sas.aiType = 'static'
      walk.sas.message = 'Poor horse...'
      walk.sas.hasSpoken = false
      this.messageLog.add('Sas lets go of your hand and kneels beside the horse, sobbing quietly.', '#ffff80')
    }
    this.refreshMapViews()
  }

  // Lex can't resist a juicy fish lying on his map: he walks to the nearest one
  // and, once on it, gets distracted just as if it had been handed to him. The
  // fish stays at his feet while he eats and is gone once the distraction ends.
  private lexSeekFish(lex: Monster): boolean {
    const fish = this.floorItems.filter(fi => fi.item.defId === 'lekkervisje')
    const here = fish.find(fi => fi.x === lex.x && fi.y === lex.y)
    if (lex.eatingFish) {
      lex.eatingFish = false
      if (here) {
        this.floorItems.splice(this.floorItems.indexOf(here), 1)
        this.messageLog.add('Lex finishes the juicy fish.', '#c0c0c0')
        return true
      }
    }
    if (fish.length === 0) return false
    if (here) {
      lex.eatingFish = true
      lex.stunTurns = 100
      this.worldState.bonusTurns += LEX_FISH_BONUS_TURNS
      this.messageLog.add(this.QUEST_TARGETS.lekkervisje.message, '#ffd080')
      this.messageLog.add(`Lex won't budge for a while. You gain ${LEX_FISH_BONUS_TURNS} extra turns! (${this.turnsLeft()} turns left)`, '#40ff80')
      return true
    }
    const dist = (fi: FloorItem) => Math.max(Math.abs(fi.x - lex.x), Math.abs(fi.y - lex.y))
    const nearest = fish.reduce((a, b) => dist(b) < dist(a) ? b : a)
    lex.stepToward(nearest.x, nearest.y)
    return true
  }

  private spawnSecitt(parent: Monster): void {
    if (this.worldState.extinctRaces.has('secitt')) return
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
    const sasAlong = this.takeSasAlong()
    this.saveCellSnapshot(this.forestKey())
    this.worldState.go(dx, dy)
    this.ericChamberEntered = false
    this.traderUnpaid.clear()
    this.traderUnpaidGhosts.clear()

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
      this.spawnMapEntities(monsters, items)
    }

    if (this.worldState.widgetFound) {
      const mar = this.monsters.find(m => m.defId === 'mar')
      if (mar && !mar.message) { mar.message = "So, what's next?"; mar.hasSpoken = false }
    }

    // Entry position: same x (up/down) or y (left/right), first walkable non-exit tile from border
    const entry = this.applyDugEntry() ?? this.firstEntryTile(fromDir, entryCoord)
    this.player.x = entry.x
    this.player.y = entry.y

    // Re-add companions near the player's entry position
    this.bringCompanions(savedCompanions, sasAlong)

    const {cx, cy} = this.worldState
    const realm = (cx === 0 && cy === 1) ? 'Mispelheim' : 'Garden'
    this.statsPanel.setRealm(realm)
    this.endPlayerTurn()
  }

  private findTile(defId: string): { x: number; y: number } | undefined {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (this.mapSystem.getTile(x, y)?.defId === defId) return { x, y }
    return undefined
  }

  // First tile of `defId` on the map border, stepped one tile inward
  private besideBorderTile(defId: string): { x: number; y: number } | undefined {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (this.mapSystem.getTile(x, y)?.defId !== defId) continue
        return {
          x: x === 0 ? 1 : x === MAP_W - 1 ? MAP_W - 2 : x,
          y: y === 0 ? 1 : y === MAP_H - 1 ? MAP_H - 2 : y,
        }
      }
    return undefined
  }

  // The `defId` tile on the map border closest to column `x`, stepped one tile inward
  private besideNearestBorderTile(defId: string, x: number): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        if (tx !== 0 && ty !== 0 && tx !== MAP_W - 1 && ty !== MAP_H - 1) continue
        if (this.mapSystem.getTile(tx, ty)?.defId !== defId) continue
        if (!best || Math.abs(tx - x) < Math.abs(best.x - x)) best = { x: tx, y: ty }
      }
    if (!best) return undefined
    return {
      x: best.x === 0 ? 1 : best.x === MAP_W - 1 ? MAP_W - 2 : best.x,
      y: best.y === 0 ? 1 : best.y === MAP_H - 1 ? MAP_H - 2 : best.y,
    }
  }

  private hallEntryTile(fromDir: 'right'|'left'|'down'|'up'): { x: number; y: number } {
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

  private transitionHallCell(dx: number, dy: number, fromDir: 'right'|'left'|'down'|'up'): void {
    this.player.itemVision = false
    const sasAlong = this.takeSasAlong()
    this.saveCellSnapshot(this.hallKey())
    this.worldState.goHall(dx, dy)

    const savedCompanions = this.companions.slice()
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters   = []
    this.companions = []
    this.floorItems = []
    this.corpses    = []

    this.mapSystem.reset()
    if (!this.tryRestoreFromSnapshot(this.hallKey())) {
      const hallResult = generateHallMap(
        this.mapSystem,
        this.worldState.ucx, this.worldState.ucy, this.worldState.UGRID,
        this.worldState.hallSeed,
        { cx: this.worldState.clarinetCx, cy: this.worldState.clarinetCy },
      )
      this.spawnMapEntities(hallResult.monsters, hallResult.items)
    }

    const entry = this.applyDugEntry() ?? this.alignEdgeEntry(this.hallEntryTile(fromDir))
    this.player.x = entry.x
    this.player.y = entry.y

    this.bringCompanions(savedCompanions, sasAlong)

    this.statsPanel.setRealm('Hall')
    this.endPlayerTurn()
  }

  private transitionToArea(area: 'bathroom_top' | 'bathroom_bottom' | 'garage_top' | 'garage_bottom' | 'hall' | 'chaos' | 'bedroom' | 'bedroom_lower' | 'stairs' | 'kitchen' | 'tub_enclosure' | 'loft' | 'loft3' | 'study' | 'loft_stairs' | 'pantry' | 'pond1' | 'pond2' | 'pond3' | 'driveway' | 'upper_hall_left' | 'upper_hall_right', fromDir?: 'down' | 'up', entryCoord?: number, exactEntry?: { x: number; y: number }): void {
    this.player.itemVision = false
    this.ericChamberEntered = false
    this.traderUnpaid.clear()
    this.traderUnpaidGhosts.clear()
    this.localMapView.groundDecorations = []
    const prevArea = this.worldState.currentArea
    const sasAlong = this.takeSasAlong()
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
      : area === 'garage_top'              ? generateGarageTopMap(this.mapSystem, this.worldState.relicIdFor('garage_top'))
      : area === 'garage_bottom'           ? generateGarageBottomMap(this.mapSystem, this.worldState.relicIdFor('garage_bottom'))
      : area === 'chaos'                   ? generateChaosMap(this.mapSystem, this.worldState.relicIdFor('chaos'))
      : area === 'bedroom'                 ? generateBedroomMap(this.mapSystem, this.worldState.relicIdFor('bedroom'))
      : area === 'bedroom_lower'           ? generateBedroomLowerMap(this.mapSystem, this.worldState.relicIdFor('bedroom_lower'))
      : area === 'stairs'                  ? this.buildStairsSpawnPoints(fromDir === 'up' ? 'bottom' : 'top')
      : area === 'kitchen'                 ? generateKitchenMap(this.mapSystem, this.worldState.relicIdFor('kitchen'))
      : area === 'tub_enclosure'                ? generateTubEnclosureMap(this.mapSystem, this.worldState.relicIdFor('tub_enclosure'))
      : area === 'loft'                  ? generateLoftMap(this.mapSystem)
      : area === 'loft3'                 ? generateLoft3Map(this.mapSystem)
      : area === 'study'                 ? generateStudyMap(this.mapSystem, this.worldState.relicIdFor('study'))
      : area === 'loft_stairs'           ? generateLoftStairsMap(this.mapSystem)
      : area === 'pantry'               ? generatePantryMap(this.mapSystem)
      : area === 'pond1'                ? generatePond1Map(this.mapSystem)
      : area === 'pond2'                ? generatePond2Map(this.mapSystem)
      : area === 'pond3'                ? generatePond3Map(this.mapSystem)
      : area === 'driveway'             ? generateDrivewayMap(this.mapSystem)
      : area === 'upper_hall_left'      ? generateUpperHallMap(this.mapSystem, 'left')
      : area === 'upper_hall_right'     ? generateUpperHallMap(this.mapSystem, 'right')
      :                                      generateHallMap(this.mapSystem, this.worldState.ucx, this.worldState.ucy, this.worldState.UGRID, this.worldState.hallSeed, { cx: this.worldState.clarinetCx, cy: this.worldState.clarinetCy }, this.worldState.relicIdFor('hall', this.worldState.ucx, this.worldState.ucy))

    if (area === 'pond3') {
      const gongDec = [{ tx: 6, ty: 15, key: 'item_gong' }]
      this.localMapView.groundDecorations = gongDec
      this.worldMapView.groundDecorations = [{ tx: 6, ty: 15, key: 'inv_tool' }]
    } else {
      this.worldMapView.groundDecorations = []
    }

    if (!this.tryRestoreFromSnapshot(this.areaKey(area))) {
      this.spawnMapEntities(result.monsters, result.items)
    }

    // Walking between the two upper hall cells, or between a hall cell and one
    // of its rooms, lands next to the arrow that leads back the way you came
    const link = UPPER_HALL_LINKS.find(l =>
      (l.hall === prevArea && l.room === area) || (l.room === prevArea && l.hall === area))
    const upperHallEntry = area === 'upper_hall_right' && prevArea === 'upper_hall_left' ? this.hallEntryTile('right')
      : area === 'upper_hall_left' && prevArea === 'upper_hall_right' ? this.hallEntryTile('left')
      : link ? this.besideBorderTile(area === link.room ? link.roomTile : link.hallTile)
      : prevArea === 'stairs' && area === 'hall'             ? this.findTile('portal_stairs_up')
      : prevArea === 'stairs' && area === 'upper_hall_right' ? this.findTile('portal_stairs')
      : prevArea === 'stairs' && area === 'loft'             ? this.findTile('portal_stairs')
      : prevArea === 'driveway' && area === 'hall'           ? this.besideNearestBorderTile('hall_exit_driveway', this.player.x)
      : undefined
    // The study and Mar's room meet the upper hall on a different edge: any free tile on the same x/y will do
    const looseLink = !!link && (link.room === 'study' || link.room === 'bedroom_lower')
    const entry = this.applyDugEntry() ?? this.alignEdgeEntry(exactEntry ?? upperHallEntry
      ?? ((fromDir !== undefined && entryCoord !== undefined)
        ? this.firstEntryTile(fromDir, entryCoord)
        : result.player), looseLink)
    this.player.x = entry.x
    this.player.y = entry.y
    this.setupEricsBedroom()
    if (prevArea === 'driveway' && area === 'hall') this.placeDrivewayHorse()

    this.bringCompanions(savedCompanions, sasAlong)

    const msg = area === 'bathroom_top'    ? 'You enter the bathroom.'
      : area === 'bathroom_bottom'         ? 'You descend into the bath room.'
      : area === 'garage_top'             ? 'You enter the garage.'
      : area === 'garage_bottom'          ? 'You descend into the lower garage.'
      : area === 'chaos'                  ? "You enter Eric's bedroom."
      : area === 'bedroom'               ? "You step into Mar's bedroom."
      : area === 'bedroom_lower'         ? 'You descend into the lower bedroom.'
      : area === 'stairs'                ? 'You step onto the rainbow staircase!'
      : area === 'kitchen'               ? 'You enter the kitchen.'
      : area === 'tub_enclosure'                ? 'Darkness surrounds you.'
      : area === 'loft'                  ? 'You climb up into the loft.'
      : area === 'loft3'                 ? 'You venture deeper into the loft.'
      : area === 'study'                 ? 'You enter the study room.'
      : area === 'loft_stairs'           ? 'You step into the stairwell between the study and the loft.'
      : area === 'pantry'               ? 'You step into the pantry.'
      : area === 'pond1'                ? 'You enter the pond.'
      : area === 'pond2'                ? 'You swim deeper into the underwater caves.'
      : area === 'pond3'                ? 'You descend into the depths.'
      : area === 'driveway'             ? 'You step out onto the driveway.'
      : (area === 'upper_hall_left' || area === 'upper_hall_right') ? 'You walk along the upstairs hall.'
      : area === 'hall'          ? 'You enter the hall.'
      :                                     'You enter a new area.'
    this.messageLog.add(msg, area === 'chaos' ? '#ff40ff' : (area === 'bedroom' || area === 'bedroom_lower') ? '#ff80ff' : area === 'stairs' ? '#ffaa00' : area === 'kitchen' ? '#e0c080' : area === 'tub_enclosure' ? '#404080' : (area === 'loft' || area === 'loft3' || area === 'loft_stairs') ? '#40c040' : (area === 'pond1' || area === 'pond2' || area === 'pond3') ? '#103060' : '#80c0ff')
    const realm = area === 'bathroom_top' ? 'Bathroom'
      : area === 'bathroom_bottom'        ? 'Bathroom'
      : area === 'garage_top'            ? 'Garage'
      : area === 'garage_bottom'         ? 'Garage'
      : area === 'chaos'                 ? "Eric's bedroom"
      : (area === 'bedroom' || area === 'bedroom_lower') ? "Mar's bedroom"
      : area === 'stairs'              ? 'Stairs'
      : area === 'kitchen'             ? 'Kitchen'
      : area === 'tub_enclosure'              ? 'Tub Enclosure'
      : area === 'loft'               ? 'Loft'
      : area === 'loft3'              ? 'Peter and the Wolf'
      : area === 'study'             ? 'Study Room'
      : area === 'loft_stairs'       ? 'Loft Stairs'
      : area === 'pantry'           ? 'Pantry'
      : area === 'pond1'            ? 'Pond'
      : area === 'pond2'            ? 'Underwater Caves'
      : area === 'pond3'            ? 'Pond Depths'
      : area === 'driveway'        ? 'Driveway'
      : (area === 'upper_hall_left' || area === 'upper_hall_right') ? 'Upper Hall'
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
  private hallKey(): string { return `hall_${this.worldState.ucx}_${this.worldState.ucy}` }
  private areaKey(area: string): string {
    return area === 'hall' ? this.hallKey() : `area_${area}`
  }
  private currentMapKey(): string {
    return this.worldState.currentArea !== null ? this.areaKey(this.worldState.currentArea) : this.forestKey()
  }

  private generateAreaSpawnPoints(area: string | null): SpawnPoints {
    return area === null                  ? generateForestMap(this.mapSystem, this.worldState.cx, this.worldState.cy, this.worldState)
      : area === 'bathroom_top'           ? generateBathroomTopMap(this.mapSystem)
      : area === 'bathroom_bottom'        ? generateBathroomBottomMap(this.mapSystem)
      : area === 'garage_top'             ? generateGarageTopMap(this.mapSystem, this.worldState.relicIdFor('garage_top'))
      : area === 'garage_bottom'          ? generateGarageBottomMap(this.mapSystem, this.worldState.relicIdFor('garage_bottom'))
      : area === 'chaos'                  ? generateChaosMap(this.mapSystem, this.worldState.relicIdFor('chaos'))
      : area === 'bedroom'                ? generateBedroomMap(this.mapSystem, this.worldState.relicIdFor('bedroom'))
      : area === 'bedroom_lower'          ? generateBedroomLowerMap(this.mapSystem, this.worldState.relicIdFor('bedroom_lower'))
      : area === 'stairs'                 ? this.buildStairsSpawnPoints('top')
      : area === 'kitchen'                ? generateKitchenMap(this.mapSystem, this.worldState.relicIdFor('kitchen'))
      : area === 'tub_enclosure'                 ? generateTubEnclosureMap(this.mapSystem, this.worldState.relicIdFor('tub_enclosure'))
      : area === 'loft'                   ? generateLoftMap(this.mapSystem)
      : area === 'loft3'                  ? generateLoft3Map(this.mapSystem)
      : area === 'study'                  ? generateStudyMap(this.mapSystem, this.worldState.relicIdFor('study'))
      : area === 'loft_stairs'            ? generateLoftStairsMap(this.mapSystem)
      : area === 'pantry'                 ? generatePantryMap(this.mapSystem)
      : area === 'pond1'                  ? generatePond1Map(this.mapSystem)
      : area === 'pond2'                  ? generatePond2Map(this.mapSystem)
      : area === 'pond3'                  ? generatePond3Map(this.mapSystem)
      : area === 'driveway'               ? generateDrivewayMap(this.mapSystem)
      : area === 'upper_hall_left'        ? generateUpperHallMap(this.mapSystem, 'left')
      : area === 'upper_hall_right'       ? generateUpperHallMap(this.mapSystem, 'right')
      :                                      generateHallMap(this.mapSystem, this.worldState.ucx, this.worldState.ucy, this.worldState.UGRID, this.worldState.hallSeed, { cx: this.worldState.clarinetCx, cy: this.worldState.clarinetCy }, this.worldState.relicIdFor('hall', this.worldState.ucx, this.worldState.ucy))
  }

  private realmNameFor(area: string | null): string {
    const AREA_REALMS: Record<string, string> = {
      bathroom_top: 'Bathroom', bathroom_bottom: 'Bathroom',
      garage_top: 'Garage', garage_bottom: 'Garage',
      hall: 'Hall', chaos: "Eric's bedroom",
      bedroom: "Mar's bedroom", bedroom_lower: "Mar's bedroom",
      stairs: 'Stairs', kitchen: 'Kitchen', tub_enclosure: 'Tub Enclosure',
      loft: 'Loft', loft3: 'Peter and the Wolf', study: 'Study Room', loft_stairs: 'Loft Stairs',
      pantry: 'Pantry', pond1: 'Pond', pond2: 'Underwater Caves', pond3: 'Pond Depths',
      driveway: 'Driveway',
      upper_hall_left: 'Upper Hall', upper_hall_right: 'Upper Hall',
    }
    return area === null ? 'Garden' : (AREA_REALMS[area] ?? area)
  }

  private currentLocation(): ClarinetLocation {
    return {
      area: this.worldState.currentArea,
      cx:  this.worldState.currentArea === null ? this.worldState.cx : undefined,
      cy:  this.worldState.currentArea === null ? this.worldState.cy : undefined,
      ucx: this.worldState.currentArea === 'hall' ? this.worldState.ucx : undefined,
      ucy: this.worldState.currentArea === 'hall' ? this.worldState.ucy : undefined,
      x: this.player.x, y: this.player.y,
    }
  }

  // Playing the clarinet (from the use menu or the Music skill). With the Music
  // skill it marks this spot; playing again warps back to the last marked spot.
  private playClarinet(): void {
    const known = this.player.hasSkill('music')
    this.sound.play(known ? 'sfx_clarinet_bad' : 'sfx_clarinet_worse')

    if (!known || this.worldState.currentArea === 'stairs') {
      this.messageLog.add(known
        ? "You play something beautiful, but this place is too chaotic to remember."
        : 'You play a happy tune on the clarinet.', known ? '#ff8080' : '#c08080')
      this.endPlayerTurn()
      return
    }

    const here = this.currentLocation()
    const prev = this.worldState.clarinetLocation
    this.worldState.clarinetLocation = here

    if (!prev) {
      this.messageLog.add('You play something beautiful. You will remember this place when you play again.', '#ff40ff')
      this.endPlayerTurn()
      return
    }

    this.messageLog.add('You play something beautiful. The melody pulls you back to where you last played it!', '#ff40ff')
    this.clarinetWarp(prev)
  }

  // The clarinet's / Scroll of Transport's return warp: reload whatever
  // area/cell was remembered, dropping the player on the exact tile.
  // anySpot: ignore loc.x/y and land on the map's spawn tile (or a free tile).
  private clarinetWarp(loc: ClarinetLocation, anySpot = false): void {
    const sameSpot = this.worldState.currentArea === loc.area
      && (loc.area !== null || (this.worldState.cx === loc.cx && this.worldState.cy === loc.cy))
      && (loc.area !== 'hall' || (this.worldState.ucx === loc.ucx && this.worldState.ucy === loc.ucy))

    if (sameSpot && !anySpot) {
      this.player.x = loc.x
      this.player.y = loc.y
      this.updateFOV()
      this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
      this.endPlayerTurn()
      return
    }

    this.player.itemVision = false
    this.ericChamberEntered = false
    this.traderUnpaid.clear()
    this.traderUnpaidGhosts.clear()
    this.localMapView.groundDecorations = []
    this.worldMapView.groundDecorations = []
    if (this.worldState.currentArea === 'stairs') this.stopBombSpawner()
    const leaveKey = this.worldState.currentArea === null ? this.forestKey() : this.areaKey(this.worldState.currentArea)
    this.saveCellSnapshot(leaveKey)
    const savedCompanions = this.companions.slice()
    for (const m of this.monsters) this.turnManager.removeActor(m.id)
    this.monsters = []; this.companions = []; this.floorItems = []; this.corpses = []
    this.mapSystem.reset()

    this.worldState.currentArea = loc.area
    if (loc.area === null) { this.worldState.cx = loc.cx!; this.worldState.cy = loc.cy! }
    if (loc.area === 'hall') { this.worldState.ucx = loc.ucx!; this.worldState.ucy = loc.ucy! }

    const enterKey = loc.area === null ? this.forestKey() : this.areaKey(loc.area)
    let spawn: { x: number; y: number } | undefined
    if (!this.tryRestoreFromSnapshot(enterKey)) {
      const result = this.generateAreaSpawnPoints(loc.area)
      this.spawnMapEntities(result.monsters, result.items)
      spawn = result.player
    }

    if (anySpot) {
      if (!spawn || !this.mapSystem.isWalkable(spawn.x, spawn.y) || this.getMonsterAt(spawn.x, spawn.y)) {
        const mid = { x: this.mapSystem.width / 2, y: this.mapSystem.height / 2 }
        spawn = this.freeSpots().sort((a, b) =>
          Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0] ?? spawn
      }
      loc = { ...loc, x: spawn?.x ?? 1, y: spawn?.y ?? 1 }
    }
    this.player.x = loc.x
    this.player.y = loc.y
    this.setupEricsBedroom()

    this.bringCompanions(savedCompanions)

    this.updateFOV()
    this.worldMapView.render(this.player, this.monsters, this.floorItems, loc.area === 'garage_top' || loc.area === 'garage_bottom', loc.area === 'stairs')
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    this.statsPanel.update(this.player, this.turnManager.getTurn())
    this.statsPanel.setRealm(this.realmNameFor(loc.area))
    this.updateMusic(loc.area)
    this.endPlayerTurn()
  }

  // Every Scroll of Knowledge teaches the next thing the reader doesn't know yet:
  // facts first, or the most useful skills first while wearing the Helm of Knowledge.
  private static readonly KNOWLEDGE_SKILL_ORDER = ['clothespin_trap', 'ventriloquism']
  private readKnowledge(player: Player): void {
    const all = itemData as ItemDef[]
    const skills = GameScene.KNOWLEDGE_SKILL_ORDER
      .map(id => all.find(d => d.skillScroll === id))
      .filter((d): d is ItemDef => !!d && !player.hasSkill(d.skillScroll!))
    const facts = all.filter(d => d.factScroll && !player.knownFacts.has(d.id))
    const helm = player.equipment.head?.defId === 'helm_knowledge'
    const next = helm ? (skills[0] ?? facts[0]) : (facts[0] ?? skills[0])
    if (!next) {
      this.messageLog.add('You already know the content of this scroll. Nothing happens.', '#808080')
      return
    }
    const text = next.scrollText ?? next.description
    if (next.skillScroll) {
      player.learnSkill(next.skillScroll)
      this.messageLog.add(helm ? 'The Helm of Knowledge hums. The scroll teaches you a new skill:' : 'The scroll teaches you a new skill:', '#40ffff')
    } else {
      player.knownFacts.add(next.id)
      this.messageLog.add('The scroll teaches you the following fact:', '#40ffff')
    }
    this.messageLog.add(text, '#e0e060')
  }

  // First read remembers this spot; second read returns there and uses up the scroll.
  private readTransportScroll(item: ItemInstance, player: Player, name: string): void {
    this.inventoryScreen.hide()
    this.messageLog.add(`You read ${name}.`, '#c0c080')
    const mark = item.transportMark
    if (!mark) {
      if (this.worldState.currentArea === 'stairs') {
        this.messageLog.add('The runes flicker. This place is too chaotic to remember.', '#ff8080')
        this.endPlayerTurn()
        return
      }
      // Silently remember this spot, then whisk the reader off to the pantry
      item.transportMark = this.currentLocation()
      item.charges = 1
      if (this.worldState.currentArea === 'pantry') {
        this.endPlayerTurn()
        return
      }
      this.messageLog.add('The world lurches and you are elsewhere.', '#c040ff')
      this.transitionToArea('pantry')
      return
    }
    if (item.quantity > 1) {
      item.quantity--
      item.charges = 2
      item.transportMark = undefined
    } else {
      this.removeUnpaidAware(item, player)
    }
    this.messageLog.add('The world lurches and you are back where you read the scroll before!', '#c040ff')
    this.messageLog.add('The scroll crumbles to dust.', '#808060')
    this.clarinetWarp(mark)
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
      .map(m => ({ defId: m.defId, x: m.x, y: m.y, hp: m.hp, message: m.message, hasSpoken: m.hasSpoken, stunTurns: m.stunTurns, eatingFish: m.eatingFish || undefined }))
    const items = this.floorItems.map(fi => ({ x: fi.x, y: fi.y, defId: fi.item.defId, qty: fi.item.quantity, charges: fi.item.charges, quality: fi.item.quality }))
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
      if (this.worldState.extinctRaces.has(ms.defId)) continue
      const def = defs.get(ms.defId) ?? (monsterData[0] as MonsterDef)
      const m = new Monster(def, ms.x, ms.y)
      m.hp = ms.hp
      if (ms.message !== undefined) m.message = ms.message
      m.hasSpoken = ms.hasSpoken
      m.stunTurns = ms.stunTurns
      m.eatingFish = ms.eatingFish ?? false
      m.setContext(this.mapSystem, this.player, (mx, my) => this.getMonsterAt(mx, my), (monster) => this.handleMonsterAttack(monster))
      m.energy = 0
      m.speed = m.speed * 100
      this.attachMonsterHooks(m)
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }
    for (const it of snap.items) {
      const instance = this.inventory.createInstance(it.defId, it.qty)
      if (it.charges !== undefined) instance.charges = it.charges
      instance.quality = it.quality
      this.floorItems.push(new FloorItem(it.x, it.y, instance))
    }
    this.refreshMamMessage()
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
          if (!t || t.defId !== 'tegel_wit' || !this.mapSystem.isWalkable(nx, ny) || noFlood.has(t.defId)) continue
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
    this.traderUnpaidGhosts.clear()
    this.updateMusic(null)
    if (this.worldState.currentArea === 'stairs') this.stopBombSpawner()
    const sasAlong = this.takeSasAlong()
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
      this.spawnMapEntities(monsters, items)
    }
    const entry = this.applyDugEntry() ?? this.alignEdgeEntry({ x: this.worldState.savedPlayerX, y: this.worldState.savedPlayerY })
    this.player.x = entry.x
    this.player.y = entry.y

    this.bringCompanions(savedCompanions, sasAlong)

    const leaveMsg = areaLeft?.startsWith('bathroom') ? 'You leave the bathroom.'
      : areaLeft === 'hall' ? 'You climb back to the surface.'
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
      if (this.inputBlocked) return
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
        case 'npc':     this.tryNpcInteract(); break
        case 'throw':   toggleInv('throw');  break
        case 'zap':     inv.isVisible() && inv.getMode() === 'zap' ? inv.hide() : this.tryStartZap(); break
        case 'drop':    toggleInv('drop');   break
        case 'pay': {
          if (this.traderUnpaid.size > 0) {
            this.inventoryScreen.show(this.player, 'pay', this.traderUnpaid, this.traderUnpaidGhosts)
          } else {
            this.messageLog.add('Nothing to pay for.', '#808080')
          }
          break
        }
        case 'sell': {
          if (inv.isVisible() && inv.getMode() === 'sell') { inv.hide(); break }
          if (this.isInShopArea()) inv.show(this.player, 'sell')
          else this.messageLog.add('There is no trader here to buy your items.', '#808080')
          break
        }
        case 'pickup':   this.tryPickup();     break
        case 'examine':  toggleInv('examine'); break
        case 'playback': this.messagePanel.scrollUp(); break
        case 'lookat':   this.lookMode ? this.exitLookMode() : this.enterLookMode(); break
        case 'panic':     this.panicOverlay ? this.hidePanic() : this.showPanic(); break
        case 'settings':  this.showSettingsPanel(); break
        case 'quit':      this.showQuitConfirm(); break
        case 'copyright': this.messageLog.add('RAGNAREX version 1.0 (c) Copyright 2026 by E. Wessels', '#ffff80'); break
        case 'dig':       this.startDig(); break
        case 'self':      this.selfScreen.show(this.player, this.inventory); break
        case 'skill':     this.skillScreen.show(this.player); break
        case 'help':      this.questScreen.show(this.player, this.worldState); break
        case 'map':       this.travellersLog.show(this.worldState, this.mapSystem, this.currentMapKey()); break
        case 'movedown':  this.tryDiveIntoPond(); break
        case 'moveup':    this.tryClimbStairsUp(); break
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
    this.skillScreen = new SkillScreen(this, this.inventory)
    this.skillScreen.isRecipeUsedUp = (resultId) => resultId === 'second_life_potion' && this.worldState.secondLifeMixed
    this.skillScreen.onActivate = (skillId) => {
      if (skillId === 'ventriloquism') this.useVentriloquism()
      if (skillId === 'clothespin_trap') this.makeClothespinTrap()
      if (skillId === 'music') {
        if (this.player.inventory.some(it => it.defId === 'clarinet')) this.playClarinet()
        else this.messageLog.add('You do not have an instrument.', '#808080')
      }
    }
    this.questScreen = new QuestScreen(this)
    this.questScreen.cheatCodes = Object.keys(this.cheatActions())
    this.questScreen.onCheat = (code) => this.cheatActions()[code]?.()
    this.travellersLog = new TravellersLog(this)

    this.inventoryScreen = new InventoryScreen(
      this, this.inventory, this.equipment, this.messageLog,
    )
    this.inventoryScreen.onRead = (item, player) => {
      const def = this.inventory.getDef(item.defId)
      if (!def) return
      if (def.id === 'scroll_extinction') {
        this.openExtinctionScroll(item, player, def)
        return
      }
      if (def.id === 'scroll_transport') {
        this.readTransportScroll(item, player, def.name)
        return
      }
      const text = def.scrollText ?? def.description
      if (def.factScroll || def.skillScroll) {
        this.messageLog.add(`You read ${def.name}.`, '#c0c080')
        this.readKnowledge(player)
      } else {
        this.messageLog.add(`You read ${def.name}:`, '#c0c080')
        this.messageLog.add(`"${text}"`, def.relic ? '#ffd080' : '#e0e060')
      }
      if (def.relic) {
        this.messageLog.add('You decide to keep this important looking message.', '#ffd080')
      } else {
        if (item.quantity > 1) {
          item.quantity--
        } else {
          this.removeUnpaidAware(item, player)
        }
        this.messageLog.add('The scroll crumbles to dust.', '#808060')
      }
      if (item.defId === 'scroll_teleport') {
        if (this.hasLocusRing()) {
          // Turn ends once the destination is picked (see resolveTeleportPick).
          this.teleportPicking = true
          this.teleportPickReady = false
          // Arm the mouse pick a moment later so the click on "Read" doesn't count.
          this.time.delayedCall(50, () => { this.teleportPickReady = true })
          this.messageLog.add('Click on the world map to choose where to teleport.  ESC for a random spot.', '#c080ff')
          this.inventoryScreen.hide()
          return
        }
        this.teleportRandomly()
      }

      if (item.defId === 'scroll_lavastrike') {
        this.lavaStrike()
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

      if (item.defId === 'scroll_timestop') {
        player.timestopTurns = 10
        this.messageLog.add('Time freezes around you. (10 turns)', '#c0c0ff')
      }

      if (item.defId === 'scroll_twelvegates') {
        const pool = ['snail', 'hagedis', 'egel', 'troll', 'bat', 'rat', 'wilddog', 'ogre', 'spirit', 'muddman', 'pissebed']
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
      else this.removeUnpaidAware(item1, player)
      if (item2.quantity > 1) item2.quantity--
      else this.removeUnpaidAware(item2, player)

      let resultId: string
      if (player.hasSkill('mixing')) {
        const recipe = MIX_RECIPES.find(r =>
          (r.a === item1.defId && r.b === item2.defId) ||
          (r.a === item2.defId && r.b === item1.defId)
        )
        // Second Life can only come out of the matching recipe, and only once per game
        const randomPool = SKILLED_POOL.filter(id => id !== 'second_life_potion')
        const secondLifeUsedUp = recipe?.result === 'second_life_potion' && this.worldState.secondLifeMixed
        resultId = recipe && !secondLifeUsedUp
          ? recipe.result
          : randomPool[Math.floor(Math.random() * randomPool.length)]
        if (resultId === 'second_life_potion') this.worldState.secondLifeMixed = true
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
      if (resultId === 'invulnerability_potion')
        this.messageLog.add('Its power is precious. Save it for only the most dangerous situations!', '#ffff80')
      this.inventoryScreen.hide()
      this.endPlayerTurn()
    }

    this.inventoryScreen.onConsume = (item, player) => {
      let def = this.inventory.getDef(item.defId)
      if (!def) return
      // Speculaas stacks hide which biscuits are bad: decide on eating
      if (item.defId === 'speculaas' && Math.random() < BAD_SPECULAAS_CHANCE) def = this.inventory.getDef('speculaas_bad') ?? def
      if (item.defId === 'second_life_potion') {
        player.secondLife = true
        this.messageLog.add('You feel watched over by divine forces.', '#ffd080')
      } else if (item.defId === 'strength_potion') {
        player.str += 1
        this.messageLog.add('You feel stronger! (STR +1)', '#ff8040')
      } else if (item.defId === 'experience_potion') {
        player.gainXP(100)
        this.messageLog.add('Wisdom floods your mind. (+100 XP)', '#40ff80')
      } else if (item.defId === 'depredation_potion') {
        player.itemVision = true
        this.messageLog.add('Your senses sharpen. You perceive all nearby items.', '#c0a0ff')
      } else if (item.defId === 'invulnerability_potion') {
        player.invulnerableTurns = 100
        this.messageLog.add('You feel invulnerable! Nothing can harm you.', '#ffff80')
      } else if (item.defId === 'transformation_potion') {
        if (player.transformationMonsterId !== null) {
          player.str -= player.transformationStrBonus
          player.maxHp -= player.transformationHpBonus
        } else {
          player.preTransformSpriteKey = player.spriteKey
        }
        const monsterId = POWERFUL_MONSTER_IDS[Math.floor(Math.random() * POWERFUL_MONSTER_IDS.length)]
        const monsterDef = (monsterData as MonsterDef[]).find(d => d.id === monsterId)!
        player.transformationMonsterId = monsterId
        player.transformationStrBonus = monsterDef.str
        player.transformationHpBonus = monsterDef.hp
        player.str += monsterDef.str
        player.maxHp += monsterDef.hp
        player.hp = Math.min(player.maxHp, player.hp + monsterDef.hp)
        player.spriteKey = `monster_${monsterId}`
        this.messageLog.add(`Your body warps and twists. You become a ${monsterDef.name}! (STR +${monsterDef.str}, Max HP +${monsterDef.hp})`, '#40ffff')
      } else if (item.defId === 'speed_potion') {
        // Doses stack (no cap — above 400 every step hurts) and reset the duration
        const gain = 100
        player.speed += gain
        player.speedPotionBonus += gain
        player.speedTurns = 30
        this.messageLog.add(`Your feet move like the wind! (Speed ${player.speed} for 30 turns)`, '#ffff40')
      } else if (item.defId === 'phasing_potion') {
        player.phasingTurns = 20
        this.messageLog.add('You feel briefly out of phase with reality.', '#8080ff')
      } else if (item.defId === 'blindness_potion') {
        player.blindTurns = 100
        this.messageLog.add('Your eyes hurt!', '#200020')
      } else if (item.defId === 'translucence_potion') {
        player.translucenceTurns = 30
        this.messageLog.add('You can see through your own hands. (AC -20 for 30 turns)', '#c0c0ff')
      } else if (item.defId === 'lycanthropy_potion') {
        // Same curse as a werewolf bite
        if (!player.lycanthropy) {
          player.lycanthropy = true
          player.lycanthropyCountdown = 100
        }
        this.messageLog.add('It tastes like wet dog. You feel a strange itch under your skin.', '#a06030')
      } else if (item.defId === 'music_potion') {
        player.learnSkill('music')
        this.messageLog.add('Ethereal music fills your mind. You have learned the Music skill!', '#ff40ff')
      } else if (item.defId === 'mystery_potion') {
        const poolId = MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)]
        if (poolId === 'strength_potion') {
          player.str += 1
          this.messageLog.add('The Mystery potion tingles. You feel stronger! (STR +1)', '#808080')
        } else if (poolId === 'experience_potion') {
          player.gainXP(100)
          this.messageLog.add('The belly potion glows briefly. (+100 XP)', '#808080')
        } else if (poolId === 'depredation_potion') {
          player.itemVision = true
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
          player.phasingTurns = 30
          this.messageLog.add('The Mystery potion shimmers. You feel briefly incorporeal.', '#808080')
        } else if (poolId === 'blindness_potion') {
          player.blindTurns = 100
          this.messageLog.add('The Mystery potion stings your eyes. Everything blurs.', '#808080')
        } else if (poolId === 'translucence_potion') {
          player.translucenceTurns = 100
          this.messageLog.add('The Mystery potion glows. You become harder to see.', '#808080')
        }
      } else if (item.defId === 'banaan') {
        if (this.isInvulnerable()) {
          this.messageLog.add('You eat the banana. It has no effect on you.', '#ffee00')
        } else {
          const dmg = 20
          player.hp = Math.max(0, player.hp - dmg)
          this.messageLog.add(`You eat the banana. You feel exploding sensations in your tummy! (-${dmg} HP)`, '#ffee00')
          if (!player.isAlive()) {
            this.lastKilledBy = 'banana poisoning'
            this.removeUnpaidAware(item, player)
            this.inventoryScreen.hide()
            this.gameOver(`Killed by eating a banana`)
            return
          }
        }
      } else if (item.defId === 'clay') {
        player.clayProtection = 50
        player.petrifyCountdown = 0
        this.messageLog.add('You eat the clay. Your flesh hardens against petrification.', '#c09060')
      } else if (item.defId === 'mispel') {
        player.drunkTurns = 20
        player.food = Math.max(0, Math.min(player.maxFood, player.food + (def.foodAmount ?? 0)))
        player.hp   = Math.max(0, Math.min(player.maxHp,   player.hp   + (def.healAmount ?? 0)))
        this.messageLog.add('You eat the rotten Mespilus germanica. Your head starts spinning!', '#c0a0ff')
      } else if (item.defId === 'boterham') {
        player.str += 0.2
        const prevFood = player.food
        const prevHp   = player.hp
        player.food = Math.max(0, Math.min(player.maxFood, player.food + (def.foodAmount ?? 0)))
        player.hp   = Math.max(0, Math.min(player.maxHp,   player.hp   + (def.healAmount ?? 0)))
        const foodDelta = player.food - prevFood
        const hpDelta   = player.hp   - prevHp
        const parts: string[] = ['+0.2 STR']
        if (foodDelta !== 0) parts.push(`${foodDelta > 0 ? '+' : ''}${foodDelta} food`)
        if (hpDelta   !== 0) parts.push(`${hpDelta   > 0 ? '+' : ''}${hpDelta} HP`)
        const baseMsg = def.eatMessage ?? `You eat the ${def.name}.`
        this.messageLog.add(`${baseMsg} (${parts.join(', ')})`, '#80c040')
      } else if (def.type === 'eat') {
        const prevFood = player.food
        const prevHp   = player.hp
        player.food = Math.max(0, Math.min(player.maxFood, player.food + (def.foodAmount ?? 0)))
        player.hp   = Math.max(0, Math.min(player.maxHp,   player.hp   + (def.healAmount ?? 0)))
        player.luck += def.luckAmount ?? 0
        const foodDelta = player.food - prevFood
        const hpDelta   = player.hp   - prevHp
        const parts: string[] = []
        if (foodDelta !== 0) parts.push(`${foodDelta > 0 ? '+' : ''}${foodDelta} food`)
        if (hpDelta   !== 0) parts.push(`${hpDelta   > 0 ? '+' : ''}${hpDelta} HP`)
        if (def.luckAmount) parts.push(`${def.luckAmount > 0 ? '+' : ''}${def.luckAmount} luck`)
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
      if (item.defId === 'sinaasappel' && player.lycanthropy) {
        player.lycanthropy = false
        player.lycanthropyCountdown = 0
        if (player.werewolfTurns > 0) this.endWerewolfForm()
        this.messageLog.add('The vitamins burn through your blood. You feel cleansed.', '#ffa040')
      }
      if (item.quantity > 1) {
        item.quantity--
      } else {
        this.removeUnpaidAware(item, player)
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

      if (item.defId === 'pickaxe') {
        this.inventoryScreen.hide()
        this.startDig()
        return
      }

      if (item.defId === 'kruk') {
        this.inventoryScreen.hide()
        this.takeCrutchBreak()
        return
      }

      if (item.defId === 'telephone') {
        this.inventoryScreen.hide()
        this.playPhoneCall()
        return
      }

      if (item.defId === 'toiletBrush') {
        this.inventoryScreen.hide()
        if (this.mapSystem.getTile(player.x, player.y)?.defId === 'toilet') this.flushToilet()
        else this.messageLog.add('You have no use for the toilet brush here.', '#808080')
        return
      }

      if (item.defId === 'clarinet') {
        this.inventoryScreen.hide()
        this.playClarinet()
        return
      }

      if (item.defId === 'empty_vial') {
        const tile = this.mapSystem.getTile(player.x, player.y)
        const studyPools = ['study_pool', 'study_pool_green', 'study_pool_yellow']
        if (tile && studyPools.includes(tile.defId)) {
          const BASIC_POTIONS = ['health_potion', 'speed_potion', 'phasing_potion', 'depredation_potion', 'strength_potion', 'experience_potion', 'blindness_potion', 'translucence_potion']
          const resultId = BASIC_POTIONS[Math.floor(Math.random() * BASIC_POTIONS.length)]
          this.removeUnpaidAware(item, player)
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
        this.messageLog.add('Mom is busy coughing. She doesn\'t notice your gift.', '#808080')
        this.inventoryScreen.hide()
        return
      }

      // Lex: the fish goes on the ground beneath him, and he grabs it on his own turn (see lexSeekFish)
      if (quest.npcId === 'lex') {
        let fish = item
        if (item.quantity > 1) {
          item.quantity--
          fish = this.inventory.createInstance(item.defId)
        } else {
          this.removeUnpaidAware(item, player)
        }
        this.floorItems.push(new FloorItem(target.x, target.y, fish))
        this.messageLog.add('You place the juicy fish on the ground beneath Lex.', '#ffd080')
        this.inventoryScreen.hide()
        this.endPlayerTurn()
        return
      }

      this.removeUnpaidAware(item, player)
      this.messageLog.add(quest.message, '#ffd080')
      this.inventoryScreen.hide()

      let questComplete = true

      // Dad rewards mixing skill after receiving all 3 stamps
      if (quest.npcId === 'pap2' && !player.hasSkill('mixing')) {
        // Count the stamps handed over — not the ones left in the pack, which is
        // also empty when the others haven't even been found yet
        this.worldState.stampsGiven++
        if (this.worldState.stampsGiven >= 3) {
          player.learnSkill('mixing')
          this.messageLog.add('"You have completed my collection!" Dad teaches you the art of mixing potions.', '#ffd080')
          this.messageLog.add('You learned the skill: Alchemy!', '#40ff80')
        } else {
          questComplete = false
        }
      }

      // Mar unlocks the ritual after receiving all 3 fragments
      if (quest.npcId === 'mar_bedroom' && !player.hasSkill('ritual_begun')) {
        this.worldState.fragmentsGiven++
        if (this.worldState.fragmentsGiven >= 3) {
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
        // Poisoning the horse still ends its quest, but for far fewer points
        const reward = item.defId === 'petergras' ? 100 : 500
        player.gainXP(reward)
        this.messageLog.add(`Quest complete! (+${reward} XP)`, '#40ff80')
      }

      // Eric teaches swimming and diving when given the widget
      if (quest.npcId === 'eric' && item.defId === 'widget2' && !this.worldState.widgetFound) {
        player.learnSkill('swimming')
        player.learnSkill('diving')
        this.messageLog.add('Eric teaches you his secret swimming and diving technique.', '#ffd080')
        this.messageLog.add('You learned the skills: Swimming and Diving!', '#40ff80')
        this.worldState.widgetFound = true
        const mar = this.monsters.find(m => m.defId === 'mar')
        if (mar) { mar.message = "So, what's next?"; mar.hasSpoken = false }
        this.setupEricsBedroom()
      }

      // Mom quests
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
          this.messageLog.add('Mom\'s joy fills your heart. (Max HP +25)', '#ff80c0')
          if (!player.hasSkill('music')) {
            player.learnSkill('music')
            this.messageLog.add('Mom teaches you her favourite song.', '#ff80c0')
            this.messageLog.add('You learned the skill: Music!', '#40ff80')
          }
        }
      }

      // Special post-give effects for the horse
      if (quest.npcId === 'paard') {
        if (item.defId === 'petergras') {
          target.hp = 0
          this.worldState.deadHorseSite = { key: this.currentMapKey(), x: target.x, y: target.y }
          this.removeMonster(target)
          this.hallMusic?.stop()
          this.worldState.horseDead = true
          this.removeWaitingHorses()
          this.messageLog.add('The horse sniffs at the Petergrass, staggers and collapses. You lost a real friend :(', '#ff4040')
        } else if (item.defId === 'ericgras') {
          target.aiType = 'follow'
          if (!this.companions.includes(target)) this.companions.push(target)
          this.worldState.horseFed = true
          this.removeWaitingHorses()
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

    this.inventoryScreen.onZap = (item, _player) => {
      this.inventoryScreen.hide()
      this.beginZap(item)
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
      const price = itemValue(def, item)
      if (player.gold < price) {
        this.messageLog.add(`Not enough cents! ${def?.name ?? item.defId} costs ${price}c.`, '#ff8040')
        this.inventoryScreen.refresh(player)
        return
      }
      player.gold -= price
      this.traderUnpaid.delete(item.instanceId)
      this.traderUnpaidGhosts.delete(item.instanceId)
      this.messageLog.add(`You pay ${price}c for the ${def?.name ?? item.defId}.`, '#ffd080')
      this.checkTraderDoor()
      if (this.traderUnpaid.size === 0) {
        this.inventoryScreen.hide()
      } else {
        this.inventoryScreen.refresh(player)
      }
      this.endPlayerTurn()
    }

    // Selling to Eric: he pays half the price and puts the item out on his floor,
    // where it's for sale again at the full price
    this.inventoryScreen.onSell = (item, player) => {
      const def = this.inventory.getDef(item.defId)
      let sold = item
      if (item.quantity > 1) {
        item.quantity--
        sold = this.inventory.createInstance(item.defId)
        sold.quality = item.quality
      } else {
        this.inventory.removeFromInventory(player.inventory, item.instanceId)
      }
      const price = sellPrice(itemValue(def, sold))
      player.gold += price
      this.floorItems.push(new FloorItem(player.x, player.y, sold))
      this.messageLog.add(`You sell the ${def?.name ?? item.defId} to Eric for ${price}c.`, '#ffd080')
      this.inventoryScreen.refresh(player)
      this.endPlayerTurn()
    }

    this.turnManager.onTurn(() => {
      this.checkTimeLimit()
      if (this.player.petrified > 0) this.player.petrified--
      if (this.player.paralyzedTurns > 0) {
        this.player.paralyzedTurns--
        if (this.player.paralyzedTurns === 0) this.messageLog.add('You can move again.', '#c0e0ff')
      }
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
          if (this.isInvulnerable()) {
            this.messageLog.add('You feel your flesh harden, then loosen again. You are unharmed.', '#ffff80')
          } else {
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
      for (const m of [...this.monsters]) {
        if (m.defId === 'wizard' && m.isAlive()) this.wizardTurn(m)
        if (m.defId === 'summoner' && m.isAlive()) this.summonerTurn(m)
        if (m.defId === 'magician' && m.isAlive()) this.magicianTurn(m)
        // A blind player can't meet the Watcher's gaze
        if (m.defId === 'watcher' && m.isAlive() && this.player.blindTurns <= 0 && this.mapSystem.getTile(m.x, m.y)?.visible) {
          if (this.player.equipment.shield?.defId === 'mirrorshield') {
            this.messageLog.add("The Watcher's gaze reflects off your mirror shield!", '#c0e0ff')
            m.hp = Math.max(0, m.hp - 10)
          } else if (this.player.clayProtection > 0) {
            this.messageLog.add("The Watcher's gaze washes over you. The clay protects you.", '#c09060')
          } else if (this.isInvulnerable()) {
            this.messageLog.add("The Watcher's gaze washes over you harmlessly.", '#ffff80')
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
            } else if (roll === 2 && this.player.extraEyes < 1) {
              this.player.extraEyes++
              this.player.drunkTurns = Math.max(this.player.drunkTurns, 20)
              this.messageLog.add(`The weird fumes mutate you. You grow an extra eye! (${2 + this.player.extraEyes} eyes total)`, '#80ff40')
              this.messageLog.add('Your new eye makes the world swim. You feel confused!', '#c0a0ff')
            }
          }
        }
      }
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
        this.phoneSound?.stop()
        this.scene.restart()
        return
      }

      if (event.key === 'V') {
        event.preventDefault()
        this.triggerVictory()
        return
      }

      if (this.phoneOverlay) { if (this.phoneHangUpReady) this.hangUpPhone(); return }

      if (this.locationOverlay) { this.hideLocationOverlay(); return }

      if (this.inputBlocked) return

      // In werewolf form the beast moves on its own
      if (this.player.werewolfTurns > 0) return

      if (this.teleportPicking) {
        if (event.key === 'Escape') this.resolveTeleportPick(null)
        return
      }

      if (event.key === 'Escape') {
        if (this.panicOverlay) { this.hidePanic(); return }
        if (this.selfScreen.isVisible()) { this.selfScreen.hide(); return }
        if (this.skillScreen.isVisible()) { this.skillScreen.hide(); return }
        if (this.questScreen.isVisible()) { this.questScreen.handleKey(event); return }
        if (this.travellersLog.isVisible()) { this.travellersLog.hide(); return }
        if (this.lookMode) { this.exitLookMode(); return }
      }

      // Traveller's log swallows all keys when open
      if (this.travellersLog.isVisible()) return

      // Self screen swallows all keys when open
      if (this.selfScreen.isVisible()) return

      // Skill screen swallows all keys when open
      if (this.skillScreen.isVisible()) return

      // Quest screen swallows all keys when open (number keys drill into a quest)
      if (this.questScreen.isVisible()) { this.questScreen.handleKey(event); return }

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
          this.pendingZapItem = null
          this.messageLog.add('Cancelled.', '#808080')
          return
        }
        const zapDirMap: Record<string, [number, number]> = {
          '.': [0, 0], '5': [0, 0], 'Clear': [0, 0],
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
          const item = this.pendingZapItem
          const self = dir[0] === 0 && dir[1] === 0
          const effect = item ? this.inventory.getDef(item.defId)?.wandEffect : undefined
          if (self && effect !== 'displacement') {
            this.messageLog.add('Point it in a direction.', '#808080')
            return
          }
          this.zapMode = false
          this.pendingZapItem = null
          if (item && effect) this.zapWand(item, dir[0], dir[1])
          else if (item) this.zapRay(item, dir[0], dir[1])
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
      if (this.teleportPicking) {
        if (!this.teleportPickReady) return
        this.resolveTeleportPick(this.worldMapView.getTileAt(pointer.x, pointer.y))
        return
      }
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
    if (this.player.paralyzedTurns > 0) {
      this.messageLog.add('You are paralyzed! You cannot move.', '#c0a0ff')
      this.endPlayerTurn()
      return
    }
    if (this.player.petrified > 0) {
      this.messageLog.add('You are turned to stone! You cannot move.', '#a0a0a0')
      this.endPlayerTurn()
      return
    }
    if (this.player.drunkTurns > 0 || this.player.werewolfTurns > 0) {
      const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
      const r = dirs[Math.floor(Math.random() * dirs.length)]
      dx = r[0]
      dy = r[1]
    }
    const standingTile = this.mapSystem.getTile(this.player.x, this.player.y)
    if ((standingTile?.defId === 'mud' || standingTile?.defId === 'mud_footprint') && this.player.equipment.feet?.defId !== 'rubberboots') {
      if (Math.random() < 0.8) {
        this.messageLog.add('You slip in the mud.', '#8b6040')
        this.endPlayerTurn()
        return
      }
    }
    if (dy > 0 && this.worldState?.currentArea === 'stairs') this.stairsBombFallExtra = 1
    this.preMove = { x: this.player.x, y: this.player.y }
    const nx = this.player.x + dx
    const ny = this.player.y + dy

    const monster = this.getMonsterAt(nx, ny)
    if (monster) {
      if (monster.defId === 'mar_bedroom' && !this.player.hasSkill('ritual_begun')) {
        this.messageLog.add('Mar: "I lost three important scrolls, did you find them?"', '#80ff80')
        this.endPlayerTurn()
        return
      }
      // Peter keeps running his laps; you have to catch up with him to talk
      if (monster.defId === 'peter') {
        if (!monster.hasSpoken) {
          monster.hasSpoken = true
          this.worldState.peterWarned = true
          this.inventory.addToInventory(this.player.inventory, this.inventory.createInstance('gongmallet'))
          this.messageLog.add('You fulfill your quest by telling Peter the news.', '#80ff80')
          this.messageLog.add('Peter: "Here, use these Gong mallets to sound the magical Green Gong. You will find it in the pond! Quick!"', '#80ff80')
        } else {
          this.messageLog.add('Peter: "Quick, to the pond! The Green Gong!"', '#80ff80')
        }
        this.endPlayerTurn()
        return
      }
      if (monster.aiType === 'friendly' || monster.aiType === 'follow') {
        if (monster.message && !monster.hasSpoken) {
          this.messageLog.add(`${monster.name}: "${monster.message}"`, '#80ff80')
          monster.hasSpoken = true
        } else if (monster.defId === 'car') {
          this.messageLog.add(`You don't have the keys.`, '#60c060')
        } else if (monster.defId === 'paard' && monster.aiType !== 'follow') {
          this.messageLog.add('The Horse is happy to see you!', '#60c060')
        } else {
          this.messageLog.add(`The ${monster.name} steps aside.`, '#60c060')
          if ((monster.defId !== 'paard' || monster.aiType === 'follow') && monster.defId !== 'mar_bedroom') {
            monster.x = this.player.x
            monster.y = this.player.y
            this.player.x = nx
            this.player.y = ny
            this.hurtIfTooFast()
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
      if (monster.defId === 'cactus' && monster.isAlive() && !this.isInvulnerable()) {
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
    this.pendingDugEntry = null
    this.pendingEdgeEntry = null
    if (tile) {
      this.queueDugEntry(nx, ny, tile.defId)
      if (this.enterTransitTile(tile.defId, nx, ny)) return
    }

    // Water: requires Diving skill (must first learn Swimming, then Diving), or
    // a Gompie to float on. Phasing doesn't help here.
    if (tile && WATER_TILES.has(tile.defId)) {
      if (this.player.hasSkill('diving') || this.hasGompie()) {
        const fromLand = !WATER_TILES.has(standingTile?.defId ?? '')
        if (fromLand && !this.player.hasSkill('diving'))
          this.messageLog.add('You inflate your Gompie and float onto the water.', '#80c0ff')
        this.player.x = nx
        this.player.y = ny
        this.hurtIfTooFast()
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

    const lockedIn = this.traderUnpaid.size > 0 && this.isInShopArea()
    // Past the map border: only a phasing player gets through, into the neighbouring map
    if (!tile) {
      if (this.player.phasingTurns > 0 && !lockedIn && this.crossEdgeByPhasing(nx, ny)) return
      if (this.player.werewolfTurns > 0) this.endPlayerTurn()
      return
    }
    // Holding the toilet brush lets the player climb onto a toilet
    const brushToilet = tile.defId === 'toilet' && this.hasToiletBrush()
    if (!brushToilet && !this.mapSystem.isWalkable(nx, ny) && (this.player.phasingTurns <= 0 || lockedIn)) {
      if (lockedIn && this.player.phasingTurns > 0) {
        this.messageLog.add("You can't phase through the trader's walls while you owe cents.", '#808080')
      }
      // The roaming werewolf bumps into the wall and loses its turn
      if (this.player.werewolfTurns > 0) this.endPlayerTurn()
      return
    }

    this.player.x = nx
    this.player.y = ny
    if (tile.defId === 'mud') this.mapSystem.setTile(nx, ny, 'mud_footprint')
    this.hurtIfTooFast()
    this.endPlayerTurn()
  }

  // Above speed 400 every step hurts; passing turns (. / 5) and other actions stay free.
  private hurtIfTooFast(): void {
    if (this.player.speed <= 400 || this.isInvulnerable()) return
    this.player.hp = Math.max(0, this.player.hp - 20)
    this.messageLog.add('You are moving too fast for your short legs!', '#ff4000')
    if (!this.player.isAlive()) this.lastKilledBy = 'running too fast'
  }

  // NPC button: with a character next to you it opens the Use menu, as the Use button does.
  private tryNpcInteract(): void {
    const p = this.player
    const near = this.monsters.some(m => m.isAlive() && (m.npc || m.defId === 'paard') &&
      Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1)
    if (!near) {
      this.messageLog.add('There is no other character next to you.', '#808080')
      return
    }
    if (this.inventoryScreen.isVisible() && this.inventoryScreen.getMode() === 'use') this.inventoryScreen.hide()
    else this.inventoryScreen.show(p, 'use')
  }

  // Stepping onto an arrow, portal or stairs tile: switches maps and returns true
  // when (x, y) leads somewhere. Also used for phasing across a map edge, which
  // follows the edge's arrow without stepping on it.
  private enterTransitTile(defId: string, x: number, y: number): boolean {
    const side = this.edgeSideOf(x, y)
    this.edgeCross = side ? { side, coord: side === 'left' || side === 'right' ? y : x } : null
    try {
      return this.followTransitTile(defId, x, y)
    } finally {
      this.edgeCross = null
    }
  }

  private followTransitTile(defId: string, x: number, y: number): boolean {
    const tile = { defId }
    const isHallArea = this.worldState.currentArea === 'hall'
    // Dug or tunnelled arrows through a wall linking two rooms (see EDGE_LINKS)
    if (this.worldState.dugExits.has(`${this.currentMapKey()}:${x},${y}`)) {
      const side = this.edgeSideOf(x, y)
      const link = side && this.edgeLinkFrom(side)
      if (link) { this.followEdgeLink(link); return true }
    }
    // Upper hall: the two cells link via their side arrows; other arrows lead into rooms
    if (tile?.defId === 'exit_right' && this.worldState.currentArea === 'upper_hall_left')  { this.transitionToArea('upper_hall_right'); return true }
    if (tile?.defId === 'exit_left'  && this.worldState.currentArea === 'upper_hall_right') { this.transitionToArea('upper_hall_left');  return true }
    if (tile?.defId === 'upper_hall_exit_chaos')    { this.transitionToArea('chaos');         return true }
    if (tile?.defId === 'upper_hall_exit_bathroom') { this.transitionToArea('bathroom_top');  return true }
    if (tile?.defId === 'upper_hall_exit_study')    { this.transitionToArea('study');         return true }
    if (tile?.defId === 'upper_hall_exit_mar')      { this.transitionToArea('bedroom_lower'); return true }
    const backToHall = UPPER_HALL_LINKS.find(l => l.roomTile === tile?.defId)
    if (backToHall) { this.transitionToArea(backToHall.hall); return true }
    if (tile?.defId === 'portal_upper_hall_left' || tile?.defId === 'portal_upper_hall_right') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea(tile.defId === 'portal_upper_hall_left' ? 'upper_hall_left' : 'upper_hall_right')
      return true
    }
    if (tile?.defId === 'exit_right') {
      if (isHallArea) this.transitionHallCell( 1,  0, 'right')
      else this.transitionCell( 1,  0, 'right', this.player.y)
      return true
    }
    if (tile?.defId === 'exit_left') {
      if (isHallArea) this.transitionHallCell(-1,  0, 'left')
      else this.transitionCell(-1,  0, 'left',  this.player.y)
      return true
    }
    if (tile?.defId === 'exit_down') {
      if (isHallArea) this.transitionHallCell( 0,  1, 'down')
      else this.transitionCell( 0,  1, 'down',  this.player.x)
      return true
    }
    if (tile?.defId === 'exit_up') {
      if (isHallArea) this.transitionHallCell( 0, -1, 'up')
      else this.transitionCell( 0, -1, 'up',    this.player.x)
      return true
    }
    if (tile?.defId === 'exit_bathroom' || tile?.defId === 'portal') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('bathroom_top')
      return true
    }
    if (tile?.defId === 'bath_exit_left') { this.transitionFromArea(); return true }
    if (tile?.defId === 'bath_exit_down') { this.transitionToArea('bathroom_bottom', 'down', this.player.x); return true }
    if (tile?.defId === 'bath_exit_up')   { this.transitionToArea('bathroom_top',    'up',   this.player.x); return true }
    // The hall entry cell's top exit leads back up into the kitchen, beside its bottom arrows
    if ((tile?.defId === 'stairs_up' && this.worldState.currentArea === 'hall') || tile?.defId === 'hall_exit_up') {
      this.transitionToArea('kitchen', undefined, undefined, { x: Math.floor(MAP_W / 2), y: MAP_H - 2 })
      return true
    }
    if (tile?.defId === 'portal_hall') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.worldState.ucx = 0
      this.worldState.ucy = 0
      this.transitionToArea('hall')
      return true
    }
    if (tile?.defId === 'portal_chaos') {
      if (this.worldState.currentArea === 'chaos') {
        this.transitionFromArea()
      } else {
        this.worldState.savedPlayerX = this.player.x
        this.worldState.savedPlayerY = this.player.y
        this.transitionToArea('chaos')
      }
      return true
    }
    if (tile?.defId === 'portal_garage') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('garage_top')
      return true
    }
    if (tile?.defId === 'portal_driveway') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('driveway')
      return true
    }
    if (tile?.defId === 'portal_bedroom') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('bedroom')
      return true
    }
    if (tile?.defId === 'garage_portal_driveway') {
      this.transitionToArea('driveway', undefined, undefined, { x: 25, y: 3 })
      return true
    }
    // Lower garage bottom arrows <-> driveway top arrows: land just inside, in the same column
    if (tile?.defId === 'garage_exit_driveway') {
      this.transitionToArea('driveway', undefined, undefined, { x: Math.max(1, Math.min(50, this.player.x)), y: 1 })
      return true
    }
    // Bottom-right hall cell's bottom arrows: into the driveway's hall room, same column
    if (tile?.defId === 'hall_exit_driveway') {
      this.transitionToArea('driveway', undefined, undefined, { x: Math.max(53, Math.min(78, this.player.x)), y: 2 })
      return true
    }
    if (tile?.defId === 'hall_portal_driveway') {
      this.transitionToArea('driveway', undefined, undefined, { x: 65, y: 3 })
      return true
    }
    if (tile?.defId === 'bedroom_portal_driveway') {
      this.transitionToArea('driveway', undefined, undefined, { x: 72, y: 14 })
      return true
    }
    if (tile?.defId === 'driveway_exit_garage') {
      this.transitionToArea('garage_bottom', 'up', this.player.x)
      return true
    }
    // The driveway's hall arrows lead into the bottom-right hall cell, beside its own arrows down
    if (tile?.defId === 'driveway_exit_hall') {
      this.worldState.ucx = this.worldState.UGRID - 1
      this.worldState.ucy = this.worldState.UGRID - 1
      this.transitionToArea('hall')
      return true
    }
    if (tile?.defId === 'driveway_exit_balcony') {
      this.transitionToArea('bedroom_lower', undefined, undefined, { x: MAP_W - 2, y: MAP_H - 3 })
      return true
    }
    if (tile?.defId === 'bedroom_exit') { this.transitionFromArea(); return true }
    if (tile?.defId === 'bedroom_stairs_down') {
      this.transitionToArea('bedroom_lower', 'down', this.player.x)
      return true
    }
    if (tile?.defId === 'bedroom_stairs_up') {
      this.transitionToArea('bedroom', 'up', this.player.x)
      return true
    }
    if (tile?.defId === 'stairs_exit_down' || tile?.defId === 'stairs_exit_up') {
      // Study ⇄ loft: bottom arrows land on the study's stairs, top arrows on the loft's trapdoor
      if (this.stairsOrigin === 'study' || this.stairsOrigin === 'loft') {
        if (tile.defId === 'stairs_exit_up') this.transitionToArea('loft')
        else this.transitionToArea('study', undefined, undefined, { x: MAP_W - 2, y: MAP_H - 2 })
        return true
      }
      // Ground-floor hall (bottom-left cell) ⇄ right upper hall
      if (this.stairsOrigin === 'hall' || this.stairsOrigin === 'upper_hall_right') {
        if (tile.defId === 'stairs_exit_up') {
          this.transitionToArea('upper_hall_right')
        } else {
          this.worldState.ucx = 0
          this.worldState.ucy = this.worldState.UGRID - 1
          this.transitionToArea('hall')
        }
        return true
      }
      this.transitionFromArea()
      return true
    }
    if (tile?.defId === 'garage_exit_down') { this.transitionToArea('garage_bottom', 'down', this.player.x); return true }
    if (tile?.defId === 'garage_exit_up') {
      if (this.worldState.currentArea === 'garage_top')    { this.transitionFromArea(); return true }
      if (this.worldState.currentArea === 'garage_bottom') { this.transitionToArea('garage_top', 'up', this.player.x); return true }
    }
    if (tile?.defId === 'portal_tub_enclosure') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('tub_enclosure')
      return true
    }
    if (tile?.defId === 'portal_loft') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('loft')
      return true
    }
    if (tile?.defId === 'portal_loft3') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('loft3')
      return true
    }
    if (tile?.defId === 'portal_pantry') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('pantry')
      return true
    }
    if (tile?.defId === 'pantry_exit') { this.transitionFromArea(); return true }
    if (tile?.defId === 'portal_study') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('study')
      return true
    }
    // Study ⇄ loft stairwell: study bottom arrow → stairs bottom; stairs top arrows ⇄ loft top arrows
    if (tile?.defId === 'study_exit') {
      this.transitionToArea('loft_stairs', undefined, undefined, { x: 2, y: MAP_H - 2 })
      return true
    }
    if (tile?.defId === 'loft_stairs_exit_down') {
      this.transitionToArea('study', undefined, undefined, { x: Math.floor(MAP_W / 2), y: MAP_H - 2 })
      return true
    }
    if (tile?.defId === 'loft_stairs_exit_up') {
      this.transitionToArea('loft', undefined, undefined, { x: this.player.x === MAP_W - 4 ? 44 : 45, y: 1 })
      return true
    }
    // Loft maze top arrows ⇄ Peter and the Wolf's bottom arrows
    if (tile?.defId === 'loft_exit_stairs') {
      this.transitionToArea('loft3', undefined, undefined, { x: this.player.x, y: MAP_H - 2 })
      return true
    }
    if (tile?.defId === 'portal_pond') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('pond1')
      return true
    }
    if (tile?.defId === 'pond_exit') { this.transitionFromArea(); return true }
    if (tile?.defId === 'loft_exit') { this.transitionFromArea(); return true }
    // Peter and the Wolf's left arrows: you fall all the way down into the top-left garden
    if (tile?.defId === 'loft3_exit') {
      this.sound.play('snd_falling')
      this.worldState.savedCx = 0
      this.worldState.savedCy = 0
      this.worldState.savedPlayerX = GARDEN_START.x
      this.worldState.savedPlayerY = GARDEN_START.y
      this.transitionFromArea()
      return true
    }
    if (tile?.defId === 'loft3_exit_down') {
      this.transitionToArea('loft', undefined, undefined, { x: this.player.x, y: 1 })
      return true
    }
    if (tile?.defId === 'tub_enclosure_exit') { this.transitionToArea('bathroom_bottom'); return true }
    if (tile?.defId === 'vortex_portal') {
      if (this.worldState.currentArea === 'tub_enclosure') { this.transitionToArea('bathroom_bottom', undefined, undefined, { x: 2, y: 9 }); return true }
      if (this.worldState.currentArea === 'bathroom_bottom') { this.transitionToArea('tub_enclosure'); return true }
    }
    if (tile?.defId === 'pond_exit_right') {
      if (this.worldState.currentArea === 'pond1') { this.transitionToArea('pond2'); return true }
      return true
    }
    if (tile?.defId === 'pond_exit_down') {
      if (this.worldState.currentArea === 'pond2') { this.transitionToArea('pond3', undefined, undefined, { x: 78, y: 1 }); return true }
      return true
    }
    if (tile?.defId === 'pond_exit_up') {
      if (this.worldState.currentArea === 'pond3') { this.transitionToArea('pond2', undefined, undefined, { x: 78, y: 18 }); return true }
      this.transitionToArea('pond1', undefined, undefined, { x: 77, y: 16 }); return true
    }
    if (tile?.defId === 'pond_exit_left') {
      if (this.worldState.currentArea === 'pond2') { this.transitionToArea('pond1', undefined, undefined, { x: 77, y: 16 }); return true }
      return true
    }

    if (tile?.defId === 'exit_kitchen') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('kitchen')
      return true
    }
    if (tile?.defId === 'exit_garage') {
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('garage_top', 'down', x)
      return true
    }
    if (tile?.defId === 'kitchen_exit') {
      this.worldState.ucx = 0
      this.worldState.ucy = 0
      this.transitionToArea('hall')
      return true
    }
    // Kitchen top arrows always lead up to the bottom-centre garden, beside its kitchen arrows
    if (tile?.defId === 'kitchen_exit_top') {
      this.worldState.savedCx = 1
      this.worldState.savedCy = 2
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = MAP_H - 2
      this.transitionFromArea()
      return true
    }
    return false
  }

  private tryDiveIntoPond(): void {
    const tile = this.mapSystem.getTile(this.player.x, this.player.y)
    if (tile?.defId === 'toilet' && this.hasToiletBrush()) {
      this.flushToilet()
    } else if (tile?.defId === 'portal_stairs') {
      this.stairsOrigin = this.worldState.currentArea
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('stairs')
    } else if (tile?.defId === 'water' && this.worldState.currentArea === null &&
        this.worldState.cx === 2 && this.worldState.cy === 0) {
      if (!this.player.hasSkill('diving')) {
        this.messageLog.add('You float on your Gompie, but you cannot dive.', '#80c0ff')
        return
      }
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('pond1')
    } else {
      this.messageLog.add('You need to be in the water to dive.', '#808080')
    }
  }

  private tryClimbStairsUp(): void {
    const tile = this.mapSystem.getTile(this.player.x, this.player.y)
    if (tile?.defId === 'portal_stairs_up') {
      this.stairsOrigin = this.worldState.currentArea
      this.worldState.savedPlayerX = this.player.x
      this.worldState.savedPlayerY = this.player.y
      this.transitionToArea('stairs', 'up')
    } else {
      this.messageLog.add('There is nothing here to climb up.', '#808080')
    }
  }

  private removeUnpaidAware(item: ItemInstance, player: Player): void {
    if (this.traderUnpaid.has(item.instanceId)) {
      this.traderUnpaidGhosts.set(item.instanceId, item)
    }
    this.inventory.removeFromInventory(player.inventory, item.instanceId)
  }

  private openExtinctionScroll(item: ItemInstance, player: Player, def: ItemDef): void {
    this.messageLog.add(`You read ${def.name}:`, '#c0c080')
    this.messageLog.add(`"${def.scrollText ?? def.description}"`, '#e0e060')
    this.inventoryScreen.hide()
    this.inputBlocked = true

    const bx = GAME_W / 2
    const by = GAME_H / 2
    const box = this.add.graphics()
      .fillStyle(0x1a1a1a, 0.95)
      .fillRect(bx - 340, by - 100, 680, 200)
      .setDepth(500)

    const title = this.add.text(bx, by - 60, 'Type the name of a race to erase from existence:', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)

    const hint = this.add.text(bx, by + 50, '[Enter] confirm    [Esc] cancel', {
      fontSize: '16px', color: '#888888', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)

    let typed = ''
    const inputText = this.add.text(bx, by, '_', {
      fontSize: '26px', color: '#ff6060', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(501)
    const refresh = () => inputText.setText(`${typed}_`)

    const cleanup = () => {
      box.destroy(); title.destroy(); inputText.destroy(); hint.destroy()
      this.input.keyboard!.off('keydown', onKey)
      this.inputBlocked = false
    }

    const consumeScroll = () => {
      if (item.quantity > 1) item.quantity--
      else this.removeUnpaidAware(item, player)
      this.messageLog.add('The scroll crumbles to dust.', '#808060')
    }

    const confirm = () => {
      const raw = typed.trim()
      cleanup()
      if (raw.length === 0) {
        this.messageLog.add('Nothing happens.', '#808060')
        this.endPlayerTurn()
        return
      }
      consumeScroll()

      const normalized = raw.toLowerCase()
      const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized
      if (singular === 'dinosaur') {
        this.gameOver('You went extinct')
        return
      }

      const matchedIds = new Set(
        (monsterData as MonsterDef[])
          .filter(d => {
            const name = d.name.toLowerCase()
            const nameSingular = name.endsWith('s') ? name.slice(0, -1) : name
            return name === normalized || nameSingular === singular || d.id.toLowerCase() === normalized
          })
          .map(d => d.id)
      )

      if (matchedIds.size === 0) {
        this.messageLog.add(`No creature named "${raw}" is known to this world.`, '#808060')
        this.endPlayerTurn()
        return
      }

      for (const id of matchedIds) this.worldState.extinctRaces.add(id)
      for (const m of this.monsters) if (matchedIds.has(m.defId)) this.turnManager.removeActor(m.id)
      this.monsters = this.monsters.filter(m => !matchedIds.has(m.defId))
      for (const snap of this.worldState.cellSnapshots.values()) {
        snap.monsters = snap.monsters.filter(m => !matchedIds.has(m.defId))
      }
      // Without the horse the hall falls silent, just as when it is poisoned
      if (matchedIds.has('paard')) {
        this.worldState.horseDead = true
        this.hallMusic?.stop()
      }

      this.messageLog.add(`${raw} have been wiped from existence.`, '#ff6060')
      // Wiping out a species weighs on the soul and tempts fate
      const wasLevel = player.moraleLevel()
      player.morale -= 2
      player.luck = Math.max(0, player.luck - 10)
      this.messageLog.add('A heavy feeling settles over you. (Luck -10)', '#a080c0')
      if (player.moraleLevel() !== wasLevel)
        this.messageLog.add(`Your morale sinks: you feel ${player.moraleLevel().toLowerCase()}.`, '#a080c0')
      this.statsPanel.update(player, this.turnManager.getTurn())
      this.endPlayerTurn()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); confirm(); return }
      if (event.key === 'Escape') {
        event.preventDefault()
        cleanup()
        this.messageLog.add('You decide not to read the scroll after all.', '#808060')
        return
      }
      if (event.key === 'Backspace') { event.preventDefault(); typed = typed.slice(0, -1); refresh(); return }
      if (event.key.length === 1 && /[a-zA-Z '-]/.test(event.key) && typed.length < 24) {
        typed += event.key
        refresh()
      }
    }

    this.input.keyboard!.on('keydown', onKey)
  }

  private forgiveIfUnpaid(item: ItemInstance): void {
    if (this.traderUnpaid.delete(item.instanceId)) {
      this.traderUnpaidGhosts.delete(item.instanceId)
      this.checkTraderDoor()
    }
  }

  private checkTraderDoor(): void {
    if (this.traderUnpaid.size === 0) {
      if (this.mapSystem.getTile(54, 11)?.defId === 'wall_down') {
        this.mapSystem.setTile(54, 11, 'door_closed')
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
    // Things on the bottom of the water need a diver to fetch them
    if (WATER_TILES.has(this.mapSystem.getTile(this.player.x, this.player.y)?.defId ?? '') && !this.player.hasSkill('diving')) {
      this.messageLog.add('Your short arms cannot reach the bottom.', '#4090d0')
      return
    }
    const fi = items[0]
    const def = this.inventory.getDef(fi.item.defId)
    if (fi.item.defId === 'gong' && !this.player.inventory.some(i => i.defId === 'gongmallet')) {
      this.messageLog.add('You need the Gong mallets to sound this gong.', '#c0c0c0')
      return
    }
    if (fi.item.defId === 'pannenkoek') {
      this.floorItems.splice(this.floorItems.indexOf(fi), 1)
      this.messageLog.add('You add the pancake back to your pile.', '#e0a060')
      this.endPlayerTurn()
      return
    }
    const inForestChamber = this.worldState.cx === 1 && this.worldState.cy === 1 &&
        this.worldState.currentArea === null &&
        this.player.x >= 51 && this.player.x <= 57 &&
        this.player.y >= 7 && this.player.y <= 10
    const inTraderChamber = inForestChamber || this.worldState.currentArea === 'pantry'
    if (def?.type === 'gold') {
      const amount = (def.goldValue ?? 1) * fi.item.quantity
      this.player.gold += amount
      this.messageLog.add(`You pick up ${amount} cents.`, '#ffcc00')
    } else {
      // Shop items stay separate so they can be paid for (or dropped back) one by one
      this.inventory.addToInventory(this.player.inventory, fi.item,
        inTraderChamber ? null : existing => !this.traderUnpaid.has(existing.instanceId))
    }
    this.floorItems.splice(this.floorItems.indexOf(fi), 1)
    if (fi.item.defId === 'gong') {
      this.messageLog.add('The gong BOOMS! A wave of power washes over the world!', '#ffd700')
      this.time.delayedCall(1200, () => this.triggerVictory())
      return
    }
    if (inTraderChamber) {
      if (def?.type !== 'gold') this.traderUnpaid.add(fi.item.instanceId)
      if (inForestChamber && this.mapSystem.getTile(54, 11)?.defId === 'door_closed') {
        this.mapSystem.setTile(54, 11, 'wall_down')
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
    // Unpaid shop items go back first, otherwise the last thing picked up
    const item = [...this.player.inventory].reverse().find(i => this.traderUnpaid.has(i.instanceId))
      ?? this.player.inventory[this.player.inventory.length - 1]
    this.inventory.removeFromInventory(this.player.inventory, item.instanceId)
    this.floorItems.push(new FloorItem(this.player.x, this.player.y, item))
    const name = this.inventory.getItemName(item)
    this.messageLog.add(`You drop the ${name}.`, '#c0c0c0')
    if (this.traderUnpaid.delete(item.instanceId)) this.checkTraderDoor()
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
    const zappable = this.player.inventory.filter(i => this.inventory.getDef(i.defId)?.type === 'wand')
    if (zappable.length === 0) {
      this.messageLog.add('You have nothing to zap with.', '#808080')
      return
    }
    if (zappable.length === 1) this.beginZap(zappable[0])
    else this.inventoryScreen.show(this.player, 'zap')
  }

  private beginZap(item: ItemInstance): void {
    // Generic wands from older saves turn into a real kind on first use
    if (item.defId === 'wand') {
      item.defId = this.inventory.randomWandId()
      item.charges = rollWandCharges()
    }
    // Remotes from older saves had no charges yet
    if (item.defId === 'remote' && item.charges === undefined) item.charges = REMOTE_CHARGES
    const def = this.inventory.getDef(item.defId)
    if (def?.wandEffect === 'evocation') {
      this.zapWand(item, 0, 0)
      return
    }
    this.pendingZapItem = item
    this.zapMode = true
    const selfHint = def?.wandEffect === 'displacement' ? ' (. = yourself)' : ''
    this.messageLog.add(`Zap the ${def?.name ?? 'wand'} in which direction?${selfHint}`, '#ff4080')
  }

  private zapWand(item: ItemInstance, dx: number, dy: number): void {
    const def = this.inventory.getDef(item.defId)
    if (!def?.wandEffect) return
    if ((item.charges ?? 0) <= 0) {
      this.messageLog.add(`You wave the ${def.name}, but it is out of charges. It disintegrates in your hand!`, '#808080')
      this.removeUnpaidAware(item, this.player)
      this.endPlayerTurn()
      return
    }
    if (def.wandEffect === 'tunneling' && this.traderUnpaid.size > 0 && this.isInShopArea()) {
      this.messageLog.add("You can't tunnel your way out while you owe cents.", '#808080')
      return
    }
    item.charges = (item.charges ?? 0) - 1
    switch (def.wandEffect) {
      case 'displacement': this.zapDisplacement(dx, dy); break
      case 'fire':         this.zapElementalRay(dx, dy, 'fire'); break
      case 'cold':         this.zapElementalRay(dx, dy, 'cold'); break
      case 'evocation':    this.zapEvocation(); break
      case 'tunneling':    this.zapTunneling(dx, dy); break
    }
  }

  // Walkable, unoccupied, non-transit tiles anywhere on the current map.
  // onWater: open water tiles instead of walkable ones (water isn't walkable).
  private freeSpots(filter: (x: number, y: number) => boolean = () => true, onWater = false): { x: number; y: number }[] {
    const spots: { x: number; y: number }[] = []
    for (let y = 0; y < this.mapSystem.height; y++)
      for (let x = 0; x < this.mapSystem.width; x++) {
        if (onWater ? this.mapSystem.getTile(x, y)?.defId !== 'water' : !this.mapSystem.isWalkable(x, y)) continue
        if (isSpecialTile(this.mapSystem.getTile(x, y)!.defId)) continue
        if (x === this.player.x && y === this.player.y) continue
        if (this.getMonsterAt(x, y)) continue
        if (filter(x, y)) spots.push({ x, y })
      }
    return spots
  }

  private randomSpot(spots: { x: number; y: number }[]): { x: number; y: number } | null {
    return spots.length > 0 ? spots[Math.floor(Math.random() * spots.length)] : null
  }

  // NPCs, the horse and other friendly/following monsters are untouched by wands
  private inPond(): boolean {
    const area = this.worldState.currentArea
    return area === 'pond1' || area === 'pond2' || area === 'pond3'
  }

  private isWandImmune(monster: Monster): boolean {
    return monster.npc || monster.defId === 'paard' || monster.aiType === 'friendly' || monster.aiType === 'follow'
  }

  private refreshMapViews(): void {
    this.updateFOV()
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
  }

  // Follows a wand ray for `range` tiles, reflecting off whatever blocks it. A tile
  // for which `stopAt` returns true ends the ray there (and is included in `tiles`).
  // throughTrees: the ray passes through living trees instead of bouncing off them.
  private traceBouncingRay(
    dx: number, dy: number, range: number,
    stopAt: (x: number, y: number) => boolean = () => false,
    throughTrees = false,
  ): { tiles: Array<{ x: number; y: number }>; waypoints: Array<{ x: number; y: number }>; bounced: boolean } {
    const passable = (x: number, y: number) => {
      const tile = this.mapSystem.getTile(x, y)
      return !!tile && (this.mapSystem.isWalkable(x, y) || tile.defId === 'water' || (throughTrees && tile.defId === 'tree'))
    }
    let x = this.player.x, y = this.player.y
    const tiles: Array<{ x: number; y: number }> = []
    const waypoints = [{ x, y }]
    const addWaypoint = () => {
      const last = waypoints[waypoints.length - 1]
      if (last.x !== x || last.y !== y) waypoints.push({ x, y })
    }
    let bounced = false
    for (let guard = 0; tiles.length < range && guard < 40; guard++) {
      if (stopAt(x + dx, y + dy)) {
        x += dx; y += dy
        tiles.push({ x, y })
        break
      }
      if (!passable(x + dx, y + dy)) {
        if (dx !== 0 && dy !== 0) {
          // Diagonal: flip whichever axis runs into the wall (both in a corner)
          const blockX = !passable(x + dx, y)
          const blockY = !passable(x, y + dy)
          if (blockX === blockY) { dx = -dx; dy = -dy }
          else if (blockX) dx = -dx
          else dy = -dy
        } else {
          dx = -dx; dy = -dy
        }
        if (!passable(x + dx, y + dy) && !stopAt(x + dx, y + dy)) { dx = -dx; dy = -dy }
        if (!passable(x + dx, y + dy) && !stopAt(x + dx, y + dy)) break  // boxed in
        addWaypoint()
        bounced = true
        continue
      }
      x += dx; y += dy
      tiles.push({ x, y })
    }
    addWaypoint()
    return { tiles, waypoints, bounced }
  }

  // Relocates the first monster, pile of items or tree the ray reaches — or the player,
  // when zapped at '.' or when the ray bounces back at them.
  private zapDisplacement(dx: number, dy: number): void {
    const color = '#c080ff'
    if (dx === 0 && dy === 0) {
      this.displacePlayer()
      return
    }
    const isTarget = (x: number, y: number) =>
      (x === this.player.x && y === this.player.y)
      || this.getMonsterAt(x, y) !== null
      || this.floorItems.some(fi => fi.x === x && fi.y === y)
      || ['tree', 'tree_dead'].includes(this.mapSystem.getTile(x, y)?.defId ?? '')
    const ray = this.traceBouncingRay(dx, dy, 8, isTarget)
    if (ray.bounced) this.messageLog.add('The ray bounces off the wall!', color)
    this.localMapView.animateBoltPath(ray.waypoints, color, () => {
      const end = ray.tiles[ray.tiles.length - 1]
      if (!end || !isTarget(end.x, end.y)) {
        this.messageLog.add('The wand hums, but nothing happens.', '#808080')
        this.endPlayerTurn()
        return
      }
      const { x: nx, y: ny } = end

      if (nx === this.player.x && ny === this.player.y) {
        this.displacePlayer()
        return
      }

      const monster = this.getMonsterAt(nx, ny)
      if (monster && this.isWandImmune(monster)) {
        this.messageLog.add(`The wand's energy flows harmlessly around ${monster.name}.`, '#80c080')
      } else if (monster) {
        const aquatic = monster.aiType === 'water_chase' || monster.aiType === 'water_wander'
        const spot = this.randomSpot(this.freeSpots(undefined, aquatic || this.inPond()))
        if (spot) {
          monster.x = spot.x
          monster.y = spot.y
          this.messageLog.add(`The ${monster.name} vanishes!`, color)
        } else {
          this.messageLog.add(`The ${monster.name} shimmers, but stays put.`, color)
        }
      } else if (this.floorItems.some(fi => fi.x === nx && fi.y === ny)) {
        const pile = this.floorItems.filter(fi => fi.x === nx && fi.y === ny)
        const spot = this.randomSpot(this.freeSpots(undefined, this.inPond()))
        if (spot) {
          for (const fi of pile) { fi.x = spot.x; fi.y = spot.y }
          this.messageLog.add(pile.length > 1 ? 'The items vanish!' : `The ${this.inventory.getItemName(pile[0].item)} vanishes!`, color)
        }
      } else {
        const treeId = this.mapSystem.getTile(nx, ny)!.defId
        const onGrass = this.freeSpots((x, y) => this.mapSystem.getTile(x, y)?.defId === 'grass'
          && !this.floorItems.some(fi => fi.x === x && fi.y === y))
        const spot = this.randomSpot(onGrass)
        if (spot) {
          this.mapSystem.setTile(nx, ny, 'grass')
          this.mapSystem.setTile(spot.x, spot.y, treeId)
          this.messageLog.add('The tree vanishes with a pop!', color)
        } else {
          this.messageLog.add('The tree shivers, but stays rooted.', color)
        }
      }
      this.refreshMapViews()
      this.endPlayerTurn()
    })
  }

  private displacePlayer(): void {
    const spot = this.randomSpot(this.freeSpots(undefined, this.inPond()))
    if (spot) {
      this.player.x = spot.x
      this.player.y = spot.y
      this.messageLog.add('You blink out of existence and reappear elsewhere!', '#c080ff')
    } else {
      this.messageLog.add('You shimmer for a moment, but stay put.', '#c080ff')
    }
    this.refreshMapViews()
    this.endPlayerTurn()
  }

  // A ray of fire or ice that bounces off walls, hitting everything along its path —
  // including the player when it comes back at them. A resistant player absorbs it.
  private zapElementalRay(dx: number, dy: number, kind: 'fire' | 'cold'): void {
    const color = kind === 'fire' ? '#ff6020' : '#80e0ff'
    const resists = kind === 'fire' ? this.hasHeatResistance() : this.hasColdResistance()
    const ray = this.traceBouncingRay(dx, dy, 12,
      (x, y) => resists && x === this.player.x && y === this.player.y, true)

    // Trees in the ray's path die; dead trees can be walked over
    const killedTrees = ray.tiles.filter(t => this.mapSystem.getTile(t.x, t.y)?.defId === 'tree')
    for (const t of killedTrees) this.mapSystem.setTile(t.x, t.y, 'tree_dead')

    const hits: Array<Monster | 'player'> = []
    for (const t of ray.tiles) {
      if (t.x === this.player.x && t.y === this.player.y) hits.push('player')
      const monster = this.getMonsterAt(t.x, t.y)
      if (monster) hits.push(monster)
    }

    this.messageLog.add(kind === 'fire' ? 'A ray of fire shoots from the wand!' : 'A ray of ice shoots from the wand!', color)
    if (ray.bounced) this.messageLog.add('The ray bounces off the wall!', color)
    if (killedTrees.length > 0)
      this.messageLog.add(kind === 'fire'
        ? (killedTrees.length === 1 ? 'A tree is scorched to death!' : 'The trees are scorched to death!')
        : (killedTrees.length === 1 ? 'A tree freezes to death!' : 'The trees freeze to death!'), color)
    this.localMapView.animateBoltPath(ray.waypoints, color, () => {
      const spared = new Set<Monster>()
      for (const target of hits) {
        const dmg = 4 + Math.floor(Math.random() * 7)  // 4-10
        if (target === 'player') {
          if (resists) {
            this.messageLog.add(kind === 'fire' ? 'The fire hits you, but you feel only a pleasant warmth. The ray dies out.' : 'The ice hits you, but you feel only a pleasant chill. The ray dies out.', color)
            break
          }
          if (this.isInvulnerable()) {
            this.messageLog.add(kind === 'fire' ? 'The fire washes over you harmlessly.' : 'The ice washes over you harmlessly.', color)
            continue
          }
          this.player.hp -= dmg
          this.messageLog.add(kind === 'fire' ? `The fire burns you! (-${dmg} HP)` : `The ice freezes you! (-${dmg} HP)`, color)
          if (!this.player.isAlive()) this.lastKilledBy = kind === 'fire' ? 'a wand of fire' : 'a wand of ice'
          continue
        }
        const monster = target
        if (!monster.isAlive()) continue
        if (this.isWandImmune(monster)) {
          if (!spared.has(monster)) this.messageLog.add(`The ray carefully bends around ${monster.name}.`, '#80c080')
          spared.add(monster)
          continue
        }
        // Dragons are four times as vulnerable to the opposite element
        const weak = (kind === 'cold' && monster.defId === 'firedragon') || (kind === 'fire' && monster.defId === 'icedragon')
        const mDmg = weak ? dmg * 4 : dmg
        monster.hp = Math.max(0, monster.hp - mDmg)
        if (kind === 'fire') {
          this.messageLog.add(`The fire burns the ${monster.name}!${weak ? ' It is super effective!' : ''} (${mDmg} dmg)`, color)
        } else {
          monster.stunTurns += 2
          this.messageLog.add(`The ice freezes the ${monster.name}!${weak ? ' It is super effective!' : ''} (${mDmg} dmg, frozen 2 turns)`, color)
        }
        if (!monster.isAlive()) {
          this.player.gainXP(monster.xpValue)
          this.removeMonster(monster)
          this.messageLog.add(`The ${monster.name} is slain!`, '#ff4040')
        }
      }
      if (hits.length === 0) this.messageLog.add('The ray fizzles out.', '#808080')
      this.statsPanel.update(this.player, this.turnManager.getTurn())
      this.endPlayerTurn()
    })
  }

  // Summons a few random monsters native to this area right around the player.
  private zapEvocation(): void {
    const category = areaInfo(this.worldState.currentArea ?? '').category
    // Pond levels summon water creatures into open water (Jormungand stays a one-off)
    const pond = this.inPond()
    const pool = pond ? ['vis', 'tetra', 'qivuit', 'lorkest', 'squid']
      : AREA_MONSTERS[category] ?? ['snail', 'rat', 'bat', 'wilddog', 'spirit', 'ogre']
    const near = this.freeSpots(undefined, pond)
      .sort((a, b) =>
        Math.max(Math.abs(a.x - this.player.x), Math.abs(a.y - this.player.y)) -
        Math.max(Math.abs(b.x - this.player.x), Math.abs(b.y - this.player.y)))
      .slice(0, 12)
    const count = Math.min(near.length, 2 + Math.floor(Math.random() * 3))  // 2-4
    for (let i = 0; i < count; i++) {
      const slot = near.splice(Math.floor(Math.random() * near.length), 1)[0]
      const defId = pool[Math.floor(Math.random() * pool.length)]
      this.spawnEntities([{ x: slot.x, y: slot.y, defId }], [])
    }
    this.messageLog.add(count > 0 ? 'The air tears open and monsters tumble out!' : 'The air ripples, but nothing comes through.', '#ff4040')
    this.refreshMapViews()
    this.endPlayerTurn()
  }

  // Wizards near the player now and then cast a spell: paralysis, or a hostile copy of the player.
  private wizardTurn(m: Monster): void {
    if (m.spellCooldown > 0) { m.spellCooldown--; return }
    if (m.stunTurns > 0 || this.player.allianceTurns > 0 || this.player.timestopTurns > 0) return
    if (!this.mapSystem.getTile(m.x, m.y)?.visible) return
    const dist = Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y))
    if (dist > 7 || Math.random() >= 0.15) return
    m.spellCooldown = 20
    if (Math.random() < 0.5) {
      if (this.isInvulnerable()) {
        this.messageLog.add('The Wizard casts a paralysis spell, but it washes over you harmlessly.', '#ffff80')
        return
      }
      const turns = 11 + Math.floor(Math.random() * 7)  // 11-17
      this.player.paralyzedTurns = Math.max(this.player.paralyzedTurns, turns)
      this.messageLog.add(`The Wizard casts a spell. You are paralyzed! (${turns} turns)`, '#c0a0ff')
      return
    }
    const spot = this.freeSpots((x, y) => Math.max(Math.abs(x - this.player.x), Math.abs(y - this.player.y)) <= 2)
    const slot = this.randomSpot(spot)
    if (!slot) return
    this.spawnEntities([{ x: slot.x, y: slot.y, defId: 'doppelganger' }], [])
    const copy = this.monsters[this.monsters.length - 1]
    if (copy?.defId === 'doppelganger') {
      copy.maxHp = copy.hp = Math.max(10, Math.round(this.player.maxHp / 2))
      copy.str = Math.round(this.player.str)
      copy.name = `Doppelganger ${this.player.name}`
    }
    this.messageLog.add('The Wizard waves his staff. A duplicate of you appears, and it fights for him!', '#ff8080')
  }

  // Summoners in sight of the player call in another monster from the local pool every 5 turns (at most 6 of their own at a time).
  private summonerTurn(m: Monster): void {
    if (m.stunTurns > 0 || this.player.timestopTurns > 0) return
    // Only summons while it can see the player (its tile is in the player's view)
    if (!this.mapSystem.getTile(m.x, m.y)?.visible) return
    if (++m.spellCooldown < SUMMON_INTERVAL) return
    m.spellCooldown = 0
    const alive = this.monsters.filter(o => o.summonedBy === m.id && o.isAlive()).length
    if (alive >= 6) return
    const category = areaInfo(this.worldState.currentArea ?? '').category
    const pool = AREA_MONSTERS[category] ?? ['spirit', 'ogre', 'wizard', 'magician', 'sorcerer']
    const spots = this.freeSpots((x, y) => Math.max(Math.abs(x - m.x), Math.abs(y - m.y)) <= 2)
    const slot = this.randomSpot(spots)
    if (!slot) return
    const defId = pool[Math.floor(Math.random() * pool.length)]
    this.spawnEntities([{ x: slot.x, y: slot.y, defId }], [])
    const summoned = this.monsters[this.monsters.length - 1]
    if (summoned?.defId !== defId) return
    summoned.summonedBy = m.id
    this.messageLog.add(`The Summoner chants. A ${summoned.name} appears!`, '#ff40ff')
  }

  // Magicians in sight now and then transmute one ordinary item in the player's
  // pack (worn items are out of the pack) into another of the same kind:
  // weapon to weapon, potion to potion. Relics, quest and rare items are safe.
  private magicianTurn(m: Monster): void {
    if (m.spellCooldown > 0) { m.spellCooldown--; return }
    if (m.stunTurns > 0 || this.player.allianceTurns > 0 || this.player.timestopTurns > 0) return
    if (!this.mapSystem.getTile(m.x, m.y)?.visible) return
    const dist = Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y))
    if (dist > 8 || Math.random() >= 0.3) return
    m.spellCooldown = 6 + Math.floor(Math.random() * 5)  // every 6-10 turns at most

    const defs = itemData as ItemDef[]
    const ordinary = (d: ItemDef | undefined): d is ItemDef => !!d && !d.relic && !EXCLUDE_IDS.has(d.id) &&
      !(d.id in this.QUEST_TARGETS) && !d.factScroll && !d.skillScroll && d.type !== 'gold' && d.type !== 'tool' &&
      !['remote', 'wand', 'speculaas_bad', 'pannenkoeken', 'ericgras', 'petergras', 'wasknijperbom'].includes(d.id)
    // Same kind of item; armour keeps its slot so it stays wearable in the same place
    const sameKind = (a: ItemDef, b: ItemDef) => a.type === b.type && (a.type !== 'armor' || a.slot === b.slot)
    const candidates = this.player.inventory.flatMap(item => {
      const def = this.inventory.getDef(item.defId)
      if (!ordinary(def) || this.traderUnpaid.has(item.instanceId)) return []
      const others = defs.filter(d => ordinary(d) && d.id !== def.id && sameKind(d, def))
      return others.length > 0 ? [{ item, others }] : []
    })
    if (candidates.length === 0) return
    const { item, others } = candidates[Math.floor(Math.random() * candidates.length)]
    const newDef = others[Math.floor(Math.random() * others.length)]
    item.defId = newDef.id
    if (newDef.wandEffect && item.charges === undefined) item.charges = rollWandCharges()
    this.messageLog.add('Your pack quivers.', '#c040ff')
  }

  // The most common plain walkable tile on this map (grass, floor, tiles, ...).
  private mapFloorTile(): string {
    const counts = new Map<string, number>()
    for (let y = 0; y < this.mapSystem.height; y++)
      for (let x = 0; x < this.mapSystem.width; x++) {
        if (!this.mapSystem.isWalkable(x, y)) continue
        const id = this.mapSystem.getTile(x, y)!.defId
        if (isSpecialTile(id)) continue
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    let best = 'floor', bestCount = 0
    for (const [id, n] of counts) if (n > bestCount) { best = id; bestCount = n }
    return best
  }

  // Blasts a walkable strip through anything in the zap's direction (map border excluded).
  private zapTunneling(dx: number, dy: number): void {
    const floor = this.inPond() ? 'water' : this.mapFloorTile()
    const indestructible = ['muur_up_t', 'muur_down_t', 'muur_left_t', 'muur_right_t',
      'muur_corner_tl_t', 'muur_corner_tr_t', 'muur_corner_bl_t', 'muur_corner_br_t']
    let dug = 0
    let endX = this.player.x + dx
    let endY = this.player.y + dy
    for (let i = 1; i <= 10; i++) {
      const nx = this.player.x + dx * i
      const ny = this.player.y + dy * i
      const tile = this.mapSystem.getTile(nx, ny)
      if (!tile || indestructible.includes(tile.defId)) break
      if (nx <= 0 || ny <= 0 || nx >= this.mapSystem.width - 1 || ny >= this.mapSystem.height - 1) {
        // The border only gives way where an adjacent map lies beyond it
        const edgeExit = this.edgeExitFor(nx, ny)
        if (edgeExit && !this.mapSystem.isWalkable(nx, ny)) {
          this.placeDugExit(nx, ny, edgeExit)
          endX = nx
          endY = ny
          dug++
        }
        break
      }
      if (this.isTraderChamberWall(nx, ny)) break
      endX = nx
      endY = ny
      if (!this.mapSystem.isWalkable(nx, ny) && tile.defId !== floor) {
        this.mapSystem.setTile(nx, ny, floor)
        dug++
      }
    }
    this.localMapView.animateBolt(this.player.x, this.player.y, endX, endY, '#c0a060', () => {
      this.messageLog.add(dug > 0 ? 'The wand blasts a tunnel through the obstacles!' : 'The wand has no effect on this material.', '#c0a060')
      this.refreshMapViews()
      this.endPlayerTurn()
    })
  }

  private zapRay(item: ItemInstance, dx: number, dy: number): void {
    if ((item.charges ?? 0) <= 0) {
      this.messageLog.add('You press the buttons, but nothing happens. The batteries are dead.', '#808080')
      this.endPlayerTurn()
      return
    }
    item.charges = (item.charges ?? 0) - 1
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

  // Strength 18 throws 2 tiles, each full point above that one more (max 11);
  // heavy items fly half their weight shorter
  private throwDistance(weight: number): number {
    return Math.min(11, Math.max(1, Math.floor(this.player.str) - 16 - Math.floor(weight / 2))) + this.shootingBonus()
  }

  // A katapult held for shooting adds this to both throw distance and thrown damage
  private shootingBonus(): number {
    return this.player.equipment.launcher?.defId === 'katapult' ? 2 : 0
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
      const maxDist = this.throwDistance(def.weight ?? 0)
      let landX = this.player.x
      let landY = this.player.y
      let directHit = false
      for (let i = 1; i <= maxDist; i++) {
        const nx = this.player.x + dx * i
        const ny = this.player.y + dy * i
        const tile = this.mapSystem.getTile(nx, ny)
        if (!tile || (!this.mapSystem.isWalkable(nx, ny) && tile.defId !== 'water')) break
        landX = nx
        landY = ny
        // A hostile in the way takes the full hit and the banana bursts right there
        const target = this.getMonsterAt(nx, ny)
        if (target && !target.npc && target.aiType !== 'friendly' && target.aiType !== 'follow') {
          directHit = true
          break
        }
      }
      this.inventory.removeFromInventory(this.player.inventory, item.instanceId)
      this.forgiveIfUnpaid(item)
      this.messageLog.add('You throw the banana!', '#ffee00')
      this.localMapView.animateThrow(
        'banaan',
        this.player.x, this.player.y,
        landX, landY,
        () => this.bananaExplode(landX, landY, true, () => this.endPlayerTurn(), directHit ? (def.damage ?? 10) + this.shootingBonus() : 3),
      )
      return
    }

    // From a stack (e.g. shurikens) only one is thrown
    if (item.quantity > 1) {
      item.quantity--
      const one = this.inventory.createInstance(item.defId, 1)
      one.quality = item.quality
      this.throwWeapon(one, dx, dy)
      return
    }

    const maxDist = this.throwDistance(def.weight ?? 0)

    this.inventory.removeFromInventory(this.player.inventory, item.instanceId)
    this.forgiveIfUnpaid(item)

    let landX = this.player.x
    let landY = this.player.y
    // Hit messages are held back so they follow the "You throw ..." line
    const hitMsgs: Array<[string, string]> = []

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
        hitMsgs.push([`You kindly throw the ${def.name} around ${monster.name}.`, '#80c080'])
      } else if (monster) {
        if (item.defId === 'pannenkoek') {
          monster.stunTurns = 3
          hitMsgs.push([`The pannenkoek splats over ${monster.name}'s face! (blinded 3 turns)`, '#e0a060'])
          landX = nx; landY = ny
          break
        } else if (item.defId === 'mispel') {
          hitMsgs.push([`The mispel splatters on the ${monster.name}!`, '#806040'])
          landX = nx; landY = ny
          break
        } else if (monster.rolled) {
          hitMsgs.push([`The ${def.name} bounces off the rolled-up ${monster.name}.`, '#a0a0a0'])
        } else if (Math.random() * 100 >= playerHitChance(this.player, monster)) {
          hitMsgs.push([`The ${def.name} misses the ${monster.name}.`, '#a0a0a0'])
        } else {
          let dmg = Math.max(1, itemDamage(def, item)) + this.shootingBonus()
          if (item.defId === 'silversword' && monster.defId === 'werewolf') dmg = Math.max(dmg, monster.hp)
          monster.hp = Math.max(0, monster.hp - dmg)
          hitMsgs.push([`The ${def.name} hits the ${monster.name}! (${dmg} dmg)`, '#ff8040'])
          if (!monster.isAlive()) {
            this.removeMonster(monster)
            hitMsgs.push([`The ${monster.name} is slain!`, '#ff4040'])
          }
        }
      }

      if (isWater) break
    }

    // mispel always disappears after throw (splashes)
    if (item.defId === 'mispel') {
      this.messageLog.add(`You throw the ${def.name}. It splatters and disappears.`, '#806040')
      for (const [m, c] of hitMsgs) this.messageLog.add(m, c)
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
    for (const [m, c] of hitMsgs) this.messageLog.add(m, c)

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

  private bananaExplode(x: number, y: number, spawnSubs: boolean, onDone: () => void, dmg = 3): void {
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

  // A split-off banana flies up to 5 tiles; like the first one, it bursts on the
  // first hostile in its way with a full hit.
  private throwBananaFrom(fromX: number, fromY: number, dx: number, dy: number, onDone: () => void): void {
    let landX = fromX
    let landY = fromY
    let directHit = false
    for (let i = 1; i <= 5; i++) {
      const nx = fromX + dx * i
      const ny = fromY + dy * i
      const tile = this.mapSystem.getTile(nx, ny)
      if (!tile || (!this.mapSystem.isWalkable(nx, ny) && tile.defId !== 'water')) break
      landX = nx
      landY = ny
      const target = this.getMonsterAt(nx, ny)
      if (target && !target.npc && target.aiType !== 'friendly' && target.aiType !== 'follow') {
        directHit = true
        break
      }
    }
    const dmg = directHit ? (this.inventory.getDef('banaan')?.damage ?? 10) : 3
    this.localMapView.animateThrow('banaan', fromX, fromY, landX, landY,
      () => this.bananaExplode(landX, landY, false, onDone, dmg),
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
    this.stairsMusic?.stop()
    this.defeatMusic?.stop()
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

  // Rex tumbles from the sky onto the garden splash's path, timed to the falling sound
  private tumbleRexOntoOverlay(durationMs: number): void {
    if (!this.locationOverlay) return
    const size = 128
    const rex = this.add.image(GAME_W * 0.45, -size, 'player')
      .setDisplaySize(size, size)
      .setDepth(1101)
    this.locationOverlayExtras.push(rex)
    const groundY = GAME_H * 0.86 - size / 2
    const fallMs = durationMs * 0.85
    this.tweens.add({ targets: rex, y: groundY, duration: fallMs, ease: 'Quad.easeIn' })
    this.tweens.add({
      targets: rex, angle: 720, duration: fallMs, ease: 'Linear',
      onComplete: () => {
        // Squash on impact, then pop back upright
        const sx = rex.scaleX, sy = rex.scaleY
        rex.setAngle(0)
        this.tweens.add({
          targets: rex, scaleX: sx * 1.3, scaleY: sy * 0.7, y: groundY + size * 0.15,
          duration: Math.max(80, durationMs * 0.07), yoyo: true, ease: 'Quad.easeOut',
        })
      },
    })
  }

  private hideLocationOverlay(): void {
    this.locationOverlay?.destroy()
    this.locationOverlay = null
    for (const o of this.locationOverlayExtras) { this.tweens.killTweensOf(o); o.destroy() }
    this.locationOverlayExtras = []
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
    if (area === 'upper_hall_left' || area === 'upper_hall_right') return 'upper_hall'
    return area
  }

  // Leaning on the crutch: 10 turns tick by slowly while the player can't act.
  private takeCrutchBreak(): void {
    this.messageLog.add('You ignore the pressing time and take a well earned break.', '#c0a060')
    this.inputBlocked = true
    let left = 10
    const tick = () => {
      if (this.player.hp <= 0) return
      this.endPlayerTurn()
      left--
      if (left > 0 && this.player.hp > 0) this.time.delayedCall(400, tick)
      else if (this.player.hp > 0) this.inputBlocked = false
    }
    this.time.delayedCall(400, tick)
  }

  private hasToiletBrush(): boolean {
    return this.player.inventory.some(i => i.defId === 'toiletBrush')
  }

  // A Gompie in the pack lets the player float over water (but not swim or dive)
  private hasGompie(): boolean {
    return this.player.inventory.some(i => i.defId === 'gompie')
  }

  // Flushing with the toilet brush: the player is stuck while the sound plays,
  // and a turn passes every 250 ms until it ends.
  // Telephone: a Teams call to Sas shown fullscreen. Keys are ignored while the
  // call plays out; once the last screen has shown for 5 s, any key hangs up.
  private playPhoneCall(): void {
    this.messageLog.add('You pick up the telephone and dial...', '#ff8080')
    this.inputBlocked = true
    this.phoneHangUpReady = false
    const img = this.add.image(0, 0, 'call_teams_start').setOrigin(0, 0)
      .setDisplaySize(GAME_W, GAME_H).setDepth(1100)
    this.phoneOverlay = img
    const show = (key: string) => img.setTexture(key).setDisplaySize(GAME_W, GAME_H)
    this.time.delayedCall(1000, () => {
      show('call_teams')
      this.phoneSound = this.sound.add('sfx_teams')
      this.phoneSound.play()
      this.time.delayedCall(2000, () => {
        show('call_sas_skype')
        this.time.delayedCall(5000, () => { this.phoneHangUpReady = true })
      })
    })
  }

  private hangUpPhone(): void {
    this.phoneSound?.stop()
    this.phoneSound?.destroy()
    this.phoneSound = null
    this.phoneOverlay?.destroy()
    this.phoneOverlay = null
    this.phoneHangUpReady = false
    this.inputBlocked = false
  }

  private flushToilet(): void {
    this.messageLog.add('You give the toilet a thorough scrub and pull the chain.', '#c0c040')
    this.inputBlocked = true
    const snd = this.sound.add('sfx_toilet')
    let playing = true
    snd.once('complete', () => { playing = false; snd.destroy() })
    snd.play()
    const tick = () => {
      if (this.player.hp <= 0) { snd.stop(); snd.destroy(); return }
      if (!playing) { this.inputBlocked = false; return }
      this.endPlayerTurn()
      this.time.delayedCall(250, tick)
    }
    this.time.delayedCall(250, tick)
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

  private hasColdResistance(): boolean {
    return Object.values(this.player.equipment).some(
      item => item && this.inventory.getDef(item.defId)?.coldResistance === true
    )
  }

  private isInvulnerable(): boolean {
    return this.godMode || this.player.invulnerableTurns > 0
  }

  private hasFamineRing(): boolean {
    return Object.values(this.player.equipment).some(item => item?.defId === 'ring_famine')
  }

  private hasLocusRing(): boolean {
    return Object.values(this.player.equipment).some(item => item?.defId === 'ring_locus')
  }

  private teleportRandomly(): void {
    const player = this.player
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

  // Ring of Locus Mastery: teleport to the clicked world-map tile, or randomly
  // when the spot is unsuitable (off-map, blocked, occupied or a transit tile).
  private resolveTeleportPick(pos: { tx: number; ty: number } | null): void {
    this.teleportPicking = false
    const tile = pos ? this.mapSystem.getTile(pos.tx, pos.ty) : null
    const suitable = pos !== null && tile !== null
      && this.mapSystem.isWalkable(pos.tx, pos.ty)
      && this.getMonsterAt(pos.tx, pos.ty) === null
      && !isSpecialTile(tile.defId)
      && !(pos.tx === this.player.x && pos.ty === this.player.y)
    if (suitable) {
      this.player.x = pos.tx
      this.player.y = pos.ty
      this.messageLog.add('You vanish in a flash of light and reappear exactly where you wanted!', '#c080ff')
    } else {
      if (pos) this.messageLog.add('That spot is not suitable. The magic takes over.', '#808080')
      this.teleportRandomly()
    }
    this.endPlayerTurn()
  }

  private static readonly HEAT_RESISTANT_MONSTERS = new Set(['firedragon'])

  // 5x5 around the player (never the player's own tile); each eligible tile
  // turns to lava on a ~59% roll.
  private lavaStrike(): void {
    const { x: px, y: py } = this.player
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue
        const tile = this.mapSystem.getTile(px + dx, py + dy)
        if (!tile || !this.mapSystem.isWalkable(px + dx, py + dy) || isSpecialTile(tile.defId)) continue
        if (Math.random() < 0.59) this.mapSystem.setTile(px + dx, py + dy, 'lava')
      }
    }
    this.messageLog.add('Lava comes streaming out of the heavens.', '#ff4000')
    // Monsters caught under the falling lava get burned, unless they shrug off heat
    for (const m of [...this.monsters]) {
      if (!m.isAlive() || this.mapSystem.getTile(m.x, m.y)?.defId !== 'lava') continue
      if (this.isWandImmune(m)) continue
      if (GameScene.HEAT_RESISTANT_MONSTERS.has(m.defId)) {
        this.messageLog.add(`The ${m.name} bathes in the lava unharmed.`, '#ff8040')
        continue
      }
      const dmg = 20 + Math.floor(Math.random() * 11)  // 20-30
      m.hp = Math.max(0, m.hp - dmg)
      this.messageLog.add(`The lava scorches the ${m.name}! (${dmg} dmg)`, '#ff4000')
      if (!m.isAlive()) {
        this.player.gainXP(m.xpValue)
        this.removeMonster(m)
        this.messageLog.add(`The ${m.name} is slain!`, '#ff4040')
      }
    }
  }

  private makeClothespinTrap(): void {
    const inv = this.player.inventory
    const pins = inv.filter(it => it.defId === 'wasknijper')
    if (pins.reduce((n, it) => n + it.quantity, 0) < 2) {
      this.messageLog.add('You do not have the tools of your trade.', '#808080')
      return
    }
    // One trap takes two clothespins
    let need = 2
    for (const pin of pins) {
      if (need === 0) break
      const take = Math.min(need, pin.quantity)
      need -= take
      if (take < pin.quantity) pin.quantity -= take
      else this.removeUnpaidAware(pin, this.player)
    }
    this.inventory.addToInventory(inv, this.inventory.createInstance('wasknijperbom'))
    this.messageLog.add('You carefully rig two Clothespins into a Clothespin Trap.', '#ffd080')
    this.endPlayerTurn()
  }

  // Dad hums the Smurf tune once each time he comes into view, unless other
  // audio (music included) is already playing. Louder the closer he is:
  // full volume right next to you, silent from 7 tiles away.
  private checkDadInSight(): void {
    const dad = this.monsters.find(m => m.defId === 'pap2' && m.isAlive())
    const seen = !!dad && this.player.blindTurns <= 0 && !!this.mapSystem.getTile(dad.x, dad.y)?.visible
    const dist = dad ? Math.max(Math.abs(dad.x - this.player.x), Math.abs(dad.y - this.player.y)) : Infinity
    const volume = Phaser.Math.Clamp((7 - dist) / 6, 0, 1)
    if (seen && !this.dadInSight && this.sound.getAllPlaying().length === 0) {
      this.smurfSound?.destroy()
      this.smurfSound = this.sound.add('sfx_smurf', { volume })
      this.smurfSound.once('complete', () => { this.smurfSound?.destroy(); this.smurfSound = null })
      this.smurfSound.play()
    } else if (this.smurfSound?.isPlaying) {
      (this.smurfSound as Phaser.Sound.WebAudioSound).setVolume(volume)
    }
    this.dadInSight = seen
  }

  // A Clothespin Trap lying on the floor snaps shut on whoever steps onto it and
  // is used up. Monsters always spring it; you know it's there, so only 10% of the time.
  private checkClothespinTraps(): void {
    const playerTile = `${this.currentMapKey()}:${this.player.x},${this.player.y}`
    const playerStepped = playerTile !== this.lastPlayerTile
    this.lastPlayerTile = playerTile
    const monsterTiles = new Map(this.monsters.map(m => [m.id, `${m.x},${m.y}`]))
    const prevMonsterTiles = this.lastMonsterTiles
    this.lastMonsterTiles = monsterTiles

    const trapAt = (x: number, y: number) => this.floorItems.find(fi => fi.item.defId === 'wasknijperbom' && fi.x === x && fi.y === y)
    if (!this.floorItems.some(fi => fi.item.defId === 'wasknijperbom')) return
    const dmg = this.inventory.getDef('wasknijperbom')?.damage ?? 30
    const spring = (fi: FloorItem) => {
      if (fi.item.quantity > 1) fi.item.quantity--
      else this.floorItems.splice(this.floorItems.indexOf(fi), 1)
    }

    const underPlayer = playerStepped ? trapAt(this.player.x, this.player.y) : undefined
    if (underPlayer && Math.random() < OWN_TRAP_CHANCE) {
      spring(underPlayer)
      if (this.isInvulnerable()) {
        this.messageLog.add('The Clothespin Trap snaps shut on you, but you feel nothing.', '#ffff80')
      } else {
        this.player.hp = Math.max(0, this.player.hp - dmg)
        this.messageLog.add(`Oops! You step on your own Clothespin Trap! (-${dmg} HP)`, '#ff8000')
        if (!this.player.isAlive()) this.lastKilledBy = 'a Clothespin Trap'
      }
    }

    for (const m of [...this.monsters]) {
      if (!m.isAlive() || this.isWandImmune(m)) continue
      if (prevMonsterTiles.get(m.id) === monsterTiles.get(m.id)) continue
      const trap = trapAt(m.x, m.y)
      if (!trap) continue
      spring(trap)
      m.hp = Math.max(0, m.hp - dmg)
      this.messageLog.add(`The Clothespin Trap snaps shut on the ${m.name}! (${dmg} dmg)`, '#ff8000')
      if (!m.isAlive()) {
        this.player.gainXP(m.xpValue)
        this.removeMonster(m)
        this.messageLog.add(`The ${m.name} is slain!`, '#ff4040')
      }
    }
  }

  // ─── Turn management ────────────────────────────────────────────────────────

  private useVentriloquism(): void {
    const player = this.player
    const CHASE_TYPES = new Set(['chase', 'water_chase', 'guard', 'kamikaze', 'split'])
    const affected = this.monsters.filter(m => {
      if (!m.isAlive() || !CHASE_TYPES.has(m.aiType)) return false
      const dist = Math.abs(m.x - player.x) + Math.abs(m.y - player.y)
      return dist <= 10
    })
    if (affected.length === 0) {
      this.messageLog.add('You throw your voice, but no monsters are near enough to fool.', '#808080')
    } else {
      for (const m of affected) m.confuseTurns = 2
      this.messageLog.add('You throw your voice! Nearby monsters stumble off in confusion.', '#40ffff')
    }
    this.endPlayerTurn()
  }

  // The blocking horse stepped onto the player in its row: shove them back to
  // the side they came from, so it can't be slipped past diagonally either way.
  // Straight off the horse if that tile is free, otherwise back where they stepped from.
  private pushOffHorse(horse: Monster): void {
    if (horse.x !== this.player.x || horse.y !== this.player.y) return
    const prev = this.preMove
    const y = horse.y + (prev && prev.y > horse.y ? 1 : -1)
    const free = (x: number, y: number) => this.mapSystem.isWalkable(x, y) && this.getMonsterAt(x, y) === null
    if (free(horse.x, y)) {
      this.player.y = y
    } else if (prev && prev.y !== horse.y && free(prev.x, prev.y)) {
      this.player.x = prev.x
      this.player.y = prev.y
    } else {
      const side = [-1, 0, 1].map(dx => ({ x: horse.x + dx, y })).find(p => free(p.x, p.y))
      if (!side) return
      this.player.x = side.x
      this.player.y = side.y
    }
    this.updateFOV()
  }

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
      if (this.player.phasingTurns === 5) this.messageLog.add('Reality is catching up with you. You will solidify soon!', '#ff8080')
      if (this.player.phasingTurns === 0) {
        const onWater = WATER_TILES.has(this.mapSystem.getTile(this.player.x, this.player.y)?.defId ?? '')
        if (!onWater && !this.mapSystem.isWalkable(this.player.x, this.player.y) && !this.isInvulnerable()) {
          this.lastKilledBy = 'solidifying with your surroundings'
          this.messageLog.add('You solidify with your surroundings!', '#ff0000')
          if (this.player.secondLife) {
            this.player.secondLife = false
            this.player.hp = this.player.maxHp
            this.messageLog.add('The Gods decided to give you a second chance.', '#ffd080')
          } else {
            this.player.hp = 0
            this.gameOver('Solidified with your surroundings')
          }
        } else {
          this.messageLog.add('You feel solid again.', '#c0c0ff')
        }
      }
    }
    if (this.player.blindTurns > 0) {
      this.player.blindTurns--
      if (this.player.blindTurns === 0) this.messageLog.add('Your vision clears.', '#c0c0c0')
    }
    if (this.player.werewolfTurns > 0) {
      this.player.werewolfTurns--
      if (this.player.werewolfTurns === 0) this.endWerewolfForm()
    } else if (this.player.lycanthropy && this.player.lycanthropyCountdown > 0) {
      this.player.lycanthropyCountdown--
      if (this.player.lycanthropyCountdown === 0) {
        this.player.werewolfTurns = 40
        this.player.preWerewolfSpriteKey = this.player.spriteKey
        this.player.spriteKey = 'monster_werewolf'
        this.messageLog.add('Your bones crack and fur sprouts from your skin. You turn into a werewolf!', '#c06030')
      }
    }
    if (this.player.translucenceTurns > 0) {
      this.player.translucenceTurns--
      if (this.player.translucenceTurns === 0) this.messageLog.add('You fade back into full view.', '#c0c0ff')
    }
    if (this.player.invulnerableTurns > 0) {
      this.player.invulnerableTurns--
      if (this.player.invulnerableTurns === 0) this.messageLog.add('The invulnerability wears off.', '#ffff80')
    }
    if (this.player.speedTurns > 0) {
      this.player.speedTurns--
      if (this.player.speedTurns === 0) {
        this.player.speed -= this.player.speedPotionBonus
        this.player.speedPotionBonus = 0
        this.messageLog.add('You feel yourself slow down.', '#ffff40')
      }
    }
    this.player.energy -= 100
    // Leftover energy means an extra player turn before the world ticks: the
    // player's own per-step checks (items underfoot, lava, ...) still run.
    const extraTurn = this.player.energy >= 100
    if (extraTurn) {
      // The blocking horse still shadows every step, so speed can't outrun it.
      const blocker = this.monsters.find(m => m.defId === 'paard' && m.aiType !== 'follow' && m.isAlive())
      if (blocker) {
        blocker.takeTurn()
        this.pushOffHorse(blocker)
      }
    } else {
      // World ticks until player accumulates enough energy to act again
      while (this.player.energy < 100) {
        this.turnManager.processTurn()
      }
      const horse = this.monsters.find(m => m.defId === 'paard' && m.aiType !== 'follow' && m.isAlive())
      if (horse) this.pushOffHorse(horse)
      for (const m of [...this.monsters]) {
        if (!m.isAlive()) this.removeMonster(m)
      }
      const tick = this.turnManager.getTurn()
      if (tick % 3 === 0 && this.player.hp < this.player.maxHp) {
        this.player.hp = Math.min(this.player.hp + 1, this.player.maxHp)
      }
      if (tick % 15 === 0 && this.player.food > 0) this.getHungrier()
      if (tick % 5 === 0 && this.player.food > 0 && this.hasFamineRing()) this.getHungrier()
    }
    // Bananas fall once per player action, whatever the player's speed
    if (this.worldState.currentArea === 'stairs') this.advanceBombs()
    const turn = this.turnManager.getTurn()
    if (this.mapSystem.getTile(this.player.x, this.player.y)?.defId === 'flame' && !this.hasHeatResistance() && !this.isInvulnerable()) {
      this.messageLog.add('The pentagram flames scorch you! (-10 HP)', '#ff4000')
      this.player.hp -= 10
      if (!this.player.isAlive()) this.lastKilledBy = 'pentagram flames'
    }
    if (this.mapSystem.getTile(this.player.x, this.player.y)?.defId === 'lava' && !this.hasHeatResistance() && !this.isInvulnerable()) {
      this.messageLog.add('PAPAPICHOU!!', '#ff0000')
      this.player.hp -= 50
      if (!this.player.isAlive()) this.lastKilledBy = 'lava'
    }
    const legoHere = this.floorItems.find(fi =>
      fi.x === this.player.x && fi.y === this.player.y &&
      this.inventory.getDef(fi.item.defId)?.lego
    )
    if (legoHere && !this.isInvulnerable()) {
      const legoDef = this.inventory.getDef(legoHere.item.defId)
      this.player.hp = Math.max(0, this.player.hp - LEGO_DAMAGE)
      this.messageLog.add(`You step on the ${legoDef?.name ?? 'lego brick'}! OUCH! (-${LEGO_DAMAGE} HP)`, '#ffff40')
      if (!this.player.isAlive()) this.lastKilledBy = 'lego brick'
    }
    this.checkClothespinTraps()
    this.checkDadInSight()
    if (this.player.speed >= 300) {
      if (!this.speedWarned) this.messageLog.add('You are moving dangerously fast!', '#ff8040')
      this.speedWarned = true
    } else {
      this.speedWarned = false
    }
    if (!extraTurn && this.worldState.currentArea === 'bathroom_bottom') this.floodBathroom()
    if (this.worldState.currentArea === 'chaos') {
      mutateChaosMap(this.mapSystem, this.player.x, this.player.y)
      this.circleWidget()
    }
    this.localMapView.render(this.player, this.monsters, this.floorItems, this.corpses)
    if (this.worldState.currentArea === 'stairs') this.localMapView.renderBombs(this.stairsBombs)
    this.worldMapView.render(this.player, this.monsters, this.floorItems, this.worldState.currentArea === 'garage_top' || this.worldState.currentArea === 'garage_bottom', this.worldState.currentArea === 'stairs')
    this.statsPanel.update(this.player, turn)
    if (this.inventoryScreen.isVisible()) this.inventoryScreen.refresh(this.player)
    this.checkDuckMessages()
    this.scheduleWerewolfMove()
    this.checkSasHorseWalk()
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

  // Food drops by one; warnings come as it runs low, death when it runs out.
  private getHungrier(): void {
    this.player.food = Math.max(0, this.player.food - 1)
    const food = this.player.food
    if (food === 0) {
      if (this.isInvulnerable()) return
      this.messageLog.add('You are starving to death!', '#ff4000')
      this.player.hp = 0
      this.lastKilledBy = 'starvation'
    } else if (food === 25) {
      this.messageLog.add('You are getting hungry.', '#ffc040')
    } else if (food === 10) {
      this.messageLog.add('You are very hungry. You should eat something soon!', '#ff8040')
    } else if (food <= 5) {
      this.messageLog.add(`You are starving! Eat something now! (food ${food})`, '#ff4000')
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
    if (this.traderUnpaid.size > 0 && this.isInShopArea()) {
      this.messageLog.add("You can't dig your way out while you owe cents.", '#808080')
      return
    }
    const indestructible = ['muur_up_t', 'muur_down_t', 'muur_left_t', 'muur_right_t',
      'muur_corner_tl_t', 'muur_corner_tr_t', 'muur_corner_bl_t', 'muur_corner_br_t']
    if (tile && indestructible.includes(tile.defId)) {
      this.messageLog.add('These walls cannot be destroyed.', '#808080')
      return
    }
    const diggable = ['wall', 'wall_up', 'wall_down', 'wall_left', 'wall_right', 'wall_corner_tl', 'wall_corner_tr', 'wall_corner_bl', 'wall_corner_br', 'tree', 'tree_dead', 'hall_wall', 'void', 'kraan', 'waterbodem']
    const inUpperHall = this.worldState.currentArea === 'upper_hall_left' || this.worldState.currentArea === 'upper_hall_right'
    if ((tile?.defId === 'void' && !inUpperHall && !this.inPond()) ||
        (tile?.defId === 'waterbodem' && !this.inPond())) {
      this.messageLog.add('There is nothing to dig there.', '#808080')
      return
    }
    // The map edge only gives way where an adjacent map lies beyond it
    if ((tx <= 0 || ty <= 0 || tx >= MAP_W - 1 || ty >= MAP_H - 1) && !this.edgeExitFor(tx, ty)) {
      this.messageLog.add('The outer wall is too solid to dig through.', '#808080')
      return
    }
    // Room walls that lead next door (EDGE_LINKS) give way whatever they're made of
    const side = this.edgeSideOf(tx, ty)
    const linkedWall = !!side && !!this.edgeLinkFrom(side)
    if (!tile || (!diggable.includes(tile.defId) && !linkedWall)) {
      this.messageLog.add('There is nothing to dig there.', '#808080')
      return
    }
    this.digProgress = { dx, dy, turnsLeft: 10 }
    this.messageLog.add('You start digging...', '#c0a040')
    this.endPlayerTurn()
  }

  // Arrow exit to place when digging out through the map edge at (x, y):
  // a copy of an arrow already on that edge, so it leads to the same next map.
  // Only the garden, hall (ground and upper) and pond maps qualify, plus the
  // room walls in EDGE_LINKS (a plain arrow, followed by enterTransitTile); corners never do.
  private edgeExitFor(x: number, y: number): string | undefined {
    const side = this.edgeSideOf(x, y)
    if (!side) return undefined
    if (this.edgeLinkFrom(side)) return `exit_${side}`
    const area = this.worldState.currentArea
    if (area !== null && area !== 'hall' && area !== 'upper_hall_left' && area !== 'upper_hall_right' && !this.inPond()) return undefined
    const onLeft = x === 0, onRight = x === MAP_W - 1
    const arrows = new Set(['exit_right', 'exit_left', 'exit_down', 'exit_up', 'hall_exit_up', 'hall_exit_driveway',
      'upper_hall_exit_chaos', 'upper_hall_exit_bathroom', 'upper_hall_exit_study', 'upper_hall_exit_mar',
      'pond_exit', 'pond_exit_left', 'pond_exit_right', 'pond_exit_down', 'pond_exit_up'])
    const len = onLeft || onRight ? MAP_H : MAP_W
    for (let i = 1; i < len - 1; i++) {
      const id = this.mapSystem.getTile(onLeft || onRight ? x : i, onLeft || onRight ? i : y)?.defId
      if (id && arrows.has(id)) return id
    }
    return undefined
  }

  private placeDugExit(x: number, y: number, defId: string): void {
    this.mapSystem.setTile(x, y, defId)
    this.worldState.dugExits.add(`${this.currentMapKey()}:${x},${y}`)
  }

  // Stepping onto a dug arrow: remember to arrive on the opposite edge at the
  // same x/y, where a matching arrow back is placed.
  private queueDugEntry(x: number, y: number, defId: string): void {
    const back = DUG_EXIT_BACK[defId]
    if (!back || !this.worldState.dugExits.has(`${this.currentMapKey()}:${x},${y}`)) return
    const side = x === 0 ? 'right' : x === MAP_W - 1 ? 'left' : y === 0 ? 'down' : 'up'
    this.pendingDugEntry = { side, coord: side === 'left' || side === 'right' ? y : x, backTile: back }
  }

  // Which map edge (x, y) lies on; undefined inside the map or on a corner.
  private edgeSideOf(x: number, y: number): Side | undefined {
    const onLeft = x <= 0, onRight = x >= MAP_W - 1
    const onTop = y <= 0, onBottom = y >= MAP_H - 1
    if ((onLeft || onRight) === (onTop || onBottom)) return undefined
    return onLeft ? 'left' : onRight ? 'right' : onTop ? 'up' : 'down'
  }

  // The room on the other side of this map's `side` edge, if EDGE_LINKS joins them
  private edgeLinkFrom(side: Side): EdgeEnd | undefined {
    const ws = this.worldState
    const here = (e: EdgeEnd) => e.side === side && e.area === ws.currentArea && (e.area !== 'hall' || (ws.ucx === 0 && ws.ucy === 0))
    for (const [a, b] of EDGE_LINKS) {
      if (here(a)) return b
      if (here(b)) return a
    }
    return undefined
  }

  private followEdgeLink(to: EdgeEnd): void {
    if (to.area === 'hall') { this.worldState.ucx = 0; this.worldState.ucy = 0 }
    this.transitionToArea(to.area)
  }

  // A phasing player walking off the map: follows the arrow on that edge nearest
  // to where they cross (or an EDGE_LINKS wall), arriving at the same x/y on the
  // facing edge of the next map. Returns false when nothing lies beyond.
  private crossEdgeByPhasing(nx: number, ny: number): boolean {
    const side = this.edgeSideOf(nx, ny)
    if (!side) return false
    const vertical = side === 'left' || side === 'right'
    const coord = vertical ? ny : nx
    const arrive: Side = side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'up' ? 'down' : 'up'
    const ex = side === 'left' ? 0 : side === 'right' ? MAP_W - 1 : -1
    const ey = side === 'up' ? 0 : side === 'down' ? MAP_H - 1 : -1
    let arrow: { x: number; y: number; defId: string } | undefined
    for (let i = 0; i < (vertical ? MAP_H : MAP_W); i++) {
      const x = vertical ? ex : i, y = vertical ? i : ey
      const id = this.mapSystem.getTile(x, y)?.defId
      if (!id || !isSpecialTile(id) || id.includes('door') || id === 'flame') continue
      if (!arrow || Math.abs(i - coord) < Math.abs((vertical ? arrow.y : arrow.x) - coord)) arrow = { x, y, defId: id }
    }
    this.pendingDugEntry = null
    this.pendingEdgeEntry = { side: arrive, coord }
    if (arrow) {
      this.enterTransitTile(arrow.defId, arrow.x, arrow.y)
      // Consumed by the transition (see applyDugEntry) only when the map really changed
      if (!this.pendingEdgeEntry) return true
    }
    const link = this.edgeLinkFrom(side)
    if (link) { this.followEdgeLink(link); this.pendingEdgeEntry = null; return true }
    this.pendingEdgeEntry = null
    return false
  }

  // Leaving through an arrow on the map edge: when the default entry lies beside
  // an arrow on the new map's edge, move along that edge to the same x/y as the
  // arrow taken (whatever its axis there), beside a matching arrow. With
  // `loose`, any free tile at that x/y will do. Otherwise keeps `entry`.
  private alignEdgeEntry(entry: { x: number; y: number }, loose = false): { x: number; y: number } {
    const cross = this.edgeCross
    this.edgeCross = null
    if (!cross) return entry
    const transit = (id: string | undefined): id is string => !!id && isSpecialTile(id) && !id.includes('door') && id !== 'flame'
    const sides: Array<[Side, boolean, number, number]> = [
      ['left',  entry.x === 1,         0,           entry.y],
      ['right', entry.x === MAP_W - 2, MAP_W - 1,   entry.y],
      ['up',    entry.y === 1,         entry.x,     0],
      ['down',  entry.y === MAP_H - 2, entry.x,     MAP_H - 1],
    ]
    const arrival = sides.find(([, beside, bx, by]) => beside && transit(this.mapSystem.getTile(bx, by)?.defId))
    if (!arrival) return entry
    const [side, , bx, by] = arrival
    const backId = this.mapSystem.getTile(bx, by)!.defId
    const vertical = side === 'left' || side === 'right'
    const len = vertical ? MAP_H : MAP_W
    // Border tile and the tile just inside it at index i along the arrival edge
    const at = (i: number) => vertical
      ? { border: { x: bx, y: i }, inner: { x: side === 'left' ? 1 : MAP_W - 2, y: i } }
      : { border: { x: i, y: by }, inner: { x: i, y: side === 'up' ? 1 : MAP_H - 2 } }
    const free = (p: { x: number; y: number }) => {
      const id = this.mapSystem.getTile(p.x, p.y)?.defId
      return !!id && this.mapSystem.isWalkable(p.x, p.y) && !isSpecialTile(id)
    }
    const beside = (i: number) => {
      const { border, inner } = at(i)
      return this.mapSystem.getTile(border.x, border.y)?.defId === backId && free(inner)
    }
    let best: number | undefined
    if (cross.coord >= 1 && cross.coord <= len - 2 && (beside(cross.coord) || (loose && free(at(cross.coord).inner)))) {
      best = cross.coord
    } else if (!loose) {
      for (let i = 1; i < len - 1; i++)
        if (beside(i) && (best === undefined || Math.abs(i - cross.coord) < Math.abs(best - cross.coord))) best = i
    }
    if (best === undefined) return entry
    const spot = at(best).inner
    const blocker = this.getMonsterAt(spot.x, spot.y)
    if (blocker) {
      this.player.x = spot.x
      this.player.y = spot.y
      const away = this.findSpotNearPlayer()
      blocker.x = away.x
      blocker.y = away.y
    }
    return spot
  }

  // Called once the new map is loaded: places the arrow back plus one walkable
  // tile beside it, and returns that tile as the entry position. A phasing
  // crossing instead just lands at the same x/y just inside the facing edge.
  private applyDugEntry(): { x: number; y: number } | null {
    const edge = this.pendingEdgeEntry
    this.pendingEdgeEntry = null
    if (edge) {
      this.pendingDugEntry = null
      const clamp = (v: number, max: number) => Math.max(1, Math.min(max - 2, v))
      this.player.x = edge.side === 'left' ? 1 : edge.side === 'right' ? MAP_W - 2 : clamp(edge.coord, MAP_W)
      this.player.y = edge.side === 'up' ? 1 : edge.side === 'down' ? MAP_H - 2 : clamp(edge.coord, MAP_H)
      const blocker = this.getMonsterAt(this.player.x, this.player.y)
      if (blocker) {
        const spot = this.findSpotNearPlayer()
        blocker.x = spot.x
        blocker.y = spot.y
      }
      return { x: this.player.x, y: this.player.y }
    }
    const p = this.pendingDugEntry
    this.pendingDugEntry = null
    if (!p) return null
    const ex = p.side === 'left' ? 0 : p.side === 'right' ? MAP_W - 1 : p.coord
    const ey = p.side === 'up' ? 0 : p.side === 'down' ? MAP_H - 1 : p.coord
    const ix = p.side === 'left' ? 1 : p.side === 'right' ? MAP_W - 2 : ex
    const iy = p.side === 'up' ? 1 : p.side === 'down' ? MAP_H - 2 : ey
    this.placeDugExit(ex, ey, p.backTile)
    const inner = this.mapSystem.getTile(ix, iy)!.defId
    if (this.inPond() ? inner !== 'water' : !this.mapSystem.isWalkable(ix, iy) || isSpecialTile(inner))
      this.mapSystem.setTile(ix, iy, this.inPond() ? 'water' : this.mapFloorTile())
    this.player.x = ix
    this.player.y = iy
    const blocker = this.getMonsterAt(ix, iy)
    if (blocker) {
      const spot = this.findSpotNearPlayer()
      blocker.x = spot.x
      blocker.y = spot.y
    }
    return { x: ix, y: iy }
  }

  private advanceDig(): void {
    // Only a hostile closing in interrupts — busy maps like the hall would
    // otherwise make digging impossible
    const hostileVisible = this.monsters.some(m => {
      if (m.aiType === 'friendly' || m.aiType === 'follow' || m.npc) return false
      if (Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y)) > 3) return false
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
      const isVoid = tile?.defId === 'void'
      const inPond = this.inPond()
      const edgeExit = this.edgeExitFor(tx, ty)
      if (edgeExit) this.placeDugExit(tx, ty, edgeExit)
      else this.mapSystem.setTile(tx, ty, inPond ? 'water'
        : isTree ? 'grass' : isHallWall ? 'tegel_wit' : isKraan ? 'tegel_bruin' : isVoid ? 'carpet' : 'floor')
      this.messageLog.add(isKraan ? 'You smash the tap! The water stops.'
        : edgeExit ? 'You break through to the next area!' : 'You break through!', '#c0ff80')
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

  private static readonly WIDGET_PARTY = ['eric', 'klopper', 'mam', 'pap2']
  // What each of the dancers sings or shouts while circling Widget
  private static readonly PARTY_LINES: Record<string, string[]> = {
    eric:    ['Widget is home! Thank you so much!', 'Feest vieren, feest vieren, wij vieren feest!'],
    klopper: ['*slaps his tail on the carpet with joy*', 'Widget and Klopper, best friends forever!'],
    mam:     ['Happy birthday to you Widget!', 'La la la, Widget is back, la la laaa!'],
    pap2:    ['Hip hip hooray for Widget!', 'Feest vieren, feest vieren, wij vieren feest!'],
  }

  private partySong(defId: string): string {
    const lines = GameScene.PARTY_LINES[defId] ?? ['Feest vieren, feest vieren, wij vieren feest!']
    return lines[Math.floor(Math.random() * lines.length)]
  }

  // Eric's bedroom: before Widget is home, only Eric waits beside you with his
  // lava warning; afterwards Widget sits on the party carpet and Eric, Klopper,
  // Mom and Dad dance around him. `placeEric` is off when restoring a save, so
  // Eric stays where he was.
  private setupEricsBedroom(placeEric = true): void {
    if (this.worldState.currentArea !== 'chaos') return
    const area = chaosPartyArea(MAP_W, MAP_H)
    // Older saves still have the testing portal in the middle of the room
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (this.mapSystem.getTile(x, y)?.defId === 'portal_chaos') this.mapSystem.setTile(x, y, 'floor')
    // Older saves snapshot the bedroom from before the carpet existed
    for (let y = area.y1; y <= area.y2; y++)
      for (let x = area.x1; x <= area.x2; x++)
        this.mapSystem.setTile(x, y, 'carpet')
    const party = GameScene.WIDGET_PARTY
    const widgetFound = this.worldState.widgetFound
    if (!widgetFound && !placeEric) return

    for (const m of this.monsters.filter(m => party.includes(m.defId) && !this.companions.includes(m)))
      this.turnManager.removeActor(m.id)
    this.monsters = this.monsters.filter(m => !party.includes(m.defId) || this.companions.includes(m))

    const defs = monsterData as MonsterDef[]
    const spawn = (defId: string, x: number, y: number, message: string): Monster | null => {
      const def = defs.find(d => d.id === defId)
      if (!def) return null
      const m = new Monster(def, x, y)
      m.message = message
      m.setContext(this.mapSystem, this.player, (mx, my) => this.getMonsterAt(mx, my), (monster) => this.handleMonsterAttack(monster))
      m.energy = 0
      m.speed = m.speed * 100
      this.monsters.push(m)
      this.turnManager.addActor(m)
      return m
    }

    if (!widgetFound) {
      const spot = this.findSpotNearPlayer()
      spawn('eric', spot.x, spot.y, 'The floor is lava!')
      return
    }

    this.localMapView.groundDecorations = [{ tx: area.cx, ty: area.cy, key: 'item_widget2' }]
    const ring = chaosPartyRing(MAP_W, MAP_H)
    // Every other ring tile; shift by one if the player stands on one of them
    const offset = [0, 2, 4, 6].some(i => ring[i].x === this.player.x && ring[i].y === this.player.y) ? 1 : 0
    party.forEach((defId, i) => {
      const pos = ring[i * 2 + offset]
      const m = spawn(defId, pos.x, pos.y, this.partySong(defId))
      if (m) m.aiType = 'static'
    })
  }

  // The Widget party steps one tile clockwise around Widget each turn, pausing
  // while anyone else is in the way.
  private circleWidget(): void {
    if (!this.worldState.widgetFound) return
    const ring = chaosPartyRing(MAP_W, MAP_H)
    const ringIndex = (m: Monster) => ring.findIndex(p => p.x === m.x && p.y === m.y)
    const dancers = this.monsters.filter(m =>
      GameScene.WIDGET_PARTY.includes(m.defId) && m.aiType === 'static' && ringIndex(m) !== -1)
    if (dancers.length === 0) return
    const next = dancers.map(m => ring[(ringIndex(m) + 1) % ring.length])
    const blocked = next.some(p =>
      (p.x === this.player.x && p.y === this.player.y) ||
      this.monsters.some(o => o.x === p.x && o.y === p.y && !dancers.includes(o)))
    if (blocked) return
    dancers.forEach((m, i) => {
      m.x = next[i].x
      m.y = next[i].y
      if (!m.hasSpoken) m.message = this.partySong(m.defId)
    })
  }

  // Walls (and door) of Eric the trader's chamber in the centre garden cell
  private isTraderChamberWall(x: number, y: number): boolean {
    if (this.worldState.currentArea !== null || this.worldState.cx !== 1 || this.worldState.cy !== 1) return false
    const onEdge = x === 50 || x === 58 || y === 6 || y === 11
    return onEdge && x >= 50 && x <= 58 && y >= 6 && y <= 11
  }

  private isInShopArea(): boolean {
    const inForestChamber = this.worldState.cx === 1 && this.worldState.cy === 1 &&
        this.worldState.currentArea === null &&
        this.player.x >= 51 && this.player.x <= 57 &&
        this.player.y >= 7 && this.player.y <= 10
    return inForestChamber || this.worldState.currentArea === 'pantry'
  }

  private isItemHidden(fi: FloorItem): boolean {
    return isHiddenUnderWater(fi.item.defId, this.mapSystem.getTile(fi.x, fi.y)?.defId, this.player.itemVision)
  }

  private notifyItemsUnderfoot(): void {
    const here = this.floorItems.filter(fi => fi.x === this.player.x && fi.y === this.player.y && !this.isItemHidden(fi))
    if (here.length === 0) return
    const inShop = this.isInShopArea()
    for (const fi of here) {
      const def = this.inventory.getDef(fi.item.defId)
      const name = def?.name ?? fi.item.defId
      const qty  = fi.item.quantity > 1 ? ` (${fi.item.quantity})` : ''
      const price = inShop && def?.type !== 'gold' ? `  [${itemValue(def, fi.item)}c]` : ''
      this.messageLog.add(`You see here: ${name}${qty}.${price}`, '#c8a060')
    }
  }

  private updateFOV(): void {
    const site = this.worldState.deadHorseSite
    this.localMapView.persistentDecorations = site && site.key === this.currentMapKey()
      ? [{ tx: site.x, ty: site.y, key: 'monster_paard_dead' }]
      : []
    if (this.worldState.currentArea === 'stairs' || this.worldState.currentArea === 'driveway') return  // always fully visible
    const area = this.worldState.currentArea
    const isGarage = area === 'garage_top' || area === 'garage_bottom'
    const isTubEnclosure = area === 'tub_enclosure'
    const radius = (isGarage || isTubEnclosure) ? 3
      : area === 'pond3' ? 3
      : area === 'pond2' ? 4
      : 5
    this.mapSystem.computeFOV(this.player.x, this.player.y, radius)
  }

  // ─── Monster helpers ────────────────────────────────────────────────────────

  private handleMonsterAttack(monster: Monster): void {
    if (monster.defId === 'sorcerer' && this.sorcererZap(monster)) {
      if (!this.player.isAlive()) this.lastKilledBy = monster.name
      this.statsPanel.update(this.player, this.turnManager.getTurn())
      return
    }
    this.combat.monsterAttacks(monster, this.player)
    if (!this.player.isAlive()) this.lastKilledBy = monster.name
    this.statsPanel.update(this.player, this.turnManager.getTurn())
  }

  // Sorcerers zap their wand at the player instead of hitting. Returns false once
  // the wand is empty, so the sorcerer falls back to his fists.
  private sorcererZap(m: Monster): boolean {
    if (!m.wand) {
      // Tunneling would do nothing to the player, so a sorcerer never carries one
      let wandId = this.inventory.randomWandId()
      while (wandId === 'wand_tunneling') wandId = this.inventory.randomWandId()
      m.wand = this.inventory.createInstance(wandId)
    }
    if ((m.wand.charges ?? 0) <= 0) return false
    m.wand.charges = (m.wand.charges ?? 0) - 1
    const effect = this.inventory.getDef(m.wand.defId)?.wandEffect
    if (effect === 'fire' || effect === 'cold') {
      const color = effect === 'fire' ? '#ff6020' : '#80e0ff'
      this.localMapView.animateBolt(m.x, m.y, this.player.x, this.player.y, color, () => {})
      this.messageLog.add(`The ${m.name} zaps a wand of ${effect === 'fire' ? 'fire' : 'ice'} at you!`, color)
      const resists = effect === 'fire' ? this.hasHeatResistance() : this.hasColdResistance()
      if (resists) {
        this.messageLog.add(effect === 'fire' ? 'You feel only a pleasant warmth.' : 'You feel only a pleasant chill.', color)
      } else if (this.isInvulnerable()) {
        this.messageLog.add(effect === 'fire' ? 'The fire washes over you harmlessly.' : 'The ice washes over you harmlessly.', color)
      } else {
        const dmg = 4 + Math.floor(Math.random() * 7)  // 4-10
        this.player.hp -= dmg
        this.messageLog.add(effect === 'fire' ? `The fire burns you! (-${dmg} HP)` : `The ice freezes you! (-${dmg} HP)`, color)
      }
    } else if (effect === 'displacement') {
      this.messageLog.add(`The ${m.name} zaps a wand of displacement at you!`, '#c080ff')
      const spot = this.randomSpot(this.freeSpots(undefined, this.inPond()))
      if (spot) {
        this.player.x = spot.x
        this.player.y = spot.y
        this.messageLog.add('You blink out of existence and reappear elsewhere!', '#c080ff')
        this.updateFOV()
      } else {
        this.messageLog.add('You shimmer for a moment, but stay put.', '#c080ff')
      }
    } else if (effect === 'evocation') {
      this.messageLog.add(`The ${m.name} zaps a wand of evocation!`, '#ff4040')
      const category = areaInfo(this.worldState.currentArea ?? '').category
      const pool = AREA_MONSTERS[category] ?? ['snail', 'rat', 'bat', 'wilddog', 'spirit', 'ogre']
      const slot = this.randomSpot(this.freeSpots((x, y) =>
        Math.max(Math.abs(x - this.player.x), Math.abs(y - this.player.y)) <= 2, this.inPond()))
      if (slot) {
        this.spawnEntities([{ x: slot.x, y: slot.y, defId: pool[Math.floor(Math.random() * pool.length)] }], [])
        this.messageLog.add('The air tears open and a monster tumbles out!', '#ff4040')
      } else {
        this.messageLog.add('The air ripples, but nothing comes through.', '#ff4040')
      }
    } else {
      return false
    }
    return true
  }

  // Sas standing right next to the player when they leave the map tags along.
  // She is taken off the old map before its snapshot is saved, so she isn't left
  // behind there as well, and on the new map she is an ordinary resident again.
  private takeSasAlong(): Monster[] {
    if (this.sasWalk) return []
    const sas = this.monsters.find(m => m.defId === 'sas' && m.isAlive() && !this.companions.includes(m)
      && Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y)) <= 1)
    if (!sas) return []
    this.turnManager.removeActor(sas.id)
    this.monsters = this.monsters.filter(m => m !== sas)
    return [sas]
  }

  // Puts the companions from the previous map back next to the player. The
  // horse can't swim: it waits outside the pond levels until the player is back.
  // `tagAlong` monsters are placed the same way but don't become companions.
  private bringCompanions(saved: Monster[], tagAlong: Monster[] = []): void {
    for (const m of tagAlong) {
      const pos = this.findSpotNearPlayer()
      m.x = pos.x; m.y = pos.y
      m.energy = 0; m.hasSpoken = false
      m.setContext(this.mapSystem, this.player, (mx, my) => this.getMonsterAt(mx, my), (mm) => this.handleMonsterAttack(mm))
      this.monsters.push(m)
      this.turnManager.addActor(m)
    }
    if (tagAlong.length > 0) this.messageLog.add('Sas follows you.', '#ffff80')
    const inPond = this.inPond()
    const all = inPond ? saved : [...saved, ...this.parkedCompanions]
    if (!inPond) this.parkedCompanions = []
    for (const companion of all) {
      if (inPond && companion.defId === 'paard') {
        if (!this.parkedCompanions.includes(companion)) {
          this.parkedCompanions.push(companion)
          this.messageLog.add('The horse stays behind at the water\'s edge.', '#c08040')
        }
        continue
      }
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
  }

  private findSpotNearPlayer(): { x: number; y: number } {
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const nx = this.player.x + dx
          const ny = this.player.y + dy
          const tile = this.mapSystem.getTile(nx, ny)
          if (tile && this.mapSystem.isWalkable(nx, ny) && !isSpecialTile(tile.defId) && this.getMonsterAt(nx, ny) === null) {
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
    // Jormungand is unique: once slain it never returns this game
    if (monster.defId === 'jormungand' && !monster.isAlive()) this.worldState.extinctRaces.add('jormungand')
    if (monster.xpValue > 0) {
      const def = (monsterData as MonsterDef[]).find(d => d.id === monster.defId)
      // Human-like monsters ('random') sometimes drop something from the local loot table
      if (def?.dropType === 'random') {
        if (Math.random() < 0.4) {
          const area = this.worldState.currentArea
          const lootArea = area === null ? 'forest' : area.startsWith('upper_hall') ? area : this.areaType(area)
          const drop = pickAreaItem(lootArea, Math.random)
          if (drop) this.floorItems.push(new FloorItem(monster.x, monster.y, this.inventory.createInstance(drop.defId, drop.qty)))
        }
      } else if (monster.defId === 'sorcerer' && monster.wand) {
        // The wand he was zapping, with whatever charges are left
        this.floorItems.push(new FloorItem(monster.x, monster.y, monster.wand))
      } else if (monster.defId === 'summoner') {
        this.floorItems.push(new FloorItem(monster.x, monster.y, this.inventory.createInstance('wand_evocation')))
      } else if (monster.defId === 'swordsman' && Math.random() < 0.5) {
        // Swordsmen carry a few throwing stars
        const qty = 1 + Math.floor(Math.random() * 3)
        this.floorItems.push(new FloorItem(monster.x, monster.y, this.inventory.createInstance('shuriken', qty)))
      } else if (def?.dropType && Math.random() < 0.5) {
        const pool = this.inventory.getDefsByType(def.dropType).filter(d => !EXCLUDE_IDS.has(d.id))
        if (pool.length > 0) {
          const drop = pool[Math.floor(Math.random() * pool.length)]
          this.floorItems.push(new FloorItem(monster.x, monster.y, this.inventory.createInstance(drop.id)))
        }
      }
    }
  }

  // ─── Look mode ──────────────────────────────────────────────────────────────

  // While blind, monster and item names in messages are replaced by vague
  // stand-ins ("a monster", "some item"), along with any article before them.
  private blindNameRegex: RegExp | null = null
  private blindNameKind = new Map<string, 'monster' | 'item'>()
  private blindText(text: string): string {
    if (!this.blindNameRegex) {
      for (const d of itemData as ItemDef[]) this.blindNameKind.set(d.name, 'item')
      for (const d of monsterData as MonsterDef[]) this.blindNameKind.set(d.name, 'monster')
      const names = [...this.blindNameKind.keys()]
        .sort((a, b) => b.length - a.length)
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      this.blindNameRegex = new RegExp(`(?:\\b(the|a|an|your|The|A|An|Your) )?\\b(${names.join('|')})(?!\\w|'s)`, 'g')
    }
    return text.replace(this.blindNameRegex, (_m, article: string | undefined, name: string, offset: number, whole: string) => {
      const vague = this.blindNameKind.get(name) === 'monster' ? 'a monster' : 'some item'
      const capitalize = article
        ? /^[A-Z]/.test(article)
        : offset === 0 || /[.!?"]\s*$/.test(whole.slice(0, offset))
      return capitalize ? vague[0].toUpperCase() + vague.slice(1) : vague
    })
  }

  private enterLookMode(): void {
    if (this.player.blindTurns > 0) {
      this.messageLog.add('You are blind and cannot see.', '#808080')
      return
    }
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

    for (const fi of this.floorItems.filter(f => f.x === tx && f.y === ty && !this.isItemHidden(f))) {
      if (fi.item.defId === 'petergras') {
        this.messageLog.add('Petergrass died just by looking at it.', '#808060')
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
      '0,0': 'The Garden',
      '1,0': 'The Garden',
      '2,0': 'The Garden pond',
      '0,1': 'Mispelheim',
      '1,1': 'The Garden shop',
      '2,1': 'The Garden forest',
      '0,2': 'The Garden garage',
      '1,2': 'The Garden kitchen',
      '2,2': 'The Garden',
    }
    const key = `${this.worldState.cx},${this.worldState.cy}`
    return names[key] ?? `World (${this.worldState.cx + 1},${this.worldState.cy + 1})`
  }

  private collectSaveData(): GameSaveData {
    const currentKey = this.currentMapKey()
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
        morality: this.player.morality, morale: this.player.morale, diagnostics: [...this.player.diagnostics],
        inventory: this.player.inventory.map(i => ({ ...i })),
        equipment: JSON.parse(JSON.stringify(this.player.equipment)),
        skills: [...this.player.skills],
        speed: this.player.speed, energy: this.player.energy,
        allianceTurns: this.player.allianceTurns, timestopTurns: this.player.timestopTurns,
        drunkTurns: this.player.drunkTurns, phasingTurns: this.player.phasingTurns,
        blindTurns: this.player.blindTurns, translucenceTurns: this.player.translucenceTurns,
        invulnerableTurns: this.player.invulnerableTurns, speedTurns: this.player.speedTurns, speedPotionBonus: this.player.speedPotionBonus,
        paralyzedTurns: this.player.paralyzedTurns,
        lycanthropy: this.player.lycanthropy, lycanthropyCountdown: this.player.lycanthropyCountdown,
        werewolfTurns: this.player.werewolfTurns, preWerewolfSpriteKey: this.player.preWerewolfSpriteKey,
        transformationMonsterId: this.player.transformationMonsterId,
        transformationStrBonus: this.player.transformationStrBonus,
        transformationHpBonus: this.player.transformationHpBonus,
        preTransformSpriteKey: this.player.preTransformSpriteKey,
        itemVision: this.player.itemVision,
        knownFacts: [...this.player.knownFacts],
      },
      worldState: {
        cx: this.worldState.cx, cy: this.worldState.cy,
        ucx: this.worldState.ucx, ucy: this.worldState.ucy,
        currentArea: this.worldState.currentArea,
        savedCx: this.worldState.savedCx, savedCy: this.worldState.savedCy,
        savedPlayerX: this.worldState.savedPlayerX, savedPlayerY: this.worldState.savedPlayerY,
        mamHasOrange: this.worldState.mamHasOrange, mamHasVase: this.worldState.mamHasVase, widgetFound: this.worldState.widgetFound,        peterWarned: this.worldState.peterWarned,
        horseDead: this.worldState.horseDead,
        deadHorseSite: this.worldState.deadHorseSite,
        sasMourned: this.worldState.sasMourned,
        horseFed: this.worldState.horseFed,
        stairsOrigin: this.stairsOrigin,
        extinctRaces: [...this.worldState.extinctRaces],
        dugExits: [...this.worldState.dugExits],
        clarinetCx: this.worldState.clarinetCx, clarinetCy: this.worldState.clarinetCy,
        relicSites: this.worldState.relicSites,
        questSites: this.worldState.questSites,
        npcSites: this.worldState.npcSites,
        runSeed: this.worldState.runSeed,
        clarinetLocation: this.worldState.clarinetLocation,
        bonusTurns: this.worldState.bonusTurns,
        stampsGiven: this.worldState.stampsGiven,
        fragmentsGiven: this.worldState.fragmentsGiven,
        secondLifeMixed: this.worldState.secondLifeMixed,
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
    this.player.morality = p.morality; this.player.morale = p.morale ?? Player.MAX_MORALE; this.player.diagnostics = [...p.diagnostics]
    // Items removed from the game since the save (e.g. the plain Ring) are dropped
    this.player.inventory = p.inventory.filter(i => this.inventory.getDef(i.defId)).map(i => ({ ...i }))
    this.player.equipment = JSON.parse(JSON.stringify(p.equipment))
    this.player.equipment.launcher ??= null
    for (const [slot, it] of Object.entries(this.player.equipment))
      if (it && !this.inventory.getDef(it.defId)) (this.player.equipment as unknown as Record<string, unknown>)[slot] = null
    this.player.skills = new Set(p.skills)
    this.player.speed = p.speed ?? 100
    this.player.energy = p.energy ?? 100
    this.player.allianceTurns = p.allianceTurns ?? 0
    this.player.timestopTurns = p.timestopTurns ?? 0
    this.player.drunkTurns = p.drunkTurns ?? 0
    this.player.phasingTurns = p.phasingTurns ?? 0
    this.player.blindTurns = p.blindTurns ?? 0
    this.player.translucenceTurns = p.translucenceTurns ?? 0
    this.player.invulnerableTurns = p.invulnerableTurns ?? 0
    this.player.speedTurns = p.speedTurns ?? 0
    this.player.paralyzedTurns = p.paralyzedTurns ?? 0
    this.player.lycanthropy = p.lycanthropy ?? false
    this.player.lycanthropyCountdown = p.lycanthropyCountdown ?? 0
    this.player.werewolfTurns = p.werewolfTurns ?? 0
    this.player.preWerewolfSpriteKey = p.preWerewolfSpriteKey ?? 'player'
    this.player.speedPotionBonus = p.speedPotionBonus ?? (this.player.speedTurns > 0 ? 100 : 0)
    this.player.transformationMonsterId = p.transformationMonsterId ?? null
    this.player.transformationStrBonus = p.transformationStrBonus ?? 0
    this.player.transformationHpBonus = p.transformationHpBonus ?? 0
    this.player.preTransformSpriteKey = p.preTransformSpriteKey ?? 'player'
    this.player.itemVision = p.itemVision ?? false
    this.player.knownFacts = new Set(p.knownFacts ?? [])
    this.turnManager.addActor(this.player)
    this.turnManager.setTurn(data.turn)

    const ws = data.worldState
    this.worldState.cx = ws.cx; this.worldState.cy = ws.cy
    this.worldState.ucx = ws.ucx; this.worldState.ucy = ws.ucy
    this.worldState.currentArea = ws.currentArea
    this.worldState.savedCx = ws.savedCx; this.worldState.savedCy = ws.savedCy
    this.worldState.savedPlayerX = ws.savedPlayerX; this.worldState.savedPlayerY = ws.savedPlayerY
    this.worldState.mamHasOrange = ws.mamHasOrange; this.worldState.mamHasVase = ws.mamHasVase; this.worldState.widgetFound = ws.widgetFound ?? false
    this.worldState.peterWarned = ws.peterWarned ?? false
    this.worldState.horseDead = ws.horseDead ?? false
    this.worldState.deadHorseSite = ws.deadHorseSite ?? null
    this.worldState.sasMourned = ws.sasMourned ?? false
    this.worldState.horseFed = ws.horseFed ?? false
    this.stairsOrigin = ws.stairsOrigin ?? null
    this.worldState.extinctRaces = new Set(ws.extinctRaces ?? [])
    this.worldState.dugExits = new Set(ws.dugExits ?? [])
    if (ws.clarinetCx !== undefined) this.worldState.clarinetCx = ws.clarinetCx
    if (ws.clarinetCy !== undefined) this.worldState.clarinetCy = ws.clarinetCy
    if (ws.relicSites) this.worldState.relicSites = ws.relicSites
    if (ws.questSites) this.worldState.questSites = ws.questSites
    if (ws.npcSites) this.worldState.npcSites = ws.npcSites
    if (ws.runSeed !== undefined) this.worldState.runSeed = ws.runSeed
    this.worldState.clarinetLocation = ws.clarinetLocation ?? null
    this.worldState.bonusTurns = ws.bonusTurns ?? 0
    this.worldState.stampsGiven = ws.stampsGiven ?? 0
    this.worldState.fragmentsGiven = ws.fragmentsGiven ?? 0
    this.worldState.secondLifeMixed = ws.secondLifeMixed ?? false

    this.worldState.cellSnapshots.clear()
    for (const [k, v] of Object.entries(data.cellSnapshots)) this.worldState.cellSnapshots.set(k, v)

    this.mapSystem.reset()
    this.tryRestoreFromSnapshot(data.currentMapKey)
    this.localMapView.groundDecorations = []
    this.setupEricsBedroom(false)

    if (!this.worldState.currentArea && this.worldState.widgetFound) {
      const mar = this.monsters.find(m => m.defId === 'mar')
      if (mar && !mar.message) { mar.message = "So, what's next?"; mar.hasSpoken = false }
    }

    const areaRealm: Record<string, string> = {
      bathroom_top: 'Bathroom', bathroom_bottom: 'Bathroom',
      garage_top: 'Garage', garage_bottom: 'Garage',
      hall: 'Hall', chaos: "Eric's bedroom",
      bedroom: "Mar's bedroom", bedroom_lower: "Mar's bedroom",
      stairs: 'Stairs', kitchen: 'Kitchen', loft_stairs: 'Loft Stairs',
      driveway: 'Driveway',
      upper_hall_left: 'Upper Hall', upper_hall_right: 'Upper Hall',
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
    this.scheduleWerewolfMove()
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
      for (const m of [this.forestMusic, this.loftMusic, this.hallMusic, this.bathroomMusic, this.bedroomMusic, this.pondMusic, this.stairsMusic]) {
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

  private triggerVictory(): void {
    this.inputBlocked = true
    this.recordLeaderboardEntry('Victory - saved the world!')
    this.scene.start('VictoryScene', { score: this.player.exp })
  }

  // Adds the current run to the Hall of Defeat and returns the updated entries.
  private recordLeaderboardEntry(cause: string) {
    const AREA_NAMES: Record<string, string> = {
      bathroom_top: 'Bathroom', bathroom_bottom: 'Bathroom',
      garage_top: 'Garage', garage_bottom: 'Lower Garage',
      hall: 'Hall', chaos: "Eric's bedroom",
      bedroom: "Mar's Bedroom", bedroom_lower: "Mar's Bedroom", stairs: 'Rainbow Stairs', loft_stairs: 'Loft Stairs',
      driveway: 'Driveway',
      upper_hall_left: 'Upper Hall', upper_hall_right: 'Upper Hall',
      pond1: 'Pond', pond2: 'Pond', pond3: 'Pond',
    }
    const area = this.worldState.currentArea
    const inDrivewayBalcony = area === 'driveway' &&
      this.player.x >= 65 && this.player.x <= 79 && this.player.y >= 13 && this.player.y <= 15
    const level = inDrivewayBalcony ? 'Balcony'
      : area ? (AREA_NAMES[area] ?? area) : this.cellName()
    return new LeaderboardSystem().addEntry({
      name:  this.player.name,
      score: this.player.exp,
      level,
      hp:    this.player.hp,
      maxHp: this.player.maxHp,
      cause,
    })
  }

  // Turns left before time runs out (20000 + bonus turns from distracting Lex).
  private turnsLeft(): number {
    return this.worldState.turnLimit - this.turnManager.getTurn()
  }

  private timeUp = false
  private checkTimeLimit(): void {
    if (this.timeUp) return
    const turn = this.turnManager.getTurn()
    const left = this.turnsLeft()
    if (left <= 0) {
      this.timeUp = true
      this.lastKilledBy = 'time'
      this.messageLog.add('Time has run out! You did not finish in time.', '#ff4040')
      this.gameOver('Ran out of time')
      return
    }
    if (turn > 0 && turn % TIME_WARNING_INTERVAL === 0)
      this.messageLog.add(`Time is running out! ${left} turns left.`, '#ff8040')
  }

  // While in werewolf form the player has no control: the beast roams randomly.
  private scheduleWerewolfMove(): void {
    if (this.player.werewolfTurns <= 0 || this.werewolfMoveScheduled) return
    this.werewolfMoveScheduled = true
    this.time.delayedCall(250, () => {
      this.werewolfMoveScheduled = false
      if (this.player.werewolfTurns <= 0 || this.inputBlocked || !this.player.isAlive()) return
      if (this.inventoryScreen.isVisible()) this.inventoryScreen.hide()
      this.tryMove(0, 0)
      // Moves that don't end a turn (e.g. a map transition) still keep the beast roaming
      this.scheduleWerewolfMove()
    })
  }

  private endWerewolfForm(): void {
    this.player.werewolfTurns = 0
    this.player.spriteKey = this.player.preWerewolfSpriteKey
    if (this.player.lycanthropy) this.player.lycanthropyCountdown = 100
    this.messageLog.add('The fur recedes and you return to your normal form.', '#c0a080')
  }

  private gameOver(cause?: string): void {
    if (this.godMode) {
      this.player.hp = this.player.maxHp
      this.messageLog.add(`[God mode] Death prevented${cause ? ` (${cause})` : ''}.`, '#ffff80')
      this.statsPanel.update(this.player, this.turnManager.getTurn())
      return
    }
    this.inputBlocked = true
    this.stopAllMusic()
    this.defeatMusic?.play()

    this.player.blindTurns = 0
    this.localMapView.clearBlind()

    const entries = this.recordLeaderboardEntry(cause ?? 'Unknown')

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

    this.input.keyboard!.once('keydown-R', () => { this.defeatMusic?.stop(); this.scene.restart() })
  }
}
