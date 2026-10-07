import type { ItemDef } from '../types'

// ── Per-game run seed ──────────────────────────────────────────────────────
// Map layouts use fixed seeds (so hand-tuned geometry stays put), but loot and
// generic monsters are rolled from spawnRng(), which mixes in a seed rolled
// once per game. WorldState owns the value and pushes it here.

let runSeed = 0

export function setRunSeed(seed: number): void {
  runSeed = seed >>> 0
}

export function rollRunSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/** RNG for spawns on one map: stable within a game, different between games. */
export function spawnRng(base: number): () => number {
  let s = (Math.imul(base | 0, 2654435761) ^ runSeed) >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
  // Discard a few values so nearby seeds don't produce near-identical streams.
  for (let i = 0; i < 4; i++) next()
  return next
}

// ── Areas ──────────────────────────────────────────────────────────────────
// `tier` = how deep into the game the area sits (1 early … 3 late).
// `category` = theme used for item affinity / restrictions and monster pools.

export type Tier = 1 | 2 | 3

export interface AreaInfo { tier: Tier; category: string }

export const AREAS: Record<string, AreaInfo> = {
  forest:        { tier: 1, category: 'forest' },
  bathroom:      { tier: 1, category: 'bathroom' },
  garage:        { tier: 1, category: 'garage' },
  kitchen:       { tier: 1, category: 'kitchen' },
  tub_enclosure:        { tier: 2, category: 'tub_enclosure' },
  study:         { tier: 2, category: 'study' },
  loft:          { tier: 2, category: 'loft' },
  loft_stairs:   { tier: 2, category: 'loft' },
  hall:   { tier: 2, category: 'hall' },
  upper_hall_left:  { tier: 2, category: 'hall' },
  upper_hall_right: { tier: 2, category: 'hall' },
  loft3:         { tier: 3, category: 'loft' },
  bedroom:       { tier: 3, category: 'bedroom' },
  bedroom_lower: { tier: 3, category: 'bedroom' },
  chaos:         { tier: 3, category: 'chaos' },
}

/** Forest cells get harder the further they are from the start cell (0,0). */
export function forestCellTier(cx: number, cy: number): Tier {
  const d = cx + cy
  return d <= 1 ? 1 : d <= 3 ? 2 : 3
}

export function areaInfo(area: string, tierOverride?: Tier): AreaInfo {
  const info = AREAS[area] ?? { tier: 1, category: area }
  return tierOverride ? { ...info, tier: tierOverride } : info
}

// TIER_FACTOR[areaTier][entityTier]: how strongly an area favours each tier.
// Early areas almost never hold late-game stuff; late areas lean on it.
// Item factors are steep because strong items already have a low base weight.
const ITEM_TIER_FACTOR: Record<Tier, Record<Tier, number>> = {
  1: { 1: 1.0, 2: 0.25, 3: 0 },
  2: { 1: 0.6, 2: 3,    3: 0.5 },
  3: { 1: 0.3, 2: 2,    3: 5 },
}

// Monsters all have equal base weight, so their table is gentler.
const MONSTER_TIER_FACTOR: Record<Tier, Record<Tier, number>> = {
  1: { 1: 1.0, 2: 0.1, 3: 0 },
  2: { 1: 0.8, 2: 1.2, 3: 0.15 },
  3: { 1: 0.5, 2: 1,   3: 1.2 },
}

export function itemTierFactor(areaTier: Tier, itemTier: Tier): number {
  return ITEM_TIER_FACTOR[areaTier][itemTier]
}

export function monsterTierFactor(areaTier: Tier, monsterTier: Tier): number {
  return MONSTER_TIER_FACTOR[areaTier][monsterTier]
}

// ── Items ──────────────────────────────────────────────────────────────────

export function itemPower(item: ItemDef): number {
  return (item.damage ?? 0) * 3 +
    (item.defense ?? 0) * 4 +
    Math.max(0, item.healAmount ?? 0) * 0.5 +
    (item.speedBonus ?? 0) * 0.5 +
    (item.value ?? 0) * 0.3
}

// Base-weight overrides for staples that should stay common despite their value.
export const ITEM_WEIGHT_OVERRIDE: Record<string, number> = {
  health_potion: 15,
  sinaasappel: 5,
  amulet: 1,
}

// Hand overrides where the power formula misjudges an item.
const ITEM_TIER_OVERRIDE: Record<string, Tier> = {
  gold_coin: 1,
  sinaasappel: 1,
  health_potion: 1,
  scroll_teleport: 1,
  ring_invisibility: 3,
  ring_cold: 3,
  ring_locus: 3,
  amulet: 3,
  wand: 2,
  wand_displacement: 2,
  wand_fire: 3,
  wand_cold: 3,
  wand_evocation: 2,
  wand_tunneling: 2,
}

export function itemTier(item: ItemDef): Tier {
  const o = ITEM_TIER_OVERRIDE[item.id]
  if (o) return o
  const p = itemPower(item)
  return p < 35 ? 1 : p <= 90 ? 2 : 3
}

// Area categories where an item type feels at home (weight × AFFINITY_BOOST).
// Items can still appear elsewhere, just less often.
export const AFFINITY_BOOST = 4

const AFFINITY_BY_TYPE: Record<string, string[]> = {
  eat:    ['kitchen'],
  drink:  ['study', 'tub_enclosure'],
  scroll: ['study', 'bedroom'],
  weapon: ['hall', 'garage'],
  armor:  ['hall', 'bedroom'],
  ring:   ['bedroom', 'chaos'],
  wand:   ['bedroom', 'study'],
  tool:   ['garage'],
  gold:   ['hall', 'chaos'],
}

// Per-item overrides (replace the type default).
const AFFINITY_BY_ID: Record<string, string[]> = {
  branch:         ['forest'],
  madelief:       ['forest'],
  pickaxe:        ['garage', 'hall'],
  kruk:           ['kitchen'],
  wasknijper:     ['bathroom', 'garage'],
  wasknijperbom:  ['bathroom', 'garage'],
  rubberboots:    ['bathroom', 'garage'],
  flying_flippo:  ['loft'],
  propje:         ['loft', 'study'],
  redcape:        ['bedroom'],
  clay:           ['hall'],
  speed_potion:   ['study', 'forest'],
  health_potion:  ['study', 'tub_enclosure', 'forest'],
}

export function itemAffinity(item: ItemDef): string[] {
  return AFFINITY_BY_ID[item.id] ?? AFFINITY_BY_TYPE[item.type] ?? []
}

// ── Monsters ───────────────────────────────────────────────────────────────

export const MONSTER_TIER: Record<string, Tier> = {
  snail: 1, hagedis: 1, egel: 1, rat: 1, wilddog: 1, wildboar: 1,
  silvervisje: 1, pissebed: 1, bat: 1, stinkdier: 1, secitt: 1, dwarf: 1, spirit: 1,
  nymph: 2, muddman: 2, lowerdwarf: 2, hamster: 2, ogre: 2,
  wizard: 2, magician: 2, sorcerer: 2, swordsman: 2,
  troll: 3, werewolf: 3,
}

// Generic hostile pools per area category. NPCs, bosses, set-pieces and
// decorative monsters stay hand-placed in the map generators / mapSpawns.json.
export const AREA_MONSTERS: Record<string, string[]> = {
  forest:      ['snail', 'hagedis', 'egel', 'rat', 'wilddog', 'wildboar', 'stinkdier', 'ogre', 'troll', 'werewolf'],
  bathroom:    ['silvervisje', 'pissebed', 'muddman'],
  garage:      ['bat', 'pissebed', 'dwarf', 'lowerdwarf'],
  kitchen:     ['rat', 'secitt', 'hamster', 'swordsman'],
  loft:        ['bat', 'stinkdier', 'hamster', 'werewolf'],
  hall: ['bat', 'pissebed', 'dwarf', 'lowerdwarf', 'muddman', 'spirit', 'wizard', 'magician', 'sorcerer', 'ogre',
         'rat', 'swordsman', 'nymph', 'stinkdier', 'werewolf', 'troll'],
  bedroom:     ['spirit', 'nymph', 'ogre', 'wizard', 'magician', 'sorcerer', 'troll', 'werewolf'],
}

// ── Shared helpers ─────────────────────────────────────────────────────────

export function pickWeighted<T>(pool: Array<{ value: T; weight: number }>, rng: () => number): T {
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  let roll = rng() * total
  for (const p of pool) {
    roll -= p.weight
    if (roll <= 0) return p.value
  }
  return pool[pool.length - 1].value
}
