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

// ============================================================
// HUD skin: procedural wood / stone / parchment textures and
// drawn resource icons — a classic RTS frame, no image files.
// ============================================================
function hudTexture(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  fn(g, w, h);
  return c;
}

function woodTex() {
  return hudTexture(128, 64, (g, w, h) => {
    const rng = mulberry32(42);
    g.fillStyle = '#4a3018'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      g.fillStyle = ['#5e4023', '#573b20', '#654627', '#523719'][row % 4];
      g.fillRect(0, y + 1.5, w, 14.5);
      // grain
      g.strokeStyle = 'rgba(30,18,8,0.4)'; g.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) {
        const gy = y + 3 + rng() * 11;
        g.beginPath(); g.moveTo(0, gy);
        for (let x = 0; x <= w; x += 16) g.quadraticCurveTo(x + 8, gy + (rng() - 0.5) * 3.4, x + 16, gy);
        g.stroke();
      }
      // occasional knot
      if (rng() < 0.7) {
        const kx = rng() * w, ky = y + 8;
        g.strokeStyle = 'rgba(30,18,8,0.5)';
        g.beginPath(); g.ellipse(kx, ky, 3.4, 2.2, 0.3, 0, 7); g.stroke();
        g.beginPath(); g.ellipse(kx, ky, 1.6, 1, 0.3, 0, 7); g.stroke();
      }
      // seams + joints + nails
      g.fillStyle = 'rgba(15,9,4,0.65)'; g.fillRect(0, y, w, 1.5);
      const jx = ((row % 2) * 64 + 24 + rng() * 24) % w;
      g.fillRect(jx, y + 1.5, 1.5, 14.5);
      g.fillStyle = '#1f1409';
      g.beginPath(); g.arc((jx + 8) % w, y + 5, 1.1, 0, 7); g.fill();
      g.beginPath(); g.arc((jx + 8) % w, y + 12, 1.1, 0, 7); g.fill();
    }
    // top-light sheen
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,220,160,0.06)'); grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

function stoneTex() {
  return hudTexture(72, 72, (g, w, h) => {
    const rng = mulberry32(99);
    g.fillStyle = '#6e675c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(rng() * w, rng() * h, 2 + rng() * 4, 1.5 + rng() * 3);
    }
    // masonry joints
    g.strokeStyle = 'rgba(25,22,18,0.35)'; g.lineWidth = 1;
    for (let y = 0; y < h; y += 18) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = (y / 18 % 2) * 12; x < w; x += 24) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 18); g.stroke();
      }
    }
  });
}

function parchTex() {
  return hudTexture(80, 40, (g, w, h) => {
    const rng = mulberry32(7);
    g.fillStyle = '#d9c9a3'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(160,130,80,0.12)' : 'rgba(255,250,235,0.15)';
      g.fillRect(rng() * w, rng() * h, 1.5 + rng() * 3, 1);
    }
    g.fillStyle = 'rgba(120,90,50,0.15)';
    g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2);
  });
}

// small drawn resource icons (retina 2x)
function hudIcon(kind) {
  return hudTexture(20, 20, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.lineWidth = 1;
    if (kind === 'wood') {
      // two stacked logs, end-on
      for (const [x, y] of [[cx - 4, cy + 3], [cx + 4, cy + 3], [cx, cy - 3]]) {
        g.fillStyle = '#8a5f33'; g.beginPath(); g.arc(x, y, 4.4, 0, 7); g.fill();
        g.strokeStyle = '#4a3018'; g.stroke();
        g.fillStyle = '#c9a266'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
        g.strokeStyle = '#8a5f33';
        g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.stroke();
      }
    } else if (kind === 'food') {
      // ham leg
      g.fillStyle = '#b5502f';
      g.beginPath(); g.ellipse(cx - 2, cy + 1, 6, 4.6, -0.6, 0, 7); g.fill();
      g.strokeStyle = '#7c3018'; g.stroke();
      g.fillStyle = 'rgba(255,220,190,0.5)';
      g.beginPath(); g.ellipse(cx - 3, cy - 0.5, 3, 2, -0.6, 0, 7); g.fill();
      g.strokeStyle = '#e8dcc8'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx + 3, cy - 2); g.lineTo(cx + 6.5, cy - 5.5); g.stroke();
      g.fillStyle = '#e8dcc8';
      g.beginPath(); g.arc(cx + 7.4, cy - 5, 1.6, 0, 7); g.fill();
      g.beginPath(); g.arc(cx + 5.6, cy - 7, 1.6, 0, 7); g.fill();
    } else if (kind === 'gold') {
      // coin stack
      for (let i = 0; i < 3; i++) {
        g.fillStyle = '#e8c33f';
        g.beginPath(); g.ellipse(cx - 2 + i * 1.4, cy + 3.4 - i * 3, 5.4, 2.6, 0, 0, 7); g.fill();
        g.strokeStyle = '#8a6b12'; g.stroke();
        g.fillStyle = '#f7de7a';
        g.beginPath(); g.ellipse(cx - 2 + i * 1.4, cy + 2.6 - i * 3, 4, 1.6, 0, 0, 7); g.fill();
      }
    } else if (kind === 'stone') {
      for (const [x, y, r] of [[cx - 3, cy + 2.4, 4.6], [cx + 3.6, cy + 3, 3.6], [cx + 1, cy - 3, 3.8]]) {
        g.fillStyle = '#8d8d8d';
        g.beginPath();
        g.moveTo(x - r, y); g.lineTo(x - r * 0.35, y - r); g.lineTo(x + r * 0.6, y - r * 0.75); g.lineTo(x + r, y);
        g.closePath(); g.fill();
        g.strokeStyle = '#4c4c4c'; g.stroke();
        g.fillStyle = '#b5b5b5';
        g.beginPath(); g.moveTo(x - r * 0.35, y - r); g.lineTo(x + r * 0.1, y - r * 0.45); g.lineTo(x - r * 0.5, y - r * 0.4); g.closePath(); g.fill();
      }
    } else if (kind === 'pop') {
      for (const [x, sh] of [[cx - 3.4, 0], [cx + 3.4, 0]]) {
        g.fillStyle = sh ? '#c9b47c' : '#e2cf9b';
        g.beginPath(); g.arc(x, cy - 3.4, 2.6, 0, 7); g.fill();
        g.beginPath(); g.moveTo(x - 3.4, cy + 7); g.quadraticCurveTo(x, cy - 1.4, x + 3.4, cy + 7); g.closePath(); g.fill();
        g.strokeStyle = '#6b5836'; g.lineWidth = 0.8; g.stroke();
      }
    } else if (kind === 'scroll') {
      g.fillStyle = '#e2d3ab';
      g.fillRect(cx - 5.4, cy - 6.4, 10.8, 12.8);
      g.strokeStyle = '#8a6b40'; g.strokeRect(cx - 5.4, cy - 6.4, 10.8, 12.8);
      g.fillStyle = '#c9b47c';
      g.fillRect(cx - 6.6, cy - 7.6, 13.2, 2.6);
      g.fillRect(cx - 6.6, cy + 5, 13.2, 2.6);
      g.strokeStyle = 'rgba(110,80,40,0.7)'; g.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(cx - 3.4, cy - 3 + i * 3); g.lineTo(cx + 3.4, cy - 3 + i * 3); g.stroke();
      }
    } else if (kind === 'age') {
      // laurel chevron
      g.strokeStyle = '#d8b45a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx - 6, cy + 4); g.lineTo(cx, cy - 4); g.lineTo(cx + 6, cy + 4); g.stroke();
      g.beginPath(); g.moveTo(cx - 6, cy + 8); g.lineTo(cx, cy); g.lineTo(cx + 6, cy + 8); g.stroke();
      g.fillStyle = '#f7de7a';
      g.beginPath(); g.arc(cx, cy - 6, 1.8, 0, 7); g.fill();
    }
  });
}

let hudReady = false;
function initHudSkin() {
  if (hudReady) return;
  hudReady = true;
  const root = document.documentElement.style;
  root.setProperty('--wood', `url(${woodTex().toDataURL()})`);
  root.setProperty('--stone', `url(${stoneTex().toDataURL()})`);
  root.setProperty('--parch', `url(${parchTex().toDataURL()})`);
  // swap top-bar emoji for drawn icons
  for (const k of ['wood', 'food', 'gold', 'stone', 'pop']) {
    const slot = $(`ico-${k}`);
    if (slot) { slot.innerHTML = ''; slot.appendChild(hudIcon(k)); }
  }
}

// sprite-based button icons (cached as data URLs)
const iconCache = new Map();
function spriteIconURL(kind, type) {
  const key = `${kind}_${type}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const src = kind === 'b' ? buildingSprite(type, 0, true, 1) : unitSprite(type, 0, 0);
  const c = document.createElement('canvas');
  c.width = 80; c.height = 80;
  const g = c.getContext('2d');
  // fit sprite into the box with a little padding
  const scale = Math.min(72 / src.width, 72 / src.height);
  const w = src.width * scale, h = src.height * scale;
  g.drawImage(src, (80 - w) / 2, (80 - h) / 2 + (kind === 'u' ? 4 : 0), w, h);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
function iconEl(url) {
  const img = document.createElement('img');
  img.src = url; img.className = 'btn-ico';
  return img;
}

// portrait of the current selection
function updatePortrait(sel) {
  const wrap = $('portrait-wrap'), pc = $('portrait');
  if (!wrap || !pc) return;
  if (!sel.length || sel[0].kind === 'res' && false) { }
  if (!sel.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const g = pc.getContext('2d');
  const W = pc.width, H = pc.height;
  // sky-to-grass backdrop
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#7da7c9'); grad.addColorStop(0.62, '#b8cbd8');
  grad.addColorStop(0.63, '#5c8a45'); grad.addColorStop(1, '#3f6b31');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const e = sel[0];
  let spr = null;
  if (e.kind === 'unit') spr = unitSprite(e.type, e.owner, 0);
  else if (e.kind === 'bldg') spr = buildingSprite(e.type, e.owner, true);
  else if (e.kind === 'res') spr = resSprite(e.rtype, e.id % 7);
  if (spr) {
    const scale = Math.min((W - 10) / spr.width, (H - 8) / spr.height) * (e.kind === 'unit' ? 1.45 : 1);
    const w = spr.width * scale, h = spr.height * scale;
    g.drawImage(spr, (W - w) / 2, H - h - (e.kind === 'unit' ? 2 : 4), w, h);
  }
  // multi-select count badge
  if (sel.length > 1) {
    g.fillStyle = 'rgba(20,14,6,0.8)';
    g.fillRect(W - 26, 2, 24, 16);
    g.fillStyle = '#ffd98c'; g.font = 'bold 11px Georgia, serif'; g.textAlign = 'center';
    g.fillText('×' + sel.length, W - 14, 14);
  }
  // inner shading
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,12,4,0.4)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

function initUI() {
  initHudSkin();
  $('btn-menu').onclick = () => showOverlay('pause');
  $('btn-idle').onclick = cycleIdleVillager;
  $('btn-army').onclick = selectArmy;
  $('btn-speed').onclick = () => {
    const speeds = [1, 1.5, 2];
    gameSpeed = speeds[(speeds.indexOf(gameSpeed) + 1) % speeds.length];
    $('btn-speed').textContent = gameSpeed + '×';
    sfx('click');
  };
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
  if (G) updatePortrait(UI.placing ? [] : sel);

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
        ['house', 'mill', 'lumbercamp', 'miningcamp', 'farm', 'dock', 'market', 'palisade', 'stonewall', 'towncenter'],
        ['barracks', 'archeryrange', 'stable', 'blacksmith', 'monastery', 'tower', 'siegeworkshop', 'castle'],
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
        addBtn(panel, spriteIconURL('b', bt), `${d.name}\n${costText(d.cost)}`, () => startPlacing(bt), canAfford(p, d.cost) ? '' : 'nocash');
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

  // market trading
  if (d.trade) {
    for (const k of ['wood', 'food', 'stone']) {
      addBtn(panel, RES_ICON[k], `Sell 100\n→ ${TRADE_SELL}${RES_ICON.gold}`, () => {
        if (marketSell(p, k)) { sfx('click'); refreshPanel(); } else uiToast(`Not enough ${k}`);
      }, p.res[k] >= 100 ? '' : 'nocash');
    }
    for (const k of ['wood', 'food', 'stone']) {
      addBtn(panel, RES_ICON[k], `Buy 100\n${TRADE_BUY}${RES_ICON.gold} →`, () => {
        if (marketBuy(p, k)) { sfx('click'); refreshPanel(); } else uiToast('Not enough gold');
      }, p.res.gold >= TRADE_BUY ? 'tech' : 'tech nocash');
    }
  }

  if (d.trains) for (const ut of d.trains) {
    const u = UNITS[ut];
    if (u.age > p.age) continue;
    const nm = (p.buffs[ut] && p.buffs[ut].rename) || u.name;
    addBtn(panel, spriteIconURL('u', ut), `${nm}\n${costText(u.cost)}`, () => { if (trainUnit(b, ut)) sfx('click'); refreshPanel(); },
      canAfford(p, u.cost) ? '' : 'nocash');
  }
  // techs at this building
  for (const [id, t] of Object.entries(TECHS)) {
    if (t.from !== b.type || p.techs[id] || p.researching[id]) continue;
    if (t.age > p.age) continue;
    if (t.req && !p.techs[t.req]) continue;
    addBtn(panel, hudIcon('scroll'), `${t.name}\n${costText(t.cost)}`, () => { if (startResearch(b, id)) sfx('click'); refreshPanel(); },
      canAfford(p, t.cost) ? 'tech' : 'tech nocash');
  }
  // age up at town center
  if (b.type === 'towncenter' && p.age < 3 && !p.ageResearch) {
    const cost = AGE_COST[p.age + 1];
    const need = AGE_REQ_BLDGS[p.age + 1] - countAgeBuildings(p);
    const ok = need <= 0 && canAfford(p, cost);
    addBtn(panel, hudIcon('age'), `${AGE_NAMES[p.age + 1]}\n${costText(cost)}${need > 0 ? `\nNeed ${need} more ${AGE_NAMES[p.age]} bldg` : ''}`,
      () => { if (startAgeUp(b)) sfx('click'); refreshPanel(); }, ok ? 'age' : 'age nocash');
  }
}

// ---------- selection info lines (rebuilt cheaply every UI tick) ----------
function resInfoHTML(r) {
  const names = { tree: 'Tree', gold: 'Gold Mine', stone: 'Stone Mine', berry: 'Berry Bush', fish: 'Fish Shoal' };
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
  el.innerHTML = `<span class="lbl">${lines[0]}</span>` +
    (lines[1] ? `<span class="sub">${lines.slice(1).join('<br>')}</span>` : '');
  // icon may be an emoji string, a data-URL image, or a canvas element
  let ic;
  if (icon instanceof HTMLElement) { ic = icon; ic.classList.add('btn-ico'); }
  else if (typeof icon === 'string' && icon.startsWith('data:')) ic = iconEl(icon);
  else { ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = icon; }
  el.insertBefore(ic, el.firstChild);
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
    const canContinue = hasSave();
    box.innerHTML = `
      <h1>Empire<span>Phone</span></h1>
      <p class="tagline">A real-time strategy game of four ages,<br>built for your phone.</p>
      ${canContinue ? '<div class="menu-btns"><button class="menu-btn primary" id="btn-continue">💾 Continue saved game</button></div>' : ''}
      <div class="opp-row">Opponents:
        <button class="opp-btn" data-o="1">1 ⚔️</button>
        <button class="opp-btn" data-o="2">2 ⚔️⚔️</button>
      </div>
      <div class="menu-btns">
        <button class="menu-btn" data-d="easy">🌿 Easy</button>
        <button class="menu-btn ${canContinue ? '' : 'primary'}" data-d="normal">⚔️ Normal</button>
        <button class="menu-btn" data-d="hard">🔥 Hard</button>
      </div>
      <button class="menu-btn ghost" id="btn-how">📖 How to play</button>`;
    const oppBtns = box.querySelectorAll('.opp-btn');
    const syncOpp = () => oppBtns.forEach(b => b.classList.toggle('sel', +b.dataset.o === UI.opponents));
    UI.opponents = UI.opponents || 1;
    syncOpp();
    oppBtns.forEach(b => b.onclick = () => { UI.opponents = +b.dataset.o; syncOpp(); });
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { startGame(b.dataset.d, UI.opponents); });
    if (canContinue) $('btn-continue').onclick = () => { resumeSavedGame(); };
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
        <p><b>Counters:</b> spearmen beat cavalry · skirmishers beat archers · knights crush archers &amp; siege · rams and trebuchets wreck buildings.</p>
        <p><b>More tools:</b> the Market trades resources for gold · Monks convert enemy units and heal your own · walls buy you time · the ⏩ button in the top bar speeds up the game.</p>
      </div>
      <button class="menu-btn primary" id="btn-back">Back</button>`;
    $('btn-back').onclick = () => showOverlay(G ? 'pause' : 'menu');
  } else if (which === 'pause') {
    if (G && !G.over) saveGame();
    box.innerHTML = `
      <h2>Paused</h2>
      <p class="tagline" style="margin:6px 0 14px">Progress saved automatically.</p>
      <div class="menu-btns">
        <button class="menu-btn primary" id="btn-resume">▶️ Resume</button>
        <button class="menu-btn" id="btn-help2">📖 How to play</button>
        <button class="menu-btn" id="btn-quit">💾 Save &amp; quit to menu</button>
        <button class="menu-btn" id="btn-restart">🔄 Abandon &amp; new game</button>
      </div>`;
    $('btn-resume').onclick = hideOverlay;
    $('btn-help2').onclick = () => showOverlay('help');
    $('btn-quit').onclick = () => { saveGame(); G = null; showOverlay('menu'); };
    $('btn-restart').onclick = () => { clearSave(); showOverlay('menu'); };
    paused = true;
  } else if (which === 'victory' || which === 'defeat') {
    clearSave();
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
    convert: [660, 1320, 0.6, 'sine', 0.07],
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
