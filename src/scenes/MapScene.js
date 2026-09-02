import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import {
  getState,
  initGameState,
  addReading,
  createReading,
  addDrone,
  updateDrone,
  spendMoney,
  getDistanceReadings,
  createDrone,
  getScore,
  getMoney,
  getContractSummary,
  getTargets,
  markTargetHitAtCell,
  confirmKillViaSensor,
  checkMissionComplete,
  findTargetAtCell,
  isVictory,
  revealTargetVisually,
} from '../state/gameState.js';
import {
  attemptDetection,
  cellToWorld,
  worldToCell,
  computeBearing,
  cellDistanceMiles,
  isTargetInRange,
} from '../systems/sensors.js';
import {
  revealCellsInRange,
  revealCellsInRangeFromWorld,
  revealCircle,
  isRevealed,
} from '../systems/fogOfWar.js';
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

function formatMoney(amount) {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return Number.isInteger(k) ? `$${k}K` : `$${k.toFixed(1)}K`;
  }
  return `$${amount}`;
}

function formatSensorReading(type, value) {
  return type === 'bearing'
    ? `Bearing ${value.toFixed(1)}°`
    : `Distance ${value.toFixed(2)} mi`;
}

function ui(id) {
  return document.getElementById(id);
}

const ACTION_LABELS = {
  bearing: 'Bearing',
  distance: 'Distance',
  fire: 'Fire Mission',
};

export default class MapScene extends Phaser.Scene {
  static uiBound = false;
  constructor() {
    super('MapScene');
    /** @type {{ type: 'bearing' | 'distance' | 'fire', cell: { x: number, y: number } | null } | null} */
    this.pendingAction = null;
    this.pendingMarker = null;
    this.mapPointer = { pendingTap: false, startX: 0, startY: 0 };
    this.activeDroneSprites = new Map();
    this.isAnimatingFire = false;
    this.isDeployingDrone = false;
    this.targetMarkers = [];
    this.spottedTargetMarkers = [];
    this.messageHideTimer = null;
  }

  create() {
    initGameState();
    this.drawGrid();
    this.fogGraphics = this.add.graphics().setDepth(6);
    this.drawFog();
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

    this.updateActionUI();
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

  drawFog() {
    const g = this.fogGraphics;
    g.clear();
    g.fillStyle(0x0a0a14, 0.72);

    const revealed = getState().revealedCells;
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        if (!isRevealed(revealed, { x, y })) {
          g.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }
  }

  revealFogAroundWorld(worldX, worldY, radiusMiles) {
    const anyNew = revealCellsInRangeFromWorld(
      getState().revealedCells,
      worldX,
      worldY,
      radiusMiles
    );
    if (anyNew) this.drawFog();
    return anyNew;
  }

  spotTargetsInRange(centerCell, radiusMiles) {
    for (const target of getTargets()) {
      if (target.visuallyRevealed || target.killConfirmed) continue;
      if (!isTargetInRange(centerCell, target.cell, radiusMiles)) continue;
      if (!revealTargetVisually(target.id)) continue;
      this.createSpottedMarker(target);
      this.showMessage(
        `Visual contact: enemy at (${target.cell.x}, ${target.cell.y})`
      );
    }
  }

  createSpottedMarker(target) {
    const pos = cellToWorld(target.cell);
    const container = this.add.container(pos.x, pos.y).setDepth(12);
    const g = this.add.graphics();
    const s = cellPx * 0.45;

    g.fillStyle(0xff8800, 0.95);
    g.fillTriangle(0, -s, s, 0, 0, s);
    g.fillTriangle(0, -s, -s, 0, 0, s);
    g.lineStyle(2, 0xffcc44, 1);
    g.strokeTriangle(0, -s, s, 0, 0, s);
    g.strokeTriangle(0, -s, -s, 0, 0, s);

    container.add(g);
    this.spottedTargetMarkers.push({ targetId: target.id, container });
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

      if (this.pendingAction && !this.isDeployingDrone && !this.isAnimatingFire) {
        this.mapPointer.pendingTap = true;
        this.mapPointer.startX = pointer.x;
        this.mapPointer.startY = pointer.y;
        this.dragStart = { x: pointer.x, y: pointer.y };
        this.camStart = { x: cam.scrollX, y: cam.scrollY };
        return;
      }

      this.isDragging = true;
      this.dragStart = { x: pointer.x, y: pointer.y };
      this.camStart = { x: cam.scrollX, y: cam.scrollY };
    });

    this.lastPinchDistance = null;

    this.input.on('pointermove', (pointer) => {
      if (this.mapPointer.pendingTap) {
        const dx = pointer.x - this.mapPointer.startX;
        const dy = pointer.y - this.mapPointer.startY;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          this.mapPointer.pendingTap = false;
          this.isDragging = true;
        }
      }

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

    this.input.on('pointerup', (pointer) => {
      if (this.mapPointer.pendingTap && this.pendingAction) {
        const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
        const cell = worldToCell(worldPoint.x, worldPoint.y);
        if (this.isValidCell(cell)) {
          this.pendingAction.cell = { x: cell.x, y: cell.y };
          this.drawPendingMarker();
          this.updateActionUI();
        }
      }

      this.mapPointer.pendingTap = false;
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

    ui('btn-bearing').addEventListener('click', () => this.onActionButton('bearing'));
    ui('btn-distance').addEventListener('click', () => this.onActionButton('distance'));
    ui('btn-fire').addEventListener('click', () => this.onActionButton('fire'));
    ui('btn-restart').addEventListener('click', () => this.scene.restart());
  }

  isValidCell(cell) {
    return cell.x >= 0 && cell.x < gridSize && cell.y >= 0 && cell.y < gridSize;
  }

  onActionButton(type) {
    const state = getState();
    if (state.gameOver || this.isDeployingDrone || this.isAnimatingFire) return;

    const pending = this.pendingAction;

    if (pending?.type === type && pending.cell) {
      this.confirmPendingAction();
      return;
    }

    if (pending?.type === type && !pending.cell) {
      this.clearPendingAction();
      return;
    }

    const switchingSensorType =
      pending?.cell &&
      (pending.type === 'bearing' || pending.type === 'distance') &&
      (type === 'bearing' || type === 'distance');

    this.pendingAction = {
      type,
      cell: switchingSensorType ? pending.cell : null,
    };
    this.drawPendingMarker();
    this.updateActionUI();
  }

  confirmPendingAction() {
    const pending = this.pendingAction;
    if (!pending?.cell) return;

    const cell = { ...pending.cell };
    this.clearPendingAction();

    if (pending.type === 'fire') {
      this.executeFireAtCell(cell);
    } else {
      this.deployDrone(pending.type, cell);
    }
  }

  clearPendingAction() {
    this.pendingAction = null;
    if (this.pendingMarker) {
      this.pendingMarker.destroy();
      this.pendingMarker = null;
    }
    this.updateActionUI();
  }

  drawPendingMarker() {
    if (this.pendingMarker) {
      this.pendingMarker.destroy();
      this.pendingMarker = null;
    }

    const pending = this.pendingAction;
    const cell = pending?.cell;
    if (!cell) return;

    const pos = cellToWorld(cell);
    const container = this.add.container(pos.x, pos.y).setDepth(11);
    const g = this.add.graphics();

    const isSensor = pending.type === 'bearing' || pending.type === 'distance';
    if (isSensor) {
      const rangePx = (CONFIG.detectionRadiusMiles / CONFIG.cellSizeMiles) * cellPx;
      g.fillStyle(0x00ccff, 0.1);
      g.fillCircle(0, 0, rangePx);
      g.lineStyle(1.5, 0x00ccff, 0.5);
      g.strokeCircle(0, 0, rangePx);
    }

    const r = cellPx * 0.45;
    g.lineStyle(2, 0xffffff, 0.95);
    g.strokeCircle(0, 0, r);
    g.lineStyle(2, 0x00ccff, 0.9);
    g.lineBetween(-r, 0, r, 0);
    g.lineBetween(0, -r, 0, r);
    container.add(g);
    this.pendingMarker = container;
  }

  setActionButtonState(btnId, { active, confirm, coords }) {
    const type = btnId === 'btn-fire' ? 'fire' : btnId.replace('btn-', '');
    const btn = ui(btnId);
    const label = btn.querySelector('.btn-label');
    const cost = btn.querySelector('.btn-cost');

    btn.classList.toggle('active', active);
    btn.classList.toggle('confirm-ready', confirm);

    if (confirm) {
      label.textContent = 'Confirm coords';
      cost.textContent = coords ?? '';
      cost.style.display = coords ? 'block' : 'none';
    } else {
      label.textContent = ACTION_LABELS[type];
      cost.textContent = formatMoney(CONFIG.actionCost);
      cost.style.display = 'block';
    }
  }

  updateActionUI() {
    const pending = this.pendingAction;
    const types = ['bearing', 'distance', 'fire'];

    for (const type of types) {
      const btnId = type === 'fire' ? 'btn-fire' : `btn-${type}`;
      const isActive = pending?.type === type;
      const confirm = isActive && pending.cell !== null;
      const coords = confirm ? `(${pending.cell.x}, ${pending.cell.y})` : null;
      this.setActionButtonState(btnId, { active: isActive, confirm, coords });
    }

    this.updateStatusDisplay();
    this.updateUI();
  }

  updateStatusDisplay() {
    const status = ui('status-display');
    const pending = this.pendingAction;

    if (!pending) {
      status.textContent = 'Select an action, then tap the map to choose coordinates.';
      return;
    }

    const name =
      pending.type === 'fire' ? 'Fire mission' : `${pending.type} drone`;

    if (pending.cell) {
      const rangeNote =
        pending.type === 'bearing' || pending.type === 'distance'
          ? ` Scan radius: ${CONFIG.detectionRadiusMiles} mi (clears fog).`
          : '';
      status.textContent = `${name}: (${pending.cell.x}, ${pending.cell.y}) — tap map to change, press Confirm coords to execute.${rangeNote}`;
    } else {
      status.textContent = `${name}: tap the map to select coordinates.`;
    }
  }

  deployDrone(type, targetCell) {
    const state = getState();
    if (state.gameOver) return;
    if (!spendMoney()) {
      this.showMessage('Not enough money!');
      this.updateUI();
      return;
    }

    const drone = createDrone(type, targetCell);
    addDrone(drone);
    this.isDeployingDrone = true;

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
      onUpdate: () => {
        this.revealFogAroundWorld(sprite.x, sprite.y, CONFIG.visualRangeMiles);
        this.spotTargetsInRange(
          worldToCell(sprite.x, sprite.y),
          CONFIG.visualRangeMiles
        );
      },
      onComplete: () => {
        this.onDroneArrived(drone, targetCell, sprite, halfDuration);
      },
    });
  }

  onDroneArrived(drone, droneCell, sprite, returnDuration) {
    const state = getState();

    revealCircle(state.revealedCells, droneCell, CONFIG.detectionRadiusMiles);
    this.drawFog();
    this.spotTargetsInRange(droneCell, CONFIG.visualRangeMiles);

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
      let contractsPaid = 0;
      let payoutTotal = 0;

      for (const { target, effectiveness, effectivenessReading } of effectivenessResults) {
        addReading(effectivenessReading);
        const display = getEffectivenessDisplay(effectiveness);
        const effLabel = display ? `${display.label} (${display.percentRange})` : effectiveness;
        effParts.push(effLabel);

        if (effectiveness === EFFECTIVENESS.COMBAT_INEFFECTIVE) {
          if (confirmKillViaSensor(target)) {
            contractsPaid++;
            payoutTotal += target.contractValue;
            addReading(
              createReading('contract', target.contractValue, droneCell, target.id)
            );
          }
        }
      }

      let message = `${drone.type} drone: contact! ${readingDetail} — ${effParts.join('; ')}`;
      if (contractsPaid === 1) {
        message += ` — ${formatMoney(payoutTotal)} contract paid — Combat Ineffective unit confirmed destroyed`;
      } else if (contractsPaid > 1) {
        message += ` — ${formatMoney(payoutTotal)} contracts paid — Combat Ineffective units confirmed destroyed`;
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
      onUpdate: () => {
        this.revealFogAroundWorld(sprite.x, sprite.y, CONFIG.visualRangeMiles);
        this.spotTargetsInRange(
          worldToCell(sprite.x, sprite.y),
          CONFIG.visualRangeMiles
        );
      },
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
    if (state.gameOver || this.isAnimatingFire || this.isDeployingDrone) return;

    if (!spendMoney()) {
      this.showMessage('Not enough money!');
      this.updateUI();
      return;
    }

    this.isAnimatingFire = true;
    this.updateActionUI();

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
        addReading(createReading('fire', 0, aimCell));
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
    ui('money-display').textContent = formatMoney(getMoney());
    ui('score-display').textContent = `Earned ${formatMoney(getScore())}`;

    const { count, totalValue } = getContractSummary();
    const contractsEl = ui('contracts-display');
    if (count === 0) {
      contractsEl.textContent = 'All contracts fulfilled';
    } else {
      contractsEl.textContent = `${count} × ${formatMoney(CONFIG.contractValue)} contracts active (${formatMoney(totalValue)} total)`;
    }

    const missionEl = ui('mission-complete');
    if (state.missionCompleteReported) {
      missionEl.classList.remove('hidden');
    } else {
      missionEl.classList.add('hidden');
    }

    const bearingBtn = ui('btn-bearing');
    const distanceBtn = ui('btn-distance');
    const fireBtn = ui('btn-fire');
    const pending = this.pendingAction;
    const busy = state.gameOver || this.isDeployingDrone || this.isAnimatingFire;

    bearingBtn.disabled = busy || pending?.type === 'fire';
    distanceBtn.disabled = busy || pending?.type === 'fire';
    fireBtn.disabled = busy || (pending !== null && pending.type !== 'fire');

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
      } else if (r.type === 'contract') {
        li.textContent = `Kill confirmed — ${formatMoney(r.value)} contract awarded`;
      } else if (r.type === 'fire') {
        li.textContent = `Fire mission complete at (${r.sensorCell.x}, ${r.sensorCell.y})`;
      }
      list.appendChild(li);
    });

    const gameOverEl = ui('game-over');
    if (isVictory()) {
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.add('victory');
      ui('game-over-title').textContent = 'Mission Complete';
      ui('game-over-message').textContent =
        `All targets destroyed and confirmed. Earned ${formatMoney(getScore())} — Balance ${formatMoney(getMoney())}`;
    } else if (state.gameOver) {
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.remove('victory');
      ui('game-over-title').textContent = 'Game Over';
      ui('game-over-message').textContent =
        'Out of money. Target locations revealed on map.';
      this.revealTargets();
    } else {
      gameOverEl.classList.add('hidden');
      gameOverEl.classList.remove('victory');
    }
  }
}
