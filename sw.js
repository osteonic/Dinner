// Offline support: always try the network first, and keep the last good copy of
// every file so the app (plan, groceries, recipes) still opens with no signal.
const CACHE = 'dinner-v1';
const SHELL = ['./', 'index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'data/recipes.enc.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      // Offline: serve the saved copy (a page navigation falls back to the app itself).
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' && await cache.match('index.html'))
        || Response.error();
    }
  })());
});
