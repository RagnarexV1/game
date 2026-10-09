import type { ItemInstance, EquipmentSlots, ItemDef } from '../types'
import type { MessageLog } from './MessageLog'
import { itemDamage, itemDefense, type InventorySystem } from './InventorySystem'

const UNIQUE_RINGS = new Set(['ring_hastening'])

export class EquipmentSystem {
  constructor(
    private log: MessageLog,
    private inventory: InventorySystem,
  ) {}

  equip(
    inv: ItemInstance[],
    equipment: EquipmentSlots,
    instanceId: string,
    player?: { speed: number; str: number },
  ): boolean {
    const item = inv.find(i => i.instanceId === instanceId)
    if (!item) return false

    const def = this.inventory.getDef(item.defId)
    if (!def || !def.slot) {
      this.log.add(`You can't equip that.`, '#ff8080')
      return false
    }

    // Tools can't be equipped
    if (def.slot === 'tool') {
      this.log.add(`You can't equip that.`, '#ff8080')
      return false
    }

    // Some items are throw-only
    if (def.noWield) {
      this.log.add(`You can't wield that. You can only throw it.`, '#ff8080')
      return false
    }

    // Rings go into the first free ring slot (max 6)
    if (def.slot === 'ring') {
      const ringSlots = ['ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6'] as const
      // Unique rings: only one of each may be worn, like the amulet
      if (UNIQUE_RINGS.has(def.id) && ringSlots.some(s => equipment[s]?.defId === def.id)) {
        this.log.add(`You can only wear one ${def.name}.`, '#ff8080')
        return false
      }
      const freeSlot = ringSlots.find(s => !equipment[s])
      if (!freeSlot) {
        this.log.add(`You can't wear more than 6 rings.`, '#ff8080')
        return false
      }
      const idx = inv.findIndex(i => i.instanceId === instanceId)
      if (idx !== -1) inv.splice(idx, 1)
      equipment[freeSlot] = item
      if (player) this.applyBonuses(def, player, 1)
      this.log.add(`You put on the ${def.name}.`, '#00ff80')
      return true
    }

    const slot = def.slot as keyof EquipmentSlots
    const current = equipment[slot]

    if (current) {
      // Unequip current item back to inventory — remove its speed bonus first
      if (player) {
        const currentDef = this.inventory.getDef(current.defId) as ItemDef | undefined
        if (currentDef) this.applyBonuses(currentDef, player, -1)
      }
      inv.push(current)
      this.log.add(`You remove the ${this.inventory.getItemName(current)}.`, '#c0c0c0')
    }

    // Remove from inventory and equip
    const idx = inv.findIndex(i => i.instanceId === instanceId)
    if (idx !== -1) inv.splice(idx, 1)
    equipment[slot] = item
    if (player) this.applyBonuses(def, player, 1)
    this.log.add(slot === 'launcher' ? `You ready the ${def.name} for shooting.` : `You equip the ${def.name}.`, '#00ff80')
    return true
  }

  unequip(
    inv: ItemInstance[],
    equipment: EquipmentSlots,
    slot: keyof EquipmentSlots,
    player?: { speed: number; str: number },
  ): boolean {
    const item = equipment[slot]
    if (!item) return false
    if (player) {
      const def = this.inventory.getDef(item.defId) as ItemDef | undefined
      if (def) this.applyBonuses(def, player, -1)
    }
    equipment[slot] = null
    inv.push(item)
    this.log.add(`You remove the ${this.inventory.getItemName(item)}.`, '#c0c0c0')
    return true
  }

  // Stat bonuses an item grants while worn; sign -1 takes them off again.
  private applyBonuses(def: ItemDef, player: { speed: number; str: number }, sign: 1 | -1): void {
    if (def.speedBonus) player.speed += sign * def.speedBonus
    if (def.strBonus) player.str += sign * def.strBonus
  }

  getWeaponDamage(equipment: EquipmentSlots, inventory: InventorySystem): number {
    const weapon = equipment.weapon
    if (!weapon) return 2 // bare hands
    const def = inventory.getDef(weapon.defId) as ItemDef | undefined
    return def?.damage ? itemDamage(def, weapon) : 4
  }

  getArmorBonus(equipment: EquipmentSlots, inventory: InventorySystem): number {
    let bonus = 0
    const slots: (keyof EquipmentSlots)[] = ['body', 'head', 'feet', 'hand', 'arms', 'leg', 'neck', 'amulet', 'shield', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6']
    for (const slot of slots) {
      const item = equipment[slot]
      if (!item) continue
      const def = inventory.getDef(item.defId) as ItemDef | undefined
      if (def) bonus += itemDefense(def, item)
    }
    return bonus
  }
}
