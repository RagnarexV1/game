export interface LogEntry {
  text: string
  color: string
  turn: number
}

export class MessageLog {
  private entries: LogEntry[] = []
  private maxEntries = 200
  private listeners: Array<(entries: LogEntry[]) => void> = []
  // Optional rewrite applied to every new message (e.g. hiding names while blind)
  transform: ((text: string) => string) | null = null

  add(text: string, color = '#c0c0c0', turn = 0): void {
    if (this.transform) text = this.transform(text)
    this.entries.push({ text, color, turn })
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
    this.notify()
  }

  getRecent(count = 6): LogEntry[] {
    return this.entries.slice(-count)
  }

  getAll(): LogEntry[] {
    return [...this.entries]
  }

  onChange(fn: (entries: LogEntry[]) => void): void {
    this.listeners.push(fn)
  }

  private notify(): void {
    this.listeners.forEach(fn => fn(this.entries))
  }
}
