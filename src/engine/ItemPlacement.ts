import type { MapSystem } from './MapSystem'
import type { ItemDef } from '../types'
import itemData from '../data/items.json'
import { areaInfo, itemPower, itemTier, itemAffinity, itemTierFactor, pickWeighted, AFFINITY_BOOST, ITEM_DENSITY, ITEM_WEIGHT_OVERRIDE, type Tier } from './SpawnTables'

const ITEMS = itemData as ItemDef[]

// Unique/quest items — kept only at their hand-placed spot, never duplicated by random scatter.
// The Scroll of Transport and the empty vials are placed per game via WorldState.questSites;
// the Gompie only lies in the garage (and is sold in the pantry).
export const EXCLUDE_IDS = new Set(['gong', 'gongmallet', 'second_life_potion', 'mystery_potion', 'invulnerability_potion', 'music_potion', 'transformation_potion', 'clarinet', 'pannenkoek', 'scroll_transport', 'gompie', 'empty_vial', 'ring_hastening', 'telephone', 'apple_juice'])

// Items lying at the bottom of bath water stay unseen until it drains. The local
// map always hides them; the world map shows them under Depredation (item vision).
const SUBMERGED_IDS = new Set(['ring_hastening'])
export function isHiddenUnderWater(defId: string, tileDefId: string | undefined, itemVision: boolean): boolean {
  return SUBMERGED_IDS.has(defId) && tileDefId === 'water_bath' && !itemVision
}

// Items that only ever turn up in random loot on areas of at least this tier.
const MIN_TIER: Record<string, Tier> = {
  amulet: 3,
  // Skill-teaching Scrolls of Knowledge; the fact scrolls turn up anywhere.
  scroll_knowledge:     2,
  scroll_ventriloquism: 2,
  scroll_skill_cartography: 2,
  scroll_skill_relocation:  2,
}

// Items clearly tied to one kind of location — never scattered onto an unrelated map type.
const RESTRICTED: Record<string, string[]> = {
  stop:           ['bathroom'],
  lego1:          ['loft'],
  lego2:          ['loft'],
  lego3:          ['loft'],
  theedoek:       ['kitchen'],
  remote:         ['kitchen'],
  tuinschaar:     ['forest'],
  tuinhandschoen: ['forest'],
  madelief:       ['forest'],
  ericgras:       ['forest'],
  petergras:      ['forest'],
  clover:         ['forest'],
  mispel:         ['forest'],
  lekkervisje:    ['kitchen'],
  pannenkoeken:   ['kitchen'],
}

// Items that never turn up in random loot on these area categories.
const FORBIDDEN: Record<string, string[]> = {
  ring_invisibility: ['forest'],
}

// Shuriken and wands only turn up from the hall onwards, never in the early areas
// (`allowWands` lifts that for wands on a single map).
const EARLY_AREAS = ['forest', 'bathroom', 'garage', 'kitchen', 'tub_enclosure']
function isForbidden(it: ItemDef, category: string, allowWands = false): boolean {
  if (FORBIDDEN[it.id]?.includes(category)) return true
  const isWand = it.type === 'wand' && it.id !== 'remote'
  const hallOnward = it.id === 'shuriken' || (isWand && !allowWands)
  return hallOnward && EARLY_AREAS.includes(category)
}

// Plants that only ever grow on grass tiles (never on floor, mud, …).
const GRASS_ONLY = new Set(['clover', 'ericgras', 'petergras'])
function fitsTile(defId: string, tileDefId: string | undefined): boolean {
  return !GRASS_ONLY.has(defId) || tileDefId === 'grass'
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
function buildPool(category: string, tier: Tier, allowWands = false): Array<{ value: string; weight: number }> {
  return ITEMS
    .filter(it => !it.relic && !EXCLUDE_IDS.has(it.id))
    .filter(it => !RESTRICTED[it.id] || RESTRICTED[it.id].includes(category))
    .filter(it => !isForbidden(it, category, allowWands))
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
    if (!fitsTile(defId, tile?.defId)) continue
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
  allowWands = false,
): ScatteredItem[] {
  const { category, tier } = areaInfo(area, tierOverride)
  const pool = buildPool(category, tier, allowWands)
  count = Math.round(count * ITEM_DENSITY)
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

    const defId = pickWeighted(pool, rng)
    if (!fitsTile(defId, tile?.defId)) continue
    taken.add(key)
    results.push(defId === 'gold_coin'
      ? { x, y, defId, qty: rollCentValue(rng, tier) }
      : { x, y, defId, qty: 1 })
  }

  // On top of the regular loot, every map gets some extra food and potions,
  // and the garden and halls some extra scrolls
  const extras: Array<[Array<{ value: string; weight: number }>, number]> = [
    [buildFoodPool(category), Math.ceil(count / 2)],
    [buildPotionPool(), Math.ceil(count / 3)],
  ]
  if (category === 'forest' || category === 'hall') extras.push([SCROLL_POOL, Math.ceil(count / 3)])
  for (const [pool, extraCount] of extras) {
    let placed = 0
    attempts = 0
    while (pool.length > 0 && placed < extraCount && attempts < extraCount * 50) {
      attempts++
      const x = Math.floor(rng() * W)
      const y = Math.floor(rng() * H)
      const key = `${x},${y}`
      if (taken.has(key) || avoidSet.has(key)) continue
      if (!map.isWalkable(x, y)) continue
      const tile = map.getTile(x, y)
      if (tile && isSpecialTile(tile.defId)) continue
      const defId = pickWeighted(pool, rng)
      if (!fitsTile(defId, tile?.defId)) continue
      taken.add(key)
      results.push({ x, y, defId, qty: 1 })
      placed++
    }
  }
  return results
}

// Extra scrolls for the garden and halls; mostly teleportation.
const SCROLL_POOL: Array<{ value: string; weight: number }> = [
  { value: 'scroll_teleport', weight: 2 },
  { value: 'scroll_alliance', weight: 1 },
  { value: 'scroll_cartography', weight: 1 },
  { value: 'scroll_timestop', weight: 1 },
  { value: 'scroll_twelvegates', weight: 1 },
  { value: 'scroll_lavastrike', weight: 1 },
]

// Plain potions (the mixed/unique ones stay out); health potions a bit more likely.
function buildPotionPool(): Array<{ value: string; weight: number }> {
  return ITEMS
    .filter(it => it.type === 'drink' && !it.relic && !EXCLUDE_IDS.has(it.id))
    .map(it => ({ value: it.id, weight: it.id === 'health_potion' ? 2 : 1 }))
}

// Simple starter weapons and armour that turn up extra in the garden cells.
const BASIC_GEAR = ['branch', 'tuinschaar', 'wasknijper', 'leather_armor', 'helmet', 'bracers', 'gorget', 'tuinhandschoen', 'rubberboots', 'leatherboots']

/** Places `count` basic weapons/armour on random walkable, non-special tiles. */
export function scatterBasicGear(
  map: MapSystem,
  rng: () => number,
  count: number,
  avoid: Array<{ x: number; y: number }> = [],
): ScatteredItem[] {
  const results: ScatteredItem[] = []
  for (let i = 0; i < count; i++) {
    const defId = BASIC_GEAR[Math.floor(rng() * BASIC_GEAR.length)]
    const placed = placeSingleItemRandomly(map, rng, defId, [...avoid, ...results])
    if (placed) results.push(placed)
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

/**
 * Random stock for Eric the trader's chamber, rerolled each game: any tier,
 * weighted by rarity, but never unique, relic or quest items, coins or junk food.
 */
export function rollTraderStock(rng: () => number, count: number): string[] {
  const pool = ITEMS
    .filter(it => !it.relic && !EXCLUDE_IDS.has(it.id) && it.id !== 'amulet')
    .filter(it => !RESTRICTED[it.id] || RESTRICTED[it.id].includes('forest'))
    .filter(it => it.type !== 'gold' && !NON_FOOD_EAT.has(it.id))
    .map(it => ({ value: it.id, weight: rarityWeight(it) }))
  return Array.from({ length: count }, () => pickWeighted(pool, rng))
}

/** One random item from `area`'s loot table, e.g. for a monster's death drop. */
export function pickAreaItem(area: string, rng: () => number): { defId: string; qty: number } | null {
  const { category, tier } = areaInfo(area)
  const pool = buildPool(category, tier)
  if (pool.length === 0) return null
  const defId = pickWeighted(pool, rng)
  return { defId, qty: defId === 'gold_coin' ? rollCentValue(rng, tier) : 1 }
}
