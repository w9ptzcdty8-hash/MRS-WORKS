(() => {
  'use strict';
  const script = document.currentScript;
  if (!script) return;
  const site = script.dataset.siteId;
  const key = 'mrs.analytics.daily.' + site;
  const host = {'tools-home':'mrs-tools.pages.dev','works-home':'mrs-works.pages.dev','games-home':'mrs-games.pages.dev'}[site];
  if (!host) return;
  const production = location.origin === 'https://' + host;
  const preview = location.hostname.endsWith('.' + host) && /^[a-z0-9-]+$/.test(location.hostname.slice(0,-host.length-1));
  if (!['/','/index.html'].includes(location.pathname) || (!production && !preview)) return;
  const endpoint = production
    ? 'https://mrs-analytics.mrsworkspjt.workers.dev/v1/collect'
    : 'https://mrs-analytics-preview.mrsworkspjt.workers.dev/v1/collect';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function visitor(day) {
    try {
      const old = JSON.parse(localStorage.getItem(key) || 'null');
      if (old && old.day === day && uuid.test(old.id)) return old.id;
      const id = crypto.randomUUID();
      localStorage.setItem(key, JSON.stringify({day, id}));
      return id;
    } catch { return null; }
  }
  async function send() {
    if (navigator.onLine === false) return;
    try {
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
      const data = {site_id:site, event_id:crypto.randomUUID(), day_jst:day, visitor_id:visitor(day)};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        await fetch(endpoint, {method:'POST', mode:'cors', credentials:'omit',
          referrerPolicy:'no-referrer', cache:'no-store', keepalive:true,
          headers:{'Content-Type':'text/plain;charset=UTF-8'},
          body:JSON.stringify(data), signal:controller.signal});
      } finally { clearTimeout(timeout); }
    } catch { /* No queue, retry, UI error, or dependency on analytics. */ }
  }
  let sent = false;
  function start() {
    if (sent || document.visibilityState !== 'visible') return;
    sent = true;
    setTimeout(() => { void send(); }, 0);
  }
  document.addEventListener('visibilitychange', start);
  start();
})();
