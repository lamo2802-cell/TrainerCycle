// Minimal service worker — mainly here to satisfy PWA installability requirements
// (Chrome requires a registered service worker with a fetch handler before it will
// offer "Add to Home Screen" / allow TWA wrapping). Network-first, no offline caching
// yet — this app needs a live connection anyway (Supabase, Bluetooth) to be useful.
// It also shows session reminders sent by the send-reminders edge function (see reminders.js).

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

// Session reminders: { title, body, url, tag, actions? }. The 'move' action opens Today ready to move
// the missed session to tomorrow.
self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (_) { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || 'TrainerCycle', {
    body: m.body || '', tag: m.tag, icon: '/icon-192.png',
    data: { url: m.url || '/index.html' }, actions: m.actions || [],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = (event.notification.data && event.notification.data.url) || '/index.html';
  if (event.action === 'move') url += (url.includes('?') ? '&' : '?') + 'confirm=1';
  url = new URL(url, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin) && 'navigate' in c);
    if (open) return open.navigate(url).then((c) => (c || open).focus().catch(() => {}), () => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
