import type { MapSystem } from './MapSystem'
import type { WorldState } from './WorldState'
import mapSpawnsData from '../data/mapSpawns.json'
import { scatterRandomItems, placeSingleItemRandomly, scatterBasicGear } from './ItemPlacement'
import { spawnRandomMonsters, pickAreaMonster } from './MonsterPlacement'
import { spawnRng, forestCellTier, scaleMonsterCount } from './SpawnTables'

interface Room {
  x: number; y: number; w: number; h: number
}

export interface SpawnPoints {
  player: { x: number; y: number }
  monsters: Array<{ x: number; y: number; defId: string; message?: string }>
  items: Array<{ x: number; y: number; defId: string; qty?: number }>
}

// Fixed 2-row Ã— 5-column room layout for an 80Ã—20 map
const ROOMS: Room[] = [
  { x: 4,  y: 3,  w: 9,  h: 5 },   // 0
  { x: 18, y: 3,  w: 8,  h: 5 },   // 1
  { x: 33, y: 3,  w: 10, h: 6 },   // 2
  { x: 48, y: 3,  w: 9,  h: 5 },   // 3
  { x: 63, y: 3,  w: 10, h: 5 },   // 4
  { x: 4,  y: 12, w: 9,  h: 5 },   // 5
  { x: 18, y: 12, w: 8,  h: 5 },   // 6
  { x: 33, y: 12, w: 10, h: 5 },   // 7
  { x: 48, y: 12, w: 9,  h: 5 },   // 8
  { x: 63, y: 12, w: 10, h: 5 },   // 9
]

export function generateForestMap(
  map: MapSystem,
  cx: number,
  cy: number,
  world: WorldState,
): SpawnPoints {
  const W = map.width
  const H = map.height
  const G = world.GRID

  // Fill with grass
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'grass')

  // Mountain borders on outer grid edges (2 tiles thick)
  const lBerg = cx === 0
  const rBerg = cx === G - 1
  const tBerg = cy === 0
  const bBerg = cy === G - 1

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((lBerg && x < 2) || (rBerg && x >= W - 2) ||
          (tBerg && y < 2) || (bBerg && y >= H - 2)) {
        map.setTile(x, y, 'berg')
      }
    }
  }

  const rng = seededRng(world.seed)

  // Extra isolated mountain rocks near outer borders for a natural look
  addBorderRocks(map, rng, lBerg, rBerg, tBerg, bBerg, W, H)

  const midX = Math.floor(W / 2)
  const midY = Math.floor(H / 2)

  // Exit tiles along the entire non-mountain border edge
  if (!rBerg) fillExitEdge(map, 'exit_right', W - 1, null,  W, H)
  if (!lBerg) fillExitEdge(map, 'exit_left',  0,     null,  W, H)
  if (!bBerg) fillExitEdge(map, 'exit_down',  null,  H - 1, W, H)
  if (!tBerg) fillExitEdge(map, 'exit_up',    null,  0,     W, H)

  // Random trees â€” avoid border area and exit corridors
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (!rBerg && x >= W - 5 && Math.abs(y - midY) <= 2) continue
      if (!lBerg && x <= 4     && Math.abs(y - midY) <= 2) continue
      if (!bBerg && y >= H - 5 && Math.abs(x - midX) <= 2) continue
      if (!tBerg && y <= 4     && Math.abs(x - midX) <= 2) continue
      if (rng() < 0.12) map.setTile(x, y, 'tree')
    }
  }

  // Carve all rooms
  for (const room of ROOMS) carveRoom(map, room)

  // === Cell-specific terrain overrides ===

  // NE: large oval lake (cx=2, cy=0)
  if (cx === 2 && cy === 0) {
    const lakeX = 27, lakeY = 9, rx = 23, ry = 6
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (((x - lakeX) / rx) ** 2 + ((y - lakeY) / ry) ** 2 <= 1)
          map.setTile(x, y, 'water')
  }

  // East-middle: dense forest with shallow ponds, Klopper's home (cx=2, cy=1)
  if (cx === 2 && cy === 1) {
    for (let y = 3; y < H - 3; y++) {
      for (let x = 3; x < W - 3; x++) {
        if (map.getTile(x, y)?.defId === 'grass' && rng() < 0.24) map.setTile(x, y, 'tree')
      }
    }
    const ponds: Array<[number, number, number]> = [
      [15, 9, 1.8], [30, 10, 2.2], [46, 9, 1.6], [60, 10, 2],
    ]
    for (const [px, py, r] of ponds) {
      for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) {
        for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
          if (x < 3 || x >= W - 3 || y < 3 || y >= H - 3) continue
          if (((x - px) ** 2 + (y - py) ** 2) <= r * r && map.getTile(x, y)?.defId === 'grass') {
            map.setTile(x, y, 'water')
          }
        }
      }
    }
  }

  // South maps: indoor floor section + bottom wall (cy=2)
  // Vertical border columns (mountains or exit arrows) are preserved; bottom row fully restored.
  if (cy === 2) {
    const floorStart = Math.floor((2 * H) / 3)  // row 13
    for (let y = floorStart; y < H - 1; y++) {
      for (let x = 0; x < W; x++) {
        if (lBerg && x < 2) continue
        if (rBerg && x >= W - 2) continue
        if (!lBerg && x === 0) continue
        if (!rBerg && x === W - 1) continue
        map.setTile(x, y, 'floor')
      }
    }
    for (let x = 0; x < W; x++)
      map.setTile(x, H - 1, 'wall_down')
  }

  // SW: 5 garage exit tiles centered in bottom row (cx=0, cy=2)
  if (cx === 0 && cy === 2) {
    const midX = Math.floor(W / 2)
    for (let x = midX - 2; x <= midX + 2; x++)
      map.setTile(x, H - 1, 'exit_garage')
  }

  // Bottom center: 5 kitchen exit tiles centered in bottom row (cx=1, cy=2)
  if (cx === 1 && cy === 2) {
    const midX = Math.floor(W / 2)
    for (let x = midX - 2; x <= midX + 2; x++)
      map.setTile(x, H - 1, 'exit_kitchen')
  }

  // Center cell: Eric the trader's chamber
  if (cx === 1 && cy === 1) {
    // Clear chamber area to floor
    for (let ty = 6; ty <= 11; ty++)
      for (let tx = 50; tx <= 58; tx++)
        map.setTile(tx, ty, 'floor')

    // North wall
    map.setTile(50, 6, 'wall_corner_tl')
    map.setTile(58, 6, 'wall_corner_tr')
    for (let x = 51; x <= 57; x++) map.setTile(x, 6, 'wall_up')

    // South wall with door gap at x=54
    map.setTile(50, 11, 'wall_corner_bl')
    map.setTile(58, 11, 'wall_corner_br')
    for (let x = 51; x <= 57; x++)
      map.setTile(x, 11, x === 54 ? 'door_closed' : 'wall_down')

    // West and east walls
    for (let y = 7; y <= 10; y++) map.setTile(50, y, 'wall_left')
    for (let y = 7; y <= 10; y++) map.setTile(58, y, 'wall_right')
  }

  // NW cell: bathroom portal + garage portal near player start (room 4 center)
  if (cx === 0 && cy === 0) {
    map.setTile(63, 5, 'portal_driveway')
    map.setTile(65, 5, 'portal')
    map.setTile(67, 5, 'portal_garage')
    map.setTile(69, 5, 'portal_hall')
    map.setTile(71, 5, 'portal_chaos')
    map.setTile(73, 5, 'portal_bedroom')
    map.setTile(65, 7, 'portal_stairs')
    map.setTile(67, 7, 'portal_stairs_up')
    map.setTile(69, 9, 'portal_tub_enclosure')
    map.setTile(71, 7, 'portal_loft')
    map.setTile(75, 7, 'portal_loft3')
    map.setTile(75, 5, 'portal_study')
    map.setTile(77, 5, 'portal_pantry')
    map.setTile(73, 7, 'portal_pond')
    map.setTile(59, 5, 'portal_upper_hall_left')
    map.setTile(61, 5, 'portal_upper_hall_right')
  }

  // Player spawn: NW always uses room 4 (dry, east of lake); others random
  const spawnIdx = (cx === 0 && cy === 0) ? 4 : 1 + Math.floor(rng() * 3)
  const sr = ROOMS[spawnIdx]
  const player = {
    x: sr.x + Math.floor(sr.w / 2),
    y: sr.y + Math.floor(sr.h / 2),
  }

  // Hand-placed NPCs/set-pieces and quest items come from mapSpawns.json;
  // generic hostiles and regular loot are rolled per game below.
  const cellData = (mapSpawnsData as Array<{
    cx: number; cy: number
    randomMonsters?: number
    randomItems?: number
    monsters: Array<{ x: number; y: number; defId: string; message?: string }>
    items: Array<{ x: number; y: number; defId: string; qty?: number }>
  }>).find(d => d.cx === cx && d.cy === cy)

  const fixedMonsters = cellData?.monsters ?? []
  const items         = cellData?.items    ?? []

  const relicId = world.relicIdFor('forest', cx, cy)
  const relicItem = relicId ? placeSingleItemRandomly(map, rng, relicId, [player, ...fixedMonsters, ...items]) : null
  const fixedItems = relicItem ? [...items, relicItem] : items

  // A fixed item's tile may have been turned into a tree by the random forest
  // pass above — clear it back to grass so the item isn't sitting on a tree.
  for (const it of fixedItems)
    if (map.getTile(it.x, it.y)?.defId === 'tree') map.setTile(it.x, it.y, 'grass')

  // Keep random spawns out of Eric the trader's chamber (its stock is fixed).
  const inTraderChamber = (x: number, y: number) =>
    cx === 1 && cy === 1 && x >= 49 && x <= 59 && y >= 5 && y <= 12

  const srng = spawnRng(world.seed)
  const tier = forestCellTier(cx, cy)
  const randomMonsters = spawnRandomMonsters(map, srng, 'forest', cellData?.randomMonsters ?? 6, {
    tierOverride: tier,
    player,
    avoid: [...fixedMonsters, ...fixedItems],
    bounds: { x1: 3, y1: 3, x2: W - 4, y2: H - 4 },
    allow: (x, y) => !inTraderChamber(x, y),
  })
  const monsters = [...fixedMonsters, ...randomMonsters]

  const chamberTiles: Array<{ x: number; y: number }> = []
  if (cx === 1 && cy === 1)
    for (let y = 5; y <= 12; y++) for (let x = 49; x <= 59; x++) chamberTiles.push({ x, y })

  const loot = scatterRandomItems(map, srng, 'forest', cellData?.randomItems ?? 10,
    [player, ...monsters, ...fixedItems, ...chamberTiles], tier)
  // Every garden cell also has a few simple weapons and pieces of armour lying around
  const gear = scatterBasicGear(map, srng, 2 + Math.floor(srng() * 2),
    [player, ...monsters, ...fixedItems, ...chamberTiles, ...loot])
  const scattered = [...loot, ...gear]

  // Bottom-centre garden is overgrown with Ericgrass and Petergras.
  const grass: typeof scattered = []
  if (cx === 1 && cy === 2) {
    const grassIds = [...Array(30).fill('ericgras'), ...Array(20).fill('petergras')]
    for (const defId of grassIds) {
      const it = placeSingleItemRandomly(map, srng, defId,
        [player, ...monsters, ...fixedItems, ...scattered, ...grass])
      if (it) grass.push(it)
    }
  }

  return { player, monsters, items: [...fixedItems, ...scattered, ...grass] }
}

function addBorderRocks(
  map: MapSystem, rng: () => number,
  lBerg: boolean, rBerg: boolean, tBerg: boolean, bBerg: boolean,
  W: number, H: number,
): void {
  if (lBerg) {
    for (let i = 0; i < 2; i++) {
      const rx = 2 + Math.floor(rng() * 3)
      const ry = 2 + Math.floor(rng() * (H - 4))
      map.setTile(rx, ry, 'berg')
    }
  }
  if (rBerg) {
    for (let i = 0; i < 2; i++) {
      const rx = W - 3 - Math.floor(rng() * 3)
      const ry = 2 + Math.floor(rng() * (H - 4))
      map.setTile(rx, ry, 'berg')
    }
  }
  if (tBerg) {
    for (let i = 0; i < 2; i++) {
      const rx = 2 + Math.floor(rng() * (W - 4))
      const ry = 2 + Math.floor(rng() * 3)
      map.setTile(rx, ry, 'berg')
    }
  }
  if (bBerg) {
    for (let i = 0; i < 2; i++) {
      const rx = 2 + Math.floor(rng() * (W - 4))
      const ry = H - 3 - Math.floor(rng() * 3)
      map.setTile(rx, ry, 'berg')
    }
  }
}

function fillExitEdge(
  map: MapSystem, exitType: string,
  edgeX: number | null, edgeY: number | null,
  W: number, H: number,
): void {
  if (edgeX !== null) {
    for (let y = 0; y < H; y++) {
      const t = map.getTile(edgeX, y)
      if (t && t.defId !== 'berg') map.setTile(edgeX, y, exitType)
    }
  } else if (edgeY !== null) {
    for (let x = 0; x < W; x++) {
      const t = map.getTile(x, edgeY)
      if (t && t.defId !== 'berg') map.setTile(x, edgeY, exitType)
    }
  }
}

function carveRoom(map: MapSystem, room: Room): void {
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++)
      if (map.isInBounds(x, y)) map.setTile(x, y, 'grass')
}

function wallRoom(map: MapSystem, room: Room, rng: () => number): void {
  // Floor interior
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++)
      if (map.isInBounds(x, y)) map.setTile(x, y, 'floor')

  // Corners
  const corners = [
    { x: room.x - 1,      y: room.y - 1,      t: 'wall_corner_tl' },
    { x: room.x + room.w, y: room.y - 1,      t: 'wall_corner_tr' },
    { x: room.x - 1,      y: room.y + room.h, t: 'wall_corner_bl' },
    { x: room.x + room.w, y: room.y + room.h, t: 'wall_corner_br' },
  ]
  for (const c of corners)
    if (map.isInBounds(c.x, c.y)) map.setTile(c.x, c.y, c.t)

  // Collect non-corner perimeter tiles
  const perimeter: Array<{ x: number; y: number; wall: string }> = []
  for (let x = room.x; x < room.x + room.w; x++) {
    if (map.isInBounds(x, room.y - 1))      perimeter.push({ x, y: room.y - 1,      wall: 'wall_up'    })
    if (map.isInBounds(x, room.y + room.h)) perimeter.push({ x, y: room.y + room.h, wall: 'wall_down'  })
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    if (map.isInBounds(room.x - 1, y))      perimeter.push({ x: room.x - 1,      y, wall: 'wall_left'  })
    if (map.isInBounds(room.x + room.w, y)) perimeter.push({ x: room.x + room.w, y, wall: 'wall_right' })
  }

  // Door count: 30% = 1, 50% = 2, 15% = 3, 5% = 4
  const roll = rng()
  const doorCount = roll < 0.30 ? 1 : roll < 0.80 ? 2 : roll < 0.95 ? 3 : 4

  // Fisher-Yates shuffle, pick first doorCount as door positions
  for (let i = perimeter.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[perimeter[i], perimeter[j]] = [perimeter[j], perimeter[i]]
  }
  const doorSet = new Set(perimeter.slice(0, doorCount).map(p => `${p.x},${p.y}`))

  for (const p of perimeter)
    if (map.isInBounds(p.x, p.y))
      map.setTile(p.x, p.y, doorSet.has(`${p.x},${p.y}`) ? 'door_closed' : p.wall)
}

export function generateBathroomTopMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'tegel_wit')

  for (let x = 0; x < W; x++) { map.setTile(x, 0, 'wall_up'); map.setTile(x, H - 1, 'bath_exit_down') }
  for (let y = 1; y < H - 1; y++) { map.setTile(0, y, 'wall_left'); map.setTile(W - 1, y, 'wall_right') }
  map.setTile(0, 0, 'wall_corner_tl'); map.setTile(W - 1, 0, 'wall_corner_tr')

  // Brown tile border strips (decorative frame inside walls)
  for (let x = 1; x < W - 1; x++) { map.setTile(x, 1, 'tegel_bruin'); map.setTile(x, H - 2, 'tegel_bruin') }
  for (let y = 2; y < H - 2; y++) { map.setTile(1, y, 'tegel_bruin'); map.setTile(W - 2, y, 'tegel_bruin') }

  // Top door: back to the upper hall
  map.setTile(Math.floor(W / 2), 0, 'bath_exit_upper_hall')

  // Three toilets with WC rolls along the top
  map.setTile(12, 3, 'toilet'); map.setTile(13, 3, 'wcrol')
  map.setTile(30, 3, 'toilet'); map.setTile(31, 3, 'wcrol')
  map.setTile(50, 3, 'toilet'); map.setTile(51, 3, 'wcrol')

  // Arrivals without a specific entry (e.g. the garden test portal) land by the top door
  const player = { x: Math.floor(W / 2), y: 1 }
  const fixedMonsters = [
    { x: 25, y: 6,  defId: 'klopper' },
  ]
  const rng = spawnRng(210)
  const monsters = [...fixedMonsters, ...spawnRandomMonsters(map, rng, 'bathroom', 5, { player, avoid: fixedMonsters })]
  const scattered = scatterRandomItems(map, rng, 'bathroom', 4, [player, ...monsters])

  return { player, monsters, items: scattered }
}

export function generateBathroomBottomMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'tegel_wit')

  for (let x = 0; x < W; x++) { map.setTile(x, 0, 'bath_exit_up'); map.setTile(x, H - 1, 'wall_down') }
  for (let y = 1; y < H - 1; y++) { map.setTile(0, y, 'wall_left'); map.setTile(W - 1, y, 'wall_right') }
  map.setTile(0, H - 1, 'wall_corner_bl'); map.setTile(W - 1, H - 1, 'wall_corner_br')

  // Brown tile border strips
  for (let x = 1; x < W - 1; x++) { map.setTile(x, 1, 'tegel_bruin'); map.setTile(x, H - 2, 'tegel_bruin') }
  for (let y = 2; y < H - 2; y++) { map.setTile(1, y, 'tegel_bruin'); map.setTile(W - 2, y, 'tegel_bruin') }

  // Tap on left border, stopper 4 tiles right, initial small pool
  map.setTile(1, 9,  'kraan')
  map.setTile(2, 8,  'water_bath')
  map.setTile(2, 9,  'water_bath')
  map.setTile(2, 10, 'water_bath')
  map.setTile(3, 9,  'vortex_portal')

  const player = { x: 40, y: H - 2 }
  const fixedMonsters = [
    { x: 60, y: 6,  defId: 'klopper' },
  ]
  const stopItem = { x: 5, y: 9, defId: 'stop' }
  const rng = spawnRng(211)
  // Keep the tap/stopper corner clear.
  const monsters = [...fixedMonsters, ...spawnRandomMonsters(map, rng, 'bathroom', 7, {
    player, avoid: [...fixedMonsters, stopItem], allow: x => x > 6,
  })]
  const scattered = scatterRandomItems(map, rng, 'bathroom', 4, [player, ...monsters, stopItem])

  return { player, monsters, items: [stopItem, ...scattered] }
}

function spawnGarageMonsters(
  map: MapSystem, rng: () => number,
  playerPos: { x: number; y: number },
): Array<{ x: number; y: number; defId: string }> {
  const count = 8 + Math.floor(rng() * 5)
  return spawnRandomMonsters(map, rng, 'garage', count, { player: playerPos })
}

export function generateGarageTopMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(50)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'floor')

  // Top row: exit back to overworld; bottom row: exit to lower garage
  for (let x = 0; x < W; x++) map.setTile(x, 0, 'garage_exit_up')
  for (let x = 0; x < W; x++) map.setTile(x, H - 1, 'garage_exit_down')

  // Side borders: crypt
  for (let y = 1; y < H - 1; y++) {
    map.setTile(0, y, 'crypt')
    map.setTile(W - 1, y, 'crypt')
  }

  // Random crypt blocks in interior (25% density)
  for (let y = 2; y < H - 2; y++)
    for (let x = 1; x < W - 1; x++)
      if (rng() < 0.25) map.setTile(x, y, 'crypt')

  // Clear spawn zone near top centre
  for (let y = 1; y <= 3; y++)
    for (let x = 36; x <= 44; x++)
      map.setTile(x, y, 'floor')

  // Portal out to the driveway
  map.setTile(5, 1, 'garage_portal_driveway')

  const player = { x: 40, y: 2 }
  const srng = spawnRng(50)
  const monsters = spawnGarageMonsters(map, srng, player)
  const relic = relicItem ? placeSingleItemRandomly(map, rng, relicItem, [player, ...monsters]) : null
  const fixedItems = relic ? [relic] : []
  const items = scatterRandomItems(map, srng, 'garage', 6, [player, ...monsters, ...fixedItems])
  return { player, monsters, items: [...fixedItems, ...items] }
}

export function generateGarageBottomMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(51)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'floor')

  // Top row: exit back to upper garage; bottom row: exit down to the driveway
  for (let x = 0; x < W; x++) map.setTile(x, 0, 'garage_exit_up')
  for (let x = 0; x < W; x++) map.setTile(x, H - 1, 'garage_exit_driveway')

  // Side borders: crypt
  for (let y = 1; y < H - 1; y++) {
    map.setTile(0, y, 'crypt')
    map.setTile(W - 1, y, 'crypt')
  }

  // Random crypt blocks
  for (let y = 2; y < H - 2; y++)
    for (let x = 1; x < W - 1; x++)
      if (rng() < 0.25) map.setTile(x, y, 'crypt')

  // Clear spawn zone near bottom centre
  for (let y = H - 3; y < H - 1; y++)
    for (let x = 36; x <= 44; x++)
      map.setTile(x, y, 'floor')

  const player = { x: 40, y: H - 2 }
  const srng = spawnRng(51)
  const randomMonsters = spawnGarageMonsters(map, srng, player)
  // Gompie lands on a different tile each run (per-run seed), stable within a run.
  const gompieItem = placeSingleItemRandomly(map, spawnRng(52), 'gompie', [player, ...randomMonsters])
  const gompieAvoid = gompieItem ? [gompieItem] : []
  // The family car — the only one in the game.
  const car = placeSingleItemRandomly(map, rng, 'car', [player, ...gompieAvoid, ...randomMonsters])
  const monsters = car ? [...randomMonsters, { x: car.x, y: car.y, defId: 'car' }] : randomMonsters
  const relic = relicItem ? placeSingleItemRandomly(map, rng, relicItem, [player, ...gompieAvoid, ...monsters]) : null
  const fixedItems = relic ? [...gompieAvoid, relic] : gompieAvoid
  const scattered = scatterRandomItems(map, srng, 'garage', 6, [player, ...monsters, ...fixedItems])
  return { player, monsters, items: [...fixedItems, ...scattered] }
}

export function generateTubEnclosureMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = spawnRng(60)

  // Everything is void (black)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'void')

  // Small rectangular room centred on the map
  const rx1 = 26, rx2 = 53, ry1 = 5, ry2 = 14

  // Stone-wall border
  for (let x = rx1; x <= rx2; x++) {
    map.setTile(x, ry1, 'wall')
    map.setTile(x, ry2, 'wall')
  }
  for (let y = ry1; y <= ry2; y++) {
    map.setTile(rx1, y, 'wall')
    map.setTile(rx2, y, 'wall')
  }

  // Floor interior
  for (let y = ry1 + 1; y < ry2; y++)
    for (let x = rx1 + 1; x < rx2; x++)
      map.setTile(x, y, 'floor')

  // Vortex portal at room centre
  const vortexX = Math.floor((rx1 + rx2) / 2)
  const vortexY = Math.floor((ry1 + ry2) / 2)
  map.setTile(vortexX, vortexY, 'vortex_portal')

  // Player spawns on vortex (arrived through it; re-stepping triggers exit)
  const playerPos = { x: vortexX, y: vortexY }

  const SPECIAL_TILES = new Set(['tub_enclosure_exit', 'vortex_portal'])

  // Spawn monsters: many silvervisjes + pissebedden
  const monsters: Array<{ x: number; y: number; defId: string }> = []
  const SILVERVIS = 24, PISSEBED = 30
  let attempts = 0
  while (monsters.length < SILVERVIS + PISSEBED && attempts < 1000) {
    attempts++
    const tx = rx1 + 1 + Math.floor(rng() * (rx2 - rx1 - 1))
    const ty = ry1 + 1 + Math.floor(rng() * (ry2 - ry1 - 1))
    const tile = map.getTile(tx, ty)
    if (!tile || !map.isWalkable(tx, ty) || SPECIAL_TILES.has(tile.defId)) continue
    if (Math.abs(tx - playerPos.x) < 5 && Math.abs(ty - playerPos.y) < 3) continue
    const defId = monsters.length < SILVERVIS ? 'silvervisje' : 'pissebed'
    monsters.push({ x: tx, y: ty, defId })
  }

  // One second_life_potion somewhere in the room
  let itemX = rx1 + 2, itemY = ry2 - 2
  attempts = 0
  while (attempts < 200) {
    attempts++
    const tx = rx1 + 1 + Math.floor(rng() * (rx2 - rx1 - 1))
    const ty = ry1 + 1 + Math.floor(rng() * (ry2 - ry1 - 1))
    const tile = map.getTile(tx, ty)
    if (!tile || !map.isWalkable(tx, ty) || SPECIAL_TILES.has(tile.defId)) continue
    itemX = tx; itemY = ty
    break
  }

  const specialItem = { x: itemX, y: itemY, defId: 'second_life_potion', qty: 1 }
  const relic = relicItem ? placeSingleItemRandomly(map, rng, relicItem, [playerPos, specialItem, ...monsters]) : null
  const fixedItems = relic ? [specialItem, relic] : [specialItem]
  const scattered = scatterRandomItems(map, rng, 'tub_enclosure', 5, [playerPos, ...fixedItems, ...monsters])

  return {
    player: playerPos,
    monsters,
    items: [...fixedItems, ...scattered],
  }
}

export function generateLoftMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(70)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'loft_wall')

  // 2x2 floor cells, 1-tile walls: cell (cx,cy) -> 4 tiles at (1+3*cx..2+3*cx, 1+3*cy..2+3*cy)
  // 26 columns x 6 rows = 156 cells; all corridors 2 tiles wide
  const cellW = Math.floor((W - 1) / 3)  // 26
  const cellH = Math.floor((H - 1) / 3)  // 6
  const visited = new Array(cellW * cellH).fill(false)

  const carveCell = (cx: number, cy: number) => {
    map.setTile(1 + 3 * cx, 1 + 3 * cy, 'loft_floor')
    map.setTile(2 + 3 * cx, 1 + 3 * cy, 'loft_floor')
    map.setTile(1 + 3 * cx, 2 + 3 * cy, 'loft_floor')
    map.setTile(2 + 3 * cx, 2 + 3 * cy, 'loft_floor')
  }

  const carvePassage = (cx: number, cy: number, nx: number, ny: number) => {
    if (nx !== cx) {
      const wx = 3 + 3 * Math.min(cx, nx)
      map.setTile(wx, 1 + 3 * cy, 'loft_floor')
      map.setTile(wx, 2 + 3 * cy, 'loft_floor')
    } else {
      const wy = 3 + 3 * Math.min(cy, ny)
      map.setTile(1 + 3 * cx, wy, 'loft_floor')
      map.setTile(2 + 3 * cx, wy, 'loft_floor')
    }
  }

  const DIRS = [{dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: 0, dy: 1}, {dx: -1, dy: 0}]

  // Pre-reserve exit cell so DFS leaves it as the final leaf - player must traverse
  // nearly the whole maze before reaching it.
  const exitCx = 14, exitCy = 0
  visited[exitCy * cellW + exitCx] = true

  // DFS from bottom-right; bias directions away from exit so far corners fill first.
  const stack: Array<{cx: number; cy: number}> = []
  visited[(cellH - 1) * cellW + (cellW - 1)] = true
  carveCell(cellW - 1, cellH - 1)
  stack.push({cx: cellW - 1, cy: cellH - 1})

  while (stack.length > 0) {
    const {cx, cy} = stack[stack.length - 1]
    const dirs = DIRS.slice()
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = dirs[i]; dirs[i] = dirs[j]; dirs[j] = tmp
    }
    dirs.sort((a, b) => {
      const da = Math.abs(cx + a.dx - exitCx) + Math.abs(cy + a.dy - exitCy)
      const db = Math.abs(cx + b.dx - exitCx) + Math.abs(cy + b.dy - exitCy)
      return db - da
    })
    let moved = false
    for (const {dx, dy} of dirs) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH) continue
      if (visited[ny * cellW + nx]) continue
      carvePassage(cx, cy, nx, ny)
      carveCell(nx, ny)
      visited[ny * cellW + nx] = true
      stack.push({cx: nx, cy: ny})
      moved = true
      break
    }
    if (!moved) stack.pop()
  }

  // Connect exit as final leaf off (14,1)
  carveCell(exitCx, exitCy)
  carvePassage(exitCx, exitCy + 1, exitCx, exitCy)

  // Force exit approach and arrows
  map.setTile(44, 1, 'loft_floor')
  map.setTile(45, 1, 'loft_floor')
  map.setTile(44, 0, 'loft_exit_stairs')
  map.setTile(45, 0, 'loft_exit_stairs')

  // --- Stub pass: add short dead-end nooks throughout the maze ---
  // Corner tiles sit at the intersection of 4 cells and are always walled in the base DFS.
  // When exactly 1 of their 4 neighbours is floor they become a clean 1-tile dead end stub.
  const isFloor = (x: number, y: number) => map.getTile(x, y)?.defId === 'loft_floor'
  for (let cy2 = 0; cy2 < cellH - 1; cy2++) {
    for (let cx2 = 0; cx2 < cellW - 1; cx2++) {
      const tx = 3 + 3 * cx2
      const ty = 3 + 3 * cy2
      const adj = (isFloor(tx, ty - 1) ? 1 : 0) + (isFloor(tx, ty + 1) ? 1 : 0)
              + (isFloor(tx - 1, ty) ? 1 : 0) + (isFloor(tx + 1, ty) ? 1 : 0)
      if (adj === 1 && rng() < 0.72) map.setTile(tx, ty, 'loft_floor')
    }
  }
  // Right-border stubs: single tile alcove off rightmost cells (x=78 strip)
  for (let y = 1; y < H - 1; y++) {
    if (isFloor(77, y) && !isFloor(78, y) && !isFloor(78, y - 1) && !isFloor(78, y + 1) && rng() < 0.55)
      map.setTile(78, y, 'loft_floor')
  }
  // Bottom-border stubs: single tile alcove below bottom-row cells (y=18 strip)
  for (let x = 1; x < W - 1; x++) {
    if (isFloor(x, 17) && !isFloor(x, 18) && !isFloor(x - 1, 18) && !isFloor(x + 1, 18) && rng() < 0.55)
      map.setTile(x, 18, 'loft_floor')
  }

  // Player starts bottom-right corner, on the trapdoor down the rainbow stairs to the study
  const playerPos = {x: 77, y: 17}
  map.setTile(77, 17, 'portal_stairs')

  // Testing return portal: right border tile adjacent to player start
  map.setTile(78, 17, 'loft_exit')

  const pickFloor = (skipX: number, skipY: number, radius: number): {x: number; y: number} | null => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const tx = 1 + Math.floor(rng() * (W - 2))
      const ty = 1 + Math.floor(rng() * (H - 2))
      if (!map.isWalkable(tx, ty)) continue
      if (Math.abs(tx - skipX) < radius && Math.abs(ty - skipY) < radius) continue
      return {x: tx, y: ty}
    }
    return null
  }

  for (let i = 0; i < 5; i++) {
    const pos = pickFloor(playerPos.x, playerPos.y, 6)
    if (pos) map.setTile(pos.x, pos.y, 'loft_water')
  }
  for (let i = 0; i < 4; i++) {
    const pos = pickFloor(playerPos.x, playerPos.y, 4)
    if (pos) map.setTile(pos.x, pos.y, 'loft_tree')
  }

  const legoItems: Array<{x: number; y: number; defId: string; qty: number}> = []
  for (const defId of ['lego1', 'lego2', 'lego3']) {
    const pos = pickFloor(playerPos.x, playerPos.y, 3)
    if (pos) legoItems.push({x: pos.x, y: pos.y, defId, qty: 1})
  }

  const mjollnirPos = pickFloor(playerPos.x, playerPos.y, 8)
  if (mjollnirPos) legoItems.push({x: mjollnirPos.x, y: mjollnirPos.y, defId: 'mjollnir', qty: 1})

  const SPECIAL_TILES = new Set(['loft_wall', 'loft_exit', 'loft_exit_stairs', 'portal_stairs', 'loft_water', 'loft_tree'])
  const monsters: Array<{x: number; y: number; defId: string}> = []
  // Fixed friendlies; hostiles are rolled from the loft pool per game.
  const srng = spawnRng(70)
  const loftMonsters: Array<{defId: string; count: number}> = [
    {defId: 'eendGroen', count: 3},
    {defId: 'cat',       count: 1},
    {defId: 'duif',      count: 4},
    ...Array.from({length: scaleMonsterCount(8, srng)}, () => ({defId: pickAreaMonster('loft', srng), count: 1})),
  ]
  for (const {defId, count} of loftMonsters) {
    let spawned = 0, attempts = 0
    while (spawned < count && attempts < 500) {
      attempts++
      const tx = 1 + Math.floor(srng() * (W - 2))
      const ty = 1 + Math.floor(srng() * (H - 2))
      const tile = map.getTile(tx, ty)
      if (!tile || !map.isWalkable(tx, ty) || SPECIAL_TILES.has(tile.defId)) continue
      if (Math.abs(tx - playerPos.x) < 5 && Math.abs(ty - playerPos.y) < 3) continue
      monsters.push({x: tx, y: ty, defId})
      spawned++
    }
  }

  const scattered = scatterRandomItems(map, srng, 'loft', 6, [playerPos, ...legoItems, ...monsters])

  return {player: playerPos, monsters, items: [...legoItems, ...scattered]}
}

export function generateLoft3Map(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(72)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'loft_wall')

  // Standard DFS maze â€” identical algorithm to loft1, no pre-marking
  const cellW = Math.floor((W - 1) / 3)  // 26
  const cellH = Math.floor((H - 1) / 3)  // 6
  const visited = new Array(cellW * cellH).fill(false)

  const carveCell = (cx: number, cy: number) => {
    map.setTile(1 + 3 * cx, 1 + 3 * cy, 'loft_floor')
    map.setTile(2 + 3 * cx, 1 + 3 * cy, 'loft_floor')
    map.setTile(1 + 3 * cx, 2 + 3 * cy, 'loft_floor')
    map.setTile(2 + 3 * cx, 2 + 3 * cy, 'loft_floor')
  }

  const carvePassage = (cx: number, cy: number, nx: number, ny: number) => {
    if (nx !== cx) {
      const wx = 3 + 3 * Math.min(cx, nx)
      map.setTile(wx, 1 + 3 * cy, 'loft_floor')
      map.setTile(wx, 2 + 3 * cy, 'loft_floor')
    } else {
      const wy = 3 + 3 * Math.min(cy, ny)
      map.setTile(1 + 3 * cx, wy, 'loft_floor')
      map.setTile(2 + 3 * cx, wy, 'loft_floor')
    }
  }

  const DIRS3 = [{dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: 0, dy: 1}, {dx: -1, dy: 0}]
  const stack3: Array<{cx: number; cy: number}> = []
  // Start from cell containing player spawn (x=44, y=17): cx=14 (x=43,44), cy=5 (y=16,17)
  const startCx = 14, startCy = 5
  visited[startCy * cellW + startCx] = true
  carveCell(startCx, startCy)
  stack3.push({cx: startCx, cy: startCy})

  while (stack3.length > 0) {
    const {cx, cy} = stack3[stack3.length - 1]
    const dirs = DIRS3.slice()
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = dirs[i]; dirs[i] = dirs[j]; dirs[j] = tmp
    }
    let moved = false
    for (const {dx, dy} of dirs) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || nx >= cellW || ny < 0 || ny >= cellH) continue
      if (visited[ny * cellW + nx]) continue
      carvePassage(cx, cy, nx, ny)
      carveCell(nx, ny)
      visited[ny * cellW + nx] = true
      stack3.push({cx: nx, cy: ny})
      moved = true
      break
    }
    if (!moved) stack3.pop()
  }

  // Wide open section in the center of the map: 11 tiles wide Ã— 9 tiles tall
  for (let y = 4; y <= 14; y++)
    for (let x = 32; x <= 42; x++)
      map.setTile(x, y, 'loft_floor')

  // Blue hexagon outline filled with grey, centered in open area
  // Row widths: 3, 5, 7, 7, 5, 3 (pointy-top hex)
  // Blue hexagon outline filled with grey, centered in open area (7 rows tall)
  const hexRows: Array<{y: number; xMin: number; xMax: number}> = [
    {y: 6,  xMin: 36, xMax: 38},
    {y: 7,  xMin: 35, xMax: 39},
    {y: 8,  xMin: 34, xMax: 40},
    {y: 9,  xMin: 34, xMax: 40},
    {y: 10, xMin: 34, xMax: 40},
    {y: 11, xMin: 35, xMax: 39},
    {y: 12, xMin: 36, xMax: 38},
  ]
  for (const {y, xMin, xMax} of hexRows) {
    for (let x = xMin; x <= xMax; x++) {
      const isEdge = x === xMin || x === xMax || y === 6 || y === 12
      map.setTile(x, y, isEdge ? 'lego_blue' : 'lego_grey')
    }
  }

  // Player entry at bottom at x=44 â€” ensure spawn tiles are floor
  map.setTile(44, 17, 'loft_floor')
  map.setTile(45, 17, 'loft_floor')
  map.setTile(44, 18, 'loft_floor')
  map.setTile(45, 18, 'loft_floor')

  // Exit tiles at left border: y=6..15 (left-arrow indicators + functional exits)
  for (let y = 6; y <= 15; y++) {
    map.setTile(1, y, 'loft_floor')
    map.setTile(0, y, 'loft3_exit')
  }

  // Down-arrow exit tiles just below the player's starting spot, back to the loft
  map.setTile(44, 19, 'loft3_exit_down')
  map.setTile(45, 19, 'loft3_exit_down')

  const playerPos = {x: 44, y: 17}

  const pickFloor = (skipX: number, skipY: number, radius: number): {x: number; y: number} | null => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const tx = 1 + Math.floor(rng() * (W - 2))
      const ty = 1 + Math.floor(rng() * (H - 2))
      if (!map.isWalkable(tx, ty)) continue
      if (Math.abs(tx - skipX) < radius && Math.abs(ty - skipY) < radius) continue
      return {x: tx, y: ty}
    }
    return null
  }

  for (let i = 0; i < 5; i++) {
    const pos = pickFloor(44, 17, 6)
    if (pos) map.setTile(pos.x, pos.y, 'loft_water')
  }
  for (let i = 0; i < 4; i++) {
    const pos = pickFloor(44, 17, 4)
    if (pos) map.setTile(pos.x, pos.y, 'loft_tree')
  }

  // Peter's running track around the lego hexagon stays clear
  const loop = peterPatrolLoop()
  for (const p of loop) map.setTile(p.x, p.y, 'loft_floor')

  // Fill hexagon grey interior with lego items (cycle lego1/2/3)
  const legoItems: Array<{x: number; y: number; defId: string; qty: number}> = []
  const legoDefs = ['lego1', 'lego2', 'lego3']
  const hexInterior: Array<{y: number; xMin: number; xMax: number}> = [
    {y: 7,  xMin: 36, xMax: 38},
    {y: 8,  xMin: 35, xMax: 39},
    {y: 9,  xMin: 35, xMax: 39},
    {y: 10, xMin: 35, xMax: 39},
    {y: 11, xMin: 36, xMax: 38},
  ]
  let legoIdx = 0
  for (const {y, xMin, xMax} of hexInterior)
    for (let x = xMin; x <= xMax; x++)
      legoItems.push({x, y, defId: legoDefs[legoIdx++ % 3], qty: 1})

  const SPECIAL_TILES3 = new Set(['loft_wall', 'loft3_exit', 'loft3_exit_down', 'loft_water', 'loft_tree'])
  // Peter starts on his track around the hexagon (GameScene makes him run it)
  const monsters: Array<{x: number; y: number; defId: string}> = [{...loop[0], defId: 'peter'}]
  // Fixed NPC/friendlies; hostiles are rolled from the loft pool at loft3's (deeper) tier.
  const srng = spawnRng(72)
  const loft3Monsters: Array<{defId: string; count: number}> = [
    {defId: 'eendGroen', count: 2},
    {defId: 'cat',       count: 2},
    ...Array.from({length: scaleMonsterCount(8, srng)}, () => ({defId: pickAreaMonster('loft3', srng), count: 1})),
  ]
  for (const {defId, count} of loft3Monsters) {
    let spawned = 0, attempts = 0
    while (spawned < count && attempts < 500) {
      attempts++
      const tx = 1 + Math.floor(srng() * (W - 2))
      const ty = 1 + Math.floor(srng() * (H - 2))
      const tile = map.getTile(tx, ty)
      if (!tile || !map.isWalkable(tx, ty) || SPECIAL_TILES3.has(tile.defId)) continue
      if (Math.abs(tx - playerPos.x) < 5 && Math.abs(ty - playerPos.y) < 3) continue
      if (monsters.some(m => m.x === tx && m.y === ty)) continue
      monsters.push({x: tx, y: ty, defId})
      spawned++
    }
  }

  const scattered = scatterRandomItems(map, srng, 'loft3', 5, [playerPos, ...legoItems, ...monsters])

  return {player: playerPos, monsters, items: [...legoItems, ...scattered]}
}

// Clockwise rectangular loop one tile outside the lego hexagon on "Peter and the Wolf"
export function peterPatrolLoop(): Array<{ x: number; y: number }> {
  const x1 = 33, x2 = 41, y1 = 5, y2 = 13
  const loop: Array<{ x: number; y: number }> = []
  for (let x = x1; x < x2; x++) loop.push({ x, y: y1 })
  for (let y = y1; y < y2; y++) loop.push({ x: x2, y })
  for (let x = x2; x > x1; x--) loop.push({ x, y: y2 })
  for (let y = y2; y > y1; y--) loop.push({ x: x1, y })
  return loop
}

interface DoorInfo {
  doorX: number
  doorY: number
  exitX: number
  exitY: number
}

export function generateHallMap(
  map: MapSystem,
  ucx: number,
  ucy: number,
  ugrid: number,
  seed: number,
  clarinetCell?: { cx: number; cy: number },
  relicItem?: string | null,
): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(seed)

  const { rooms, doorsByRoom, connected } = buildHallLayout(map, rng)

  // Extend corridors to inner grid borders (no exits on outer grid edges)
  addHallBorderExits(map, connected, W, H, ucx, ucy, ugrid)

  // Kitchen entrance only in the hall entry cell (ucx=0, ucy=0): extend
  // room[0]'s north-facing door path up to the map's top border and start there
  const r0 = rooms[0]
  const sx = r0.x + 1, sy = r0.y + 1
  let entryPos = { x: sx, y: sy }
  if (ucx === 0 && ucy === 0) {
    const northDoor = (doorsByRoom.get(0) ?? []).find(d => d.exitY < d.doorY)
    if (northDoor) {
      for (let y = northDoor.exitY; y >= 0; y--) {
        map.setTile(northDoor.exitX, y, y === 0 ? 'hall_exit_up' : 'tegel_wit')
        connected.add(`${northDoor.exitX},${y}`)
      }
      entryPos = { x: northDoor.exitX, y: 1 }
    } else {
      map.setTile(sx, sy, 'hall_exit_up')
    }
  }

  // Bottom-left cell: rainbow staircase up to the upper hall, in the leftmost
  // room's bottom-left corner; room[0]'s dead-end stub there is walled up.
  const leftRoom = rooms.reduce((a, b) => (b.x < a.x ? b : a), r0)
  const stairsPos = { x: leftRoom.x, y: leftRoom.y + leftRoom.h - 1 }
  if (ucx === 0 && ucy === ugrid - 1) {
    map.setTile(stairsPos.x, stairsPos.y, 'portal_stairs_up')
    sealDeadEndDoors(map, r0, 'tegel_wit', 'hall_wall')
  }
  // Bottom-right cell: the bottom-row corridor moves up a row, and its right
  // stretch gets arrows down to the driveway along the map edge
  if (ucx === ugrid - 1 && ucy === ugrid - 1) {
    for (let x = 0; x < W; x++) {
      if (map.getTile(x, H - 1)?.defId !== 'tegel_wit') continue
      map.setTile(x, H - 1, 'hall_wall')
      map.setTile(x, H - 2, 'tegel_wit')
    }
    let runEnd = -1
    for (let x = W - 2; x >= 1 && runEnd < 0; x--)
      if (map.getTile(x, H - 2)?.defId === 'tegel_wit') runEnd = x
    for (let x = runEnd; x >= 1 && map.getTile(x, H - 2)?.defId === 'tegel_wit'; x--)
      map.setTile(x, H - 1, 'hall_exit_driveway')
  }

  // Spawn crypt monsters in rooms 1+ (rolled per game from the hall pool)
  const srng = spawnRng(seed)
  const monsters: Array<{ x: number; y: number; defId: string }> = []
  const items: Array<{ x: number; y: number; defId: string }> = []
  for (let ri = 1; ri < rooms.length; ri++) {
    const room = rooms[ri]
    const count = scaleMonsterCount(1 + Math.floor(srng() * 3), srng)
    for (let i = 0; i < count; i++) {
      const mx = room.x + 1 + Math.floor(srng() * Math.max(1, room.w - 2))
      const my = room.y + 1 + Math.floor(srng() * Math.max(1, room.h - 2))
      const defId = pickAreaMonster('hall', srng)
      monsters.push({ x: mx, y: my, defId })
    }
  }
  // A few more stragglers roaming the corridors
  const corridor = [...connected].map(k => k.split(',').map(Number))
    .filter(([x, y]) => map.getTile(x, y)?.defId === 'tegel_wit' &&
      Math.abs(x - entryPos.x) + Math.abs(y - entryPos.y) > 6)
  const stragglers = scaleMonsterCount(3, srng)
  for (let i = 0; i < stragglers && corridor.length > 0; i++) {
    const [mx, my] = corridor[Math.floor(srng() * corridor.length)]
    monsters.push({ x: mx, y: my, defId: pickAreaMonster('hall', srng) })
  }
  if (rooms.length > 1) {
    const wr = rooms[Math.min(1, rooms.length - 1)]
    // Watchers only haunt a third of the hall cells
    if ((ucx + 2 * ucy) % 3 === 1)
      monsters.push({ x: wr.x + Math.floor(wr.w / 2), y: wr.y + Math.floor(wr.h / 2), defId: 'watcher' })
    items.push({ x: wr.x + 1, y: wr.y + 1, defId: 'clay' })
  }
  if (ucx === 0 && ucy === 0) {
    monsters.push({ x: sx + 2, y: sy, defId: 'paard' })
  }
  if (clarinetCell && ucx === clarinetCell.cx && ucy === clarinetCell.cy) {
    items.push({ x: sx + 1, y: sy + 1, defId: 'clarinet' })
  }
  if (relicItem) {
    const relic = placeSingleItemRandomly(map, rng, relicItem, [entryPos, stairsPos, ...items, ...monsters])
    if (relic) items.push(relic)
  }

  // Keep random loot out of the horse's room entirely — it shouldn't look
  // like something (e.g. a pancake) was dropped there.
  const scatterAvoid = [entryPos, stairsPos, ...items, ...monsters]
  if (ucx === 0 && ucy === 0) {
    for (let ry = r0.y; ry < r0.y + r0.h; ry++)
      for (let rx = r0.x; rx < r0.x + r0.w; rx++)
        scatterAvoid.push({ x: rx, y: ry })
  }
  const scattered = scatterRandomItems(map, srng, 'hall', 6, scatterAvoid)

  return { player: entryPos, monsters, items: [...items, ...scattered] }
}

// First-floor corridor: two cells side by side, built with the same room and
// corridor layout as the hall but carpeted, with black void as solid ground.
// Left cell: Eric's bedroom (chaos) to the west, bathroom to the south.
// Right cell: study to the east, Mar's lower bedroom to the north.
// Each of those rooms has a matching arrow back (see *_exit_upper_hall tiles).
export function generateUpperHallMap(map: MapSystem, side: 'left' | 'right'): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(side === 'left' ? 3100 : 3200)
  const area = side === 'left' ? 'upper_hall_left' : 'upper_hall_right'

  const { rooms, connected } = buildHallLayout(map, rng)

  const midX = Math.floor(W / 2)
  const midY = Math.floor(H / 2)
  const west  = { exitTile: 'exit_left',  bx: 0,    by: midY, ix: 1,    iy: midY, varyY: true  }
  const east  = { exitTile: 'exit_right', bx: W-1,  by: midY, ix: W-2,  iy: midY, varyY: true  }
  const south = { exitTile: 'exit_down',  bx: midX, by: H-1,  ix: midX, iy: H-2,  varyY: false }
  const north = { exitTile: 'exit_up',    bx: midX, by: 0,    ix: midX, iy: 1,    varyY: false }
  carveHallExits(map, connected, W, H, side === 'left'
    ? [{ ...west, exitTile: 'upper_hall_exit_chaos' }, east, { ...south, exitTile: 'upper_hall_exit_bathroom' }]
    : [west, { ...east, exitTile: 'upper_hall_exit_study' }, { ...north, exitTile: 'upper_hall_exit_mar' }])

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const id = map.getTile(x, y)?.defId
      if (id === 'hall_wall') map.setTile(x, y, 'void')
      else if (id === 'tegel_wit') map.setTile(x, y, 'carpet')
    }
  for (const room of rooms) sealDeadEndDoors(map, room)

  const r0 = rooms[0]
  const entryPos = { x: r0.x + 1, y: r0.y + 1 }
  // Right cell: rainbow staircase down to the ground-floor hall
  const stairsPos = { x: r0.x + r0.w - 1, y: r0.y + r0.h - 1 }
  if (side === 'right') map.setTile(stairsPos.x, stairsPos.y, 'portal_stairs')

  const srng = spawnRng(side === 'left' ? 3100 : 3200)
  const monsters: Array<{ x: number; y: number; defId: string }> = []
  for (let ri = 1; ri < rooms.length; ri++) {
    const room = rooms[ri]
    const count = scaleMonsterCount(1 + Math.floor(srng() * 2), srng)
    for (let i = 0; i < count; i++) {
      const mx = room.x + 1 + Math.floor(srng() * Math.max(1, room.w - 2))
      const my = room.y + 1 + Math.floor(srng() * Math.max(1, room.h - 2))
      monsters.push({ x: mx, y: my, defId: pickAreaMonster(area, srng) })
    }
  }

  const scattered = scatterRandomItems(map, srng, area, 5, [entryPos, stairsPos, ...monsters])
  return { player: entryPos, monsters, items: scattered }
}

// Doors whose corridor stub leads nowhere (e.g. two short paths running into the
// map's top border) get walled up, and the stub turns back into solid ground.
function sealDeadEndDoors(map: MapSystem, room: Room, path = 'carpet', solid = 'void'): void {
  // Room x/y/w/h describe the interior; its walls sit one tile outside
  const x0 = room.x - 1, y0 = room.y - 1, x1 = room.x + room.w, y1 = room.y + room.h
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (map.getTile(x, y)?.defId !== 'door_closed') continue
      const [ox, oy, wall] = y === y0 ? [x, y - 1, 'wall_up']
        : y === y1 ? [x, y + 1, 'wall_down']
        : x === x0 ? [x - 1, y, 'wall_left']
        : [x + 1, y, 'wall_right']
      const start = map.getTile(ox, oy)?.defId
      if (start !== path) continue
      // Flood the corridor beyond the door; any other door, exit or portal means it leads somewhere
      const seen = new Set<string>([`${ox},${oy}`])
      const queue: Array<[number, number]> = [[ox, oy]]
      let leadsSomewhere = false
      while (queue.length > 0 && !leadsSomewhere) {
        const [cx, cy] = queue.shift()!
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx === x && ny === y) continue
          const id = map.getTile(nx, ny)?.defId
          if (!id || seen.has(`${nx},${ny}`)) continue
          if (id === 'door_closed' || id.includes('exit') || id.includes('portal')) { leadsSomewhere = true; break }
          if (id !== path) continue
          seen.add(`${nx},${ny}`)
          queue.push([nx, ny])
        }
      }
      if (leadsSomewhere) continue
      for (const key of seen) {
        const [sx, sy] = key.split(',').map(Number)
        map.setTile(sx, sy, solid)
      }
      map.setTile(x, y, wall as string)
    }
}

// Shared room + corridor layout used by every hall-style map: walled rooms
// joined by organic corridors carved out of hall_wall into tegel_wit.
function buildHallLayout(map: MapSystem, rng: () => number): {
  rooms: Room[]; doorsByRoom: Map<number, DoorInfo[]>; connected: Set<string>
} {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'hall_wall')

  // 5-8 rooms
  const roomCount = 5 + Math.floor(rng() * 4)
  const rooms: Room[] = []
  for (let i = 0; i < roomCount; i++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rw = 5 + Math.floor(rng() * 5)
      const rh = 3 + Math.floor(rng() * 3)
      const rx = 2 + Math.floor(rng() * (W - rw - 4))
      const ry = 2 + Math.floor(rng() * (H - rh - 4))
      if (rooms.some(r =>
        rx <= r.x + r.w + 1 && rx + rw >= r.x - 1 &&
        ry <= r.y + r.h + 1 && ry + rh >= r.y - 1
      )) continue
      rooms.push({ x: rx, y: ry, w: rw, h: rh })
      break
    }
  }

  // Apply walled rooms (floors + walls + random doors)
  for (const room of rooms) wallRoom(map, room, rng)

  // Collect door positions and exit cells (tegel_wit cell just outside each door)
  const doorsByRoom = collectRoomDoors(map, rooms)
  for (const doors of doorsByRoom.values())
    for (const d of doors)
      map.setTile(d.exitX, d.exitY, 'tegel_wit')

  // Replace stranded doors (adjacent-room walls blocked the exit cell) with wall tiles
  const validDoorSet = new Set<string>()
  for (const doors of doorsByRoom.values())
    for (const d of doors)
      validDoorSet.add(`${d.doorX},${d.doorY}`)

  for (const room of rooms) {
    const toCheck: Array<{ x: number; y: number }> = []
    for (let x = room.x; x < room.x + room.w; x++) {
      toCheck.push({ x, y: room.y - 1 }, { x, y: room.y + room.h })
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      toCheck.push({ x: room.x - 1, y }, { x: room.x + room.w, y })
    }
    for (const { x, y } of toCheck) {
      if (!map.isInBounds(x, y)) continue
      if (map.getTile(x, y)?.defId === 'door_closed' && !validDoorSet.has(`${x},${y}`)) {
        map.setTile(x, y, doorReplacementWall(map, x, y))
      }
    }
  }

  // Seed connected set with room[0]'s exit cells
  const connected = new Set<string>()
  for (const d of doorsByRoom.get(0) ?? [])
    connected.add(`${d.exitX},${d.exitY}`)
  if (connected.size === 0 && rooms.length > 0) {
    const r = rooms[0]
    connected.add(`${r.x + Math.floor(r.w / 2)},${r.y - 1}`)
  }

  // Connect remaining rooms with organic random paths; remove doors with no reachable path
  for (let ri = 1; ri < rooms.length; ri++) {
    for (const d of doorsByRoom.get(ri) ?? []) {
      if (connected.has(`${d.exitX},${d.exitY}`)) continue
      const path = randomCorridorPath(d.exitX, d.exitY, connected, map, rng)
      if (path) {
        for (const { x, y } of path) {
          if (map.getTile(x, y)?.defId === 'hall_wall') map.setTile(x, y, 'tegel_wit')
          connected.add(`${x},${y}`)
        }
      } else {
        map.setTile(d.doorX, d.doorY, doorReplacementWall(map, d.doorX, d.doorY))
      }
    }
  }

  return { rooms, doorsByRoom, connected }
}

function collectRoomDoors(map: MapSystem, rooms: Room[]): Map<number, DoorInfo[]> {
  const result = new Map<number, DoorInfo[]>()
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri]
    const doors: DoorInfo[] = []
    for (let x = room.x; x < room.x + room.w; x++) {
      tryAddDoor(map, x, room.y - 1, doors)
      tryAddDoor(map, x, room.y + room.h, doors)
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      tryAddDoor(map, room.x - 1, y, doors)
      tryAddDoor(map, room.x + room.w, y, doors)
    }
    result.set(ri, doors)
  }
  return result
}

function tryAddDoor(map: MapSystem, x: number, y: number, doors: DoorInfo[]): void {
  if (!map.isInBounds(x, y)) return
  if (map.getTile(x, y)?.defId !== 'door_closed') return
  const exit = getDoorExitCell(map, x, y)
  if (!exit || !map.isInBounds(exit.x, exit.y)) return
  if (map.getTile(exit.x, exit.y)?.defId !== 'hall_wall') return
  doors.push({ doorX: x, doorY: y, exitX: exit.x, exitY: exit.y })
}

function getDoorExitCell(map: MapSystem, dx: number, dy: number): { x: number; y: number } | null {
  const isFloor = (x: number, y: number) => map.getTile(x, y)?.defId === 'floor'
  if (isFloor(dx, dy + 1)) return { x: dx, y: dy - 1 }
  if (isFloor(dx, dy - 1)) return { x: dx, y: dy + 1 }
  if (isFloor(dx + 1, dy)) return { x: dx - 1, y: dy }
  if (isFloor(dx - 1, dy)) return { x: dx + 1, y: dy }
  return null
}

function doorReplacementWall(map: MapSystem, dx: number, dy: number): string {
  const isFloor = (x: number, y: number) => map.getTile(x, y)?.defId === 'floor'
  if (isFloor(dx, dy + 1)) return 'wall_up'
  if (isFloor(dx, dy - 1)) return 'wall_down'
  if (isFloor(dx + 1, dy)) return 'wall_left'
  if (isFloor(dx - 1, dy)) return 'wall_right'
  return 'wall_up'
}

function randomCorridorPath(
  startX: number, startY: number,
  connected: Set<string>,
  map: MapSystem,
  rng: () => number,
): Array<{ x: number; y: number }> | null {
  const W = map.width, H = map.height
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const open: Array<{ x: number; y: number; cost: number }> = []

  const startKey = `${startX},${startY}`
  dist.set(startKey, 0)
  prev.set(startKey, 'NONE')
  open.push({ x: startX, y: startY, cost: 0 })

  while (open.length > 0) {
    let minIdx = 0
    for (let i = 1; i < open.length; i++)
      if (open[i].cost < open[minIdx].cost) minIdx = i
    const { x, y, cost: currCost } = open[minIdx]
    open.splice(minIdx, 1)

    const currKey = `${x},${y}`
    if (currCost > (dist.get(currKey) ?? Infinity)) continue

    for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) {
      const nx = x + ddx, ny = y + ddy
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
      const nk = `${nx},${ny}`
      const tid = map.getTile(nx, ny)?.defId
      if (tid !== 'hall_wall' && tid !== 'tegel_wit') continue
      const newCost = currCost + 1 + Math.floor(rng() * 6)
      if (newCost < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, newCost)
        prev.set(nk, currKey)
        if (connected.has(nk)) {
          const path: Array<{ x: number; y: number }> = [{ x: nx, y: ny }]
          let k = currKey
          while (k !== 'NONE') {
            const [px, py] = k.split(',').map(Number)
            path.unshift({ x: px, y: py })
            k = prev.get(k)!
          }
          return path
        }
        open.push({ x: nx, y: ny, cost: newCost })
      }
    }
  }
  return null
}

function bfsToConnected(
  startX: number, startY: number,
  connected: Set<string>,
  map: MapSystem,
): Array<{ x: number; y: number }> | null {
  const W = map.width, H = map.height
  const prev = new Map<string, string>()
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }]
  prev.set(`${startX},${startY}`, 'NONE')
  let head = 0

  while (head < queue.length) {
    const { x, y } = queue[head++]
    const currKey = `${x},${y}`
    for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) {
      const nx = x + ddx, ny = y + ddy
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
      const nk = `${nx},${ny}`
      if (prev.has(nk)) continue
      const tid = map.getTile(nx, ny)?.defId
      if (tid !== 'hall_wall' && tid !== 'tegel_wit') continue
      prev.set(nk, currKey)
      if (connected.has(nk)) {
        const path: Array<{ x: number; y: number }> = [{ x: nx, y: ny }]
        let k = currKey
        while (k !== 'NONE') {
          const [px, py] = k.split(',').map(Number)
          path.unshift({ x: px, y: py })
          k = prev.get(k)!
        }
        return path
      }
      queue.push({ x: nx, y: ny })
    }
  }
  return null
}

function addHallBorderExits(
  map: MapSystem,
  connected: Set<string>,
  W: number, H: number,
  ucx: number, ucy: number, ugrid: number,
): void {
  const midY = Math.floor(H / 2)
  const midX = Math.floor(W / 2)

  // Only add exits at inner grid edges (not outer borders of the 3Ã—3)
  const edges = [
    ucx < ugrid - 1 ? { exitTile: 'exit_right', bx: W-1, by: midY, ix: W-2, iy: midY, varyY: true  } : null,
    ucx > 0         ? { exitTile: 'exit_left',  bx: 0,   by: midY, ix: 1,   iy: midY, varyY: true  } : null,
    // The left column's middle and bottom cells are cut off from each other;
    // the bottom-left cell is reached through the cell to its right
    ucy < ugrid - 1 && !(ucx === 0 && ucy === ugrid - 2) ? { exitTile: 'exit_down',  bx: midX, by: H-1, ix: midX, iy: H-2, varyY: false } : null,
    ucy > 0         && !(ucx === 0 && ucy === ugrid - 1) ? { exitTile: 'exit_up',    bx: midX, by: 0,   ix: midX, iy: 1,   varyY: false } : null,
  ]
  carveHallExits(map, connected, W, H, edges)
}

interface HallExitEdge {
  exitTile: string
  bx: number; by: number   // border tile the exit lands on
  ix: number; iy: number   // preferred border-adjacent start cell
  varyY: boolean           // slide along y (left/right edges) or x (top/bottom edges)
}

// Carves a corridor from the connected network out to each requested border
// edge and drops the edge's exit tile there.
function carveHallExits(
  map: MapSystem,
  connected: Set<string>,
  W: number, H: number,
  edges: Array<HallExitEdge | null>,
): void {
  for (const edge of edges) {
    if (!edge) continue
    const { exitTile, bx, by, ix, iy, varyY } = edge

    // Find nearest hall_wall or tegel_wit position along the border-adjacent col/row
    const limit = varyY ? H : W
    let sx = ix, sy = iy
    let foundStart = false
    for (let off = 0; off < limit && !foundStart; off++) {
      const candidates = off === 0
        ? [{ x: ix, y: iy }]
        : [
            { x: varyY ? ix : ix + off, y: varyY ? iy + off : iy },
            { x: varyY ? ix : ix - off, y: varyY ? iy - off : iy },
          ]
      for (const c of candidates) {
        if (c.x < 1 || c.x >= W - 1 || c.y < 1 || c.y >= H - 1) continue
        const tid = map.getTile(c.x, c.y)?.defId
        if (tid === 'hall_wall' || tid === 'tegel_wit') {
          sx = c.x; sy = c.y; foundStart = true; break
        }
      }
    }
    if (!foundStart) continue

    // BFS from (sx,sy) to connected network; skip if already connected
    if (!connected.has(`${sx},${sy}`)) {
      const path = bfsToConnected(sx, sy, connected, map)
      if (!path) continue
      for (const { x, y } of path) {
        if (map.getTile(x, y)?.defId === 'hall_wall') map.setTile(x, y, 'tegel_wit')
        connected.add(`${x},${y}`)
      }
    }

    // Place exit tile adjacent to the carved start cell
    const exitBx = varyY ? bx : sx
    const exitBy = varyY ? sy : by
    map.setTile(exitBx, exitBy, exitTile)
    connected.add(`${exitBx},${exitBy}`)
  }
}

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// Converts void tiles sitting directly below a water tile into waterbodem (pond lakebed).
function addWaterbodem(map: MapSystem): void {
  const W = map.width
  const H = map.height
  for (let y = 1; y < H; y++)
    for (let x = 0; x < W; x++)
      if (map.getTile(x, y)?.defId === 'void' && map.getTile(x, y - 1)?.defId === 'water')
        map.setTile(x, y, 'waterbodem')
}

const CHAOS_TILES = [
  'water', 'grass', 'berg', 'lava', 'mud',
  'tree', 'crypt', 'tree_dead', 'vulkaan',
  'carpet', 'tegel_wit', 'floor',
]

export const CHAOS_TILE_POOL = CHAOS_TILES

const CHAOS_LOOT_POOL = [
  'health_potion', 'speed_potion', 'gold_coin', 'banaan', 'sinaasappel',
  'boterham', 'stroopwafels', 'dropje', 'bracers', 'gorget', 'helmet',
  'pickaxe',
]

// Party carpet in Eric's bedroom: a fixed 5x5 patch just inside the door from
// the upper hall that the chaos never touches. Widget sits on its center tile.
export function chaosPartyArea(W: number, H: number): { x1: number; y1: number; x2: number; y2: number; cx: number; cy: number } {
  const cx = W - 4
  const cy = Math.floor(H / 2)
  return { x1: cx - 2, y1: cy - 2, x2: cx + 2, y2: cy + 2, cx, cy }
}

export function inChaosPartyArea(W: number, H: number, x: number, y: number): boolean {
  const a = chaosPartyArea(W, H)
  return x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2
}

/** The 8 tiles around Widget, clockwise from the top-left. */
export function chaosPartyRing(W: number, H: number): Array<{ x: number; y: number }> {
  const { cx, cy } = chaosPartyArea(W, H)
  return [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
    .map(([dx, dy]) => ({ x: cx + dx, y: cy + dy }))
}

function randomChaosSpot(W: number, H: number, cx: number, cy: number, taken: Set<string>): { x: number; y: number } {
  let x: number, y: number
  do {
    x = Math.floor(Math.random() * W)
    y = Math.floor(Math.random() * H)
  } while ((x === cx && y === cy) || (x === cx + 1 && y === cy) || taken.has(`${x},${y}`) || inChaosPartyArea(W, H, x, y))
  taken.add(`${x},${y}`)
  return { x, y }
}

export function generateChaosMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, CHAOS_TILES[Math.floor(Math.random() * CHAOS_TILES.length)])
  const cx = Math.floor(W / 2)
  const cy = Math.floor(H / 2)
  map.setTile(cx, cy, 'portal_chaos')
  map.setTile(cx + 1, cy, 'floor')
  // East door: back to the upper hall
  map.setTile(W - 1, cy, 'chaos_exit_upper_hall')
  const party = chaosPartyArea(W, H)
  const partyTiles: Array<{ x: number; y: number }> = []
  for (let y = party.y1; y <= party.y2; y++)
    for (let x = party.x1; x <= party.x2; x++) {
      map.setTile(x, y, 'carpet')
      partyTiles.push({ x, y })
    }

  const taken = new Set<string>()
  const trousersSpot = randomChaosSpot(W, H, cx, cy, taken)
  map.setTile(trousersSpot.x, trousersSpot.y, 'floor')
  const lootSpots = [randomChaosSpot(W, H, cx, cy, taken), randomChaosSpot(W, H, cx, cy, taken)]
  for (const spot of lootSpots) map.setTile(spot.x, spot.y, 'floor')
  const lootIds = lootSpots.map(() => CHAOS_LOOT_POOL[Math.floor(Math.random() * CHAOS_LOOT_POOL.length)])

  const player = { x: cx, y: cy }
  const CENT_VALUES = [5, 10, 50, 100, 250, 500]
  const qtyFor = (defId: string) => defId === 'gold_coin' ? CENT_VALUES[Math.floor(Math.random() * CENT_VALUES.length)] : 1
  const specialItems: SpawnPoints['items'] = [
    { x: trousersSpot.x, y: trousersSpot.y, defId: 'ninjabroek', qty: 1 },
    { x: lootSpots[0].x, y: lootSpots[0].y, defId: lootIds[0], qty: qtyFor(lootIds[0]) },
    { x: lootSpots[1].x, y: lootSpots[1].y, defId: lootIds[1], qty: qtyFor(lootIds[1]) },
  ]
  const relic = relicItem ? placeSingleItemRandomly(map, Math.random, relicItem, [player, ...partyTiles, ...specialItems]) : null
  if (relic) specialItems.push(relic)
  // At most 3 items: the ninja trousers, maybe a relic, and one common item
  const scattered = scatterRandomItems(map, Math.random, 'chaos', 1, [player, ...partyTiles, ...specialItems], 1)

  return {
    player,
    monsters: [{ x: cx + 1, y: cy, defId: 'eric', message: 'The floor is lava!' }],
    items: [...specialItems, ...scattered],
  }
}

function placeBedroomSegments(
  map: MapSystem,
  count: number,
  avoid: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  W: number, H: number
): void {
  let placed = 0, attempts = 0
  while (placed < count && attempts < count * 30) {
    attempts++
    const horiz = Math.random() < 0.5
    const len   = 3 + Math.floor(Math.random() * 3)
    const x     = 3 + Math.floor(Math.random() * (W - 6 - (horiz ? len : 0)))
    const y     = 3 + Math.floor(Math.random() * (H - 6 - (horiz ? 0 : len)))
    const ex    = x + (horiz ? len - 1 : 0)
    const ey    = y + (horiz ? 0 : len - 1)
    if (avoid.some(z => x <= z.x2 + 1 && ex >= z.x1 - 1 && y <= z.y2 + 1 && ey >= z.y1 - 1)) continue

    // Require 1-tile clear buffer around segment so walls never touch
    let clear = true
    bufcheck: for (let cy = y - 1; cy <= ey + 1; cy++)
      for (let cx = x - 1; cx <= ex + 1; cx++) {
        const t = map.getTile(cx, cy)
        if (t && t.defId !== 'tapijt3') { clear = false; break bufcheck }
      }
    if (!clear) continue

    if (horiz) {
      for (let i = 0; i < len; i++) map.setTile(x + i, y, 'wall_up')
    } else {
      for (let i = 0; i < len; i++) map.setTile(x, y + i, 'wall_left')
    }
    placed++
  }
}

export function generateBedroomMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height

  // Carpet floor throughout
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'tapijt3')

  // Directional border walls
  map.setTile(0,     0,     'wall_corner_tl')
  map.setTile(W - 1, 0,     'wall_corner_tr')
  for (let x = 1; x < W - 1; x++) map.setTile(x, 0, 'wall_up')
  for (let y = 1; y < H - 1; y++) { map.setTile(0, y, 'wall_left'); map.setTile(W - 1, y, 'wall_right') }
  for (let sx = 0; sx < W; sx++) map.setTile(sx, H - 1, 'bedroom_stairs_down')

  // Walled sanctuary â€” schema origin at (W/2-3, H/2-4) = (37, 6)
  // wall types=directional walls f=flame g=guardian m=summoner t=tegel_wit+widget
  const WALL_TILES = new Set(['wall_corner_tl','wall_corner_tr','wall_corner_bl','wall_corner_br',
    'wall_up','wall_down','wall_left','wall_right','door_closed'])
  const SCHEMA = [
    ['wall_corner_tl','wall_up',   'wall_up',        'wall_up',     'wall_up',   'wall_up',   'wall_corner_tr'],
    ['wall_left',     'f',         '',               'f',           '',          'f',         'wall_right'],
    ['wall_left',     '',          'g',              'm',           'g',         '',          'wall_right'],
    ['wall_left',     'f',         'g',              't',           'g',         'f',         'wall_right'],
    ['wall_left',     '',          'g',              'g',           'g',         '',          'wall_right'],
    ['wall_left',     'f',         '',               '',            '',          'f',         'wall_right'],
    ['wall_corner_bl','wall_down', 'wall_down', '', 'wall_down', 'wall_down', 'wall_corner_br']
  ]
  const bx = Math.floor(W / 2) - 3
  const by = Math.floor(H / 2) - 4

  const sanctuaryMonsters: SpawnPoints['monsters'] = []
  const sanctuaryItems:    SpawnPoints['items']    = []
  for (let row = 0; row < SCHEMA.length; row++) {
    for (let col = 0; col < SCHEMA[row].length; col++) {
      const tx = bx + col, ty = by + row
      const cell = SCHEMA[row][col]
      if      (WALL_TILES.has(cell))  map.setTile(tx, ty, cell)
      else if (cell === 'f')          map.setTile(tx, ty, 'flame')
      else if (cell === 't')        { map.setTile(tx, ty, 'tegel_wit'); sanctuaryItems.push({ x: tx, y: ty, defId: 'widget2' }) }
      else if (cell === 'g')          sanctuaryMonsters.push({ x: tx, y: ty, defId: 'guardian' })
      else if (cell === 'm')          sanctuaryMonsters.push({ x: tx, y: ty, defId: 'summoner' })
    }
  }

  // Ceremonial entrance â€” corridor walls and open arch below the sanctuary door
  map.setTile(bx + 1, by + 7, 'wall_left');   map.setTile(bx + 5, by + 7, 'wall_right')
  map.setTile(bx + 1, by + 8, 'wall_left');   map.setTile(bx + 5, by + 8, 'wall_right')
  map.setTile(bx + 1, by + 9, 'wall_corner_bl')
  map.setTile(bx + 2, by + 9, 'wall_down');   map.setTile(bx + 4, by + 9, 'wall_down')
  map.setTile(bx + 5, by + 9, 'wall_corner_br')
  // Ceremonial flames flanking the entrance corridor
  for (const [dx, dy] of [[0,7],[6,7],[0,8],[6,8],[0,9],[6,9]] as [number,number][])
    map.setTile(bx + dx, by + dy, 'flame')

  // Extra scattered flames around the room
  for (const [fx, fy] of [[10,5],[70,5],[10,14],[70,14],[20,10],[60,10],[8,16],[72,16]] as [number,number][])
    if (map.getTile(fx, fy)?.defId === 'tapijt3') map.setTile(fx, fy, 'flame')


  // Random wall segments â€” avoid sanctuary+entrance and player spawn area
  // buffer check in helper prevents touching the stair row and border walls
  placeBedroomSegments(map, 16, [
    { x1: bx - 2, y1: by - 2, x2: bx + 8, y2: by + 11 },
    { x1: 0,      y1: H - 4,  x2: 8,       y2: H - 1   },
  ], W, H)

  // Exit portal at bottom-left wall
  map.setTile(0, H - 2, 'bedroom_exit')

  // Scrolls above every horizontal wall segment
  const scrollIds = [
    'scroll_teleport', 'scroll_alliance', 'scroll_cartography',
    'scroll_timestop', 'scroll_twelvegates', 'scroll_lavastrike',
  ]
  const scrollItems: SpawnPoints['items'] = []
  let scrollIdx = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (map.getTile(x, y)?.defId === 'wall_up' && map.getTile(x, y - 1)?.defId === 'tapijt3') {
        scrollItems.push({ x, y: y - 1, defId: scrollIds[scrollIdx % scrollIds.length] })
        scrollIdx++
      }
    }
  }

  const fixedMonsters: SpawnPoints['monsters'] = [
    { x: bx + 3, y: by + 9, defId: 'mar_bedroom' },
    ...sanctuaryMonsters,
    { x: 20,        y: 8,        defId: 'guineapig' },
    { x: 35,        y: 12,       defId: 'guineapig' },
    { x: 55,        y: 8,        defId: 'guineapig' },
    { x: 65,        y: 14,       defId: 'watcher' },
  ]

  const clayClump: SpawnPoints['items'] = [
    { x: 13, y: 13, defId: 'clay' },
    { x: 67, y: 18, defId: 'clay' },
  ]

  const player = { x: 2, y: H - 2 }

  // Generic hostiles rolled per game, kept out of the sanctuary and its entrance.
  const monsters: SpawnPoints['monsters'] = [
    ...fixedMonsters,
    ...spawnRandomMonsters(map, Math.random, 'bedroom', 8, {
      player,
      avoid: [...fixedMonsters, ...scrollItems, ...clayClump],
      allow: (x, y) => !(x >= bx - 1 && x <= bx + 7 && y >= by - 1 && y <= by + 10),
    }),
  ]
  const specialItems: SpawnPoints['items'] = [...sanctuaryItems, ...scrollItems, ...clayClump]
  const relic = relicItem ? placeSingleItemRandomly(map, Math.random, relicItem, [player, ...specialItems, ...monsters]) : null
  if (relic) specialItems.push(relic)
  const scattered = scatterRandomItems(map, Math.random, 'bedroom', 8, [player, ...specialItems, ...monsters])

  return { player, monsters, items: [...specialItems, ...scattered] }
}

export function generateBedroomLowerMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'tapijt3')

  map.setTile(0,     H - 1, 'wall_corner_bl'); map.setTile(W - 1, H - 1, 'wall_corner_br')
  for (let x = 1; x < W - 1; x++) map.setTile(x, H - 1, 'wall_down')
  for (let y = 1; y < H - 1; y++) { map.setTile(0, y, 'wall_left'); map.setTile(W - 1, y, 'wall_right') }
  for (let sx = 0; sx < W; sx++) map.setTile(sx, 0, 'bedroom_stairs_up')

  // Bottom door: back to the upper hall
  map.setTile(Math.floor(W / 2), H - 1, 'mar_exit_upper_hall')

  // Balcony door out to the driveway, in the bottom-right wall
  for (let y = H - 5; y <= H - 2; y++) map.setTile(W - 1, y, 'bedroom_portal_driveway')

  placeBedroomSegments(map, 20, [], W, H)

  const monsters: SpawnPoints['monsters'] = [
    { x: 10, y: 10, defId: 'guardian' },
    { x: 60, y: 10, defId: 'guardian' },
    { x: 25, y: 5,  defId: 'summoner' },
    { x: 55, y: 15, defId: 'summoner' },
    { x: 40, y: 8,  defId: 'firedragon' },
  ]

  const player = { x: 2, y: H - 3 }
  const relic = relicItem ? placeSingleItemRandomly(map, Math.random, relicItem, [player, ...monsters]) : null
  const fixedItems = relic ? [relic] : []
  const items = scatterRandomItems(map, Math.random, 'bedroom_lower', 6, [player, ...monsters, ...fixedItems])

  return { player, monsters, items: [...fixedItems, ...items] }
}

    // { x: 30, y: 3,  defId: 'firedragon' },
    // { x: 55, y: 3,  defId: 'firedragon' },
    // { x: 72, y: 3,  defId: 'firedragon' },
    // { x: 20, y: 10, defId: 'firedragon' },
    // { x: 60, y: 10, defId: 'firedragon' },
    // // Ice dragons
    // { x: 20, y: 3,  defId: 'icedragon' },
    // { x: 45, y: 3,  defId: 'icedragon' },
    // { x: 67, y: 3,  defId: 'icedragon' },
    // { x: 40, y: 10, defId: 'icedragon' },
    // { x: 72, y: 14, defId: 'icedragon' },
    // // Wizards
    // { x: 15, y: 6,  defId: 'wizard' },
    // { x: 35, y: 7,  defId: 'wizard' },
    // { x: 55, y: 6,  defId: 'wizard' },
    // { x: 70, y: 8,  defId: 'wizard' },
    // { x: 25, y: 14, defId: 'wizard' },
    // { x: 50, y: 14, defId: 'wizard' },
    // // Sorcerers
    // { x: 8,  y: 7,  defId: 'sorcerer' },
    // { x: 28, y: 5,  defId: 'sorcerer' },
    // { x: 48, y: 8,  defId: 'sorcerer' },
    // { x: 65, y: 12, defId: 'sorcerer' },
    // { x: 38, y: 15, defId: 'sorcerer' },
    // // Magicians
    // { x: 18, y: 12, defId: 'magician' },
    // { x: 42, y: 5,  defId: 'magician' },
    // { x: 62, y: 7,  defId: 'magician' },

const KITCHEN_TILES = ['kitchen_tile1', 'kitchen_tile2', 'kitchen_tile3', 'kitchen_tile4']

export function generateKitchenMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(99)

  // Random kitchen floor tiles
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, KITCHEN_TILES[Math.floor(rng() * 4)])

  // Border walls using muur_*_v
  map.setTile(0,     0,     'muur_corner_tl_v')
  map.setTile(W - 1, 0,     'muur_corner_tr_v')
  map.setTile(0,     H - 1, 'muur_corner_bl_v')
  map.setTile(W - 1, H - 1, 'muur_corner_br_v')

  for (let x = 1; x < W - 1; x++) {
    map.setTile(x, 0,     'muur_up_v')
    map.setTile(x, H - 1, 'muur_down_v')
  }

  for (let y = 1; y < H - 1; y++) {
    map.setTile(0,     y, 'muur_left_v')
    map.setTile(W - 1, y, 'muur_right_v')
  }

  // Exit arrows at top-center (return to garden)
  const midX = Math.floor(W / 2)
  for (let x = midX - 2; x <= midX + 2; x++)
    map.setTile(x, 0, 'kitchen_exit_top')

  // Exit arrows at bottom-center (to hall)
  for (let x = midX - 2; x <= midX + 2; x++)
    map.setTile(x, H - 1, 'kitchen_exit')

  const player = { x: midX, y: 1 }
  const fixedMonsters = [
    { x: midX, y: 10, defId: 'mam', message: 'Cough... Orange juice... Cough... Cough...' },
    { x: 10,   y: 5,  defId: 'cactus' },
    { x: 30,   y: 5,  defId: 'cactus' },
    { x: 50,   y: 5,  defId: 'cactus' },
    { x: 70,   y: 5,  defId: 'cactus' },
    { x: 20,   y: 15, defId: 'cactus' },
    { x: 20,   y: 7,  defId: 'wierdfume' },
    { x: 60,   y: 7,  defId: 'wierdfume' },
  ]
  const specialItems = [
    { x: 5,  y: 3,  defId: 'banaan' },
    { x: 14, y: 3,  defId: 'sinaasappel' },
    { x: 24, y: 3,  defId: 'pannenkoeken' },
    { x: 34, y: 3,  defId: 'boterham' },
    { x: 44, y: 3,  defId: 'stroopwafels' },
    { x: 54, y: 3,  defId: 'speculaas' },
    { x: 64, y: 3,  defId: 'sprits' },
    { x: 74, y: 3,  defId: 'dropje' },
    { x: 10, y: 10, defId: 'kruk' },
    { x: 25, y: 8,  defId: 'kruk' },
    { x: 40, y: 14, defId: 'kruk' },
    { x: 60, y: 12, defId: 'kruk' },
    { x: 72, y: 16, defId: 'kruk' },
    { x: 40, y: 17, defId: 'lekkervisje' },
  ]
  const srng = spawnRng(99)
  const monsters = [...fixedMonsters, ...spawnRandomMonsters(map, srng, 'kitchen', 6, {
    player, avoid: [...fixedMonsters, ...specialItems],
  })]
  // The wet tea towel, the remote and a handful of empty vials lie somewhere different each game
  for (const defId of ['theedoek', 'remote', ...Array(5).fill('empty_vial')]) {
    const it = placeSingleItemRandomly(map, srng, defId, [player, ...specialItems, ...monsters])
    if (it) specialItems.push(it)
  }
  const relic = relicItem ? placeSingleItemRandomly(map, rng, relicItem, [player, ...specialItems, ...monsters]) : null
  if (relic) specialItems.push(relic)
  const scattered = scatterRandomItems(map, srng, 'kitchen', 5, [player, ...specialItems, ...monsters])

  return { player, monsters, items: [...specialItems, ...scattered] }
}

export function generateStudyMap(map: MapSystem, relicItem?: string | null): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'carpet')

  map.setTile(0,     0,     'muur_corner_tl_v')
  map.setTile(W - 1, 0,     'muur_corner_tr_v')
  map.setTile(0,     H - 1, 'muur_corner_bl_v')
  map.setTile(W - 1, H - 1, 'muur_corner_br_v')

  for (let x = 1; x < W - 1; x++) {
    map.setTile(x, 0,     'muur_up_v')
    map.setTile(x, H - 1, 'muur_down_v')
  }

  for (let y = 1; y < H - 1; y++) {
    map.setTile(0,     y, 'muur_left_v')
    map.setTile(W - 1, y, 'muur_right_v')
  }

  const midX = Math.floor(W / 2)
  // Bottom-left corner: down arrow back to the upper hall
  map.setTile(1, H - 1, 'study_exit_upper_hall')
  // Bottom-right corner: rainbow staircase up to the loft
  map.setTile(W - 2, H - 2, 'portal_stairs_up')

  // Organic pools grown via BFS blob expansion from seed points
  const rng = seededRng(99)
  const poolSeeds: Array<[number, number, string, number]> = [
    [10,  4, 'study_pool',        9],
    [35,  8, 'study_pool',        8],
    [62, 12, 'study_pool',       10],
    [17, 15, 'study_pool_green',  7],
    [50,  5, 'study_pool_green', 11],
    [70, 10, 'study_pool_green',  8],
    [15, 10, 'study_pool_yellow', 9],
    [45, 16, 'study_pool_yellow', 6],
    [65,  3, 'study_pool_yellow',10],
  ]
  const DIRS4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}]
  for (const [sx, sy, pType, target] of poolSeeds) {
    const blob = new Set<string>()
    const frontier: Array<{x:number;y:number}> = [{x:sx,y:sy}]
    blob.add(`${sx},${sy}`)
    map.setTile(sx, sy, pType)
    while (frontier.length > 0 && blob.size < target) {
      const idx = Math.floor(rng() * frontier.length)
      const {x, y} = frontier[idx]
      const dirs = DIRS4.slice().sort(() => rng() - 0.5)
      let grew = false
      for (const {dx, dy} of dirs) {
        const nx = x + dx, ny = y + dy
        if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue
        const key = `${nx},${ny}`
        if (blob.has(key)) continue
        if (map.getTile(nx, ny)?.defId !== 'carpet') continue
        blob.add(key)
        map.setTile(nx, ny, pType)
        frontier.push({x:nx,y:ny})
        grew = true
        break
      }
      if (!grew) frontier.splice(idx, 1)
    }
  }

  // Broad rectangular water body — center-bottom, tetra habitat (placed after pools so it wins overlap)
  for (let y = 13; y <= 17; y++)
    for (let x = 22; x <= 58; x++)
      map.setTile(x, y, 'water')

  const player = { x: midX, y: 1 }
  const monsters = [
      { x: 40,  y: 10, defId: 'pap2' },
      { x: 27,  y: 14, defId: 'tetra' },
      { x: 34,  y: 15, defId: 'tetra' },
      { x: 40,  y: 14, defId: 'tetra' },
      { x: 47,  y: 16, defId: 'tetra' },
      { x: 53,  y: 15, defId: 'tetra' },
      { x: 30,  y: 16, defId: 'tetra' },
      { x: 44,  y: 15, defId: 'tetra' },
      { x: 37,  y: 16, defId: 'tetra' },
      { x: 50,  y: 14, defId: 'tetra' },
      { x: 25,  y: 16, defId: 'tetra' },
      { x: 56,  y: 14, defId: 'tetra' },
      { x: 23,  y: 15, defId: 'tetra' },
      { x: 5,   y: 8,  defId: 'cactus' },
      { x: 25,  y: 2,  defId: 'cactus' },
      { x: 55,  y: 11, defId: 'cactus' },
      { x: 72,  y: 7,  defId: 'cactus' },
      { x: 30,  y: 12, defId: 'cactus' },
      { x: 60,  y: 2,  defId: 'cactus' },
      { x: 3,   y: 3,  defId: 'cactus' },
      { x: 3,   y: 16, defId: 'cactus' },
      { x: 8,   y: 13, defId: 'cactus' },
      { x: 12,  y: 17, defId: 'cactus' },
      { x: 15,  y: 5,  defId: 'cactus' },
      { x: 18,  y: 17, defId: 'cactus' },
      { x: 20,  y: 9,  defId: 'cactus' },
      { x: 33,  y: 4,  defId: 'cactus' },
      { x: 48,  y: 3,  defId: 'cactus' },
      { x: 65,  y: 15, defId: 'cactus' },
      { x: 75,  y: 3,  defId: 'cactus' },
      { x: 75,  y: 14, defId: 'cactus' },
      { x: 68,  y: 9,  defId: 'cactus' },
      { x: 12,  y: 12, defId: 'cactus' },
      { x: 40,  y: 13, defId: 'klopper' },
  ]
  const specialItems: SpawnPoints['items'] = [
    { x: midX - 2, y: 3, defId: 'empty_vial', qty: 1 },
    { x: midX + 2, y: 3, defId: 'empty_vial', qty: 1 },
  ]
  const relic = relicItem ? placeSingleItemRandomly(map, rng, relicItem, [player, ...specialItems, ...monsters]) : null
  if (relic) specialItems.push(relic)
  const scattered = scatterRandomItems(map, spawnRng(199), 'study', 5, [player, ...specialItems, ...monsters])

  return { player, monsters, items: [...specialItems, ...scattered] }
}

// Switchback stairwell between the study (bottom) and the loft (top).
// Five 2-tile-high flights stacked bottom→top, joined by 2×2 landings that
// alternate right/left ends, so the climb zig-zags up the whole map.
export function generateLoftStairsMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'stairs_wall')

  const L = 2, R = W - 3                             // flight x-span: 2..77
  const flightTops = [H - 3, H - 7, H - 11, H - 15, 1] // 17, 13, 9, 5, 1
  for (const fy of flightTops)
    for (let y = fy; y <= fy + 1; y++)
      for (let x = L; x <= R; x++)
        map.setTile(x, y, 'carpet')

  // Landings between consecutive flights: right, left, right, left
  for (let i = 0; i < flightTops.length - 1; i++) {
    const lx = i % 2 === 0 ? R - 1 : L
    for (let y = flightTops[i + 1] + 2; y < flightTops[i]; y++) {
      map.setTile(lx,     y, 'carpet')
      map.setTile(lx + 1, y, 'carpet')
    }
  }

  // Bottom arrows (back down to the study) under the first flight's left end;
  // top arrows (up to the loft) above the last flight's right end.
  map.setTile(L,     H - 1, 'loft_stairs_exit_down')
  map.setTile(L + 1, H - 1, 'loft_stairs_exit_down')
  map.setTile(R - 1, 0,     'loft_stairs_exit_up')
  map.setTile(R,     0,     'loft_stairs_exit_up')

  const player = { x: L, y: H - 2 }
  const top    = { x: R, y: 1 }

  const srng = spawnRng(74)
  const monsters: SpawnPoints['monsters'] = []
  const hostiles = scaleMonsterCount(4, srng)
  let attempts = 0
  while (monsters.length < hostiles && attempts < 500) {
    attempts++
    const tx = 1 + Math.floor(srng() * (W - 2))
    const ty = 1 + Math.floor(srng() * (H - 2))
    if (map.getTile(tx, ty)?.defId !== 'carpet') continue
    if (Math.abs(tx - player.x) < 8 && Math.abs(ty - player.y) < 3) continue
    if (Math.abs(tx - top.x) < 8 && Math.abs(ty - top.y) < 3) continue
    if (monsters.some(m => m.x === tx && m.y === ty)) continue
    monsters.push({ x: tx, y: ty, defId: pickAreaMonster('loft_stairs', srng) })
  }

  const scattered = scatterRandomItems(map, srng, 'loft_stairs', 2, [player, top, ...monsters])

  return { player, monsters, items: scattered }
}

export function generatePantryMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'floor')

  map.setTile(0,     0,     'muur_corner_tl_t')
  map.setTile(W - 1, 0,     'muur_corner_tr_t')
  map.setTile(0,     H - 1, 'muur_corner_bl_t')
  map.setTile(W - 1, H - 1, 'muur_corner_br_t')
  for (let x = 1; x < W - 1; x++) {
    map.setTile(x, 0,     'muur_up_t')
    map.setTile(x, H - 1, 'muur_down_t')
  }
  for (let y = 1; y < H - 1; y++) {
    map.setTile(0,     y, 'muur_left_t')
    map.setTile(W - 1, y, 'muur_right_t')
  }

  const midX = Math.floor(W / 2)
  map.setTile(midX, 0, 'pantry_exit')

  const player = { x: midX, y: 2 }

  const BLOCK_W  = 4
  const BLOCK_H  = 3
  const GAP_X    = 2
  const GAP_Y    = 2
  const STRIDE_X = BLOCK_W + GAP_X  // 6
  const STRIDE_Y = BLOCK_H + GAP_Y  // 5

  const categoryPool: string[][] = [
    ['banaan', 'sinaasappel', 'pannenkoeken', 'boterham', 'stroopwafels', 'speculaas', 'sprits', 'dropje', 'mispel'],
    ['flying_flippo', 'branch', 'knife', 'bijl', 'tuinschaar', 'katana', 'mace', 'silversword', 'wasknijper', 'shuriken'],
    ['scroll_teleport', 'scroll_alliance', 'scroll_cartography', 'scroll_timestop', 'scroll_twelvegates', 'scroll_lavastrike'],
    ['leather_armor', 'chain_mail', 'mirrorshield', 'tuinhandschoen', 'bracers', 'gorget', 'helmet', 'redcape'],
    ['ring_hastening', 'ring_famine', 'ring_cold', 'ring_invisibility', 'ring_locus'],
    ['pickaxe', 'kruk', 'lego1', 'lego2', 'lego3', 'stop', 'remote', 'gompie'],
    ['ericgras'],
    ['health_potion', 'speed_potion', 'phasing_potion', 'depredation_potion', 'strength_potion', 'experience_potion', 'blindness_potion', 'translucence_potion', 'transformation_potion'],
  ]

  const numCols = Math.floor((W - 2 - BLOCK_W) / STRIDE_X) + 1
  const numRows = Math.floor((H - 2 - BLOCK_H) / STRIDE_Y) + 1

  const items: Array<{ x: number; y: number; defId: string; qty: number }> = []
  let blockIdx = 0
  for (let row = 0; row < numRows; row++) {
    const y1 = 1 + row * STRIDE_Y
    for (let col = 0; col < numCols; col++) {
      const x1 = 1 + col * STRIDE_X
      const cat = categoryPool[blockIdx % categoryPool.length]
      blockIdx++
      for (let dy = 0; dy < BLOCK_H; dy++)
        for (let dx = 0; dx < BLOCK_W; dx++)
          items.push({ x: x1 + dx, y: y1 + dy, defId: cat[Math.floor(Math.random() * cat.length)], qty: 1 })
    }
  }

  return { player, monsters: [{ x: midX, y: Math.floor(H / 2), defId: 'eric_trader' }], items }
}

export function generatePond1Map(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'void')

  // Main wedge x=1..57: surface y=1, floor slopes y=4→11
  for (let x = 1; x <= 57; x++) {
    const floorY = 4 + Math.floor((x - 1) * 7 / 56)
    for (let y = 1; y < floorY; y++)
      map.setTile(x, y, 'water')
  }

  // Drop zone x=58..63: full depth, lets player dive down to passage level
  for (let x = 58; x <= 63; x++)
    for (let y = 1; y <= 17; y++)
      map.setTile(x, y, 'water')

  // Right section x=64..68: 3-tile passage connecting drop zone
  for (let x = 64; x <= 68; x++)
    for (let y = 15; y <= 17; y++)
      map.setTile(x, y, 'water')

  // Right section x=69..78: narrows to 1-tile passage matching pond2 entry
  for (let x = 69; x <= 78; x++)
    map.setTile(x, 16, 'water')

  // Left edge: exit back to overworld
  map.setTile(0, 1, 'pond_exit')

  // Right edge: single-tile arrow to pond2
  map.setTile(W - 1, 16, 'pond_exit_right')

  addWaterbodem(map)

  return {
    player: { x: 1, y: 1 },
    monsters: [
      { x: 10, y:  3, defId: 'vis'     },
      { x: 20, y:  4, defId: 'tetra'   },
      { x: 30, y:  5, defId: 'vis'     },
      { x: 40, y:  6, defId: 'tetra'   },
      { x: 50, y:  7, defId: 'qivuit'  },
      { x: 60, y: 10, defId: 'lorkest' },
      { x: 61, y:  6, defId: 'squid'   },
      { x: 65, y: 16, defId: 'tetra'   },
      { x: 67, y: 15, defId: 'vis'     },
      { x: 72, y: 16, defId: 'tetra'   },
      { x: 76, y: 16, defId: 'vis'     },
    ],
    items: [],
  }
}

export function generatePond2Map(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height
  const rng = seededRng(99)

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'void')

  // Generate rooms, sort top-left → bottom-right
  const rooms: Room[] = []
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const rw = 6 + Math.floor(rng() * 7)
      const rh = 3 + Math.floor(rng() * 4)
      const rx = 2 + Math.floor(rng() * (W - rw - 4))
      const ry = 1 + Math.floor(rng() * (H - rh - 2))
      if (rooms.some(r =>
        rx < r.x + r.w + 2 && rx + rw > r.x - 2 &&
        ry < r.y + r.h + 2 && ry + rh > r.y - 2
      )) continue
      rooms.push({ x: rx, y: ry, w: rw, h: rh })
      break
    }
  }
  rooms.sort((a, b) => (a.x + a.y) - (b.x + b.y))

  // Fill rooms with water
  for (const room of rooms)
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++)
        map.setTile(x, y, 'water')

  // Connect consecutive rooms with L-shaped corridors
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i]
    const ax = a.x + Math.floor(a.w / 2), ay = a.y + Math.floor(a.h / 2)
    const bx = b.x + Math.floor(b.w / 2), by = b.y + Math.floor(b.h / 2)
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) map.setTile(x, ay, 'water')
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) map.setTile(bx, y, 'water')
  }

  // Force entry corridor: first room center → x=1
  const first = rooms[0]
  const fCX = first.x + Math.floor(first.w / 2)
  const fCY = first.y + Math.floor(first.h / 2)
  for (let x = 1; x <= fCX; x++) map.setTile(x, fCY, 'water')

  // Force exit corridor: last room center → right edge → bottom-right corner
  const last = rooms[rooms.length - 1]
  const lCX = last.x + Math.floor(last.w / 2)
  const lCY = last.y + Math.floor(last.h / 2)
  for (let x = lCX; x <= W - 2; x++) map.setTile(x, lCY, 'water')
  for (let y = lCY; y <= H - 2; y++) map.setTile(W - 2, y, 'water')

  // Entry: step left from x=1 onto x=0 to return to pond1
  map.setTile(0, fCY, 'pond_exit_left')

  // Exit: down arrow at bottom border → pond3
  map.setTile(W - 2, H - 1, 'pond_exit_down')

  addWaterbodem(map)

  // Water monsters — one per room, cycling through the pond bestiary
  const roomMonsterTypes = ['vis', 'tetra', 'qivuit', 'lorkest', 'squid', 'jormungand']
  const monsters = rooms.map((room, i) => ({
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
    defId: roomMonsterTypes[i % roomMonsterTypes.length],
  }))

  return { player: { x: 1, y: fCY }, monsters, items: [] }
}

export function generatePond3Map(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'void')

  // Right entry shaft: 1 tile wide at top, broadens 1/row to full 8 tiles by y=8
  for (let y = 1; y <= H - 2; y++) {
    const w = Math.min(8, y)
    for (let x = W - 1 - w; x <= W - 2; x++)
      map.setTile(x, y, 'water')
  }

  // Organic tunnel: bottom of shaft (70,15) → top-center of bell (12,4)
  {
    const rng = seededRng(103)
    const x0 = 70, y0 = 15, x1 = 12, y1 = 4
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy)
    const perpX = -dy / len
    const perpY =  dx / len
    const STEPS = 120
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const meander = Math.sin(t * Math.PI * 4) * 2.8
      const cx = Math.round(x0 + dx * t + perpX * meander)
      const cy = Math.round(y0 + dy * t + perpY * meander)
      const r = 1.2 + rng() * 0.9
      for (let oy = -2; oy <= 2; oy++)
        for (let ox = -2; ox <= 2; ox++)
          if (ox * ox + oy * oy <= r * r) {
            const tx = cx + ox, ty = cy + oy
            if (tx >= 1 && tx < W - 1 && ty >= 1 && ty < H - 1)
              map.setTile(tx, ty, 'water')
          }
    }
  }

  // Bell chamber: narrow top at y=4 (x=6-20), expands to broad flat bottom at y=13-17
  for (let y = 4; y <= H - 3; y++) {
    let leftX: number, rightX: number
    if (y <= 13) {
      leftX = Math.max(3, 6 - Math.round((y - 4) * 3 / 9))
      rightX = Math.min(W - 2, 20 + Math.round((y - 4) * 34 / 9))
    } else {
      leftX = 3
      rightX = 54
    }
    for (let x = leftX; x <= rightX; x++)
      map.setTile(x, y, 'water')
  }

  // Top border at shaft x — only exit/entry point
  map.setTile(W - 2, 0, 'pond_exit_up')

  addWaterbodem(map)

  return {
    player: { x: 78, y: 1 },
    monsters: [
      { x: 10, y:  6, defId: 'vis'        },
      { x: 14, y:  8, defId: 'tetra'      },
      { x: 35, y: 15, defId: 'vis'        },
      { x: 30, y: 10, defId: 'qivuit'     },
      { x: 45, y: 12, defId: 'lorkest'    },
      { x: 20, y: 15, defId: 'squid'      },
      { x: 50, y: 16, defId: 'tetra'      },
    ],
    items: [{ defId: 'gong', x: 6, y: 15 }],
  }
}

export function generateDrivewayMap(map: MapSystem): SpawnPoints {
  const W = map.width
  const H = map.height

  // Base fill: outdoor pavement everywhere, then carve regions on top
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map.setTile(x, y, 'driveway')

  // Garage room (top-left): a self-contained chamber, rows 0-6, cols 0-51 —
  // every side has its own wall and corner, none shared with the hall or driveway.
  for (let y = 1; y <= 5; y++)
    for (let x = 1; x <= 50; x++)
      map.setTile(x, y, 'floor')
  for (let x = 0; x <= 50; x++) map.setTile(x, 0, 'driveway_exit_garage')
  for (let y = 1; y <= 5; y++) map.setTile(0, y, 'muur_left_t')
  for (let y = 1; y <= 5; y++) map.setTile(51, y, 'muur_right_t')
  for (let x = 1; x <= 50; x++) map.setTile(x, 6, 'muur_down_t')
  map.setTile(0, 6, 'muur_corner_bl_t')
  map.setTile(51, 6, 'muur_corner_br_t')
  map.setTile(20, 6, 'floor')

  // Hall room (top-right): a self-contained chamber, rows 0-12, cols 52-79 —
  // its own left wall and corner, one tile clear of the garage/driveway side.
  for (let y = 1; y <= 11; y++)
    for (let x = 53; x <= 78; x++)
      map.setTile(x, y, 'floor')
  for (let x = 51; x <= 79; x++) map.setTile(x, 0, 'driveway_exit_hall')
  for (let y = 1; y <= 11; y++) map.setTile(79, y, 'driveway_exit_hall')

  // Hall's own left wall, with a closed door
  for (let y = 1; y <= 11; y++) map.setTile(52, y, 'muur_left_t')
  map.setTile(52, 9, 'door_closed')

  // Driveway (bottom-left, main open area): rows 7-18, cols 1-50
  for (let y = 7; y <= 18; y++)
    for (let x = 1; x <= 50; x++)
      map.setTile(x, y, 'driveway')
  // Left and bottom borders of the driveway are mountain, not a built wall
  for (let y = 7; y <= 19; y++) map.setTile(0, y, 'berg')
  for (let x = 0; x <= 50; x++) map.setTile(x, 19, 'berg')

  // Divider between hall and the wooded/balcony grounds (row 12) — a solid
  // wall the whole way across; the balcony's own entrance arrows sit one
  // row further down (row 13), inside its own enclosed room.
  for (let x = 51; x <= 79; x++) map.setTile(x, 12, 'muur_down_t')
  map.setTile(52, 12, 'muur_corner_bl_t')
  map.setTile(51, 12, 'driveway')

  // Wooded ground west of the balcony — rows 13-15, cols 51-63 — filled with
  // trees (rendered on a grass background)
  for (let y = 13; y <= 15; y++)
    for (let x = 51; x <= 63; x++)
      map.setTile(x, y, 'tree')

  // Balcony room (east of the wooded ground): entrance arrows one row below
  // the divider, floor below that, fully enclosed by walls on every side.
  for (let x = 65; x <= 79; x++) map.setTile(x, 13, 'driveway_exit_balcony')
  for (let x = 65; x <= 79; x++) map.setTile(x, 14, 'floor')
  map.setTile(64, 13, 'muur_corner_tl_t')
  map.setTile(64, 14, 'muur_left_t')
  map.setTile(64, 15, 'muur_corner_bl_t')
  map.setTile(79, 13, 'muur_corner_tr_t')
  map.setTile(79, 14, 'muur_right_t')
  for (let x = 65; x <= 78; x++) map.setTile(x, 15, 'muur_down_t')
  map.setTile(79, 15, 'muur_corner_br_t')

  // Remaining grounds south of the wooded strip/balcony, filled with trees
  for (let y = 16; y <= 19; y++)
    for (let x = 51; x <= 79; x++)
      map.setTile(x, y, 'tree')

  // Entire map is visible on arrival — no fog of war here
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      map.markExplored(x, y)
      map.setVisible(x, y, true)
    }
  }

  const player = { x: 25, y: 12 }
  const monsters = [
    { x: 12, y: 10, defId: 'lex' },
    { x: 15, y: 10, defId: 'sas' },
  ]
  // No random item scatter on the driveway
  return { player, monsters, items: [] }
}

export function mutateChaosMap(map: MapSystem, playerX: number, playerY: number): void {
  const W = map.width
  const H = map.height
  const total = W * H
  const count = Math.floor(total / 3)
  for (let i = 0; i < count; i++) {
    const tx = Math.floor(Math.random() * W)
    const ty = Math.floor(Math.random() * H)
    if (tx === playerX && ty === playerY) continue
    if (inChaosPartyArea(W, H, tx, ty)) continue
    const id = map.getTile(tx, ty)?.defId
    if (id === 'portal_chaos' || id === 'chaos_exit_upper_hall') continue
    map.setTile(tx, ty, CHAOS_TILES[Math.floor(Math.random() * CHAOS_TILES.length)])
  }
}
