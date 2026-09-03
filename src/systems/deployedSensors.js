/**
 * Deployed-sensor presentation: animation state + draw/update.
 * Gameplay properties come from data/sensorDefs.js.
 */
import { CONFIG } from '../config.js';
import { getSensorDef } from '../data/sensorDefs.js';
import { cellToWorld } from './grid.js';

/**
 * Visual / timing knobs per sensor type — not gameplay accuracy or range.
 * @type {Record<string, {
 *   color: number,
 *   markerScale: number,
 *   pulseFadePerMs: number,
 *   sweepRateDegPerMs?: number,
 *   cycleMs?: number,
 *   pingZoneCellFactor?: number,
 * }>}
 */
const SENSOR_ANIM = {
  bearing: {
    color: 0xffcc00,
    markerScale: 0.28,
    pulseFadePerMs: 0.0015,
    sweepRateDegPerMs: 0.045,
  },
  range: {
    color: 0x00ff88,
    markerScale: 0.28,
    pulseFadePerMs: 0.0015,
    cycleMs: 2600,
    /** Ring ping tolerance as a fraction of cellPx. */
    pingZoneCellFactor: 0.9,
  },
};

function animFor(type) {
  return SENSOR_ANIM[type] ?? SENSOR_ANIM.bearing;
}

function cycleMsFor(type) {
  const anim = animFor(type);
  if (type === 'bearing') {
    return 360 / (anim.sweepRateDegPerMs ?? 0.045);
  }
  return anim.cycleMs ?? 2600;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Bearing 0° = north, clockwise → Phaser/canvas angle (0 = east, clockwise). */
function bearingToPhaserRad(bearingDeg, degreesToRadians) {
  return degreesToRadians(bearingDeg) - Math.PI / 2;
}

/** @typedef {import('../data/sensorDefs.js').SensorTypeId} DeployedSensorType */

/**
 * Animation-only runtime state for a deployed sensor.
 * @param {DeployedSensorType} type
 */
function createSensorAnimState(type) {
  return {
    sweepAngle: Math.random() * 360,
    ringPhase: 0,
    pulseGlow: 0,
    wasInPingZone: false,
    /** @type {{ fade: number, halfWidthDeg?: number }[]} */
    traces: [],
  };
}

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
  const def = getSensorDef(type);
  return {
    type,
    cell: { ...cell },
    readingValue,
    uncertaintyDeg:
      def.bearingUncertainty && readingValue != null
        ? (uncertaintyDeg ?? def.bearingUncertainty.minHalfWidthDeg)
        : null,
    elapsedMs: 0,
    markedForRetrieval: false,
    retrievalStarted: false,
    anim: createSensorAnimState(type),
  };
}

function bearingHalfWidth(sensor) {
  const def = getSensorDef(sensor.type);
  return (
    sensor.uncertaintyDeg ??
    def.bearingUncertainty?.minHalfWidthDeg ??
    5
  );
}

/**
 * @param {ReturnType<typeof createDeployedSensor>[]} sensors
 * @param {number} delta ms
 */
export function updateDeployedSensors(sensors, delta) {
  for (const sensor of sensors) {
    const def = getSensorDef(sensor.type);
    const animCfg = animFor(sensor.type);
    const anim = sensor.anim;
    const cycleMs = cycleMsFor(sensor.type);
    const milesToPx = CONFIG.cellPx / CONFIG.cellSizeMiles;
    const maxRadiusPx = def.rangeMiles * milesToPx;

    if (sensor.type === 'bearing') {
      const rate = animCfg.sweepRateDegPerMs ?? 0.045;
      anim.sweepAngle = (anim.sweepAngle + delta * rate) % 360;
      if (sensor.readingValue != null) {
        const halfWidth = bearingHalfWidth(sensor);
        const inPingZone = angleDiff(anim.sweepAngle, sensor.readingValue) < halfWidth;
        if (inPingZone && !anim.wasInPingZone) {
          anim.traces.push({ fade: 1, halfWidthDeg: halfWidth });
          anim.pulseGlow = 1;
        }
        anim.wasInPingZone = inPingZone;
        if (inPingZone) anim.pulseGlow = 1;
      }
    } else {
      const rangeCycle = animCfg.cycleMs ?? 2600;
      anim.ringPhase = (anim.ringPhase + delta / rangeCycle) % 1;
      if (sensor.readingValue != null) {
        const ringRadius = anim.ringPhase * maxRadiusPx;
        const targetPx = sensor.readingValue * milesToPx;
        const zone = CONFIG.cellPx * (animCfg.pingZoneCellFactor ?? 0.9);
        const inPingZone = Math.abs(ringRadius - targetPx) < zone;
        if (inPingZone && !anim.wasInPingZone) {
          anim.traces.push({ fade: 1 });
          anim.pulseGlow = 1;
        }
        anim.wasInPingZone = inPingZone;
        if (inPingZone) anim.pulseGlow = 1;
      }
    }

    for (const trace of anim.traces) {
      trace.fade -= delta / cycleMs;
    }
    anim.traces = anim.traces.filter((t) => t.fade > 0);

    anim.pulseGlow = Math.max(0, anim.pulseGlow - delta * animCfg.pulseFadePerMs);

    if (sensor.readingValue == null && !sensor.markedForRetrieval) {
      sensor.elapsedMs += delta;
      const cycles = Math.floor(sensor.elapsedMs / cycleMs);
      if (cycles >= def.maxCyclesWithoutContact) {
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

    const def = getSensorDef(sensor.type);
    const animCfg = animFor(sensor.type);
    const pos = cellToWorld(sensor.cell);
    const baseColor = animCfg.color;
    const maxRadiusPx = def.rangeMiles * milesToPx;
    const markerR = cellPx * animCfg.markerScale;

    drawSensorTraces(g, pos, sensor, maxRadiusPx, milesToPx, degreesToRadians, baseColor);

    g.fillStyle(baseColor, 0.95);
    g.fillCircle(pos.x, pos.y, markerR);
    g.lineStyle(1.5, 0xffffff, 0.7);
    g.strokeCircle(pos.x, pos.y, markerR);

    g.lineStyle(1, baseColor, 0.2);
    g.strokeCircle(pos.x, pos.y, maxRadiusPx);

    if (sensor.type === 'bearing') {
      drawBearingSensor(g, pos, sensor, maxRadiusPx, degreesToRadians, baseColor);
    } else {
      drawRangeSensor(g, pos, sensor, maxRadiusPx, milesToPx, baseColor);
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
  const anim = sensor.anim;
  if (sensor.readingValue == null || anim.traces.length === 0) return;

  for (const trace of anim.traces) {
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

function drawBearingSensor(g, pos, sensor, maxRadiusPx, degreesToRadians, color) {
  const anim = sensor.anim;
  const angleRad = bearingToPhaserRad(anim.sweepAngle, degreesToRadians);
  const endX = pos.x + Math.cos(angleRad) * maxRadiusPx;
  const endY = pos.y + Math.sin(angleRad) * maxRadiusPx;

  g.lineStyle(2, color, 0.55);
  g.lineBetween(pos.x, pos.y, endX, endY);

  if (anim.pulseGlow > 0 && sensor.readingValue != null) {
    const halfWidth = bearingHalfWidth(sensor);
    drawBearingArc(g, pos, sensor.readingValue, halfWidth, maxRadiusPx, degreesToRadians, {
      fillColor: color,
      fillAlpha: anim.pulseGlow * 0.35,
      strokeColor: 0xffffff,
      strokeAlpha: anim.pulseGlow * 0.65,
      strokeWidth: 3,
    });
  } else if (anim.pulseGlow > 0) {
    g.lineStyle(5, 0xffffff, anim.pulseGlow * 0.65);
    g.lineBetween(pos.x, pos.y, endX, endY);
    g.fillStyle(color, anim.pulseGlow * 0.35);
    g.fillCircle(endX, endY, 6);
  }
}

function drawRangeSensor(g, pos, sensor, maxRadiusPx, milesToPx, color) {
  const anim = sensor.anim;
  const ringRadius = anim.ringPhase * maxRadiusPx;
  const ringAlpha = 0.75 * (1 - anim.ringPhase * 0.85);

  g.lineStyle(2.5, color, ringAlpha);
  g.strokeCircle(pos.x, pos.y, ringRadius);

  if (ringRadius > 2) {
    g.lineStyle(1, color, ringAlpha * 0.35);
    g.strokeCircle(pos.x, pos.y, ringRadius * 0.92);
  }

  if (anim.pulseGlow > 0 && sensor.readingValue != null) {
    const pulseR = sensor.readingValue * milesToPx;
    g.lineStyle(4, 0xffffff, anim.pulseGlow * 0.75);
    g.strokeCircle(pos.x, pos.y, pulseR);
    g.fillStyle(color, anim.pulseGlow * 0.2);
    g.fillCircle(pos.x, pos.y, pulseR);
  }
}
