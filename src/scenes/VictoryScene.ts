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
  'monster_sas', 'monster_mar', 'monster_paard', 'monster_klopper',
  'item_widget2',
]

// Pool of regular monsters the marching rows pick from at random
const MARCH_POOL = [
  'monster_blauwkip', 'monster_duif', 'monster_dwarf', 'monster_eendGroen', 'monster_eendRood',
  'monster_egel', 'monster_firedragon', 'monster_hagedis', 'monster_hamster', 'monster_guineapig',
  'monster_hela', 'monster_icedragon', 'monster_koe', 'monster_magician', 'monster_mier',
  'monster_migdnart', 'monster_mol', 'monster_schaap', 'monster_slak', 'monster_stinkdier',
  'monster_swordsman', 'monster_wizard', 'monster_worm', 'monster_lorkest', 'monster_qivuit',
  'monster_jormungand', 'monster_vis', 'monster_squid', 'monster_silvervisje', 'monster_pissebed',
  'monster_bat', 'monster_lowerdwarf', 'monster_cactus', 'monster_car', 'monster_guardian',
  'monster_summoner', 'monster_secitt', 'monster_watcher', 'monster_cockatrice', 'monster_wierdfume', 'monster_rat',
  'monster_wilddog', 'monster_wildboar', 'monster_ogre', 'monster_spirit', 'monster_muddman',
  'monster_nymph', 'monster_cat', 'monster_wolf', 'monster_werewolf', 'monster_troll',
  'monster_rockgiant', 'monster_salamander', 'monster_spetterpoep',
]

const GROUP_DEFS: Array<{ y: number; dir: 1 | -1; speed: number; startOffset: number }> = [
  { y:  80, dir:  1, speed:  80, startOffset:   0 },
  { y: 230, dir: -1, speed: 100, startOffset: 200 },
  { y: 830, dir:  1, speed:  90, startOffset: 400 },
  { y: 720, dir: -1, speed: 110, startOffset: 100 },
  { y: 360, dir:  1, speed:  85, startOffset: 600 },
  { y: 630, dir: -1, speed:  95, startOffset: 300 },
]

// Every role is Eric's. [role, name]; a null name renders the role as a section header.
const CREDITS: Array<[string, string | null]> = [
  ['RAGNAREX', null],
  ['A game by', 'Eric'],
  ['', null],
  ['- PRODUCTION -', null],
  ['Executive Producer', 'Eric'],
  ['Producer', 'Eric'],
  ['Project Manager', 'Eric'],
  ['Creative Director', 'Eric'],
  ['Game Director', 'Eric'],
  ['- DESIGN -', null],
  ['Lead Game Designer', 'Eric'],
  ['Level Designer', 'Eric'],
  ['Quest Designer', 'Eric'],
  ['Combat Balancing', 'Eric'],
  ['Economy & Loot Tables', 'Eric'],
  ['Narrative Designer', 'Eric'],
  ['Writer', 'Eric'],
  ['- PROGRAMMING -', null],
  ['Lead Programmer', 'Eric'],
  ['Engine Programmer', 'Eric'],
  ['Gameplay Programmer', 'Eric'],
  ['AI Programmer', 'Eric'],
  ['UI Programmer', 'Eric'],
  ['Procedural Map Generation', 'Eric'],
  ['Save System Engineer', 'Eric'],
  ['Tools Programmer', 'Eric'],
  ['- ART -', null],
  ['Art Director', 'Eric'],
  ['Pixel Artist', 'Eric'],
  ['Monster Sprites', 'Eric'],
  ['Terrain Tiles', 'Eric'],
  ['Animator', 'Eric'],
  ['- AUDIO -', null],
  ['Composer', 'Eric'],
  ['Sound Designer', 'Eric'],
  ['Gong Acoustics Engineer', 'Eric'],
  ['- RESEARCH & SPECIAL THANKS -', null],
  ['Scroll of Knowledge Research', 'Eric'],
  ['Monster Field Studies', 'Eric'],
  ['Widget Retrieval Consultant', 'Eric'],
  ['Widget Plush Care', 'Eric'],
  ['Klopper Hydrodynamics', 'Eric'],
  ['Horse Whisperer', 'Eric'],
  ['Lex Distraction Coordinator', 'Eric'],
  ['Dragon Temperature Control', 'Eric'],
  ['Jormungand taming', 'Eric'],
  ['Lego Terrain Engineering', 'Eric'],
  ['Tegel Wit Polishing', 'Eric'],
  ['Hamster March Choreography', 'Eric'],
  ['Birthday Celebration Planning', 'Eric'],
  ['- QUALITY -', null],
  ['QA Lead', 'Eric'],
  ['Playtester', 'Eric'],
  ['Bug Creator', 'Eric'],
  ['Bug Fixer', 'Eric'],
  ['- MARKETING -', null],
  ['Marketing', 'Eric'],
  ['Community Manager', 'Eric'],
  ['Catering', 'Eric'],
  ['', null],
  ['Thank you for playing!', null],
]

const CREDITS_SPEED = 45    // px per second upward
const FLIP_INTERVAL = 500   // ms between horizontal sprite mirrors

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
  private credits!: Phaser.GameObjects.Text
  private score = 0

  constructor() {
    super({ key: 'VictoryScene' })
  }

  init(data: { score?: number; music?: Phaser.Sound.BaseSound | null }): void {
    this.score = data?.score ?? 0
    // The level's music keeps playing during the credits and stops when we leave
    const music = data?.music ?? null
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => music?.destroy())
    this.waves = []
    this.waveTimer = 0
    this.orbits = []
    this.groups = []
    this.bgIdx = 0
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
          this.add.image(startX + i * SPACING, def.y, Phaser.Utils.Array.GetRandom(MARCH_POOL))
            .setOrigin(0.5, 0.5)
            .setDepth(3),
        )
      }
      this.groups.push({ sprites, x: startX, y: def.y, dir: def.dir, speed: def.speed })
    }

    // Mirror every marching monster horizontally every 500ms
    this.time.addEvent({
      delay: FLIP_INTERVAL,
      loop: true,
      callback: () => {
        for (const grp of this.groups) {
          for (const s of grp.sprites) s.toggleFlipX()
        }
      },
    })

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

    // Final score below the title
    this.add.text(cx, 118, `FINAL SCORE: ${this.score}`, {
      fontSize: '32px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5, 0).setDepth(10)

    // Scrolling credits overlaid on top of everything, looping from the bottom
    const creditLines = CREDITS.map(([role, name]) => name === null ? role : `${role}  ....  ${name}`)
    this.credits = this.add.text(cx, GAME_H, creditLines.join('\n'), {
      fontSize: '22px',
      color: '#ffe080',
      fontFamily: 'monospace',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4,
      lineSpacing: 10,
    }).setOrigin(0.5, 0).setDepth(20)

    // Clickable RETURN text in the bottom-left corner
    this.add.text(48, GAME_H - 56, 'RETURN', {
      fontSize: '14px',
      color: '#80c0ff',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(5)
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
      let wrapped = false
      if (grp.dir === 1 && grp.x > GAME_W) {
        grp.x = -GROUP_SPREAD
        wrapped = true
      } else if (grp.dir === -1 && grp.x + GROUP_SPREAD < 0) {
        grp.x = GAME_W
        wrapped = true
      }
      for (let i = 0; i < grp.sprites.length; i++) {
        grp.sprites[i].x = grp.x + i * SPACING
        // Fresh random monsters each time the row re-enters the screen
        if (wrapped) grp.sprites[i].setTexture(Phaser.Utils.Array.GetRandom(MARCH_POOL))
      }
    }

    // Scroll credits upward, restart from the bottom once fully off screen
    this.credits.y -= CREDITS_SPEED * dt
    if (this.credits.y + this.credits.height < 0) this.credits.y = GAME_H
  }
}
