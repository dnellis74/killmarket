import Phaser from 'phaser';
import { CONFIG, getActionCost, getDetectionRadiusMiles } from '../config.js';
import {
  getState,
  initGameState,
  addReading,
  createReading,
  addDrone,
  updateDrone,
  spendMoney,
  getRangeReadings,
  createDrone,
  getScore,
  getMoney,
  getContractSummary,
  getTargets,
  applyMunitionImpact,
  confirmKillViaSensor,
  checkMissionComplete,
  checkBankruptcy,
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
import { DEFAULT_MUNITION_ID, getMunitionDef } from '../data/munitionDefs.js';
import { speakVisualContact, speakTargetNeutralized, speakMissionComplete, speakBudgetExhausted } from '../systems/speech.js';
import {
  createDeployedSensor,
  updateDeployedSensors,
  drawDeployedSensors,
} from '../systems/deployedSensors.js';
import { createCrater, drawCraters } from '../systems/craters.js';
import {
  trackGameStart,
  trackDroneDeploy,
  trackFireMissionComplete,
  trackKillConfirmed,
  trackGameOverMoney,
  trackMissionComplete,
} from '../analytics.js';

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

function formatSensorReading(type, value, uncertaintyDeg = null) {
  if (type === 'bearing') {
    if (uncertaintyDeg != null && uncertaintyDeg > 0.5) {
      const arc = uncertaintyDeg * 2;
      return `Passive ${value.toFixed(0)}° ±${uncertaintyDeg.toFixed(0)}° (${arc.toFixed(0)}° arc)`;
    }
    return `Passive ${value.toFixed(1)}°`;
  }
  return `Active ${value.toFixed(2)} mi`;
}

function formatDroneLabel(type) {
  return type === 'bearing' ? 'Passive' : type === 'range' ? 'Active' : type;
}

function ui(id) {
  return document.getElementById(id);
}

const ACTION_LABELS = {
  bearing: 'Passive',
  range: 'Active',
  fire: 'Fire Mission',
};

export default class MapScene extends Phaser.Scene {
  static uiBound = false;
  constructor() {
    super('MapScene');
    /** @type {{ type: 'bearing' | 'range' | 'fire', cell: { x: number, y: number } | null } | null} */
    this.pendingAction = null;
    this.pendingMarker = null;
    this.mapPointer = { pendingTap: false, startX: 0, startY: 0 };
    this.activeDroneSprites = new Map();
    this.isAnimatingFire = false;
    this.isDeployingDrone = false;
    this.targetMarkers = [];
    this.spottedTargetMarkers = [];
    this.deployedSensors = [];
    this.craters = [];
  }

  preload() {
    this.load.image(CONFIG.backdropKey, CONFIG.backdropUrl);
    this.load.image(
      CONFIG.backdropGreyscaleKey,
      CONFIG.backdropGreyscaleUrl
    );
  }

  create() {
    initGameState();
    trackGameStart();
    this.pendingAction = null;
    this.pendingMarker = null;
    this.activeDroneSprites = new Map();
    this.isAnimatingFire = false;
    this.isDeployingDrone = false;
    this.targetMarkers = [];
    this.spottedTargetMarkers = [];
    this.deployedSensors = [];
    this.craters = [];
    this.logEntries = [];

    this.aerialMaskCanvas = document.createElement('canvas');
    this.aerialMaskCanvas.width = WORLD_SIZE;
    this.aerialMaskCanvas.height = WORLD_SIZE;
    this.aerialMaskCtx = this.aerialMaskCanvas.getContext('2d');
    if (this.textures.exists('aerial-mask')) {
      this.textures.remove('aerial-mask');
    }
    this.textures.addCanvas('aerial-mask', this.aerialMaskCanvas);

    this.add
      .image(WORLD_SIZE / 2, WORLD_SIZE / 2, CONFIG.backdropGreyscaleKey)
      .setDisplaySize(WORLD_SIZE, WORLD_SIZE)
      .setDepth(0);
    this.colorBackdrop = this.add
      .image(WORLD_SIZE / 2, WORLD_SIZE / 2, CONFIG.backdropKey)
      .setDisplaySize(WORLD_SIZE, WORLD_SIZE)
      .setDepth(0.5);
    this.aerialMaskImage = this.make
      .image({
        x: WORLD_SIZE / 2,
        y: WORLD_SIZE / 2,
        key: 'aerial-mask',
        add: false,
      })
      .setOrigin(0.5)
      .setDisplaySize(WORLD_SIZE, WORLD_SIZE);
    this.drawAerialMap();
    this.colorBackdrop.setMask(
      new Phaser.Display.Masks.BitmapMask(this, this.aerialMaskImage)
    );
    this.drawGridOverlay();
    this.fogGraphics = this.add.graphics().setDepth(6);
    this.drawFog();
    this.createPlayer();
    this.setupCamera();
    this.setupInput();
    this.setupUI();
    this.readingGraphics = this.add.graphics().setDepth(5);
    this.craterGraphics = this.add.graphics().setDepth(6.5);
    this.deployedSensorGraphics = this.add.graphics().setDepth(7);

    this.layoutMapOverlay();
    this.scale.on('resize', () => {
      this.layoutMapOverlay();
      this.fitCameraToMap();
    });

    this.updateActionUI();
    this.updateUI();

    if (import.meta.env.DEV) {
      console.log('[DEBUG] Hidden targets at cells:', getTargets().map((t) => t.cell));
    }
  }

  drawGridOverlay() {
    const graphics = this.add.graphics().setDepth(1);
    graphics.lineStyle(1, 0xffffff, 0.08);
    const step = 16;
    for (let x = 0; x <= gridSize; x += step) {
      const pos = x * cellPx;
      graphics.lineBetween(pos, 0, pos, WORLD_SIZE);
    }
    for (let y = 0; y <= gridSize; y += step) {
      const pos = y * cellPx;
      graphics.lineBetween(0, pos, WORLD_SIZE, pos);
    }
  }

  drawAerialMap() {
    const ctx = this.aerialMaskCtx;
    ctx.clearRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ctx.fillStyle = '#ffffff';
    const aerial = getState().aerialRevealedCells;
    for (const key of aerial) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
    this.textures.get('aerial-mask').refresh();
  }

  drawFog() {
    const g = this.fogGraphics;
    g.clear();
    g.fillStyle(0x0a0a14, 0.72);

    const sensor = getState().sensorRevealedCells;
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        if (!isRevealed(sensor, { x, y })) {
          g.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }
  }

  revealAerialAroundWorld(worldX, worldY, radiusMiles) {
    revealCellsInRangeFromWorld(
      getState().aerialRevealedCells,
      worldX,
      worldY,
      radiusMiles
    );
    this.drawAerialMap();
  }

  spotTargetsInRange(centerCell, radiusMiles) {
    for (const target of getTargets()) {
      if (target.visuallyRevealed || target.killConfirmed) continue;
      if (!isTargetInRange(centerCell, target.cell, radiusMiles)) continue;
      if (!revealTargetVisually(target.id)) continue;
      this.createSpottedMarker(target);
      speakVisualContact(target.cell);
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
    this.fitCameraToMap();

    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.camStart = { x: 0, y: 0 };
  }

  getMinZoom() {
    const cam = this.cameras.main;
    return Math.min(cam.width / WORLD_SIZE, cam.height / WORLD_SIZE);
  }

  fitCameraToMap() {
    const cam = this.cameras.main;
    cam.setZoom(this.getMinZoom());
    cam.centerOn(WORLD_SIZE / 2, WORLD_SIZE / 2);
  }

  clampZoom(zoom) {
    return Phaser.Math.Clamp(zoom, this.getMinZoom(), 4);
  }

  setupInput() {
    const cam = this.cameras.main;

    this.input.on('wheel', (pointer, _gameObjects, _deltaX, deltaY) => {
      const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
      const newZoom = this.clampZoom(cam.zoom * zoomFactor);
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
          const newZoom = this.clampZoom(cam.zoom * scale);
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
    ui('btn-range').addEventListener('click', () => this.onActionButton('range'));
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
      (pending.type === 'bearing' || pending.type === 'range') &&
      (type === 'bearing' || type === 'range');

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

    const isSensor = pending.type === 'bearing' || pending.type === 'range';
    if (isSensor) {
      const rangePx =
        (getDetectionRadiusMiles(pending.type) / CONFIG.cellSizeMiles) * cellPx;
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
      cost.textContent = formatMoney(getActionCost(type));
      cost.style.display = 'block';
    }
  }

  updateActionUI() {
    const pending = this.pendingAction;
    const types = ['bearing', 'range', 'fire'];

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
      pending.type === 'fire'
        ? 'Fire mission'
        : `${ACTION_LABELS[pending.type]} drone`;

    if (pending.cell) {
      const radius = getDetectionRadiusMiles(pending.type);
      const rangeNote =
        pending.type === 'bearing' || pending.type === 'range'
          ? ` Scan radius: ${radius} mi (clears sensor fog).`
          : '';
      status.textContent = `${name}: (${pending.cell.x}, ${pending.cell.y}) — tap map to change, press Confirm coords to execute.${rangeNote}`;
    } else {
      status.textContent = `${name}: tap the map to select coordinates.`;
    }
  }

  deployDrone(type, targetCell) {
    const state = getState();
    if (state.gameOver) return;
    if (!spendMoney(getActionCost(type))) {
      this.showMessage('Not enough money!');
      this.updateUI();
      return;
    }

    const drone = createDrone(type, targetCell);
    addDrone(drone);
    trackDroneDeploy(type, targetCell);
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
        this.revealAerialAroundWorld(sprite.x, sprite.y, CONFIG.visualRangeMiles);
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

    revealCircle(
      state.sensorRevealedCells,
      droneCell,
      getDetectionRadiusMiles(drone.type)
    );
    this.drawFog();
    this.spotTargetsInRange(droneCell, CONFIG.visualRangeMiles);

    const { detected, reading, effectivenessResults } = attemptDetection(
      drone.type,
      droneCell,
      state.targets
    );

    this.deployedSensors.push(
      createDeployedSensor(
        drone.type,
        droneCell,
        detected && reading ? reading.value : null,
        detected && reading ? reading.uncertaintyDeg : null
      )
    );

    if (detected && reading) {
      addReading(reading);
      updateDrone(drone.id, { status: 'returning', resultReadingId: reading.id });

      const readingDetail = formatSensorReading(
        drone.type,
        reading.value,
        reading.uncertaintyDeg
      );

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
            trackKillConfirmed(target.contractValue);
            speakTargetNeutralized();
            contractsPaid++;
            payoutTotal += target.contractValue;
            addReading(
              createReading('contract', target.contractValue, droneCell, target.id)
            );
          }
        }
      }

      let message = `${formatDroneLabel(drone.type)} drone: contact! ${readingDetail} — ${effParts.join('; ')}`;
      if (contractsPaid === 1) {
        message += ` — ${formatMoney(payoutTotal)} contract paid — Combat Ineffective unit confirmed destroyed`;
      } else if (contractsPaid > 1) {
        message += ` — ${formatMoney(payoutTotal)} contracts paid — Combat Ineffective units confirmed destroyed`;
      }

      const missionComplete = checkMissionComplete();
      if (missionComplete) {
        trackMissionComplete(getScore());
        speakMissionComplete();
        message += ' — All targets destroyed';
      }

      this.showMessage(message, missionComplete ? 8000 : 4000);
      this.drawReadings();
    } else {
      updateDrone(drone.id, { status: 'returning', resultReadingId: null });
      this.showMessage(`${formatDroneLabel(drone.type)} drone: no contact.`);
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
        this.revealAerialAroundWorld(sprite.x, sprite.y, CONFIG.visualRangeMiles);
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
        if (!getState().missionCompleteReported) {
          if (checkBankruptcy()) speakBudgetExhausted();
        }
        this.updateUI();
      },
    });
  }

  drawReadings() {
    const g = this.readingGraphics;
    g.clear();

    const ranges = getRangeReadings();
    if (ranges.length >= 2) {
      const d1 = ranges[ranges.length - 2];
      const d2 = ranges[ranges.length - 1];
      const ambiguousPoints = triangulateFromTwoDistances(d1, d2);
      for (const point of ambiguousPoints) {
        const pos = cellToWorld(point);
        g.fillStyle(0xff88ff, 0.35);
        g.fillCircle(pos.x, pos.y, cellPx * 0.35);
      }
    }
  }

  update(_time, delta) {
    if (this.deployedSensors.length > 0) {
      updateDeployedSensors(this.deployedSensors, delta);

      for (const sensor of this.deployedSensors) {
        if (sensor.markedForRetrieval && !sensor.retrievalStarted) {
          this.startSensorRetrieval(sensor);
        }
      }

      drawDeployedSensors(
        this.deployedSensorGraphics,
        this.deployedSensors,
        cellPx,
        degreesToRadians
      );
    } else if (this.deployedSensorGraphics) {
      this.deployedSensorGraphics.clear();
    }
  }

  startSensorRetrieval(sensor) {
    sensor.retrievalStarted = true;
    const playerPos = cellToWorld(getState().playerCell);
    const sensorPos = cellToWorld(sensor.cell);
    const legDuration = CONFIG.droneTravelDurationMs / 4;

    const sprite = this.add.circle(playerPos.x, playerPos.y, cellPx * 0.3, 0x00aaff);
    sprite.setStrokeStyle(1, 0xffffff);
    sprite.setDepth(9);

    this.tweens.add({
      targets: sprite,
      x: sensorPos.x,
      y: sensorPos.y,
      duration: legDuration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        const idx = this.deployedSensors.indexOf(sensor);
        if (idx >= 0) this.deployedSensors.splice(idx, 1);

        this.tweens.add({
          targets: sprite,
          x: playerPos.x,
          y: playerPos.y,
          duration: legDuration,
          ease: 'Sine.easeInOut',
          onComplete: () => sprite.destroy(),
        });
      },
    });
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
      if (checkBankruptcy()) speakBudgetExhausted();
      this.updateUI();
      return;
    }

    const elevationDeg = radiansToDegrees(elevationResult.elevationRadians);
    this.animateFire(bearing, elevationDeg, distanceMiles, aimCell);
  }

  animateFire(bearingDeg, elevationDeg, distanceMiles, aimCell) {
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
            this.fireProjectile(playerPos, bearingRad, elevationDeg, targetDistPx, aimCell);
          },
        });
      },
    });
  }

  fireProjectile(startPos, bearingRad, elevationDeg, targetDistPx, aimCell) {
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

        const munition = getMunitionDef(DEFAULT_MUNITION_ID);
        this.craters.push(createCrater(aimCell, munition));
        drawCraters(this.craterGraphics, this.craters, cellPx);

        const { results } = applyMunitionImpact(aimCell, munition.id);
        const hit = results.length > 0;
        const neutralized = results.filter((r) => r.neutralized);
        const paid = results.filter((r) => r.contractPaid);

        for (const r of neutralized) {
          speakTargetNeutralized();
        }
        for (const r of paid) {
          addReading(
            createReading('contract', r.target.contractValue, aimCell, r.target.id)
          );
          trackKillConfirmed(r.target.contractValue);
        }

        let message = `Fire mission complete (${munition.shortLabel}).`;
        if (paid.length === 1) {
          message += ` ${formatMoney(paid[0].target.contractValue)} contract awarded.`;
        } else if (paid.length > 1) {
          const total = paid.reduce((s, r) => s + r.target.contractValue, 0);
          message += ` ${formatMoney(total)} contracts awarded.`;
        } else if (!hit) {
          message += ' No effect.';
        }

        addReading(createReading('fire', 0, aimCell));
        trackFireMissionComplete(aimCell, hit);
        const missionComplete = checkMissionComplete();
        if (missionComplete) {
          trackMissionComplete(getScore());
          speakMissionComplete();
          message += ' All targets destroyed — mission complete!';
        } else if (checkBankruptcy()) {
          speakBudgetExhausted();
        }
        this.showMessage(message, missionComplete ? 8000 : 4000);
        this.isAnimatingFire = false;
        this.updateUI();
      },
    });
  }

  showMessage(text) {
    this.logEntries.unshift({ text, ts: Date.now(), fresh: true });
    this.renderLog();
  }

  renderLog() {
    const list = ui('readings-list');
    // Build combined list: free-text log entries + structured sensor readings,
    // interleaved by timestamp, newest first.
    const state = getState();

    // Convert structured readings to display objects
    const readingItems = state.readings.map((r) => {
      const sensor = `(${r.sensorCell.x},${r.sensorCell.y})`;
      let text = '';
      let color = null;
      let weight = null;

      if (r.type === 'bearing') {
        text =
          r.uncertaintyDeg != null && r.uncertaintyDeg > 0.5
            ? `📡 Passive ${r.value.toFixed(0)}° ±${r.uncertaintyDeg.toFixed(0)}° from ${sensor}`
            : `📡 Passive ${r.value.toFixed(1)}° from ${sensor}`;
      } else if (r.type === 'range') {
        text = `📡 Active ${r.value.toFixed(2)} mi from ${sensor}`;
      } else if (r.type === 'effectiveness') {
        const display = getEffectivenessDisplay(r.value);
        const label = display ? `${display.label} (${display.percentRange})` : r.value;
        text = `⚠️ Effectiveness: ${label} ${sensor}`;
        color = display?.color;
        weight = '600';
      } else if (r.type === 'contract') {
        const target = state.targets.find((t) => t.id === r.targetId);
        text = target?.verificationRequired
          ? `✅ Kill confirmed — ${formatMoney(r.value)} contract awarded`
          : `✅ Contract awarded — ${formatMoney(r.value)}`;
        color = '#44ff88';
        weight = '700';
      } else if (r.type === 'fire') {
        text = `🔥 Fire mission at ${sensor}`;
      }
      return { text, color, weight, ts: r.timestamp };
    });

    // Merge and sort newest first
    const all = [
      ...this.logEntries.map((e) => ({ text: e.text, color: null, weight: null, ts: e.ts, fresh: e.fresh })),
      ...readingItems,
    ].sort((a, b) => b.ts - a.ts);

    list.innerHTML = '';
    all.forEach((item) => {
      if (!item.text) return;
      const li = document.createElement('li');
      li.textContent = item.text;
      if (item.color) li.style.color = item.color;
      if (item.weight) li.style.fontWeight = item.weight;
      if (item.fresh) li.classList.add('log-fresh');
      list.appendChild(li);
    });

    // Clear fresh flags after render
    this.logEntries.forEach((e) => { e.fresh = false; });
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
      contractsEl.textContent = `${count} contract${count === 1 ? '' : 's'} active (${formatMoney(totalValue)} total)`;
    }

    const missionEl = ui('mission-complete');
    if (state.missionCompleteReported) {
      missionEl.classList.remove('hidden');
    } else {
      missionEl.classList.add('hidden');
    }

    const bearingBtn = ui('btn-bearing');
    const rangeBtn = ui('btn-range');
    const fireBtn = ui('btn-fire');
    const pending = this.pendingAction;
    const busy = state.gameOver || this.isDeployingDrone || this.isAnimatingFire;

    bearingBtn.disabled = busy || pending?.type === 'fire';
    rangeBtn.disabled = busy || pending?.type === 'fire';
    fireBtn.disabled = busy || (pending !== null && pending.type !== 'fire');

    this.renderLog();

    const gameOverEl = ui('game-over');
    if (isVictory()) {
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.add('victory');
      ui('game-over-title').textContent = 'Mission Complete';
      ui('game-over-message').textContent =
        `All targets destroyed. Earned ${formatMoney(getScore())} — Balance ${formatMoney(getMoney())}`;
    } else if (state.gameOver) {
      trackGameOverMoney();
      gameOverEl.classList.remove('hidden');
      gameOverEl.classList.remove('victory');
      ui('game-over-title').textContent = 'Budget Exhausted';
      ui('game-over-message').textContent =
        'Target locations revealed on map.';
      this.revealTargets();
    } else {
      gameOverEl.classList.add('hidden');
      gameOverEl.classList.remove('victory');
    }
  }
}
