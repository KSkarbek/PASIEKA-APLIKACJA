const CACHE_NAME = 'pasieka-v9-sync';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=8.0',
  './styles.css?v=8.0',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) {
    return;
  }
  // Strategia Network-First (Zawsze pobieraj najnowszą wersję z GitHuba, a gdy brak sieci - użyj cache)
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, respClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(e.request))
  );
});
