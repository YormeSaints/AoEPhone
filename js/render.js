'use strict';
// ============================================================
// Isometric renderer. All art is procedural (canvas-drawn) —
// original assets, no external images. Styled after classic
// age-of-empires-era RTS art: mottled terrain with blended
// edges, animated water, timber/stone buildings, cast shadows.
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

function diamondPath(g, px, py, wz, hz) {
  g.beginPath();
  g.moveTo(px, py - hz); g.lineTo(px + wz, py); g.lineTo(px, py + hz); g.lineTo(px - wz, py);
  g.closePath();
}

// ---------- terrain ----------
// Rich mottled tiles, several variants each, with soft cross-blended edges
// and animated water — the classic RTS ground look.
const TERRAIN_PRIO = { [T_WATER]: 0, [T_SAND]: 1, [T_DIRT]: 2, [T_GRASS2]: 3, [T_GRASS]: 4 };
const TERRAIN_BASE = {
  [T_GRASS]: '#5c9445', [T_GRASS2]: '#4e8a3c', [T_DIRT]: '#b0925c',
  [T_SAND]: '#d5c283', [T_WATER]: '#2f74ba',
};

function tileSprite(t, variant, frame) {
  return cached(`tile${t}_${variant}_${frame || 0}`, TW2 * 2 + 2, TH2 * 2 + 2, (g, w, h) => {
    const rng = mulberry32(t * 7717 + variant * 131 + 7);
    diamondPath(g, w / 2, h / 2, w / 2, h / 2);
    g.save();
    g.clip();
    if (t === T_WATER) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#3a7ec8'); grad.addColorStop(1, '#2a66a8');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // depth mottling
      for (let i = 0; i < 10; i++) {
        g.fillStyle = rng() < 0.5 ? 'rgba(20,60,120,0.18)' : 'rgba(90,160,220,0.14)';
        g.beginPath(); g.ellipse(rng() * w, rng() * h, 4 + rng() * 7, 2 + rng() * 3, 0, 0, 7); g.fill();
      }
      // animated wave glints (3 frames slide the highlights)
      const off = (frame || 0) * w / 6;
      g.strokeStyle = 'rgba(210,235,255,0.35)'; g.lineWidth = 1.1;
      for (let i = 0; i < 4; i++) {
        const y = 4 + i * (h / 4) + (rng() - 0.5) * 3;
        const x = ((rng() * w + off) % w);
        g.beginPath();
        g.moveTo(x - 6, y); g.quadraticCurveTo(x, y - 1.6, x + 6, y);
        g.stroke();
      }
    } else {
      const pal = {
        [T_GRASS]: ['#619a49', '#558c40', '#6ba650', '#47793a', '#77b258'],
        [T_GRASS2]: ['#528e3f', '#477f37', '#5b9a46', '#3e6f31', '#63a24c'],
        [T_DIRT]: ['#b5975f', '#a58955', '#c2a469', '#93794a', '#c9ad74'],
        [T_SAND]: ['#d8c584', '#cab774', '#e2d093', '#bcaa69', '#e8d89f'],
      }[t];
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, pal[0]); grad.addColorStop(1, pal[1]);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // heavy speckled mottling
      for (let i = 0; i < 46; i++) {
        g.fillStyle = pal[2 + (rng() * 3 | 0)];
        g.globalAlpha = 0.22 + rng() * 0.3;
        const x = rng() * w, y = rng() * h;
        g.fillRect(x, y, 1.4 + rng() * 2.2, 1 + rng() * 1.6);
      }
      g.globalAlpha = 1;
      if (t === T_GRASS || t === T_GRASS2) {
        // grass tufts
        g.strokeStyle = 'rgba(38,72,30,0.5)'; g.lineWidth = 0.9;
        for (let i = 0; i < 5; i++) {
          const x = 6 + rng() * (w - 12), y = 6 + rng() * (h - 12);
          for (let b = -1; b <= 1; b++) {
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + b * 1.6, y - 2.6 - rng() * 1.4); g.stroke();
          }
        }
        // occasional tiny flowers
        if (rng() < 0.3) {
          g.fillStyle = rng() < 0.5 ? '#e8e094' : '#e0e8f0';
          g.fillRect(4 + rng() * (w - 8), 4 + rng() * (h - 8), 1.6, 1.6);
        }
      } else if (t === T_DIRT) {
        // pebbles
        for (let i = 0; i < 4; i++) {
          g.fillStyle = 'rgba(90,72,45,0.5)';
          g.beginPath(); g.arc(4 + rng() * (w - 8), 4 + rng() * (h - 8), 0.9 + rng(), 0, 7); g.fill();
        }
      }
    }
    g.restore();
  });
}

// blended edge fringes: a soft gradient of the higher-priority terrain
// bleeding over its lower neighbor. dir: 0 up-left, 1 up-right, 2 down-right, 3 down-left
function fringeSprite(t, dir) {
  return cached(`fr_${t}_${dir}`, TW2 * 2 + 2, TH2 * 2 + 2, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const mids = [[cx / 2, cy / 2], [cx * 1.5, cy / 2], [cx * 1.5, cy * 1.5], [cx / 2, cy * 1.5]];
    const [ex, ey] = mids[dir];
    const grad = g.createLinearGradient(ex, ey, cx, cy);
    const col = TERRAIN_BASE[t];
    grad.addColorStop(0, col + 'd8');
    grad.addColorStop(0.72, col + '00');
    diamondPath(g, cx, cy, cx, cy);
    g.fillStyle = grad;
    g.fill();
  });
}
// white foam on the water side of a shoreline
function foamSprite(dir) {
  return cached(`foam_${dir}`, TW2 * 2 + 2, TH2 * 2 + 2, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const mids = [[cx / 2, cy / 2], [cx * 1.5, cy / 2], [cx * 1.5, cy * 1.5], [cx / 2, cy * 1.5]];
    const [ex, ey] = mids[dir];
    const grad = g.createLinearGradient(ex, ey, cx, cy);
    grad.addColorStop(0, 'rgba(240,250,255,0.6)');
    grad.addColorStop(0.35, 'rgba(240,250,255,0)');
    diamondPath(g, cx, cy, cx, cy);
    g.fillStyle = grad;
    g.fill();
  });
}
const FRINGE_DIRS = [[-1, 0], [0, -1], [1, 0], [0, 1]];

// ---------- building sprites ----------
function buildingSprite(type, owner, done) {
  const key = `b_${type}_${owner}_${done ? 1 : 0}`;
  const d = BUILDINGS[type];
  const s = d.size;
  const w = (s + 1) * TW2 * 2, h = (s + 1) * TH2 * 2 + 78;
  return cached(key, w, h, (g) => {
    const cx = w / 2, base = h - (s + 1) * TH2;
    const col = G ? G.players[owner].color : '#888';
    drawBuildingArt(g, type, s, cx, base, col, done);
  });
}

function drawBuildingArt(g, type, s, cx, base, teamCol, done) {
  const fw = s * TW2, fh = s * TH2; // footprint half-extents
  const rng = mulberry32(s * 977 + type.length * 131);

  // soft cast shadow, offset to the lower-right (sun from upper-left)
  g.fillStyle = 'rgba(15,20,10,0.28)';
  g.beginPath();
  g.ellipse(cx + fw * 0.12, base + fh * 0.12, fw * 1.02, fh * 0.86, 0, 0, 7);
  g.fill();

  if (!done) { // construction site: staked-out foundation + timber frame
    g.fillStyle = 'rgba(150,120,75,0.45)';
    diamondPath(g, cx, base, fw, fh); g.fill();
    g.strokeStyle = '#7c5f38'; g.lineWidth = 2.2;
    for (let i = 0; i < s * 2; i++) {
      const t = (i + 0.5) / (s * 2);
      const px = cx - fw + t * fw * 2;
      g.beginPath(); g.moveTo(px, base); g.lineTo(px, base - 16 - 9 * s); g.stroke();
    }
    g.strokeStyle = '#93744a';
    g.beginPath(); g.moveTo(cx - fw * 0.7, base - 18 - 9 * s); g.lineTo(cx + fw * 0.7, base - 18 - 9 * s); g.stroke();
    g.beginPath(); g.moveTo(cx - fw * 0.55, base - 6); g.lineTo(cx + fw * 0.4, base - 24 - 6 * s); g.stroke();
    return;
  }

  const wallH = 16 + s * 10;
  const wtL = base - wallH;                       // wall-top at left corner

  // ---- texture helpers ----
  // wall quad from (x0,y0) to (x1,y1) rising wallH. left=true → lit face.
  const wallQuad = (x0, y0, x1, y1, top, bot) => {
    const grad = g.createLinearGradient(0, y0 - wallH, 0, Math.max(y0, y1));
    grad.addColorStop(0, top); grad.addColorStop(1, bot);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, y1 - wallH); g.lineTo(x0, y0 - wallH);
    g.closePath(); g.fill();
  };
  const slopeLine = (x0, y0, x1, y1, off, col, lw) => {
    g.strokeStyle = col; g.lineWidth = lw || 1;
    g.beginPath(); g.moveTo(x0, y0 + off); g.lineTo(x1, y1 + off); g.stroke();
  };
  // stone courses over a wall quad
  const stoneCourses = (x0, y0, x1, y1, tone) => {
    const rows = Math.max(3, wallH / 5 | 0);
    for (let i = 1; i < rows; i++) {
      slopeLine(x0, y0, x1, y1, -wallH * i / rows, tone, 0.8);
    }
    // staggered joints
    g.strokeStyle = tone;
    for (let i = 0; i < rows * 2; i++) {
      const t = rng(), row = (rng() * rows) | 0;
      const jx = x0 + (x1 - x0) * t, jy = y0 + (y1 - y0) * t - wallH * row / rows;
      g.beginPath(); g.moveTo(jx, jy); g.lineTo(jx, jy - wallH / rows * 0.9); g.stroke();
    }
  };
  // half-timbered framing on a plaster wall
  const timberFrame = (x0, y0, x1, y1, dark) => {
    g.strokeStyle = dark; g.lineWidth = 2.2;
    slopeLine(x0, y0, x1, y1, -2, dark, 2.4);
    slopeLine(x0, y0, x1, y1, -wallH + 2, dark, 2.4);
    const n = Math.max(2, s + 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      g.beginPath(); g.moveTo(px, py - 1); g.lineTo(px, py - wallH + 1); g.stroke();
    }
    // one diagonal brace
    const t0 = 0.1, t1 = 0.9 / n + 0.1;
    g.beginPath();
    g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 - 3);
    g.lineTo(x0 + (x1 - x0) * (t0 + 1 / n), y0 + (y1 - y0) * (t0 + 1 / n) - wallH + 3);
    g.stroke();
  };
  // ambient occlusion strip where wall meets ground
  const baseAO = (x0, y0, x1, y1) => {
    const grad = g.createLinearGradient(0, Math.min(y0, y1) - 6, 0, Math.max(y0, y1) + 1);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, y1 - 6); g.lineTo(x0, y0 - 6);
    g.closePath(); g.fill();
  };
  // front-left + front-right walls with a texture style
  const walls = (style, litTop, litBot, darkTop, darkBot, lineTone) => {
    wallQuad(cx - fw, base, cx, base + fh, litTop, litBot);
    wallQuad(cx, base + fh, cx + fw, base, darkTop, darkBot);
    if (style === 'stone') {
      stoneCourses(cx - fw, base, cx, base + fh, lineTone);
      stoneCourses(cx, base + fh, cx + fw, base, lineTone);
    } else if (style === 'timber') {
      timberFrame(cx - fw, base, cx, base + fh, lineTone);
      timberFrame(cx, base + fh, cx + fw, base, lineTone);
    } else if (style === 'plank') {
      const rows = Math.max(3, wallH / 6 | 0);
      for (let i = 1; i < rows; i++) {
        slopeLine(cx - fw, base, cx, base + fh, -wallH * i / rows, lineTone, 0.9);
        slopeLine(cx, base + fh, cx + fw, base, -wallH * i / rows, lineTone, 0.9);
      }
    }
    baseAO(cx - fw, base, cx, base + fh);
    baseAO(cx, base + fh, cx + fw, base);
  };
  // tiled pyramid roof over the wall tops: concentric shingle courses
  const roof = (peak, colLit, colDark, trim) => {
    const py = base - wallH;
    const apexY = py - fh * 0.42 - peak;
    // dark (back) half
    g.fillStyle = colDark;
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, apexY); g.lineTo(cx + fw, py); g.lineTo(cx, py - fh); g.closePath(); g.fill();
    // lit (front) half
    g.fillStyle = colLit;
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, py + fh); g.lineTo(cx + fw, py); g.lineTo(cx, apexY); g.closePath(); g.fill();
    // shingle courses: concentric chevrons shrinking toward the eaves
    g.strokeStyle = 'rgba(40,20,12,0.3)'; g.lineWidth = 1;
    const rows = 4 + s;
    for (let i = 1; i < rows; i++) {
      const t = i / rows; // 0 at eave, 1 at apex
      const lx = cx - fw * (1 - t), rx = cx + fw * (1 - t);
      const eY = py + fh * (1 - t) + (apexY - py - fh) * 0; // front chevron point
      const sideY = py + (apexY - py) * t * 0.0;            // stays on the eave line, lifted by t
      g.beginPath();
      g.moveTo(lx, py + (apexY - py) * t);
      g.lineTo(cx, py + fh * (1 - t) + (apexY - py) * t);
      g.lineTo(rx, py + (apexY - py) * t);
      g.stroke();
    }
    // eave + ridge trim
    g.strokeStyle = trim; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, py + fh); g.lineTo(cx + fw, py); g.stroke();
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, apexY); g.lineTo(cx + fw, py); g.stroke();
    // sun glint on lit slope
    g.fillStyle = 'rgba(255,240,200,0.12)';
    g.beginPath(); g.moveTo(cx - fw, py); g.lineTo(cx, apexY); g.lineTo(cx, py + fh * 0.4); g.closePath(); g.fill();
  };
  // arched doorway on the lit face
  const door = (t, wdt) => {
    const px = cx - fw + (cx - (cx - fw)) * t, py = base + fh * t;
    g.fillStyle = '#2e2014';
    g.beginPath();
    g.moveTo(px - wdt, py - 1); g.lineTo(px - wdt, py - wallH * 0.55);
    g.quadraticCurveTo(px, py - wallH * 0.85, px + wdt, py - wallH * 0.55);
    g.lineTo(px + wdt, py - 1);
    g.closePath(); g.fill();
    g.strokeStyle = '#6b4a2a'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, py - 2); g.lineTo(px, py - wallH * 0.7); g.stroke();
  };
  // small window with lintel
  const win = (side, t, ht) => {
    const [xa, ya, xb, yb] = side === 0 ? [cx - fw, base, cx, base + fh] : [cx, base + fh, cx + fw, base];
    const px = xa + (xb - xa) * t, py = ya + (yb - ya) * t;
    g.fillStyle = '#241a10';
    g.fillRect(px - 2, py - wallH * ht - 5, 4, 6);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(px - 2, py - wallH * ht - 5, 4, 2);
  };
  const banner = (x, y) => {
    g.strokeStyle = '#3a3226'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 17); g.stroke();
    g.fillStyle = teamCol;
    g.beginPath(); g.moveTo(x, y - 17); g.lineTo(x + 11, y - 13.5); g.lineTo(x, y - 10); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.moveTo(x, y - 12.8); g.lineTo(x + 6, y - 12); g.lineTo(x, y - 10); g.closePath(); g.fill();
  };

  switch (type) {
    case 'towncenter': {
      walls('stone', '#ddd3bc', '#b8ab8d', '#c0b295', '#998b6e', 'rgba(80,66,45,0.35)');
      door(0.5, 7);
      win(1, 0.3, 0.55); win(1, 0.7, 0.55);
      roof(18, '#a8503c', '#7e3a2c', '#5f2c20');
      // second-story lookout
      g.fillStyle = '#cfc4a8';
      g.fillRect(cx - 12, base - wallH - fh * 0.42 - 30, 24, 18);
      g.fillStyle = '#8a7d61';
      g.fillRect(cx - 12, base - wallH - fh * 0.42 - 30, 24, 4);
      g.fillStyle = '#241a10'; g.fillRect(cx - 3, base - wallH - fh * 0.42 - 24, 6, 8);
      g.fillStyle = '#7e3a2c';
      g.beginPath(); g.moveTo(cx - 15, base - wallH - fh * 0.42 - 30); g.lineTo(cx, base - wallH - fh * 0.42 - 42); g.lineTo(cx + 15, base - wallH - fh * 0.42 - 30); g.closePath(); g.fill();
      banner(cx, base - wallH - fh * 0.42 - 42);
      break;
    }
    case 'house': {
      walls('timber', '#e2d6b8', '#c4b696', '#cbbd9d', '#a99a7c', '#6b563c');
      door(0.5, 4.5);
      win(1, 0.5, 0.5);
      roof(10, '#a5623a', '#7c4a2c', '#5c3820');
      // chimney with smoke wisp
      g.fillStyle = '#8f8478'; g.fillRect(cx + fw * 0.3, base - wallH - fh * 0.42 - 16, 6, 12);
      g.fillStyle = 'rgba(220,220,220,0.35)';
      g.beginPath(); g.arc(cx + fw * 0.3 + 3, base - wallH - fh * 0.42 - 21, 3, 0, 7); g.fill();
      g.beginPath(); g.arc(cx + fw * 0.3 + 6, base - wallH - fh * 0.42 - 26, 2.2, 0, 7); g.fill();
      break;
    }
    case 'mill': {
      walls('timber', '#d8c8a4', '#b7a680', '#c0af8a', '#9c8b67', '#6b563c');
      door(0.45, 4.5);
      roof(12, '#8a6238', '#68492c', '#4c3520');
      // windmill tower + blades
      const wx = cx, wy = base - wallH - fh * 0.42 - 14;
      g.fillStyle = '#b5a17b'; g.fillRect(wx - 6, wy - 4, 12, 18);
      g.fillStyle = '#8a7a5c'; g.fillRect(wx - 6, wy - 4, 12, 3);
      g.strokeStyle = '#f0e7d0'; g.lineWidth = 2.4;
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + 0.6;
        g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + Math.cos(ang) * 17, wy + Math.sin(ang) * 17); g.stroke();
        // vane cloth
        g.fillStyle = 'rgba(240,231,208,0.5)';
        g.beginPath();
        g.moveTo(wx + Math.cos(ang) * 5, wy + Math.sin(ang) * 5);
        g.lineTo(wx + Math.cos(ang) * 16, wy + Math.sin(ang) * 16);
        g.lineTo(wx + Math.cos(ang + 0.25) * 14, wy + Math.sin(ang + 0.25) * 14);
        g.closePath(); g.fill();
      }
      g.fillStyle = teamCol; g.beginPath(); g.arc(wx, wy, 2.6, 0, 7); g.fill();
      break;
    }
    case 'lumbercamp': {
      walls('plank', '#b08a55', '#8d6c40', '#997643', '#7a5d36', 'rgba(60,42,22,0.5)');
      door(0.5, 5);
      roof(7, '#7a5e38', '#5c452a', '#42311d');
      // log pile
      g.fillStyle = '#c9a260';
      for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
        g.beginPath(); g.arc(cx + fw * 0.55 - 5 + j * 8 - i * 4, base - 4 - (2 - i) * 6, 3.6, 0, 7); g.fill();
        g.strokeStyle = '#8a6b40'; g.lineWidth = 0.8; g.stroke();
        g.fillStyle = '#e0c084';
        g.beginPath(); g.arc(cx + fw * 0.55 - 5 + j * 8 - i * 4, base - 4 - (2 - i) * 6, 1.6, 0, 7); g.fill();
        g.fillStyle = '#c9a260';
      }
      // leaning axe
      g.strokeStyle = '#9c7a4a'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx - fw * 0.5, base - 1); g.lineTo(cx - fw * 0.5 + 5, base - 13); g.stroke();
      g.fillStyle = '#c9ced4';
      g.beginPath(); g.moveTo(cx - fw * 0.5 + 4, base - 14); g.lineTo(cx - fw * 0.5 + 10, base - 11); g.lineTo(cx - fw * 0.5 + 5, base - 9); g.closePath(); g.fill();
      break;
    }
    case 'miningcamp': {
      walls('plank', '#a29a8c', '#847d72', '#8f887b', '#6e675c', 'rgba(50,46,40,0.5)');
      door(0.5, 5);
      roof(7, '#6b645a', '#4f4a42', '#3a362f');
      // ore cart
      g.fillStyle = '#6b5738'; g.fillRect(cx + fw * 0.35, base - 10, 14, 7);
      g.fillStyle = '#e8c84a';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx + fw * 0.35 + 3 + i * 3, base - 10, 2, 0, 7); g.fill(); }
      g.fillStyle = '#3a342c';
      g.beginPath(); g.arc(cx + fw * 0.35 + 3, base - 2.5, 2.4, 0, 7); g.fill();
      g.beginPath(); g.arc(cx + fw * 0.35 + 11, base - 2.5, 2.4, 0, 7); g.fill();
      break;
    }
    case 'farm': {
      // tilled field with crop rows and fence posts
      diamondPath(g, cx, base, fw, fh);
      g.fillStyle = '#9c7c48'; g.fill();
      g.save();
      diamondPath(g, cx, base, fw, fh); g.clip();
      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        g.fillStyle = i % 2 ? '#8a6b3e' : '#a8874f';
        g.beginPath();
        g.moveTo(cx - fw + t * fw, base - fh + t * fh - 2);
        g.lineTo(cx + t * fw, base + t * fh - fh - 2 + fh);
        g.lineTo(cx + t * fw - fw / 7, base + t * fh + fh / 7 - 2);
        g.lineTo(cx - fw + t * fw - fw / 7, base - fh + t * fh + fh / 7 - 2);
        g.closePath(); g.fill();
        // sprouting crops on alternating rows
        if (i % 2 === 0) {
          g.strokeStyle = 'rgba(90,140,60,0.85)'; g.lineWidth = 1;
          for (let c = 0; c < 6; c++) {
            const u = 0.12 + c * 0.15;
            const px = cx - fw + t * fw + (fw) * u - fw / 14, py = base - fh + t * fh + fh * u + fh / 14 - 2;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px - 1.4, py - 3); g.stroke();
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + 1.4, py - 3.2); g.stroke();
          }
        }
      }
      g.restore();
      g.strokeStyle = 'rgba(70,50,25,0.55)'; g.lineWidth = 1.4;
      diamondPath(g, cx, base, fw, fh); g.stroke();
      // corner posts
      g.fillStyle = '#6b4a2a';
      for (const [dx, dy] of [[-fw, 0], [fw, 0], [0, -fh], [0, fh]]) g.fillRect(cx + dx - 1.2, base + dy - 6, 2.4, 6);
      break;
    }
    case 'barracks': {
      walls('stone', '#c2b198', '#9c8a6f', '#a8967b', '#857459', 'rgba(70,58,40,0.4)');
      door(0.5, 6);
      win(0, 0.2, 0.5); win(1, 0.5, 0.5);
      roof(14, '#7e492e', '#5e3722', '#452a1a');
      // shields on the lit wall
      for (const t of [0.22, 0.78]) {
        const px = cx - fw + fw * t, py = base + fh * t - wallH * 0.55;
        g.fillStyle = teamCol; g.beginPath(); g.arc(px, py, 3.6, 0, 7); g.fill();
        g.strokeStyle = '#e0d8c0'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#e0d8c0'; g.beginPath(); g.arc(px, py, 1.2, 0, 7); g.fill();
      }
      banner(cx, base - wallH - fh * 0.42 - 16);
      break;
    }
    case 'archeryrange': {
      walls('timber', '#cbbd9d', '#a89670', '#b3a17d', '#8f7d5c', '#5c4c34');
      door(0.4, 5);
      roof(12, '#4c7040', '#38542f', '#283e22');
      // archery target on the dark wall
      const tx2 = cx + fw * 0.55, ty2 = base - 12;
      g.fillStyle = '#efe6cd'; g.beginPath(); g.arc(tx2, ty2, 7, 0, 7); g.fill();
      g.fillStyle = '#c04038'; g.beginPath(); g.arc(tx2, ty2, 4.4, 0, 7); g.fill();
      g.fillStyle = '#efe6cd'; g.beginPath(); g.arc(tx2, ty2, 2, 0, 7); g.fill();
      g.strokeStyle = '#6b563c'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(tx2 - 5, ty2 + 7); g.lineTo(tx2, ty2); g.stroke();
      banner(cx - fw * 0.5, base - wallH - fh * 0.2 - 8);
      break;
    }
    case 'stable': {
      walls('timber', '#c09a6e', '#9c7a52', '#a8865c', '#87694a', '#5c4227');
      // wide stable doors
      g.fillStyle = '#3a2817';
      g.beginPath();
      g.moveTo(cx - fw * 0.62, base + fh * 0.38); g.lineTo(cx - fw * 0.62, base + fh * 0.38 - wallH * 0.7);
      g.lineTo(cx - fw * 0.2, base + fh * 0.8 - wallH * 0.7); g.lineTo(cx - fw * 0.2, base + fh * 0.8);
      g.closePath(); g.fill();
      g.strokeStyle = '#6b4a2a'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx - fw * 0.41, base + fh * 0.59); g.lineTo(cx - fw * 0.41, base + fh * 0.59 - wallH * 0.7); g.stroke();
      roof(12, '#8a5330', '#673e24', '#4a2d1a');
      // hay bales
      g.fillStyle = '#d8bc6a';
      g.beginPath(); g.arc(cx + fw * 0.5, base - 5, 5, 0, 7); g.fill();
      g.beginPath(); g.arc(cx + fw * 0.62, base - 3, 4, 0, 7); g.fill();
      g.strokeStyle = '#b09347'; g.lineWidth = 0.8;
      g.beginPath(); g.arc(cx + fw * 0.5, base - 5, 3, 0, 7); g.stroke();
      // horseshoe over the door
      g.strokeStyle = '#c9ced4'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(cx - fw * 0.41, base + fh * 0.59 - wallH * 0.78, 2.6, 0.4, Math.PI - 0.4, true); g.stroke();
      break;
    }
    case 'blacksmith': {
      walls('stone', '#98897b', '#776d62', '#847768', '#665d53', 'rgba(40,36,30,0.45)');
      door(0.55, 5.5);
      roof(9, '#544c40', '#3e3830', '#2c2822');
      // chimney with glow + smoke
      g.fillStyle = '#5b544a'; g.fillRect(cx + fw * 0.28, base - wallH - fh * 0.42 - 16, 8, 16);
      g.fillStyle = '#ff8c30';
      g.beginPath(); g.arc(cx + fw * 0.28 + 4, base - wallH - fh * 0.42 - 16, 2.6, 0, 7); g.fill();
      g.fillStyle = 'rgba(120,120,120,0.4)';
      g.beginPath(); g.arc(cx + fw * 0.28 + 6, base - wallH - fh * 0.42 - 23, 3.4, 0, 7); g.fill();
      // forge glow through the door
      g.fillStyle = 'rgba(255,140,50,0.5)';
      g.beginPath(); g.arc(cx - fw * 0.45 + fw * 0.55, base + fh * 0.55 - 4, 3, 0, 7); g.fill();
      // anvil
      g.fillStyle = '#3a3a3e';
      g.fillRect(cx + fw * 0.5, base - 8, 8, 3);
      g.fillRect(cx + fw * 0.52, base - 5, 4, 4);
      break;
    }
    case 'monastery': {
      walls('stone', '#e5dcc6', '#c2b79e', '#d1c6ad', '#b3a88c', 'rgba(90,80,60,0.3)');
      door(0.5, 5.5);
      win(0, 0.22, 0.6); win(0, 0.78, 0.6); win(1, 0.5, 0.6);
      roof(6, '#9c6bab', '#7a5089', '#5c3c68');
      // dome + golden finial
      const dy = base - wallH - fh * 0.42 - 8;
      g.fillStyle = '#a577b5';
      g.beginPath(); g.arc(cx, dy, 12, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.arc(cx - 3, dy - 2, 8, Math.PI, Math.PI * 1.6); g.fill();
      g.fillStyle = '#8a5c9c'; g.fillRect(cx - 12, dy, 24, 3.4);
      g.strokeStyle = '#ffd98c'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, dy - 12); g.lineTo(cx, dy - 22); g.stroke();
      g.beginPath(); g.arc(cx, dy - 24, 2.2, 0, 7); g.stroke();
      break;
    }
    case 'market': {
      walls('timber', '#dcc494', '#b8a077', '#c5ac7e', '#a78f66', '#7a5c36');
      door(0.5, 5);
      roof(5, '#b8763e', '#8f5c32', '#6b4526');
      // striped awnings along the lit face
      for (let i = 0; i < 3; i++) {
        const t = 0.15 + i * 0.28;
        const px = cx - fw + fw * t, py = base + fh * t;
        for (let sgm = 0; sgm < 4; sgm++) {
          g.fillStyle = sgm % 2 ? '#eae2ce' : '#c04a3e';
          g.beginPath();
          g.moveTo(px + sgm * 2.6, py - wallH * 0.62 + sgm * 1.3);
          g.lineTo(px + sgm * 2.6 + 2.6, py - wallH * 0.62 + sgm * 1.3 + 1.3);
          g.lineTo(px + sgm * 2.6 + 5, py - wallH * 0.34 + sgm * 1.3 + 1.3);
          g.lineTo(px + sgm * 2.6 + 2.4, py - wallH * 0.34 + sgm * 1.3);
          g.closePath(); g.fill();
        }
      }
      // market stall with goods
      g.fillStyle = '#8a6b40'; g.fillRect(cx + fw * 0.35, base - 8, 16, 3);
      g.fillStyle = '#c04a3e'; g.beginPath(); g.arc(cx + fw * 0.4, base - 10, 2, 0, 7); g.fill();
      g.fillStyle = '#e8c84a'; g.beginPath(); g.arc(cx + fw * 0.45 + 4, base - 10, 2, 0, 7); g.fill();
      g.fillStyle = '#5a8a3c'; g.beginPath(); g.arc(cx + fw * 0.45 + 9, base - 10, 2, 0, 7); g.fill();
      break;
    }
    case 'dock': {
      // piles + planked pier over the water
      g.strokeStyle = '#5c4226'; g.lineWidth = 3;
      for (const [dx, dy] of [[-fw * 0.6, 0], [fw * 0.6, 0], [0, -fh * 0.6], [0, fh * 0.6]]) {
        g.beginPath(); g.moveTo(cx + dx, base + dy + 5); g.lineTo(cx + dx, base + dy - 9); g.stroke();
      }
      g.fillStyle = '#a3814f';
      diamondPath(g, cx, base - 8, fw, fh); g.fill();
      g.save(); diamondPath(g, cx, base - 8, fw, fh); g.clip();
      g.strokeStyle = 'rgba(90,60,20,0.45)'; g.lineWidth = 1.1;
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        g.beginPath();
        g.moveTo(cx - fw + t * fw * 2, base - 8 - fh);
        g.lineTo(cx - fw + t * fw * 2 - fw, base - 8 + fh - fh);
        g.moveTo(cx - fw * (1 - t), base - 8 - fh * t);
        g.lineTo(cx + fw * t, base - 8 + fh * (1 - t));
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(60,40,15,0.6)'; g.lineWidth = 1.4;
      diamondPath(g, cx, base - 8, fw, fh); g.stroke();
      // boathouse
      g.fillStyle = '#8d6c40'; g.fillRect(cx - 9, base - fh * 0.4 - 26, 18, 18);
      g.fillStyle = '#6b5433';
      g.beginPath(); g.moveTo(cx - 11, base - fh * 0.4 - 26); g.lineTo(cx, base - fh * 0.4 - 35); g.lineTo(cx + 11, base - fh * 0.4 - 26); g.closePath(); g.fill();
      g.fillStyle = '#241a10'; g.fillRect(cx - 3, base - fh * 0.4 - 15, 6, 7);
      // coiled rope + barrel
      g.strokeStyle = '#c9b48a'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx - fw * 0.55, base - 5, 2.6, 0, 7); g.stroke();
      g.fillStyle = '#8a6b40'; g.fillRect(cx + fw * 0.45, base - 12, 6, 8);
      g.strokeStyle = '#5c4226'; g.strokeRect(cx + fw * 0.45, base - 10, 6, 1);
      banner(cx + fw * 0.5, base - 14);
      break;
    }
    case 'tower': {
      const th = 50;
      // tapered stone shaft
      const grad = g.createLinearGradient(0, base - th, 0, base);
      grad.addColorStop(0, '#d5cfc2'); grad.addColorStop(1, '#948d81');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx - 13, base + 3); g.lineTo(cx - 10, base - th); g.lineTo(cx + 10, base - th); g.lineTo(cx + 13, base + 3);
      g.closePath(); g.fill();
      // right shade
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.beginPath(); g.moveTo(cx + 2, base + 3); g.lineTo(cx + 3, base - th); g.lineTo(cx + 10, base - th); g.lineTo(cx + 13, base + 3); g.closePath(); g.fill();
      // stone courses
      g.strokeStyle = 'rgba(70,62,50,0.35)'; g.lineWidth = 0.9;
      for (let i = 1; i < 8; i++) {
        g.beginPath(); g.moveTo(cx - 12.6 + i * 0.35, base + 3 - i * th / 8); g.lineTo(cx + 12.6 - i * 0.35, base + 3 - i * th / 8); g.stroke();
      }
      // machicolated top
      g.fillStyle = '#ddd7ca';
      g.fillRect(cx - 14, base - th - 4, 28, 6);
      for (let i = 0; i < 4; i++) g.fillRect(cx - 13 + i * 8, base - th - 10, 5, 7);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(cx - 14, base - th + 1, 28, 2);
      // arrow slits
      g.fillStyle = '#2c241a';
      g.fillRect(cx - 1.4, base - th + 12, 2.8, 9);
      g.fillRect(cx - 1.4, base - th + 28, 2.8, 9);
      baseAO(cx - 13, base + 3, cx + 13, base + 3);
      banner(cx, base - th - 10);
      break;
    }
    case 'castle': {
      walls('stone', '#d0cabd', '#a29b8d', '#b8b2a5', '#8f887b', 'rgba(70,64,54,0.4)');
      // gatehouse with portcullis
      g.fillStyle = '#2e2820';
      g.beginPath();
      g.moveTo(cx - 8, base + fh * 0.5 - 2); g.lineTo(cx - 8, base + fh * 0.5 - wallH * 0.6);
      g.quadraticCurveTo(cx, base + fh * 0.5 - wallH * 0.85, cx + 8, base + fh * 0.5 - wallH * 0.6);
      g.lineTo(cx + 8, base + fh * 0.5 - 2);
      g.closePath(); g.fill();
      g.strokeStyle = '#6b5c48'; g.lineWidth = 1;
      for (let i = -6; i <= 6; i += 3) { g.beginPath(); g.moveTo(cx + i, base + fh * 0.5 - 2); g.lineTo(cx + i, base + fh * 0.5 - wallH * 0.7); g.stroke(); }
      // crenellated wall top
      const py = base - wallH;
      g.fillStyle = '#ddd7ca';
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const mx = cx - fw + t * fw * 2;
        const my = py - fh * (1 - Math.abs(t * 2 - 1));
        g.fillRect(mx - 3.4, my - 9, 6.8, 10);
        g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(mx - 3.4, my - 2, 6.8, 3); g.fillStyle = '#ddd7ca';
      }
      // corner towers with cone roofs
      for (const [dx, dy] of [[-fw, 0], [fw, 0], [0, -fh], [0, fh]]) {
        const tx3 = cx + dx, ty3 = base + dy;
        const grad2 = g.createLinearGradient(tx3 - 9, 0, tx3 + 9, 0);
        grad2.addColorStop(0, '#cfc9bc'); grad2.addColorStop(1, '#9a938a');
        g.fillStyle = grad2;
        g.fillRect(tx3 - 9, ty3 - wallH - 24, 18, wallH + 22);
        g.strokeStyle = 'rgba(70,62,50,0.3)';
        for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(tx3 - 9, ty3 - i * (wallH + 22) / 6); g.lineTo(tx3 + 9, ty3 - i * (wallH + 22) / 6); g.stroke(); }
        g.fillStyle = '#8a4636';
        g.beginPath(); g.moveTo(tx3 - 11, ty3 - wallH - 22); g.lineTo(tx3, ty3 - wallH - 40); g.lineTo(tx3 + 11, ty3 - wallH - 22); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,240,200,0.12)';
        g.beginPath(); g.moveTo(tx3 - 11, ty3 - wallH - 22); g.lineTo(tx3, ty3 - wallH - 40); g.lineTo(tx3, ty3 - wallH - 22); g.closePath(); g.fill();
        g.fillStyle = '#2c241a'; g.fillRect(tx3 - 1.4, ty3 - wallH - 12, 2.8, 7);
      }
      banner(cx, base - wallH - fh - 26);
      break;
    }
    case 'siegeworkshop': {
      walls('plank', '#ab987c', '#8b7b64', '#96856b', '#7b6c53', 'rgba(60,48,32,0.5)');
      // wide open front
      g.fillStyle = '#2e2418';
      g.beginPath();
      g.moveTo(cx - fw * 0.7, base + fh * 0.3); g.lineTo(cx - fw * 0.7, base + fh * 0.3 - wallH * 0.75);
      g.lineTo(cx - fw * 0.15, base + fh * 0.85 - wallH * 0.75); g.lineTo(cx - fw * 0.15, base + fh * 0.85);
      g.closePath(); g.fill();
      roof(6, '#6b5c48', '#4f4436', '#3a3228');
      // spare wheel + beams
      g.strokeStyle = '#4d4335'; g.lineWidth = 2.6;
      g.beginPath(); g.arc(cx + fw * 0.5, base - 9, 8, 0, 7); g.stroke();
      g.lineWidth = 1.2;
      for (let a = 0; a < 4; a++) {
        g.beginPath(); g.moveTo(cx + fw * 0.5, base - 9);
        g.lineTo(cx + fw * 0.5 + Math.cos(a * 1.57) * 8, base - 9 + Math.sin(a * 1.57) * 8); g.stroke();
      }
      g.fillStyle = '#8a6b40';
      g.fillRect(cx - fw * 0.1, base - 5, 18, 2.6);
      g.fillRect(cx - fw * 0.05, base - 9, 18, 2.6);
      break;
    }
    case 'palisade': {
      g.fillStyle = 'rgba(15,20,10,0.2)';
      g.beginPath(); g.ellipse(cx + 2, base + 2, 15, 6, 0, 0, 7); g.fill();
      for (let i = -1; i <= 1; i++) {
        const px = cx + i * 8, ph = 24 - Math.abs(i) * 3;
        const grad = g.createLinearGradient(px - 3, 0, px + 3, 0);
        grad.addColorStop(0, '#a3814f'); grad.addColorStop(1, '#7a5c36');
        g.fillStyle = grad;
        g.fillRect(px - 3, base - ph, 6, ph + 2);
        g.beginPath(); g.moveTo(px - 3, base - ph); g.lineTo(px, base - ph - 5); g.lineTo(px + 3, base - ph); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(60,42,22,0.5)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(px, base - ph - 2); g.lineTo(px, base); g.stroke();
      }
      // lashing rail
      g.strokeStyle = '#5c4226'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx - 11, base - 13); g.lineTo(cx + 11, base - 13); g.stroke();
      break;
    }
    case 'stonewall': {
      g.fillStyle = 'rgba(15,20,10,0.2)';
      g.beginPath(); g.ellipse(cx + 2, base + 2, 16, 6.5, 0, 0, 7); g.fill();
      const grad = g.createLinearGradient(0, base - 27, 0, base);
      grad.addColorStop(0, '#d5cfc2'); grad.addColorStop(1, '#8f887b');
      g.fillStyle = grad;
      g.fillRect(cx - 13, base - 25, 26, 27);
      // crenellations
      g.fillStyle = '#ddd7ca';
      for (let i = 0; i < 3; i++) g.fillRect(cx - 13 + i * 10, base - 31, 6, 7);
      // brick courses + joints
      g.strokeStyle = 'rgba(60,55,48,0.4)'; g.lineWidth = 0.9;
      for (let yy = 1; yy < 5; yy++) {
        g.beginPath(); g.moveTo(cx - 13, base - 25 + yy * 5.4); g.lineTo(cx + 13, base - 25 + yy * 5.4); g.stroke();
        for (let xx = 0; xx < 3; xx++) {
          const jx = cx - 11 + xx * 9 + (yy % 2) * 4.5;
          g.beginPath(); g.moveTo(jx, base - 25 + yy * 5.4); g.lineTo(jx, base - 25 + yy * 5.4 - 5.4); g.stroke();
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(cx + 4, base - 25, 9, 27);
      break;
    }
  }
}

// ---------- resource sprites ----------
function resSprite(rtype, variant) {
  return cached(`r_${rtype}_${variant}`, TW2 * 2, 100, (g, w, h) => {
    const cx = w / 2, base = h - TH2;
    const rng = mulberry32(variant * 991 + 17);
    if (rtype !== 'fish') {
      g.fillStyle = 'rgba(15,20,10,0.25)';
      g.beginPath(); g.ellipse(cx + 2, base + 1, 13, 5.6, 0, 0, 7); g.fill();
    }
    if (rtype === 'tree') {
      // trunk with root flare
      const grad = g.createLinearGradient(cx - 3, 0, cx + 3, 0);
      grad.addColorStop(0, '#7a5836'); grad.addColorStop(1, '#553a22');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx - 5, base); g.quadraticCurveTo(cx - 2.5, base - 6, cx - 2.5, base - 20);
      g.lineTo(cx + 2.5, base - 20); g.quadraticCurveTo(cx + 2.5, base - 6, cx + 5, base);
      g.closePath(); g.fill();
      // layered lush canopy: dark silhouette, mid clumps, lit clumps
      const blobs = [];
      for (let i = 0; i < 9; i++) blobs.push([cx + (rng() - 0.5) * 22, base - 30 - rng() * 24, 7 + rng() * 6]);
      g.fillStyle = '#1f4a22';
      for (const [bx, by, br] of blobs) { g.beginPath(); g.arc(bx, by + 1.5, br + 1.5, 0, 7); g.fill(); }
      g.fillStyle = '#2e6b33';
      for (const [bx, by, br] of blobs) { g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill(); }
      g.fillStyle = '#3f8a42';
      for (const [bx, by, br] of blobs) { g.beginPath(); g.arc(bx - br * 0.25, by - br * 0.3, br * 0.62, 0, 7); g.fill(); }
      g.fillStyle = '#5aa855';
      for (let i = 0; i < 5; i++) {
        const [bx, by, br] = blobs[(rng() * blobs.length) | 0];
        g.beginPath(); g.arc(bx - br * 0.35, by - br * 0.45, br * 0.3, 0, 7); g.fill();
      }
    } else if (rtype === 'gold' || rtype === 'stone') {
      const [lit, mid, dark] = rtype === 'gold'
        ? ['#a89a68', '#8f8353', '#6e6440'] : ['#a8a8a8', '#8d8d8d', '#6a6a6a'];
      for (let i = 0; i < 5; i++) {
        const x = cx - 11 + rng() * 22, y = base - 3 - rng() * 6, r = 4.5 + rng() * 5;
        // faceted boulder: dark base, mid body, lit top-left facet
        g.fillStyle = dark;
        g.beginPath();
        g.moveTo(x - r, y); g.lineTo(x - r * 0.4, y - r); g.lineTo(x + r * 0.55, y - r * 0.85); g.lineTo(x + r, y);
        g.closePath(); g.fill();
        g.fillStyle = mid;
        g.beginPath();
        g.moveTo(x - r, y); g.lineTo(x - r * 0.4, y - r); g.lineTo(x + r * 0.1, y - r * 0.5); g.lineTo(x - r * 0.1, y);
        g.closePath(); g.fill();
        g.fillStyle = lit;
        g.beginPath();
        g.moveTo(x - r * 0.4, y - r); g.lineTo(x + r * 0.1, y - r * 0.5); g.lineTo(x - r * 0.25, y - r * 0.45);
        g.closePath(); g.fill();
      }
      if (rtype === 'gold') {
        g.fillStyle = '#ffe066';
        for (let i = 0; i < 6; i++) {
          const x = cx - 9 + rng() * 18, y = base - 12 + rng() * 9;
          g.fillRect(x, y, 2.2, 2.2);
          g.fillStyle = '#fff2b0'; g.fillRect(x + 0.5, y + 0.5, 1, 1); g.fillStyle = '#ffe066';
        }
      }
    } else if (rtype === 'berry') {
      // leafy bush with clustered berries
      g.fillStyle = '#2e5c2b';
      g.beginPath(); g.ellipse(cx, base - 6, 14, 9, 0, 0, 7); g.fill();
      g.fillStyle = '#3f7d3b';
      g.beginPath(); g.ellipse(cx - 4, base - 9, 9, 6, 0, 0, 7); g.fill();
      g.fillStyle = '#54964a';
      g.beginPath(); g.ellipse(cx - 6, base - 11, 5, 3.4, 0, 0, 7); g.fill();
      for (let i = 0; i < 8; i++) {
        const bx = cx - 10 + rng() * 20, by = base - 12 + rng() * 9;
        g.fillStyle = '#c22b4e';
        g.beginPath(); g.arc(bx, by, 1.9, 0, 7); g.fill();
        g.fillStyle = '#ff7a94';
        g.beginPath(); g.arc(bx - 0.6, by - 0.6, 0.7, 0, 7); g.fill();
      }
    } else if (rtype === 'fish') {
      // rippling shoal
      g.strokeStyle = 'rgba(230,240,255,0.5)'; g.lineWidth = 1.3;
      for (let i = 0; i < 2; i++) {
        g.beginPath(); g.ellipse(cx, base - 4, 9 + i * 4.5, 4 + i * 2, 0, 0, 7); g.stroke();
      }
      for (let i = 0; i < 3; i++) {
        const fx = cx - 7 + rng() * 14, fy = base - 6 + rng() * 5;
        g.fillStyle = '#d8e4f0';
        g.beginPath(); g.ellipse(fx, fy, 3.2, 1.3, rng() - 0.5, 0, 7); g.fill();
        g.beginPath(); g.moveTo(fx - 3.5, fy); g.lineTo(fx - 5.5, fy - 1.5); g.lineTo(fx - 5.5, fy + 1.5); g.closePath(); g.fill();
        g.fillStyle = '#8fa8c2';
        g.beginPath(); g.ellipse(fx + 0.8, fy + 0.4, 1.6, 0.6, 0, 0, 7); g.fill();
      }
    }
  });
}

// ---------- unit drawing ----------
function outlined(g, fillCol, drawShape) {
  drawShape();
  g.fillStyle = fillCol; g.fill();
  g.strokeStyle = 'rgba(20,16,10,0.55)'; g.lineWidth = 0.8;
  g.stroke();
}

function drawUnit(g, u, px, py, z) {
  const d = UNITS[u.type];
  const col = G.players[u.owner].color;
  const s = z; // scale
  const moving = u.task !== 'idle' && u.moved;
  const bob = moving ? Math.sin(G.time * 12 + u.id) * 1.2 * s : 0;
  const faceL = Math.cos(u.dir) < 0 ? -1 : 1; // face left/right
  // shadow
  g.fillStyle = 'rgba(15,20,10,0.3)';
  g.beginPath(); g.ellipse(px + 1, py + 0.5, 7 * s, 3 * s, 0, 0, 7); g.fill();

  if (d.cls === 'ship') {
    const bobW = Math.sin(G.time * 2.2 + u.id) * 1.2 * s;
    // wake
    g.strokeStyle = 'rgba(220,235,255,0.4)'; g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(px, py + 1 * s + bobW, 13 * s, 4 * s, 0, 0, 7); g.stroke();
    // hull with planking
    outlined(g, '#7a5c36', () => {
      g.beginPath();
      g.moveTo(px - 11 * s, py - 4 * s + bobW);
      g.quadraticCurveTo(px, py + 4 * s + bobW, px + 11 * s, py - 4 * s + bobW);
      g.lineTo(px + 8 * s, py - 8 * s + bobW); g.lineTo(px - 8 * s, py - 8 * s + bobW);
      g.closePath();
    });
    g.strokeStyle = 'rgba(60,42,22,0.5)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(px - 9 * s, py - 6 * s + bobW); g.lineTo(px + 9 * s, py - 6 * s + bobW); g.stroke();
    g.fillStyle = '#94744a';
    g.fillRect(px - 8 * s, py - 9 * s + bobW, 16 * s, 2 * s);
    // mast + sail
    g.strokeStyle = '#54432a'; g.lineWidth = 1.8 * s;
    g.beginPath(); g.moveTo(px, py - 8 * s + bobW); g.lineTo(px, py - 24 * s + bobW); g.stroke();
    if (u.type === 'wargalley') {
      outlined(g, '#eae4d4', () => {
        g.beginPath(); g.moveTo(px, py - 23 * s + bobW);
        g.quadraticCurveTo(px + 10 * s, py - 18 * s + bobW, px + 9 * s * 1, py - 13 * s + bobW);
        g.lineTo(px, py - 11 * s + bobW); g.closePath();
      });
      g.fillStyle = col;
      g.fillRect(px + 1 * s, py - 19 * s + bobW, 6 * s, 2.4 * s);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(px, py - 24 * s + bobW); g.lineTo(px + 6 * s, py - 22.5 * s + bobW); g.lineTo(px, py - 21 * s + bobW); g.closePath(); g.fill();
    } else {
      outlined(g, col, () => {
        g.beginPath(); g.moveTo(px, py - 22 * s + bobW);
        g.quadraticCurveTo(px + 8 * s, py - 17 * s + bobW, px + 7 * s, py - 13 * s + bobW);
        g.lineTo(px, py - 12 * s + bobW); g.closePath();
      });
      g.strokeStyle = 'rgba(230,228,216,0.7)'; g.lineWidth = 1 * s;
      g.beginPath(); g.moveTo(px - 8 * s, py - 6 * s + bobW); g.lineTo(px - 13 * s, py + 1 * s + bobW); g.stroke();
    }
    return;
  }

  if (d.cls === 'monk') {
    outlined(g, '#4a3f33', () => {
      g.beginPath();
      g.moveTo(px - 5 * s, py); g.lineTo(px - 3.5 * s, py - 13 * s + bob); g.lineTo(px + 3.5 * s, py - 13 * s + bob); g.lineTo(px + 5 * s, py);
      g.closePath();
    });
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.moveTo(px - 4.5 * s, py); g.lineTo(px - 3.2 * s, py - 12 * s + bob); g.lineTo(px - 1 * s, py - 12 * s + bob); g.lineTo(px - 1.5 * s, py); g.closePath(); g.fill();
    g.fillStyle = col;
    g.fillRect(px - 4 * s, py - 8 * s + bob, 8 * s, 2.5 * s);
    g.fillStyle = '#e8c39c';
    g.beginPath(); g.arc(px, py - 15 * s + bob, 3 * s, 0, 7); g.fill();
    g.fillStyle = '#4a3f33';
    g.beginPath(); g.arc(px, py - 16 * s + bob, 3.2 * s, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    g.strokeStyle = '#9c7a4a'; g.lineWidth = 1.6 * s;
    g.beginPath(); g.moveTo(px + 5 * s * faceL, py); g.lineTo(px + 5 * s * faceL, py - 17 * s + bob); g.stroke();
    g.fillStyle = '#ffd98c';
    g.beginPath(); g.arc(px + 5 * s * faceL, py - 18 * s + bob, 1.8 * s, 0, 7); g.fill();
    if (u.chant > 0) {
      g.fillStyle = `rgba(255,230,140,${0.4 + 0.4 * Math.sin(G.time * 10)})`;
      g.beginPath(); g.arc(px, py - 22 * s, 2.2 * s, 0, 7); g.fill();
    }
    return;
  }

  if (d.cls === 'siege') {
    if (u.type === 'trebuchet') {
      g.fillStyle = '#6b5738';
      g.fillRect(px - 11 * s, py - 5 * s, 22 * s, 4 * s);
      g.strokeStyle = 'rgba(20,16,10,0.5)'; g.lineWidth = 0.8; g.strokeRect(px - 11 * s, py - 5 * s, 22 * s, 4 * s);
      g.strokeStyle = '#54432a'; g.lineWidth = 2.6 * s;
      g.beginPath(); g.moveTo(px - 7 * s, py - 3 * s); g.lineTo(px, py - 16 * s); g.lineTo(px + 7 * s, py - 3 * s); g.stroke();
      g.lineWidth = 2.2 * s;
      g.beginPath(); g.moveTo(px - 9 * s * faceL, py - 24 * s); g.lineTo(px + 6 * s * faceL, py - 12 * s); g.stroke();
      g.fillStyle = '#3f3524';
      g.fillRect(px + 4 * s * faceL - 3 * s, py - 13 * s, 6 * s, 6 * s);
      g.strokeStyle = '#8a7a5a'; g.lineWidth = 1.2 * s;
      g.beginPath(); g.moveTo(px - 9 * s * faceL, py - 24 * s); g.lineTo(px - 12 * s * faceL, py - 16 * s); g.stroke();
      g.fillStyle = col; g.fillRect(px - 11 * s, py - 8 * s, 4 * s, 3 * s);
      return;
    }
    if (u.type === 'ram') {
      outlined(g, '#7a5c36', () => { g.beginPath(); g.rect(px - 10 * s, py - 12 * s + bob, 20 * s, 8 * s); });
      g.fillStyle = '#94744a';
      g.beginPath(); g.moveTo(px - 11 * s, py - 12 * s + bob); g.lineTo(px, py - 18 * s + bob); g.lineTo(px + 11 * s, py - 12 * s + bob); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(20,16,10,0.4)'; g.lineWidth = 0.8; g.stroke();
      g.strokeStyle = 'rgba(60,42,22,0.6)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px - 9 * s, py - 15 * s + bob); g.lineTo(px + 9 * s, py - 15 * s + bob); g.stroke();
      // ram head pokes out the front
      g.fillStyle = '#54432a';
      g.beginPath(); g.arc(px + 12 * s * faceL, py - 8 * s + bob, 2.2 * s, 0, 7); g.fill();
      g.fillStyle = '#4d4335';
      for (const dx of [-6, 0, 6]) { g.beginPath(); g.arc(px + dx * s, py - 3 * s, 2.6 * s, 0, 7); g.fill(); }
      g.fillStyle = col; g.fillRect(px - 3 * s, py - 21 * s + bob, 6 * s, 3 * s);
    } else { // mangonel
      g.fillStyle = '#6b5738';
      g.fillRect(px - 8 * s, py - 8 * s, 16 * s, 5 * s);
      g.strokeStyle = 'rgba(20,16,10,0.5)'; g.lineWidth = 0.8; g.strokeRect(px - 8 * s, py - 8 * s, 16 * s, 5 * s);
      g.strokeStyle = '#54432a'; g.lineWidth = 2.4 * s;
      g.beginPath(); g.moveTo(px - 4 * s * faceL, py - 7 * s); g.lineTo(px + 5 * s * faceL, py - 18 * s); g.stroke();
      g.fillStyle = '#3f3524'; g.beginPath(); g.arc(px + 5 * s * faceL, py - 18 * s, 3 * s, 0, 7); g.fill();
      g.fillStyle = '#4d4335';
      for (const dx of [-6, 6]) { g.beginPath(); g.arc(px + dx * s, py - 3 * s, 2.8 * s, 0, 7); g.fill(); }
      g.fillStyle = col; g.fillRect(px - 8 * s, py - 10 * s, 4 * s, 3 * s);
    }
    return;
  }

  const mounted = d.cls === 'cav';
  if (mounted) {
    const hcol = u.type === 'scout' ? '#8a6b47' : '#5c4a3a';
    const hlit = u.type === 'scout' ? '#a3814f' : '#6e5a48';
    // legs animated
    g.strokeStyle = '#42332a'; g.lineWidth = 1.7 * s;
    for (const dx of [-6, -2, 2, 6]) {
      const lp = moving ? Math.sin(G.time * 14 + dx) * 2.2 * s : 0;
      g.beginPath(); g.moveTo(px + dx * s, py - 5 * s); g.lineTo(px + dx * s + lp, py); g.stroke();
    }
    // body + neck + head + tail
    outlined(g, hcol, () => { g.beginPath(); g.ellipse(px, py - 7 * s + bob * 0.5, 9 * s, 4.5 * s, 0, 0, 7); });
    g.fillStyle = hlit;
    g.beginPath(); g.ellipse(px - 2 * s, py - 8.5 * s + bob * 0.5, 5 * s, 2.4 * s, 0, 0, 7); g.fill();
    outlined(g, hcol, () => {
      g.beginPath();
      g.moveTo(px + 6 * s * faceL, py - 9 * s + bob * 0.5);
      g.quadraticCurveTo(px + 10 * s * faceL, py - 13 * s + bob * 0.5, px + 11 * s * faceL, py - 11 * s + bob * 0.5);
      g.lineTo(px + 12 * s * faceL, py - 8.5 * s + bob * 0.5);
      g.quadraticCurveTo(px + 9 * s * faceL, py - 7.5 * s + bob * 0.5, px + 6 * s * faceL, py - 6.5 * s + bob * 0.5);
      g.closePath();
    });
    // ear + tail
    g.strokeStyle = '#42332a'; g.lineWidth = 1.1 * s;
    g.beginPath(); g.moveTo(px + 10.4 * s * faceL, py - 13 * s + bob * 0.5); g.lineTo(px + 11.2 * s * faceL, py - 14.6 * s + bob * 0.5); g.stroke();
    g.beginPath(); g.moveTo(px - 9 * s * faceL, py - 8 * s + bob * 0.5);
    g.quadraticCurveTo(px - 12 * s * faceL, py - 5 * s + bob * 0.5, px - 11 * s * faceL, py - 1 * s); g.stroke();
    // caparison in team color for knights
    if (u.type !== 'scout') {
      g.fillStyle = col;
      g.beginPath(); g.ellipse(px, py - 6.5 * s + bob * 0.5, 8 * s, 3.4 * s, 0, 0, Math.PI); g.fill();
    }
  }
  const by = mounted ? py - 12 * s + bob * 0.5 : py + bob;
  if (!mounted) {
    // walking legs
    g.strokeStyle = 'rgba(35,28,20,0.9)'; g.lineWidth = 2 * s;
    const lp = moving ? Math.sin(G.time * 13 + u.id) * 2.4 * s : 0;
    g.beginPath(); g.moveTo(px - 1.5 * s, by - 3 * s); g.lineTo(px - 1.5 * s - lp, py); g.stroke();
    g.beginPath(); g.moveTo(px + 1.5 * s, by - 3 * s); g.lineTo(px + 1.5 * s + lp, py); g.stroke();
  }
  // torso with outline + highlight
  outlined(g, col, () => { g.beginPath(); g.ellipse(px, by - 7 * s, 4 * s, 5.5 * s, 0, 0, 7); });
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath(); g.ellipse(px - 1.4 * s, by - 8.6 * s, 1.8 * s, 2.6 * s, -0.4, 0, 7); g.fill();
  // arms hint
  g.strokeStyle = 'rgba(20,16,10,0.35)'; g.lineWidth = 1 * s;
  g.beginPath(); g.moveTo(px - 3.4 * s, by - 8 * s); g.lineTo(px - 4 * s, by - 4.5 * s); g.stroke();
  // head
  g.fillStyle = '#e8c39c';
  g.beginPath(); g.arc(px, by - 14 * s, 3 * s, 0, 7); g.fill();
  g.strokeStyle = 'rgba(20,16,10,0.4)'; g.lineWidth = 0.7; g.stroke();
  // headgear by class
  if (d.cls === 'inf' || u.type === 'knight') {
    g.fillStyle = '#c4cbd4';
    g.beginPath(); g.arc(px, by - 15 * s, 3.1 * s, Math.PI, 0); g.fill();
    g.fillStyle = '#8f99a6';
    g.fillRect(px - 3.1 * s, by - 15 * s, 6.2 * s, 1 * s);
    if (u.type === 'knight' || u.type === 'guard') { // plume
      g.fillStyle = col;
      g.beginPath(); g.arc(px, by - 17.6 * s, 1.2 * s, 0, 7); g.fill();
    }
  } else if (d.cls === 'arch') {
    g.fillStyle = '#5c6e3c';
    g.beginPath(); g.arc(px, by - 15.5 * s, 3 * s, Math.PI, 0); g.fill();
    g.fillStyle = '#48562f';
    g.beginPath(); g.moveTo(px + 2.4 * s, by - 16 * s); g.lineTo(px + 5 * s, by - 17.5 * s); g.lineTo(px + 3 * s, by - 15 * s); g.closePath(); g.fill();
  } else if (d.cls === 'vill') {
    g.fillStyle = '#a3814f';
    g.beginPath(); g.ellipse(px, by - 16 * s, 3.6 * s, 1.3 * s, 0, 0, 7); g.fill();
    g.fillStyle = '#8a6b40';
    g.beginPath(); g.arc(px, by - 16.4 * s, 1.8 * s, Math.PI, 0); g.fill();
  } else if (u.type === 'scout') {
    g.fillStyle = '#8a6b47';
    g.beginPath(); g.arc(px, by - 15 * s, 3 * s, Math.PI, 0); g.fill();
  }
  // shield on off-hand for infantry
  if (d.cls === 'inf' && u.type !== 'spearman') {
    g.fillStyle = col;
    g.beginPath(); g.arc(px - 4.6 * s * faceL, by - 7 * s, 2.8 * s, 0, 7); g.fill();
    g.strokeStyle = '#e0d8c0'; g.lineWidth = 0.8; g.stroke();
    g.fillStyle = '#e0d8c0'; g.beginPath(); g.arc(px - 4.6 * s * faceL, by - 7 * s, 0.9 * s, 0, 7); g.fill();
  }
  // weapon
  const wx = px + 5 * s * faceL, wy = by - 8 * s;
  if (u.type === 'militia' || u.type === 'guard' || u.type === 'knight') {
    g.strokeStyle = '#d9dee4'; g.lineWidth = 1.6 * s;
    g.beginPath(); g.moveTo(wx, wy + 2 * s); g.lineTo(wx + 4 * s * faceL, wy - 8 * s); g.stroke();
    g.strokeStyle = '#8a6b40'; g.lineWidth = 1.2 * s;
    g.beginPath(); g.moveTo(wx - 1.2 * s, wy + 0.5 * s); g.lineTo(wx + 1.6 * s, wy + 1.6 * s); g.stroke();
  } else if (u.type === 'spearman') {
    g.strokeStyle = '#9c7a4a'; g.lineWidth = 1.3 * s;
    g.beginPath(); g.moveTo(wx - 3 * s * faceL, wy + 6 * s); g.lineTo(wx + 4 * s * faceL, wy - 11 * s); g.stroke();
    g.fillStyle = '#c9ced4';
    g.beginPath(); g.moveTo(wx + 4 * s * faceL, wy - 11 * s); g.lineTo(wx + 5.6 * s * faceL, wy - 14.5 * s); g.lineTo(wx + 2.5 * s * faceL, wy - 12.4 * s); g.closePath(); g.fill();
  } else if (d.cls === 'arch') {
    g.strokeStyle = '#8a6b40'; g.lineWidth = 1.3 * s;
    g.beginPath(); g.arc(wx, wy, 4.5 * s, u.dir - 1.2, u.dir + 1.2); g.stroke();
    g.strokeStyle = 'rgba(230,225,210,0.8)'; g.lineWidth = 0.7 * s;
    g.beginPath();
    g.moveTo(wx + Math.cos(u.dir - 1.2) * 4.5 * s, wy + Math.sin(u.dir - 1.2) * 4.5 * s);
    g.lineTo(wx + Math.cos(u.dir + 1.2) * 4.5 * s, wy + Math.sin(u.dir + 1.2) * 4.5 * s);
    g.stroke();
    // quiver
    g.fillStyle = '#6b4a2a';
    g.fillRect(px - 4.5 * s * faceL - 1 * s, by - 11 * s, 2 * s, 4.5 * s);
  } else if (d.cls === 'vill' && (u.task === 'gather' || u.task === 'build' || u.task === 'farm')) {
    g.strokeStyle = '#9c7a4a'; g.lineWidth = 1.3 * s;
    const swing = Math.sin(G.time * 9 + u.id) * 0.8;
    g.beginPath(); g.moveTo(wx, wy + 2 * s); g.lineTo(wx + Math.cos(swing) * 6 * s * faceL, wy - Math.abs(Math.sin(swing)) * 7 * s); g.stroke();
    g.fillStyle = '#c9ced4';
    g.beginPath(); g.arc(wx + Math.cos(swing) * 6 * s * faceL, wy - Math.abs(Math.sin(swing)) * 7 * s, 1.4 * s, 0, 7); g.fill();
  }
  // carrying indicator
  if (u.carry >= 1) {
    g.fillStyle = { wood: '#9c7a4a', food: '#d0405e', gold: '#f0cf46', stone: '#a5a5a5' }[u.carryType] || '#fff';
    g.fillRect(px - 2.5 * s, by - 3.5 * s, 5 * s, 3.5 * s);
    g.strokeStyle = 'rgba(20,16,10,0.4)'; g.lineWidth = 0.6;
    g.strokeRect(px - 2.5 * s, by - 3.5 * s, 5 * s, 3.5 * s);
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
  const wFrame = ((G.time * 2.5) | 0) % 3;
  // terrain, edge blending, fog
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
      const t = G.map.terr[i];
      const variant = (tx * 31 + ty * 17) & 3;
      const frame = t === T_WATER ? (wFrame + ((tx * 7 + ty * 13) % 3)) % 3 : 0;
      const dx = px - TW2 * z - 1, dy = py - TH2 * z - 1;
      ctx.drawImage(tileSprite(t, variant, frame), dx, dy, tw, th);
      // blend in higher-priority neighbors; foam where water meets land.
      // Land blending is invisible when zoomed far out — skip it there.
      const myPrio = TERRAIN_PRIO[t];
      const detail = z >= 0.95;
      for (let dir = 0; dir < 4; dir++) {
        const nx = tx + FRINGE_DIRS[dir][0], ny = ty + FRINGE_DIRS[dir][1];
        if (!inMap(nx, ny)) continue;
        const nt = G.map.terr[tIdx(nx, ny)];
        if (nt === t) continue;
        if (detail && t !== T_WATER && TERRAIN_PRIO[nt] > myPrio) ctx.drawImage(fringeSprite(nt, dir), dx, dy, tw, th);
        if (t === T_WATER && nt !== T_WATER) ctx.drawImage(foamSprite(dir), dx, dy, tw, th);
      }
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
        ctx.strokeStyle = 'rgba(240,255,235,0.95)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(px, py, 9 * z, 4.5 * z, 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,220,120,0.4)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(px, py, 10.5 * z, 5.4 * z, 0, 0, 7); ctx.stroke();
      }
      drawUnit(ctx, e, px, py, z * 0.95);
      // conversion ring while a monk chants at this unit
      if (e.beingConverted && G.time - e.beingConverted < 0.4) {
        ctx.strokeStyle = `rgba(255,220,120,${0.5 + 0.3 * Math.sin(G.time * 9)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(px, py, 8 * z, 4 * z, 0, 0, 7); ctx.stroke();
      }
      e.moved = false;
      if (e.hp < e.maxhp || UI.selection.includes(e)) drawHpBar(px, py - 24 * z, 22 * z, e.hp / e.maxhp);
    } else drawEffect(e, z);
  }

  // projectiles
  for (const p of G.projectiles) {
    if (!tileVisible(p.x, p.y) && !tileVisible(p.gx, p.gy)) continue;
    const [px, py] = worldToScreen(p.x, p.y);
    const arc = Math.sin(Math.min(1, p.t * p.speed / Math.max(1, Math.hypot(p.gx - p.sx, p.gy - p.sy))) * Math.PI) * 14 * z;
    const ang = Math.atan2(p.gy - p.y, p.gx - p.x);
    ctx.beginPath();
    if (p.splash) {
      ctx.fillStyle = '#3a352c';
      ctx.arc(px, py - arc, 2.5 * z, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.5 * z;
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

function drawBuilding(b, z) {
  const d = BUILDINGS[b.type];
  const [px, py] = worldToScreen(b.tx + b.size / 2, b.ty + b.size / 2);
  const spr = buildingSprite(b.type, b.owner, b.done);
  // sprite css size; its diamond center sits at y = cssH - (size+1)*TH2 within the sprite
  const cssW = spr.width / 2, cssH = spr.height / 2;
  const baseY = cssH - (b.size + 1) * TH2;
  ctx.drawImage(spr, px - cssW / 2 * z, py - baseY * z, cssW * z, cssH * z);
  if (UI.selection.includes(b)) {
    ctx.strokeStyle = 'rgba(240,255,235,0.95)'; ctx.lineWidth = 2;
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
    ctx.fillStyle = `rgba(90,80,70,${fx.t / 0.4 * 0.5})`;
    ctx.beginPath(); ctx.arc(px - 4 * z, py - 6 * z, (0.5 - fx.t) * 30 * z, 0, 7); ctx.fill();
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
    const sz = fx.size * TW2 * 0.7 * z;
    ctx.beginPath(); ctx.ellipse(px, py, sz, sz / 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(50,44,38,${Math.min(0.7, fx.t / 4)})`;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(px + Math.cos(i * 1.7) * sz * 0.4, py + Math.sin(i * 1.7) * sz * 0.2, sz * 0.12, 0, 7);
      ctx.fill();
    }
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
  mmCtx.fillStyle = '#0a0d11';
  mmCtx.fillRect(0, 0, W, H);
  const img = mmCtx;
  const px = (x, y) => [(x - y + MAP_H) / (MAP_W + MAP_H) * W, (x + y) / (MAP_W + MAP_H) * H];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = tIdx(x, y);
    if (!G.explored[i]) continue;
    const r = G.map.res[i];
    img.fillStyle = r ? (r.rtype === 'tree' ? '#2c5426' : r.rtype === 'gold' ? '#e3c33f' : r.rtype === 'stone' ? '#9a9a9a' : r.rtype === 'fish' ? '#5a8fc4' : '#b0405a')
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
    img.fillStyle = G.players[u.owner].color;
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
