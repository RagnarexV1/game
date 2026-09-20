import type { SaveData, ItemInstance, EquipmentSlots } from '../types'
import type { CellSnapshot } from './WorldState'

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
  blindTurns: number; translucenceTurns: number
  itemVision: boolean
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
}

export interface GameSaveData {
  version: 2
  turn: number
  player: GamePlayerSave
  worldState: WorldStateSave
  currentMapKey: string
  cellSnapshots: Record<string, CellSnapshot>
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
      const data = JSON.parse(raw) as GameSaveData
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
