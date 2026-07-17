'use strict';
// ============================================================
// Save / load: serializes the full game state to localStorage.
// Entity cross-references are stored as ids and re-linked on load.
// Auto-saves every 30s of play and on pause.
// ============================================================

const SAVE_KEY = 'empirephone_save';
const SAVE_VERSION = 3;

function b64FromU8(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096));
  return btoa(s);
}
function u8FromB64(b64, len) {
  const s = atob(b64), u8 = new Uint8Array(len);
  for (let i = 0; i < s.length && i < len; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}

function saveGame() {
  if (!G || G.over) return false;
  const eid = e => (e && e.id) || null;
  const ser = {
    v: SAVE_VERSION, time: G.time, difficulty: G.difficulty, opponents: G.opponents || 1,
    nextId: NEXT_ID, age: null,
    players: G.players.map(p => ({
      id: p.id, isAI: p.isAI, color: p.color, team: p.team, name: p.name,
      res: { ...p.res }, age: p.age, ageResearch: p.ageResearch ? true : null,
      pop: p.pop, popCap: p.popCap,
      techs: { ...p.techs }, researching: { ...p.researching },
      rates: { ...p.rates }, vill: { ...p.vill }, mod: { ...p.mod },
      buffs: JSON.parse(JSON.stringify(p.buffs)), defeated: p.defeated,
      ai: p.ai ? { ...p.ai } : null,
    })),
    units: G.units.map(u => ({
      id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y,
      hp: u.hp, maxhp: u.maxhp, task: u.task, carry: u.carry, carryType: u.carryType,
      gatherKind: u.gatherKind, dir: u.dir, rest: u.rest || 0,
      target: eid(u.target), lastRes: eid(u.lastRes), lastFarm: eid(u.lastFarm),
    })),
    buildings: G.buildings.map(b => ({
      id: b.id, type: b.type, owner: b.owner, tx: b.tx, ty: b.ty, size: b.size,
      hp: b.hp, maxhp: b.maxhp, done: b.done, progress: b.progress,
      farmFood: b.farmFood, rally: b.rally ? { ...b.rally } : null,
      queue: b.queue.map(q => ({ what: q.what, type: q.type, t: q.t, total: q.total })),
    })),
    resources: G.resources.map(r => ({ id: r.id, rtype: r.rtype, tx: r.tx, ty: r.ty, amount: r.amount, max: r.max })),
    terr: b64FromU8(G.map.terr), explored: b64FromU8(G.explored),
    cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(ser));
    return true;
  } catch (e) { return false; }
}

function loadGame() {
  let ser;
  try { ser = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!ser || ser.v !== SAVE_VERSION) return false;

  const terr = u8FromB64(ser.terr, MAP_W * MAP_H);
  G = {
    rng: mulberry32((Math.random() * 1e9) | 0),
    map: { terr, res: new Array(MAP_W * MAP_H).fill(null), occ: new Array(MAP_W * MAP_H).fill(null) },
    units: [], buildings: [], resources: [], projectiles: [],
    players: [], time: ser.time, over: null, difficulty: ser.difficulty, opponents: ser.opponents,
    explored: u8FromB64(ser.explored, MAP_W * MAP_H), visible: new Uint8Array(MAP_W * MAP_H),
    fogT: 0, sepGrid: new Map(), effects: [],
  };
  for (const sp of ser.players) {
    const p = makePlayer(sp.id, sp.isAI, sp.color, sp.team, sp.name);
    Object.assign(p, {
      res: sp.res, age: sp.age, ageResearch: sp.ageResearch, pop: sp.pop, popCap: sp.popCap,
      techs: sp.techs, researching: sp.researching, rates: sp.rates, vill: sp.vill,
      mod: sp.mod, buffs: sp.buffs, defeated: sp.defeated,
    });
    if (sp.ai) p.ai = sp.ai;
    G.players.push(p);
  }
  const byId = new Map();
  for (const sr of ser.resources) {
    const r = { kind: 'res', ...sr };
    G.resources.push(r);
    G.map.res[tIdx(r.tx, r.ty)] = r;
    byId.set(r.id, r);
  }
  for (const sb of ser.buildings) {
    const b = { kind: 'bldg', cooldown: 0, farmer: null, ...sb };
    G.buildings.push(b);
    for (let y = b.ty; y < b.ty + b.size; y++)
      for (let x = b.tx; x < b.tx + b.size; x++) G.map.occ[tIdx(x, y)] = b;
    byId.set(b.id, b);
  }
  for (const su of ser.units) {
    const u = {
      kind: 'unit', path: null, pathI: 0, cooldown: 0, repath: 0, ...su,
    };
    G.units.push(u);
    byId.set(u.id, u);
  }
  // re-link references; drop tasks whose target vanished
  for (const u of G.units) {
    u.target = byId.get(u.target) || null;
    u.lastRes = byId.get(u.lastRes) || null;
    u.lastFarm = byId.get(u.lastFarm) || null;
    if (!u.target && !['idle', 'move', 'deliver'].includes(u.task)) u.task = 'idle';
    if (u.task === 'move') u.task = 'idle'; // path not saved; stop cleanly
  }
  NEXT_ID = ser.nextId;
  cam.x = ser.cam.x; cam.y = ser.cam.y; cam.zoom = ser.cam.zoom;
  updateFog(true);
  return true;
}
