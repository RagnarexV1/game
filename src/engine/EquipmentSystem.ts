import type { ItemInstance, EquipmentSlots, ItemDef } from '../types'
import type { MessageLog } from './MessageLog'
import type { InventorySystem } from './InventorySystem'

export class EquipmentSystem {
  constructor(
    private log: MessageLog,
    private inventory: InventorySystem,
  ) {}

  equip(
    inv: ItemInstance[],
    equipment: EquipmentSlots,
    instanceId: string,
    player?: { speed: number },
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

    // Rings go into the first free ring slot (max 6)
    if (def.slot === 'ring') {
      const ringSlots = ['ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6'] as const
      const freeSlot = ringSlots.find(s => !equipment[s])
      if (!freeSlot) {
        this.log.add(`You can't wear more than 6 rings.`, '#ff8080')
        return false
      }
      const idx = inv.findIndex(i => i.instanceId === instanceId)
      if (idx !== -1) inv.splice(idx, 1)
      equipment[freeSlot] = item
      if (player && def.speedBonus) player.speed += def.speedBonus
      this.log.add(`You put on the ${def.name}.`, '#00ff80')
      return true
    }

    const slot = def.slot as keyof EquipmentSlots
    const current = equipment[slot]

    if (current) {
      // Unequip current item back to inventory — remove its speed bonus first
      if (player) {
        const currentDef = this.inventory.getDef(current.defId) as ItemDef | undefined
        if (currentDef?.speedBonus) player.speed -= currentDef.speedBonus
      }
      inv.push(current)
      this.log.add(`You remove the ${this.inventory.getItemName(current)}.`, '#c0c0c0')
    }

    // Remove from inventory and equip
    const idx = inv.findIndex(i => i.instanceId === instanceId)
    if (idx !== -1) inv.splice(idx, 1)
    equipment[slot] = item
    if (player && def.speedBonus) player.speed += def.speedBonus
    this.log.add(`You equip the ${def.name}.`, '#00ff80')
    return true
  }

  unequip(
    inv: ItemInstance[],
    equipment: EquipmentSlots,
    slot: keyof EquipmentSlots,
    player?: { speed: number },
  ): boolean {
    const item = equipment[slot]
    if (!item) return false
    if (player) {
      const def = this.inventory.getDef(item.defId) as ItemDef | undefined
      if (def?.speedBonus) player.speed -= def.speedBonus
    }
    equipment[slot] = null
    inv.push(item)
    this.log.add(`You remove the ${this.inventory.getItemName(item)}.`, '#c0c0c0')
    return true
  }

  getWeaponDamage(equipment: EquipmentSlots, inventory: InventorySystem): number {
    const weapon = equipment.weapon
    if (!weapon) return 4 // bare hands
    const def = inventory.getDef(weapon.defId) as ItemDef | undefined
    return def?.damage ?? 4
  }

  getArmorBonus(equipment: EquipmentSlots, inventory: InventorySystem): number {
    let bonus = 0
    const slots: (keyof EquipmentSlots)[] = ['body', 'head', 'feet', 'hand', 'leg', 'neck', 'shield', 'ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6']
    for (const slot of slots) {
      const item = equipment[slot]
      if (!item) continue
      const def = inventory.getDef(item.defId) as ItemDef | undefined
      bonus += def?.defense ?? 0
    }
    return bonus
  }
}
