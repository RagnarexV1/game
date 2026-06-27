// 1280×960 layout — 2× the original 640×480 Ragnarok layout

export const GAME_W = 1600
export const GAME_H = 960
export const TILE = 32

// World map (top strip)
export const WORLD_MAP_X = 0
export const WORLD_MAP_Y = 0
export const WORLD_MAP_W = GAME_W
export const WORLD_MAP_H = 392

// Bottom row starts here
export const BOTTOM_Y = WORLD_MAP_H
export const BOTTOM_H = GAME_H - WORLD_MAP_H  // 568

// Panel height for the three side-by-side columns (button panel content = 237px × 2)
export const PANELS_H = 474

// Message log: full-width strip at the very bottom
export const MSG_H = BOTTOM_H - PANELS_H   // 94
export const MSG_X = 0
export const MSG_Y = BOTTOM_Y + PANELS_H   // 866
export const MSG_W = GAME_W                // 1600

// Stats panel (bottom-left)
// Original: x=0–154 → 155px at 1× → 310px at 2×
export const STATS_X = 0
export const STATS_Y = BOTTOM_Y
export const STATS_W = 310
export const STATS_H = PANELS_H            // 474

// Center area (local map)
// Wider than strict 2× to give the map room — 1600 - 310 - 528 = 762
export const CENTER_X = STATS_W
export const CENTER_Y = BOTTOM_Y
export const CENTER_W = 730
export const CENTER_H = PANELS_H

// Local map fills the full center column height
export const LOCAL_MAP_X = CENTER_X
export const LOCAL_MAP_Y = CENTER_Y
export const LOCAL_MAP_W = CENTER_W
export const LOCAL_MAP_H = PANELS_H        // 474

// Action buttons (bottom-right)
// Original: x=376–639 → 264px at 1× → 528px at 2×
export const BUTTONS_X = CENTER_X + CENTER_W   // 1072
export const BUTTONS_Y = BOTTOM_Y
export const BUTTONS_W = GAME_W - BUTTONS_X    // 528
export const BUTTONS_H = PANELS_H              // 474

// Colors matching original DOS palette
export const COLORS = {
  bgDark:    0x000000,
  bgPanel:   0x1a1a1a,
  bgMap:     0x000814,
  border:    0x606060,
  borderBright: 0xa0a0a0,
  text:      0xc0c0c0,
  textBright: 0xffffff,
  textDim:   0x606060,
  hpBar:     0x00c000,
  hpBarLow:  0xc00000,
  foodBar:   0x0070b0,
  statLabel: 0x808080,
  statValue: 0xffffff,
  btnFace:   0x404040,
  btnBorder: 0x808080,
  btnText:   0xd0d0d0,
  btnHover:  0x606060,
  msgDefault: 0xc0c0c0,
  msgHit:    0xffff00,
  msgDanger: 0xff4040,
  msgGood:   0x00ff80,
  msgInfo:   0x00c0ff,
}
