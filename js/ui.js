'use strict';
// ============================================================
// HUD: resource bar, selection panel, build/train/tech buttons,
// minimap frame, toasts, menus. Plus a tiny WebAudio synth.
// ============================================================

const UI = {
  selection: [],
  placing: null,      // {type, tx, ty}
  dragBox: null,
  buildPage: 0,       // 0 economy, 1 military
  lastIdlePing: 0,
  setSelection(list) {
    this.selection = list.filter(Boolean);
    this.placing = null;
    refreshPanel();
  },
};

const $ = (id) => document.getElementById(id);

function initUI() {
  $('btn-menu').onclick = () => showOverlay('pause');
  $('btn-idle').onclick = cycleIdleVillager;
  $('btn-army').onclick = selectArmy;
  refreshPanel();
}

// ---------- top bar ----------
function updateTopBar() {
  if (!G) return;
  const p = G.players[0];
  for (const k of RES_KEYS) $(`res-${k}`).textContent = Math.floor(p.res[k]);
  $('res-pop').textContent = `${p.pop}/${p.popCap}`;
  $('res-pop').classList.toggle('warn', p.pop >= p.popCap);
  $('res-age').textContent = AGE_NAMES[p.age];
  const idle = G.units.filter(u => u.owner === 0 && u.type === 'villager' && u.task === 'idle').length;
  $('btn-idle').style.display = idle ? '' : 'none';
  $('idle-count').textContent = idle;
}

// ---------- selection / command panel ----------
let panelSig = '';
function refreshPanel() { panelSig = ''; rebuildPanel(); }

// Periodic refresh: only rebuild the button row when its content actually
// changes, so the horizontal scroll position isn't reset mid-swipe.
function refreshPanelLive() {
  const sig = computePanelSig();
  if (sig !== panelSig) { panelSig = sig; rebuildPanel(); }
  else updatePanelInfo();
}
function computePanelSig() {
  const sel = UI.selection.filter(alive);
  const p = G.players[0];
  const afford = RES_KEYS.map(k => Math.floor(p.res[k] / 25)).join(','); // coarse: re-check button affordability
  return [sel.map(e => e.id).join('.'), UI.placing && UI.placing.type, UI.buildPage,
          p.age, p.ageResearch ? 1 : 0, Object.keys(p.techs).length, Object.keys(p.researching).length,
          sel.length === 1 && sel[0].queue ? sel[0].queue.length : '', afford].join('|');
}

function rebuildPanel() {
  const panel = $('panel-actions'), info = $('panel-info');
  panel.innerHTML = ''; info.innerHTML = '';
  const sel = UI.selection.filter(alive);
  if (sel.length !== UI.selection.length) UI.selection = sel;

  if (UI.placing) {
    info.innerHTML = `<div class="sel-name">Place ${BUILDINGS[UI.placing.type].name}</div><div class="sel-sub">Drag to position</div>`;
    addBtn(panel, '✔️', 'Confirm', () => confirmPlace(), 'confirm');
    addBtn(panel, '❌', 'Cancel', () => { UI.placing = null; refreshPanel(); });
    return;
  }
  if (!sel.length) {
    info.innerHTML = `<div class="sel-sub">Tap a unit or building.<br>Drag to pan · pinch to zoom<br>Long-press &amp; drag to box-select</div>`;
    return;
  }
  const first = sel[0];

  if (first.kind === 'res') {
    info.innerHTML = resInfoHTML(first);
    return;
  }

  if (first.kind === 'unit') {
    const mine = first.owner === 0;
    info.innerHTML = unitInfoHTML(sel);
    if (!mine) return;
    addBtn(panel, '✋', 'Stop', () => { for (const u of sel) { u.task = 'idle'; u.target = null; u.path = null; } sfx('click'); });
    const vills = sel.filter(u => u.kind === 'unit' && UNITS[u.type].cls === 'vill');
    if (vills.length) {
      const pages = [
        ['house', 'mill', 'lumbercamp', 'miningcamp', 'farm', 'palisade', 'towncenter'],
        ['barracks', 'archeryrange', 'stable', 'blacksmith', 'tower', 'siegeworkshop', 'castle'],
      ];
      addBtn(panel, UI.buildPage === 0 ? '🏠' : '⚔️', UI.buildPage === 0 ? 'Economy' : 'Military', () => {
        UI.buildPage = 1 - UI.buildPage; refreshPanel();
      }, 'page');
      const p = G.players[0];
      const hasTC = G.buildings.some(b => b.owner === 0 && b.type === 'towncenter');
      for (const bt of pages[UI.buildPage]) {
        const d = BUILDINGS[bt];
        if (d.age > p.age) continue;
        // additional Town Centers unlock in Castle Age; rebuilding is always allowed
        if (bt === 'towncenter' && p.age < 2 && hasTC) continue;
        addBtn(panel, d.icon, `${d.name}\n${costText(d.cost)}`, () => startPlacing(bt), canAfford(p, d.cost) ? '' : 'nocash');
      }
    }
    return;
  }

  // building
  const b = first, d = BUILDINGS[b.type], p = G.players[0];
  const mine = b.owner === 0;
  info.innerHTML = bldgInfoHTML(b);
  if (!mine) return;
  addBtn(panel, '✖️', 'Deselect', () => UI.setSelection([]));
  if (b.type !== 'towncenter') addBtn(panel, '🗑', 'Demolish', () => {
    if (!confirm(`Demolish this ${BUILDINGS[b.type].name}?`)) return;
    destroyBuilding(b); UI.setSelection([]); sfx('boom');
  });
  if (!b.done) return;

  if (d.trains) for (const ut of d.trains) {
    const u = UNITS[ut];
    if (u.age > p.age) continue;
    const nm = (p.buffs[ut] && p.buffs[ut].rename) || u.name;
    addBtn(panel, u.icon, `${nm}\n${costText(u.cost)}`, () => { if (trainUnit(b, ut)) sfx('click'); refreshPanel(); },
      canAfford(p, u.cost) ? '' : 'nocash');
  }
  // techs at this building
  for (const [id, t] of Object.entries(TECHS)) {
    if (t.from !== b.type || p.techs[id] || p.researching[id]) continue;
    if (t.age > p.age) continue;
    if (t.req && !p.techs[t.req]) continue;
    addBtn(panel, '📜', `${t.name}\n${costText(t.cost)}`, () => { if (startResearch(b, id)) sfx('click'); refreshPanel(); },
      canAfford(p, t.cost) ? 'tech' : 'tech nocash');
  }
  // age up at town center
  if (b.type === 'towncenter' && p.age < 3 && !p.ageResearch) {
    const cost = AGE_COST[p.age + 1];
    const need = AGE_REQ_BLDGS[p.age + 1] - countAgeBuildings(p);
    const ok = need <= 0 && canAfford(p, cost);
    addBtn(panel, '⬆️', `${AGE_NAMES[p.age + 1]}\n${costText(cost)}${need > 0 ? `\nNeed ${need} more ${AGE_NAMES[p.age]} bldg` : ''}`,
      () => { if (startAgeUp(b)) sfx('click'); refreshPanel(); }, ok ? 'age' : 'age nocash');
  }
}

// ---------- selection info lines (rebuilt cheaply every UI tick) ----------
function resInfoHTML(r) {
  const names = { tree: 'Tree', gold: 'Gold Mine', stone: 'Stone Mine', berry: 'Berry Bush' };
  return `<div class="sel-name">${names[r.rtype]}</div><div class="sel-sub">${Math.ceil(r.amount)} ${RES_ICON[resGives(r)]} left</div>`;
}
function unitInfoHTML(sel) {
  const first = sel[0], mine = first.owner === 0, count = sel.length;
  const nm = count > 1 ? `${count} units` : unitName(first);
  return `<div class="sel-name">${mine ? '' : '🔴 '}${nm}</div>
    <div class="sel-sub">${count === 1 ? `❤️${Math.ceil(first.hp)}/${first.maxhp} ⚔️${unitStat(first, 'atk')} 🛡${unitStat(first, 'armor')}/${unitStat(first, 'parmor')}` : ''}</div>`;
}
function bldgInfoHTML(b) {
  const d = BUILDINGS[b.type], mine = b.owner === 0;
  let html = `<div class="sel-name">${mine ? '' : '🔴 '}${d.name}</div>
    <div class="sel-sub">❤️${Math.ceil(b.hp)}/${b.maxhp}${b.done ? '' : ' · building…'}${b.type === 'farm' && b.done ? ` · 🌾${Math.ceil(b.farmFood)}` : ''}</div>`;
  if (mine && b.done && b.queue.length) {
    const q = b.queue[0];
    const label = q.what === 'unit' ? UNITS[q.type].name : q.what === 'tech' ? TECHS[q.type].name : AGE_NAMES[q.type];
    html += `<div class="queue-line">⏳ ${label} ${Math.floor(q.t / q.total * 100)}%${b.queue.length > 1 ? ` (+${b.queue.length - 1})` : ''}</div>`;
  }
  return html;
}
function updatePanelInfo() {
  if (!G) return;
  const sel = UI.selection.filter(alive);
  if (sel.length !== UI.selection.length) { UI.selection = sel; panelSig = ''; rebuildPanel(); return; }
  if (UI.placing || !sel.length) return; // static text
  const info = $('panel-info');
  const first = sel[0];
  if (first.kind === 'res') info.innerHTML = resInfoHTML(first);
  else if (first.kind === 'unit') info.innerHTML = unitInfoHTML(sel);
  else info.innerHTML = bldgInfoHTML(first);
}

function addBtn(parent, icon, label, fn, cls = '') {
  const el = document.createElement('button');
  el.className = 'cmd-btn ' + cls;
  const lines = label.split('\n');
  el.innerHTML = `<span class="ico">${icon}</span><span class="lbl">${lines[0]}</span>` +
    (lines[1] ? `<span class="sub">${lines.slice(1).join('<br>')}</span>` : '');
  el.onclick = (e) => { e.stopPropagation(); fn(); };
  parent.appendChild(el);
  return el;
}

function startPlacing(type) {
  const p = G.players[0], d = BUILDINGS[type];
  if (!canAfford(p, d.cost)) { uiToast(`Not enough resources — need ${costText(d.cost)}`); return; }
  const [wx, wy] = screenToWorld(viewW / 2, viewH / 2);
  UI.placing = { type, tx: Math.round(wx - d.size / 2), ty: Math.round(wy - d.size / 2) };
  refreshPanel();
}
function confirmPlace() {
  const pl = UI.placing;
  if (!pl) return;
  const b = placeBuilding(0, pl.type, pl.tx, pl.ty);
  if (!b) { uiToast("Can't build there"); return; }
  sfx('place');
  const vills = UI.selection.filter(u => u.kind === 'unit' && UNITS[u.type].cls === 'vill');
  for (const v of vills) cmdBuild(v, b);
  UI.placing = null;
  refreshPanel();
}

// ---------- quick-select helpers ----------
let idleCycle = 0;
function cycleIdleVillager() {
  const idle = G.units.filter(u => u.owner === 0 && u.type === 'villager' && u.task === 'idle');
  if (!idle.length) return;
  const u = idle[idleCycle++ % idle.length];
  UI.setSelection([u]);
  centerCamOn(u.x, u.y); clampCam();
  sfx('click');
}
function selectArmy() {
  const army = G.units.filter(u => u.owner === 0 && UNITS[u.type].cls !== 'vill');
  if (!army.length) { uiToast('No military units'); return; }
  UI.setSelection(army);
  centerCamOn(army[0].x, army[0].y); clampCam();
  sfx('click');
}
function uiIdleVillPing() { /* badge is polled in updateTopBar */ }

// ---------- toasts ----------
let toastTimer = null;
function uiToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- overlays (menu / pause / end) ----------
function showOverlay(which) {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const box = $('overlay-box');
  if (which === 'menu') {
    box.innerHTML = `
      <h1>Empire<span>Phone</span></h1>
      <p class="tagline">A real-time strategy game of four ages,<br>built for your phone.</p>
      <div class="menu-btns">
        <button class="menu-btn" data-d="easy">🌿 Easy</button>
        <button class="menu-btn primary" data-d="normal">⚔️ Normal</button>
        <button class="menu-btn" data-d="hard">🔥 Hard</button>
      </div>
      <button class="menu-btn ghost" id="btn-how">📖 How to play</button>`;
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { startGame(b.dataset.d); });
    $('btn-how').onclick = () => showOverlay('help');
  } else if (which === 'help') {
    box.innerHTML = `
      <h2>How to play</h2>
      <div class="help">
        <p><b>Goal:</b> destroy the red player's army and buildings before they destroy yours.</p>
        <p><b>👆 Tap</b> a unit/building to select. Tap ground to move, an enemy to attack, a resource to gather.</p>
        <p><b>🖐 Drag</b> to pan · <b>🤏 pinch</b> to zoom · <b>long-press &amp; drag</b> to box-select troops · <b>double-tap</b> a unit to select all of its type.</p>
        <p><b>Economy:</b> villagers gather 🪵🍖🪙🪨 and drop them at the Town Center or camps. Build houses to raise the population cap. Build farms when berries run out.</p>
        <p><b>Ages:</b> build 2 buildings of your current age, then press ⬆️ at the Town Center to advance — new units, buildings and techs unlock each age.</p>
        <p><b>Counters:</b> spearmen beat cavalry · skirmishers beat archers · knights crush archers &amp; siege · rams wreck buildings.</p>
      </div>
      <button class="menu-btn primary" id="btn-back">Back</button>`;
    $('btn-back').onclick = () => showOverlay(G ? 'pause' : 'menu');
  } else if (which === 'pause') {
    box.innerHTML = `
      <h2>Paused</h2>
      <div class="menu-btns">
        <button class="menu-btn primary" id="btn-resume">▶️ Resume</button>
        <button class="menu-btn" id="btn-help2">📖 How to play</button>
        <button class="menu-btn" id="btn-restart">🔄 New game</button>
      </div>`;
    $('btn-resume').onclick = hideOverlay;
    $('btn-help2').onclick = () => showOverlay('help');
    $('btn-restart').onclick = () => showOverlay('menu');
    paused = true;
  } else if (which === 'victory' || which === 'defeat') {
    const win = which === 'victory';
    box.innerHTML = `
      <h2>${win ? '🏆 Victory!' : '💀 Defeat'}</h2>
      <p class="tagline">${win ? 'The enemy has been vanquished. Your empire stands eternal.' : 'Your empire has fallen. Rise again!'}</p>
      <div class="menu-btns"><button class="menu-btn primary" id="btn-again">Play again</button></div>`;
    $('btn-again').onclick = () => showOverlay('menu');
  }
}
function hideOverlay() { $('overlay').classList.add('hidden'); paused = false; }

// ---------- tiny sound synth ----------
let AC = null, sfxLast = {};
function ensureAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
  if (AC && AC.state === 'suspended') AC.resume();
}
function sfx(kind) {
  ensureAudio();
  if (!AC) return;
  const now = AC.currentTime;
  if (sfxLast[kind] && now - sfxLast[kind] < 0.08) return;
  sfxLast[kind] = now;
  const o = AC.createOscillator(), g = AC.createGain();
  o.connect(g); g.connect(AC.destination);
  const P = {
    click:   [660, 880, 0.05, 'square', 0.04],
    command: [440, 520, 0.07, 'triangle', 0.05],
    place:   [220, 180, 0.15, 'triangle', 0.07],
    hit:     [200, 90, 0.08, 'sawtooth', 0.04],
    arrow:   [900, 500, 0.06, 'sine', 0.025],
    boom:    [120, 40, 0.4, 'sawtooth', 0.1],
    alarm:   [700, 500, 0.35, 'square', 0.06],
    age:     [523, 784, 0.5, 'triangle', 0.09],
  }[kind] || [440, 440, 0.05, 'sine', 0.04];
  o.type = P[3];
  o.frequency.setValueAtTime(P[0], now);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, P[1]), now + P[2]);
  g.gain.setValueAtTime(P[4], now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + P[2]);
  o.start(now); o.stop(now + P[2] + 0.02);
}
function sfxNear(kind, wx, wy) {
  // only audible if near the current viewport center
  const [cx, cy] = screenToWorld(viewW / 2, viewH / 2);
  if (Math.hypot(wx - cx, wy - cy) < 18) sfx(kind);
}
