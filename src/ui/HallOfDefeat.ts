import Phaser from 'phaser'
import { GAME_W, GAME_H } from './Layout'
import type { LeaderboardEntry } from '../engine/LeaderboardSystem'

/** Index of the run that was just recorded (the last match, as the stable sort puts it after older identical runs). */
export function findRunIndex(entries: LeaderboardEntry[], run: { name: string; score: number; cause: string }): number {
  return entries.findLastIndex(e => e.score === run.score && e.name === run.name && e.cause === run.cause)
}

/**
 * Draws the full-screen leaderboard ("HALL OF DEFEAT" / "HALL OF VICTORY") with
 * the just-finished run at `playerIdx` highlighted in `highlight`.
 */
export function drawHallOfDefeat(
  scene: Phaser.Scene,
  entries: LeaderboardEntry[],
  playerIdx: number,
  title: string,
  highlight: string,
): void {
  // Full-screen defeat image
  scene.add.image(GAME_W / 2, GAME_H / 2, 'ui_defeat')
    .setDisplaySize(GAME_W, GAME_H)
    .setDepth(200)

  // Dark overlay for text legibility
  scene.add.graphics()
    .fillStyle(0x000000, 0.55)
    .fillRect(0, 0, GAME_W, GAME_H)
    .setDepth(201)

  // Leaderboard title
  scene.add.text(GAME_W / 2, 60, title, {
    fontSize: '40px', color: '#c8a000', fontFamily: 'monospace', fontStyle: 'bold',
  }).setOrigin(0.5).setDepth(202)

  // Column positions
  const CX = { rank: 220, score: 390, name: 415, world: 650, hp: 870, cause: 970 }
  const col = (x: number, y: number, text: string, color: string, rightAlign = false) =>
    scene.add.text(x, y, text, { fontSize: '22px', color, fontFamily: 'monospace' })
      .setOrigin(rightAlign ? 1 : 0, 0).setDepth(202)

  // Column headers
  col(CX.rank,  120, '#',     '#888888')
  col(CX.score, 120, 'SCORE', '#888888', true)
  col(CX.name,  120, 'NAME',  '#888888')
  col(CX.world, 120, 'WORLD', '#888888')
  col(CX.hp,    120, 'HP',    '#888888')
  col(CX.cause, 120, 'CAUSE', '#888888')

  // Entries — top 15, or top 10 + dots + player context
  type DisplayRow = { entry: LeaderboardEntry; rank: number } | 'dots'
  const rows: DisplayRow[] = []

  if (playerIdx < 15) {
    entries.slice(0, 15).forEach((e, i) => rows.push({ entry: e, rank: i + 1 }))
  } else {
    entries.slice(0, 10).forEach((e, i) => rows.push({ entry: e, rank: i + 1 }))
    rows.push('dots')
    const start = Math.max(10, playerIdx - 2)
    const end   = Math.min(entries.length - 1, playerIdx + 2)
    for (let i = start; i <= end; i++) rows.push({ entry: entries[i], rank: i + 1 })
  }

  rows.forEach((row, i) => {
    const y = 158 + i * 36
    if (row === 'dots') { col(CX.rank, y, '...', '#888888'); return }
    const { entry: e, rank } = row
    const isPlayer = rank === playerIdx + 1
    const style = isPlayer ? 'bold' : 'normal'
    const tint = (c: string) => isPlayer ? highlight : c
    const addText = (x: number, text: string, color: string, rightAlign = false) =>
      scene.add.text(x, y, text, { fontSize: '22px', color: tint(color), fontFamily: 'monospace', fontStyle: style })
        .setOrigin(rightAlign ? 1 : 0, 0).setDepth(202)
    addText(CX.rank,  `#${rank}`,           '#e0e0e0')
    addText(CX.score, String(e.score),      '#ffcc00', true)
    addText(CX.name,  e.name,               '#e0e0e0')
    addText(CX.world, e.level,              '#80c0ff')
    addText(CX.hp,    `${e.hp}/${e.maxHp}`, '#ff8080')
    addText(CX.cause, e.cause ?? '—',       '#c0c080')
  })
}
