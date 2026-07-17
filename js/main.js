'use strict';
// ============================================================
// Bootstrap + game loop.
// ============================================================

let paused = false, lastFrame = 0, uiRefreshT = 0, gameSpeed = 1;

let autosaveT = 0;

function startGame(difficulty, opponents) {
  clearSave();
  newGame(difficulty, opponents);
  spriteCache.clear();
  UI.selection = [];
  UI.placing = null;
  const tc = G.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
  centerCamOn(tc.tx + 1.5, tc.ty + 1.5);
  cam.zoom = 1.5;
  clampCam();
  autosaveT = 30;
  hideOverlay();
  refreshPanel();
  uiToast(opponents > 1 ? 'Two rival empires stand against you. Build fast.' : 'Build up your economy — the enemy is coming.');
}

function resumeSavedGame() {
  if (!loadGame()) { uiToast('Could not load the save.'); clearSave(); showOverlay('menu'); return; }
  spriteCache.clear();
  UI.selection = [];
  UI.placing = null;
  clampCam();
  autosaveT = 30;
  hideOverlay();
  refreshPanel();
  uiToast('Game restored — carry on, chief.');
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastFrame) / 1000 || 0.016);
  lastFrame = t;
  if (G && !paused && !G.over) {
    tick(dt * gameSpeed);
    autosaveT -= dt;
    if (autosaveT <= 0) { autosaveT = 30; saveGame(); }
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
    const firstInstall = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (firstInstall) {
        (reg.installing || reg.waiting || { addEventListener: () => {} }).addEventListener('statechange', (e) => {
          if (e.target.state === 'activated') uiToast('📦 Game cached — you can now play offline.');
        });
      }
    }).catch(() => {});
  }
  // save when the app is backgrounded (iOS home-screen apps get killed freely)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && G && !G.over) saveGame();
  });
});

// prevent iOS double-tap zoom / scroll bounce outside the canvas
document.addEventListener('touchmove', (e) => { if (e.target.closest('#game')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
