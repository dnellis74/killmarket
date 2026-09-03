/** Game configuration — adjust these placeholders as needed. */
export const CONFIG = {
  startingMoney: 1000000,
  /** Passive drone + fire mission cost. */
  actionCost: 100000,
  /** Active (range) drone — 1/4 of Passive. */
  activeActionCost: 25000,
  contracts: [
    { value: 500000, verificationRequired: false },
    { value: 500000, verificationRequired: false },
  ],
  /** Square map — 128×128 @ 4px = 512×512 (map-backdrop-square.jpg). */
  gridSize: 128,
  cellPx: 4,
  cellSizeMiles: 0.05,
  mapSizeMiles: 6.4,
  /** Passive (bearing) sensor scan radius. */
  detectionRadiusMiles: 1.5,
  /** Active (range) sensor — 1/4 of Passive. */
  activeDetectionRadiusMiles: 0.375,
  /**
   * Passive bearing uncertainty half-width (degrees).
   * Full ping arc = 2 × half-width. Grows linearly with range:
   * near contact ≈ 10° arc, at max range = 90° arc.
   */
  passiveBearingMinHalfWidthDeg: 5,
  passiveBearingMaxHalfWidthDeg: 45,
  initialRevealRadiusMiles: 0.5,
  visualRangeMiles: 0.25,
  droneTravelDurationMs: 2000,
  muzzleVelocity: 800,
  gravity: 9.8,
  milesToMeters: 1609.34,
  playerCell: { x: 112, y: 112 },
  backdropKey: 'map-backdrop',
  backdropUrl: '/map-backdrop-square.jpg',
  backdropGreyscaleKey: 'map-backdrop-greyscale',
  backdropGreyscaleUrl: '/map-backdrop-square-greyscale.jpg',
};

/** Cost for an action type: passive/fire use actionCost; active uses activeActionCost. */
export function getActionCost(type) {
  return type === 'range' ? CONFIG.activeActionCost : CONFIG.actionCost;
}

/** Sensor scan radius for a drone/sensor type. */
export function getDetectionRadiusMiles(type) {
  return type === 'range'
    ? CONFIG.activeDetectionRadiusMiles
    : CONFIG.detectionRadiusMiles;
}

/**
 * Passive bearing uncertainty half-width at a given distance.
 * Linear from min (near sensor) to max (at detectionRadiusMiles).
 * Full ping / display arc is 2 × this value (90° at max range).
 */
export function getPassiveBearingHalfWidthDeg(distanceMiles) {
  const maxR = CONFIG.detectionRadiusMiles;
  const t = maxR > 0 ? Math.min(1, Math.max(0, distanceMiles / maxR)) : 1;
  const { passiveBearingMinHalfWidthDeg: minH, passiveBearingMaxHalfWidthDeg: maxH } =
    CONFIG;
  return minH + (maxH - minH) * t;
}
