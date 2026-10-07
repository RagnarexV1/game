import type { SaveData, ItemInstance, EquipmentSlots } from '../types'
import type { CellSnapshot, RelicSite, ClarinetLocation } from './WorldState'

const SAVE_KEY = 'ragnarex_save'
const SAVE_VERSION = 1
const GAME_SAVE_KEY = 'ragnarex_game_v2'

export interface GamePlayerSave {
  x: number; y: number; name: string; gender: 'male' | 'female'
  hp: number; maxHp: number; str: number; mag: number
  food: number; maxFood: number; exp: number; con: number
  luck: number; gold: number; level: number
  secondLife: boolean; spriteKey: string
  petrified: number; petrifyCountdown: number; clayProtection: number
  extraFingers: number; extraEyes: number
  race: string; playerClass: string; morality: string
  diagnostics: string[]
  inventory: ItemInstance[]
  equipment: EquipmentSlots
  skills: string[]
  speed: number; energy: number
  allianceTurns: number; timestopTurns: number; drunkTurns: number; phasingTurns: number
  blindTurns: number; translucenceTurns: number; invulnerableTurns: number; speedTurns?: number; speedPotionBonus?: number
  paralyzedTurns?: number
  lycanthropy?: boolean; lycanthropyCountdown?: number; werewolfTurns?: number; preWerewolfSpriteKey?: string
  transformationMonsterId: string | null
  transformationStrBonus: number; transformationHpBonus: number; preTransformSpriteKey: string
  itemVision: boolean
  knownFacts?: string[]
}

export interface WorldStateSave {
  cx: number; cy: number
  ucx: number; ucy: number
  currentArea: string | null
  savedCx: number; savedCy: number
  savedPlayerX: number; savedPlayerY: number
  mamHasOrange: boolean; mamHasVase: boolean
  widgetFound?: boolean
  peterWarned?: boolean
  horseDead?: boolean
  stairsOrigin?: string | null
  extinctRaces?: string[]
  dugExits?: string[]
  clarinetCx?: number; clarinetCy?: number
  relicSites?: Record<string, RelicSite>
  questSites?: Record<string, RelicSite>
  npcSites?: Record<string, RelicSite>
  runSeed?: number
  clarinetLocation?: ClarinetLocation | null
  bonusTurns?: number
  stampsGiven?: number
  fragmentsGiven?: number
  secondLifeMixed?: boolean
}

export interface GameSaveData {
  version: 2
  turn: number
  player: GamePlayerSave
  worldState: WorldStateSave
  currentMapKey: string
  cellSnapshots: Record<string, CellSnapshot>
}

// Older saves used 'underground' / 'cellar' for the hall and tub enclosure:
// area ids, snapshot keys ("underground_1_2") and tile ids inside snapshots.
function migrateAreaIds(raw: string): string {
  return raw
    .replace(/"portal_underground"/g, '"portal_hall"')
    .replace(/"underground_exit_up"/g, '"hall_exit_up"')
    .replace(/"underground(_\d+_\d+)?"/g, '"hall$1"')
    .replace(/"portal_cellar"/g, '"portal_tub_enclosure"')
    .replace(/"cellar_exit"/g, '"tub_enclosure_exit"')
    .replace(/"(area_)?cellar"/g, '"$1tub_enclosure"')
}

export class SaveSystem {
  save(data: SaveData): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }))
    } catch {
      console.warn('Failed to save game.')
    }
  }

  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw) as SaveData
      if (data.version !== SAVE_VERSION) return null
      return data
    } catch {
      return null
    }
  }

  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null
  }

  deleteSave(): void {
    localStorage.removeItem(SAVE_KEY)
  }

  saveGame(data: GameSaveData): void {
    try {
      localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(data))
    } catch {
      console.warn('Failed to save game.')
    }
  }

  loadGame(): GameSaveData | null {
    try {
      const raw = localStorage.getItem(GAME_SAVE_KEY)
      if (!raw) return null
      const data = JSON.parse(migrateAreaIds(raw)) as GameSaveData
      if (data.version !== 2) return null
      return data
    } catch {
      return null
    }
  }

  hasGame(): boolean {
    return localStorage.getItem(GAME_SAVE_KEY) !== null
  }

  deleteGame(): void {
    localStorage.removeItem(GAME_SAVE_KEY)
  }
}
