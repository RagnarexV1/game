import Phaser from 'phaser'
import type { Player } from '../entities/Player'
import type { WorldState } from '../engine/WorldState'
import {
  WORLD_MAP_X, WORLD_MAP_Y, WORLD_MAP_W, WORLD_MAP_H,
} from './Layout'

const FONT = 'monospace'
const BG_COLOR     = 0xAAAAAA
const BORDER_COLOR = 0x505050
const TEXT_COLOR   = '#101010'
const DONE_COLOR   = '#106010'
const DIM_COLOR    = '#404040'

interface QuestIcon { key: string; label: string }

interface QuestDef {
  title: string
  description: string
  icons: QuestIcon[]
  done: (player: Player, ws: WorldState) => boolean
}

const QUESTS: QuestDef[] = [
  {
    title: 'Find the lost scroll fragments and return them to Mar.',
    description: 'Mar guards the entrance to her ritual chamber. She lost three important ancient scroll fragments. Find all three and bring them to her so the ritual can begin.',
    icons: [
      { key: 'monster_mar', label: 'Mar' },
      { key: 'item_scroll', label: 'Scroll fragment' },
    ],
    done: player => player.hasSkill('ritual_begun'),
  },
  {
    title: 'Save and return Widget to Eric.',
    description: "Eric's second favorite plush Widget has gone missing. Track him down, keep him safe, and bring him back to Eric so his Birthday can be celebrated. ",
    icons: [
      { key: 'monster_eric', label: 'Eric' },
      { key: 'item_widget2', label: 'Widget' },
    ],
    done: (_player, ws) => ws.widgetFound,
  },
  {
    title: 'Find the 3 lost stamps and return them to Dad.',
    description: 'Dad has collected three very specials stamps for Peter`s Birthday, but these have gone missing. Find them and bring the full set back to Dad.',
    icons: [
      { key: 'monster_pap2', label: 'Dad' },
      { key: 'item_postzegelRex', label: 'Rex stamp' },
      { key: 'item_postzegelStego', label: 'Stego stamp' },
      { key: 'item_postzegelStoom', label: 'Steam stamp' },
    ],
    done: player => player.hasSkill('mixing'),
  },
  {
    title: 'Help Mom and give her a Birthday present.',
    description: "It's Mom's birthday, but she is not feeling well. Help her to get better and then give her a nice present to really make her day. She does collect blue vases.",
    icons: [
      { key: 'monster_mam', label: 'Mom' },
      { key: 'item_sinaasappel', label: 'Orange' },
      { key: 'item_vaas', label: 'Vase' },
    ],
    done: (_player, ws) => ws.mamHasVase,
  },
  {
    title: 'Warn Peter about the early arrival of Lex and Sas.',
    description: 'Lex and Sas are arriving earlier than expected, riding in on the horse. Find Peter and warn him before they show up.',
    icons: [
      { key: 'monster_peter', label: 'Peter' },
      { key: 'monster_lex', label: 'Lex' },
      { key: 'monster_sas', label: 'Sas' },
      { key: 'monster_paard', label: 'Horse' },
    ],
    done: (_player, ws) => ws.peterWarned,
  },
  {
    title: 'Sound the magical Watergong to save the world.',
    description: 'Deep in the pond lies the magical Green Gong. Use the gong mallets Peter gave you to sound it and save the world. You must be able to swim and dive.',
    icons: [
      { key: 'item_gong', label: 'Watergong' },
      { key: 'item_gongmallet', label: 'Gong mallet' },
    ],
    done: () => false,
  },
]

export class QuestScreen {
  private container: Phaser.GameObjects.Container | null = null
  private view: 'list' | 'detail' = 'list'
  private selected = 0
  private player: Player | null = null
  private worldState: WorldState | null = null

  constructor(private scene: Phaser.Scene) {}

  isVisible(): boolean { return this.container !== null }

  show(player: Player, worldState: WorldState): void {
    if (this.container) { this.hide(); return }
    this.player = player
    this.worldState = worldState
    this.view = 'list'
    this.render()
  }

  hide(): void {
    this.container?.destroy()
    this.container = null
    this.player = null
    this.worldState = null
  }

  /** Number keys jump straight to a quest's detail view; Escape steps back/closes. */
  handleKey(event: KeyboardEvent): void {
    if (!this.container) return
    if (event.key === 'Escape') { this.back(); return }
    if (this.view === 'list') {
      const n = parseInt(event.key, 10)
      if (n >= 1 && n <= QUESTS.length) {
        this.selected = n - 1
        this.view = 'detail'
        this.render()
      }
    }
  }

  private back(): void {
    if (this.view === 'detail') {
      this.view = 'list'
      this.render()
    } else {
      this.hide()
    }
  }

  private render(): void {
    this.container?.destroy()
    const scene = this.scene
    const c = scene.add.container(0, 0)
    c.setDepth(1000)

    const bg = scene.add.graphics()
    bg.fillStyle(BG_COLOR, 1)
    bg.fillRect(WORLD_MAP_X, WORLD_MAP_Y, WORLD_MAP_W, WORLD_MAP_H)
    bg.lineStyle(2, BORDER_COLOR)
    bg.strokeRect(WORLD_MAP_X + 1, WORLD_MAP_Y + 1, WORLD_MAP_W - 2, WORLD_MAP_H - 2)
    c.add(bg)

    const exitBtn = scene.add.text(WORLD_MAP_X + WORLD_MAP_W - 20, WORLD_MAP_Y + 16, 'Exit [Esc]', {
      fontSize: '16px', color: TEXT_COLOR, fontFamily: FONT, fontStyle: 'bold',
    }).setOrigin(1, 0).setInteractive()
    exitBtn.on('pointerover', () => exitBtn.setColor('#600000'))
    exitBtn.on('pointerout',  () => exitBtn.setColor(TEXT_COLOR))
    exitBtn.on('pointerdown', () => this.hide())
    c.add(exitBtn)

    if (this.view === 'list') this.renderList(c)
    else this.renderDetail(c)

    this.container = c
  }

  private renderList(c: Phaser.GameObjects.Container): void {
    const scene  = this.scene
    const player = this.player!
    const ws     = this.worldState!
    const padX   = WORLD_MAP_X + 24
    const padY   = WORLD_MAP_Y + 20

    c.add(scene.add.text(padX, padY, 'Your quests are the following:', {
      fontSize: '20px', color: TEXT_COLOR, fontFamily: FONT, fontStyle: 'bold',
    }))

    const rowH = Math.floor((WORLD_MAP_H - 90) / QUESTS.length)
    QUESTS.forEach((quest, i) => {
      const y = padY + 44 + i * rowH
      const done = quest.done(player, ws)

      const numBox = scene.add.text(padX, y, `[${i + 1}]`, {
        fontSize: '18px', color: TEXT_COLOR, fontFamily: FONT,
      })
      const title = scene.add.text(padX + 50, y, quest.title, {
        fontSize: '18px', color: done ? DONE_COLOR : TEXT_COLOR, fontFamily: FONT,
      })
      c.add(numBox)
      c.add(title)

      const hit = scene.add.zone(padX, y - 2, WORLD_MAP_W - 90, rowH)
        .setOrigin(0, 0).setInteractive()
      hit.on('pointerover', () => title.setColor('#ffffff'))
      hit.on('pointerout',  () => title.setColor(done ? DONE_COLOR : TEXT_COLOR))
      hit.on('pointerdown', () => {
        this.selected = i
        this.view = 'detail'
        this.render()
      })
      c.add(hit)
    })

    c.add(scene.add.text(padX, WORLD_MAP_Y + WORLD_MAP_H - 26, 'Select a number for more information on a quest', {
      fontSize: '14px', color: DIM_COLOR, fontFamily: FONT,
    }))
  }

  private renderDetail(c: Phaser.GameObjects.Container): void {
    const scene  = this.scene
    const player = this.player!
    const ws     = this.worldState!
    const quest  = QUESTS[this.selected]
    const padX   = WORLD_MAP_X + 24
    const padY   = WORLD_MAP_Y + 20
    const done   = quest.done(player, ws)

    c.add(scene.add.text(padX, padY, quest.title, {
      fontSize: '20px', color: done ? DONE_COLOR : TEXT_COLOR, fontFamily: FONT, fontStyle: 'bold',
      wordWrap: { width: WORLD_MAP_W * 0.6 - 40 },
    }))

    const descY = padY + 60
    c.add(scene.add.text(padX, descY, quest.description, {
      fontSize: '16px', color: TEXT_COLOR, fontFamily: FONT,
      wordWrap: { width: WORLD_MAP_W * 0.6 - 40 },
      lineSpacing: 6,
    }))

    if (done) {
      c.add(scene.add.text(padX, WORLD_MAP_Y + WORLD_MAP_H - 26, 'Quest complete!', {
        fontSize: '15px', color: DONE_COLOR, fontFamily: FONT, fontStyle: 'bold',
      }))
    }

    const iconColX = WORLD_MAP_X + Math.floor(WORLD_MAP_W * 0.68)
    const iconSize = 40
    quest.icons.forEach((icon, i) => {
      const y = padY + i * (iconSize + 14)
      if (scene.textures.exists(icon.key)) {
        c.add(scene.add.image(iconColX, y, icon.key).setOrigin(0, 0).setDisplaySize(iconSize, iconSize))
      }
      c.add(scene.add.text(iconColX + iconSize + 10, y + iconSize / 2, icon.label, {
        fontSize: '15px', color: TEXT_COLOR, fontFamily: FONT,
      }).setOrigin(0, 0.5))
    })

    c.add(scene.add.text(padX, WORLD_MAP_Y + WORLD_MAP_H - 44, 'Back [Esc]', {
      fontSize: '14px', color: DIM_COLOR, fontFamily: FONT,
    }))
  }
}
