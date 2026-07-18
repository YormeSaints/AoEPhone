'use strict';
// Cache-first service worker: after the first visit the game runs fully offline.
const CACHE = 'empirephone-v5';
const ASSETS = [
  '.', 'index.html', 'manifest.json', 'icon.png', 'icon-512.png',
  'js/data.js', 'js/engine.js', 'js/saves.js', 'js/ai.js', 'js/render.js', 'js/input.js', 'js/ui.js', 'js/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
