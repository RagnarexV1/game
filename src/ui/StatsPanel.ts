import Phaser from 'phaser'
import type { Player } from '../entities/Player'
import { COLORS } from './Layout'

const PAD = 10
const LINE_H = 26
const LABEL_X = 14
const VALUE_X = 160

export class StatsPanel {
  private scene: Phaser.Scene
  private x: number
  private y: number
  private w: number
  private h: number

  private graphics: Phaser.GameObjects.Graphics
  private texts: Map<string, Phaser.GameObjects.Text> = new Map()
  private bars: Map<string, Phaser.GameObjects.Graphics> = new Map()

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
    this.scene = scene
    this.x = x
    this.y = y
    this.w = w
    this.h = h

    this.graphics = scene.add.graphics()
    this.createLayout()
  }

  private createLayout(): void {
    const { x, y, w, h } = this

    // Grey background matching button panel
    this.graphics.fillStyle(0xAAAAAA)
    this.graphics.fillRect(x, y, w, h)

    // Realm name header
    this.makeText('realm', x + PAD, y + PAD, "Tuin", '#004020', '18px')

    const rows = [
      'turn', 'hp', 'str', 'mag', 'food', 'exp', 'con', 'luck', 'ac', 'gold',
    ]
    const labels: Record<string, string> = {
      turn: 'TURN', hp: 'HP', str: 'STR', mag: 'MAG', food: 'FOOD',
      exp: 'EXP', con: 'CON', luck: 'LUCK', ac: 'AC', gold: 'CENTS',
    }

    rows.forEach((key, i) => {
      const ry = y + 46 + i * LINE_H
      this.makeText(`lbl_${key}`, x + LABEL_X, ry, labels[key], '#404040', '16px')
      this.makeText(`val_${key}`, x + VALUE_X, ry, '', '#101010', '16px')
    })

    // HP bar background
    const barG = this.scene.add.graphics()
    barG.fillStyle(0x880000)
    barG.fillRect(x + PAD, y + 46 + LINE_H + 14, w - PAD * 2, 8)
    this.bars.set('hp_bg', barG)

    const hpBar = this.scene.add.graphics()
    this.bars.set('hp_bar', hpBar)

    // Food bar background
    const foodBg = this.scene.add.graphics()
    foodBg.fillStyle(0x003060)
    foodBg.fillRect(x + PAD, y + 46 + 4 * LINE_H + 14, w - PAD * 2, 8)
    this.bars.set('food_bg', foodBg)

    const foodBar = this.scene.add.graphics()
    this.bars.set('food_bar', foodBar)

    // Divider under realm name
    const div = this.scene.add.graphics()
    div.lineStyle(1, 0x707070)
    div.lineBetween(x + PAD, y + 42, x + w - PAD, y + 42)
  }

  private makeText(key: string, x: number, y: number, text: string, color: string, size: string): void {
    const t = this.scene.add.text(x, y, text, {
      fontSize: size,
      color,
      fontFamily: 'monospace',
    })
    this.texts.set(key, t)
  }

  setRealm(name: string): void {
    this.texts.get('realm')?.setText(name)
  }

  update(player: Player, turn: number): void {
    const { x, y, w } = this

    const vals: Record<string, string> = {
      turn: String(turn),
      hp: `${player.hp}(${player.maxHp})`,
      str: player.str.toFixed(2),
      mag: `${player.mag}(${player.mag})`,
      food: '',
      exp: String(player.exp),
      con: String(player.con),
      luck: String(player.luck),
      ac: String(player.getAC()),
      gold: String(player.gold),
    }

    for (const [key, val] of Object.entries(vals)) {
      this.texts.get(`val_${key}`)?.setText(val)
    }

    // HP bar
    const hpRatio = Math.max(0, player.hp / player.maxHp)
    const barW = this.w - PAD * 2
    const barColor = hpRatio < 0.25 ? 0xc00000 : 0x00c000
    const hpBar = this.bars.get('hp_bar')!
    hpBar.clear()
    hpBar.fillStyle(barColor)
    hpBar.fillRect(x + PAD, y + 46 + LINE_H + 14, Math.floor(barW * hpRatio), 8)

    // Food bar
    const foodRatio = Math.max(0, player.food / player.maxFood)
    const foodBar = this.bars.get('food_bar')!
    foodBar.clear()
    foodBar.fillStyle(0x0070b0)
    foodBar.fillRect(x + PAD, y + 46 + 4 * LINE_H + 14, Math.floor(barW * foodRatio), 8)
  }
}
