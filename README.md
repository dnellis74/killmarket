# Killmarket — Artillery Targeting MVP

A single-player artillery targeting prototype built with Vite and Phaser 3. Deploy sensor drones to locate hidden enemy units, then fire ballistic missions to destroy them. **Each contract defines its own payout and whether kills require sensor verification.**

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

The UI is **phone-first**: map on top, controls below, in a centered column (max 480px wide). The header shows your **balance**, **earned $**, and active **contracts** line (e.g. `2 × $500K contracts active ($1.0M total)`).

1. You start with **$1M**. Each drone deploy or fire mission costs **$100K**. Contracts are defined in config — the demo has two **$500K** contracts with **no verification required** (payout on direct hit).
2. Select **Bearing** or **Range** from the action panel.
3. Tap a grid cell on the map to choose coordinates. The action button switches to **Confirm coords** — tap it again to execute (two-step confirm). Tap a different cell to change coordinates before confirming.
4. The drone travels to the cell, attempts detection within a 3-mile radius, then returns.
5. **Fog of war:** the map starts with a 1-mile reveal around your artillery position. As the drone travels, it clears fog in a 1-mile visual range along its path. On landing, the 3-mile sensor scan clears fog in that radius.
6. Drones leave behind a **deployed sensor** at their landing cell. Bearing sensors sweep a yellow beam across their range and pulse when aligned with a target; range sensors emit an expanding green ring that fades at max range and pulses when it reaches a target.
7. **Fire Mission** is always available (unless game over or mid-action). Select it, tap a cell to aim, then **Confirm coords** to fire ($100K per attempt). Sensor readings help you decide where to click — hits are not guaranteed.
8. The turret rotates toward your aim point, elevates for range, and fires. A **direct hit** destroys the unit. Contracts **without verification** pay out immediately on hit; contracts **with verification** require a drone to confirm the kill before payout.
9. Drones report **combat effectiveness** (SALUTE) for each unit detected within 3 miles.
10. When **all** contracts are fulfilled, you win — **Mission Complete**.
11. If your balance reaches **$0** before mission complete, you lose — **Game Over** and enemy positions are revealed on the map.

## Controls

- **Drag** — pan the map
- **Scroll wheel** — zoom in/out
- **Tap grid cell** — choose coordinates for the selected action
- **Action button (Confirm coords)** — execute the pending drone deploy or fire mission after coordinates are set
- **Fire Mission button** — select fire mode (tap again without coordinates to cancel)

## Configuration

Edit `src/config.js`:

| Key | Default | Description |
|-----|---------|-------------|
| `startingMoney` | 1000000 | Initial balance ($) |
| `actionCost` | 100000 | Cost per drone deploy or fire mission ($) |
| `contracts` | `[{ value: 500000, verificationRequired: false }, …]` | Contract list — one hidden target each |
| `gridSize` | 100 | Grid cells per axis (10 mi × 10 mi) |
| `cellSizeMiles` | 0.1 | Miles per grid cell |
| `mapSizeMiles` | 10 | Map extent in miles |
| `detectionRadiusMiles` | 3 | Drone sensor scan range (also clears fog on arrival) |
| `initialRevealRadiusMiles` | 1 | Fog cleared around artillery at game start |
| `visualRangeMiles` | 1 | Fog cleared along drone travel path |
| `droneTravelDurationMs` | 2000 | Round-trip travel time (each leg = half) |
| `muzzleVelocity` | 800 | m/s, used in elevation formula |
| `gravity` | 9.8 | m/s² |
| `milesToMeters` | 1609.34 | Conversion factor |
| `playerCell` | `{ x: 10, y: 50 }` | Fixed artillery position |
| `cellPx` | 10 | Pixels per grid cell on screen |

## Combat Effectiveness (SALUTE)

Targets carry an effectiveness status reported by drone sensors on detection:

| Level | Label | Range |
|-------|-------|-------|
| `fully_effective` | Fully Effective (Green) | 85%–100% |
| `marginally_effective` | Marginally Effective (Amber) | 70%–84% |
| `ineffective` | Ineffective (Red) | 50%–69% |
| `combat_ineffective` | Combat Ineffective (Black) | <50% |

Current rules: detected untouched units report **Fully Effective**; fire hits set the target to **Combat Ineffective**. Payout timing depends on each contract's `verificationRequired` flag.

## Project Structure

```
src/
  main.js                  — Vite/Phaser bootstrap
  analytics.js             — GameAnalytics init and event helpers
  config.js                — Configurable game constants
  style.css                — UI overlay styles (phone-first layout)
  scenes/MapScene.js       — Grid, camera, player, drones, UI, fire animation
  systems/grid.js          — Cell/world coordinate conversion, bearing, distance
  systems/sensors.js       — Drone detection and effectiveness reporting
  systems/triangulation.js — Reading triangulation (intel visualization hints)
  systems/effectiveness.js — SALUTE effectiveness levels and helpers
  systems/ballistics.js    — Elevation formula and unit conversion
  systems/fogOfWar.js      — Revealed cells, fog clearing on travel and scan
  systems/deployedSensors.js — Left-behind sensor sweep and pulse animations
  state/gameState.js       — Money, contracts, readings, targets, drone registry
```

## Analytics (GameAnalytics)

Killmarket uses the official [`gameanalytics`](https://www.npmjs.com/package/gameanalytics) JavaScript SDK. Keys are read at build time from Vite env vars and are **never** committed to the repo.

1. Copy the example env file:

   ```bash
   cp .env.example .env.local
   ```

2. Add your Game Key and Secret Key from the [GameAnalytics dashboard](https://gameanalytics.com/) (Game Settings → SDK setup → JavaScript):

   ```
   VITE_GA_GAME_KEY=your_game_key_here
   VITE_GA_SECRET_KEY=your_secret_key_here
   ```

3. Restart the dev server after changing env vars (`npm run dev`). For production, set the same variables in your host (e.g. Vercel project settings).

If keys are missing, analytics is skipped silently (a dev-only console warning is shown).

### Tracked design events

| Event ID | When |
|----------|------|
| `Game:Start` | New game / scene restart |
| `Drone:Deploy:Bearing` | Bearing drone confirmed (custom fields: `cellX`, `cellY`) |
| `Drone:Deploy:Distance` | Distance drone confirmed (custom fields: `cellX`, `cellY`) |
| `Fire:Complete` | Fire mission animation finished (`cellX`, `cellY`, `hit`) |
| `Kill:Confirmed` | Sensor-confirmed kill / contract paid (value = payout $) |
| `Game:Over:Money` | Balance reached $0 before mission complete |
| `Mission:Complete` | All targets sensor-confirmed destroyed (value = earned $) |

Wrapper: `src/analytics.js`.

## Debug

In development mode (`npm run dev`), hidden target cells are logged to the browser console.
