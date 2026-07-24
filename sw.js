const CACHE_PREFIX = 'gongkao-timer-';
const CACHE_NAME = `${CACHE_PREFIX}v2.14.0`;
const FRESH_APP_FILES = new Set(['index.html', 'styles.css', 'app.js', 'manifest.webmanifest']);
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './pip-countdown.mp4',
  './pip-stopwatch.mp4',
  './assets/app-icon.png',
  './assets/app-icon-192.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-16.png',
  './assets/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || caches.match('./index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function cachedRange(request) {
  const cached = await caches.match(request.url);
  if (!cached) return fetch(request);
  const match = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get('range') || '');
  if (!match) return cached;
  const data = await cached.arrayBuffer();
  const size = data.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const body = data.slice(start, end + 1);
  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(body.byteLength));
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  return new Response(body, { status: 206, statusText: 'Partial Content', headers });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.has('range')) {
    event.respondWith(cachedRange(request));
    return;
  }
  const fileName = url.pathname.split('/').pop();
  event.respondWith(request.mode === 'navigate' || FRESH_APP_FILES.has(fileName) ? networkFirst(request) : cacheFirst(request));
});
