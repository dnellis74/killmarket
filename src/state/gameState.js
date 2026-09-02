import { CONFIG } from '../config.js';
import { EFFECTIVENESS } from '../systems/effectiveness.js';
import { initRevealedCells, isRevealed } from '../systems/fogOfWar.js';

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

function createTarget(cell, contract) {
  return {
    id: generateId(),
    cell: { ...cell },
    contractValue: contract.value,
    verificationRequired: contract.verificationRequired,
    contractStatus: 'active',
    effectiveness: null,
    killConfirmed: false,
    visuallyRevealed: false,
  };
}

export function initGameState() {
  nextId = 1;
  const contracts = CONFIG.contracts;
  const targetCells = randomDistinctCells(contracts.length, CONFIG.gridSize);
  state = {
    money: CONFIG.startingMoney,
    readings: [],
    drones: [],
    targets: targetCells.map((cell, i) => createTarget(cell, contracts[i])),
    playerCell: { ...CONFIG.playerCell },
    revealedCells: initRevealedCells(
      CONFIG.playerCell,
      CONFIG.initialRevealRadiusMiles
    ),
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

export function spendMoney(amount = CONFIG.actionCost) {
  if (state.money < amount) return false;
  state.money -= amount;
  if (state.money <= 0) {
    state.money = 0;
    state.gameOver = true;
  }
  return true;
}

export function getBearingReadings() {
  return state.readings.filter((r) => r.type === 'bearing');
}

export function getRangeReadings() {
  return state.readings.filter((r) => r.type === 'range');
}

/** Whether readings support triangulation hints (does not gate fire). */
export function canFire() {
  const bearings = getBearingReadings();
  const ranges = getRangeReadings();
  return (
    bearings.length >= 2 ||
    ranges.length >= 2 ||
    (bearings.length >= 1 && ranges.length >= 1)
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

/** Apply kinetic effect — marks target destroyed; pays contract if none required. */
export function markTargetHitAtCell(aimCell) {
  const target = findTargetAtCell(aimCell);
  if (!target) return { target: null, contractPaid: false };
  target.effectiveness = EFFECTIVENESS.COMBAT_INEFFECTIVE;
  const contractPaid =
    !target.verificationRequired && awardContractPayout(target);
  return { target, contractPaid };
}

function awardContractPayout(target) {
  if (target.killConfirmed) return false;
  target.killConfirmed = true;
  target.contractStatus = 'paid';
  const payout = target.contractValue;
  state.score += payout;
  state.money += payout;
  return true;
}

/**
 * Sensor confirms a destroyed unit — pays out when contract requires verification.
 * @returns {boolean} true if contract payout was awarded
 */
export function confirmKillViaSensor(target) {
  if (!target.verificationRequired) return false;
  if (
    target.effectiveness !== EFFECTIVENESS.COMBAT_INEFFECTIVE ||
    target.killConfirmed
  ) {
    return false;
  }
  return awardContractPayout(target);
}

export function getScore() {
  return state.score;
}

export function getMoney() {
  return state.money;
}

export function getActiveContracts() {
  return getState().targets.filter((t) => t.contractStatus === 'active');
}

export function getContractSummary() {
  const active = getActiveContracts();
  const totalValue = active.reduce((sum, t) => sum + t.contractValue, 0);
  return { count: active.length, totalValue };
}

export function isCellRevealed(cell) {
  return isRevealed(getState().revealedCells, cell);
}

export function revealTargetVisually(targetId) {
  const target = getState().targets.find((t) => t.id === targetId);
  if (!target || target.visuallyRevealed) return false;
  target.visuallyRevealed = true;
  return true;
}
