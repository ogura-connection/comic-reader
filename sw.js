// App-shell cache so the reader launches offline. Comics themselves live in
// IndexedDB (never touched here). Heavy libs (pdf.js, libarchive) are cached
// lazily on first use via the runtime cache-first handler below.
const CACHE = 'comic-reader-v4';
const CORE = [
  './', 'index.html', 'app.css', 'app.js',
  'lib/library.js', 'lib/archive.js', 'lib/thumb.js', 'lib/reader.js',
  'vendor/zipjs/zip.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/fonts/fraunces-400.woff2', 'vendor/fonts/fraunces-400i.woff2',
  'vendor/fonts/fraunces-600.woff2', 'vendor/fonts/fraunces-700.woff2',
  'vendor/fonts/hanken-400.woff2', 'vendor/fonts/hanken-500.woff2',
  'vendor/fonts/hanken-600.woff2', 'vendor/fonts/hanken-700.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
