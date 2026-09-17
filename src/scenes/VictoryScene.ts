import Phaser from 'phaser'
import { GAME_W, GAME_H } from '../ui/Layout'

const BG_SPRITES = [
  'terrain_grass',
  'terrain_floor',
  'terrain_tegel_wit',
  'terrain_carpet',
  'terrain_lego_green',
  'terrain_hall_wall',
  'terrain_tapijt3',
  'terrain_lego_blue',
]

const NPC_SPRITES = [
  'monster_mam', 'monster_pap2', 'monster_eric', 'monster_peter',
  'monster_sas', 'monster_mar', 'monster_paard', 'monster_tetra',
  'monster_sorcerer',
]

const GROUP_DEFS: Array<{ key: string; y: number; dir: 1 | -1; speed: number; startOffset: number }> = [
  { key: 'monster_slak',      y:  80, dir:  1, speed:  80, startOffset:   0 },
  { key: 'monster_eendGroen', y: 230, dir: -1, speed: 100, startOffset: 200 },
  { key: 'monster_hamster',   y: 830, dir:  1, speed:  90, startOffset: 400 },
  { key: 'monster_duif',      y: 720, dir: -1, speed: 110, startOffset: 100 },
  { key: 'monster_schaap',    y: 360, dir:  1, speed:  85, startOffset: 600 },
  { key: 'monster_rat',       y: 630, dir: -1, speed:  95, startOffset: 300 },
]

const SPACING = 48          // px between monsters in a group
const GROUP_SPREAD = 4 * SPACING  // full width of 5-monster group
const ORBIT_RADIUS_X = 165
const ORBIT_RADIUS_Y = 125
const ORBIT_SPEED = 0.45    // radians per second

interface Wave {
  gfx: Phaser.GameObjects.Graphics
  radius: number
  alpha: number
}

interface MonsterGroup {
  sprites: Phaser.GameObjects.Image[]
  x: number
  y: number
  dir: 1 | -1
  speed: number
}

interface NpcOrbit {
  sprite: Phaser.GameObjects.Image
  angle: number
}

export class VictoryScene extends Phaser.Scene {
  private bgSprite!: Phaser.GameObjects.TileSprite
  private bgIdx = 0

  private waves: Wave[] = []
  private waveTimer = 0

  private orbits: NpcOrbit[] = []
  private groups: MonsterGroup[] = []

  constructor() {
    super({ key: 'VictoryScene' })
  }

  create(): void {
    const cx = GAME_W / 2
    const cy = GAME_H / 2

    // Tiled background cycling every 5s
    this.bgSprite = this.add.tileSprite(0, 0, GAME_W, GAME_H, BG_SPRITES[0])
      .setOrigin(0, 0)
      .setDepth(0)

    this.time.addEvent({
      delay: 5000,
      loop: true,
      callback: () => {
        this.bgIdx = (this.bgIdx + 1) % BG_SPRITES.length
        this.bgSprite.setTexture(BG_SPRITES[this.bgIdx])
      },
    })

    // Gong at center (depth 2, scaled up to be prominent)
    this.add.image(cx, cy + 8, 'item_gong')
      .setOrigin(0.5, 0.5)
      .setDepth(2)
      .setScale(2.5)

    // Rex at center, slightly above gong
    this.add.image(cx, cy - 14, 'player')
      .setOrigin(0.5, 0.5)
      .setDepth(4)

    // NPCs orbiting the gong (depth 3), evenly spaced in angle
    for (let i = 0; i < NPC_SPRITES.length; i++) {
      const angle = (i / NPC_SPRITES.length) * Math.PI * 2
      const sprite = this.add.image(
        cx + Math.cos(angle) * ORBIT_RADIUS_X,
        cy + Math.sin(angle) * ORBIT_RADIUS_Y,
        NPC_SPRITES[i],
      ).setOrigin(0.5, 0.5).setDepth(3)
      this.orbits.push({ sprite, angle })
    }

    // Monster march groups (depth 3), staggered start positions
    for (const def of GROUP_DEFS) {
      const startX = def.dir === 1
        ? -GROUP_SPREAD - def.startOffset
        : GAME_W + def.startOffset
      const sprites: Phaser.GameObjects.Image[] = []
      for (let i = 0; i < 5; i++) {
        sprites.push(
          this.add.image(startX + i * SPACING, def.y, def.key)
            .setOrigin(0.5, 0.5)
            .setDepth(3),
        )
      }
      this.groups.push({ sprites, x: startX, y: def.y, dir: def.dir, speed: def.speed })
    }

    // Victory title with pulsing tween
    const title = this.add.text(cx, 24, 'VICTORY!', {
      fontSize: '72px',
      color: '#ffd700',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(10)

    this.tweens.add({
      targets: title,
      scaleX: 1.12,
      scaleY: 1.12,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: 'Sine.easeInOut',
    })

    // Return portal — clickable terrain_portal sprite in bottom-left corner
    const portalX = 48
    const portalY = GAME_H - 56

    this.add.text(portalX, portalY - 34, 'RETURN', {
      fontSize: '14px',
      color: '#80c0ff',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(5)

    this.add.image(portalX, portalY, 'terrain_portal')
      .setOrigin(0.5, 0.5)
      .setDepth(5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.sound.stopAll(); this.scene.start('GameScene') })

    this.add.text(cx, GAME_H - 24, 'Press R to return to start', {
      fontSize: '18px',
      color: '#80c0ff',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(10)

    this.input.keyboard!.on('keydown-R', () => { this.sound.stopAll(); this.scene.start('GameScene') })
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000
    const cx = GAME_W / 2
    const cy = GAME_H / 2

    // Spawn a new sound wave ring every 1.5s
    this.waveTimer += delta
    if (this.waveTimer >= 1500) {
      this.waveTimer = 0
      const gfx = this.add.graphics().setDepth(2)
      this.waves.push({ gfx, radius: 20, alpha: 0.85 })
    }

    // Update and redraw all active sound waves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]
      w.radius += 195 * dt   // expand ~195px/s → fills screen in ~3s
      w.alpha  -= 0.28 * dt  // fade out over ~3s
      if (w.alpha <= 0) {
        w.gfx.destroy()
        this.waves.splice(i, 1)
        continue
      }
      w.gfx.clear()
      w.gfx.lineStyle(3, 0xffd700, w.alpha)
      w.gfx.strokeCircle(cx, cy, w.radius)
    }

    // Rotate orbiting NPCs
    for (const orb of this.orbits) {
      orb.angle += ORBIT_SPEED * dt
      orb.sprite.x = cx + Math.cos(orb.angle) * ORBIT_RADIUS_X
      orb.sprite.y = cy + Math.sin(orb.angle) * ORBIT_RADIUS_Y
    }

    // March monster groups, wrap around when fully off screen
    for (const grp of this.groups) {
      grp.x += grp.dir * grp.speed * dt
      if (grp.dir === 1 && grp.x > GAME_W) {
        grp.x = -GROUP_SPREAD
      } else if (grp.dir === -1 && grp.x + GROUP_SPREAD < 0) {
        grp.x = GAME_W
      }
      for (let i = 0; i < grp.sprites.length; i++) {
        grp.sprites[i].x = grp.x + i * SPACING
      }
    }
  }
}
