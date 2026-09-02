import { CONFIG } from '../config.js';

/**
 * Convert distance from miles to meters.
 * @param {number} miles
 * @returns {number}
 */
export function milesToMeters(miles) {
  return miles * CONFIG.milesToMeters;
}

/**
 * Compute gun elevation angle for a given range.
 * theta = 0.5 * arcsin(g * R / v^2)
 * @param {number} rangeMeters
 * @param {number} [velocity]
 * @param {number} [gravity]
 * @returns {{ valid: boolean, elevationRadians: number | null, message?: string }}
 */
export function computeElevation(rangeMeters, velocity = CONFIG.muzzleVelocity, gravity = CONFIG.gravity) {
  const vSquared = velocity * velocity;
  const gR = gravity * rangeMeters;

  if (vSquared < gR) {
    return {
      valid: false,
      elevationRadians: null,
      message: 'Target out of range — no valid trajectory.',
    };
  }

  const theta = 0.5 * Math.asin(gR / vSquared);
  return { valid: true, elevationRadians: theta };
}

/**
 * @param {number} radians
 * @returns {number}
 */
export function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * @param {number} degrees
 * @returns {number}
 */
export function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
