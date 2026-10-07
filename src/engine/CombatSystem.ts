import type { MessageLog } from './MessageLog'
import type { Player } from '../entities/Player'
import type { Monster } from '../entities/Monster'

export interface CombatResult {
  hit: boolean
  damage: number
  killed: boolean
}

function roll(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}

function clampPct(pct: number): number {
  return Math.min(95, Math.max(5, pct))
}

// Chance (0-100) for the player to hit a monster, melee or thrown.
// monster.ac is ascending (higher = tougher to hit)
export function playerHitChance(player: Player, monster: Monster): number {
  return clampPct(45 + player.str / 10 + player.luck / 10 + player.level * 2 - 3 * monster.ac)
}

export class CombatSystem {
  constructor(private log: MessageLog) {}

  playerAttacks(player: Player, monster: Monster): CombatResult {
    const hitChance = playerHitChance(player, monster)

    if (Math.random() * 100 >= hitChance) {
      this.log.add(`You miss the ${monster.name}.`, '#a0a0a0')
      return { hit: false, damage: 0, killed: false }
    }

    // combat prowess from stats scales in with level — a level 1 hero can't lean on raw stats yet
    const levelFactor = 0.5 + player.level * 0.1
    const weaponDamage = player.getWeaponDamage()
    let damage = Math.max(1, Math.round((player.str / 10 + player.luck / 30) * levelFactor + roll(weaponDamage)))
    if (monster.defId === 'werewolf' && player.equipment.weapon?.defId === 'silversword') {
      damage = Math.max(damage, monster.hp)
      this.log.add(`The silver blade sears the ${monster.name}!`, '#e0e0ff')
    }
    monster.hp -= damage
    this.log.add(`You hit the ${monster.name} for ${damage} damage.`, '#ffff00')

    if (monster.hp <= 0) {
      this.log.add(`You kill the ${monster.name}!`, '#ff8000')
      player.gainXP(monster.xpValue)
      return { hit: true, damage, killed: true }
    }

    return { hit: true, damage, killed: false }
  }

  monsterAttacks(monster: Monster, player: Player): CombatResult {
    if (player.invulnerableTurns > 0) {
      this.log.add(`The ${monster.name}'s attack has no effect on you!`, '#ffff80')
      return { hit: false, damage: 0, killed: false }
    }

    // player.getAC() is descending (lower = more protection, 10 = unarmored)
    const hitChance = clampPct(50 + monster.str / 7 + (player.getAC() - 10))

    if (Math.random() * 100 >= hitChance) {
      this.log.add(`The ${monster.name} misses you.`, '#a0a0a0')
      return { hit: false, damage: 0, killed: false }
    }

    const factor = 1 + Math.random() * 0.5 // 1.00-1.50
    const damageBase = roll(monster.str) + Math.ceil(monster.str / 2)
    const damage = Math.max(1, Math.round(damageBase - (10 - player.getAC()) * factor))
    player.hp -= damage
    this.log.add(`The ${monster.name} hits you for ${damage} damage.`, '#ff4040')
    // Werewolf bites carry the curse silently — only the self screen reveals it
    if (monster.defId === 'werewolf' && !player.lycanthropy && Math.random() < 0.2) {
      player.lycanthropy = true
      player.lycanthropyCountdown = 100
    }

    if (player.hp <= 0) {
      this.log.add('You have been slain!', '#ff0000')
      return { hit: true, damage, killed: true }
    }

    return { hit: true, damage, killed: false }
  }
}
