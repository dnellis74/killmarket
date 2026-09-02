import { gameanalytics } from 'gameanalytics';

const { GameAnalytics } = gameanalytics;

let enabled = false;
let reportedGameOver = false;
let reportedVictory = false;

export function initAnalytics() {
  const gameKey = import.meta.env.VITE_GA_GAME_KEY;
  const secretKey = import.meta.env.VITE_GA_SECRET_KEY;

  if (!gameKey || !secretKey) {
    if (import.meta.env.DEV) {
      console.warn('[analytics] GameAnalytics keys missing — skipping init');
    }
    return;
  }

  GameAnalytics.configureBuild(import.meta.env.MODE);
  GameAnalytics.configureGameEngineVersion('Phaser3');
  GameAnalytics.setEnabledInfoLog(import.meta.env.DEV);
  GameAnalytics.initialize(gameKey, secretKey);
  enabled = true;
}

function trackDesign(eventId, value, fields) {
  if (!enabled) return;
  if (fields !== undefined) {
    GameAnalytics.addDesignEvent(eventId, value, fields);
  } else if (value !== undefined) {
    GameAnalytics.addDesignEvent(eventId, value);
  } else {
    GameAnalytics.addDesignEvent(eventId);
  }
}

/** New game session (including restarts). */
export function trackGameStart() {
  reportedGameOver = false;
  reportedVictory = false;
  trackDesign('Game:Start');
}

/** Sensor drone deployed at target cell. */
export function trackDroneDeploy(type, cell) {
  const eventId = type === 'bearing' ? 'Drone:Deploy:Bearing' : 'Drone:Deploy:Range';
  trackDesign(eventId, undefined, { cellX: cell.x, cellY: cell.y });
}

/** Fire mission finished at aim cell. */
export function trackFireMissionComplete(cell, hit) {
  trackDesign('Fire:Complete', undefined, {
    cellX: cell.x,
    cellY: cell.y,
    hit,
  });
}

/** Sensor-confirmed kill with contract payout. */
export function trackKillConfirmed(payout) {
  trackDesign('Kill:Confirmed', payout);
}

/** Player ran out of money before mission complete. */
export function trackGameOverMoney() {
  if (reportedGameOver) return;
  reportedGameOver = true;
  trackDesign('Game:Over:Money');
}

/** All targets sensor-confirmed destroyed. */
export function trackMissionComplete(score) {
  if (reportedVictory) return;
  reportedVictory = true;
  trackDesign('Mission:Complete', score);
}
