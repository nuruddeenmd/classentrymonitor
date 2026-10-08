/* Service worker: makes the app open offline, and syncs queued entries when signal returns. */
const CACHE = 'class-entry-v2';   // bump this number when you change app files
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'config.js',
               'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

importScripts('config.js', 'core.js');

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // add files one by one so a single missing file cannot stop the whole install
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Same-origin files: serve from cache instantly, refresh the cache in the background.
self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // never touch the Apps Script calls
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        const net = fetch(req).then(function (resp) {
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});

// Background sync (Android Chrome): runs when the phone regains signal, even if the app is closed.
self.addEventListener('sync', function (e) {
  if (e.tag !== 'ce-sync') return;
  e.waitUntil(self.Core.syncNow().then(function (r) { if (!r.ok && r.error === 'network') throw new Error('retry'); }));
});
