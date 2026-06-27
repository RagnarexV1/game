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
    const end = this.allEntries.length - this.scrollOffset
    const start = Math.max(0, end - this.maxLines)
    const visible = this.allEntries.slice(start, end)
    for (let i = 0; i < this.maxLines; i++) {
      const entry = visible[i]
      if (entry) {
        this.lines[i].setText(entry.text)
        this.lines[i].setColor(this.scrollOffset > 0 ? '#909090' : entry.color)
      } else {
        this.lines[i].setText('')
      }
    }
  }
}
