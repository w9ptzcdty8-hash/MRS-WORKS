const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

function harness({ cacheStore = new Map(), release, fail, fetchImpl } = {}) {
  const events = {};
  let requests = [];
  const fetch = async request => {
    requests.push(request.url);
    if (fetchImpl) return fetchImpl(request);
    if (fail && request.url.endsWith(fail)) return new Response('', { status: 503 });
    return new Response('fixture:' + request.url, { headers: { 'Content-Type': 'text/html' } });
  };
  const caches = {
    keys: async () => [...cacheStore.keys()],
    delete: async key => cacheStore.delete(key),
    open: async key => {
      if (!cacheStore.has(key)) cacheStore.set(key, new Map());
      const entries = cacheStore.get(key);
      return {
        match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
        addAll: async list => {
          for (const request of list) {
            const response = await fetch(request);
            if (!response.ok) throw Error('Precache failed');
            entries.set(request.url, response);
          }
        }
      };
    }
  };
  const context = {
    self: { location: { href: 'https://example.test/service-worker.js' }, addEventListener: (type, fn) => { events[type] = fn; } },
    caches, Request, Response, URL, AbortController, fetch, setTimeout, clearTimeout
  };
  vm.runInNewContext(release ? source.replace('20261025-1', release) : source, context);
  return {
    cacheStore, requests,
    lifecycle: async type => { let task; events[type]({ waitUntil: p => { task = p; } }); await task; },
    get: async (url, mode = 'navigate', method = 'GET') => {
      let response;
      const request = new Request(url, { method });
      Object.defineProperty(request, 'mode', { value: mode });
      events.fetch({ request, respondWith: p => { response = p; } });
      return response ? await response : undefined;
    }
  };
}

test('precache enables offline query entries and privacy aliases without any network wait', async () => {
  const h = harness();
  await h.lifecycle('install');
  assert.equal(h.requests.length, 9);
  const before = h.requests.length;
  for (const url of ['/', '/?from=home', '/index.html?x=1', '/privacy', '/privacy.html?x=1']) {
    const response = await h.get('https://example.test' + url);
    assert.equal(response.status, 200);
  }
  assert.equal(h.requests.length, before);
  assert.equal(await h.get('https://other.test/index.html'), undefined);
  assert.equal(await h.get('https://example.test/api'), undefined);
  assert.equal(await h.get('https://example.test/index.html', 'navigate', 'POST'), undefined);
});

test('failed update discards incomplete release and preserves the previous release', async () => {
  const old = harness(); await old.lifecycle('install');
  const next = harness({ cacheStore: old.cacheStore, release: '20261025-2', fail: 'icon-512.png' });
  await assert.rejects(next.lifecycle('install'));
  assert(old.cacheStore.has('mrs-works-home:/:20261025-1'));
  assert(!old.cacheStore.has('mrs-works-home:/:20261025-2'));
  assert.equal((await old.get('https://example.test/')).status, 200);
});

test('activation removes only older caches belonging to this home and path', async () => {
  const h = harness(); await h.lifecycle('install');
  h.cacheStore.set('other-app-v1', new Map());
  h.cacheStore.set('mrs-works-home:/another/:old', new Map());
  const next = harness({ cacheStore: h.cacheStore, release: '20261025-2' });
  await next.lifecycle('install');
  assert(h.cacheStore.has('mrs-works-home:/:20261025-1'), 'install must retain active release');
  await next.lifecycle('activate');
  assert(!h.cacheStore.has('mrs-works-home:/:20261025-1'));
  assert(h.cacheStore.has('other-app-v1'));
  assert(h.cacheStore.has('mrs-works-home:/another/:old'));
  assert(h.cacheStore.has('mrs-works-home:/:20261025-2'));
  assert(!source.includes('self.skipWaiting('));
  assert(!source.includes('self.clients.claim('));
  assert(!source.includes('localStorage'));
});

test('missing cache, network errors and HTTP errors yield actionable navigation fallback', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => new Response('', { status: 500 })]) {
    const h = harness({ fetchImpl });
    const response = await h.get('https://example.test/');
    assert.equal(response.status, 503);
    assert((await response.text()).includes('再読み込み'));
  }
});

test('hanging connection is aborted after four seconds', async () => {
  const h = harness({ fetchImpl: request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true });
  }) });
  const before = Date.now();
  const response = await h.get('https://example.test/');
  assert.equal(response.status, 503);
  assert(Date.now() - before >= 3900);
  assert(Date.now() - before < 6000);
});

test('manifest references real correctly sized PNGs and registration precedes isolated ads', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
  assert.equal(manifest.name, 'MRS WORKS');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes);
  }
  assert(fs.readFileSync(path.join(root, 'assets/mrs-works-logo.png')).length > 0);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(html.includes('updateViaCache: \'none\''));
  assert(html.indexOf('serviceWorker.register') < html.indexOf('<iframe'));
  assert(html.includes('srcdoc='));
  assert(!html.includes('<script src="https://adm.shinobi.jp'));
});
