import type { MonsterDef, ItemInstance } from '../types'
import type { MapSystem } from '../engine/MapSystem'
import type { Player } from './Player'

export class Monster {
  readonly id: string
  defId: string
  name: string
  glyph: string
  color: string
  maxHp: number
  str: number
  ac: number
  speed: number
  xpValue: number
  aiType: 'wander' | 'chase' | 'water_wander' | 'water_chase' | 'friendly' | 'kamikaze' | 'follow' | 'guard' | 'static' | 'split' | 'flee_on_touch'
  readonly npc: boolean

  x: number
  y: number
  energy = 0

  message?: string
  hasSpoken = false
  stunTurns = 0
  confuseTurns = 0
  // Wizards: turns until the next spell; Summoners: turns until the next summon
  spellCooldown = 0
  summonedBy?: string
  onSplit?: (monster: Monster) => void
  onAfterMove?: (fromX: number, fromY: number) => void
  // Closed loop of tiles the monster runs around instead of following its AI (Peter)
  patrolPath?: Array<{ x: number; y: number }>
  // Runs before the regular AI; returning true means the turn has been used (Lex going for a fish)
  turnOverride?: () => boolean
  // Lex: busy with the juicy fish on his tile, which he finishes once his distraction wears off
  eatingFish = false
  // Woodlouse: rolled up into an armoured ball after moving, which nothing can hurt
  rolled = false
  // Sorcerer: the wand he zaps at the player instead of hitting, dropped when he dies
  wand?: ItemInstance

  private _hp = 0
  get hp(): number { return this._hp }
  set hp(value: number) {
    if (this.rolled && value < this._hp) return
    this._hp = value
  }

  private map!: MapSystem
  private player!: Player
  private getMonsterAt!: (x: number, y: number) => Monster | null
  private onAttackPlayer!: (monster: Monster) => void

  constructor(def: MonsterDef, x: number, y: number) {
    this.id = `monster_${def.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`
    this.defId = def.id
    this.name = def.name
    this.glyph = def.glyph
    this.color = def.color
    this.hp = def.hp
    this.maxHp = def.maxHp
    this.str = def.str
    this.ac = def.ac
    this.speed = def.speed
    this.xpValue = def.xpValue
    this.aiType = def.aiType
    this.npc = def.npc ?? false
    this.x = x
    this.y = y
  }

  setContext(
    map: MapSystem,
    player: Player,
    getMonsterAt: (x: number, y: number) => Monster | null,
    onAttackPlayer: (monster: Monster) => void,
  ): void {
    this.map = map
    this.player = player
    this.getMonsterAt = getMonsterAt
    this.onAttackPlayer = onAttackPlayer
  }

  takeTurn(): void {
    if (!this.map || !this.player) return
    if (!this.isAlive()) return
    this.rolled = false
    if (this.stunTurns > 0) { this.stunTurns--; return }

    if (this.patrolPath) { this.patrol(this.patrolPath); return }
    if (this.turnOverride?.()) return

    if (this.confuseTurns > 0) {
      this.confuseTurns--
      if (this.aiType === 'water_chase') this.wanderOnWater()
      else this.wander()
      return
    }

    const dx = this.player.x - this.x
    const dy = this.player.y - this.y
    const dist = Math.abs(dx) + Math.abs(dy)

    if (this.defId === 'paard' && this.aiType !== 'follow') {
      const tx = this.player.x
      const target = this.map.getTile(tx, this.y)?.defId
      if (tx !== this.x && this.map.isWalkable(tx, this.y) && this.getMonsterAt(tx, this.y) === null &&
          !(target && Monster.isTransitionTile(target))) {
        this.moveTo(tx, this.y)
      }
      return
    }

    if (this.player.allianceTurns > 0 &&
        (this.aiType === 'chase' || this.aiType === 'water_chase' || this.aiType === 'guard' ||
         this.aiType === 'kamikaze' || this.aiType === 'split')) {
      if (this.aiType === 'water_chase') this.wanderOnWater()
      else this.wander()
      return
    }

    if (this.aiType === 'water_wander') {
      this.wanderOnWater()
    } else if (this.aiType === 'water_chase') {
      if (dist <= 14) this.chasePlayerOnWater(dx, dy)
      else this.wanderOnWater()
    } else if (this.aiType === 'follow') {
      this.followPlayer(dx, dy, this.defId === 'paard' ? 2 : 3)
    } else if (this.aiType === 'friendly') {
      // Sas comes straight for the player instead of drifting about
      if (this.defId === 'sas') this.followPlayer(dx, dy, 1)
      else this.wander()
    } else if (this.aiType === 'kamikaze') {
      this.kamikazeAttack(dx, dy)
    } else if (this.aiType === 'chase' && dist <= 10) {
      this.chasePlayer(dx, dy)
    } else if (this.aiType === 'guard') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) this.chasePlayer(dx, dy)
    } else if (this.aiType === 'split') {
      if (this.map.getTile(this.x, this.y)?.visible && Math.random() < 0.35) this.onSplit?.(this)
      this.chasePlayer(dx, dy)
    } else if (this.aiType === 'flee_on_touch') {
      // handled in GameScene.tryMove — idle otherwise
    } else if (this.aiType === 'static') {
      // never moves
    } else {
      this.wander()
    }
  }

  private moveTo(nx: number, ny: number): void {
    const ox = this.x, oy = this.y
    this.x = nx
    this.y = ny
    if (this.defId === 'pissebed') this.rolled = true
    this.onAfterMove?.(ox, oy)
  }

  private chasePlayer(dx: number, dy: number): void {
    const tx = this.x + Math.sign(dx)
    const ty = this.y + Math.sign(dy)

    if (tx === this.player.x && ty === this.player.y) {
      if (this.player.allianceTurns > 0) return
      this.onAttackPlayer(this)
      return
    }

    // Try direct move, then axis-aligned
    const moves: Array<[number, number]> = [
      [tx, ty],
      [this.x + Math.sign(dx), this.y],
      [this.x, this.y + Math.sign(dy)],
    ]

    for (const [nx, ny] of moves) {
      if (nx === this.player.x && ny === this.player.y) {
        this.onAttackPlayer(this)
        return
      }
      if (this.canMoveTo(nx, ny)) {
        this.moveTo(nx, ny)
        return
      }
    }
  }

  private wander(): void {
    const dirs = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ]
    const shuffled = dirs.sort(() => Math.random() - 0.5)
    for (const [dx, dy] of shuffled) {
      const nx = this.x + dx
      const ny = this.y + dy
      if (this.canMoveTo(nx, ny)) {
        this.moveTo(nx, ny)
        return
      }
    }
  }

  private static readonly TRANSITION_TILES = new Set([
    'exit_right', 'exit_left', 'exit_up', 'exit_down',
    'exit_kitchen', 'exit_garage', 'kitchen_exit', 'kitchen_exit_top',
    'exit_bathroom', 'bath_exit_left', 'bath_exit_down', 'bath_exit_up',
    'garage_exit_up', 'garage_exit_down',
    'portal', 'portal_garage', 'portal_hall', 'portal_chaos',
    'portal_bedroom', 'portal_stairs', 'portal_stairs_up', 'portal_tub_enclosure', 'portal_loft', 'portal_loft3', 'portal_study', 'portal_pantry', 'portal_driveway',
    'bedroom_exit', 'bedroom_stairs_down', 'bedroom_stairs_up',
    'stairs_exit_down', 'stairs_exit_up', 'crypt', 'tub_enclosure_exit', 'vortex_portal', 'loft_exit', 'loft_exit_stairs', 'loft3_exit', 'loft3_exit_down', 'study_exit', 'pantry_exit',
    'portal_upper_hall_left', 'portal_upper_hall_right',
    'upper_hall_exit_chaos', 'upper_hall_exit_bathroom', 'upper_hall_exit_study', 'upper_hall_exit_mar',
    'bath_exit_upper_hall', 'chaos_exit_upper_hall', 'study_exit_upper_hall', 'mar_exit_upper_hall',
    'hall_exit_driveway',
  ])

  // Arrows, portals and stairs: monsters never step onto them, so they can't
  // stand in the way of the player using one.
  static isTransitionTile(defId: string): boolean {
    return Monster.TRANSITION_TILES.has(defId) || /exit|portal/.test(defId) ||
      defId === 'stairs_up' || defId === 'stairs_down'
  }

  private canMoveTo(nx: number, ny: number): boolean {
    const defId = this.map.getTile(nx, ny)?.defId
    const klopperPassable = this.defId === 'klopper' && (defId === 'tree' || defId === 'water' || defId === 'water_bath')
    if (!klopperPassable && !this.map.isWalkable(nx, ny)) return false
    if (defId === 'flame') return false
    if (defId && Monster.isTransitionTile(defId)) return false
    if (this.getMonsterAt(nx, ny) !== null) return false
    if (nx === this.player.x && ny === this.player.y) return false
    return true
  }

  private canMoveToWater(nx: number, ny: number): boolean {
    const tile = this.map.getTile(nx, ny)
    if (!tile || tile.defId !== 'water') return false
    if (this.getMonsterAt(nx, ny) !== null) return false
    return true
  }

  private wanderOnWater(): void {
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    const shuffled = dirs.sort(() => Math.random() - 0.5)
    for (const [dx, dy] of shuffled) {
      const nx = this.x + dx
      const ny = this.y + dy
      if (this.canMoveToWater(nx, ny)) {
        this.moveTo(nx, ny)
        return
      }
    }
  }

  private chasePlayerOnWater(dx: number, dy: number): void {
    const tx = this.x + Math.sign(dx)
    const ty = this.y + Math.sign(dy)

    if (tx === this.player.x && ty === this.player.y) {
      if (this.player.allianceTurns > 0) return
      this.onAttackPlayer(this)
      return
    }

    const moves: Array<[number, number]> = [
      [tx, ty],
      [this.x + Math.sign(dx), this.y],
      [this.x, this.y + Math.sign(dy)],
    ]

    for (const [nx, ny] of moves) {
      if (nx === this.player.x && ny === this.player.y) {
        this.onAttackPlayer(this)
        return
      }
      if (this.canMoveToWater(nx, ny)) {
        this.moveTo(nx, ny)
        return
      }
    }
    this.wanderOnWater()
  }

  private followPlayer(dx: number, dy: number, preferredRange = 3): void {
    const chebDist = Math.max(Math.abs(dx), Math.abs(dy))
    if (chebDist <= preferredRange) return  // within preferred range, stay put
    // Too far — close the gap (never attack player)
    const moves: Array<[number, number]> = [
      [this.x + Math.sign(dx), this.y + Math.sign(dy)],
      [this.x + Math.sign(dx), this.y],
      [this.x, this.y + Math.sign(dy)],
    ]
    for (const [nx, ny] of moves) {
      if (nx === this.player.x && ny === this.player.y) continue
      if (this.canMoveTo(nx, ny)) {
        this.moveTo(nx, ny)
        return
      }
    }
  }

  // One step along the loop; waits when the next tile is taken. Off the loop
  // (e.g. displaced by a wand) it heads back to the nearest loop tile first.
  private patrol(path: Array<{ x: number; y: number }>): void {
    const idx = path.findIndex(p => p.x === this.x && p.y === this.y)
    const target = idx !== -1 ? path[(idx + 1) % path.length]
      : path.reduce((a, b) =>
          Math.max(Math.abs(b.x - this.x), Math.abs(b.y - this.y)) <
          Math.max(Math.abs(a.x - this.x), Math.abs(a.y - this.y)) ? b : a)
    const nx = this.x + Math.sign(target.x - this.x)
    const ny = this.y + Math.sign(target.y - this.y)
    if (this.canMoveTo(nx, ny)) this.moveTo(nx, ny)
  }

  /** One step toward (tx, ty), sidestepping along an axis when the direct step is blocked. */
  stepToward(tx: number, ty: number): void {
    const sx = Math.sign(tx - this.x), sy = Math.sign(ty - this.y)
    const moves: Array<[number, number]> = [[this.x + sx, this.y + sy], [this.x + sx, this.y], [this.x, this.y + sy]]
    for (const [nx, ny] of moves) {
      if ((nx !== this.x || ny !== this.y) && this.canMoveTo(nx, ny)) { this.moveTo(nx, ny); return }
    }
  }

  private kamikazeAttack(dx: number, dy: number): void {
    const chebDist = Math.max(Math.abs(dx), Math.abs(dy))
    if (chebDist <= 1) {
      this.onAttackPlayer(this)
      this.hp = 0
    } else {
      this.chasePlayer(dx, dy)
    }
  }

  fleeStep(): void {
    const dx = this.x - this.player.x
    const dy = this.y - this.player.y
    const escDirs: Array<[number, number]> = []
    if (dx !== 0) escDirs.push([Math.sign(dx), 0])
    if (dy !== 0) escDirs.push([0, Math.sign(dy)])
    for (const d of [[0,-1],[0,1],[-1,0],[1,0]] as Array<[number,number]>) {
      if (!escDirs.some(e => e[0] === d[0] && e[1] === d[1])) escDirs.push(d)
    }
    for (const [fdx, fdy] of escDirs) {
      const nx = this.x + fdx
      const ny = this.y + fdy
      if (this.canMoveTo(nx, ny)) { this.moveTo(nx, ny); return }
    }
  }

  isAlive(): boolean {
    return this.hp > 0
  }
}
