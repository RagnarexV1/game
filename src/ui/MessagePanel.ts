import Phaser from 'phaser'
import type { LogEntry } from '../engine/MessageLog'

const PAD = 8
const LINE_H = 18

export class MessagePanel {
  private lines: Phaser.GameObjects.Text[] = []
  private maxLines: number
  private allEntries: LogEntry[] = []
  private scrollOffset = 0
  private static readonly MAX_SCROLL = 10

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
  ) {
    this.maxLines = Math.floor((h - PAD * 2) / LINE_H)

    // Background
    const g = scene.add.graphics()
    g.fillStyle(0x080808)
    g.fillRect(x, y, w, h)

    // Pre-create text objects
    for (let i = 0; i < this.maxLines; i++) {
      const t = scene.add.text(x + PAD, y + PAD + i * LINE_H, '', {
        fontSize: '14px',
        color: '#c0c0c0',
        fontFamily: 'monospace',
        wordWrap: { width: w - PAD * 2 },
      })
      this.lines.push(t)
    }
  }

  setEntries(entries: LogEntry[]): void {
    this.allEntries = entries
    this.scrollOffset = 0
    this.render()
  }

  scrollUp(): void {
    const maxOff = Math.min(MessagePanel.MAX_SCROLL, Math.max(0, this.allEntries.length - this.maxLines))
    this.scrollOffset = Math.min(this.scrollOffset + 1, maxOff)
    this.render()
  }

  private render(): void {
    // Walk back from the newest entry, giving long messages as many rows as
    // they wrap to, until the panel is full
    const end = this.allEntries.length - this.scrollOffset
    const visible: Array<{ entry: LogEntry; rows: number }> = []
    let usedRows = 0
    for (let i = end - 1; i >= 0; i--) {
      const entry = this.allEntries[i]
      const rows = Math.max(1, this.lines[0].getWrappedText(entry.text).length)
      if (usedRows + rows > this.maxLines) {
        if (visible.length === 0) visible.unshift({ entry, rows: this.maxLines })
        break
      }
      visible.unshift({ entry, rows })
      usedRows += rows
    }
    let row = 0
    for (let i = 0; i < this.maxLines; i++) {
      const item = visible[i]
      if (item) {
        this.lines[i].setY(this.y + PAD + row * LINE_H)
        this.lines[i].setText(item.entry.text)
        this.lines[i].setColor(this.scrollOffset > 0 ? '#909090' : item.entry.color)
        row += item.rows
      } else {
        this.lines[i].setText('')
      }
    }
  }
}
