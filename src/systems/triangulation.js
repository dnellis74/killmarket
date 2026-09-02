import { CONFIG } from '../config.js';

/**
 * Cell position at bearing + distance from a sensor cell.
 */
export function polarOffsetFromSensor(sensorCell, bearingDeg, distanceMiles) {
  const angleRad = (bearingDeg * Math.PI) / 180;
  const distCells = distanceMiles / CONFIG.cellSizeMiles;
  return {
    x: sensorCell.x + Math.sin(angleRad) * distCells,
    y: sensorCell.y - Math.cos(angleRad) * distCells,
  };
}

function bearingDirection(bearingDeg) {
  const angleRad = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
}

function rayCircleIntersections(rayOrigin, direction, circleCenter, radiusCells) {
  const vx = rayOrigin.x - circleCenter.x;
  const vy = rayOrigin.y - circleCenter.y;
  const b = 2 * (vx * direction.x + vy * direction.y);
  const c = vx * vx + vy * vy - radiusCells * radiusCells;
  const disc = b * b - 4 * c;
  if (disc < 0) return [];

  const sqrtDisc = Math.sqrt(disc);
  const hits = [];
  for (const t of [(-b - sqrtDisc) / 2, (-b + sqrtDisc) / 2]) {
    if (t >= 0) {
      hits.push({
        t,
        point: {
          x: rayOrigin.x + t * direction.x,
          y: rayOrigin.y + t * direction.y,
        },
      });
    }
  }
  return hits;
}

/** Intersect two bearing rays from their sensor positions. */
export function triangulateFromTwoBearings(bearing1, bearing2) {
  const p1 = bearing1.sensorCell;
  const p2 = bearing2.sensorCell;
  const d1 = bearingDirection(bearing1.value);
  const d2 = bearingDirection(bearing2.value);

  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const diff = { x: p2.x - p1.x, y: p2.y - p1.y };
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-10) return null;

  const t = cross(diff, d2) / denom;
  const s = cross(diff, d1) / denom;
  if (t < 0 || s < 0) return null;

  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

/** Intersect two distance circles from their sensor positions. */
export function triangulateFromTwoDistances(distance1, distance2) {
  const c1 = distance1.sensorCell;
  const c2 = distance2.sensorCell;
  const r1 = distance1.value / CONFIG.cellSizeMiles;
  const r2 = distance2.value / CONFIG.cellSizeMiles;

  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-10) return [];
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  if (hSq < 0) return [];
  const h = Math.sqrt(hSq);

  const xm = c1.x + (a * dx) / d;
  const ym = c1.y + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;

  if (h < 1e-10) return [{ x: xm, y: ym }];

  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ];
}

/** Pick the point closest to a reference cell (disambiguate dual distance solutions). */
export function pickClosestPointToCell(points, cell) {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];

  let best = points[0];
  let bestDist = Infinity;
  for (const p of points) {
    const dx = p.x - cell.x;
    const dy = p.y - cell.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/** Bearing ray ∩ distance circle (possibly different sensors). */
export function triangulateTarget(bearingReading, distanceReading) {
  const bearingSensor = bearingReading.sensorCell;
  const distanceSensor = distanceReading.sensorCell;

  if (bearingSensor.x === distanceSensor.x && bearingSensor.y === distanceSensor.y) {
    return polarOffsetFromSensor(bearingSensor, bearingReading.value, distanceReading.value);
  }

  const angleRad = (bearingReading.value * Math.PI) / 180;
  const direction = { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
  const radiusCells = distanceReading.value / CONFIG.cellSizeMiles;
  const hits = rayCircleIntersections(bearingSensor, direction, distanceSensor, radiusCells);

  if (hits.length === 0) {
    return polarOffsetFromSensor(bearingSensor, bearingReading.value, distanceReading.value);
  }

  hits.sort((a, b) => a.t - b.t);
  return hits[0].point;
}

/**
 * Resolve a target estimate from available readings.
 * Priority: two bearings > two distances > one bearing + one distance.
 */
export function getFireSolution(readings, hiddenTargetCell) {
  const bearings = readings.filter((r) => r.type === 'bearing');
  const distances = readings.filter((r) => r.type === 'distance');

  if (bearings.length >= 2) {
    const b1 = bearings[bearings.length - 2];
    const b2 = bearings[bearings.length - 1];
    const point = triangulateFromTwoBearings(b1, b2);
    if (point) return { method: 'two-bearings', targetCell: point };
  }

  if (distances.length >= 2) {
    const d1 = distances[distances.length - 2];
    const d2 = distances[distances.length - 1];
    const points = triangulateFromTwoDistances(d1, d2);
    if (points.length > 0) {
      const targetCell = hiddenTargetCell
        ? pickClosestPointToCell(points, hiddenTargetCell)
        : points[0];
      return {
        method: 'two-distances',
        targetCell,
        ambiguousPoints: points.length > 1 ? points : undefined,
      };
    }
  }

  if (bearings.length >= 1 && distances.length >= 1) {
    const bearing = bearings[bearings.length - 1];
    const distance = distances[distances.length - 1];
    return {
      method: 'bearing-distance',
      targetCell: triangulateTarget(bearing, distance),
    };
  }

  return null;
}
