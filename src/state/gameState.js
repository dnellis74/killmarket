import { CONFIG } from '../config.js';
import { EFFECTIVENESS } from '../systems/effectiveness.js';

let state = null;
let nextId = 1;

function generateId() {
  return `id-${nextId++}`;
}

function randomDistinctCells(count, gridSize) {
  const cells = [];
  while (cells.length < count) {
    const cell = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
    if (!cells.some((c) => c.x === cell.x && c.y === cell.y)) {
      cells.push(cell);
    }
  }
  return cells;
}

function createTarget(cell) {
  return {
    id: generateId(),
    cell: { ...cell },
    effectiveness: null,
    killConfirmed: false,
  };
}

export function initGameState() {
  nextId = 1;
  const targetCells = randomDistinctCells(CONFIG.targetCount, CONFIG.gridSize);
  state = {
    energy: CONFIG.startingEnergy,
    readings: [],
    drones: [],
    targets: targetCells.map((cell) => createTarget(cell)),
    playerCell: { ...CONFIG.playerCell },
    gameOver: false,
    score: 0,
    missionCompleteReported: false,
  };
  return state;
}

export function getState() {
  if (!state) initGameState();
  return state;
}

export function getTargets() {
  return getState().targets;
}

export function findTargetAtCell(cell) {
  return getState().targets.find(
    (t) => t.cell.x === cell.x && t.cell.y === cell.y
  );
}

export function allKillsConfirmed() {
  return getState().targets.every((t) => t.killConfirmed);
}

/** @returns {boolean} true the first time all kills are sensor-confirmed */
export function checkMissionComplete() {
  const s = getState();
  if (s.missionCompleteReported) return false;
  if (!allKillsConfirmed()) return false;
  s.missionCompleteReported = true;
  s.gameOver = true;
  return true;
}

export function isVictory() {
  return getState().missionCompleteReported;
}

export function addReading(reading) {
  state.readings.push(reading);
  return reading;
}

export function addDrone(drone) {
  state.drones.push(drone);
  return drone;
}

export function updateDrone(id, updates) {
  const drone = state.drones.find((d) => d.id === id);
  if (drone) Object.assign(drone, updates);
  return drone;
}

export function spendEnergy(amount = CONFIG.actionCost) {
  if (state.energy < amount) return false;
  state.energy -= amount;
  if (state.energy <= 0) {
    state.energy = 0;
    state.gameOver = true;
  }
  return true;
}

export function getBearingReadings() {
  return state.readings.filter((r) => r.type === 'bearing');
}

export function getDistanceReadings() {
  return state.readings.filter((r) => r.type === 'distance');
}

/** Enough sensor intel to enable fire (player still aims manually). */
export function canFire() {
  const bearings = getBearingReadings();
  const distances = getDistanceReadings();
  return (
    bearings.length >= 2 ||
    distances.length >= 2 ||
    (bearings.length >= 1 && distances.length >= 1)
  );
}

export function createReading(type, value, sensorCell, targetId = null) {
  return {
    id: generateId(),
    type,
    value,
    timestamp: Date.now(),
    sensorCell: { ...sensorCell },
    targetId,
  };
}

export function createDrone(type, targetCell) {
  return {
    id: generateId(),
    type,
    targetCell: { ...targetCell },
    status: 'launching',
    resultReadingId: null,
  };
}

/** Apply kinetic effect — does not confirm kill or award score. */
export function markTargetHitAtCell(aimCell) {
  const target = findTargetAtCell(aimCell);
  if (!target) return null;
  target.effectiveness = EFFECTIVENESS.COMBAT_INEFFECTIVE;
  return target;
}

/**
 * Sensor confirms a destroyed unit — awards score once per target.
 * @returns {boolean} true if a point was awarded
 */
export function confirmKillViaSensor(target) {
  if (
    target.effectiveness !== EFFECTIVENESS.COMBAT_INEFFECTIVE ||
    target.killConfirmed
  ) {
    return false;
  }
  target.killConfirmed = true;
  state.score += 1;
  return true;
}

export function getScore() {
  return state.score;
}
