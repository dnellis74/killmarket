/**
 * Data-driven sensor definitions — gameplay properties only.
 * Presentation / animation lives in systems/deployedSensors.js (`SENSOR_ANIM` + `sensor.anim`).
 */

/** @typedef {'bearing' | 'range'} SensorTypeId */

/**
 * @typedef {object} BearingUncertainty
 * @property {number} minHalfWidthDeg half-width near the sensor (full arc = 2×)
 * @property {number} maxHalfWidthDeg half-width at max range (full arc = 2×)
 */

/**
 * @typedef {object} SensorDef
 * @property {SensorTypeId} id
 * @property {string} label
 * @property {'bearing' | 'range'} readingKind
 * @property {number} rangeMiles detection / fog-clear radius
 * @property {BearingUncertainty | null} bearingUncertainty passive lobe; null for range sensors
 * @property {number} maxCyclesWithoutContact retrieve after this many empty sweep cycles
 */

/** @type {Record<SensorTypeId, SensorDef>} */
export const SENSOR_DEFS = {
  bearing: {
    id: 'bearing',
    label: 'Passive',
    readingKind: 'bearing',
    rangeMiles: 1.5,
    bearingUncertainty: {
      minHalfWidthDeg: 5,
      maxHalfWidthDeg: 45,
    },
    maxCyclesWithoutContact: 4,
  },
  range: {
    id: 'range',
    label: 'Active',
    readingKind: 'range',
    rangeMiles: 0.375,
    bearingUncertainty: null,
    maxCyclesWithoutContact: 4,
  },
};

/**
 * @param {string} type
 * @returns {SensorDef}
 */
export function getSensorDef(type) {
  const def = SENSOR_DEFS[/** @type {SensorTypeId} */ (type)];
  if (!def) {
    throw new Error(`Unknown sensor type: ${type}`);
  }
  return def;
}

/** Sensor scan radius for a drone/sensor type. */
export function getDetectionRadiusMiles(type) {
  return getSensorDef(type).rangeMiles;
}

/**
 * Passive bearing uncertainty half-width at a given distance.
 * Linear from min (near sensor) to max (at that type's rangeMiles).
 * @param {number} distanceMiles
 * @param {string} [type='bearing']
 * @returns {number | null}
 */
export function getBearingUncertaintyHalfWidthDeg(distanceMiles, type = 'bearing') {
  const def = getSensorDef(type);
  const u = def.bearingUncertainty;
  if (!u) return null;

  const maxR = def.rangeMiles;
  const t = maxR > 0 ? Math.min(1, Math.max(0, distanceMiles / maxR)) : 1;
  return u.minHalfWidthDeg + (u.maxHalfWidthDeg - u.minHalfWidthDeg) * t;
}

/** @deprecated Use getBearingUncertaintyHalfWidthDeg */
export function getPassiveBearingHalfWidthDeg(distanceMiles) {
  return getBearingUncertaintyHalfWidthDeg(distanceMiles, 'bearing') ?? 0;
}
