import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import {
  getState,
  initGameState,
  addReading,
  addDrone,
  updateDrone,
  spendEnergy,
  canFire,
  getDistanceReadings,
  createDrone,
  getScore,
  getTargets,
  markTargetHitAtCell,
  confirmKillViaSensor,
  checkMissionComplete,
  findTargetAtCell,
  isVictory,
} from '../state/gameState.js';
import {
  attemptDetection,
  cellToWorld,
  worldToCell,
  computeBearing,
  cellDistanceMiles,
} from '../systems/sensors.js';
import { triangulateFromTwoDistances } from '../systems/triangulation.js';
import { EFFECTIVENESS, getEffectivenessDisplay } from '../systems/effectiveness.js';
import {
  milesToMeters,
  computeElevation,
  radiansToDegrees,
  degreesToRadians,
} from '../systems/ballistics.js';

const { gridSize, cellPx } = CONFIG;
const WORLD_SIZE = gridSize * cellPx;

function formatSensorReading(type, value) {
  return type === 'bearing'
    ? `Bearing ${value.toFixed(1)}°`
    : `Distance ${value.toFixed(2)} mi`;
}

function ui(id) {
  return document.getElementById(id);
}

export default class MapScene extends Phaser.Scene {
  static uiBound = false;
  constructor() {
    super('MapScene');
    this.selectedDroneType = null;
    this.fireMode = false;
    this.activeDroneSprites = new Map();
    this.isAnimatingFire = false;
    this.isDeployingDrone = false;
    this.targetMarkers = [];
    this.messageHideTimer = null;
  }

  create() {
    initGameState();
    this.drawGrid();
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.setupUI();
    this.readingGraphics = this.add.graphics().setDepth(5);
    this.messageText = this.add
      .text(8, 0, '', {
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    this.layoutMapOverlay();
    this.scale.on('resize', this.layoutMapOverlay, this);

    this.updateUI();

    if (import.meta.env.DEV) {
      console.log('[DEBUG] Hidden targets at cells:', getTargets().map((t) => t.cell));
    }
  }

  drawGrid() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x888888, 1);
    graphics.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    graphics.lineStyle(1, 0x666666, 0.6);
    for (let i = 0; i <= gridSize; i++) {
      const pos = i * cellPx;
      graphics.lineBetween(pos, 0, pos, WORLD_SIZE);
      graphics.lineBetween(0, pos, WORLD_SIZE, pos);
    }
  }

  createPlayer() {
    const state = getState();
    const pos = cellToWorld(state.playerCell);

    this.playerContainer = this.add.container(pos.x, pos.y).setDepth(10);

    // Base platform
    const base = this.add.circle(0, 0, cellPx * 0.8, 0x333333);
    base.setStrokeStyle(2, 0x111111);

    // Turret barrel (triangle pointing up = north/bearing 0)
    this.turret = this.add.triangle(
      0,
      0,
      0,
      -cellPx * 1.5,
      -cellPx * 0.4,
      cellPx * 0.3,
      cellPx * 0.4,
      cellPx * 0.3,
      0xcc4400
    );

    this.playerContainer.add([base, this.turret]);
    this.turretAngle = 0;
    this.turretElevation = 0;
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    const state = getState();
    const playerPos = cellToWorld(state.playerCell);
    cam.centerOn(playerPos.x, playerPos.y);
    cam.setZoom(1);

    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.camStart = { x: 0, y: 0 };
  }

  setupInput() {
    const cam = this.cameras.main;

    this.input.on('wheel', (pointer, _gameObjects, _deltaX, deltaY) => {
      const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Phaser.Math.Clamp(cam.zoom * zoomFactor, 0.3, 4);
      cam.setZoom(newZoom);
    });

    this.input.on('pointerdown', (pointer) => {
      if (pointer.rightButtonDown()) return;

      if (!this.isDeployingDrone && !this.isAnimatingFire) {
        const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
        const cell = worldToCell(worldPoint.x, worldPoint.y);
        if (this.isValidCell(cell)) {
          if (this.fireMode) {
            this.executeFireAtCell(cell);
            return;
          }
          if (this.selectedDroneType) {
            this.deployDrone(cell);
            return;
          }
        }
      }

      this.isDragging = true;
      this.dragStart = { x: pointer.x, y: pointer.y };
      this.camStart = { x: cam.scrollX, y: cam.scrollY };
    });

    this.lastPinchDistance = null;

    this.input.on('pointermove', (pointer) => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        const dx = this.input.pointer1.x - this.input.pointer2.x;
        const dy = this.input.pointer1.y - this.input.pointer2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (this.lastPinchDistance !== null) {
          const scale = dist / this.lastPinchDistance;
          const newZoom = Phaser.Math.Clamp(cam.zoom * scale, 0.3, 4);
          cam.setZoom(newZoom);
        }
        this.lastPinchDistance = dist;
        this.isDragging = false;
        return;
      }

      if (!this.isDragging) return;
      const pdx = (pointer.x - this.dragStart.x) / cam.zoom;
      const pdy = (pointer.y - this.dragStart.y) / cam.zoom;
      cam.scrollX = this.camStart.x - pdx;
      cam.scrollY = this.camStart.y - pdy;
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
      this.lastPinchDistance = null;
    });
  }

  layoutMapOverlay() {
    if (this.messageText) {
      this.messageText.setPosition(8, this.scale.height - 8);
    }
  }

  setupUI() {
    if (MapScene.uiBound) return;
    MapScene.uiBound = true;

    ui('btn-bearing').addEventListener('click', () => this.selectDroneType('bearing'));
    ui('btn-distance').addEventListener('click', () => this.selectDroneType('distance'));
    ui('btn-fire').addEventListener('click', () => this.toggleFireMode());
    ui('btn-restart').addEventListener('click', () => this.scene.restart());
  }

  isValidCell(cell) {
    return cell.x >= 0 && cell.x < gridSize && cell.y >= 0 && cell.y < gridSize;
  }

  selectDroneType(type) {
    const state = getState();
    if (state.gameOver || this.isDeployingDrone || this.isAnimatingFire || this.fireMode) return;

    this.selectedDroneType = this.selectedDroneType === type ? null : type;
    ui('btn-bearing').classList.toggle('active', this.selectedDroneType === 'bearing');
    ui('btn-distance').classList.toggle('active', this.selectedDroneType === 'distance');

    this.updateStatusDisplay();
  }

  toggleFireMode() {
    const state = getState();
    if (state.gameOver || this.isAnimatingFire || this.isDeployingDrone) return;

    if (this.fireMode) {
      this.fireMode = false;
    } else {
      if (!canFire()) return;
      this.fireMode = true;
      this.selectedDroneType = null;
      ui('btn-bearing').classList.remove('active');
      ui('btn-distance').classList.remove('active');
    }

    ui('btn-fire').classList.toggle('active', this.fireMode);
    this.updateStatusDisplay();
    this.updateUI();
  }

  updateStatusDisplay() {
    const status = ui('status-display');
    if (this.fireMode) {
      status.textContent = 'Fire mode: tap the map to aim and fire.';
    } else if (this.selectedDroneType) {
      status.textContent = `Selected: ${this.selectedDroneType} drone. Tap the map to deploy.`;
    } else {
      status.textContent = 'Select a sensor drone, then tap the map to deploy.';
    }
  }

  deployDrone(targetCell) {
    const state = getState();
    if (state.gameOver) return;
    if (!spendEnergy()) {
      this.showMessage('Not enough energy!');
      this.updateUI();
      return;
    }

    const drone = createDrone(this.selectedDroneType, targetCell);
    addDrone(drone);
    this.isDeployingDrone = true;
    this.selectedDroneType = null;
    ui('btn-bearing').classList.remove('active');
    ui('btn-distance').classList.remove('active');

    const playerPos = cellToWorld(state.playerCell);
    const targetPos = cellToWorld(targetCell);

    const sprite = this.add.circle(playerPos.x, playerPos.y, cellPx * 0.35, 0x00aaff);
    sprite.setStrokeStyle(1, 0xffffff);
    sprite.setDepth(8);
    this.activeDroneSprites.set(drone.id, sprite);

    updateDrone(drone.id, { status: 'traveling' });
    this.updateUI();

    const halfDuration = CONFIG.droneTravelDurationMs / 2;

    this.tweens.add({
      targets: sprite,
      x: targetPos.x,
      y: targetPos.y,
      duration: halfDuration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.onDroneArrived(drone, targetCell, sprite, halfDuration);
      },
    });
  }

  onDroneArrived(drone, droneCell, sprite, returnDuration) {
    const state = getState();
    const { detected, reading, effectivenessResults } = attemptDetection(
      drone.type,
      droneCell,
      state.targets
    );

    if (detected && reading) {
      addReading(reading);
      updateDrone(drone.id, { status: 'returning', resultReadingId: reading.id });

      const readingDetail = formatSensorReading(drone.type, reading.value);

      const effParts = [];
      let pointsScored = 0;

      for (const { target, effectiveness, effectivenessReading } of effectivenessResults) {
        addReading(effectivenessReading);
        const display = getEffectivenessDisplay(effectiveness);
        const effLabel = display ? `${display.label} (${display.percentRange})` : effectiveness;
        effParts.push(effLabel);

        if (effectiveness === EFFECTIVENESS.COMBAT_INEFFECTIVE) {
          if (confirmKillViaSensor(target)) pointsScored++;
        }
      }

      let message = `${drone.type} drone: contact! ${readingDetail} — ${effParts.join('; ')}`;
      if (pointsScored === 1) {
        message += ' — +1 point — Combat Ineffective unit confirmed destroyed';
      } else if (pointsScored > 1) {
        message += ` — +${pointsScored} points — Combat Ineffective units confirmed destroyed`;
      }

      const missionComplete = checkMissionComplete();
      if (missionComplete) {
        message += ' — All targets destroyed';
      }

      this.showMessage(message, missionComplete ? 8000 : 4000);
      this.drawReadings();
    } else {
      updateDrone(drone.id, { status: 'returning', resultReadingId: null });
      this.showMessage(`${drone.type} drone: no contact.`);
    }

    this.updateUI();

    const playerPos = cellToWorld(state.playerCell);
    this.tweens.add({
      targets: sprite,
      x: playerPos.x,
      y: playerPos.y,
      duration: returnDuration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        sprite.destroy();
        this.activeDroneSprites.delete(drone.id);
        updateDrone(drone.id, { status: 'complete' });
        this.isDeployingDrone = false;
        this.updateUI();
      },
    });
  }

  drawReadings() {
    const g = this.readingGraphics;
    g.clear();

    const state = getState();
    const milesToPx = cellPx / CONFIG.cellSizeMiles;

    for (const reading of state.readings) {
      if (reading.type === 'bearing') {
        const sensorPos = cellToWorld(reading.sensorCell);
        const angleRad = degreesToRadians(reading.value);
        const rayLength = WORLD_SIZE * 1.5;
        const endX = sensorPos.x + Math.sin(angleRad) * rayLength;
        const endY = sensorPos.y - Math.cos(angleRad) * rayLength;
        g.lineStyle(2, 0xffcc00, 0.9);
        g.lineBetween(sensorPos.x, sensorPos.y, endX, endY);
      } else if (reading.type === 'distance') {
        const sensorPos = cellToWorld(reading.sensorCell);
        const radiusPx = reading.value * milesToPx;
        g.lineStyle(1.5, 0x00ff88, 0.8);
        g.strokeCircle(sensorPos.x, sensorPos.y, radiusPx);
      }
    }

    const distances = getDistanceReadings();
    if (distances.length >= 2) {
      const d1 = distances[distances.length - 2];
      const d2 = distances[distances.length - 1];
      const ambiguousPoints = triangulateFromTwoDistances(d1, d2);
      for (const point of ambiguousPoints) {
        const pos = cellToWorld(point);
        g.fillStyle(0xff88ff, 0.35);
        g.fillCircle(pos.x, pos.y, cellPx * 0.35);
      }
    }
  }

  executeFireAtCell(aimCell) {
    const state = getState();
    if (state.gameOver || this.isAnimatingFire || this.isDeployingDrone || !this.fireMode) return;

    if (!spendEnergy()) {
      this.showMessage('Not enough energy!');
      this.updateUI();
      return;
    }

    this.fireMode = false;
    ui('btn-fire').classList.remove('active');
    this.isAnimatingFire = true;
    this.updateStatusDisplay();
    this.updateUI();

    const bearing = computeBearing(state.playerCell, aimCell);
    const distanceMiles = cellDistanceMiles(state.playerCell, aimCell);
    const rangeMeters = milesToMeters(distanceMiles);
    const elevationResult = computeElevation(rangeMeters);

    if (!elevationResult.valid) {
      this.showMessage(elevationResult.message);
      this.isAnimatingFire = false;
      this.updateUI();
      return;
    }

    const hitTarget = findTargetAtCell(aimCell);
    const isHit = hitTarget !== null;
    const elevationDeg = radiansToDegrees(elevationResult.elevationRadians);
    this.animateFire(bearing, elevationDeg, distanceMiles, isHit, aimCell);
  }

  animateFire(bearingDeg, elevationDeg, distanceMiles, isHit, aimCell) {
    const playerPos = cellToWorld(getState().playerCell);
    const milesToPx = cellPx / CONFIG.cellSizeMiles;
    const targetDistPx = distanceMiles * milesToPx;

    const bearingRad = degreesToRadians(bearingDeg);

    // Phase 1: rotate turret to bearing
    this.tweens.add({
      targets: this,
      turretAngle: bearingDeg,
      duration: 800,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.turret.setRotation(degreesToRadians(this.turretAngle));
      },
      onComplete: () => {
        // Phase 2: elevate (visual: scale Y to simulate elevation)
        this.tweens.add({
          targets: this,
          turretElevation: elevationDeg,
          duration: 600,
          ease: 'Sine.easeInOut',
          onUpdate: () => {
            const elevScale = 1 - this.turretElevation / 90 * 0.3;
            this.turret.setScale(1, Math.max(0.5, elevScale));
          },
          onComplete: () => {
            // Phase 3: fire projectile arc
            this.fireProjectile(playerPos, bearingRad, elevationDeg, targetDistPx, isHit, aimCell);
          },
        });
      },
    });
  }

  fireProjectile(startPos, bearingRad, elevationDeg, targetDistPx, isHit, aimCell) {
    const projectile = this.add.circle(startPos.x, startPos.y, 4, 0xff2200).setDepth(15);
    const endX = startPos.x + Math.sin(bearingRad) * targetDistPx;
    const endY = startPos.y - Math.cos(bearingRad) * targetDistPx;
    const arcHeight = targetDistPx * Math.tan(degreesToRadians(elevationDeg)) * 0.5;

    const curve = new Phaser.Curves.QuadraticBezier(
      new Phaser.Math.Vector2(startPos.x, startPos.y),
      new Phaser.Math.Vector2(
        (startPos.x + endX) / 2,
        (startPos.y + endY) / 2 - arcHeight
      ),
      new Phaser.Math.Vector2(endX, endY)
    );

    const follower = { t: 0 };
    this.tweens.add({
      targets: follower,
      t: 1,
      duration: 1500,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const point = curve.getPoint(follower.t);
        projectile.setPosition(point.x, point.y);
      },
      onComplete: () => {
        const impact = this.add.circle(endX, endY, cellPx, 0xff6600, 0.8).setDepth(15);
        this.tweens.add({
          targets: impact,
          scale: 2,
          alpha: 0,
          duration: 500,
          onComplete: () => impact.destroy(),
        });
        projectile.destroy();

        if (isHit) {
          markTargetHitAtCell(aimCell);
        }
        this.showMessage('Fire mission complete.');
        this.isAnimatingFire = false;
        this.updateUI();
      },
    });
  }

  showMessage(text, durationMs = 4000) {
    if (this.messageHideTimer) {
      this.messageHideTimer.remove();
      this.messageHideTimer = null;
    }
    this.messageText.setText(text).setVisible(true);
    this.messageHideTimer = this.time.delayedCall(durationMs, () => {
      this.messageText.setVisible(false);
      this.messageHideTimer = null;
    });
  }

  revealTargets() {
    if (this.targetMarkers.length > 0) return;

    for (const target of getTargets()) {
      const pos = cellToWorld(target.cell);
      const container = this.add.container(pos.x, pos.y).setDepth(12);

      const g = this.add.graphics();
      const arm = cellPx * 0.55;
      g.lineStyle(3, 0xff2222, 1);
      g.lineBetween(-arm, -arm, arm, arm);
      g.lineBetween(arm, -arm, -arm, arm);
      g.lineStyle(2, 0xff2222, 0.85);
      g.strokeCircle(0, 0, cellPx * 0.65);

      container.add(g);
      this.targetMarkers.push(container);
    }
  }

  updateUI() {
    const state = getState();
    ui('energy-display').textContent = `Energy ${state.energy}`;
    ui('score-display').textContent = `Score ${getScore()}`;

    const missionEl = ui('mission-complete');
    if (state.missionCompleteReported) {
      missionEl.classList.remove('hidden');
    } else {
      missionEl.classList.add('hidden');
    }

    ui('btn-fire').disabled =
      ((!canFire() && !this.fireMode) || state.gameOver || this.isAnimatingFire || this.isDeployingDrone);

    ui('btn-fire').classList.toggle('active', this.fireMode);

    const bearingBtn = ui('btn-bearing');
    const distanceBtn = ui('btn-distance');
    const disabled =
      state.gameOver || this.isDeployingDrone || this.isAnimatingFire || this.fireMode;
    bearingBtn.disabled = disabled;
    distanceBtn.disabled = disabled;

    const list = ui('readings-list');
    list.innerHTML = '';
    state.readings.forEach((r) => {
      const li = document.createElement('li');
      const sensor = `sensor ${r.sensorCell.x},${r.sensorCell.y}`;
      if (r.type === 'bearing') {
        li.textContent = `Bearing: ${r.value.toFixed(1)}° (${sensor})`;
      } else if (r.type === 'distance') {
        li.textContent = `Distance: ${r.value.toFixed(2)} mi (${sensor})`;
      } else if (r.type === 'effectiveness') {
        const display = getEffectivenessDisplay(r.value);
        const label = display ? display.label : r.value;
        li.textContent = `Effectiveness: ${label} (${sensor})`;
        if (display) {
          li.style.color = display.color;
          li.style.fontWeight = '600';
        }
      }
      list.appendChild(li);
    });

    const gameOverEl = ui('game-over');
    if (isVictory()) {
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.add('victory');
      ui('game-over-title').textContent = 'Mission Complete';
      ui('game-over-message').textContent =
        `All targets destroyed and confirmed. Score: ${getScore()}`;
    } else if (state.gameOver) {
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.remove('victory');
      ui('game-over-title').textContent = 'Game Over';
      ui('game-over-message').textContent =
        'Energy depleted. Target locations revealed on map.';
      this.revealTargets();
    } else {
      gameOverEl.classList.add('hidden');
      gameOverEl.classList.remove('victory');
    }
  }
}
