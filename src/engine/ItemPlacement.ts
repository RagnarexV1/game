import type { MapSystem } from './MapSystem'
import type { ItemDef } from '../types'
import itemData from '../data/items.json'
import { areaInfo, itemPower, itemTier, itemAffinity, itemTierFactor, pickWeighted, AFFINITY_BOOST, ITEM_WEIGHT_OVERRIDE, type Tier } from './SpawnTables'

const ITEMS = itemData as ItemDef[]

// Unique/quest items — kept only at their hand-placed spot, never duplicated by random scatter.
// The Scroll of Transport is placed once or twice per game via WorldState.questSites.
export const EXCLUDE_IDS = new Set(['gong', 'gongmallet', 'second_life_potion', 'mystery_potion', 'invulnerability_potion', 'music_potion', 'transformation_potion', 'clarinet', 'pannenkoek', 'scroll_transport'])

// Items that only ever turn up in random loot on areas of at least this tier.
const MIN_TIER: Record<string, Tier> = {
  amulet: 3,
}

// Items clearly tied to one kind of location — never scattered onto an unrelated map type.
const RESTRICTED: Record<string, string[]> = {
  stop:           ['bathroom'],
  gompie:         ['garage'],
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
  pannenkoeken:   ['kitchen'],
  scroll_fact_beavers:    ['study'],
  scroll_fact_dinosaurs:  ['study'],
  scroll_fact_prokofiev:  ['study'],
  scroll_fact_cavalcanti: ['study'],
  scroll_fact_eric:       ['study'],
  scroll_fact_medlar:     ['study'],
}

// Tile ids that shouldn't get an item (or a random monster) on them (transit/interactive tiles).
const BLOCKED_SUBSTRINGS = ['exit', 'portal', 'door', 'stairs']
export function isSpecialTile(defId: string): boolean {
  if (defId === 'vortex_portal' || defId === 'flame') return true
  return BLOCKED_SUBSTRINGS.some(s => defId.includes(s))
}

// Denominations (in cents) a scattered gold coin can be worth.
const CENT_VALUES = [5, 10, 50, 100, 250, 500]
function rollCentValue(rng: () => number, tier: Tier): number {
  // Deeper areas skip the smallest coins.
  const values = CENT_VALUES.slice(tier - 1)
  return values[Math.floor(rng() * values.length)]
}

// Rarer/more powerful items get a lower base weight, so they show up less often.
function rarityWeight(item: ItemDef): number {
  return ITEM_WEIGHT_OVERRIDE[item.id] ?? Math.max(1, Math.round(200 / (10 + itemPower(item))))
}

/**
 * Loot table for an area: base rarity × how well the item's tier suits the
 * area's tier × a boost when the item thematically belongs in the area.
 */
function buildPool(category: string, tier: Tier): Array<{ value: string; weight: number }> {
  return ITEMS
    .filter(it => !it.relic && !EXCLUDE_IDS.has(it.id))
    .filter(it => !RESTRICTED[it.id] || RESTRICTED[it.id].includes(category))
    .filter(it => tier >= (MIN_TIER[it.id] ?? 1))
    .map(it => {
      const affinity = itemAffinity(it).includes(category) ? AFFINITY_BOOST : 1
      return { value: it.id, weight: rarityWeight(it) * itemTierFactor(tier, itemTier(it)) * affinity }
    })
    .filter(p => p.weight > 0)
}

export interface ScatteredItem {
  x: number
  y: number
  defId: string
  qty?: number
}

/**
 * Drops a single forced-defId item onto a random walkable, non-special tile,
 * avoiding any tile in `avoid`. Used for unique/relic items whose host map is
 * chosen randomly at game start but whose exact tile doesn't need weighting.
 */
export function placeSingleItemRandomly(
  map: MapSystem,
  rng: () => number,
  defId: string,
  avoid: Array<{ x: number; y: number }> = [],
): ScatteredItem | null {
  const avoidSet = new Set(avoid.map(p => `${p.x},${p.y}`))
  const W = map.width, H = map.height
  for (let attempts = 0; attempts < 300; attempts++) {
    const x = Math.floor(rng() * W)
    const y = Math.floor(rng() * H)
    const key = `${x},${y}`
    if (avoidSet.has(key)) continue
    if (!map.isWalkable(x, y)) continue
    const tile = map.getTile(x, y)
    if (tile && isSpecialTile(tile.defId)) continue
    return { x, y, defId, qty: 1 }
  }
  return null
}

/**
 * Scatters `count` random items across walkable tiles, drawn from the loot
 * table of `area` (see AREAS in SpawnTables), avoiding any tile in `avoid`.
 * `tierOverride` lets e.g. a far-away forest cell roll deeper loot. Meant to
 * be called once, right before a map's SpawnPoints are returned on first
 * load — cellSnapshots persist the result afterwards.
 */
export function scatterRandomItems(
  map: MapSystem,
  rng: () => number,
  area: string,
  count: number,
  avoid: Array<{ x: number; y: number }> = [],
  tierOverride?: Tier,
): ScatteredItem[] {
  const { category, tier } = areaInfo(area, tierOverride)
  const pool = buildPool(category, tier)
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
      ? { x, y, defId, qty: rollCentValue(rng, tier) }
      : { x, y, defId, qty: 1 })
  }

  // On top of the regular loot, every map gets some extra food
  const foodPool = buildFoodPool(category)
  const foodCount = Math.ceil(count / 2)
  let placedFood = 0
  attempts = 0
  while (foodPool.length > 0 && placedFood < foodCount && attempts < foodCount * 50) {
    attempts++
    const x = Math.floor(rng() * W)
    const y = Math.floor(rng() * H)
    const key = `${x},${y}`
    if (taken.has(key) || avoidSet.has(key)) continue
    if (!map.isWalkable(x, y)) continue
    const tile = map.getTile(x, y)
    if (tile && isSpecialTile(tile.defId)) continue
    taken.add(key)
    results.push({ x, y, defId: pickWeighted(foodPool, rng), qty: 1 })
    placedFood++
  }
  return results
}

// Edible, non-harmful food for the extra food scatter; oranges a bit more likely.
const NON_FOOD_EAT = new Set(['clay', 'speculaas_bad', 'mispel', 'petergras', 'ericgras', 'madelief'])
function buildFoodPool(category: string): Array<{ value: string; weight: number }> {
  return ITEMS
    .filter(it => it.type === 'eat' && !it.relic && !EXCLUDE_IDS.has(it.id) && !NON_FOOD_EAT.has(it.id))
    .filter(it => !RESTRICTED[it.id] || RESTRICTED[it.id].includes(category))
    .map(it => ({ value: it.id, weight: it.id === 'sinaasappel' ? 2 : 1 }))
}

/** One random item from `area`'s loot table, e.g. for a monster's death drop. */
export function pickAreaItem(area: string, rng: () => number): { defId: string; qty: number } | null {
  const { category, tier } = areaInfo(area)
  const pool = buildPool(category, tier)
  if (pool.length === 0) return null
  const defId = pickWeighted(pool, rng)
  return { defId, qty: defId === 'gold_coin' ? rollCentValue(rng, tier) : 1 }
}
