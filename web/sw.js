'use strict';
// MUSICFY offline layer. Caches the app shell, library JSON and explicitly saved
// audio so the app opens and plays from the device with no network.
// Service workers require HTTPS (Pangolin) or localhost.
const SHELL = 'mf-shell-v2';
const AUDIO = 'mf-audio-v2';
const API = 'mf-api-v2';
const AUDIO_KEYS = () => caches.open(AUDIO);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, AUDIO, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function offlineKey(id) { return '/offline/' + id; }

self.addEventListener('message', (e) => {
  const d = e.data || {};
  const reply = (msg) => { try { if (e.source) e.source.postMessage(msg); } catch {} };
  if (d.type === 'cache-track' && d.id != null) {
    e.waitUntil(AUDIO_KEYS().then(async (c) => {
      try {
        const r = await fetch('/api/tracks/' + d.id + '/file', { credentials: 'same-origin' });
        if (r.ok) { await c.put(offlineKey(d.id), r.clone()); reply({ type: 'offline-set', id: d.id, on: true, bytes: Number(r.headers.get('content-length')) || 0 }); }
        else reply({ type: 'offline-fail', id: d.id });
      } catch { reply({ type: 'offline-fail', id: d.id }); }
    }));
  }
  if (d.type === 'uncache-track' && d.id != null) {
    e.waitUntil(AUDIO_KEYS().then((c) => c.delete(offlineKey(d.id))).then(() => reply({ type: 'offline-set', id: d.id, on: false })));
  }
  if (d.type === 'list-offline') {
    e.waitUntil(AUDIO_KEYS().then(async (c) => {
      const keys = await c.keys();
      const ids = keys.map((r) => { const m = r.url.match(/\/offline\/(\d+)$/); return m ? Number(m[1]) : null; }).filter(Boolean);
      reply({ type: 'offline-list', ids });
    }));
  }
  if (d.type === 'clear-offline') {
    e.waitUntil(caches.delete(AUDIO).then(() => reply({ type: 'offline-list', ids: [] })));
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // saved audio: serve the full cached file for the stream endpoint (works offline)
  if (url.pathname.startsWith('/api/stream/')) {
    const id = url.pathname.split('/').pop();
    e.respondWith(AUDIO_KEYS().then(async (c) => {
      const hit = await c.match(offlineKey(id));
      if (hit) return hit;
      try { return await fetch(req); } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // app shell: network first, cached index when offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // library data: stale-while-revalidate so the list loads offline
  if (url.pathname.startsWith('/api/')) {
    if (['/api/tracks', '/api/playlists', '/api/likes', '/api/likes/full'].includes(url.pathname)) {
      e.respondWith(caches.open(API).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
        return hit || net;
      }));
    }
    return; // other API stays network-only
  }

  // static assets: cache-first, fill on first use
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return r;
  }).catch(() => hit)));
});
