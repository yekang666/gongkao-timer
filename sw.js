const CACHE_PREFIX = 'gongkao-timer-';
const CACHE_NAME = `${CACHE_PREFIX}v2.31.9`;
const APP_MODULES = ['analytics', 'app-events', 'audio', 'backup', 'backup-reminder', 'core', 'exam', 'format', 'launch', 'main', 'metrics', 'mock', 'pacing', 'pip', 'predict', 'reasons', 'records', 'render', 'sections', 'speed', 'stats', 'timer', 'ui'];
const FRESH_APP_FILES = new Set(['index.html', 'styles.css', 'manifest.webmanifest', ...APP_MODULES.map(name => `${name}.js`)]);
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  ...APP_MODULES.map(name => `./js/${name}.js`),
  './manifest.webmanifest',
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
      return response;
    }

    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const appShell = await caches.match('./index.html');
      if (appShell) return appShell;
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const appShell = await caches.match('./index.html');
      if (appShell) return appShell;
    }
    throw error;
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
