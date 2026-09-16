// Minimal service worker — mainly here to satisfy PWA installability requirements
// (Chrome requires a registered service worker with a fetch handler before it will
// offer "Add to Home Screen" / allow TWA wrapping). Network-first, no offline caching
// yet — this app needs a live connection anyway (Supabase, Bluetooth) to be useful.

const CACHE_NAME = 'trainercycle-v1';
const PRECACHE = ['/logo.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
