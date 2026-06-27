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

export class CombatSystem {
  constructor(private log: MessageLog) {}

  playerAttacks(player: Player, monster: Monster): CombatResult {
    const hitRoll = roll(20) + player.str
    const defense = monster.ac

    if (hitRoll < defense + 5) {
      this.log.add(`You miss the ${monster.name}.`, '#a0a0a0')
      return { hit: false, damage: 0, killed: false }
    }

    const weaponDamage = player.getWeaponDamage()
    const damage = Math.max(1, roll(weaponDamage) + Math.floor((player.str - 10) / 2))
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
    const hitRoll = roll(20) + monster.str
    const defense = player.getAC()  // descending: lower = more protection

    if (hitRoll < 20 - defense) {
      this.log.add(`The ${monster.name} misses you.`, '#a0a0a0')
      return { hit: false, damage: 0, killed: false }
    }

    const damage = Math.max(1, roll(monster.str) + Math.floor((monster.str - 10) / 2))
    player.hp -= damage
    this.log.add(`The ${monster.name} hits you for ${damage} damage.`, '#ff4040')

    if (player.hp <= 0) {
      this.log.add('You have been slain!', '#ff0000')
      return { hit: true, damage, killed: true }
    }

    return { hit: true, damage, killed: false }
  }
}
