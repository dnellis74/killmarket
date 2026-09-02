import { CONFIG } from '../config.js';
import { createReading } from '../state/gameState.js';
import {
  applyDetectionEffectiveness,
  getReportedEffectiveness,
} from './effectiveness.js';
import { cellDistanceMiles, computeBearing } from './grid.js';

export { cellDistanceMiles, computeBearing, cellToWorld, worldToCell } from './grid.js';

export function isTargetInRange(droneCell, targetCell, radiusMiles = CONFIG.detectionRadiusMiles) {
  return cellDistanceMiles(droneCell, targetCell) <= radiusMiles;
}

export function findTargetsInRange(droneCell, targets) {
  return targets
    .filter((t) => isTargetInRange(droneCell, t.cell))
    .sort(
      (a, b) =>
        cellDistanceMiles(droneCell, a.cell) - cellDistanceMiles(droneCell, b.cell)
    );
}

/**
 * Attempt detection and generate readings relative to the drone sensor position.
 */
export function attemptDetection(type, droneCell, targets) {
  const inRange = findTargetsInRange(droneCell, targets);
  if (inRange.length === 0) {
    return { detected: false, reading: null, effectivenessResults: [] };
  }

  const closest = inRange[0];
  const value =
    type === 'bearing'
      ? computeBearing(droneCell, closest.cell)
      : cellDistanceMiles(droneCell, closest.cell);

  const reading = createReading(type, value, droneCell, closest.id);

  const effectivenessResults = inRange.map((target) => {
    const effectiveness = getReportedEffectiveness(target);
    applyDetectionEffectiveness(target, effectiveness);
    return {
      target,
      effectiveness,
      effectivenessReading: createReading('effectiveness', effectiveness, droneCell, target.id),
    };
  });

  return { detected: true, reading, effectivenessResults };
}
