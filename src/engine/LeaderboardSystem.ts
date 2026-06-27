const LEADERBOARD_KEY = 'ragnarex_leaderboard'
const MAX_ENTRIES = 100

export interface LeaderboardEntry {
  name: string
  score: number
  level: string
  hp: number
  maxHp: number
  cause?: string
}

export class LeaderboardSystem {
  addEntry(entry: LeaderboardEntry): LeaderboardEntry[] {
    const entries = this.getEntries()
    entries.push(entry)
    entries.sort((a, b) => b.score - a.score)
    const top = entries.slice(0, MAX_ENTRIES)
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(top))
    } catch {
      // ignore storage errors
    }
    return top
  }

  getEntries(): LeaderboardEntry[] {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY)
      if (!raw) return []
      return JSON.parse(raw) as LeaderboardEntry[]
    } catch {
      return []
    }
  }
}
