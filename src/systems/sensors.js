import {
  getSensorDef,
  getDetectionRadiusMiles,
  getBearingUncertaintyHalfWidthDeg,
} from '../data/sensorDefs.js';
import { createReading } from '../state/gameState.js';
import {
  applyDetectionEffectiveness,
  getReportedEffectiveness,
} from './effectiveness.js';
import { cellDistanceMiles, computeBearing } from './grid.js';

export { cellDistanceMiles, computeBearing, cellToWorld, worldToCell } from './grid.js';

export function isTargetInRange(
  droneCell,
  targetCell,
  radiusMiles = getDetectionRadiusMiles('bearing')
) {
  return cellDistanceMiles(droneCell, targetCell) <= radiusMiles;
}

export function findTargetsInRange(
  droneCell,
  targets,
  radiusMiles = getDetectionRadiusMiles('bearing')
) {
  return targets
    .filter((t) => isTargetInRange(droneCell, t.cell, radiusMiles))
    .sort(
      (a, b) =>
        cellDistanceMiles(droneCell, a.cell) - cellDistanceMiles(droneCell, b.cell)
    );
}

/**
 * Attempt detection and generate readings relative to the drone sensor position.
 * Uses SENSOR_DEFS for range and bearing uncertainty.
 */
export function attemptDetection(type, droneCell, targets) {
  const def = getSensorDef(type);
  const inRange = findTargetsInRange(droneCell, targets, def.rangeMiles);
  if (inRange.length === 0) {
    return { detected: false, reading: null, effectivenessResults: [] };
  }

  const closest = inRange[0];
  const distanceMiles = cellDistanceMiles(droneCell, closest.cell);

  let value;
  let uncertaintyDeg = null;

  if (def.readingKind === 'bearing') {
    value = computeBearing(droneCell, closest.cell);
    uncertaintyDeg = getBearingUncertaintyHalfWidthDeg(distanceMiles, type);
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
