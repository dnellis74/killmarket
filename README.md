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

1. You start with **$1M**. **Passive** drones and fire missions cost **$100K**; **Active** drones cost **$25K**. Contracts are defined in config — the demo has two **$500K** contracts with **no verification required** (payout on direct hit).
2. Select **Passive** (bearing) or **Active** (range) from the action panel.
3. Tap a grid cell on the map to choose coordinates. The action button switches to **Confirm coords** — tap it again to execute (two-step confirm). Tap a different cell to change coordinates before confirming.
4. The drone travels to the cell, attempts detection within its scan radius (**Passive** 1.5 mi / **Active** 0.375 mi), then returns.
5. **Fog of war (two layers):**
   - **Aerial recon** — unrevealed terrain shows a greyscale map; your base and drone flight path reveal color imagery (`initialRevealRadiusMiles` at start, `visualRangeMiles` while drones travel).
   - **Sensor fog** — a dark overlay covers unscanned areas; it clears in the drone’s scan radius when it lands and scans.
6. Drones leave behind a **deployed sensor** at their landing cell. **Passive** sensors sweep a yellow beam across their range and pulse when aligned with a target — accuracy degrades with range (tight arc nearby, up to a **90°** ping lobe at max range); **Active** sensors emit an expanding green ring that fades at max range and pulses when it reaches a target.
7. **Fire Mission** is always available (unless game over or mid-action). Select it, tap a cell to aim, then **Confirm coords** to fire ($100K per attempt). Sensor readings help you decide where to click — hits are not guaranteed.
8. The turret rotates toward your aim point, elevates for range, and fires. A **direct hit** destroys the unit. Contracts **without verification** pay out immediately on hit; contracts **with verification** require a drone to confirm the kill before payout.
9. Drones report **combat effectiveness** (SALUTE) for each unit detected within scan range.
10. When **all** contracts are fulfilled, you win — **Mission Complete**.
11. If your balance reaches **$0** before mission complete, you lose — **Budget Exhausted** and enemy positions are revealed on the map.

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
| `actionCost` | 100000 | Cost for Passive drone or fire mission ($) |
| `activeActionCost` | 25000 | Cost for Active drone ($) — 1/4 of Passive |
| `contracts` | `[{ value: 500000, verificationRequired: false }, …]` | Contract list — one hidden target each |
| `gridSize` | 128 | Grid cells per axis |
| `cellSizeMiles` | 0.05 | Miles per grid cell |
| `mapSizeMiles` | 6.4 | Map extent in miles |
| `initialRevealRadiusMiles` | 0.5 | Aerial recon around artillery at game start |
| `visualRangeMiles` | 0.25 | Aerial recon along drone travel path |
| `droneTravelDurationMs` | 2000 | Round-trip travel time (each leg = half) |
| `muzzleVelocity` | 800 | m/s, used in elevation formula |
| `gravity` | 9.8 | m/s² |
| `milesToMeters` | 1609.34 | Conversion factor |
| `playerCell` | `{ x: 112, y: 112 }` | Fixed artillery position |
| `cellPx` | 4 | Pixels per grid cell on screen |

### Sensors (`src/data/sensorDefs.js`)

Gameplay properties (range, bearing uncertainty, empty-cycle retrieval) are **data-driven** and separate from sweep/ring animation in `systems/deployedSensors.js`.

| Def field | Passive (`bearing`) | Active (`range`) |
|-----------|--------------------|------------------|
| `rangeMiles` | 1.5 | 0.375 |
| `bearingUncertainty` | min 5° / max 45° half-width | — |
| `maxCyclesWithoutContact` | 4 | 4 |

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
  config.js                — Economy, map, ballistics constants
  data/sensorDefs.js       — Data-driven sensor range / accuracy / retrieval
  style.css                — UI overlay styles (phone-first layout)
  scenes/MapScene.js       — Grid, camera, player, drones, UI, fire animation
  systems/grid.js          — Cell/world coordinate conversion, bearing, distance
  systems/sensors.js       — Drone detection (reads sensorDefs)
  systems/triangulation.js — Reading triangulation (intel visualization hints)
  systems/effectiveness.js — SALUTE effectiveness levels and helpers
  systems/ballistics.js    — Elevation formula and unit conversion
  systems/fogOfWar.js      — Revealed cells, fog clearing on travel and scan
  systems/deployedSensors.js — Deployed sensor animation only (sweep / ring / traces)
  systems/speech.js        — meSpeak.js TTS (visual contact callouts)
  state/gameState.js       — Money, contracts, readings, targets, drone registry
public/
  mespeak/                 — Vendored meSpeak.js 2.0.7 + en-us voice (GPL-3.0)
```

## Speech (meSpeak.js)

Killmarket uses [meSpeak.js](https://www.masswerk.at/mespeak/) for radio-style callouts. Assets are vendored under `public/mespeak/` (GPL-3.0; see `public/mespeak/License.txt`).

Currently spoken:
- **Visual contact** — when a drone first spots a target in visual range
- **Target neutralized** — on a fire hit that finds a target, or sensor kill confirmation
- **Victory** — `mission complete. request retrieval` when all contracts are fulfilled
- **Budget exhausted** — `budget exhausted` when the player runs out of money


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
| `Drone:Deploy:Bearing` | Passive drone confirmed (custom fields: `cellX`, `cellY`) |
| `Drone:Deploy:Distance` | Active drone confirmed (custom fields: `cellX`, `cellY`) |
| `Fire:Complete` | Fire mission animation finished (`cellX`, `cellY`, `hit`) |
| `Kill:Confirmed` | Sensor-confirmed kill / contract paid (value = payout $) |
| `Game:Over:Money` | Balance reached $0 before mission complete |
| `Mission:Complete` | All targets sensor-confirmed destroyed (value = earned $) |

Wrapper: `src/analytics.js`.

## Debug

In development mode (`npm run dev`), hidden target cells are logged to the browser console.
