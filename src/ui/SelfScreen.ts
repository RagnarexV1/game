import Phaser from 'phaser'
import type { Player } from '../entities/Player'
import type { InventorySystem } from '../engine/InventorySystem'
import { GAME_W, GAME_H } from './Layout'

// Image is 637×479; displayed stretched to GAME_W×GAME_H (≈2.51× x, 2.0× y)
const X = (orig: number) => Math.round(orig * (GAME_W / 637))
const Y = (orig: number) => Math.round(orig * (GAME_H / 479))

const TEXT_COLOR = '#d0c8b8'
const FONT = 'monospace'

const SKILL_META: Record<string, { label: string; cat: 'skill' | 'power' | 'ability' | 'resistance' | 'hidden' }> = {
  mixing:           { label: 'Alchemy',         cat: 'skill' },
  cartography:      { label: 'Cartography',     cat: 'skill' },
  music:            { label: 'Music',           cat: 'skill' },
  ventriloquism:    { label: 'Ventriloquism',   cat: 'skill' },
  clothespin_trap:  { label: 'Clothespin Bomb', cat: 'skill' },
  relocation:       { label: 'Relocation',      cat: 'skill' },
  swimming:         { label: 'Swimming',         cat: 'ability' },
  diving:           { label: 'Diving',           cat: 'ability' },
  heat_resistance:  { label: 'Heat',             cat: 'resistance' },
  cold_resistance:  { label: 'Cold',             cat: 'resistance' },
  dimension_travel: { label: 'Dimension travel', cat: 'power' },
  ritual_begun:     { label: '',                 cat: 'hidden' },
}

function fmt(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}

export class SelfScreen {
  private container: Phaser.GameObjects.Container | null = null

  constructor(private scene: Phaser.Scene) {}

  isVisible(): boolean { return this.container !== null }

  show(player: Player, inventory: InventorySystem): void {
    if (this.container) { this.hide(); return }

    const scene = this.scene
    const c = scene.add.container(0, 0)
    c.setDepth(1000)

    const bg = scene.add.image(0, 0, 'ui_self_screen')
      .setOrigin(0, 0)
      .setDisplaySize(GAME_W, GAME_H)
      .setInteractive()
    bg.on('pointerdown', () => this.hide())
    c.add(bg)

    const txt = (x: number, y: number, s: string, size = '18px') => {
      const t = scene.add.text(x, y, s, { fontSize: size, color: TEXT_COLOR, fontFamily: FONT })
      c.add(t)
    }

    // Top-left info block
    txt(X(20), Y(15),  player.name, '22px')
    txt(X(20), Y(30), fmt(player.race))
    txt(X(20), Y(45), `Lev ${player.level} ${player.playerClass}`)
    
    txt(X(97), Y(30), fmt(player.gender))

    // Top-right stats
    const eyes    = player.extraEyes + 2
    const fingers = player.extraFingers + 6
    const stat = (label: string, val: string | number, origY: number) =>
      txt(X(272), Y(origY), `${label.padEnd(9)}${val}`)
    stat('Eyes',     eyes,           15)
    stat('Fingers',  fingers,       30)
    stat('Speed',    player.speed,  45)
    stat('Morality', player.morality, 60)
    stat('Morale',   player.moraleLevel(), 75)

    // Categorise skills
    const skills: string[]      = []
    const powers: string[]      = []
    const abilities: string[]   = []
    const resistances: string[] = []

    for (const id of player.skills) {
      const meta = SKILL_META[id]
      if (meta?.cat === 'hidden') continue
      const label = meta?.label ?? fmt(id)
      const cat   = meta?.cat   ?? 'skill'
      if      (cat === 'skill')      skills.push(label)
      else if (cat === 'power')      powers.push(label)
      else if (cat === 'ability')    abilities.push(label)
      else if (cat === 'resistance') resistances.push(label)
    }

    // Resistances from equipped items (not already granted by skill)
    const hasHeatSkill = player.hasSkill('heat_resistance')
    const hasItemHeat  = Object.values(player.equipment).some(
      item => item && inventory.getDef(item.defId)?.heatResistance === true
    )
    if (hasItemHeat && !hasHeatSkill) resistances.push(SKILL_META.heat_resistance.label)

    const hasColdSkill = player.hasSkill('cold_resistance')
    const hasItemCold  = Object.values(player.equipment).some(
      item => item && inventory.getDef(item.defId)?.coldResistance === true
    )
    if (hasItemCold && !hasColdSkill) resistances.push(SKILL_META.cold_resistance.label)

    if (player.clayProtection > 0) resistances.push('Stoning')

    // Section content — columns in original image: 12, 165, 320, 478
    const LH = Y(13)
    const SY = Y(132) + 2 * LH

    const addList = (origX: number, items: string[], xOffset = 0) =>
      items.forEach((item, i) => txt(X(origX) + xOffset, SY + i * LH, item))

    // Timed conditions are derived from player state, not stored in diagnostics
    const diagnostics = [...player.diagnostics]
    if (player.isTranslucent()) diagnostics.push('Transparent')
    if (player.lycanthropy) diagnostics.push('Lycanthropy')
    if (player.invulnerableTurns > 0) diagnostics.push('Invulnerable')
    if (player.drunkTurns > 0) diagnostics.push('Confused')
    if (player.petrifyCountdown > 0) diagnostics.push('Turning to stone')
    if (player.paralyzedTurns > 0) diagnostics.push('Paralyzed')

    addList(12,  diagnostics)
    addList(185, skills)
    addList(320, powers)
    addList(478, abilities, 33)

    // Resistances sub-section (in Powers column, lower half)
    resistances.forEach((r, i) => txt(X(330), Y(325) + (i + 1) * LH, r))

    this.container = c
  }

  hide(): void {
    this.container?.destroy()
    this.container = null
  }
}
