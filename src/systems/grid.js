import { CONFIG } from '../config.js';

/**
 * Distance in miles between two grid cells.
 */
export function cellDistanceMiles(fromCell, toCell) {
  const dx = toCell.x - fromCell.x;
  const dy = toCell.y - fromCell.y;
  const distCells = Math.sqrt(dx * dx + dy * dy);
  return distCells * CONFIG.cellSizeMiles;
}

/**
 * Bearing in degrees (0 = north, clockwise) from one cell to another.
 */
export function computeBearing(fromCell, toCell) {
  const dx = toCell.x - fromCell.x;
  const dy = toCell.y - fromCell.y;
  let bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;
  return bearing;
}

/** Grid cell center in world pixels. */
export function cellToWorld(cell, cellPx = CONFIG.cellPx) {
  return {
    x: cell.x * cellPx + cellPx / 2,
    y: cell.y * cellPx + cellPx / 2,
  };
}

/** World pixel coordinates to grid cell. */
export function worldToCell(worldX, worldY, cellPx = CONFIG.cellPx) {
  return {
    x: Math.floor(worldX / cellPx),
    y: Math.floor(worldY / cellPx),
  };
}
