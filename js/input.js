'use strict';
// ============================================================
// Touch-first input:
//   tap            select / issue context command
//   drag           pan camera (or move build ghost while placing)
//   pinch          zoom
//   long-press+drag box select
//   double-tap unit  select all of that type on screen
// Mouse also works (wheel = zoom, drag = pan / box with shift).
// ============================================================

const pointers = new Map();
let pinchDist = 0, pressTimer = null, boxSelecting = false;
let downPos = null, downTime = 0, moved = false, lastTap = { t: 0, x: 0, y: 0 };

function initInput() {
  const c = canvas;
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', onUp);
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
  }, { passive: false });
  c.addEventListener('contextmenu', e => e.preventDefault());

  const mm = document.getElementById('minimap');
  mm.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const r = mm.getBoundingClientRect();
    const [wx, wy] = minimapToWorld(e.clientX - r.left, e.clientY - r.top);
    centerCamOn(wx, wy); clampCam();
  });
}

function onDown(e) {
  if (!G || G.over) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    downPos = { x: e.clientX, y: e.clientY };
    downTime = performance.now();
    moved = false;
    boxSelecting = e.shiftKey === true;
    clearTimeout(pressTimer);
    if (!UI.placing) {
      pressTimer = setTimeout(() => {
        if (pointers.size === 1 && !moved) {
          boxSelecting = true;
          if (navigator.vibrate) navigator.vibrate(15);
          UI.dragBox = { x0: downPos.x, y0: downPos.y, x1: downPos.x, y1: downPos.y };
        }
      }, 380);
    }
  } else if (pointers.size === 2) {
    clearTimeout(pressTimer);
    boxSelecting = false; UI.dragBox = null;
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const nd = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinchDist > 0) zoomAt(mid.x, mid.y, nd / pinchDist);
    pinchDist = nd;
    // two-finger pan
    cam.x -= dx / 2 / cam.zoom; cam.y -= dy / 2 / cam.zoom; clampCam();
    return;
  }
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 12) {
    moved = true;
    clearTimeout(pressTimer);
  }
  if (boxSelecting && downPos) {
    UI.dragBox = {
      x0: Math.min(downPos.x, e.clientX), y0: Math.min(downPos.y, e.clientY),
      x1: Math.max(downPos.x, e.clientX), y1: Math.max(downPos.y, e.clientY),
    };
    return;
  }
  if (moved) {
    if (UI.placing) {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      UI.placing.tx = Math.round(wx - BUILDINGS[UI.placing.type].size / 2);
      UI.placing.ty = Math.round(wy - BUILDINGS[UI.placing.type].size / 2);
    } else {
      cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; clampCam();
    }
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  clearTimeout(pressTimer);
  if (pointers.size > 0) return;
  const wasBox = boxSelecting && UI.dragBox;
  boxSelecting = false;
  if (wasBox) {
    selectInBox(UI.dragBox);
    UI.dragBox = null;
    downPos = null;
    return;
  }
  UI.dragBox = null;
  if (!downPos || moved || !G || G.over) { downPos = null; return; }
  const now = performance.now();
  if (now - downTime < 500) handleTap(e.clientX, e.clientY, now);
  downPos = null;
}

function zoomAt(px, py, factor) {
  const [wx, wy] = screenToWorld(px, py);
  cam.zoom = Math.max(cam.min, Math.min(cam.max, cam.zoom * factor));
  // keep the point under the finger fixed
  const sx = (wx - wy) * TW2, sy = (wx + wy) * TH2;
  cam.x = sx - (px - viewW / 2) / cam.zoom;
  cam.y = sy - (py - viewH / 2) / cam.zoom;
  clampCam();
}

// ---------- hit testing ----------
function pickEntity(px, py) {
  // units first (closest within touch radius), then buildings, then resources
  let best = null, bd = 26; // px radius
  for (const u of G.units) {
    if (u.owner !== 0 && !tileVisible(u.x, u.y)) continue;
    const [ux, uy] = worldToScreen(u.x, u.y);
    const dd = Math.hypot(ux - px, uy - (py + 10 * cam.zoom));
    if (dd < bd) { bd = dd; best = u; }
  }
  if (best) return best;
  const [wx, wy] = screenToWorld(px, py);
  const tx = wx | 0, ty = wy | 0;
  if (inMap(tx, ty)) {
    const b = G.map.occ[tIdx(tx, ty)];
    if (b && (b.owner === 0 || tileExplored(tx, ty))) return b;
    const r = G.map.res[tIdx(tx, ty)];
    if (r && tileExplored(tx, ty)) return r;
    // forgiving resource targeting: snap to the nearest resource within ~a tile
    let bestR = null, bdR = 1.1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inMap(tx + dx, ty + dy) || !tileExplored(tx + dx, ty + dy)) continue;
      const rr = G.map.res[tIdx(tx + dx, ty + dy)];
      if (!rr) continue;
      const dd = Math.hypot(rr.tx + 0.5 - wx, rr.ty + 0.5 - wy);
      if (dd < bdR) { bdR = dd; bestR = rr; }
    }
    if (bestR) return bestR;
  }
  // building sprites are tall: probe a few tiles "behind" (up-screen = -x,-y in world)
  for (let probe = 1; probe <= 4; probe++) {
    const qx = tx + probe, qy = ty + probe;
    if (!inMap(qx, qy)) break;
    const b = G.map.occ[tIdx(qx, qy)];
    if (b && b.size >= probe && (b.owner === 0 || tileExplored(qx, qy))) return b;
  }
  return null;
}

function handleTap(px, py, now) {
  if (UI.placing) { // tap moves ghost
    const [wx, wy] = screenToWorld(px, py);
    UI.placing.tx = Math.round(wx - BUILDINGS[UI.placing.type].size / 2);
    UI.placing.ty = Math.round(wy - BUILDINGS[UI.placing.type].size / 2);
    return;
  }
  const hit = pickEntity(px, py);
  const sel = UI.selection;
  const myUnitsSelected = sel.filter(s => s.kind === 'unit' && s.owner === 0);

  // double tap on own unit: select all of type on screen
  const isDouble = now - lastTap.t < 350 && Math.hypot(px - lastTap.x, py - lastTap.y) < 30;
  lastTap = { t: now, x: px, y: py };
  if (isDouble && hit && hit.kind === 'unit' && hit.owner === 0) {
    UI.setSelection(G.units.filter(u => u.owner === 0 && u.type === hit.type && onScreen(u)));
    sfx('click');
    return;
  }

  if (hit && hit.owner === 0 && (hit.kind === 'unit' || hit.kind === 'bldg')) {
    // villagers selected + own worksite (foundation, damaged building, farm):
    // issue the work order rather than switching selection
    const vills = myUnitsSelected.filter(u => UNITS[u.type].cls === 'vill');
    if (vills.length && hit.kind === 'bldg' &&
        (!hit.done || hit.hp < hit.maxhp || (hit.type === 'farm' && hit.done))) {
      const [wx, wy] = screenToWorld(px, py);
      issueCommand(myUnitsSelected, hit, wx, wy);
      return;
    }
    UI.setSelection([hit]);
    sfx('click');
    return;
  }

  if (myUnitsSelected.length) {
    const [wx, wy] = screenToWorld(px, py);
    issueCommand(myUnitsSelected, hit, wx, wy);
    return;
  }
  // building selected: tap sets rally point
  const selB = sel.find(s => s.kind === 'bldg' && s.owner === 0);
  if (selB && BUILDINGS[selB.type].trains) {
    const [wx, wy] = screenToWorld(px, py);
    selB.rally = { x: wx, y: wy, res: hit && hit.kind === 'res' };
    uiToast('Rally point set');
    return;
  }
  if (hit) { UI.setSelection([hit]); sfx('click'); return; }
  UI.setSelection([]);
}

function issueCommand(units, hit, wx, wy) {
  const vills = units.filter(u => UNITS[u.type].cls === 'vill');
  const mil = units.filter(u => UNITS[u.type].cls !== 'vill');
  if (hit && (hit.kind === 'unit' || hit.kind === 'bldg') && hit.owner !== 0) {
    for (const u of units) cmdAttack(u, hit);
    pingAt(wx, wy, '#ff6b5e'); sfx('command');
    return;
  }
  if (hit && hit.kind === 'res') {
    for (const v of vills) { v.lastRes = hit; v.lastFarm = null; cmdGather(v, hit); }
    for (const m of mil) cmdMove(m, wx, wy);
    G.effects.push({ kind: 'gatherPing', x: hit.tx + 0.5, y: hit.ty + 0.5, t: 0.9, rtype: hit.rtype });
    sfx('command');
    return;
  }
  if (hit && hit.kind === 'bldg' && hit.owner === 0) {
    if (hit.type === 'farm' && hit.done) { for (const v of vills) { v.lastFarm = hit; cmdFarm(v, hit); } }
    else if (!hit.done || hit.hp < hit.maxhp) for (const v of vills) cmdBuild(v, hit);
    for (const m of mil) cmdMove(m, wx, wy);
    pingAt(wx, wy, '#7ae9ff'); sfx('command');
    return;
  }
  // plain move, spread formation for groups
  const n = units.length, cols = Math.ceil(Math.sqrt(n));
  units.forEach((u, i) => {
    const ox = (i % cols - (cols - 1) / 2) * 0.7, oy = ((i / cols | 0) - (cols - 1) / 2) * 0.7;
    cmdMove(u, wx + ox, wy + oy);
  });
  pingAt(wx, wy, '#c8ff9c'); sfx('command');
}

function onScreen(u) {
  const [px, py] = worldToScreen(u.x, u.y);
  return px >= -20 && px <= viewW + 20 && py >= -20 && py <= viewH + 20;
}

function selectInBox(b) {
  const picked = G.units.filter(u => {
    if (u.owner !== 0) return false;
    const [px, py] = worldToScreen(u.x, u.y);
    return px >= b.x0 && px <= b.x1 && py >= b.y0 - 14 && py <= b.y1 + 6;
  });
  if (picked.length) { UI.setSelection(picked); sfx('click'); }
}

function pingAt(wx, wy, color) {
  G.effects.push({ kind: 'hit', x: wx, y: wy, t: 0.18, color });
}
