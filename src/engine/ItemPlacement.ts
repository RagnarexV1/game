import type { MapSystem } from './MapSystem'
import type { ItemDef } from '../types'
import itemData from '../data/items.json'

const ITEMS = itemData as ItemDef[]

// Unique/quest items — kept only at their hand-placed spot, never duplicated by random scatter.
const EXCLUDE_IDS = new Set(['gong', 'gongmallet', 'second_life_potion', 'mystery_potion'])

// Items clearly tied to one kind of location — never scattered onto an unrelated map type.
const RESTRICTED: Record<string, string[]> = {
  stop:           ['bathroom'],
  gompie:         ['garage', 'driveway'],
  lego1:          ['loft'],
  lego2:          ['loft'],
  lego3:          ['loft'],
  empty_vial:     ['study'],
  theedoek:       ['kitchen'],
  remote:         ['kitchen'],
  tuinschaar:     ['forest'],
  tuinhandschoen: ['forest'],
  madelief:       ['forest'],
  ericgras:       ['forest'],
  petergras:      ['forest'],
  mispel:         ['forest'],
  lekkervisje:    ['kitchen'],
}

// Tile ids that shouldn't get an item sitting on them (transit/interactive tiles).
const BLOCKED_SUBSTRINGS = ['exit', 'portal', 'door', 'stairs']
function isSpecialTile(defId: string): boolean {
  if (defId === 'vortex_portal' || defId === 'flame') return true
  return BLOCKED_SUBSTRINGS.some(s => defId.includes(s))
}

// Rarer/more powerful items get a lower weight, so they show up less often.
function rarityWeight(item: ItemDef): number {
  const power =
    (item.damage ?? 0) * 3 +
    (item.defense ?? 0) * 4 +
    Math.max(0, item.healAmount ?? 0) * 0.5 +
    (item.speedBonus ?? 0) * 0.5 +
    (item.value ?? 0) * 0.3
  return Math.max(1, Math.round(200 / (10 + power)))
}

function buildPool(category: string): Array<{ id: string; weight: number }> {
  return ITEMS
    .filter(it => !it.relic && !EXCLUDE_IDS.has(it.id))
    .filter(it => !RESTRICTED[it.id] || RESTRICTED[it.id].includes(category))
    .map(it => ({ id: it.id, weight: rarityWeight(it) }))
}

function pickWeighted(pool: Array<{ id: string; weight: number }>, rng: () => number): string {
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  let roll = rng() * total
  for (const p of pool) {
    roll -= p.weight
    if (roll <= 0) return p.id
  }
  return pool[pool.length - 1].id
}

export interface ScatteredItem {
  x: number
  y: number
  defId: string
  qty?: number
}

/**
 * Scatters `count` random items of rarity-weighted defs across walkable tiles
 * of `category`-appropriate loot, avoiding any tile in `avoid`. Meant to be
 * called once, right before a map's SpawnPoints are returned on first load —
 * cellSnapshots persist the result afterwards.
 */
export function scatterRandomItems(
  map: MapSystem,
  rng: () => number,
  category: string,
  count: number,
  avoid: Array<{ x: number; y: number }> = [],
): ScatteredItem[] {
  const pool = buildPool(category)
  if (pool.length === 0 || count <= 0) return []

  const avoidSet = new Set(avoid.map(p => `${p.x},${p.y}`))
  const taken = new Set<string>()
  const results: ScatteredItem[] = []
  const W = map.width, H = map.height
  let attempts = 0

  while (results.length < count && attempts < count * 50) {
    attempts++
    const x = Math.floor(rng() * W)
    const y = Math.floor(rng() * H)
    const key = `${x},${y}`
    if (taken.has(key) || avoidSet.has(key)) continue
    if (!map.isWalkable(x, y)) continue
    const tile = map.getTile(x, y)
    if (tile && isSpecialTile(tile.defId)) continue

    taken.add(key)
    const defId = pickWeighted(pool, rng)
    results.push(defId === 'gold_coin'
      ? { x, y, defId, qty: 10 + Math.floor(rng() * 40) }
      : { x, y, defId, qty: 1 })
  }
  return results
}
