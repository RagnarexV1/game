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
// Tier 4 = endgame monsters: rare, and only in the pools that list them.
export type MonsterTier = Tier | 4

const MONSTER_TIER_FACTOR: Record<Tier, Record<MonsterTier, number>> = {
  1: { 1: 1.0, 2: 0.1, 3: 0,    4: 0 },
  2: { 1: 0.8, 2: 1.2, 3: 0.15, 4: 0.3 },
  3: { 1: 0.5, 2: 1,   3: 1.2,  4: 0.5 },
}

export function itemTierFactor(areaTier: Tier, itemTier: Tier): number {
  return ITEM_TIER_FACTOR[areaTier][itemTier]
}

export function monsterTierFactor(areaTier: Tier, monsterTier: MonsterTier): number {
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
  clover: 3,
}

// Hand overrides where the power formula misjudges an item.
const ITEM_TIER_OVERRIDE: Record<string, Tier> = {
  gold_coin: 1,
  sinaasappel: 1,
  health_potion: 1,
  scroll_teleport: 1,
  ring_invisibility: 2,
  ring_cold: 3,
  ring_locus: 3,
  amulet: 3,
  wand: 2,
  wand_displacement: 2,
  wand_fire: 2,
  wand_cold: 2,
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
  leatherboots:   ['garage', 'hall'],
  flying_flippo:  ['loft'],
  ring_agility:   [],
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

export const MONSTER_TIER: Record<string, MonsterTier> = {
  snail: 1, hagedis: 1, egel: 1, rat: 1, wilddog: 1, wildboar: 1,
  silvervisje: 1, pissebed: 1, spetterpoep: 1, salamander: 1, bat: 1, stinkdier: 1, secitt: 1, dwarf: 1, spirit: 1,
  mier: 1, worm: 1, koe: 1, mol: 1,
  nymph: 2, muddman: 2, lowerdwarf: 2, hamster: 2, ogre: 2, rockgiant: 2,
  wizard: 2, magician: 2, sorcerer: 2, cockatrice: 2, swordsman: 2, blauwkip: 2, migdnart: 2,
  troll: 3, werewolf: 3, schaap: 3,
  shade: 4, pelgrat: 4, jacchus: 4, draugr: 4,
}

// Generic hostile pools per area category. NPCs, bosses, set-pieces and
// decorative monsters stay hand-placed in the map generators / mapSpawns.json.
export const AREA_MONSTERS: Record<string, string[]> = {
  // Werewolves stay out of the garden pool; the bottom-right cell places its one by hand.
  // Sheep only graze in tier-3 garden cells (see generateForestMap).
  forest:      ['snail', 'hagedis', 'egel', 'rat', 'wilddog', 'wildboar', 'stinkdier', 'rockgiant', 'troll', 'ogre',
                'mier', 'schaap', 'worm', 'koe', 'mol'],
  bathroom:    ['silvervisje', 'pissebed', 'muddman', 'spetterpoep', 'salamander', 'troll', 'swordsman'],
  garage:      ['bat', 'pissebed', 'dwarf', 'lowerdwarf', 'rockgiant'],
  kitchen:     ['rat', 'secitt', 'hamster', 'swordsman', 'blauwkip'],
  // Cockatrices only roam from the first floor up: the upper halls, bedrooms and loft
  // (the ground-floor hall cells scale them out, see generateHallMap).
  // Endgame monsters: all four in the loft and Peter and the wolf (not the loft stairs),
  // shade and pelgrat in the bottom row of the lower hall and both upper halls.
  loft:        ['bat', 'stinkdier', 'hamster', 'werewolf', 'blauwkip', 'rockgiant', 'cockatrice', 'shade', 'pelgrat', 'jacchus', 'draugr'],
  hall: ['bat', 'pissebed', 'dwarf', 'lowerdwarf', 'muddman', 'spirit', 'wizard', 'magician', 'sorcerer', 'ogre',
         'rat', 'swordsman', 'nymph', 'stinkdier', 'werewolf', 'troll', 'blauwkip', 'migdnart', 'rockgiant',
         'cockatrice', 'shade', 'pelgrat'],
  bedroom:     ['spirit', 'nymph', 'ogre', 'rockgiant', 'wizard', 'magician', 'sorcerer', 'troll', 'werewolf', 'blauwkip', 'migdnart', 'cockatrice'],
}

// weightScale that keeps the endgame monsters out of a map whose pool lists them.
export const NO_ENDGAME: Record<string, number> = { shade: 0, pelgrat: 0, jacchus: 0, draugr: 0 }

// Fixed weights that replace the tier factor for a monster in one area category,
// for monsters that belong there despite their tier.
export const AREA_MONSTER_WEIGHT: Record<string, Record<string, number>> = {
  bathroom: { troll: 0.3, swordsman: 0.4 },
  // The garage is an early area, but a rock giant still lumbers in now and then
  garage: { rockgiant: 0.15 },
}

// Garden animals that also stray into every other area's random pool, at
// GARDEN_STRAY_FACTOR of their normal weight.
export const GARDEN_STRAYS = ['mier', 'worm', 'koe', 'mol']
export const GARDEN_STRAY_FACTOR = 0.25

// Every map scatters this many times its base number of random items (extras included).
export const ITEM_DENSITY = 2 / 3

// Every map holds this many times its base number of generic hostiles.
export const MONSTER_DENSITY = 1.5

/** Scales a base hostile count by MONSTER_DENSITY, rounding the fraction randomly. */
export function scaleMonsterCount(count: number, rng: () => number): number {
  const scaled = count * MONSTER_DENSITY
  const whole = Math.floor(scaled)
  return whole + (rng() < scaled - whole ? 1 : 0)
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
