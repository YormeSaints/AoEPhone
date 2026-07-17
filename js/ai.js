'use strict';
// ============================================================
// Computer opponent: economy management, base building,
// age advancement, and escalating attack waves.
// ============================================================

const AI_VILL_TARGET = [10, 16, 22, 26];
const AI_ARMY_CAP = [4, 10, 18, 30];
const AI_DIFF = {
  easy:   { eco: 0.7, wave0: 5,  waveGrow: 3, waveEvery: 110 },
  normal: { eco: 1.0, wave0: 6,  waveGrow: 4, waveEvery: 90 },
  hard:   { eco: 1.3, wave0: 8,  waveGrow: 6, waveEvery: 75 },
};

function aiUpdate(p, dt) {
  const ai = p.ai;
  ai.t -= dt;
  if (ai.t > 0) return;
  ai.t = 0.7;
  const cfg = AI_DIFF[G.difficulty] || AI_DIFF.normal;

  const myUnits = G.units.filter(u => u.owner === p.id);
  const myBldgs = G.buildings.filter(b => b.owner === p.id);
  const vills = myUnits.filter(u => u.type === 'villager');
  const army = myUnits.filter(u => UNITS[u.type].cls !== 'vill' && u.type !== 'scout' || p.age >= 1 && u.type === 'scout');
  const tc = myBldgs.find(b => b.type === 'towncenter' && b.done);
  const has = t => myBldgs.some(b => b.type === t);
  const hasDone = t => myBldgs.some(b => b.type === t && b.done);
  const underCon = myBldgs.filter(b => !b.done);

  // difficulty: passive resource trickle so the AI keeps pace without cheating
  // unit stats. Fixed per AI tick (0.7s) so it is frame-rate independent.
  const trickle = (cfg.eco - 0.7) * 0.75 * 0.7; // resources per tick, per type
  if (trickle > 0) for (const k of RES_KEYS) p.res[k] += trickle;

  // --- villagers: train continuously ---
  if (tc && vills.length < AI_VILL_TARGET[p.age] && tc.queue.length < 2) trainUnit(tc, 'villager');

  // --- rebuild the town center if it was destroyed ---
  if (!tc && !underCon.some(b => b.type === 'towncenter') && myBldgs.length &&
      canAfford(p, BUILDINGS.towncenter.cost)) {
    aiBuild(p, 'towncenter', myBldgs[0]);
  }

  // --- defend: if the base was hit recently, rally nearby idle army ---
  if (p.lastHit && G.time - p.lastHit.t < 6) {
    for (const u of army) {
      if (u.task !== 'idle') continue;
      if (Math.hypot(u.x - p.lastHit.x, u.y - p.lastHit.y) > 24) continue;
      const t = nearestEnemy(p.id, p.lastHit.x, p.lastHit.y, 10, null);
      if (t) cmdAttack(u, t);
    }
  }

  // --- keep houses ahead of pop ---
  if (p.pop + 4 >= p.popCap && p.popCap < POP_MAX && !underCon.some(b => b.type === 'house') && p.res.wood >= 30) {
    aiBuild(p, 'house', tc || myBldgs[0]);
  }

  // --- cancel foundations that are stuck (unreachable spot, dead builder) ---
  for (const b of underCon) {
    if (b.progress === (b.aiLastProg ?? -1)) b.aiStall = (b.aiStall || 0) + 0.7;
    else b.aiStall = 0;
    b.aiLastProg = b.progress;
    if (b.aiStall > 50) { refund(p, BUILDINGS[b.type].cost, 0.9); destroyBuilding(b); }
  }

  // --- assign idle villagers to gathering ---
  const idle = vills.filter(u => u.task === 'idle');
  if (idle.length) {
    const want = aiGatherWants(p, myBldgs);
    for (const u of idle) {
      const k = want.shift() || 'food';
      aiSendGather(p, u, k, tc || myBldgs[0]);
    }
  }
  // ensure every foundation has a builder (pull at most 2 villagers per tick)
  let pulls = 0;
  for (const bc of underCon) {
    if (!G.buildings.includes(bc)) continue; // may have been cancelled above
    if (vills.some(v => v.task === 'build' && v.target === bc)) continue;
    const v = vills.find(v => v.task !== 'build');
    if (v && pulls < 2) { cmdBuild(v, bc); pulls++; }
  }

  const needAgeB = p.age >= 1 && p.age < 3 && countAgeBuildings(p) < AGE_REQ_BLDGS[p.age + 1];

  // --- economy buildings ---
  if (tc && vills.length >= 5) {
    if (!has('lumbercamp') && p.res.wood >= 100) {
      const tree = findNearbyResource('tree', tc.tx, tc.ty, 20);
      if (tree) aiBuildAt(p, 'lumbercamp', tree.tx, tree.ty);
    }
    if (!has('mill') && p.res.wood >= 100) {
      const berry = findNearbyResource('berry', tc.tx, tc.ty, 18);
      if (berry) aiBuildAt(p, 'mill', berry.tx, berry.ty);
    }
    if (vills.length >= 7 && !has('miningcamp') && p.res.wood >= 100) {
      const gold = findNearbyResource('gold', tc.tx, tc.ty, 22);
      if (gold) aiBuildAt(p, 'miningcamp', gold.tx, gold.ty);
    }
    // farms are the food engine — build them steadily once the mill is up,
    // but cap them while wood is needed for age-requirement buildings
    const berriesLeft = !!findNearbyResource('berry', tc.tx, tc.ty, 14);
    const farms = myBldgs.filter(b => b.type === 'farm').length;
    let wantFarms = Math.min(5 + p.age * 3, Math.max(3, vills.length >> 1));
    if (needAgeB) wantFarms = Math.min(wantFarms, 5);
    // while age-requirement buildings are missing, reserve wood for them —
    // but never at the cost of the food engine itself
    const woodReserve = needAgeB && farms >= 3 ? 220 : 0;
    if ((!berriesLeft || p.age >= 1) && farms < wantFarms && p.res.wood >= 65 + woodReserve && hasDone('mill')) {
      aiBuild(p, 'farm', myBldgs.find(b => b.type === 'mill') || tc);
    }
  }

  // --- military buildings ---
  if (vills.length >= 8 && !has('barracks') && p.res.wood >= 200) aiBuild(p, 'barracks', tc);
  if (p.age >= 1) {
    if (hasDone('barracks') && !has('archeryrange') && p.res.wood >= 200) aiBuild(p, 'archeryrange', tc);
    if (!has('blacksmith') && p.res.wood >= 160) aiBuild(p, 'blacksmith', tc);
    if (hasDone('barracks') && !has('stable') && p.res.wood >= 250) aiBuild(p, 'stable', tc);
  }
  if (p.age >= 2 && !has('siegeworkshop') && p.res.wood >= 350) aiBuild(p, 'siegeworkshop', tc);
  if (p.age >= 2 && !has('castle') && p.res.stone >= 700) aiBuild(p, 'castle', tc);

  // --- age up: once the requirements are close, hoard resources for it ---
  const saving = !p.ageResearch && p.age < 3 && tc &&
    vills.length >= AI_VILL_TARGET[p.age] - 2 &&
    countAgeBuildings(p) >= AGE_REQ_BLDGS[p.age + 1];
  if (saving && canAfford(p, AGE_COST[p.age + 1])) startAgeUp(tc);

  // --- research (cheap & impactful first) ---
  const tryTech = (id) => {
    const t = TECHS[id];
    if (p.techs[id] || p.researching[id]) return;
    const b = myBldgs.find(b => b.type === t.from && b.done && b.queue.length === 0);
    if (b && canAfford(p, t.cost) && p.res.food > 250) startResearch(b, id);
  };
  if (!saving)
    ['loom', 'doublebitaxe', 'horsecollar', 'forging', 'fletching', 'manatarms', 'wheelbarrow',
     'scalearmor', 'crossbow', 'lightcav', 'longswords', 'ironcasting', 'bodkinarrow'].forEach(tryTech);

  // --- train army (keep a defensive core, but bank while advancing) ---
  const armyCap = (saving || needAgeB) ? (p.age === 0 ? 2 : 6) : AI_ARMY_CAP[p.age];
  if (army.length < armyCap && p.pop < p.popCap) {
    for (const b of myBldgs) {
      if (!b.done || !BUILDINGS[b.type].trains || b.type === 'towncenter' || b.queue.length >= 2) continue;
      const opts = BUILDINGS[b.type].trains.filter(t => UNITS[t].age <= p.age && t !== 'villager' &&
        !(t === 'scout' && p.age >= 2 && p.res.gold > 200));
      if (!opts.length) continue;
      const pick = opts[(G.rng() * opts.length) | 0];
      trainUnit(b, pick);
    }
  }

  // --- attack waves (never while banking for an age-up) ---
  ai.attackAt -= 0.7;
  const waveSize = Math.max(5, Math.min(cfg.wave0 + ai.wave * cfg.waveGrow, AI_ARMY_CAP[p.age]));
  if (!saving && !needAgeB && ai.attackAt <= 0 && army.length >= waveSize) {
    const target = aiPickTarget(p);
    if (target) {
      for (const u of army) cmdAttack(u, target);
      ai.wave++;
      ai.attackAt = cfg.waveEvery;
    } else ai.attackAt = 20;
  }
  // idle military engages nearby threats only; fresh troops wait for the next wave
  for (const u of army) {
    if (u.task === 'idle') {
      const t = nearestEnemy(p.id, u.x, u.y, 12, null);
      if (t) cmdAttack(u, t);
    }
  }
}

function aiGatherWants(p, myBldgs) {
  // decide what the next idle villagers should gather, most-needed first
  const w = [];
  const counts = { wood: 0, food: 0, gold: 0, stone: 0 };
  for (const u of G.units) {
    if (u.owner !== p.id || u.type !== 'villager') continue;
    if (u.task === 'farm') counts.food++;
    else if (u.task === 'gather' && u.target) counts[resGives(u.target)]++;
  }
  const targets = p.age === 0 ? { food: 6, wood: 4, gold: 1, stone: 0 }
    : p.age === 1 ? { food: 8, wood: 6, gold: 3, stone: 0 }
    : { food: 9, wood: 7, gold: 5, stone: 3 };
  for (let i = 0; i < 12; i++) {
    let bestK = 'food', bestGap = -1e9;
    for (const k of RES_KEYS) {
      const gap = (targets[k] - counts[k]) / Math.max(1, targets[k]);
      if (targets[k] > 0 && gap > bestGap) { bestGap = gap; bestK = k; }
    }
    counts[bestK]++;
    w.push(bestK);
  }
  return w;
}

function aiSendGather(p, u, k, home) {
  if (!home) return;
  const cx = home.tx, cy = home.ty;
  if (k === 'food') {
    const farm = G.buildings.find(b => b.owner === p.id && b.type === 'farm' && b.done &&
      (!b.farmer || !alive(b.farmer) || b.farmer.task !== 'farm'));
    if (farm) { cmdFarm(u, farm); return; }
    const berry = findNearbyResource('berry', cx, cy, 20);
    if (berry) { cmdGather(u, berry); return; }
    k = 'wood';
  }
  const rt = k === 'wood' ? 'tree' : k;
  const r = findNearbyResource(rt, cx, cy, 30);
  if (r) cmdGather(u, r);
}

function aiBuild(p, type, near) {
  if (!near) return null;
  return aiBuildAt(p, type, near.tx + ((G.rng() * 8) | 0) - 4, near.ty + ((G.rng() * 8) | 0) - 4);
}
function aiBuildAt(p, type, cx, cy) {
  const d = BUILDINGS[type];
  if (!canAfford(p, d.cost)) return null;
  for (let r = 1; r < 12; r++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = cx + ((G.rng() * r * 2) | 0) - r, ty = cy + ((G.rng() * r * 2) | 0) - r;
      if (aiCanPlace(type, tx, ty)) {
        pay(p, d.cost);
        const b = addBuilding(p.id, type, tx, ty, false);
        const v = G.units.find(u => u.owner === p.id && u.type === 'villager' && u.task !== 'build');
        if (v) cmdBuild(v, b);
        return b;
      }
    }
  }
  return null;
}
function aiCanPlace(type, tx, ty) { // AI ignores fog (it "knows" its own territory)
  const d = BUILDINGS[type];
  for (let y = ty; y < ty + d.size; y++) for (let x = tx; x < tx + d.size; x++) {
    if (!inMap(x, y) || !terrainPassable(x, y)) return false;
    if (G.map.res[tIdx(x, y)] || G.map.occ[tIdx(x, y)]) return false;
  }
  return true;
}

function aiPickTarget(p) {
  // prefer enemy military buildings/TC, else any building, else any unit
  const enemies = G.buildings.filter(b => b.owner !== p.id && b.type !== 'farm' && b.type !== 'palisade');
  if (enemies.length) {
    enemies.sort((a, b) => prio(b) - prio(a));
    return enemies[0];
  }
  const eu = G.units.filter(u => u.owner !== p.id);
  return eu[0] || null;
  function prio(b) {
    if (b.type === 'towncenter') return 3;
    if (BUILDINGS[b.type].trains) return 2;
    return 1;
  }
}
