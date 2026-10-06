export interface Vec2 {
  x: number
  y: number
}

export type TileId = string

export interface TileDef {
  id: TileId
  name: string
  glyph: string
  color: string
  walkable: boolean
  transparent: boolean
  openable?: boolean
}

export interface MonsterDef {
  id: string
  name: string
  glyph: string
  color: string
  hp: number
  maxHp: number
  str: number
  ac: number
  speed: number
  xpValue: number
  aiType: 'wander' | 'chase' | 'water_wander' | 'water_chase' | 'friendly' | 'kamikaze' | 'follow' | 'guard' | 'static' | 'split' | 'flee_on_touch'
  description: string
  dropType?: string
  npc?: boolean
}

export type WandEffect = 'displacement' | 'fire' | 'cold' | 'evocation' | 'tunneling'

export interface ItemDef {
  id: string
  name: string
  glyph: string
  color: string
  type: 'weapon' | 'armor' | 'drink' | 'eat' | 'gold' | 'scroll' | 'ring' | 'wand' | 'tool'
  slot: 'weapon' | 'body' | 'head' | 'hand' | 'feet' | 'leg' | 'neck' | 'amulet' | 'shield' | 'cape' | 'ring' | 'tool' | null
  damage?: number
  defense?: number
  healAmount?: number
  foodAmount?: number
  eatMessage?: string
  goldValue?: number
  scrollText?: string
  factScroll?: boolean
  skillScroll?: string
  relic?: boolean
  throwable?: boolean
  noWield?: boolean
  lego?: boolean
  heatResistance?: boolean
  coldResistance?: boolean
  speedBonus?: number
  wandEffect?: WandEffect
  weight: number
  value: number
  description: string
}

export interface MapTile {
  defId: TileId
  explored: boolean
  visible: boolean
}

export interface EquipmentSlots {
  weapon: ItemInstance | null
  body: ItemInstance | null
  head: ItemInstance | null
  hand: ItemInstance | null
  feet: ItemInstance | null
  leg:  ItemInstance | null
  neck: ItemInstance | null
  amulet: ItemInstance | null
  shield: ItemInstance | null
  cape:   ItemInstance | null
  ring1: ItemInstance | null
  ring2: ItemInstance | null
  ring3: ItemInstance | null
  ring4: ItemInstance | null
  ring5: ItemInstance | null
  ring6: ItemInstance | null
}

export interface ItemInstance {
  instanceId: string
  defId: string
  quantity: number
  charges?: number
  // Scroll of Transport: spot remembered on first read, returned to on the second
  transportMark?: { area: string | null; cx?: number; cy?: number; ucx?: number; ucy?: number; x: number; y: number }
}

export interface SaveData {
  version: number
  turn: number
  player: PlayerSave
  map: MapSave
  monsters: MonsterSave[]
  items: FloorItemSave[]
}

export interface PlayerSave {
  x: number
  y: number
  hp: number
  maxHp: number
  str: number
  mag: number
  food: number
  exp: number
  con: number
  luck: number
  ac: number
  gold: number
  inventory: ItemInstance[]
  equipment: EquipmentSlots
}

export interface MonsterSave {
  id: string
  defId: string
  x: number
  y: number
  hp: number
}

export interface FloorItemSave {
  x: number
  y: number
  item: ItemInstance
}

export interface MapSave {
  width: number
  height: number
  tiles: MapTile[][]
}
