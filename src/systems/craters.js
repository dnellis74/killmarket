/**
 * Persistent impact craters — presentation only.
 * Burst size comes from munitionDefs (Chebyshev cells).
 */
import { CONFIG } from '../config.js';
import { cellToWorld } from './grid.js';

/**
 * @param {{ x: number, y: number }} cell
 * @param {{ burstRadiusCells: number }} munition
 */
export function createCrater(cell, munition) {
  return {
    cell: { ...cell },
    burstRadiusCells: munition.burstRadiusCells,
  };
}

/**
 * World-pixel AABB of a Chebyshev burst, clipped to the map.
 * @param {{ x: number, y: number }} cell
 * @param {number} burstRadiusCells
 * @param {number} cellPx
 */
export function burstRectPx(cell, burstRadiusCells, cellPx) {
  const r = burstRadiusCells;
  const x0 = Math.max(0, (cell.x - r) * cellPx);
  const y0 = Math.max(0, (cell.y - r) * cellPx);
  const x1 = Math.min(CONFIG.gridSize * cellPx, (cell.x + r + 1) * cellPx);
  const y1 = Math.min(CONFIG.gridSize * cellPx, (cell.y + r + 1) * cellPx);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * @param {Phaser.GameObjects.Graphics} g
 * @param {ReturnType<typeof createCrater>[]} craters
 * @param {number} cellPx
 */
export function drawCraters(g, craters, cellPx) {
  g.clear();

  for (const crater of craters) {
    const burst = burstRectPx(crater.cell, crater.burstRadiusCells, cellPx);
    const impact = cellToWorld(crater.cell, cellPx);
    const pitR = cellPx * 0.55;

    g.fillStyle(0x1a120c, 0.72);
    g.fillRect(burst.x, burst.y, burst.w, burst.h);

    g.lineStyle(1.5, 0x6b4423, 0.9);
    g.strokeRect(burst.x + 0.5, burst.y + 0.5, burst.w - 1, burst.h - 1);

    g.fillStyle(0x0a0806, 0.92);
    g.fillCircle(impact.x, impact.y, pitR);
    g.lineStyle(1, 0x3d2a1a, 0.8);
    g.strokeCircle(impact.x, impact.y, pitR);

    g.lineStyle(1, 0x8b5a2b, 0.35);
    g.strokeCircle(impact.x, impact.y, pitR * 1.35);
  }
}
