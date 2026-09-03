/**
 * Data-driven munition definitions — gameplay properties only.
 * Fire animation lives in scenes/MapScene.js.
 */

/** @typedef {'ap' | 'he'} MunitionTypeId */

/**
 * @typedef {object} MunitionDef
 * @property {MunitionTypeId} id
 * @property {string} label
 * @property {string} shortLabel
 * @property {number} burstRadiusCells Chebyshev radius in grid squares (0 = impact cell only)
 * @property {number} damageFraction 1 = 100% of target integrity
 */

/** Round the artillery fires. */
export const DEFAULT_MUNITION_ID = /** @type {MunitionTypeId} */ ('he');

/** @type {Record<MunitionTypeId, MunitionDef>} */
export const MUNITION_DEFS = {
  ap: {
    id: 'ap',
    label: 'Armor Piercing',
    shortLabel: 'AP',
    burstRadiusCells: 0,
    damageFraction: 1,
  },
  he: {
    id: 'he',
    label: 'High Explosive',
    shortLabel: 'HE',
    burstRadiusCells: 1,
    damageFraction: 1,
  },
};

/**
 * @param {string} [id]
 * @returns {MunitionDef}
 */
export function getMunitionDef(id = DEFAULT_MUNITION_ID) {
  const def = MUNITION_DEFS[/** @type {MunitionTypeId} */ (id)];
  if (!def) {
    throw new Error(`Unknown munition: ${id}`);
  }
  return def;
}

/**
 * Whether a cell is inside a munition burst (Chebyshev / king-move distance).
 * @param {{ x: number, y: number }} impactCell
 * @param {{ x: number, y: number }} targetCell
 * @param {number} burstRadiusCells
 */
export function isCellInBurst(impactCell, targetCell, burstRadiusCells) {
  const dx = Math.abs(targetCell.x - impactCell.x);
  const dy = Math.abs(targetCell.y - impactCell.y);
  return Math.max(dx, dy) <= burstRadiusCells;
}
