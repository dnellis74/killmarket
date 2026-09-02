/** Game configuration — adjust these placeholders as needed. */
export const CONFIG = {
  startingMoney: 1000000,
  actionCost: 100000,
  /** Demo level — each entry is a contract tied to a hidden target. */
  contracts: [
    { value: 500000, verificationRequired: false },
    { value: 500000, verificationRequired: false },
  ],
  gridSize: 100,
  cellSizeMiles: 0.1,
  mapSizeMiles: 10,
  detectionRadiusMiles: 3,
  initialRevealRadiusMiles: 1,
  visualRangeMiles: 1,
  droneTravelDurationMs: 2000,
  muzzleVelocity: 800,
  gravity: 9.8,
  milesToMeters: 1609.34,
  playerCell: { x: 10, y: 50 },
  cellPx: 10,
};
