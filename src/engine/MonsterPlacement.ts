import type { MapSystem } from './MapSystem'
import { isSpecialTile } from './ItemPlacement'
import { AREA_MONSTERS, MONSTER_TIER, areaInfo, monsterTierFactor, pickWeighted, type Tier } from './SpawnTables'

export interface PlacedMonster {
  x: number
  y: number
  defId: string
}

/** Picks one generic monster id for `area`, weighted by how well its tier suits the area. */
export function pickAreaMonster(area: string, rng: () => number, tierOverride?: Tier): string {
  const { category, tier } = areaInfo(area, tierOverride)
  const pool = (AREA_MONSTERS[category] ?? [])
    .map(id => ({ value: id, weight: monsterTierFactor(tier, MONSTER_TIER[id] ?? 1) }))
    .filter(p => p.weight > 0)
  if (pool.length === 0) throw new Error(`No monster pool for area '${area}'`)
  return pickWeighted(pool, rng)
}

export interface SpawnOptions {
  tierOverride?: Tier
  /** Tiles to keep free (player spawn, fixed monsters/items, …). */
  avoid?: Array<{ x: number; y: number }>
  /** Keep this far (dx < 5, dy < 3 box) from the player's spawn. */
  player?: { x: number; y: number }
  /** Restrict placement to this rectangle (inclusive). Defaults to the whole map minus its border. */
  bounds?: { x1: number; y1: number; x2: number; y2: number }
  /** Extra per-tile veto. */
  allow?: (x: number, y: number) => boolean
}

/**
 * Places `count` generic hostiles from `area`'s pool on random walkable,
 * non-special tiles. Use only for the "filler" monsters of a map — NPCs,
 * bosses and set-pieces stay hand-placed.
 */
export function spawnRandomMonsters(
  map: MapSystem,
  rng: () => number,
  area: string,
  count: number,
  opts: SpawnOptions = {},
): PlacedMonster[] {
  const b = opts.bounds ?? { x1: 1, y1: 1, x2: map.width - 2, y2: map.height - 2 }
  const taken = new Set((opts.avoid ?? []).map(p => `${p.x},${p.y}`))
  const results: PlacedMonster[] = []
  let attempts = 0
  while (results.length < count && attempts < count * 100) {
    attempts++
    const x = b.x1 + Math.floor(rng() * (b.x2 - b.x1 + 1))
    const y = b.y1 + Math.floor(rng() * (b.y2 - b.y1 + 1))
    const key = `${x},${y}`
    if (taken.has(key)) continue
    if (!map.isWalkable(x, y)) continue
    const tile = map.getTile(x, y)
    if (tile && isSpecialTile(tile.defId)) continue
    if (opts.player && Math.abs(x - opts.player.x) < 5 && Math.abs(y - opts.player.y) < 3) continue
    if (opts.allow && !opts.allow(x, y)) continue
    taken.add(key)
    results.push({ x, y, defId: pickAreaMonster(area, rng, opts.tierOverride) })
  }
  return results
}
