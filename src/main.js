import Phaser from 'phaser';
import MapScene from './scenes/MapScene.js';
import './style.css';

function getMapPaneSize() {
  const pane = document.getElementById('map-pane');
  const width = pane.clientWidth || window.innerWidth;
  const height = pane.clientHeight || Math.floor(window.innerHeight * 0.5);
  return { width, height };
}

let game;

function startGame() {
  const { width, height } = getMapPaneSize();

  game = new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent: 'map-pane',
    backgroundColor: '#444444',
    scene: [MapScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 2,
    },
  });

  window.addEventListener('resize', () => {
    const size = getMapPaneSize();
    game.scale.resize(size.width, size.height);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGame);
} else {
  startGame();
}
