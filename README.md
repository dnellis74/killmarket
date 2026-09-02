# Killmarket — Artillery Targeting MVP

A single-player artillery targeting prototype built with Vite and Phaser 3. Deploy sensor drones to locate hidden enemy units, then fire ballistic missions to destroy them. **Score comes from sensor-confirmed kills, not from fire missions alone.**

**Repository:** [github.com/dnellis74/killmarket](https://github.com/dnellis74/killmarket)

## Quick Start

```bash
git clone https://github.com/dnellis74/killmarket.git
cd killmarket
npm install
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview   # optional: serve the production build locally
```

## Deploy to Vercel

```bash
npx vercel
```

Or connect the repo in the Vercel dashboard. The project builds with `npm run build` and serves static files from `dist/`.

## How to Play

1. Select **Bearing Drone** or **Distance Drone** from the UI panel.
2. Click a grid cell on the map to deploy the drone (costs 10 energy).
3. The drone travels to the cell, attempts detection within a 3-mile radius, then returns.
4. Successful readings appear as a bearing ray (yellow) or distance ring (green) from the drone's landing position (sensor).
5. Once you have enough readings (two bearings, two distances, or one of each), click **Fire Mission** to enter fire mode.
6. Click a grid cell on the map to aim and fire (costs 10 energy per attempt). Use your sensor readings to decide where to click — hits are not guaranteed.
7. The turret rotates toward your aim point, elevates for range, and fires. Fire does **not** tell you whether you hit — outcome is unknown until sensors confirm. A direct hit marks that unit **Combat Ineffective** internally but does not award points or reveal success.
8. Drones report **combat effectiveness** (SALUTE) for each unit detected within 3 miles. Detected untouched units report **Fully Effective**; hit units report **Combat Ineffective**.
9. Score **+1 point** when a drone detects a **Combat Ineffective** (destroyed) unit — not on fire. Each destroyed unit can only be scored once.
10. When **all** enemy units are **sensor-confirmed** destroyed, you win — **Mission Complete**.
11. Energy starts at 100; each action costs 10. If energy reaches 0 **before** mission complete, you lose — enemy positions are revealed.

## Controls

- **Drag** — pan the map
- **Scroll wheel** — zoom in/out
- **Click grid cell** — deploy selected drone type, or aim and fire in fire mode
- **Fire Mission button** — toggle fire mode (click again to cancel)

## Configuration

Edit `src/config.js`:

| Key | Default | Description |
|-----|---------|-------------|
| `startingEnergy` | 100 | Initial energy pool |
| `actionCost` | 10 | Energy cost per drone deploy or fire mission |
| `gridSize` | 100 | Grid cells per axis (10 mi × 10 mi) |
| `cellSizeMiles` | 0.1 | Miles per grid cell |
| `detectionRadiusMiles` | 3 | Drone sensor range |
| `droneTravelDurationMs` | 2000 | Round-trip travel time (each leg = half) |
| `muzzleVelocity` | 800 | m/s, used in elevation formula |
| `gravity` | 9.8 | m/s² |
| `milesToMeters` | 1609.34 | Conversion factor |
| `playerCell` | `{ x: 10, y: 50 }` | Fixed artillery position |
| `targetCount` | 2 | Number of hidden enemy units |

## Combat Effectiveness (SALUTE)

Targets carry an effectiveness status reported by drone sensors on detection:

| Level | Label | Range |
|-------|-------|-------|
| `fully_effective` | Fully Effective (Green) | 85%–100% |
| `marginally_effective` | Marginally Effective (Amber) | 70%–84% |
| `ineffective` | Ineffective (Red) | 50%–69% |
| `combat_ineffective` | Combat Ineffective (Black) | <50% |

Current rules: detected untouched units report **Fully Effective**; fire hits set the target to **Combat Ineffective**. Points are awarded when a drone detects and confirms a destroyed unit.

## Project Structure

```
src/
  main.js                  — Vite/Phaser bootstrap
  config.js                — Configurable game constants
  style.css                — UI overlay styles
  scenes/MapScene.js       — Grid, camera, player, drones, UI, fire animation
  systems/grid.js          — Cell/world coordinate conversion, bearing, distance
  systems/sensors.js       — Drone detection and effectiveness reporting
  systems/triangulation.js — Reading triangulation (intel visualization hints)
  systems/effectiveness.js — SALUTE effectiveness levels and helpers
  systems/ballistics.js    — Elevation formula and unit conversion
  state/gameState.js       — Energy, readings, targets, drone registry
```

## Debug

In development mode (`npm run dev`), hidden target cells are logged to the browser console.
