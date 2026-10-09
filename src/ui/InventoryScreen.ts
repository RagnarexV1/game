import Phaser from 'phaser'
import type { Player } from '../entities/Player'
import { itemDamage, itemDefense, itemValue, type InventorySystem } from '../engine/InventorySystem'
import type { EquipmentSystem } from '../engine/EquipmentSystem'
import type { MessageLog } from '../engine/MessageLog'
import type { ItemInstance, EquipmentSlots } from '../types'
import {
  STATS_W, BOTTOM_Y, CENTER_W, PANELS_H, COLORS,
} from './Layout'

const LETTERS  = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
// Keys that close a menu (or act on the selection in the full inventory) never
// label an item there, so pressing them can't mean two things
const MODE_KEYS: Record<string, string> = {
  all: 'pP', wear: 'wW', eat: 'eE', drink: 'dD', read: 'rR', remove: 'vV', wield: 'hH',
  throw: 'tT', zap: 'zZ', use: 'uU', drop: 'pP', examine: 'xX', pay: 'yY',
}
function itemLetters(mode: string): string {
  const reserved = 'iI' + (MODE_KEYS[mode] ?? '')
  return [...LETTERS].filter(c => !reserved.includes(c)).join('')
}
const INV_X    = STATS_W
const INV_Y    = BOTTOM_Y
const INV_W    = CENTER_W
const INV_H    = PANELS_H
const LINE_H   = 22
const PAD      = 10
const MAX_ROWS = 17
const COLS     = 2
const TOTAL    = MAX_ROWS * COLS
const COL_W    = Math.floor((INV_W - PAD * 3) / COLS)

function getItemCategory(defId: string, type: string): string {
  if (defId === 'amulet') return 'amulet'
  if (type === 'drink') return 'potion'
  if (type === 'eat') return 'food'
  return type
}

/** What Eric the trader pays for an item: half of what he asks for it. */
export function sellPrice(value: number | undefined): number {
  return Math.floor((value ?? 0) / 2)
}

const CATEGORY_ORDER: Record<string, number> = {
  amulet: 0, weapon: 1, armor: 2, food: 3,
  potion: 4, scroll: 5, wand: 6, ring: 7, tool: 8,
}

const CATEGORY_COLOR: Record<string, string> = {
  amulet: '#FFFFFF',
  weapon: '#00AA00',
  armor:  '#00AAAA',
  food:   '#FFCC00',
  potion: '#AA5500',
  scroll: '#0000FF',
  wand:   '#00FF00',
  ring:   '#AA0000',
  tool:   '#AAAAAA',
}

type ScreenMode = 'all' | 'wear' | 'wield' | 'remove' | 'eat' | 'drink' | 'read' | 'throw' | 'use' | 'drop' | 'examine' | 'mix' | 'pay' | 'zap' | 'sell'

interface LineEntry {
  item: ItemInstance
  equipped: boolean
  slot?: keyof EquipmentSlots
}

interface DisplayItem {
  item: ItemInstance
  def: NonNullable<ReturnType<InventorySystem['getDef']>>
  equipped: boolean
  slot?: keyof EquipmentSlots
  category: string
}

export class InventoryScreen {
  private container:  Phaser.GameObjects.Container
  private lines:      Phaser.GameObjects.Text[]  = []
  private lineIcons:  Phaser.GameObjects.Image[] = []
  private header!:    Phaser.GameObjects.Text
  private footer!:    Phaser.GameObjects.Text
  private prevBtn!:   Phaser.GameObjects.Text
  private nextBtn!:   Phaser.GameObjects.Text
  private pageLabel!: Phaser.GameObjects.Text

  private selectedIdx      = 0   // index into lettered items on current page
  private currentPage      = 0
  private totalPages       = 1
  private mode: ScreenMode = 'all'
  private currentPlayer: Player | null = null
  private lineData:   Array<LineEntry | null> = []
  private lineColors: string[] = []
  private letterToLine: Map<string, number> = new Map() // letter → slot index in this.lines

  onConsume: ((item: ItemInstance, player: Player) => void) | null = null
  onRead:    ((item: ItemInstance, player: Player) => void) | null = null
  onThrow:   ((item: ItemInstance, player: Player) => void) | null = null
  onZap:     ((item: ItemInstance, player: Player) => void) | null = null
  onUse:     ((item: ItemInstance, player: Player) => void) | null = null
  onDrop:    ((item: ItemInstance, player: Player) => void) | null = null
  onMix:     ((item1: ItemInstance, item2: ItemInstance, player: Player) => void) | null = null
  onPay: ((item: ItemInstance, player: Player) => void) | null = null
  onSell: ((item: ItemInstance, player: Player) => void) | null = null
  private payFilter: Set<string> | null = null
  // Live map (not a snapshot) so items paid off or newly consumed show up without a re-show().
  private payGhosts: Map<string, ItemInstance> | null = null
  unpaidItems: Set<string> | null = null

  private mixFirstItem: ItemInstance | null = null

  constructor(
    private scene: Phaser.Scene,
    private invSys: InventorySystem,
    private eqSys: EquipmentSystem,
    private log: MessageLog,
  ) {
    this.container = scene.add.container(0, 0)
    this.container.setDepth(100)
    this.container.setVisible(false)
    this.build()
  }

  private build(): void {
    const { scene } = this

    const bg = scene.add.graphics()
    bg.fillStyle(0x000000, 0.95)
    bg.fillRect(INV_X, INV_Y, INV_W, INV_H)
    bg.lineStyle(2, 0x606060)
    bg.strokeRect(INV_X + 1, INV_Y + 1, INV_W - 2, INV_H - 2)
    this.container.add(bg)

    const colDiv = scene.add.graphics()
    colDiv.lineStyle(1, 0x2a2a2a)
    const divX = INV_X + PAD + COL_W + Math.floor(PAD / 2)
    colDiv.lineBetween(divX, INV_Y + 38, divX, INV_Y + INV_H - 50)
    this.container.add(colDiv)

    this.header = scene.add.text(INV_X + PAD, INV_Y + PAD, '', {
      fontSize: '18px', color: '#00ff80', fontFamily: 'monospace', fontStyle: 'bold',
    })
    this.container.add(this.header)

    const div = scene.add.graphics()
    div.lineStyle(1, 0x404040)
    div.lineBetween(INV_X + PAD, INV_Y + 34, INV_X + INV_W - PAD, INV_Y + 34)
    this.container.add(div)

    for (let i = 0; i < TOTAL; i++) {
      const col = Math.floor(i / MAX_ROWS)
      const row = i % MAX_ROWS
      const lx  = INV_X + PAD + col * (COL_W + PAD)
      const ly  = INV_Y + 43  + row * LINE_H

      const icon = scene.add.image(lx, ly, 'inv_null')
        .setOrigin(0, 0).setDisplaySize(16, 16).setVisible(false)
      this.lineIcons.push(icon)
      this.container.add(icon)

      const t = scene.add.text(lx + 20, ly, '', {
        fontSize: '14px', color: '#c0c0c0', fontFamily: 'monospace',
      })
      this.lines.push(t)
      this.container.add(t)
      this.lineData.push(null)
      this.lineColors.push('#d0d0d0')

      const zoneX = col === 0 ? INV_X : INV_X + Math.floor(INV_W / 2)
      const zone  = scene.add.zone(zoneX, INV_Y + 42 + row * LINE_H, Math.floor(INV_W / 2), LINE_H)
        .setOrigin(0, 0).setInteractive()
      zone.on('pointerover', () => { if (this.lineData[i]) this.lines[i].setColor('#ffff40') })
      zone.on('pointerout',  () => { if (this.lineData[i]) this.lines[i].setColor(this.lineColors[i]) })
      zone.on('pointerdown', () => this.handleLineClick(i))
      this.container.add(zone)
    }

    const pageY = INV_Y + INV_H - 44
    this.prevBtn = scene.add.text(INV_X + PAD, pageY, '[ < Prev ]', {
      fontSize: '12px', color: '#80c0ff', fontFamily: 'monospace',
    }).setInteractive().setVisible(false)
    this.prevBtn.on('pointerdown', () => this.changePage(-1))
    this.container.add(this.prevBtn)

    this.nextBtn = scene.add.text(INV_X + INV_W - PAD - 76, pageY, '[ Next > ]', {
      fontSize: '12px', color: '#80c0ff', fontFamily: 'monospace',
    }).setInteractive().setVisible(false)
    this.nextBtn.on('pointerdown', () => this.changePage(1))
    this.container.add(this.nextBtn)

    this.pageLabel = scene.add.text(INV_X + INV_W / 2, pageY, '', {
      fontSize: '12px', color: '#606060', fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setVisible(false)
    this.container.add(this.pageLabel)

    this.footer = scene.add.text(INV_X + PAD, INV_Y + INV_H - 22, '', {
      fontSize: '12px', color: '#606060', fontFamily: 'monospace',
    })
    this.container.add(this.footer)
  }

  private changePage(delta: number): void {
    this.currentPage = Math.max(0, Math.min(this.totalPages - 1, this.currentPage + delta))
    this.selectedIdx = 0
    if (this.currentPlayer) this.refresh(this.currentPlayer)
  }

  private handleLineClick(i: number): void {
    const data = this.lineData[i]
    if (!data || !this.currentPlayer) return

    if (this.mode === 'eat' || this.mode === 'drink') {
      if (this.onConsume) this.onConsume(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'mix') {
      if (!this.mixFirstItem) {
        this.mixFirstItem = data.item
        this.refresh(this.currentPlayer)
      } else if (this.mixFirstItem.instanceId === data.item.instanceId) {
        this.mixFirstItem = null
        this.refresh(this.currentPlayer)
      } else {
        if (this.onMix) this.onMix(this.mixFirstItem, data.item, this.currentPlayer)
      }
      return
    }
    if (this.mode === 'throw') {
      if (this.onThrow) this.onThrow(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'zap') {
      if (this.onZap) this.onZap(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'use') {
      if (this.onUse) this.onUse(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'read') {
      if (this.onRead) this.onRead(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'drop') {
      if (this.onDrop) this.onDrop(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'examine') {
      const def = this.invSys.getDef(data.item.defId)
      if (def) this.log.add(`${def.name}: ${def.description ?? 'No description available.'}`, '#c0c080')
      return
    }
    if (this.mode === 'all') return

    if (this.mode === 'pay') {
      if (this.onPay) this.onPay(data.item, this.currentPlayer)
      return
    }
    if (this.mode === 'sell') {
      if (this.onSell) this.onSell(data.item, this.currentPlayer)
      return
    }

    if (data.equipped && data.slot) {
      this.eqSys.unequip(this.currentPlayer.inventory, this.currentPlayer.equipment, data.slot, this.currentPlayer)
    } else {
      this.eqSys.equip(this.currentPlayer.inventory, this.currentPlayer.equipment, data.item.instanceId, this.currentPlayer)
    }
    this.refresh(this.currentPlayer)
  }

  show(player: Player, mode: ScreenMode = 'all', payFilter?: Set<string>, payGhosts?: Map<string, ItemInstance>): void {
    this.payFilter = payFilter ?? null
    this.payGhosts = payGhosts ?? null
    this.mode = mode
    this.currentPlayer = player
    this.selectedIdx = 0
    this.currentPage = 0
    this.mixFirstItem = null
    this.container.setVisible(true)
    this.refresh(player)
  }

  hide(): void {
    this.container.setVisible(false)
    this.currentPlayer = null
    this.mixFirstItem = null
    this.payFilter = null
    this.payGhosts = null
  }

  isVisible(): boolean {
    return this.container.visible
  }

  getMode(): string {
    return this.mode
  }

  private invSpriteKey(defId: string, type: string): string {
    if (defId === 'amulet') return 'inv_amulet'
    switch (type) {
      case 'weapon': return 'inv_weapon'
      case 'armor':  return 'inv_armour'
      case 'scroll': return 'inv_scroll'
      case 'drink':  return 'inv_potion'
      case 'eat':    return 'inv_food'
      case 'ring':   return 'inv_ring'
      case 'wand':   return 'inv_wand'
      case 'tool':   return 'inv_tool'
      default:       return 'inv_null'
    }
  }

  refresh(player: Player): void {
    this.currentPlayer = player
    const inv   = player.inventory
    const equip = player.equipment

    const ringSlots:   (keyof EquipmentSlots)[] = ['ring1', 'ring2', 'ring3', 'ring4', 'ring5', 'ring6']
    const armorSlots:  (keyof EquipmentSlots)[] = ['body', 'head', 'feet', 'hand', 'arms', 'leg', 'neck', 'amulet', 'shield', 'cape', ...ringSlots]
    const weaponSlots: (keyof EquipmentSlots)[] = ['weapon', 'launcher']
    const allSlots:    (keyof EquipmentSlots)[] = ['weapon', 'launcher', 'body', 'head', 'feet', 'hand', 'arms', 'leg', 'neck', 'amulet', 'shield', 'cape', ...ringSlots]

    // Which equipment slots contribute to the display
    const equippedSlots: (keyof EquipmentSlots)[] =
      this.mode === 'all' || this.mode === 'examine' ? allSlots    :
      this.mode === 'wear'   ? armorSlots  :
      this.mode === 'wield'  ? weaponSlots :
      this.mode === 'remove' ? armorSlots  :
      []

    // ── Build unified item list ───────────────────────────────────────────
    const allItems: DisplayItem[] = []

    // Equipped items
    for (const slot of equippedSlots) {
      const item = equip[slot]
      if (!item) continue
      const def = this.invSys.getDef(item.defId)
      if (!def) continue
      allItems.push({ item, def, equipped: true, slot, category: getItemCategory(def.id, def.type) })
    }

    // Inventory items (not shown in 'remove' mode — only equipped items can be removed)
    if (this.mode !== 'remove') {
      for (const item of inv) {
        const def = this.invSys.getDef(item.defId)
        if (!def) continue
        if (this.mode === 'wear'  && def.type !== 'armor' && def.type !== 'ring') continue
        if (this.mode === 'wield' && (def.type !== 'weapon' || def.noWield))  continue
        if (this.mode === 'eat'   && def.type !== 'eat')     continue
        if (this.mode === 'drink' && def.type !== 'drink')   continue
        if (this.mode === 'read'  && def.type !== 'scroll')  continue
        if (this.mode === 'throw' && def.type !== 'weapon' && !def.throwable)  continue
        if (this.mode === 'mix'   && def.type !== 'drink')   continue
        if (this.mode === 'zap'   && def.type !== 'wand')    continue
        if (this.mode === 'pay' && !this.payFilter?.has(item.instanceId)) continue
        // Unpaid shop goods aren't yours to sell
        if (this.mode === 'sell' && this.unpaidItems?.has(item.instanceId)) continue
        allItems.push({ item, def, equipped: false, category: getItemCategory(def.id, def.type) })
      }
    }

    // Unpaid items already used up (potion drunk, scroll read, ...) still owe gold —
    // keep them on the pay list (with a ghost note) even though they're gone from the pack.
    if (this.mode === 'pay' && this.payGhosts) {
      for (const item of this.payGhosts.values()) {
        const def = this.invSys.getDef(item.defId)
        if (!def) continue
        allItems.push({ item, def, equipped: false, category: getItemCategory(def.id, def.type) })
      }
    }

    const isUnpaid = (di: DisplayItem) => this.mode === 'pay' || !!this.unpaidItems?.has(di.item.instanceId)

    // Sort: by category, then equipped first within category, then by name,
    // with unpaid copies listed before the paid stack of the same item
    allItems.sort((a, b) => {
      const catDiff = (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
      if (catDiff !== 0) return catDiff
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1
      const nameDiff = a.def.name.localeCompare(b.def.name)
      if (nameDiff !== 0) return nameDiff
      return Number(isUnpaid(b)) - Number(isUnpaid(a))
    })

    // Group same-defId unequipped items for display
    const groupedItems: Array<DisplayItem & { count: number }> = []
    for (const di of allItems) {
      if (!di.equipped) {
        const prev = groupedItems[groupedItems.length - 1]
        // Wands each carry their own charges, and unpaid shop items each get
        // their own line, so neither is ever merged
        if (prev && !prev.equipped && prev.item.defId === di.item.defId && itemDamage(di.def, di.item) === itemDamage(prev.def, prev.item) && itemDefense(di.def, di.item) === itemDefense(prev.def, prev.item) && !di.def.wandEffect && di.def.id !== 'remote'
            && !isUnpaid(di) && !isUnpaid(prev)) {
          prev.count++
          continue
        }
      }
      groupedItems.push({ ...di, count: 1 })
    }

    // ── Paginate ──────────────────────────────────────────────────────────
    this.totalPages = Math.max(1, Math.ceil(groupedItems.length / TOTAL))
    if (this.currentPage >= this.totalPages) this.currentPage = this.totalPages - 1
    const pageStart = this.currentPage * TOTAL
    const pageItems = groupedItems.slice(pageStart, pageStart + TOTAL)

    // ── Build display lines ───────────────────────────────────────────────
    this.letterToLine.clear()
    let letterIdx = 0
    const letters = itemLetters(this.mode)

    const displayLines: Array<{ text: string; color: string; data: LineEntry | null }> = []

    for (let i = 0; i < pageItems.length; i++) {
      const di = pageItems[i]
      const { item, def, equipped, slot } = di

      // Letters assigned to: non-equipped items in all modes; equipped items in 'remove' mode
      const getsLetter = !equipped || this.mode === 'remove' || this.mode === 'examine'
      const letter = getsLetter ? (letters[letterIdx] ?? '?') : ''
      if (getsLetter && letterIdx < letters.length) {
        this.letterToLine.set(letters[letterIdx], i)
        letterIdx++
      }

      let desc = def.name
      if (di.count > 1) desc += ` (${di.count})`
      else if (item.quantity > 1) desc += ` (${item.quantity})`
      if (def.wandEffect || def.id === 'remote') desc += ` (${item.charges ?? 0})`
      if (def.damage)  desc += ` (+${itemDamage(def, item)} dmg)`
      if (def.defense) desc += ` (-${itemDefense(def, item)} AC)`
      if (this.mode === 'pay') desc += `  [${itemValue(def, item)}g]`
      if (this.mode === 'sell') desc += `  [${sellPrice(itemValue(def, item))}c]`
      if (this.mode === 'pay' && this.payGhosts?.has(item.instanceId)) desc += ' (used)'
      if (this.mode !== 'pay' && this.unpaidItems?.has(item.instanceId)) desc += ' (unpaid)'

      let text: string
      let color: string

      if (equipped) {
        const tag = slot === 'weapon' ? 'held' : slot === 'launcher' ? 'shooting' : (slot as string).startsWith('ring') ? 'ring' : 'worn'
        text  = this.mode === 'remove'
          ? `${letter}  [${tag}] ${desc}`
          : `   [${tag}] ${desc}`
        color = '#00c080'
      } else {
        const isSelected = this.mode === 'all' && this.letterToLine.get(letters[this.selectedIdx]) === i
        const isMixSel   = this.mode === 'mix' && this.mixFirstItem?.instanceId === item.instanceId
        const isRelic    = this.mode === 'read' && def.relic === true
        color = isMixSel ? '#ff8040' : isSelected ? '#ffff40' : isRelic ? '#ffd080' : (CATEGORY_COLOR[di.category] ?? '#d0d0d0')
        text  = `${letter}  ${desc}${isRelic ? ' [relic]' : ''}${isMixSel ? ' ◄' : ''}`
      }

      displayLines.push({ text, color, data: { item, equipped, slot } })
    }

    if (displayLines.length === 0) {
      const msg =
        this.mode === 'remove'  ? '  (nothing equipped)'         :
        this.mode === 'wear'    ? '  (no armor or rings)'        :
        this.mode === 'wield'   ? '  (no weapons)'               :
        this.mode === 'eat'     ? '  (no food in pack)'          :
        this.mode === 'drink'   ? '  (no potions in pack)'       :
        this.mode === 'read'    ? '  (no scrolls in pack)'       :
        this.mode === 'throw'   ? '  (no weapons to throw)'      :
        this.mode === 'zap'     ? '  (nothing to zap)'           :
        this.mode === 'use'     ? '  (nothing to use)'           :
        this.mode === 'examine' ? '  (nothing to examine)'       :
        this.mode === 'mix'     ? '  (need at least 2 potions)'  :
        this.mode === 'pay'     ? '  (nothing to pay)'          :
        this.mode === 'sell'    ? '  (nothing to sell)'         :
        '  (empty)'
      displayLines.push({ text: msg, color: '#606060', data: null })
    }

    // ── Fill slots ────────────────────────────────────────────────────────
    for (let i = 0; i < this.lines.length; i++) {
      const entry = displayLines[i]
      if (entry) {
        this.lines[i].setText(entry.text)
        this.lines[i].setColor(entry.color)
        this.lineColors[i] = entry.color
        this.lineData[i]   = entry.data
        if (entry.data) {
          const def = this.invSys.getDef(entry.data.item.defId)
          this.lineIcons[i].setTexture(def ? this.invSpriteKey(def.id, def.type) : 'inv_null').setVisible(true)
        } else {
          this.lineIcons[i].setVisible(false)
        }
      } else {
        this.lines[i].setText('')
        this.lineData[i] = null
        this.lineIcons[i].setVisible(false)
      }
    }

    // ── Page navigation ───────────────────────────────────────────────────
    const multi = this.totalPages > 1
    this.prevBtn.setVisible(multi && this.currentPage > 0)
    this.nextBtn.setVisible(multi && this.currentPage < this.totalPages - 1)
    this.pageLabel.setVisible(multi)
    if (multi) this.pageLabel.setText(`${this.currentPage + 1} / ${this.totalPages}`)

    // ── Header ────────────────────────────────────────────────────────────
    const pageHint = multi ? `  [${this.currentPage + 1}/${this.totalPages}]` : ''
    if (this.mode === 'wear')        this.header.setText('WEAR ARMOR / RINGS' + pageHint)
    else if (this.mode === 'wield')  this.header.setText('WIELD WEAPON' + pageHint)
    else if (this.mode === 'remove') this.header.setText('REMOVE ARMOR' + pageHint)
    else if (this.mode === 'eat')    this.header.setText('EAT FOOD' + pageHint)
    else if (this.mode === 'drink')  this.header.setText('DRINK POTION' + pageHint)
    else if (this.mode === 'read')   this.header.setText('READ SCROLL' + pageHint)
    else if (this.mode === 'throw')  this.header.setText('THROW WEAPON' + pageHint)
    else if (this.mode === 'zap')    this.header.setText('ZAP WAND' + pageHint)
    else if (this.mode === 'use')    this.header.setText('USE / GIVE ITEM' + pageHint)
    else if (this.mode === 'drop')    this.header.setText('DROP ITEM' + pageHint)
    else if (this.mode === 'examine') this.header.setText('EXAMINE ITEM' + pageHint)
    else if (this.mode === 'mix') {
      const selHint = this.mixFirstItem ? '— select second' : '— select first'
      this.header.setText(`MIX POTIONS  ${selHint}` + pageHint)
    }
    else if (this.mode === 'pay') this.header.setText(`PAY FOR ITEMS  (Cents: ${player.gold})` + pageHint)
    else if (this.mode === 'sell') this.header.setText(`SELL ITEMS  (Cents: ${player.gold})` + pageHint)
    else this.header.setText(`INVENTORY  (Cents: ${player.gold})` + pageHint)

    // ── Footer ────────────────────────────────────────────────────────────
    const pageKeys = multi ? '  ◄►=page' : ''
    if (this.mode === 'wear' || this.mode === 'wield' || this.mode === 'remove')
      this.footer.setText('Click item to equip/remove   ESC to close' + pageKeys)
    else if (this.mode === 'eat')
      this.footer.setText('Letter/click food to eat   E to close' + pageKeys)
    else if (this.mode === 'drink')
      this.footer.setText('Letter/click potion to drink   D to close' + pageKeys)
    else if (this.mode === 'read')
      this.footer.setText('Letter/click scroll to read   R to close' + pageKeys)
    else if (this.mode === 'throw')
      this.footer.setText('Click or letter to throw   T to close' + pageKeys)
    else if (this.mode === 'zap')
      this.footer.setText('Click or letter to zap   Z to close' + pageKeys)
    else if (this.mode === 'use')
      this.footer.setText('Click or letter to use/give   U to close' + pageKeys)
    else if (this.mode === 'drop')
      this.footer.setText('Click or letter to drop   P to close' + pageKeys)
    else if (this.mode === 'mix')
      this.footer.setText('Click first potion, then second   ESC to close' + pageKeys)
    else if (this.mode === 'examine')
      this.footer.setText('Click or letter to examine   ESC to close' + pageKeys)
    else if (this.mode === 'pay')
      this.footer.setText('Click item to pay   Y or ESC to close' + pageKeys)
    else if (this.mode === 'sell')
      this.footer.setText('Click or letter to sell for half its price   ESC to close' + pageKeys)
    else
      this.footer.setText('I=close  P=drop  W=wear  V=remove  H=wield  T=throw  R=read  E=eat  D=drink  U=use' + pageKeys)
  }

  handleKey(event: KeyboardEvent, player: Player): boolean {
    if (!this.container.visible) return false

    // Close keys
    if (event.key === 'Escape' || event.key === 'i' || event.key === 'I'
      || (this.mode === 'wear'   && (event.key === 'w' || event.key === 'W'))
      || (this.mode === 'eat'    && (event.key === 'e' || event.key === 'E'))
      || (this.mode === 'drink'  && (event.key === 'd' || event.key === 'D'))
      || (this.mode === 'read'   && (event.key === 'r' || event.key === 'R'))
      || (this.mode === 'remove' && (event.key === 'v' || event.key === 'V'))
      || (this.mode === 'wield'  && (event.key === 'h' || event.key === 'H'))
      || (this.mode === 'throw'  && (event.key === 't' || event.key === 'T'))
      || (this.mode === 'zap'    && (event.key === 'z' || event.key === 'Z'))
      || (this.mode === 'use'    && (event.key === 'u' || event.key === 'U'))
      || (this.mode === 'drop'    && (event.key === 'p' || event.key === 'P'))
      || (this.mode === 'examine' && (event.key === 'x' || event.key === 'X'))
      || (this.mode === 'pay'     && (event.key === 'y' || event.key === 'Y'))) {
      this.hide()
      return true
    }

    // Page navigation
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      this.changePage(1); return true
    }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      this.changePage(-1); return true
    }

    if (this.mode !== 'all' && this.mode !== 'throw' && this.mode !== 'zap' && this.mode !== 'use' && this.mode !== 'remove' && this.mode !== 'drop' && this.mode !== 'examine' && this.mode !== 'mix' && this.mode !== 'pay' && this.mode !== 'sell'
      && this.mode !== 'eat' && this.mode !== 'drink' && this.mode !== 'read') return true

    const letterLineIdx = this.letterToLine.get(event.key)
    if (letterLineIdx !== undefined) {
      const data = this.lineData[letterLineIdx]
      if (data?.item && this.currentPlayer) {
        if ((this.mode === 'eat' || this.mode === 'drink') && this.onConsume) { this.onConsume(data.item, this.currentPlayer); return true }
        if (this.mode === 'read' && this.onRead)     { this.onRead(data.item, this.currentPlayer);  return true }
        if (this.mode === 'pay'   && this.onPay)      { this.onPay(data.item, this.currentPlayer!); return true }
        if (this.mode === 'sell'  && this.onSell)     { this.onSell(data.item, this.currentPlayer);  return true }
        if (this.mode === 'throw' && this.onThrow)   { this.onThrow(data.item, this.currentPlayer); return true }
        if (this.mode === 'zap'   && this.onZap)     { this.onZap(data.item, this.currentPlayer);   return true }
        if (this.mode === 'use'   && this.onUse)     { this.onUse(data.item, this.currentPlayer);   return true }
        if (this.mode === 'drop'  && this.onDrop)    { this.onDrop(data.item, this.currentPlayer);  return true }
        if (this.mode === 'remove' && data.slot)     {
          this.eqSys.unequip(this.currentPlayer.inventory, this.currentPlayer.equipment, data.slot, this.currentPlayer)
          this.refresh(this.currentPlayer)
          return true
        }
        if (this.mode === 'examine') {
          const def = this.invSys.getDef(data.item.defId)
          if (def) this.log.add(`${def.name}: ${def.description ?? 'No description available.'}`, '#c0c080')
          return true
        }
        if (this.mode === 'mix') {
          if (!this.mixFirstItem) {
            this.mixFirstItem = data.item
            this.refresh(player)
          } else if (this.mixFirstItem.instanceId === data.item.instanceId) {
            this.mixFirstItem = null
            this.refresh(player)
          } else {
            if (this.onMix) this.onMix(this.mixFirstItem, data.item, player)
          }
          return true
        }
      }
      // 'all' mode: select item
      const letterIdx = itemLetters(this.mode).indexOf(event.key)
      if (letterIdx >= 0 && this.mode === 'all') {
        this.selectedIdx = letterIdx
        this.refresh(player)
      }
      return true
    }

    if (event.key === 'ArrowDown' && this.mode === 'all') {
      this.selectedIdx = Math.min(this.letterToLine.size - 1, this.selectedIdx + 1)
      this.refresh(player)
      return true
    }
    if (event.key === 'ArrowUp' && this.mode === 'all') {
      this.selectedIdx = Math.max(0, this.selectedIdx - 1)
      this.refresh(player)
      return true
    }

    if ((event.key === 'p' || event.key === 'P') && this.mode === 'all') {
      const selLineIdx = this.letterToLine.get(itemLetters(this.mode)[this.selectedIdx])
      if (selLineIdx !== undefined && this.lineData[selLineIdx]?.item)
        return false // let GameScene handle drop
    }

    return true
  }
}
