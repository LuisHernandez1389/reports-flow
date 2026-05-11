/* service-worker.js - ProjectFlow PWA */
'use strict';

const CACHE_VERSION = 'projectflow-v7';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const OFFLINE_URL = './offline.html';

const STATIC_ASSETS = [
  './',
  './index.html',
  './viewer.html',
  './offline.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/ui.js',
  './js/projects.js',
  './js/daily.js',
  './js/reports.js',
  './js/data-utils.js',
  './js/ai-voice.js',
  './js/voice-automation.js',
  './js/ai-descriptions.js',
  './js/deadline-notifications.js',
  './js/supabase-storage.js',
  './js/supabase-data.js',
  './js/mode.js',
  './js/auth.js',
  './js/pwa.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/?view=projects';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});

function isSameOrigin(requestUrl) {
  return new URL(requestUrl).origin === self.location.origin;
}

function shouldBypass(request) {
  const url = new URL(request.url);
  if (!isSameOrigin(request.url)) return true;
  if (url.pathname.startsWith('/storage/v1/')) return true;
  if (url.pathname.startsWith('/functions/v1/')) return true;
  if (url.pathname.startsWith('/rest/v1/')) return true;
  return false;
}

async function networkFirstPages(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

async function staleWhileRevalidateStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await fetchPromise;
  return fresh || caches.match(OFFLINE_URL);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (shouldBypass(request)) return;

  const accept = request.headers.get('accept') || '';
  const isDoc = request.mode === 'navigate' || accept.includes('text/html');

  if (isDoc) {
    event.respondWith(networkFirstPages(request));
    return;
  }

  event.respondWith(staleWhileRevalidateStatic(request));
});
