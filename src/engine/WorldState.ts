import { rollRunSeed, setRunSeed, forestCellTier } from './SpawnTables'

export interface CellSnapshot {
  tiles: Array<{ defId: string; explored: boolean }>
  monsters: Array<{ defId: string; x: number; y: number; hp: number; message?: string; hasSpoken: boolean; stunTurns: number }>
  items: Array<{ x: number; y: number; defId: string; qty: number; charges?: number }>
}

export interface RelicSite {
  area: string
  cx?: number
  cy?: number
}

export interface ClarinetLocation {
  area: string | null
  cx?: number
  cy?: number
  ucx?: number
  ucy?: number
  x: number
  y: number
}

// Named areas eligible to host a randomly-placed relic (or the clarinet's grid).
// Excludes bathroom, loft ("Peter and the Wolf"), the pond levels, and the tub
// enclosure (cellar), whose only special item is the second life potion.
const RELIC_AREAS = [
  'forest', 'garage_top', 'garage_bottom', 'hall',
  'chaos', 'bedroom', 'bedroom_lower', 'kitchen', 'study',
]

// Rolled once per game: the blue vase lands in one of these, each stamp on any
// indoor map except the loft, pantry and tub enclosure (cellar). 'garage' picks
// the top or bottom level; 'forest' picks a tier-3 garden cell; 'hall' a random hall cell.
const VASE_AREAS = ['garage', 'forest', 'kitchen', 'hall']
const STAMP_AREAS = [
  'bathroom_top', 'bathroom_bottom', 'garage_top', 'garage_bottom',
  'hall', 'bedroom', 'bedroom_lower', 'kitchen', 'study',
]

// Empty vials spread over these maps, on top of the study's and kitchen's own (~15 in total).
const VIAL_AREAS = [
  'forest', 'garage', 'bathroom', 'hall', 'bedroom', 'bedroom_lower',
  'loft', 'loft3', 'chaos', 'upper_hall_left', 'upper_hall_right', 'driveway',
]
const VIAL_SITES = 8

export const TURN_LIMIT = 20000

// Tier 2+ maps that can host a Scroll of Transport ('forest' = a tier-3 garden cell).
const TRANSPORT_AREAS = [
  'forest', 'hall', 'study', 'loft', 'tub_enclosure',
  'bedroom', 'bedroom_lower', 'loft3',
]

export class WorldState {
  cx = 0
  cy = 0
  readonly GRID = 3

  ucx = 0
  ucy = 0
  readonly UGRID = 3

  // Rolled once per game so the clarinet lands in a different hall cell each playthrough
  // (kept off the corner cell reserved for relic_scroll_3).
  clarinetCx: number
  clarinetCy: number

  // Rolled once per game so each relic scroll fragment lands somewhere different.
  relicSites: Record<string, RelicSite>

  // Rolled once per game: where the vase, each of Dad's stamps and the mirror shield turn up.
  questSites: Record<string, RelicSite>

  // Rolled once per game: which garden cell Dad (middle row) and Mar (bottom
  // row, only some games) wander in.
  npcSites: Record<string, RelicSite>

  // Rolled once per game; mixed into loot/monster spawn RNGs so each playthrough differs.
  private _runSeed = 0
  get runSeed(): number { return this._runSeed }
  set runSeed(v: number) { this._runSeed = v; setRunSeed(v) }

  constructor() {
    this.runSeed = rollRunSeed()

    do {
      this.clarinetCx = Math.floor(Math.random() * this.UGRID)
      this.clarinetCy = Math.floor(Math.random() * this.UGRID)
    } while (this.clarinetCx === this.UGRID - 1 && this.clarinetCy === this.UGRID - 1)

    this.relicSites = {}
    const pool = [...RELIC_AREAS]
    for (const id of ['relic_scroll_1', 'relic_scroll_2', 'relic_scroll_3']) {
      const idx = Math.floor(Math.random() * pool.length)
      const area = pool.splice(idx, 1)[0]
      const site: RelicSite = { area }
      if (area === 'forest') { site.cx = Math.floor(Math.random() * this.GRID); site.cy = Math.floor(Math.random() * this.GRID) }
      if (area === 'hall') { site.cx = Math.floor(Math.random() * this.UGRID); site.cy = Math.floor(Math.random() * this.UGRID) }
      this.relicSites[id] = site
    }

    this.questSites = {}
    this.questSites['vaas'] = this.rollSite(VASE_AREAS)
    for (const id of ['postzegelRex', 'postzegelStego', 'postzegelStoom'])
      this.questSites[id] = this.rollSite(STAMP_AREAS)
    this.questSites['mirrorshield'] = this.rollSite(['hall'])
    // Toilet brush: always one in the bathroom, sometimes a second in the hall.
    // Keys may carry an '@suffix' so one item can have several sites.
    this.questSites['toiletBrush'] = this.rollSite(['bathroom'])
    if (Math.random() < 0.5) this.questSites['toiletBrush@hall'] = this.rollSite(['hall'])
    this.questSites['helm_knowledge'] = this.rollSite(['chaos', 'bathroom', 'bedroom', 'study'])
    // The Gompie always lies in the lower garage; now and then a second one upstairs.
    if (Math.random() < 0.2) this.questSites['gompie@garage'] = { area: 'garage_top' }
    // Empty vials: the study and kitchen hold their own (7), the rest are spread around.
    for (let i = 0; i < VIAL_SITES; i++) this.questSites[`empty_vial@${i}`] = this.rollSite(VIAL_AREAS)
    // Scroll of Transport: rare — once per game, sometimes twice, never on a tier-1 map.
    const transportAreas = [...TRANSPORT_AREAS]
    const transportCount = Math.random() < 0.3 ? 2 : 1
    for (let i = 0; i < transportCount; i++) {
      const area = transportAreas.splice(Math.floor(Math.random() * transportAreas.length), 1)[0]
      this.questSites[`scroll_transport@${i}`] = this.rollSite([area])
    }

    this.npcSites = {}
    this.npcSites['pap2'] = { area: 'forest', cx: Math.floor(Math.random() * this.GRID), cy: 1 }
    if (Math.random() < 0.5) this.npcSites['mar'] = { area: 'forest', cx: Math.floor(Math.random() * this.GRID), cy: this.GRID - 1 }
  }

  private rollSite(areas: string[]): RelicSite {
    let area = areas[Math.floor(Math.random() * areas.length)]
    if (area === 'garage') area = Math.random() < 0.5 ? 'garage_top' : 'garage_bottom'
    if (area === 'bathroom') area = Math.random() < 0.5 ? 'bathroom_top' : 'bathroom_bottom'
    const site: RelicSite = { area }
    if (area === 'forest') {
      const cells: Array<[number, number]> = []
      for (let cy = 0; cy < this.GRID; cy++)
        for (let cx = 0; cx < this.GRID; cx++)
          if (forestCellTier(cx, cy) === 3) cells.push([cx, cy])
      ;[site.cx, site.cy] = cells[Math.floor(Math.random() * cells.length)]
    }
    if (area === 'hall') { site.cx = Math.floor(Math.random() * this.UGRID); site.cy = Math.floor(Math.random() * this.UGRID) }
    return site
  }

  // NPCs rolled to this area/cell, if any.
  npcsFor(area: string, cx?: number, cy?: number): string[] {
    return Object.entries(this.npcSites)
      .filter(([, site]) => site.area === area && (site.cx === undefined || (site.cx === cx && site.cy === cy)))
      .map(([id]) => id)
  }

  // Quest items (vase, stamps, …) rolled to this area/cell, if any.
  questItemsFor(area: string, cx?: number, cy?: number): string[] {
    return Object.entries(this.questSites)
      .filter(([, site]) => site.area === area && (site.cx === undefined || (site.cx === cx && site.cy === cy)))
      .map(([key]) => key.split('@')[0])
  }

  // Which relic (if any) belongs in this area/cell, or null.
  relicIdFor(area: string, cx?: number, cy?: number): string | null {
    for (const [id, site] of Object.entries(this.relicSites)) {
      if (site.area !== area) continue
      if (site.cx !== undefined && (site.cx !== cx || site.cy !== cy)) continue
      return id
    }
    return null
  }

  hallExplored = new Map<string, boolean[]>()
  cellSnapshots = new Map<string, CellSnapshot>()
  extinctRaces = new Set<string>()
  // Map-edge arrows the player dug/tunnelled out, keyed "<mapKey>:<x>,<y>"
  dugExits = new Set<string>()

  currentArea: string | null = null
  savedCx = 0
  savedCy = 0
  savedPlayerX = 0
  savedPlayerY = 0
  bathroomFloodTiles: Array<{ x: number; y: number }> = []
  // Where the player last played the clarinet with the Music skill; playing it
  // again warps back there and overwrites this with the new spot.
  clarinetLocation: ClarinetLocation | null = null
  mamHasOrange = false
  mamHasVase   = false
  widgetFound  = false
  peterWarned  = false
  horseDead    = false
  // Quest items handed over so far (Dad wants all 3 stamps, Mar all 3 fragments)
  stampsGiven    = 0
  fragmentsGiven = 0
  // The Second Life potion can be mixed only once per game
  secondLifeMixed = false

  // The game should be finished within TURN_LIMIT turns; distracting Lex adds bonus turns.
  bonusTurns = 0
  get turnLimit(): number { return TURN_LIMIT + this.bonusTurns }

  hasRight() { return this.cx < this.GRID - 1 }
  hasLeft()  { return this.cx > 0 }
  hasDown()  { return this.cy < this.GRID - 1 }
  hasUp()    { return this.cy > 0 }

  go(dx: number, dy: number): void {
    this.cx = Math.max(0, Math.min(this.GRID - 1, this.cx + dx))
    this.cy = Math.max(0, Math.min(this.GRID - 1, this.cy + dy))
  }

  goHall(dx: number, dy: number): void {
    this.ucx = Math.max(0, Math.min(this.UGRID - 1, this.ucx + dx))
    this.ucy = Math.max(0, Math.min(this.UGRID - 1, this.ucy + dy))
  }

  enterArea(area: string): void {
    this.savedCx = this.cx
    this.savedCy = this.cy
    this.currentArea = area
  }

  exitArea(): void {
    this.cx = this.savedCx
    this.cy = this.savedCy
    this.currentArea = null
  }

  get seed(): number {
    return this.cy * 7 + this.cx * 31 + 100
  }

  get hallSeed(): number {
    return this.ucy * 53 + this.ucx * 97 + 2000
  }
}
