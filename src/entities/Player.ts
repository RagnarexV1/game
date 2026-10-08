import type { ItemInstance, EquipmentSlots } from '../types'
import type { EquipmentSystem } from '../engine/EquipmentSystem'
import type { InventorySystem } from '../engine/InventorySystem'

export class Player {
  static readonly MAX_MORALE = 10

  readonly id = 'player'
  speed = 100
  energy = 100

  x = 0
  y = 0

  name = 'Hero'

  hp = 100
  maxHp = 100
  str = 18
  mag = 17
  food = 100
  maxFood = 100
  exp = 26
  con = 9
  luck = 31
  gold = 10
  secondLife = false
  spriteKey = 'player'
  petrified = 0
  petrifyCountdown = 0
  clayProtection = 0
  allianceTurns = 0
  timestopTurns = 0
  drunkTurns = 0
  paralyzedTurns = 0
  phasingTurns = 0
  blindTurns = 0
  translucenceTurns = 0
  lycanthropy = false
  lycanthropyCountdown = 0
  werewolfTurns = 0
  preWerewolfSpriteKey = 'player'
  invulnerableTurns = 0
  speedTurns = 0
  speedPotionBonus = 0
  transformationMonsterId: string | null = null
  transformationStrBonus = 0
  transformationHpBonus = 0
  preTransformSpriteKey = 'player'
  itemVision = false
  gender: 'male' | 'female' = 'male'
  extraFingers = 0
  extraEyes = 0
  race = 'human'
  playerClass = 'adventurer'
  level = 1
  morality = 'high'
  // Spirits; drops when the player wipes out a species with a Scroll of Extinction
  morale = Player.MAX_MORALE
  diagnostics: string[] = []

  inventory: ItemInstance[] = []
  equipment: EquipmentSlots = {
    weapon: null,
    body:   null,
    head:   null,
    hand:   null,
    arms:   null,
    feet:   null,
    leg:    null,
    neck:   null,
    amulet: null,
    shield: null,
    cape:   null,
    ring1:  null,
    ring2:  null,
    ring3:  null,
    ring4:  null,
    ring5:  null,
    ring6:  null,
  }
  skills: Set<string> = new Set(['swimming', 'diving'])
  // Fact Scrolls of Knowledge already read (by item id)
  knownFacts: Set<string> = new Set()

  private equipSys!: EquipmentSystem
  private invSys!: InventorySystem

  setSystems(equipSys: EquipmentSystem, invSys: InventorySystem): void {
    this.equipSys = equipSys
    this.invSys = invSys
  }

  hasSkill(skillId: string): boolean {
    return this.skills.has(skillId)
  }

  learnSkill(skillId: string): void {
    this.skills.add(skillId)
  }

  getWeaponDamage(): number {
    if (!this.equipSys) return 2
    return this.equipSys.getWeaponDamage(this.equipment, this.invSys)
  }

  getAC(): number {
    const base = this.equipSys ? 10 - this.equipSys.getArmorBonus(this.equipment, this.invSys) : 10
    return this.isTranslucent() ? base - 20 : base
  }

  // Potion of translucence, or permanently while wearing the ring of invisibility
  isTranslucent(): boolean {
    return this.translucenceTurns > 0 ||
      Object.values(this.equipment).some(item => item?.defId === 'ring_invisibility')
  }

  // Morale bands from best to worst, shown on the self screen
  private static readonly MORALE_LEVELS: Array<[number, string]> = [
    [10, 'Cheerful'],
    [8,  'Content'],
    [6,  'Uneasy'],
    [4,  'Gloomy'],
    [2,  'Guilt-ridden'],
    [-Infinity, 'Despairing'],
  ]

  moraleLevel(): string {
    return Player.MORALE_LEVELS.find(([min]) => this.morale >= min)![1]
  }

  // Called once per level gained, so the scene can announce it
  onLevelUp: ((level: number) => void) | null = null

  // Total XP needed to reach a level: 100 · L(L-1)/2 → L2 100, L3 300, L4 600, L5 1000, ...
  static xpForLevel(level: number): number {
    return 100 * level * (level - 1) / 2
  }

  gainXP(amount: number): void {
    this.exp += amount
    while (this.exp >= Player.xpForLevel(this.level + 1)) {
      this.level++
      this.onLevelUp?.(this.level)
    }
  }

  isAlive(): boolean {
    return this.hp > 0
  }

  takeTurn(): void {
    // Player is driven by input, not the turn manager callback
  }
}
