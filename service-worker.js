'use strict';

// Change RELEASE whenever a cached file changes. Keep the previous worker in
// control until all its pages close; do not mix releases with skipWaiting/claim.
const RELEASE = '20261025-ad-band-2';
const BASE = new URL('./', self.location.href);
const PREFIX = 'mrs-works-home:' + BASE.pathname + ':';
const CACHE = PREFIX + RELEASE;
const FILES = [
  'index.html', 'privacy.html', 'analytics.js', 'manifest.webmanifest',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png', 'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-32.png'
];
const ALLOWED = new Set(FILES.map(file => new URL(file, BASE).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(FILES.map(file => new Request(new URL(file, BASE), { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error; // A partial download must not replace the working release.
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
  })());
});

async function networkWithTimeout(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(new Request(request, { signal: controller.signal }));
    if (!response.ok) throw new Error('HTTP ' + response.status);
    // Read the complete body while the timeout is still active.
    return new Response(await response.arrayBuffer(), {
      status: response.status, statusText: response.statusText, headers: response.headers
    });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin) return; // Never cache ads, analytics APIs or other apps.
  const canonical = new URL(url.pathname, BASE.origin);
  if (canonical.pathname === BASE.pathname) canonical.pathname += 'index.html';
  if (canonical.pathname === new URL('privacy', BASE).pathname) canonical.pathname += '.html';
  if (!ALLOWED.has(canonical.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(canonical.href);
    if (saved) return saved; // No network wait, including weak/blackholed connections.
    try {
      return await networkWithTimeout(request);
    } catch {
      if (request.mode === 'navigate') {
        return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MRS WORKS</title><body style="background:#121212;color:white;font:16px sans-serif;padding:24px"><h1>MRS WORKS</h1><p>ページを読み込めませんでした。通信が戻ってから再読み込みしてください。</p><button onclick="location.reload()">再読み込み</button></body></html>', {
          status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('', { status: 503 });
    }
  })());
});
