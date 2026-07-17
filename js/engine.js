'use strict';
// ============================================================
// Engine: map generation, pathfinding, entities, simulation.
// ============================================================

const MAP_W = 88, MAP_H = 88;
const T_GRASS = 0, T_GRASS2 = 1, T_DIRT = 2, T_WATER = 3, T_SAND = 4;

let G = null; // active game state

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Map ----------------
function makeMap(rng) {
  const terr = new Uint8Array(MAP_W * MAP_H);
  const res = new Array(MAP_W * MAP_H).fill(null);   // resource entity per tile
  const occ = new Array(MAP_W * MAP_H).fill(null);   // building per tile

  for (let i = 0; i < terr.length; i++) terr[i] = rng() < 0.18 ? T_GRASS2 : T_GRASS;
  // dirt patches
  for (let p = 0; p < 26; p++) blob(terr, rng, T_DIRT, 2 + (rng() * 4 | 0));
  // a lake or two away from spawn corners
  for (let p = 0; p < 2; p++) {
    const cx = 30 + rng() * 28, cy = 30 + rng() * 28;
    blobAt(terr, rng, T_WATER, cx, cy, 3 + rng() * 3, T_SAND);
  }
  return { terr, res, occ };

  function blob(t, rng, type, r) {
    blobAt(t, rng, type, 4 + rng() * (MAP_W - 8), 4 + rng() * (MAP_H - 8), r, null);
  }
  function blobAt(t, rng, type, cx, cy, r, edge) {
    for (let y = Math.max(0, cy - r - 1 | 0); y <= Math.min(MAP_H - 1, cy + r + 1 | 0); y++)
      for (let x = Math.max(0, cx - r - 1 | 0); x <= Math.min(MAP_W - 1, cx + r + 1 | 0); x++) {
        const d = Math.hypot(x - cx, y - cy) + rng() * 1.4;
        if (d < r) t[y * MAP_W + x] = type;
        else if (edge !== null && d < r + 1.2) t[y * MAP_W + x] = edge;
      }
  }
}

const tIdx = (x, y) => y * MAP_W + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

function terrainPassable(x, y) {
  if (!inMap(x, y)) return false;
  return G.map.terr[tIdx(x, y)] !== T_WATER;
}
function tilePassable(x, y) {
  if (!terrainPassable(x, y)) return false;
  const i = tIdx(x, y);
  if (G.map.res[i]) return false;
  const b = G.map.occ[i];
  if (b && !BUILDINGS[b.type].passable) return false;
  return true;
}

// ---------------- Entities ----------------
let NEXT_ID = 1;

function addResource(rtype, tx, ty, amount) {
  const r = { id: NEXT_ID++, kind: 'res', rtype, tx, ty, amount, max: amount };
  G.map.res[tIdx(tx, ty)] = r;
  G.resources.push(r);
  return r;
}

function resGives(r) { // which player-resource a map resource yields
  return r.rtype === 'berry' ? 'food' : r.rtype === 'tree' ? 'wood' : r.rtype;
}

function addBuilding(owner, type, tx, ty, finished) {
  const d = BUILDINGS[type];
  const b = {
    id: NEXT_ID++, kind: 'bldg', type, owner, tx, ty, size: d.size,
    hp: finished ? d.hp : Math.max(1, d.hp * 0.1), maxhp: d.hp,
    done: finished, progress: finished ? d.time : 0,
    queue: [], rally: null, cooldown: 0,
    farmFood: d.farmFood || 0, farmer: null,
  };
  for (let y = ty; y < ty + d.size; y++)
    for (let x = tx; x < tx + d.size; x++) G.map.occ[tIdx(x, y)] = b;
  G.buildings.push(b);
  const p = G.players[owner];
  if (finished && d.pop) p.popCap += d.pop;
  return b;
}

function addUnit(owner, type, x, y) {
  const d = UNITS[type];
  const p = G.players[owner];
  const u = {
    id: NEXT_ID++, kind: 'unit', type, owner, x, y,
    hp: unitStat({ type, owner }, 'hp'), // full HP incl. researched buffs
    task: 'idle', target: null, path: null, pathI: 0, carry: 0, carryType: null,
    cooldown: 0, repath: 0, dir: 0, wtx: -1, wty: -1, gatherKind: null,
  };
  u.maxhp = u.hp;
  G.units.push(u);
  p.pop += d.pop;
  return u;
}

// Effective stat with player tech modifiers
function unitStat(u, stat) {
  const d = UNITS[u.type], p = G.players[u.owner];
  const buff = p.buffs[u.type] || {};
  let v = (d[stat] || 0) + (buff[stat] || 0);
  const melee = d.range < 1, military = d.cls !== 'vill';
  if (stat === 'atk') v += melee ? (d.cls === 'siege' ? 0 : p.mod.meleeAtk) : p.mod.rangedAtk;
  if (stat === 'range' && !melee) v += p.mod.rangeUp;
  if (stat === 'armor' && military && (d.cls === 'inf' || d.cls === 'cav')) v += p.mod.meleeArmor;
  if (stat === 'parmor' && military && (d.cls === 'inf' || d.cls === 'cav')) v += p.mod.meleeArmor;
  if (stat === 'speed' && d.cls === 'vill') v += d.speed * p.vill.speed;
  return v;
}
function unitName(u) {
  const buff = G.players[u.owner].buffs[u.type];
  return (buff && buff.rename) || UNITS[u.type].name;
}
function unitBonus(u) {
  const d = UNITS[u.type], buff = G.players[u.owner].buffs[u.type] || {};
  return buff.bonus ? Object.assign({}, d.bonus, buff.bonus) : d.bonus;
}

// ---------------- Players ----------------
function makePlayer(id, isAI, color) {
  return {
    id, isAI, color,
    res: { wood: 200, food: 200, gold: 100, stone: 200 },
    age: 0, ageResearch: null,      // {t, total}
    pop: 0, popCap: 0,
    techs: {}, researching: {},     // techId -> {t,total,bldg}
    rates: { wood: 1, food: 1, gold: 1, stone: 1, farm: 1 },
    vill: { speed: 0, carry: 0 },
    mod: { meleeAtk: 0, rangedAtk: 0, rangeUp: 0, meleeArmor: 0 },
    buffs: {},                       // unitType -> accumulated buff
    defeated: false,
    ai: isAI ? { t: 0, wave: 0, attackAt: 8, mode: 'boom', regroup: 0 } : null,
  };
}

function canAfford(p, cost) { return Object.entries(cost).every(([k, v]) => p.res[k] >= v); }

// ---- market trading ----
function marketSell(p, k) {
  if (k === 'gold' || p.res[k] < 100) return false;
  p.res[k] -= 100; p.res.gold += TRADE_SELL;
  return true;
}
function marketBuy(p, k) {
  if (k === 'gold' || p.res.gold < TRADE_BUY) return false;
  p.res.gold -= TRADE_BUY; p.res[k] += 100;
  return true;
}
function pay(p, cost) { for (const [k, v] of Object.entries(cost)) p.res[k] -= v; }
function refund(p, cost, frac) { for (const [k, v] of Object.entries(cost)) p.res[k] += Math.floor(v * frac); }

function applyTech(p, id) {
  const t = TECHS[id];
  p.techs[id] = true;
  if (t.rate) for (const [k, v] of Object.entries(t.rate)) p.rates[k] += v;
  if (t.vill) { p.vill.speed += t.vill.speed || 0; p.vill.carry += t.vill.carry || 0; }
  if (t.mod) for (const [k, v] of Object.entries(t.mod)) p.mod[k] += v;
  if (t.buff) {
    for (const ut of t.buff.units) {
      const b = p.buffs[ut] = p.buffs[ut] || {};
      for (const k of ['hp', 'atk', 'range', 'armor', 'parmor', 'speed']) if (t.buff[k]) b[k] = (b[k] || 0) + t.buff[k];
      if (t.buff.rename) b.rename = t.buff.rename;
      if (t.buff.bonus) b.bonus = t.buff.bonus;
      if (t.buff.hp) for (const u of G.units) if (u.owner === p.id && u.type === ut) { u.hp += t.buff.hp; u.maxhp += t.buff.hp; }
    }
  }
}

// ---------------- Game setup ----------------
function newGame(difficulty) {
  const rng = mulberry32((Math.random() * 1e9) | 0);
  G = {
    rng, map: makeMap(rng), units: [], buildings: [], resources: [], projectiles: [],
    players: [makePlayer(0, false, '#3d7ef5'), makePlayer(1, true, '#e33e3e')],
    time: 0, over: null, difficulty,
    explored: new Uint8Array(MAP_W * MAP_H), visible: new Uint8Array(MAP_W * MAP_H),
    fogT: 0, sepGrid: new Map(), effects: [],
  };
  const spots = [[12, MAP_H - 16], [MAP_W - 16, 12]]; // player bottom-left, enemy top-right (iso)
  for (let pi = 0; pi < 2; pi++) {
    const [sx, sy] = spots[pi];
    clearArea(sx - 3, sy - 3, 10, 10);
    addBuilding(pi, 'towncenter', sx, sy, true);
    for (let i = 0; i < 3; i++) addUnit(pi, 'villager', sx + 1.5 + i * 0.7, sy + 3.6);
    addUnit(pi, 'scout', sx + 4.5, sy + 1.5);
    // starter resources around each town
    scatterNear(sx, sy, 'tree', 22, 100, 5, 14, rng);
    scatterNear(sx, sy, 'berry', 6, 125, 5, 9, rng);
    scatterNear(sx, sy, 'gold', 5, 800, 7, 12, rng);
    scatterNear(sx, sy, 'stone', 4, 350, 8, 13, rng);
  }
  // wild forests, neutral golds/stones
  for (let f = 0; f < 30; f++) {
    const cx = 4 + rng() * (MAP_W - 8), cy = 4 + rng() * (MAP_H - 8);
    scatterNear(cx, cy, 'tree', 10 + rng() * 18 | 0, 100, 0, 5, rng);
  }
  for (let f = 0; f < 6; f++) scatterNear(6 + rng() * (MAP_W - 12), 6 + rng() * (MAP_H - 12), 'gold', 4, 800, 0, 3, rng);
  for (let f = 0; f < 5; f++) scatterNear(6 + rng() * (MAP_W - 12), 6 + rng() * (MAP_H - 12), 'stone', 4, 350, 0, 3, rng);
  for (let f = 0; f < 5; f++) scatterNear(8 + rng() * (MAP_W - 16), 8 + rng() * (MAP_H - 16), 'berry', 5, 125, 0, 2, rng);

  updateFog(true);
  return G;

  function clearArea(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++)
      if (inMap(x, y) && G.map.terr[tIdx(x, y)] === T_WATER) G.map.terr[tIdx(x, y)] = T_GRASS;
  }
  function scatterNear(cx, cy, rtype, n, amount, rmin, rmax, rng) {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 30) {
      const a = rng() * Math.PI * 2, r = rmin + rng() * (rmax - rmin);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!inMap(x, y) || !tilePassable(x, y)) continue;
      // keep resources compact for forests: bias toward existing same-type neighbors after first few
      addResource(rtype, x, y, amount);
      placed++;
      if (rtype === 'tree' && placed < n && rng() < 0.75) { cx = x; cy = y; }
    }
  }
}

// ---------------- Pathfinding (A*, 8-dir) ----------------
function findPath(sx, sy, gx, gy, near) {
  sx |= 0; sy |= 0; gx |= 0; gy |= 0;
  if (!inMap(gx, gy)) return null;
  if (!tilePassable(gx, gy) || near) {
    const g2 = nearestPassable(gx, gy, near || 1);
    if (!g2) return null;
    gx = g2[0]; gy = g2[1];
  }
  if (sx === gx && sy === gy) return [];
  const open = new MinHeap(), came = new Map(), gCost = new Map();
  const sk = tIdx(sx, sy), gk = tIdx(gx, gy);
  gCost.set(sk, 0);
  open.push(sk, Math.hypot(gx - sx, gy - sy));
  let expanded = 0, best = sk, bestH = Math.hypot(gx - sx, gy - sy);
  const DIRS = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.42],[1,-1,1.42],[-1,1,1.42],[-1,-1,1.42]];
  while (open.size && expanded++ < 4500) {
    const cur = open.pop();
    if (cur === gk) { best = gk; break; }
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0, cg = gCost.get(cur);
    for (const [dx, dy, c] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!tilePassable(nx, ny)) continue;
      if (dx && dy && !tilePassable(cx + dx, cy) && !tilePassable(cx, cy + dy)) continue; // no corner cut
      const nk = tIdx(nx, ny), ng = cg + c;
      if (ng < (gCost.get(nk) ?? Infinity)) {
        gCost.set(nk, ng); came.set(nk, cur);
        const h = Math.hypot(gx - nx, gy - ny);
        open.push(nk, ng + h * 1.001);
        if (h < bestH) { bestH = h; best = nk; }
      }
    }
  }
  // reconstruct to goal or closest reached
  const path = [];
  let cur = best;
  while (cur !== sk) { path.push([cur % MAP_W + 0.5, ((cur / MAP_W) | 0) + 0.5]); cur = came.get(cur); if (cur === undefined) return null; }
  path.reverse();
  return path;
}

function nearestPassable(gx, gy, maxR) {
  for (let r = 0; r <= Math.max(maxR, 6); r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (tilePassable(gx + dx, gy + dy)) return [gx + dx, gy + dy];
    }
  return null;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.v[p] <= this.v[i]) break; this.swap(i, p); i = p; }
  }
  pop() {
    const top = this.k[0], last = this.k.length - 1;
    this.swap(0, last); this.k.pop(); this.v.pop();
    let i = 0;
    while (true) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < this.k.length && this.v[l] < this.v[m]) m = l;
      if (r < this.k.length && this.v[r] < this.v[m]) m = r;
      if (m === i) break; this.swap(i, m); i = m;
    }
    return top;
  }
  swap(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; }
}

// ---------------- Commands ----------------
function cmdMove(u, x, y) {
  u.task = 'move'; u.target = null;
  u.path = findPath(u.x, u.y, x, y, 0) || [];
  if (u.path.length) { const last = u.path[u.path.length - 1]; u.path[u.path.length - 1] = [x === (x|0) ? last[0] : x, y === (y|0) ? last[1] : y]; }
  u.pathI = 0; u.dest = [x, y];
}
function cmdAttack(u, target) {
  if (UNITS[u.type].cls === 'vill' && target.kind === 'bldg' && target.owner === u.owner) return;
  u.task = 'attack'; u.target = target; u.path = null; u.repath = 0;
  u.stuckT = 0; u.bestDist = Infinity;
}
function cmdGather(u, res) {
  if (UNITS[u.type].cls !== 'vill') { cmdMove(u, res.tx + 0.5, res.ty + 0.5); return; }
  u.task = 'gather'; u.target = res; u.path = null; u.repath = 0;
  if (u.carryType !== resGives(res)) { u.carry = 0; u.carryType = null; }
  u.gatherKind = res.rtype;
}
function cmdFarm(u, farm) {
  if (UNITS[u.type].cls !== 'vill') { cmdMove(u, farm.tx + 1, farm.ty + 1); return; }
  u.task = 'farm'; u.target = farm; u.path = null; u.repath = 0;
}
function cmdBuild(u, b) {
  if (UNITS[u.type].cls !== 'vill') { cmdMove(u, b.tx, b.ty); return; }
  u.task = 'build'; u.target = b; u.path = null; u.repath = 0;
}

function placeBuilding(owner, type, tx, ty) {
  const d = BUILDINGS[type], p = G.players[owner];
  if (!canPlace(type, tx, ty)) return null;
  if (!canAfford(p, d.cost)) return null;
  pay(p, d.cost);
  return addBuilding(owner, type, tx, ty, false);
}
function canPlace(type, tx, ty) {
  const d = BUILDINGS[type];
  for (let y = ty; y < ty + d.size; y++) for (let x = tx; x < tx + d.size; x++) {
    if (!inMap(x, y) || !terrainPassable(x, y)) return false;
    const i = tIdx(x, y);
    if (G.map.res[i] || G.map.occ[i]) return false;
    if (!G.explored[i]) return false;
  }
  // don't allow entombing units of any player
  for (const u of G.units) {
    if (u.x >= tx - 0.2 && u.x <= tx + d.size + 0.2 && u.y >= ty - 0.2 && u.y <= ty + d.size + 0.2 && !d.passable) return false;
  }
  return true;
}

function trainUnit(b, type) {
  const p = G.players[b.owner], d = UNITS[type];
  if (b.queue.length >= 8 || !b.done) return false;
  if (p.pop + d.pop + queuedPop(p) > p.popCap) return false;
  if (!canAfford(p, d.cost)) return false;
  pay(p, d.cost);
  b.queue.push({ what: 'unit', type, t: 0, total: d.time });
  return true;
}
function queuedPop(p) {
  let n = 0;
  for (const b of G.buildings) if (b.owner === p.id) for (const q of b.queue) if (q.what === 'unit') n += UNITS[q.type].pop;
  return n;
}
function startResearch(b, id) {
  const p = G.players[b.owner], t = TECHS[id];
  if (p.techs[id] || p.researching[id] || !b.done || b.queue.length >= 8) return false;
  if (t.req && !p.techs[t.req]) return false;
  if (p.age < t.age) return false;
  if (!canAfford(p, t.cost)) return false;
  pay(p, t.cost);
  b.queue.push({ what: 'tech', type: id, t: 0, total: t.time });
  p.researching[id] = true;
  return true;
}
function startAgeUp(b) {
  const p = G.players[b.owner];
  if (p.age >= 3 || p.ageResearch || !b.done) return false;
  if (!canAfford(p, AGE_COST[p.age + 1])) return false;
  if (countAgeBuildings(p) < AGE_REQ_BLDGS[p.age + 1]) return false;
  pay(p, AGE_COST[p.age + 1]);
  b.queue.push({ what: 'age', type: p.age + 1, t: 0, total: AGE_TIME[p.age + 1] });
  p.ageResearch = true;
  return true;
}
function countAgeBuildings(p) {
  // distinct completed building types of the player's current age (excluding houses/farms/walls/TC)
  const s = new Set();
  for (const b of G.buildings)
    if (b.owner === p.id && b.done && BUILDINGS[b.type].age === p.age &&
        !['house', 'farm', 'palisade', 'stonewall', 'towncenter'].includes(b.type)) s.add(b.type);
  return s.size;
}

// ---------------- Simulation ----------------
function tick(dt) {
  if (G.over) return;
  G.time += dt;
  G.fogT -= dt;
  if (G.fogT <= 0) { updateFog(false); G.fogT = 0.4; }

  for (const b of G.buildings) updateBuilding(b, dt);
  buildSepGrid();
  for (const u of G.units) updateUnit(u, dt);
  separateUnits(dt);
  updateProjectiles(dt);

  // effects fade
  for (let i = G.effects.length - 1; i >= 0; i--) { G.effects[i].t -= dt; if (G.effects[i].t <= 0) G.effects.splice(i, 1); }

  // deaths & destruction
  for (let i = G.units.length - 1; i >= 0; i--) {
    const u = G.units[i];
    if (u.hp <= 0) {
      G.players[u.owner].pop -= UNITS[u.type].pop;
      G.effects.push({ kind: 'die', x: u.x, y: u.y, t: 0.6, owner: u.owner });
      G.units.splice(i, 1);
    }
  }
  for (let i = G.buildings.length - 1; i >= 0; i--) {
    const b = G.buildings[i];
    if (b.hp <= 0) destroyBuilding(b, i);
  }

  for (const p of G.players) if (p.isAI) aiUpdate(p, dt);
  checkVictory();
}

function destroyBuilding(b, i) {
  const d = BUILDINGS[b.type], p = G.players[b.owner];
  for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++)
    if (G.map.occ[tIdx(x, y)] === b) G.map.occ[tIdx(x, y)] = null;
  if (b.done && d.pop) p.popCap -= d.pop;
  for (const q of b.queue) {
    if (q.what === 'unit') refund(p, UNITS[q.type].cost, 1);
    if (q.what === 'tech') { refund(p, TECHS[q.type].cost, 1); delete p.researching[q.type]; }
    if (q.what === 'age') { refund(p, AGE_COST[q.type], 1); p.ageResearch = null; }
  }
  G.effects.push({ kind: 'rubble', x: b.tx + b.size / 2, y: b.ty + b.size / 2, t: 8, size: b.size });
  if (i === undefined) i = G.buildings.indexOf(b);
  G.buildings.splice(i, 1);
}

function updateBuilding(b, dt) {
  const d = BUILDINGS[b.type], p = G.players[b.owner];
  // production queue
  if (b.done && b.queue.length) {
    const q = b.queue[0];
    q.t += dt;
    if (q.t >= q.total) {
      b.queue.shift();
      if (q.what === 'unit') {
        const spot = spawnSpot(b);
        const u = addUnit(b.owner, q.type, spot[0], spot[1]);
        if (b.rally) {
          if (b.rally.res) { const r = G.map.res[tIdx(b.rally.x | 0, b.rally.y | 0)]; if (r) cmdGather(u, r); else cmdMove(u, b.rally.x, b.rally.y); }
          else cmdMove(u, b.rally.x, b.rally.y);
        }
      } else if (q.what === 'tech') {
        delete p.researching[q.type];
        applyTech(p, q.type);
        if (b.owner === 0) uiToast(`${TECHS[q.type].name} complete`);
      } else if (q.what === 'age') {
        p.age = q.type; p.ageResearch = null;
        uiToast(`${playerName(p)} has advanced to the ${AGE_NAMES[p.age]}!`);
        sfx('age');
      }
    }
  }
  // tower / TC / castle attack (units only — don't waste arrows on buildings)
  if (b.done && d.atk) {
    b.cooldown -= dt;
    if (b.cooldown <= 0) {
      const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
      const t = nearestEnemy(b.owner, cx, cy, d.range + b.size / 2, 'unit');
      if (t) {
        fireProjectile(b.owner, cx, cy, t, d.atk, 0, 11);
        b.cooldown = d.rof;
      } else b.cooldown = 0.25;
    }
  }
  // farm regrowth handled on deplete in gather
}

function spawnSpot(b) {
  const s = nearestPassable(b.tx + (b.size >> 1), b.ty + b.size, 4) || [b.tx, b.ty + b.size];
  return [s[0] + 0.5, s[1] + 0.5];
}
function playerName(p) { return p.id === 0 ? 'You' : 'The enemy'; }

// ---- unit update ----
function updateUnit(u, dt) {
  const d = UNITS[u.type];
  u.cooldown -= dt;
  u.repath -= dt;
  switch (u.task) {
    case 'idle':
      if (d.cls === 'monk') monkIdleHeal(u, dt);
      else if (d.cls !== 'vill' && d.cls !== 'siege' || u.type === 'mangonel') autoAcquire(u);
      break;
    case 'move':
      if (followPath(u, dt)) { u.task = 'idle'; u.path = null; }
      break;
    case 'attack': updateAttack(u, dt, d); break;
    case 'gather': updateGather(u, dt, d); break;
    case 'farm': updateFarm(u, dt, d); break;
    case 'deliver': updateDeliver(u, dt, d); break;
    case 'build': updateBuild(u, dt, d); break;
  }
}

function followPath(u, dt) {
  if (!u.path || u.pathI >= u.path.length) return true;
  const sp = unitStat(u, 'speed') * dt;
  let [tx, ty] = u.path[u.pathI];
  let dx = tx - u.x, dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.08) {
    u.pathI++;
    return u.pathI >= u.path.length;
  }
  const step = Math.min(sp, dist);
  u.x += dx / dist * step; u.y += dy / dist * step;
  u.dir = Math.atan2(dy, dx);
  u.moved = true;
  return false;
}

function entCenter(e) {
  if (e.kind === 'bldg') return [e.tx + e.size / 2, e.ty + e.size / 2];
  if (e.kind === 'res') return [e.tx + 0.5, e.ty + 0.5];
  return [e.x, e.y];
}
function entDist(u, e) {
  if (e.kind === 'unit') return Math.hypot(e.x - u.x, e.y - u.y);
  // distance to rect edge for buildings / tile for resources
  const x0 = e.tx, y0 = e.ty, s = e.size || 1;
  const cx = Math.max(x0, Math.min(u.x, x0 + s)), cy = Math.max(y0, Math.min(u.y, y0 + s));
  return Math.hypot(u.x - cx, u.y - cy);
}
function alive(e) {
  if (!e) return false;
  if (e.kind === 'unit') return e.hp > 0 && G.units.includes(e);
  if (e.kind === 'bldg') return e.hp > 0 && G.buildings.includes(e);
  if (e.kind === 'res') return e.amount > 0;
  return false;
}

function approach(u, e, range, dt) {
  // true when within range; otherwise walk toward it
  if (entDist(u, e) <= range) { u.path = null; return true; }
  if (!u.path || u.pathI >= u.path.length || u.repath <= 0) {
    const [cx, cy] = entCenter(e);
    const moving = e.kind === 'unit' && e.task !== 'idle';
    u.path = findPath(u.x, u.y, cx, cy, e.kind === 'unit' ? 0 : 1);
    u.pathI = 0;
    u.repath = moving ? 0.8 : 3.0;
    if (!u.path || !u.path.length) { u.repath = 1.5; }
  }
  if (u.path && u.pathI < u.path.length) followPath(u, dt);
  else {
    // path exhausted but still out of range (e.g. pushed off-tile next to a
    // building corner): walk straight toward the target while terrain allows
    const [cx, cy] = entCenter(e);
    const dx = cx - u.x, dy = cy - u.y, dd = Math.hypot(dx, dy);
    if (dd > 0.001) {
      const step = Math.min(unitStat(u, 'speed') * dt, dd);
      const nx = u.x + dx / dd * step, ny = u.y + dy / dd * step;
      const onTarget = e.kind === 'bldg' && G.map.occ[tIdx(nx | 0, ny | 0)] === e;
      if (tilePassable(nx | 0, ny | 0) || (onTarget && BUILDINGS[e.type].passable)) { u.x = nx; u.y = ny; u.moved = true; }
    }
  }
  return entDist(u, e) <= range;
}

function updateAttack(u, dt, d) {
  if (d.convert) return updateConvert(u, dt);
  if (!alive(u.target)) {
    const nt = autoAcquireNear(u);
    if (!nt) { u.task = 'idle'; u.target = null; u.path = null; return; }
    u.target = nt;
  }
  const range = Math.max(unitStat(u, 'range'), 0.6);
  const inRange = approach(u, u.target, range + (u.target.kind === 'bldg' ? 0.55 : 0.1), dt);
  // blocked (e.g. walled off): if we make no real progress toward the target
  // for a few seconds, attack the nearest enemy structure — walls included
  if (!inRange) {
    const dNow = entDist(u, u.target);
    if (dNow < (u.bestDist ?? Infinity) - 0.1) { u.bestDist = dNow; u.stuckT = 0; }
    else u.stuckT = (u.stuckT || 0) + dt;
    if (u.stuckT > 4) {
      u.stuckT = 0; u.bestDist = Infinity;
      let best = null, bd = 8;
      for (const b of G.buildings) {
        if (b.owner === u.owner || b.type === 'farm') continue;
        const dd = Math.hypot(b.tx + b.size / 2 - u.x, b.ty + b.size / 2 - u.y) - b.size / 2;
        if (dd < bd) { bd = dd; best = b; }
      }
      if (best && best !== u.target) { u.target = best; u.path = null; u.repath = 0; }
    }
  } else { u.stuckT = 0; u.bestDist = Infinity; }
  if (inRange) {
    const [tx, ty] = entCenter(u.target);
    u.dir = Math.atan2(ty - u.y, tx - u.x);
    if (u.cooldown <= 0) {
      const atk = unitStat(u, 'atk');
      if (range > 1) {
        fireProjectile(u.owner, u.x, u.y, u.target, atk, bonusVs(u, u.target), d.splash ? 8 : 13, d.splash, u);
      } else {
        dealDamage(u.target, atk, bonusVs(u, u.target), true, u.owner);
        G.effects.push({ kind: 'hit', x: tx, y: ty, t: 0.18 });
        sfxNear('hit', u.x, u.y);
      }
      u.cooldown = d.rof;
    }
  }
}

function bonusVs(u, target) {
  const b = unitBonus(u);
  if (!b) return 0;
  if (target.kind === 'bldg') return b.bldg || 0;
  if (target.kind === 'unit') return b[UNITS[target.type].cls] || 0;
  return 0;
}

function dealDamage(e, atk, bonus, melee, fromOwner) {
  let armor;
  if (e.kind === 'bldg') armor = melee ? 1 : 6;
  else armor = melee ? unitStat(e, 'armor') : unitStat(e, 'parmor');
  const dmg = Math.max(1, atk - armor) + (bonus || 0);
  e.hp -= dmg;
  // retaliation / flee
  if (e.kind === 'unit') {
    const ed = UNITS[e.type];
    if (e.task === 'idle' || ((e.task === 'gather' || e.task === 'farm' || e.task === 'build') && ed.cls === 'vill' && e.hp < e.maxhp * 0.6)) {
      const attacker = nearestEnemy(e.owner, e.x, e.y, ed.los + 2, null);
      if (attacker) {
        if (ed.cls === 'vill' && attacker.kind === 'unit' && UNITS[attacker.type].range >= 2) {
          // flee from archers toward town center
          const tc = G.buildings.find(b => b.owner === e.owner && b.type === 'towncenter');
          if (tc) cmdMove(e, tc.tx + 1.5, tc.ty + 3.5);
        } else cmdAttack(e, attacker);
      }
    }
  } else if (e.owner === 0 && (!e.underAttackPing || e.underAttackPing < G.time - 15)) {
    e.underAttackPing = G.time;
    uiToast('⚠️ Your town is under attack!'); sfx('alarm');
  }
  // let the owner's AI know where it was hit so it can respond
  const op = G.players[e.owner];
  if (op && op.isAI) { const c = entCenter(e); op.lastHit = { t: G.time, x: c[0], y: c[1] }; }
}

// ---- monk: conversion of enemy units, healing of friendly ones ----
function updateConvert(u, dt) {
  const t = u.target;
  u.rest = Math.max(0, (u.rest || 0) - dt);
  if (!alive(t) || t.kind !== 'unit' || t.owner === u.owner) {
    u.task = 'idle'; u.target = null; u.path = null; u.chant = 0;
    return;
  }
  if (approach(u, t, unitStat(u, 'range'), dt)) {
    if (u.rest > 0) return; // recovering from the last conversion
    if (!u.chantNeed) u.chantNeed = 6 + G.rng() * 4;
    u.chant = (u.chant || 0) + dt;
    t.beingConverted = G.time;
    if (u.chant >= u.chantNeed) {
      convertUnit(t, u.owner);
      u.chant = 0; u.chantNeed = 0; u.rest = 12;
      u.task = 'idle'; u.target = null;
      sfxNear('convert', u.x, u.y);
    }
  } else if (u.chant > 0) u.chant = Math.max(0, u.chant - dt * 0.5); // faith fades while chasing
}
function convertUnit(t, newOwner) {
  G.players[t.owner].pop -= UNITS[t.type].pop;
  G.players[newOwner].pop += UNITS[t.type].pop;
  t.owner = newOwner;
  t.task = 'idle'; t.target = null; t.path = null;
  t.carry = 0; t.carryType = null; t.lastRes = null; t.lastFarm = null;
  G.effects.push({ kind: 'convert', x: t.x, y: t.y, t: 0.8 });
  if (newOwner === 0) uiToast(`${unitName(t)} converted to your side!`);
}
function monkIdleHeal(u, dt) {
  u.rest = Math.max(0, (u.rest || 0) - dt);
  let best = null, bd = 7;
  for (const f of G.units) {
    if (f.owner !== u.owner || f === u || f.hp >= f.maxhp) continue;
    const dd = Math.hypot(f.x - u.x, f.y - u.y);
    if (dd < bd) { bd = dd; best = f; }
  }
  if (best && approach(u, best, 2.5, dt)) {
    best.hp = Math.min(best.maxhp, best.hp + 3 * dt);
    if ((u.healFx = (u.healFx || 0) + dt) > 0.5) {
      u.healFx = 0;
      G.effects.push({ kind: 'heal', x: best.x, y: best.y, t: 0.5 });
    }
  }
}

function autoAcquire(u) {
  const t = nearestEnemy(u.owner, u.x, u.y, UNITS[u.type].los, u.type === 'ram' ? 'bldg' : null);
  if (t) { u.task = 'attack'; u.target = t; }
}
function autoAcquireNear(u) {
  return nearestEnemy(u.owner, u.x, u.y, UNITS[u.type].los + 1, u.type === 'ram' ? 'bldg' : null);
}

function nearestEnemy(owner, x, y, range, onlyKind) {
  let best = null, bd = range;
  if (onlyKind !== 'bldg') for (const e of G.units) {
    if (e.owner === owner) continue;
    const dd = Math.hypot(e.x - x, e.y - y);
    if (dd < bd) { bd = dd; best = e; }
  }
  for (const e of G.buildings) {
    if (e.owner === owner || onlyKind === 'unit') continue;
    if (e.type === 'farm' || e.type === 'palisade' || e.type === 'stonewall') continue;
    const dd = Math.hypot(e.tx + e.size / 2 - x, e.ty + e.size / 2 - y) - e.size / 2;
    if (dd < bd) { bd = dd; best = e; }
  }
  return best;
}

// ---- gathering ----
function dropAmount(u) { return BASE_CARRY + G.players[u.owner].vill.carry; }

function updateGather(u, dt, d) {
  const p = G.players[u.owner];
  if (u.carry >= dropAmount(u)) { u.task = 'deliver'; u.path = null; return; }
  if (!alive(u.target)) {
    const nr = findNearbyResource(u.gatherKind, u.target ? u.target.tx : u.x, u.target ? u.target.ty : u.y, 10);
    if (nr) { u.target = nr; u.path = null; }
    else if (u.carry > 0) { u.task = 'deliver'; u.path = null; return; }
    else { u.task = 'idle'; u.target = null; if (u.owner === 0) uiIdleVillPing(); return; }
  }
  if (approach(u, u.target, 0.95, dt)) {
    const r = u.target;
    const gives = resGives(r);
    const rate = GATHER_RATE[r.rtype === 'tree' ? 'wood' : r.rtype] * (p.rates[gives] || 1);
    const take = Math.min(rate * dt, r.amount, dropAmount(u) - u.carry);
    r.amount -= take;
    u.carry += take; u.carryType = gives;
    u.gatherT = (u.gatherT || 0) + dt;
    if (r.amount <= 0) removeResource(r);
  }
}

function updateFarm(u, dt, d) {
  const p = G.players[u.owner];
  const f = u.target;
  if (u.carry >= dropAmount(u)) { u.task = 'deliver'; u.path = null; return; }
  if (!alive(f) || !G.buildings.includes(f)) { u.task = 'idle'; u.target = null; return; }
  if (!f.done) { u.task = 'build'; return; }
  if (f.farmer && f.farmer !== u && alive(f.farmer) && f.farmer.task === 'farm' && f.farmer.target === f) {
    // occupied: find another farm
    const other = G.buildings.find(b => b.owner === u.owner && b.type === 'farm' && b.done && (!b.farmer || !alive(b.farmer) || b.farmer.task !== 'farm' || b.farmer.target !== b));
    if (other) { u.target = other; u.path = null; return; }
    u.task = 'idle'; return;
  }
  if (approach(u, f, 0.9, dt)) {
    f.farmer = u;
    const rate = GATHER_RATE.farm * p.rates.farm;
    const take = Math.min(rate * dt, f.farmFood, dropAmount(u) - u.carry);
    f.farmFood -= take; u.carry += take; u.carryType = 'food';
    if (f.farmFood <= 0) {
      // auto-reseed if affordable, else farm is exhausted
      if (p.res.wood >= 30) { p.res.wood -= 30; f.farmFood = BUILDINGS.farm.farmFood; }
      else { destroyBuilding(f); u.task = u.carry > 0 ? 'deliver' : 'idle'; u.target = null; }
    }
  }
}

function updateDeliver(u, dt, d) {
  if (u.carry <= 0) { resumeWork(u); return; }
  const site = nearestDrop(u);
  if (!site) { u.task = 'idle'; return; }
  if (approach(u, site, 1.15, dt)) {
    G.players[u.owner].res[u.carryType] += u.carry;
    u.carry = 0;
    resumeWork(u);
  }
}
function resumeWork(u) {
  if (u.lastFarm && alive(u.lastFarm) && G.buildings.includes(u.lastFarm)) { u.task = 'farm'; u.target = u.lastFarm; u.path = null; return; }
  if (u.lastRes && alive(u.lastRes)) { u.task = 'gather'; u.target = u.lastRes; u.path = null; return; }
  if (u.gatherKind) {
    const nr = findNearbyResource(u.gatherKind, u.x | 0, u.y | 0, 12);
    if (nr) { u.task = 'gather'; u.target = nr; u.path = null; return; }
  }
  u.task = 'idle'; u.target = null;
  if (u.owner === 0) uiIdleVillPing();
}
function nearestDrop(u) {
  let best = null, bd = 1e9;
  for (const b of G.buildings) {
    if (b.owner !== u.owner || !b.done) continue;
    const dr = BUILDINGS[b.type].drop;
    if (!dr || !dr.includes(u.carryType)) continue;
    const dd = entDist(u, b);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}
function findNearbyResource(rtype, cx, cy, maxR) {
  cx |= 0; cy |= 0;
  for (let r = 0; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inMap(x, y)) continue;
      const rr = G.map.res[tIdx(x, y)];
      if (rr && rr.rtype === rtype && rr.amount > 0) return rr;
    }
  return null;
}
function removeResource(r) {
  G.map.res[tIdx(r.tx, r.ty)] = null;
  const i = G.resources.indexOf(r);
  if (i >= 0) G.resources.splice(i, 1);
}

// ---- building construction ----
function updateBuild(u, dt, d) {
  const b = u.target;
  if (!b || !G.buildings.includes(b)) { u.task = 'idle'; u.target = null; return; }
  if (b.done && b.hp >= b.maxhp) { // done: farms transition to farming
    if (b.type === 'farm') { u.lastFarm = b; cmdFarm(u, b); }
    else { u.task = 'idle'; u.target = null; }
    return;
  }
  if (approach(u, b, 1.15, dt)) {
    const def = BUILDINGS[b.type];
    // multiple builders speed up with diminishing returns handled implicitly (each adds full rate; fine)
    if (!b.done) {
      b.progress += dt;
      b.hp = Math.min(b.maxhp, b.hp + def.hp * 0.9 * (dt / def.time));
      if (b.progress >= def.time) {
        b.done = true; b.hp = Math.max(b.hp, b.maxhp * 0.98); b.hp = b.maxhp;
        if (def.pop) G.players[b.owner].popCap += def.pop;
        if (b.type === 'farm') { u.lastFarm = b; cmdFarm(u, b); return; }
        u.task = 'idle'; u.target = null;
      }
    } else { // repair
      b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * (dt / def.time));
      if (b.hp >= b.maxhp) { u.task = 'idle'; u.target = null; }
    }
  }
}

// ---- separation (soft collision between units) ----
function buildSepGrid() {
  G.sepGrid.clear();
  for (const u of G.units) {
    const k = (u.x | 0) + (u.y | 0) * MAP_W;
    let a = G.sepGrid.get(k);
    if (!a) G.sepGrid.set(k, a = []);
    a.push(u);
  }
}
function separateUnits(dt) {
  for (const u of G.units) {
    const cx = u.x | 0, cy = u.y | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = G.sepGrid.get((cx + dx) + (cy + dy) * MAP_W);
      if (!a) continue;
      for (const v of a) {
        if (v === u || v.id <= u.id) continue;
        let ddx = u.x - v.x, ddy = u.y - v.y;
        let dd = Math.hypot(ddx, ddy);
        if (dd < 0.34 && dd > 0.0001) {
          const push = (0.34 - dd) * 0.5;
          ddx /= dd; ddy /= dd;
          nudge(u, ddx * push, ddy * push);
          nudge(v, -ddx * push, -ddy * push);
        } else if (dd <= 0.0001) {
          nudge(u, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1);
        }
      }
    }
  }
  function nudge(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (tilePassable(nx | 0, ny | 0)) { u.x = nx; u.y = ny; }
  }
}

// ---- projectiles ----
function fireProjectile(owner, x, y, target, atk, bonus, speed, splash, shooter) {
  const [tx, ty] = entCenter(target);
  G.projectiles.push({ owner, x, y, sx: x, sy: y, target, atk, bonus, speed, splash: splash || 0, gx: tx, gy: ty, t: 0 });
  sfxNear('arrow', x, y);
}
function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    // home onto living target, else fly to last known point
    if (!p.splash && alive(p.target)) { const c = entCenter(p.target); p.gx = c[0]; p.gy = c[1]; }
    const dx = p.gx - p.x, dy = p.gy - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (dist <= step) {
      if (p.splash) {
        for (const u of G.units) {
          if (u.owner === p.owner) continue;
          if (Math.hypot(u.x - p.gx, u.y - p.gy) <= p.splash) dealDamage(u, p.atk, 0, false, p.owner);
        }
        for (const b of G.buildings) {
          if (b.owner === p.owner) continue;
          if (Math.hypot(b.tx + b.size / 2 - p.gx, b.ty + b.size / 2 - p.gy) <= p.splash + b.size / 2) dealDamage(b, p.atk, p.bonus, false, p.owner);
        }
        G.effects.push({ kind: 'boom', x: p.gx, y: p.gy, t: 0.4 });
        sfxNear('boom', p.gx, p.gy);
      } else if (alive(p.target)) {
        dealDamage(p.target, p.atk, p.bonus, false, p.owner);
        G.effects.push({ kind: 'hit', x: p.gx, y: p.gy, t: 0.15 });
      }
      G.projectiles.splice(i, 1);
    } else {
      p.x += dx / dist * step; p.y += dy / dist * step; p.t += dt;
    }
  }
}

// ---- fog of war ----
function updateFog(initial) {
  G.visible.fill(0);
  for (const u of G.units) if (u.owner === 0) revealCircle(u.x, u.y, UNITS[u.type].los);
  for (const b of G.buildings) if (b.owner === 0) revealCircle(b.tx + b.size / 2, b.ty + b.size / 2, BUILDINGS[b.type].los + b.size);
}
function revealCircle(cx, cy, r) {
  const r2 = r * r;
  for (let y = Math.max(0, cy - r | 0); y <= Math.min(MAP_H - 1, cy + r + 1 | 0); y++)
    for (let x = Math.max(0, cx - r | 0); x <= Math.min(MAP_W - 1, cx + r + 1 | 0); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) { const i = tIdx(x, y); G.visible[i] = 1; G.explored[i] = 1; }
    }
}
function tileVisible(x, y) { return G.visible[tIdx(x | 0, y | 0)]; }
function tileExplored(x, y) { return G.explored[tIdx(x | 0, y | 0)]; }

// ---- victory ----
function checkVictory() {
  for (const p of G.players) {
    if (p.defeated) continue;
    const hasB = G.buildings.some(b => b.owner === p.id && b.type !== 'farm' && b.type !== 'palisade' && b.type !== 'stonewall');
    const hasU = G.units.some(u => u.owner === p.id);
    if (!hasB && !hasU) p.defeated = true;
  }
  if (G.players[0].defeated) G.over = 'defeat';
  else if (G.players[1].defeated) G.over = 'victory';
}
