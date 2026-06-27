import Phaser from 'phaser'

const ORIG_W = 280
const ORIG_H = 236

// Col A  x=8..62   (55px) — 5 buttons: PACK/WEAR/REMOVE/WIELD/SELF
// Col B  x=66..117 (52px) — 5 buttons: DROP/PICKUP/DRINK/MIX/ZAP
// Col C  x=121..172(52px) — 6 buttons: EAT/READ/THROW/PAY/SELL/DIG
// Col D  x=176..221(46px) — top-4 left: PANIC/CALL/NPC/SKILL, then wide: USEITEM/PLAYBACK/LOOKAT/SETTINGS/MAP/EXAMINE/FARMOVE
// Col E  x=225..270(46px) — top-4 right: QUIT/NAME/ATTACK/POWER
// Square x=249..270(22px) — 6 icons (22×22): rows aligned with Col D wide buttons
// Row DISCOVERIES x=176..270 spans full right-panel width

interface BtnDef {
  key: string
  ox: number
  oy: number
  ow: number
  oh: number
  action: string
}

const ORIGINAL_BUTTONS: BtnDef[] = [
  // Col A
  { key: 'btn_pack',        ox: 8,   oy: 6,   ow: 55, oh: 42, action: 'pack'        },
  { key: 'btn_wear',        ox: 8,   oy: 51,  ow: 55, oh: 50, action: 'wear'        },
  { key: 'btn_remove',      ox: 8,   oy: 104, ow: 55, oh: 50, action: 'remove'      },
  { key: 'btn_wield',       ox: 8,   oy: 157, ow: 55, oh: 38, action: 'wield'       },
  { key: 'btn_self',        ox: 8,   oy: 198, ow: 55, oh: 34, action: 'self'        },

  // Col B
  { key: 'btn_drop',        ox: 66,  oy: 6,   ow: 52, oh: 47, action: 'drop'        },
  { key: 'btn_pickup',      ox: 66,  oy: 55,  ow: 52, oh: 47, action: 'pickup'      },
  { key: 'btn_drink',       ox: 66,  oy: 104, ow: 52, oh: 44, action: 'drink'       },
  { key: 'btn_mix',         ox: 66,  oy: 150, ow: 52, oh: 46, action: 'mix'         },
  { key: 'btn_zap',         ox: 66,  oy: 198, ow: 52, oh: 34, action: 'zap'         },

  // Col C
  { key: 'btn_eat',         ox: 121, oy: 6,   ow: 52, oh: 22, action: 'eat'         },
  { key: 'btn_read',        ox: 121, oy: 30,  ow: 52, oh: 42, action: 'read'        },
  { key: 'btn_throw',       ox: 121, oy: 74,  ow: 52, oh: 41, action: 'throw'       },
  { key: 'btn_pay',         ox: 121, oy: 117, ow: 52, oh: 39, action: 'pay'         },
  { key: 'btn_sell',        ox: 121, oy: 158, ow: 52, oh: 39, action: 'sell'        },
  { key: 'btn_dig',         ox: 121, oy: 199, ow: 52, oh: 33, action: 'dig'         },

  // Right panel — top 4 rows (2 columns each)
  { key: 'btn_panic',       ox: 176, oy: 6,   ow: 46, oh: 17, action: 'panic'       },
  { key: 'btn_quit',        ox: 225, oy: 6,   ow: 46, oh: 17, action: 'quit'        },
  { key: 'btn_call',        ox: 176, oy: 24,  ow: 46, oh: 17, action: 'call'        },
  { key: 'btn_name',        ox: 225, oy: 24,  ow: 46, oh: 17, action: 'name'        },
  { key: 'btn_npc',         ox: 176, oy: 44,  ow: 46, oh: 17, action: 'npc'         },
  { key: 'btn_attack',      ox: 225, oy: 44,  ow: 46, oh: 17, action: 'attack'      },
  { key: 'btn_skill',       ox: 176, oy: 63,  ow: 46, oh: 17, action: 'skill'       },
  { key: 'btn_power',       ox: 225, oy: 63,  ow: 46, oh: 17, action: 'power'       },

  // Right panel — full-width row
  { key: 'btn_discoveries', ox: 176, oy: 82,  ow: 95, oh: 17, action: 'discoveries' },

  // Right panel — wide text buttons (left) + square icon buttons (right)
  { key: 'btn_useitem',     ox: 176, oy: 101, ow: 69, oh: 17, action: 'useitem'     },
  { key: 'btn_playback',    ox: 176, oy: 120, ow: 69, oh: 17, action: 'playback'    },
  { key: 'btn_lookat',      ox: 176, oy: 139, ow: 69, oh: 17, action: 'lookat'      },
  { key: 'btn_settings',    ox: 176, oy: 158, ow: 69, oh: 17, action: 'settings'    },
  { key: 'btn_map',         ox: 176, oy: 177, ow: 69, oh: 17, action: 'map'         },
  { key: 'btn_examine',     ox: 176, oy: 196, ow: 69, oh: 17, action: 'examine'     },
  { key: 'btn_farmove',     ox: 176, oy: 215, ow: 69, oh: 17, action: 'farmove'     },

  // Square icon buttons (22×22) — right of wide text buttons
  { key: 'btn_undo',        ox: 249, oy: 101, ow: 22, oh: 20, action: 'undo'        },
  { key: 'btn_help',        ox: 249, oy: 122, ow: 22, oh: 20, action: 'help'        },
  { key: 'btn_moveup',      ox: 249, oy: 143, ow: 22, oh: 21, action: 'moveup'      },
  { key: 'btn_movedown',    ox: 249, oy: 165, ow: 22, oh: 21, action: 'movedown'    },
  { key: 'btn_escape',      ox: 249, oy: 187, ow: 22, oh: 22, action: 'escape'      },
  { key: 'btn_copyright',   ox: 249, oy: 210, ow: 22, oh: 22, action: 'copyright'   },
]

export class ActionPanel {
  private scaleX = 2
  private scaleY = 2

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
  ) {
    this.build()
  }

  private build(): void {
    const { scene, x, y, w, h, scaleX, scaleY } = this

    const bg = scene.add.graphics()
    bg.fillStyle(0xAAAAAA)
    bg.fillRect(x, y, w, h)

    if (scene.textures.exists('btn_panel')) {
      const img = scene.add.image(x, y, 'btn_panel')
      img.setOrigin(0, 0)
      img.setDisplaySize(ORIG_W * scaleX, ORIG_H * scaleY)
    }

    for (const btn of ORIGINAL_BUTTONS) {
      const bx = x + btn.ox * scaleX
      const by = y + btn.oy * scaleY
      const bw = btn.ow * scaleX
      const bh = btn.oh * scaleY

      const zone = scene.add.zone(bx, by, bw, bh).setOrigin(0, 0).setInteractive()

      zone.on('pointerover', () => {
        const hl = scene.add.graphics()
        hl.fillStyle(0x0000FF, 0.15)
        hl.fillRect(bx, by, bw, bh)
        zone.setData('hl', hl)
      })
      zone.on('pointerout', () => {
        const hl = zone.getData('hl') as Phaser.GameObjects.Graphics | null
        hl?.destroy()
        zone.setData('hl', null)
      })
      zone.on('pointerdown', () => {
        scene.events.emit('btn-action', btn.action)
      })
    }
  }
}
