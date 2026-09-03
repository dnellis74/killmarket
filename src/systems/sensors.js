import { CONFIG, getPassiveBearingHalfWidthDeg } from '../config.js';
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

export function findTargetsInRange(droneCell, targets, radiusMiles = CONFIG.detectionRadiusMiles) {
  return targets
    .filter((t) => isTargetInRange(droneCell, t.cell, radiusMiles))
    .sort(
      (a, b) =>
        cellDistanceMiles(droneCell, a.cell) - cellDistanceMiles(droneCell, b.cell)
    );
}

/**
 * Attempt detection and generate readings relative to the drone sensor position.
 * Passive bearings include range-based angular uncertainty (wider arc farther out).
 */
export function attemptDetection(type, droneCell, targets) {
  const radiusMiles =
    type === 'range'
      ? CONFIG.activeDetectionRadiusMiles
      : CONFIG.detectionRadiusMiles;
  const inRange = findTargetsInRange(droneCell, targets, radiusMiles);
  if (inRange.length === 0) {
    return { detected: false, reading: null, effectivenessResults: [] };
  }

  const closest = inRange[0];
  const distanceMiles = cellDistanceMiles(droneCell, closest.cell);

  let value;
  let uncertaintyDeg = null;

  if (type === 'bearing') {
    // Center of the uncertainty lobe; half-width grows with range (90° arc at max).
    value = computeBearing(droneCell, closest.cell);
    uncertaintyDeg = getPassiveBearingHalfWidthDeg(distanceMiles);
  } else {
    value = distanceMiles;
  }

  const reading = createReading(type, value, droneCell, closest.id, {
    uncertaintyDeg,
  });

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
