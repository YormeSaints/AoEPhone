'use strict';
// ============================================================
// Isometric renderer. All art is procedural (canvas-drawn) —
// original assets, no external images.
// ============================================================

const TW2 = 32, TH2 = 16; // half tile in world pixels at zoom 1

const cam = { x: 0, y: 0, zoom: 1.4, min: 0.7, max: 3.2 };
let canvas, ctx, DPR = 1, viewW = 0, viewH = 0;

function initRender() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}
function resizeCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  viewW = canvas.clientWidth; viewH = canvas.clientHeight;
  canvas.width = Math.round(viewW * DPR);
  canvas.height = Math.round(viewH * DPR);
}

function worldToScreen(x, y) {
  const sx = (x - y) * TW2, sy = (x + y) * TH2;
  return [(sx - cam.x) * cam.zoom + viewW / 2, (sy - cam.y) * cam.zoom + viewH / 2];
}
function screenToWorld(px, py) {
  const sx = (px - viewW / 2) / cam.zoom + cam.x;
  const sy = (py - viewH / 2) / cam.zoom + cam.y;
  return [(sx / TW2 + sy / TH2) / 2, (sy / TH2 - sx / TW2) / 2];
}
function centerCamOn(x, y) { cam.x = (x - y) * TW2; cam.y = (x + y) * TH2; }
function clampCam() {
  const cx = (MAP_W / 2 - MAP_H / 2) * TW2, cy = (MAP_W / 2 + MAP_H / 2) * TH2;
  const rx = MAP_W * TW2, ry = MAP_H * TH2;
  cam.x = Math.max(cx - rx, Math.min(cx + rx, cam.x));
  cam.y = Math.max(-TH2 * 4, Math.min(cy + ry / 2, cam.y));
}

// ---------- procedural sprite cache ----------
const spriteCache = new Map();
function cached(key, w, h, draw) {
  let c = spriteCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2; // 2x for crispness
    const g = c.getContext('2d');
    g.scale(2, 2);
    draw(g, w, h);
    spriteCache.set(key, c);
  }
  return c;
}

const TERRAIN_COL = {
  [T_GRASS]: ['#6aa84f', '#5d9945'], [T_GRASS2]: ['#5f9c46', '#54903e'],
  [T_DIRT]: ['#b49b6c', '#a58c5f'], [T_WATER]: ['#3a7ec2', '#3574b4'], [T_SAND]: ['#d6c284', '#c9b477'],
};

function tileSprite(t) {
  return cached('tile' + t, TW2 * 2 + 2, TH2 * 2 + 2, (g, w, h) => {
    const [c1, c2] = TERRAIN_COL[t];
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c1); grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.lineTo(0, h / 2); g.closePath();
    g.fill();
    // subtle texture
    g.globalAlpha = 0.10;
    const rng = mulberry32(t * 777 + 3);
    g.fillStyle = '#000';
    for (let i = 0; i < 7; i++) {
      const x = w / 4 + rng() * w / 2, y = h / 4 + rng() * h / 2;
      g.fillRect(x, y, 1.5, 1);
    }
    g.globalAlpha = 1;
  });
}

function drawIsoDiamond(g, px, py, wz, hz, fill, stroke) {
  g.beginPath();
  g.moveTo(px, py - hz); g.lineTo(px + wz, py); g.lineTo(px, py + hz); g.lineTo(px - wz, py);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.stroke(); }
}

// ---------- building sprites ----------
function buildingSprite(type, owner, done) {
  const key = `b_${type}_${owner}_${done ? 1 : 0}`;
  const d = BUILDINGS[type];
  const s = d.size;
  const w = (s + 1) * TW2 * 2, h = (s + 1) * TH2 * 2 + 70;
  return cached(key, w, h, (g) => {
    const cx = w / 2, base = h - (s + 1) * TH2;
    const col = G ? G.players[owner].color : '#888';
    drawBuildingArt(g, type, s, cx, base, col, done);
  });
}

function drawBuildingArt(g, type, s, cx, base, teamCol, done) {
  const fw = s * TW2, fh = s * TH2; // footprint half-extents
  // ground shadow / foundation
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.moveTo(cx, base - fh); g.lineTo(cx + fw, base); g.lineTo(cx, base + fh); g.lineTo(cx - fw, base);
  g.closePath(); g.fill();

  if (!done) { // construction site: wooden frame
    g.strokeStyle = '#8a6b40'; g.lineWidth = 2.5;
    for (let i = 0; i < s * 2; i++) {
      const t = (i + 0.5) / (s * 2);
      g.beginPath();
      g.moveTo(cx - fw + t * fw * 2, base - fh * (1 - Math.abs(t * 2 - 1)) * 0.8 + fh * 0.4);
      g.lineTo(cx - fw + t * fw * 2, base - 18 - 10 * s);
      g.stroke();
    }
    g.fillStyle = '#a3814f';
    g.fillRect(cx - fw * 0.6, base - 20 - 10 * s, fw * 1.2, 5);
    return;
  }

  const wallH = 14 + s * 9;
  const wall = (x0, y0, x1, y1, colA, colB) => {
    const grad = g.createLinearGradient(0, y0 - wallH, 0, y0);
    grad.addColorStop(0, colA); grad.addColorStop(1, colB);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, y1 - wallH); g.lineTo(x0, y0 - wallH);
    g.closePath(); g.fill();
  };
  const roof = (peakH, colA, colB) => {
    // isometric top face: front half lighter, back half darker, slight ridge lift
    const py = base - wallH;
    g.fillStyle = colA;
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, py + fh); g.lineTo(cx + fw, py); g.lineTo(cx, py - fh * 0.4 - peakH); g.closePath(); g.fill();
    g.fillStyle = colB;
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, py - fh * 0.4 - peakH); g.lineTo(cx + fw, py); g.lineTo(cx, py - fh); g.closePath(); g.fill();
  };
  const banner = (x, y) => {
    g.fillStyle = teamCol;
    g.fillRect(x - 1, y - 16, 2, 16);
    g.beginPath(); g.moveTo(x + 1, y - 16); g.lineTo(x + 11, y - 12.5); g.lineTo(x + 1, y - 9); g.closePath(); g.fill();
  };

  switch (type) {
    case 'towncenter': {
      wall(cx - fw, base, cx, base + fh, '#d8cdb4', '#b8ab8d');
      wall(cx, base + fh, cx + fw, base, '#c4b797', '#a99a79');
      roof(16, '#a34737', '#8c3b2e');
      // team stripe along the front walls
      g.fillStyle = teamCol;
      g.fillRect(cx - fw * 0.45, base - wallH * 0.35, fw * 0.9, 4);
      banner(cx, base - wallH - fh + 4);
      break;
    }
    case 'house': {
      wall(cx - fw, base, cx, base + fh, '#d9c9a3', '#bfae87');
      wall(cx, base + fh, cx + fw, base, '#c6b48c', '#ab9871');
      roof(10, '#96552f', '#aa6538');
      g.fillStyle = teamCol; g.fillRect(cx - 3, base - wallH + 4, 6, 6);
      break;
    }
    case 'mill': {
      wall(cx - fw, base, cx, base + fh, '#cbb489', '#b09a72');
      wall(cx, base + fh, cx + fw, base, '#b7a077', '#9c8760');
      roof(12, '#7d5a33', '#8f6a3e');
      // windmill blades
      g.strokeStyle = '#efe6cd'; g.lineWidth = 3;
      const wx = cx, wy = base - wallH - fh - 6;
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + 0.5;
        g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + Math.cos(ang) * 16, wy + Math.sin(ang) * 16); g.stroke();
      }
      g.fillStyle = teamCol; g.beginPath(); g.arc(wx, wy, 3, 0, 7); g.fill();
      break;
    }
    case 'lumbercamp': {
      wall(cx - fw, base, cx, base + fh, '#a8834f', '#8d6c40');
      wall(cx, base + fh, cx + fw, base, '#96733f', '#7d5f36');
      roof(8, '#6c5433', '#7c623c');
      g.fillStyle = '#caa25f'; // log pile
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx + fw * 0.55, base - 4 - i * 5, 4, 0, 7); g.fill(); }
      g.fillStyle = teamCol; g.fillRect(cx - 3, base - wallH + 3, 6, 5);
      break;
    }
    case 'miningcamp': {
      wall(cx - fw, base, cx, base + fh, '#9e9689', '#847d72');
      wall(cx, base + fh, cx + fw, base, '#8d8578', '#746d63');
      roof(8, '#5f584e', '#6e675c');
      g.fillStyle = '#e8c84a';
      g.beginPath(); g.arc(cx + fw * 0.5, base - 5, 4, 0, 7); g.fill();
      g.fillStyle = teamCol; g.fillRect(cx - 3, base - wallH + 3, 6, 5);
      break;
    }
    case 'farm': {
      // flat tilled field
      const rows = 5;
      for (let i = 0; i < rows; i++) {
        const t = i / rows, t2 = (i + 0.6) / rows;
        g.fillStyle = i % 2 ? '#c2a161' : '#a9884e';
        g.beginPath();
        g.moveTo(cx - fw + t * fw, base - fh * t + fh * t);
        // simple horizontal iso strips
        const y0a = base - fh + t * 2 * fh, y0b = base - fh + t2 * 2 * fh;
        isoStrip(g, cx, base, fw, fh, t, t2);
      }
      g.strokeStyle = 'rgba(90,60,20,0.5)'; g.lineWidth = 1.5;
      drawIsoOutline(g, cx, base, fw, fh);
      break;
    }
    case 'barracks': {
      wall(cx - fw, base, cx, base + fh, '#b8a58a', '#9c8a6f');
      wall(cx, base + fh, cx + fw, base, '#a6937a', '#8b7962');
      roof(14, '#6e4a2f', '#7f5737');
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.35, fw * 0.6, 4);
      banner(cx - fw * 0.4, base - wallH - fh);
      break;
    }
    case 'archeryrange': {
      wall(cx - fw, base, cx, base + fh, '#c0ad8b', '#a49270');
      wall(cx, base + fh, cx + fw, base, '#ae9b79', '#93815f');
      roof(12, '#41653a', '#4e7845');
      // target
      g.fillStyle = '#efe6cd'; g.beginPath(); g.arc(cx + fw * 0.55, base - 10, 7, 0, 7); g.fill();
      g.fillStyle = '#c33'; g.beginPath(); g.arc(cx + fw * 0.55, base - 10, 3.5, 0, 7); g.fill();
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.35, fw * 0.6, 4);
      break;
    }
    case 'stable': {
      wall(cx - fw, base, cx, base + fh, '#b3906a', '#987a58');
      wall(cx, base + fh, cx + fw, base, '#a17f5c', '#87694c');
      roof(12, '#7a4626', '#8c522d');
      g.fillStyle = '#5c3a1e'; // stable door
      g.fillRect(cx - fw * 0.45, base - wallH + 6, 14, wallH - 8);
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.3, fw * 0.6, 4);
      break;
    }
    case 'blacksmith': {
      wall(cx - fw, base, cx, base + fh, '#8f8478', '#776d62');
      wall(cx, base + fh, cx + fw, base, '#7e7468', '#665d53');
      roof(10, '#4a443c', '#575046');
      // chimney + glow
      g.fillStyle = '#5b544a'; g.fillRect(cx + fw * 0.25, base - wallH - fh - 12, 7, 14);
      g.fillStyle = '#ff9c3f'; g.fillRect(cx - 4, base - wallH * 0.5, 8, 7);
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.25, fw * 0.6, 4);
      break;
    }
    case 'tower': {
      const th = 46;
      const grad = g.createLinearGradient(0, base - th, 0, base);
      grad.addColorStop(0, '#cfc9bd'); grad.addColorStop(1, '#9d968a');
      g.fillStyle = grad;
      g.fillRect(cx - 11, base - th, 22, th);
      g.fillStyle = '#8b8478';
      for (let i = -1; i <= 1; i++) g.fillRect(cx - 13 + (i + 1) * 9, base - th - 5, 6, 6);
      g.fillStyle = '#443'; g.fillRect(cx - 3, base - th + 12, 6, 9); // arrow slit
      banner(cx, base - th - 4);
      break;
    }
    case 'castle': {
      wall(cx - fw, base, cx, base + fh, '#c9c3b6', '#a29b8d');
      wall(cx, base + fh, cx + fw, base, '#b6b0a3', '#8f887b');
      // crenellations
      g.fillStyle = '#d8d2c5';
      for (let i = 0; i < 7; i++) {
        g.fillRect(cx - fw + i * (fw * 2 / 7) + 2, base - wallH - fh * (1 - Math.abs(i / 3.5 - 1)) - 8, 8, 10);
      }
      // corner towers
      for (const [dx, dy] of [[-fw, 0], [fw, 0], [0, -fh], [0, fh]]) {
        g.fillStyle = '#bdb7aa';
        g.fillRect(cx + dx - 8, base + dy - wallH - 22, 16, wallH + 18);
        g.fillStyle = '#8f887b';
        g.fillRect(cx + dx - 8, base + dy - wallH - 22, 16, 5);
      }
      banner(cx, base - wallH - fh - 22);
      break;
    }
    case 'siegeworkshop': {
      wall(cx - fw, base, cx, base + fh, '#a6947c', '#8b7b64');
      wall(cx, base + fh, cx + fw, base, '#948366', '#7b6c53');
      roof(6, '#5d5142', '#6b5e4d');
      g.strokeStyle = '#4d4335'; g.lineWidth = 3; // big wheel
      g.beginPath(); g.arc(cx + fw * 0.5, base - 10, 9, 0, 7); g.stroke();
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.3, fw * 0.6, 4);
      break;
    }
    case 'monastery': {
      wall(cx - fw, base, cx, base + fh, '#e0d6c0', '#c2b79e');
      wall(cx, base + fh, cx + fw, base, '#d1c6ad', '#b3a88c');
      roof(6, '#8a5a9c', '#784d89');
      // central dome + spire
      g.fillStyle = '#9c6bb0';
      g.beginPath(); g.arc(cx, base - wallH - fh * 0.5, 12, Math.PI, 0); g.fill();
      g.fillRect(cx - 12, base - wallH - fh * 0.5, 24, 4);
      g.strokeStyle = '#ffd98c'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx, base - wallH - fh * 0.5 - 12); g.lineTo(cx, base - wallH - fh * 0.5 - 24); g.stroke();
      g.beginPath(); g.arc(cx, base - wallH - fh * 0.5 - 26, 2.5, 0, 7); g.stroke();
      g.fillStyle = teamCol; g.fillRect(cx - fw * 0.3, base - wallH * 0.35, fw * 0.6, 4);
      break;
    }
    case 'market': {
      wall(cx - fw, base, cx, base + fh, '#d6bd8f', '#b8a077');
      wall(cx, base + fh, cx + fw, base, '#c5ac7e', '#a78f66');
      roof(4, '#b0703a', '#9c6233');
      // striped awnings on the front faces
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          g.fillStyle = i % 2 ? '#e8e4d8' : '#c0483e';
          g.beginPath();
          const ax = cx + side * (fw * 0.15 + i * fw * 0.22), ay = base - wallH * 0.55 + (fw * 0.15 + i * fw * 0.22) * (fh / fw);
          g.moveTo(ax, ay); g.lineTo(ax + side * fw * 0.2, ay + fh * 0.2); g.lineTo(ax + side * fw * 0.2, ay + fh * 0.2 + 7); g.lineTo(ax, ay + 7);
          g.closePath(); g.fill();
        }
      }
      g.fillStyle = teamCol; g.fillRect(cx - 3, base - wallH + 3, 6, 5);
      break;
    }
    case 'stonewall': {
      const grad = g.createLinearGradient(0, base - 26, 0, base);
      grad.addColorStop(0, '#cfc9bd'); grad.addColorStop(1, '#948d81');
      g.fillStyle = grad;
      g.fillRect(cx - 13, base - 24, 26, 24);
      g.fillStyle = '#dad4c8';
      for (let i = 0; i < 3; i++) g.fillRect(cx - 13 + i * 10, base - 29, 6, 6);
      // brick lines
      g.strokeStyle = 'rgba(60,55,48,0.35)'; g.lineWidth = 1;
      for (let yy = 1; yy < 4; yy++) {
        g.beginPath(); g.moveTo(cx - 13, base - 24 + yy * 6); g.lineTo(cx + 13, base - 24 + yy * 6); g.stroke();
      }
      break;
    }
    case 'palisade': {
      g.fillStyle = '#8a6b40';
      for (let i = -1; i <= 1; i++) {
        g.fillRect(cx + i * 8 - 3, base - 22 + Math.abs(i) * 3, 6, 22 - Math.abs(i) * 3);
        g.beginPath(); g.moveTo(cx + i * 8 - 3, base - 22 + Math.abs(i) * 3);
        g.lineTo(cx + i * 8, base - 27 + Math.abs(i) * 3); g.lineTo(cx + i * 8 + 3, base - 22 + Math.abs(i) * 3);
        g.closePath(); g.fill();
      }
      break;
    }
  }

  function isoStrip(g, cx, base, fw, fh, t0, t1) {
    // strip between fractions t0..t1 across the diamond (top to bottom)
    const pt = (t) => {
      if (t <= 0.5) { const k = t * 2; return [[cx - fw * k, base - fh + fh * k], [cx + fw * k, base - fh + fh * k]]; }
      const k = (t - 0.5) * 2; return [[cx - fw * (1 - k), base + fh * k], [cx + fw * (1 - k), base + fh * k]];
    };
    const [a0, b0] = pt(t0), [a1, b1] = pt(t1);
    g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.lineTo(a1[0], a1[1]); g.closePath(); g.fill();
  }
  function drawIsoOutline(g, cx, base, fw, fh) {
    g.beginPath(); g.moveTo(cx, base - fh); g.lineTo(cx + fw, base); g.lineTo(cx, base + fh); g.lineTo(cx - fw, base); g.closePath(); g.stroke();
  }
}

// ---------- resource sprites ----------
function resSprite(rtype, variant) {
  return cached(`r_${rtype}_${variant}`, TW2 * 2, 96, (g, w, h) => {
    const cx = w / 2, base = h - TH2;
    const rng = mulberry32(variant * 991 + 17);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(cx, base, 13, 6, 0, 0, 7); g.fill();
    if (rtype === 'tree') {
      g.fillStyle = '#6b4a2a';
      g.fillRect(cx - 2.5, base - 22, 5, 22);
      const gr = ['#2e6b33', '#357a3a', '#3d8a42'];
      for (let i = 0; i < 3; i++) {
        g.fillStyle = gr[i];
        g.beginPath();
        g.moveTo(cx, base - 58 + i * 12);
        g.lineTo(cx + 15 - i * 2.5, base - 24 + i * 8);
        g.lineTo(cx - 15 + i * 2.5, base - 24 + i * 8);
        g.closePath(); g.fill();
      }
    } else if (rtype === 'gold' || rtype === 'stone') {
      const cols = rtype === 'gold' ? ['#8f8353', '#7d7248'] : ['#8d8d8d', '#797979'];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = cols[i % 2];
        const x = cx - 10 + rng() * 20, y = base - 4 - rng() * 6, r = 5 + rng() * 5;
        g.beginPath();
        g.moveTo(x - r, y); g.lineTo(x - r * 0.4, y - r); g.lineTo(x + r * 0.5, y - r * 0.8); g.lineTo(x + r, y);
        g.closePath(); g.fill();
      }
      if (rtype === 'gold') {
        g.fillStyle = '#f7d94c';
        for (let i = 0; i < 5; i++) g.fillRect(cx - 9 + rng() * 18, base - 12 + rng() * 8, 2.5, 2.5);
      }
    } else if (rtype === 'berry') {
      g.fillStyle = '#3f7d3b';
      g.beginPath(); g.ellipse(cx, base - 7, 13, 9, 0, 0, 7); g.fill();
      g.fillStyle = '#356b32';
      g.beginPath(); g.ellipse(cx - 5, base - 10, 7, 5, 0, 0, 7); g.fill();
      g.fillStyle = '#c8385a';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(cx - 9 + rng() * 18, base - 11 + rng() * 8, 1.8, 0, 7); g.fill(); }
    }
  });
}

// ---------- unit drawing (direct, cheap shapes) ----------
function drawUnit(g, u, px, py, z) {
  const d = UNITS[u.type];
  const col = G.players[u.owner].color;
  const s = z; // scale
  const bob = (u.task !== 'idle' && u.moved) ? Math.sin(G.time * 12 + u.id) * 1.2 * s : 0;
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(px, py, 7 * s, 3.2 * s, 0, 0, 7); g.fill();

  if (d.cls === 'monk') {
    // robed figure, team-colored sash, staff
    g.fillStyle = '#4a3f33';
    g.beginPath();
    g.moveTo(px - 5 * s, py); g.lineTo(px - 3.5 * s, py - 13 * s + bob); g.lineTo(px + 3.5 * s, py - 13 * s + bob); g.lineTo(px + 5 * s, py);
    g.closePath(); g.fill();
    g.fillStyle = col;
    g.fillRect(px - 4 * s, py - 8 * s + bob, 8 * s, 2.5 * s);
    g.fillStyle = '#e8c39c';
    g.beginPath(); g.arc(px, py - 15 * s + bob, 3 * s, 0, 7); g.fill();
    g.fillStyle = '#4a3f33'; // hood
    g.beginPath(); g.arc(px, py - 16 * s + bob, 3.2 * s, Math.PI * 1.1, Math.PI * 1.9); g.fill();
    g.strokeStyle = '#9c7a4a'; g.lineWidth = 1.6 * s; // staff
    g.beginPath(); g.moveTo(px + 5 * s, py); g.lineTo(px + 5 * s, py - 17 * s + bob); g.stroke();
    g.fillStyle = '#ffd98c';
    g.beginPath(); g.arc(px + 5 * s, py - 18 * s + bob, 1.8 * s, 0, 7); g.fill();
    // chanting sparkle while converting
    if (u.chant > 0) {
      g.fillStyle = `rgba(255,230,140,${0.4 + 0.4 * Math.sin(G.time * 10)})`;
      g.beginPath(); g.arc(px, py - 22 * s, 2.2 * s, 0, 7); g.fill();
    }
    return;
  }
  if (d.cls === 'siege') {
    if (u.type === 'trebuchet') {
      // A-frame base, long throwing arm with counterweight
      g.fillStyle = '#6b5738';
      g.fillRect(px - 11 * s, py - 5 * s, 22 * s, 4 * s);
      g.strokeStyle = '#54432a'; g.lineWidth = 2.6 * s;
      g.beginPath(); g.moveTo(px - 7 * s, py - 3 * s); g.lineTo(px, py - 16 * s); g.lineTo(px + 7 * s, py - 3 * s); g.stroke();
      // arm
      g.lineWidth = 2.2 * s;
      g.beginPath(); g.moveTo(px - 9 * s, py - 24 * s); g.lineTo(px + 6 * s, py - 12 * s); g.stroke();
      g.fillStyle = '#3f3524'; // counterweight
      g.fillRect(px + 4 * s, py - 13 * s, 6 * s, 6 * s);
      g.strokeStyle = '#8a7a5a'; g.lineWidth = 1.2 * s; // sling rope
      g.beginPath(); g.moveTo(px - 9 * s, py - 24 * s); g.lineTo(px - 12 * s, py - 16 * s); g.stroke();
      g.fillStyle = col; g.fillRect(px - 11 * s, py - 8 * s, 4 * s, 3 * s);
      return;
    }
    if (u.type === 'ram') {
      g.fillStyle = '#7a5c36';
      g.fillRect(px - 10 * s, py - 12 * s + bob, 20 * s, 8 * s);
      g.fillStyle = '#94744a';
      g.beginPath(); g.moveTo(px - 11 * s, py - 12 * s + bob); g.lineTo(px, py - 18 * s + bob); g.lineTo(px + 11 * s, py - 12 * s + bob); g.closePath(); g.fill();
      g.fillStyle = '#4d4335';
      for (const dx of [-6, 0, 6]) { g.beginPath(); g.arc(px + dx * s, py - 3 * s, 2.6 * s, 0, 7); g.fill(); }
      g.fillStyle = col; g.fillRect(px - 3 * s, py - 21 * s + bob, 6 * s, 3 * s);
    } else { // mangonel
      g.fillStyle = '#6b5738';
      g.fillRect(px - 8 * s, py - 8 * s, 16 * s, 5 * s);
      g.strokeStyle = '#54432a'; g.lineWidth = 2.4 * s;
      g.beginPath(); g.moveTo(px - 4 * s, py - 7 * s); g.lineTo(px + 5 * s, py - 18 * s); g.stroke();
      g.fillStyle = '#3f3524'; g.beginPath(); g.arc(px + 5 * s, py - 18 * s, 3 * s, 0, 7); g.fill();
      g.fillStyle = '#4d4335';
      for (const dx of [-6, 6]) { g.beginPath(); g.arc(px + dx * s, py - 3 * s, 2.8 * s, 0, 7); g.fill(); }
      g.fillStyle = col; g.fillRect(px - 8 * s, py - 10 * s, 4 * s, 3 * s);
    }
    return;
  }

  const mounted = d.cls === 'cav';
  if (mounted) {
    // horse body
    g.fillStyle = u.type === 'scout' ? '#8a6b47' : '#5c4a3a';
    g.beginPath(); g.ellipse(px, py - 6 * s + bob * 0.5, 9 * s, 4.5 * s, 0, 0, 7); g.fill();
    // head
    const hx = px + Math.cos(u.dir) * 8 * s;
    g.beginPath(); g.ellipse(hx, py - 9 * s + bob * 0.5, 3.4 * s, 2.6 * s, 0, 0, 7); g.fill();
    // legs
    g.strokeStyle = '#4a3b2e'; g.lineWidth = 1.6 * s;
    for (const dx of [-6, -2, 2, 6]) {
      g.beginPath(); g.moveTo(px + dx * s, py - 4 * s); g.lineTo(px + dx * s + (u.moved ? Math.sin(G.time * 14 + dx) * 2 * s : 0), py); g.stroke();
    }
  }
  const by = mounted ? py - 12 * s + bob * 0.5 : py + bob;
  // body
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(px, by - 7 * s, 4 * s, 5.5 * s, 0, 0, 7);
  g.fill();
  if (!mounted) {
    // legs
    g.strokeStyle = 'rgba(30,30,30,0.85)'; g.lineWidth = 2 * s;
    const lp = u.moved && u.task !== 'idle' ? Math.sin(G.time * 13 + u.id) * 2.4 * s : 0;
    g.beginPath(); g.moveTo(px - 1.5 * s, by - 3 * s); g.lineTo(px - 1.5 * s - lp, py); g.stroke();
    g.beginPath(); g.moveTo(px + 1.5 * s, by - 3 * s); g.lineTo(px + 1.5 * s + lp, py); g.stroke();
  }
  // head
  g.fillStyle = '#e8c39c';
  g.beginPath(); g.arc(px, by - 14 * s, 3 * s, 0, 7); g.fill();
  // helmet/hat by class
  if (d.cls === 'inf' || u.type === 'knight' || u.type === 'guard') {
    g.fillStyle = '#b9c0c9';
    g.beginPath(); g.arc(px, by - 15 * s, 3 * s, Math.PI, 0); g.fill();
  } else if (d.cls === 'arch') {
    g.fillStyle = '#5c6e3c';
    g.beginPath(); g.arc(px, by - 15.5 * s, 3 * s, Math.PI, 0); g.fill();
  } else if (d.cls === 'vill') {
    g.fillStyle = '#8a6b47';
    g.fillRect(px - 3 * s, by - 17 * s, 6 * s, 2 * s);
  }
  // weapon
  const wx = px + Math.cos(u.dir) * 5 * s, wy = by - 8 * s;
  g.strokeStyle = '#d9d9d9'; g.lineWidth = 1.6 * s;
  if (u.type === 'militia' || u.type === 'guard' || u.type === 'knight') {
    g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + Math.cos(u.dir - 0.6) * 7 * s, wy - 7 * s); g.stroke();
  } else if (u.type === 'spearman') {
    g.strokeStyle = '#9c7a4a';
    g.beginPath(); g.moveTo(wx - 3 * s, wy + 4 * s); g.lineTo(wx + 4 * s, wy - 10 * s); g.stroke();
  } else if (d.cls === 'arch') {
    g.strokeStyle = '#8a6b40';
    g.beginPath(); g.arc(wx, wy, 4.5 * s, u.dir - 1.2, u.dir + 1.2); g.stroke();
  } else if (d.cls === 'vill' && (u.task === 'gather' || u.task === 'build' || u.task === 'farm')) {
    g.strokeStyle = '#9c7a4a';
    const swing = Math.sin(G.time * 9 + u.id) * 0.8;
    g.beginPath(); g.moveTo(wx, wy + 2 * s); g.lineTo(wx + Math.cos(swing) * 6 * s, wy - Math.abs(Math.sin(swing)) * 7 * s); g.stroke();
  }
  // carrying indicator
  if (u.carry >= 1) {
    g.fillStyle = { wood: '#9c7a4a', food: '#d0405e', gold: '#f0cf46', stone: '#a5a5a5' }[u.carryType] || '#fff';
    g.fillRect(px - 2.5 * s, by - 3.5 * s, 5 * s, 3.5 * s);
  }
}

// ---------- main scene ----------
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, viewW, viewH);
  if (!G) return;
  const z = cam.zoom;

  // visible tile bounds from screen corners
  const corners = [screenToWorld(0, 0), screenToWorld(viewW, 0), screenToWorld(0, viewH), screenToWorld(viewW, viewH)];
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0]))) - 2);
  const maxX = Math.min(MAP_W - 1, Math.ceil(Math.max(...corners.map(c => c[0]))) + 2);
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1]))) - 2);
  const maxY = Math.min(MAP_H - 1, Math.ceil(Math.max(...corners.map(c => c[1]))) + 2);

  const tw = TW2 * 2 * z + 2, th = TH2 * 2 * z + 2;
  // terrain + fog
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const i = tIdx(tx, ty);
      const [px, py] = worldToScreen(tx + 0.5, ty + 0.5);
      if (px < -tw || px > viewW + tw || py < -th || py > viewH + th) continue;
      if (!G.explored[i]) {
        ctx.fillStyle = '#0b0e12';
        diamondPath(ctx, px, py, TW2 * z + 1, TH2 * z + 1);
        ctx.fill();
        continue;
      }
      ctx.drawImage(tileSprite(G.map.terr[i]), px - TW2 * z - 1, py - TH2 * z - 1, tw, th);
      if (!G.visible[i]) {
        ctx.fillStyle = 'rgba(8,10,16,0.45)';
        diamondPath(ctx, px, py, TW2 * z + 1, TH2 * z + 1);
        ctx.fill();
      }
    }
  }

  // placement ghost (under entities)
  if (UI.placing) drawPlacementGhost();

  // draw entities in iso depth order
  const drawList = [];
  for (const r of G.resources) {
    if (r.tx < minX - 1 || r.tx > maxX || r.ty < minY - 1 || r.ty > maxY) continue;
    if (!G.explored[tIdx(r.tx, r.ty)]) continue;
    drawList.push({ z: r.tx + r.ty, kind: 'res', e: r });
  }
  for (const b of G.buildings) {
    const bx = b.tx + b.size / 2, by = b.ty + b.size / 2;
    if (bx < minX - 4 || bx > maxX + 4 || by < minY - 4 || by > maxY + 4) continue;
    if (b.owner !== 0 && !tileExplored(bx, by)) continue;
    drawList.push({ z: b.tx + b.ty + b.size * 2 - 1, kind: 'bldg', e: b });
  }
  for (const u of G.units) {
    if (u.x < minX - 1 || u.x > maxX + 1 || u.y < minY - 1 || u.y > maxY + 1) continue;
    if (u.owner !== 0 && !tileVisible(u.x, u.y)) continue;
    drawList.push({ z: u.x + u.y + 0.6, kind: 'unit', e: u });
  }
  for (const fx of G.effects) drawList.push({ z: fx.x + fx.y + 0.7, kind: 'fx', e: fx });
  drawList.sort((a, b) => a.z - b.z);

  for (const item of drawList) {
    const e = item.e;
    if (item.kind === 'res') {
      const [px, py] = worldToScreen(e.tx + 0.5, e.ty + 0.5);
      const spr = resSprite(e.rtype, e.id % 7);
      const w = spr.width / 2 * z, h = spr.height / 2 * z;
      ctx.drawImage(spr, px - w / 2, py - h + TH2 * z, w, h);
    } else if (item.kind === 'bldg') {
      drawBuilding(e, z);
    } else if (item.kind === 'unit') {
      const [px, py] = worldToScreen(e.x, e.y);
      if (UI.selection.includes(e)) {
        ctx.strokeStyle = '#e8f7e0'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(px, py, 9 * z, 4.5 * z, 0, 0, 7); ctx.stroke();
      }
      drawUnit(ctx, e, px, py, z * 0.95);
      e.moved = false;
      if (e.hp < e.maxhp || UI.selection.includes(e)) drawHpBar(px, py - 24 * z, 22 * z, e.hp / e.maxhp);
    } else drawEffect(e, z);
  }

  // projectiles
  for (const p of G.projectiles) {
    if (!tileVisible(p.x, p.y) && !tileVisible(p.gx, p.gy)) continue;
    const [px, py] = worldToScreen(p.x, p.y);
    const arc = Math.sin(Math.min(1, p.t * p.speed / Math.max(1, Math.hypot(p.gx - p.sx, p.gy - p.sy))) * Math.PI) * 14 * z;
    ctx.strokeStyle = p.splash ? '#333' : '#e8dcc0';
    ctx.lineWidth = p.splash ? 4 * z : 1.5 * z;
    const ang = Math.atan2(p.gy - p.y, p.gx - p.x);
    ctx.beginPath();
    if (p.splash) { ctx.arc(px, py - arc, 2.5 * z, 0, 7); ctx.stroke(); }
    else {
      ctx.moveTo(px - Math.cos(ang) * 5 * z, py - arc - Math.sin(ang) * 2);
      ctx.lineTo(px + Math.cos(ang) * 5 * z, py - arc + Math.sin(ang) * 2);
      ctx.stroke();
    }
  }

  // selection drag box
  if (UI.dragBox) {
    ctx.strokeStyle = 'rgba(220,255,220,0.9)'; ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(120,220,120,0.12)';
    const b = UI.dragBox;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }

  renderMinimap();
}

function diamondPath(g, px, py, wz, hz) {
  g.beginPath();
  g.moveTo(px, py - hz); g.lineTo(px + wz, py); g.lineTo(px, py + hz); g.lineTo(px - wz, py);
  g.closePath();
}

function drawBuilding(b, z) {
  const d = BUILDINGS[b.type];
  const [px, py] = worldToScreen(b.tx + b.size / 2, b.ty + b.size / 2);
  const spr = buildingSprite(b.type, b.owner, b.done);
  // sprite css size; its diamond center sits at y = cssH - (size+1)*TH2 within the sprite
  const cssW = spr.width / 2, cssH = spr.height / 2;
  const baseY = cssH - (b.size + 1) * TH2;
  ctx.drawImage(spr, px - cssW / 2 * z, py - baseY * z, cssW * z, cssH * z);
  if (UI.selection.includes(b)) {
    ctx.strokeStyle = '#e8f7e0'; ctx.lineWidth = 2;
    diamondPath(ctx, px, py, b.size * TW2 * z, b.size * TH2 * z);
    ctx.stroke();
    if (b.rally) {
      const [rx, ry] = worldToScreen(b.rally.x, b.rally.y);
      ctx.strokeStyle = 'rgba(255,255,120,0.8)';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(rx - 1.5, ry - 14, 3, 14);
      ctx.beginPath(); ctx.moveTo(rx + 1.5, ry - 14); ctx.lineTo(rx + 11, ry - 10.5); ctx.lineTo(rx + 1.5, ry - 7); ctx.closePath(); ctx.fill();
    }
  }
  if (!b.done) {
    drawHpBar(px, py - b.size * TH2 * z - 8, b.size * 18 * z, b.progress / d.time, '#e8d44d');
  } else if (b.hp < b.maxhp || UI.selection.includes(b)) {
    drawHpBar(px, py - b.size * TH2 * z - 8, b.size * 18 * z, b.hp / b.maxhp);
  }
  // farm food indicator when selected
  if (b.type === 'farm' && b.done && UI.selection.includes(b)) {
    drawHpBar(px, py - 16, 30 * z, b.farmFood / BUILDINGS.farm.farmFood, '#d0a53f');
  }
}

function drawHpBar(px, py, w, frac, color) {
  frac = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(px - w / 2 - 1, py - 1, w + 2, 5);
  ctx.fillStyle = color || (frac > 0.6 ? '#5fd35f' : frac > 0.3 ? '#e8d44d' : '#e05252');
  ctx.fillRect(px - w / 2, py, w * frac, 3);
}

function drawEffect(fx, z) {
  const [px, py] = worldToScreen(fx.x, fx.y);
  if (fx.kind === 'hit') {
    ctx.strokeStyle = fx.color || `rgba(255,240,180,${fx.t / 0.18})`;
    ctx.globalAlpha = Math.min(1, fx.t / 0.18);
    ctx.lineWidth = 2;
    const r = (0.2 - fx.t) * 60 * z;
    ctx.beginPath(); ctx.arc(px, py - 8 * z, Math.max(1, r), 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (fx.kind === 'boom') {
    ctx.fillStyle = `rgba(255,${140 + fx.t * 200 | 0},60,${fx.t / 0.4 * 0.8})`;
    ctx.beginPath(); ctx.arc(px, py, (0.5 - fx.t) * 50 * z, 0, 7); ctx.fill();
  } else if (fx.kind === 'die') {
    ctx.fillStyle = `rgba(60,30,20,${fx.t})`;
    ctx.beginPath(); ctx.ellipse(px, py, 8 * z * (1 - fx.t * 0.5), 4 * z * (1 - fx.t * 0.5), 0, 0, 7); ctx.fill();
  } else if (fx.kind === 'convert') {
    ctx.strokeStyle = `rgba(255,220,120,${fx.t})`;
    ctx.lineWidth = 2.5;
    const r = (0.9 - fx.t) * 30 * z;
    ctx.beginPath(); ctx.arc(px, py - 8 * z, Math.max(2, r), 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py - 8 * z, Math.max(1, r * 0.55), 0, 7); ctx.stroke();
  } else if (fx.kind === 'heal') {
    ctx.fillStyle = `rgba(140,255,160,${fx.t * 1.4})`;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + fx.t * 6;
      ctx.fillRect(px + Math.cos(a) * 6 * z - 1, py - 14 * z - (0.5 - fx.t) * 20 * z + Math.sin(a) * 3, 2.5, 2.5);
    }
  } else if (fx.kind === 'rubble') {
    ctx.fillStyle = `rgba(70,60,50,${Math.min(0.8, fx.t / 4)})`;
    const s = fx.size * TW2 * 0.7 * z;
    ctx.beginPath(); ctx.ellipse(px, py, s, s / 2, 0, 0, 7); ctx.fill();
  }
}

function drawPlacementGhost() {
  const p = UI.placing;
  const d = BUILDINGS[p.type];
  const ok = canPlace(p.type, p.tx, p.ty);
  const z = cam.zoom;
  for (let y = p.ty; y < p.ty + d.size; y++) for (let x = p.tx; x < p.tx + d.size; x++) {
    const [px, py] = worldToScreen(x + 0.5, y + 0.5);
    ctx.fillStyle = ok ? 'rgba(90,220,90,0.35)' : 'rgba(230,70,70,0.4)';
    diamondPath(ctx, px, py, TW2 * z, TH2 * z);
    ctx.fill();
  }
  ctx.globalAlpha = 0.65;
  const fake = { tx: p.tx, ty: p.ty, size: d.size, type: p.type, owner: 0, done: true, hp: 1, maxhp: 1, rally: null };
  drawBuilding(fake, z);
  ctx.globalAlpha = 1;
}

// ---------- minimap ----------
let mmCanvas, mmCtx, mmDirty = 0;
function initMinimap() {
  mmCanvas = document.getElementById('minimap');
  mmCtx = mmCanvas.getContext('2d');
  mmCanvas.width = 132; mmCanvas.height = 132;
}
const MM_COL = { [T_GRASS]: '#4c7a3d', [T_GRASS2]: '#457038', [T_DIRT]: '#8a7550', [T_WATER]: '#2d61a3', [T_SAND]: '#b3a069' };
function renderMinimap() {
  mmDirty -= 1;
  if (mmDirty > 0) return;
  mmDirty = 12; // every ~12 frames
  const W = mmCanvas.width, H = mmCanvas.height;
  const sc = W / (MAP_W + MAP_H) * 2;
  mmCtx.fillStyle = '#0a0d11';
  mmCtx.fillRect(0, 0, W, H);
  // iso-projected minimap: mx=(x-y), my=(x+y)
  const img = mmCtx;
  const px = (x, y) => [(x - y + MAP_H) / (MAP_W + MAP_H) * W, (x + y) / (MAP_W + MAP_H) * H];
  const step = 1;
  for (let y = 0; y < MAP_H; y += step) for (let x = 0; x < MAP_W; x += step) {
    const i = tIdx(x, y);
    if (!G.explored[i]) continue;
    const r = G.map.res[i];
    img.fillStyle = r ? (r.rtype === 'tree' ? '#2c5426' : r.rtype === 'gold' ? '#e3c33f' : r.rtype === 'stone' ? '#9a9a9a' : '#b0405a')
      : MM_COL[G.map.terr[i]];
    const [mx, my] = px(x, y);
    img.fillRect(mx, my, 2.2, 1.4);
    if (!G.visible[i]) { img.fillStyle = 'rgba(0,0,0,0.4)'; img.fillRect(mx, my, 2.2, 1.4); }
  }
  for (const b of G.buildings) {
    if (b.owner !== 0 && !tileExplored(b.tx + 1, b.ty + 1)) continue;
    img.fillStyle = G.players[b.owner].color;
    const [mx, my] = px(b.tx, b.ty);
    img.fillRect(mx - 1, my - 1, Math.max(3, b.size * 1.6), Math.max(3, b.size * 1.2));
  }
  for (const u of G.units) {
    if (u.owner !== 0 && !tileVisible(u.x, u.y)) continue;
    img.fillStyle = u.owner === 0 ? '#9cc4ff' : '#ff9c9c';
    const [mx, my] = px(u.x, u.y);
    img.fillRect(mx, my, 2, 2);
  }
  // viewport rect
  const c0 = screenToWorld(0, 0), c1 = screenToWorld(viewW, 0), c2 = screenToWorld(viewW, viewH), c3 = screenToWorld(0, viewH);
  img.strokeStyle = 'rgba(255,255,255,0.75)'; img.lineWidth = 1;
  img.beginPath();
  const pts = [c0, c1, c2, c3].map(c => px(c[0], c[1]));
  img.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) img.lineTo(pts[i][0], pts[i][1]);
  img.closePath(); img.stroke();
}
function minimapToWorld(mx, my) {
  const W = mmCanvas.clientWidth, H = mmCanvas.clientHeight;
  const a = mx / W * (MAP_W + MAP_H) - MAP_H; // x - y
  const b = my / H * (MAP_W + MAP_H);         // x + y
  return [(a + b) / 2, (b - a) / 2];
}
