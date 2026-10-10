import type { ItemInstance, ItemDef } from '../types'
import type { MessageLog } from './MessageLog'
import itemData from '../data/items.json'

export const REMOTE_CHARGES = 20
// Chance an eaten speculaas turns out bad (roughly the spawn ratio of speculaas_bad)
export const BAD_SPECULAAS_CHANCE = 0.5
const WAND_BASE_CHARGES = 6

// Found items vary by up to 30% either way around their base value
function variation(): number {
  return 0.7 + Math.random() * 0.6
}

/** Fresh charge count for a wand: 6 +- 30% (4-8). */
export function rollWandCharges(): number {
  return Math.round(WAND_BASE_CHARGES * variation())
}

function scaled(base: number | undefined, item: ItemInstance): number {
  if (!base) return 0
  if (item.quality === undefined) return base
  return Math.max(1, Math.round(base * item.quality))
}

/** Shop price of this particular item: better-rolled weapons and armour cost more. */
export function itemValue(def: ItemDef | undefined, item: ItemInstance): number {
  const value = def?.value ?? 0
  return item.quality === undefined ? value : Math.round(value * item.quality)
}

/** Damage of this particular weapon (its base damage scaled by its quality roll). */
export function itemDamage(def: ItemDef, item: ItemInstance): number {
  if (def.id === 'shuriken') return def.damage ?? 0
  return scaled(def.damage, item)
}

/** Defense of this particular piece of armour (its base defense scaled by its quality roll). */
export function itemDefense(def: ItemDef, item: ItemInstance): number {
  return scaled(def.defense, item)
}

export class InventorySystem {
  private itemDefs: Map<string, ItemDef>

  constructor(private log: MessageLog) {
    this.itemDefs = new Map()
    for (const def of itemData as ItemDef[]) {
      this.itemDefs.set(def.id, def)
    }
  }

  getDef(defId: string): ItemDef | undefined {
    return this.itemDefs.get(defId)
  }

  getAllDefs(): ItemDef[] {
    return [...this.itemDefs.values()]
  }

  getDefsByType(type: string): ItemDef[] {
    const result: ItemDef[] = []
    for (const def of this.itemDefs.values()) {
      if (def.type === type && !def.relic) result.push(def)
    }
    return result
  }

  createInstance(defId: string, quantity = 1): ItemInstance {
    // A generic 'wand' (hand-placed spawns, monster drops) becomes a random kind of wand
    if (defId === 'wand') defId = this.randomWandId()
    const instance: ItemInstance = {
      instanceId: `item_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      defId,
      quantity,
    }
    const def = this.itemDefs.get(defId)
    if (def?.wandEffect) instance.charges = rollWandCharges()
    // Shurikens always deal their base damage, so every one is alike and they stack
    if (((def?.type === 'weapon' && def.damage) || ((def?.type === 'armor' || def?.type === 'ring') && def.defense)) && defId !== 'shuriken') {
      instance.quality = variation()
    }
    if (defId === 'remote') instance.charges = REMOTE_CHARGES
    return instance
  }

  randomWandId(): string {
    const wands = [...this.itemDefs.values()].filter(d => d.wandEffect)
    return wands[Math.floor(Math.random() * wands.length)].id
  }

  /**
   * `canMergeInto` limits which existing stacks an item may join (e.g. not
   * an unpaid shop stack); pass null to never stack.
   */
  addToInventory(
    inventory: ItemInstance[], item: ItemInstance,
    canMergeInto: ((existing: ItemInstance) => boolean) | null = () => true,
  ): boolean {
    // Good and bad speculaas look alike: in the pack they become one stack,
    // and whether a biscuit is bad is only decided when it is eaten
    if (item.defId === 'speculaas_bad') item.defId = 'speculaas'
    const def = this.itemDefs.get(item.defId)
    if (!def) return false

    // Older saves may still hold quality-rolled shurikens
    if (item.defId === 'shuriken') delete item.quality

    // Stack gold, speculaas and shurikens
    if ((def.type === 'gold' || item.defId === 'speculaas' || item.defId === 'shuriken') && canMergeInto) {
      const existing = inventory.find(i => i.defId === item.defId && canMergeInto(i))
      if (existing) {
        existing.quantity += item.quantity
        if (def.type !== 'gold') this.log.add(`You pick up ${def.name}. (${existing.quantity})`, '#00ff00')
        return true
      }
    }

    inventory.push(item)
    this.log.add(`You pick up ${def.name}.`, '#00ff00')
    return true
  }

  removeFromInventory(inventory: ItemInstance[], instanceId: string): ItemInstance | null {
    const idx = inventory.findIndex(i => i.instanceId === instanceId)
    if (idx === -1) return null
    return inventory.splice(idx, 1)[0]
  }

  getItemName(item: ItemInstance): string {
    return this.itemDefs.get(item.defId)?.name ?? item.defId
  }
}
