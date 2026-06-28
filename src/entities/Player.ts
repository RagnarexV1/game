import type { ItemInstance, EquipmentSlots } from '../types'
import type { EquipmentSystem } from '../engine/EquipmentSystem'
import type { InventorySystem } from '../engine/InventorySystem'

export class Player {
  readonly id = 'player'
  speed = 100
  energy = 100

  x = 0
  y = 0

  name = 'Hero'

  hp = 314
  maxHp = 314
  str = 18
  mag = 17
  food = 100
  maxFood = 100
  exp = 26
  con = 9
  luck = 31
  gold = 624
  secondLife = false
  spriteKey = 'player'
  petrified = 0
  petrifyCountdown = 0
  clayProtection = 0
  allianceTurns = 0
  timestopTurns = 0
  drunkTurns = 0
  phasingTurns = 0
  itemVision = false
  gender: 'male' | 'female' = 'male'
  extraFingers = 0
  extraEyes = 0
  race = 'human'
  playerClass = 'adventurer'
  level = 1
  morality = 'high'
  diagnostics: string[] = []

  inventory: ItemInstance[] = []
  equipment: EquipmentSlots = {
    weapon: null,
    body:   null,
    head:   null,
    hand:   null,
    feet:   null,
    leg:    null,
    neck:   null,
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
    if (!this.equipSys) return 4
    return this.equipSys.getWeaponDamage(this.equipment, this.invSys)
  }

  getAC(): number {
    if (!this.equipSys) return 10
    return 10 - this.equipSys.getArmorBonus(this.equipment, this.invSys)
  }

  gainXP(amount: number): void {
    this.exp += amount
  }

  isAlive(): boolean {
    return this.hp > 0
  }

  takeTurn(): void {
    // Player is driven by input, not the turn manager callback
  }
}
