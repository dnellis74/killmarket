/** Game configuration — adjust these placeholders as needed. */
export const CONFIG = {
  startingMoney: 1000000,
  actionCost: 100000,
  contracts: [
    { value: 500000, verificationRequired: false },
    { value: 500000, verificationRequired: false },
  ],
  /** Square map — 128×128 @ 4px = 512×512 (map-backdrop-square.jpg). */
  gridSize: 128,
  cellPx: 4,
  cellSizeMiles: 0.05,
  mapSizeMiles: 6.4,
  detectionRadiusMiles: 1.5,
  initialRevealRadiusMiles: 0.5,
  visualRangeMiles: 0.25,
  droneTravelDurationMs: 2000,
  muzzleVelocity: 800,
  gravity: 9.8,
  milesToMeters: 1609.34,
  playerCell: { x: 112, y: 112 },
  backdropKey: 'map-backdrop',
  backdropUrl: '/map-backdrop-square.jpg',
};
