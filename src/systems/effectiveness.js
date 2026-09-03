/** SALUTE combat effectiveness levels for target damage assessment. */

export const EFFECTIVENESS = {
  FULLY_EFFECTIVE: 'fully_effective',
  MARGINALLY_EFFECTIVE: 'marginally_effective',
  INEFFECTIVE: 'ineffective',
  COMBAT_INEFFECTIVE: 'combat_ineffective',
};

export const EFFECTIVENESS_LEVELS = [
  {
    id: EFFECTIVENESS.FULLY_EFFECTIVE,
    label: 'Fully Effective',
    color: '#22c55e',
    percentRange: '85%-100%',
    description: 'Minimal losses, can fully execute mission',
  },
  {
    id: EFFECTIVENESS.MARGINALLY_EFFECTIVE,
    label: 'Marginally Effective (Amber)',
    color: '#f59e0b',
    percentRange: '70%-84%',
    description: 'Losses but can still fight with limitations',
  },
  {
    id: EFFECTIVENESS.INEFFECTIVE,
    label: 'Ineffective (Red)',
    color: '#ef4444',
    percentRange: '50%-69%',
    description: 'Severely damaged, cannot complete mission',
  },
  {
    id: EFFECTIVENESS.COMBAT_INEFFECTIVE,
    label: 'Combat Ineffective (Black)',
    color: '#111111',
    percentRange: '<50%',
    description: 'Broken, missing crew-served weapons, functionally dead',
  },
];

const levelById = Object.fromEntries(EFFECTIVENESS_LEVELS.map((l) => [l.id, l]));

/**
 * Map remaining integrity (0–1) onto SALUTE bands.
 * @param {number} integrity
 * @returns {string}
 */
export function effectivenessFromIntegrity(integrity) {
  const pct = Math.max(0, Math.min(1, integrity)) * 100;
  if (pct >= 85) return EFFECTIVENESS.FULLY_EFFECTIVE;
  if (pct >= 70) return EFFECTIVENESS.MARGINALLY_EFFECTIVE;
  if (pct >= 50) return EFFECTIVENESS.INEFFECTIVE;
  return EFFECTIVENESS.COMBAT_INEFFECTIVE;
}

/**
 * Display metadata for an effectiveness level.
 * @param {string | null | undefined} level
 * @returns {{ id: string, label: string, color: string, percentRange: string, description: string } | null}
 */
export function getEffectivenessDisplay(level) {
  if (!level) return null;
  return levelById[level] ?? null;
}

/**
 * Effectiveness reported by a sensor on detection, from remaining integrity.
 * @param {{ effectiveness: string | null }} target
 * @returns {string}
 */
export function getReportedEffectiveness(target) {
  if (typeof target.integrity === 'number') {
    return effectivenessFromIntegrity(target.integrity);
  }
  if (target.effectiveness === EFFECTIVENESS.COMBAT_INEFFECTIVE) {
    return EFFECTIVENESS.COMBAT_INEFFECTIVE;
  }
  return EFFECTIVENESS.FULLY_EFFECTIVE;
}

/**
 * Update target effectiveness on first detection if still unknown.
 * @param {{ effectiveness: string | null }} target
 * @param {string} reportedLevel
 */
export function applyDetectionEffectiveness(target, reportedLevel) {
  if (target.effectiveness == null) {
    target.effectiveness = reportedLevel;
  }
}
