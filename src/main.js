import Phaser from 'phaser';
import MapScene from './scenes/MapScene.js';
import './style.css';

const config = {
  type: Phaser.AUTO,
  width: Math.min(window.innerWidth, 1200),
  height: Math.min(window.innerHeight, 800),
  parent: 'app',
  backgroundColor: '#444444',
  scene: [MapScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
  },
};

new Phaser.Game(config);
