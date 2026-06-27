export type ActorCallback = () => void

export interface Actor {
  id: string
  speed: number
  energy: number
  takeTurn(): void
}

export class TurnManager {
  private actors: Actor[] = []
  private turn = 0
  private listeners: Array<(turn: number) => void> = []

  getTurn(): number {
    return this.turn
  }

  addActor(actor: Actor): void {
    this.actors.push(actor)
  }

  removeActor(id: string): void {
    this.actors = this.actors.filter(a => a.id !== id)
  }

  hasActor(id: string): boolean {
    return this.actors.some(a => a.id === id)
  }

  // Called once player has taken their action
  processTurn(): void {
    this.turn++
    // Give energy to all actors
    for (const actor of this.actors) {
      actor.energy += actor.speed
    }
    // Let all non-player actors act when they have enough energy
    for (const actor of this.actors) {
      if (actor.id === 'player') continue
      while (actor.energy >= 100) {
        actor.energy -= 100
        actor.takeTurn()
      }
    }
    this.notify()
  }

  // Process player's energy
  spendPlayerEnergy(cost = 100): void {
    const player = this.actors.find(a => a.id === 'player')
    if (player) player.energy -= cost
  }

  onTurn(fn: (turn: number) => void): void {
    this.listeners.push(fn)
  }

  private notify(): void {
    this.listeners.forEach(fn => fn(this.turn))
  }

  setTurn(n: number): void {
    this.turn = n
  }

  reset(): void {
    this.actors = []
    this.turn = 0
  }
}
