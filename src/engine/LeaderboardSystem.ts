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
  // Saves only the top MAX_ENTRIES, but returns the full sorted list so a
  // low-scoring new entry can still be shown with its rank.
  addEntry(entry: LeaderboardEntry): LeaderboardEntry[] {
    const entries = this.getEntries()
    entries.push(entry)
    entries.sort((a, b) => b.score - a.score)
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
    } catch {
      // ignore storage errors
    }
    return entries
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
