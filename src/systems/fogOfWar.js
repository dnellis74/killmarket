import { CONFIG } from '../config.js';
import { worldToCell } from './grid.js';

export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

/**
 * All grid cells whose centers fall within radiusMiles of centerCell.
 */
export function cellsInRadius(centerCell, radiusMiles) {
  const radiusCells = Math.ceil(radiusMiles / CONFIG.cellSizeMiles);
  const cells = [];

  for (let dx = -radiusCells; dx <= radiusCells; dx++) {
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      const cell = { x: centerCell.x + dx, y: centerCell.y + dy };
      if (
        cell.x < 0 ||
        cell.x >= CONFIG.gridSize ||
        cell.y < 0 ||
        cell.y >= CONFIG.gridSize
      ) {
        continue;
      }
      const distMiles =
        Math.sqrt(dx * dx + dy * dy) * CONFIG.cellSizeMiles;
      if (distMiles <= radiusMiles) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

export function revealCell(revealedSet, cell) {
  if (
    cell.x < 0 ||
    cell.x >= CONFIG.gridSize ||
    cell.y < 0 ||
    cell.y >= CONFIG.gridSize
  ) {
    return false;
  }
  const key = cellKey(cell);
  if (revealedSet.has(key)) return false;
  revealedSet.add(key);
  return true;
}

export function revealCellsInRange(revealedSet, centerCell, radiusMiles) {
  let anyNew = false;
  for (const cell of cellsInRadius(centerCell, radiusMiles)) {
    if (revealCell(revealedSet, cell)) anyNew = true;
  }
  return anyNew;
}

export function revealCircle(revealedSet, centerCell, radiusMiles) {
  return revealCellsInRange(revealedSet, centerCell, radiusMiles);
}

/** Reveal cells within radius of a world-pixel position (drone in flight). */
export function revealCellsInRangeFromWorld(
  revealedSet,
  worldX,
  worldY,
  radiusMiles
) {
  const centerCell = worldToCell(worldX, worldY);
  return revealCellsInRange(revealedSet, centerCell, radiusMiles);
}

export function isRevealed(revealedSet, cell) {
  return revealedSet.has(cellKey(cell));
}

export function initRevealedCells(playerCell, radiusMiles) {
  const revealed = new Set();
  revealCellsInRange(revealed, playerCell, radiusMiles);
  return revealed;
}
