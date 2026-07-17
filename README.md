# EmpirePhone ⚔️

A classic-style real-time strategy game — four resources, four ages, villagers,
counter units and castle sieges — rebuilt from scratch as a **touch-first web game
for phones**. Runs entirely in the browser with zero dependencies; all art and
sound are procedurally generated.

> This is an original game *inspired by* classic age-based RTS gameplay.
> It contains no assets, code, names or data from Age of Empires II, which is
> the property of Microsoft.

## ▶️ Play it on your iPhone

The game is a static web page — any static host works:

1. **GitHub Pages (recommended):** repo **Settings → Pages → Deploy from a
   branch**, pick this branch, folder `/ (root)`. Open the published URL in
   Safari on your phone.
2. In Safari, tap **Share → Add to Home Screen**. The game installs like an
   app: full screen, no browser chrome.
3. **Offline play**: after the first load, a service worker caches the whole
   game — a "📦 Game cached" toast confirms it. From then on it launches and
   plays with no connection at all (airplane mode included), and your saved
   game lives on the device.
4. Landscape is the intended orientation (it's a wide battlefield).

To try it on a computer first: `python3 -m http.server` in the repo folder,
then open `http://localhost:8000` (mouse works: drag to pan, wheel to zoom,
shift-drag to box-select).

## 🎮 How to play

| Gesture | Action |
|---|---|
| Tap | Select unit/building · with units selected: move / attack / gather |
| Drag | Pan the camera |
| Pinch | Zoom |
| Long-press + drag | Box-select troops |
| Double-tap a unit | Select all of that type on screen |
| Tap minimap | Jump the camera |

- **Economy:** villagers gather 🪵 wood, 🍖 food, 🪙 gold, 🪨 stone and drop
  them at the Town Center, Mill, Lumber Camp or Mining Camp. Houses raise the
  population cap. Build farms when the berries run out.
- **Ages:** Dark → Feudal → Castle → Imperial. Each advance needs 2 buildings
  of your current age plus resources, and unlocks new units, buildings,
  technologies and unit-line upgrades (Militia → Man-at-Arms → Long
  Swordsman → Champion, and more).
- **Counters:** Spearmen beat cavalry · Skirmishers beat archers · Knights
  crush archers and siege · Battering Rams, Mangonels and Trebuchets wreck
  buildings · Castles and Watch Towers hold the line.
- **More tools:** the Market trades resources for gold · Monks convert enemy
  units and heal your own · Palisade and Stone Walls buy you time · the ⏩
  button in the top bar runs the game at 1×/1.5×/2×.
- **Naval play:** build a Dock on a lake shore, fish the shoals with Fishing
  Ships for fast food, and bombard shorelines with War Galleys.
- **1 or 2 opponents:** face a single rival or two allied AI empires
  attacking from different directions. Three difficulty levels that change
  the AI's economy, villager count and army sizes.
- **Saved games:** progress auto-saves every 30 seconds, on pause, and when
  you switch apps — pick up where you left off with *Continue* on the menu.
- **Win** by destroying every rival's army and buildings before their attack
  waves overwhelm you.

## 🛠 Tech

- Plain HTML5 canvas + vanilla JS (`js/` — data, engine, AI, renderer, input, UI)
- Isometric renderer with procedural sprites, fog of war, minimap
- A* pathfinding, soft unit separation, projectile & splash combat,
  unit conversion and healing
- Full AI opponent: economy management, base building, age progression,
  market trading, base defense, escalating attack waves
- PWA: manifest + service worker → installable and playable offline
- No build step, no dependencies

## 📱 Going native later (optional)

If you ever want it on the App Store, wrap this repo with
[Capacitor](https://capacitorjs.com/) (`npx cap add ios`) — the game already
handles safe-area insets, touch gestures and high-DPI rendering.
