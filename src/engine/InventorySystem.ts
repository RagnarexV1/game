import type { ItemInstance, ItemDef } from '../types'
import type { MessageLog } from './MessageLog'
import itemData from '../data/items.json'

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

  getDefsByType(type: string): ItemDef[] {
    const result: ItemDef[] = []
    for (const def of this.itemDefs.values()) {
      if (def.type === type && !def.relic) result.push(def)
    }
    return result
  }

  createInstance(defId: string, quantity = 1): ItemInstance {
    return {
      instanceId: `item_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      defId,
      quantity,
    }
  }

  addToInventory(inventory: ItemInstance[], item: ItemInstance): boolean {
    const def = this.itemDefs.get(item.defId)
    if (!def) return false

    // Stack gold
    if (def.type === 'gold') {
      const existing = inventory.find(i => i.defId === item.defId)
      if (existing) {
        existing.quantity += item.quantity
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
