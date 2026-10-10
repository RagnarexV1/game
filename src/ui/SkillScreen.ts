import Phaser from 'phaser'
import type { Player } from '../entities/Player'
import type { InventorySystem } from '../engine/InventorySystem'
import { MIX_RECIPES } from '../data/mixRecipes'
import { GAME_W, GAME_H } from './Layout'

const TEXT_COLOR   = '#d0c8b8'
const HEADER_COLOR = '#00ff80'
const LOCKED_COLOR = '#606060'
const FONT   = 'monospace'
const LINE_H = 28

interface SkillEntry {
  id: string
  label: string
  icon: string // stand-in glyph until dedicated icon sprites exist
  active?: boolean // clicking uses the skill immediately instead of opening a detail view
}

export const SKILL_LIST: SkillEntry[] = [
  { id: 'mixing', label: 'Alchemy', icon: '⚗' },
  { id: 'ventriloquism', label: 'Ventriloquism', icon: '♪', active: true },
  { id: 'clothespin_trap', label: 'Clothespin Trap', icon: '*', active: true },
  { id: 'cartography', label: 'Cartography', icon: '#', active: true },
  { id: 'relocation', label: 'Relocation', icon: '~', active: true },
  { id: 'music', label: 'Music', icon: '♫' },
]

// Instruments the Music skill can play
const INSTRUMENTS = ['clarinet']

export class SkillScreen {
  private container: Phaser.GameObjects.Container | null = null
  private view: 'list' | 'detail' | 'instruments' = 'list'
  private player: Player | null = null

  onActivate: ((skillId: string) => void) | null = null
  // Recipes that can no longer be mixed (e.g. Second Life once made) are left off the list
  isRecipeUsedUp: (resultId: string) => boolean = () => false

  constructor(private scene: Phaser.Scene, private invSys: InventorySystem) {}

  isVisible(): boolean { return this.container !== null }

  show(player: Player): void {
    if (this.container) { this.hide(); return }
    this.player = player
    this.view = 'list'
    this.render()
  }

  hide(): void {
    this.container?.destroy()
    this.container = null
    this.player = null
  }

  private render(): void {
    this.container?.destroy()
    const scene = this.scene
    const c = scene.add.container(0, 0)
    c.setDepth(1000)

    const bg = scene.add.graphics()
    bg.fillStyle(0x000000, 0.92)
    bg.fillRect(0, 0, GAME_W, GAME_H)
    bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_W, GAME_H), Phaser.Geom.Rectangle.Contains)
    bg.on('pointerdown', () => this.back())
    c.add(bg)

    if (this.view === 'list') this.renderList(c)
    else if (this.view === 'instruments') this.renderInstruments(c)
    else this.renderDetail(c)

    this.container = c
  }

  private back(): void {
    if (this.view !== 'list') {
      this.view = 'list'
      this.render()
    } else {
      this.hide()
    }
  }

  private renderList(c: Phaser.GameObjects.Container): void {
    const scene = this.scene
    const player = this.player!

    const header = scene.add.text(GAME_W / 2, 60, 'SKILLS', {
      fontSize: '32px', color: HEADER_COLOR, fontFamily: FONT, fontStyle: 'bold',
    }).setOrigin(0.5, 0)
    c.add(header)

    const startY = 140
    const learned = SKILL_LIST.filter(skill => player.hasSkill(skill.id))
    if (learned.length === 0) {
      c.add(scene.add.text(GAME_W / 2, startY, 'none', {
        fontSize: '20px', color: LOCKED_COLOR, fontFamily: FONT,
      }).setOrigin(0.5, 0))
    }
    learned.forEach((skill, i) => {
      const y = startY + i * (LINE_H + 12)
      const color = TEXT_COLOR

      const row = scene.add.container(GAME_W / 2 - 220, y)

      const icon = scene.add.text(0, 0, skill.icon, {
        fontSize: '22px', color, fontFamily: FONT,
      })
      const label = scene.add.text(40, 0, skill.label, {
        fontSize: '20px', color, fontFamily: FONT,
      })
      row.add([icon, label])

      const hit = scene.add.zone(0, 0, 440, LINE_H)
        .setOrigin(0, 0).setInteractive()
      hit.on('pointerover', () => label.setColor('#ffff40'))
      hit.on('pointerout',  () => label.setColor(color))
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer, lx: number, ly: number, event: { stopPropagation: () => void }) => {
        event.stopPropagation()
        if (skill.active) {
          this.hide()
          this.onActivate?.(skill.id)
          return
        }
        this.view = skill.id === 'music' ? 'instruments' : 'detail'
        this.render()
      })
      row.add(hit)

      c.add(row)
    })

    const footer = scene.add.text(GAME_W / 2, GAME_H - 40, 'Click a skill to view it   •   Click background to close', {
      fontSize: '14px', color: LOCKED_COLOR, fontFamily: FONT,
    }).setOrigin(0.5, 0)
    c.add(footer)
  }

  // Music: pick an instrument to play (only the clarinet exists)
  private renderInstruments(c: Phaser.GameObjects.Container): void {
    const scene = this.scene
    const player = this.player!

    c.add(scene.add.text(GAME_W / 2, 60, 'MUSIC', {
      fontSize: '32px', color: HEADER_COLOR, fontFamily: FONT, fontStyle: 'bold',
    }).setOrigin(0.5, 0))
    c.add(scene.add.text(GAME_W / 2, 108, 'Instruments', {
      fontSize: '16px', color: LOCKED_COLOR, fontFamily: FONT,
    }).setOrigin(0.5, 0))

    const startY = 160
    const instruments = INSTRUMENTS.filter(id => player.inventory.some(it => it.defId === id))
    if (instruments.length === 0) {
      c.add(scene.add.text(GAME_W / 2, startY, '(you do not have an instrument)', {
        fontSize: '16px', color: LOCKED_COLOR, fontFamily: FONT,
      }).setOrigin(0.5, 0))
    }
    instruments.forEach((id, i) => {
      const y = startY + i * (LINE_H + 12)
      const label = scene.add.text(GAME_W / 2 - 180, y, this.invSys.getDef(id)?.name ?? id, {
        fontSize: '20px', color: TEXT_COLOR, fontFamily: FONT,
      })
      c.add(label)
      const hit = scene.add.zone(GAME_W / 2 - 220, y, 440, LINE_H).setOrigin(0, 0).setInteractive()
      hit.on('pointerover', () => label.setColor('#ffff40'))
      hit.on('pointerout',  () => label.setColor(TEXT_COLOR))
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer, lx: number, ly: number, event: { stopPropagation: () => void }) => {
        event.stopPropagation()
        this.hide()
        this.onActivate?.('music')
      })
      c.add(hit)
    })

    c.add(scene.add.text(GAME_W / 2, GAME_H - 40, 'Click an instrument to play it   •   Click background to go back', {
      fontSize: '14px', color: LOCKED_COLOR, fontFamily: FONT,
    }).setOrigin(0.5, 0))
  }

  private renderDetail(c: Phaser.GameObjects.Container): void {
    const scene = this.scene

    const header = scene.add.text(GAME_W / 2, 60, 'ALCHEMY', {
      fontSize: '32px', color: HEADER_COLOR, fontFamily: FONT, fontStyle: 'bold',
    }).setOrigin(0.5, 0)
    c.add(header)

    const subheader = scene.add.text(GAME_W / 2, 108, 'Known combinations', {
      fontSize: '16px', color: LOCKED_COLOR, fontFamily: FONT,
    }).setOrigin(0.5, 0)
    c.add(subheader)

    const startY = 160
    const colAX   = GAME_W / 2 - 420
    const colOpX  = GAME_W / 2 - 120
    const colBX   = GAME_W / 2 - 80
    const colResX = GAME_W / 2 + 200

    const recipes = MIX_RECIPES.filter(r => !this.isRecipeUsedUp(r.result))
    if (recipes.length === 0) {
      c.add(scene.add.text(GAME_W / 2, startY, '(no known combinations yet)', {
        fontSize: '16px', color: LOCKED_COLOR, fontFamily: FONT,
      }).setOrigin(0.5, 0))
    }

    recipes.forEach((recipe, i) => {
      const y = startY + i * (LINE_H + 14)
      const nameA = this.invSys.getDef(recipe.a)?.name ?? recipe.a
      const nameB = this.invSys.getDef(recipe.b)?.name ?? recipe.b
      const nameR = this.invSys.getDef(recipe.result)?.name ?? recipe.result

      const rowTxt = (x: number, s: string, color: string, align: 0 | 0.5 | 1 = 0) =>
        scene.add.text(x, y, s, { fontSize: '17px', color, fontFamily: FONT }).setOrigin(align, 0)

      c.add(rowTxt(colAX, nameA, TEXT_COLOR, 1))
      c.add(rowTxt(colOpX, '+', LOCKED_COLOR, 0.5))
      c.add(rowTxt(colBX, nameB, TEXT_COLOR))
      c.add(rowTxt(colResX, `=  ${nameR}`, '#ffd080'))
    })

    const footer = scene.add.text(GAME_W / 2, GAME_H - 40, 'Click background to go back', {
      fontSize: '14px', color: LOCKED_COLOR, fontFamily: FONT,
    }).setOrigin(0.5, 0)
    c.add(footer)
  }
}
