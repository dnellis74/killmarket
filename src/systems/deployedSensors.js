import { CONFIG, getDetectionRadiusMiles } from '../config.js';
import { cellToWorld } from './grid.js';

const BEARING_SWEEP_RATE = 0.045; // degrees per ms
const BEARING_CYCLE_MS = 360 / BEARING_SWEEP_RATE;
const RANGE_CYCLE_MS = 2600;
/** Fallback half-width when a legacy sensor has no uncertaintyDeg. */
const DEFAULT_BEARING_HALF_WIDTH_DEG = 5;
export const MAX_CYCLES_WITHOUT_CONTACT = 4;

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Bearing 0° = north, clockwise → Phaser/canvas angle (0 = east, clockwise). */
function bearingToPhaserRad(bearingDeg, degreesToRadians) {
  return degreesToRadians(bearingDeg) - Math.PI / 2;
}

/** @typedef {'bearing' | 'range'} DeployedSensorType */

/**
 * @param {DeployedSensorType} type
 * @param {{ x: number, y: number }} cell
 * @param {number | null} readingValue bearing degrees or range miles when contact made
 * @param {number | null} [uncertaintyDeg] passive: half-width of ping/display arc
 */
export function createDeployedSensor(
  type,
  cell,
  readingValue = null,
  uncertaintyDeg = null
) {
  return {
    type,
    cell: { ...cell },
    readingValue,
    /** Passive: half-width of uncertainty arc (full arc = 2×). */
    uncertaintyDeg:
      type === 'bearing' && readingValue != null
        ? (uncertaintyDeg ?? DEFAULT_BEARING_HALF_WIDTH_DEG)
        : null,
    sweepAngle: Math.random() * 360,
    ringPhase: 0,
    pulseGlow: 0,
    wasInPingZone: false,
    elapsedMs: 0,
    markedForRetrieval: false,
    retrievalStarted: false,
    /** @type {{ fade: number, halfWidthDeg?: number }[]} */
    traces: [],
  };
}

function cycleMsFor(sensor) {
  return sensor.type === 'bearing' ? BEARING_CYCLE_MS : RANGE_CYCLE_MS;
}

function bearingHalfWidth(sensor) {
  return sensor.uncertaintyDeg ?? DEFAULT_BEARING_HALF_WIDTH_DEG;
}

/**
 * @param {ReturnType<typeof createDeployedSensor>[]} sensors
 * @param {number} delta ms
 */
export function updateDeployedSensors(sensors, delta) {
  for (const sensor of sensors) {
    const cycleMs = cycleMsFor(sensor);
    const milesToPx = CONFIG.cellPx / CONFIG.cellSizeMiles;
    const maxRadiusPx = getDetectionRadiusMiles(sensor.type) * milesToPx;

    if (sensor.type === 'bearing') {
      sensor.sweepAngle = (sensor.sweepAngle + delta * BEARING_SWEEP_RATE) % 360;
      if (sensor.readingValue != null) {
        const halfWidth = bearingHalfWidth(sensor);
        const inPingZone =
          angleDiff(sensor.sweepAngle, sensor.readingValue) < halfWidth;
        if (inPingZone && !sensor.wasInPingZone) {
          sensor.traces.push({ fade: 1, halfWidthDeg: halfWidth });
          sensor.pulseGlow = 1;
        }
        sensor.wasInPingZone = inPingZone;
        if (inPingZone) sensor.pulseGlow = 1;
      }
    } else {
      sensor.ringPhase = (sensor.ringPhase + delta / RANGE_CYCLE_MS) % 1;
      if (sensor.readingValue != null) {
        const ringRadius = sensor.ringPhase * maxRadiusPx;
        const targetPx = sensor.readingValue * milesToPx;
        const inPingZone = Math.abs(ringRadius - targetPx) < CONFIG.cellPx * 0.9;
        if (inPingZone && !sensor.wasInPingZone) {
          sensor.traces.push({ fade: 1 });
          sensor.pulseGlow = 1;
        }
        sensor.wasInPingZone = inPingZone;
        if (inPingZone) sensor.pulseGlow = 1;
      }
    }

    for (const trace of sensor.traces) {
      trace.fade -= delta / cycleMs;
    }
    sensor.traces = sensor.traces.filter((t) => t.fade > 0);

    sensor.pulseGlow = Math.max(0, sensor.pulseGlow - delta * 0.0015);

    if (sensor.readingValue == null && !sensor.markedForRetrieval) {
      sensor.elapsedMs += delta;
      const cycles = Math.floor(sensor.elapsedMs / cycleMs);
      if (cycles >= MAX_CYCLES_WITHOUT_CONTACT) {
        sensor.markedForRetrieval = true;
      }
    }
  }
}

/**
 * @param {Phaser.GameObjects.Graphics} g
 * @param {ReturnType<typeof createDeployedSensor>[]} sensors
 * @param {number} cellPx
 * @param {(deg: number) => number} degreesToRadians
 */
export function drawDeployedSensors(g, sensors, cellPx, degreesToRadians) {
  g.clear();
  const milesToPx = cellPx / CONFIG.cellSizeMiles;

  for (const sensor of sensors) {
    if (sensor.retrievalStarted) continue;

    const pos = cellToWorld(sensor.cell);
    const isBearing = sensor.type === 'bearing';
    const baseColor = isBearing ? 0xffcc00 : 0x00ff88;
    const maxRadiusPx = getDetectionRadiusMiles(sensor.type) * milesToPx;

    drawSensorTraces(
      g,
      pos,
      sensor,
      maxRadiusPx,
      milesToPx,
      degreesToRadians,
      baseColor
    );

    g.fillStyle(baseColor, 0.95);
    g.fillCircle(pos.x, pos.y, cellPx * 0.28);
    g.lineStyle(1.5, 0xffffff, 0.7);
    g.strokeCircle(pos.x, pos.y, cellPx * 0.28);

    g.lineStyle(1, baseColor, 0.2);
    g.strokeCircle(pos.x, pos.y, maxRadiusPx);

    if (isBearing) {
      drawBearingSensor(g, pos, sensor, maxRadiusPx, degreesToRadians);
    } else {
      drawRangeSensor(g, pos, sensor, maxRadiusPx, milesToPx);
    }
  }
}

function drawBearingArc(
  g,
  pos,
  centerBearingDeg,
  halfWidthDeg,
  radiusPx,
  degreesToRadians,
  { fillColor, fillAlpha, strokeColor, strokeAlpha, strokeWidth }
) {
  if (halfWidthDeg < 0.5) {
    const rad = bearingToPhaserRad(centerBearingDeg, degreesToRadians);
    const tx = pos.x + Math.cos(rad) * radiusPx;
    const ty = pos.y + Math.sin(rad) * radiusPx;
    if (strokeColor != null) {
      g.lineStyle(strokeWidth ?? 3, strokeColor, strokeAlpha ?? 1);
      g.lineBetween(pos.x, pos.y, tx, ty);
    }
    return;
  }

  const startRad = bearingToPhaserRad(centerBearingDeg - halfWidthDeg, degreesToRadians);
  const endRad = bearingToPhaserRad(centerBearingDeg + halfWidthDeg, degreesToRadians);

  if (fillColor != null && fillAlpha > 0) {
    g.fillStyle(fillColor, fillAlpha);
    g.beginPath();
    g.moveTo(pos.x, pos.y);
    g.arc(pos.x, pos.y, radiusPx, startRad, endRad, false);
    g.closePath();
    g.fillPath();
  }

  if (strokeColor != null && strokeAlpha > 0) {
    g.lineStyle(strokeWidth ?? 2, strokeColor, strokeAlpha);
    g.beginPath();
    g.moveTo(pos.x, pos.y);
    g.arc(pos.x, pos.y, radiusPx, startRad, endRad, false);
    g.closePath();
    g.strokePath();
  }
}

function drawSensorTraces(g, pos, sensor, maxRadiusPx, milesToPx, degreesToRadians, color) {
  if (sensor.readingValue == null || sensor.traces.length === 0) return;

  for (const trace of sensor.traces) {
    const alpha = trace.fade * 0.9;
    if (alpha <= 0) continue;

    if (sensor.type === 'bearing') {
      const halfWidth = trace.halfWidthDeg ?? bearingHalfWidth(sensor);
      drawBearingArc(g, pos, sensor.readingValue, halfWidth, maxRadiusPx, degreesToRadians, {
        fillColor: color,
        fillAlpha: alpha * 0.28,
        strokeColor: color,
        strokeAlpha: alpha * 0.85,
        strokeWidth: 2.5,
      });
      drawBearingArc(g, pos, sensor.readingValue, halfWidth, maxRadiusPx, degreesToRadians, {
        fillColor: null,
        fillAlpha: 0,
        strokeColor: 0xffffff,
        strokeAlpha: alpha * 0.3,
        strokeWidth: 1.25,
      });
    } else {
      const targetPx = sensor.readingValue * milesToPx;
      g.lineStyle(2.5, color, alpha);
      g.strokeCircle(pos.x, pos.y, targetPx);
      g.lineStyle(1, 0xffffff, alpha * 0.3);
      g.strokeCircle(pos.x, pos.y, targetPx);
    }
  }
}

function drawBearingSensor(g, pos, sensor, maxRadiusPx, degreesToRadians) {
  const angleRad = bearingToPhaserRad(sensor.sweepAngle, degreesToRadians);
  const endX = pos.x + Math.cos(angleRad) * maxRadiusPx;
  const endY = pos.y + Math.sin(angleRad) * maxRadiusPx;

  g.lineStyle(2, 0xffcc00, 0.55);
  g.lineBetween(pos.x, pos.y, endX, endY);

  if (sensor.pulseGlow > 0 && sensor.readingValue != null) {
    const halfWidth = bearingHalfWidth(sensor);
    drawBearingArc(g, pos, sensor.readingValue, halfWidth, maxRadiusPx, degreesToRadians, {
      fillColor: 0xffcc00,
      fillAlpha: sensor.pulseGlow * 0.35,
      strokeColor: 0xffffff,
      strokeAlpha: sensor.pulseGlow * 0.65,
      strokeWidth: 3,
    });
  } else if (sensor.pulseGlow > 0) {
    g.lineStyle(5, 0xffffff, sensor.pulseGlow * 0.65);
    g.lineBetween(pos.x, pos.y, endX, endY);
    g.fillStyle(0xffcc00, sensor.pulseGlow * 0.35);
    g.fillCircle(endX, endY, 6);
  }
}

function drawRangeSensor(g, pos, sensor, maxRadiusPx, milesToPx) {
  const ringRadius = sensor.ringPhase * maxRadiusPx;
  const ringAlpha = 0.75 * (1 - sensor.ringPhase * 0.85);

  g.lineStyle(2.5, 0x00ff88, ringAlpha);
  g.strokeCircle(pos.x, pos.y, ringRadius);

  if (ringRadius > 2) {
    g.lineStyle(1, 0x00ff88, ringAlpha * 0.35);
    g.strokeCircle(pos.x, pos.y, ringRadius * 0.92);
  }

  if (sensor.pulseGlow > 0 && sensor.readingValue != null) {
    const pulseR = sensor.readingValue * milesToPx;
    g.lineStyle(4, 0xffffff, sensor.pulseGlow * 0.75);
    g.strokeCircle(pos.x, pos.y, pulseR);
    g.fillStyle(0x00ff88, sensor.pulseGlow * 0.2);
    g.fillCircle(pos.x, pos.y, pulseR);
  }
}
