'use strict';
// ============================================================
// Bootstrap + game loop.
// ============================================================

let paused = false, lastFrame = 0, uiRefreshT = 0, gameSpeed = 1;

function startGame(difficulty) {
  newGame(difficulty);
  spriteCache.clear();
  UI.selection = [];
  UI.placing = null;
  const tc = G.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
  centerCamOn(tc.tx + 1.5, tc.ty + 1.5);
  cam.zoom = 1.5;
  clampCam();
  hideOverlay();
  refreshPanel();
  uiToast('Build up your economy — the enemy is coming.');
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastFrame) / 1000 || 0.016);
  lastFrame = t;
  if (G && !paused && !G.over) {
    tick(dt * gameSpeed);
    if (G.over) {
      showOverlay(G.over);
      sfx(G.over === 'victory' ? 'age' : 'boom');
    }
  }
  if (G) {
    render();
    uiRefreshT -= dt;
    if (uiRefreshT <= 0) {
      uiRefreshT = 0.25;
      updateTopBar();
      refreshPanelLive(); // updates info text; rebuilds buttons only on change
    }
  }
}

window.addEventListener('load', () => {
  initRender();
  initMinimap();
  initInput();
  initUI();
  showOverlay('menu');
  document.addEventListener('pointerdown', ensureAudio, { once: true });
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// prevent iOS double-tap zoom / scroll bounce outside the canvas
document.addEventListener('touchmove', (e) => { if (e.target.closest('#game')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
