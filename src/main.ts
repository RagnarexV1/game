import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'
import { GAME_W, GAME_H } from './ui/Layout'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_W,
  height: GAME_H,
  parent: 'game-container',
  backgroundColor: '#000000',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scene: [BootScene, GameScene],
}

new Phaser.Game(config)
