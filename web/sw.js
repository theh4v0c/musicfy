'use strict';
// MUSICFY offline layer. Caches the app shell, library JSON and explicitly saved
// audio so the app opens and plays from the device with no network.
// Service workers require HTTPS (Pangolin) or localhost.
const SHELL = 'mf-shell-v4';
const AUDIO = 'mf-audio-v2';
const API = 'mf-api-v2';
const AUDIO_KEYS = () => caches.open(AUDIO);
// which track ids have an offline copy, for the UI list
const AUDIO_IDS = new Set();
async function indexAudio() {
  try {
    const c = await caches.open(AUDIO);
    for (const r of await c.keys()) {
      const m = r.url.match(/\/offline\/(\d+)$/);
      if (m) AUDIO_IDS.add(Number(m[1]));
    }
  } catch {}
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, AUDIO, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => indexAudio())
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
        if (r.ok) { await c.put(offlineKey(d.id), r.clone()); AUDIO_IDS.add(Number(d.id)); reply({ type: 'offline-set', id: d.id, on: true, bytes: Number(r.headers.get('content-length')) || 0 }); }
        else reply({ type: 'offline-fail', id: d.id });
      } catch { reply({ type: 'offline-fail', id: d.id }); }
    }));
  }
  if (d.type === 'uncache-track' && d.id != null) {
    e.waitUntil(AUDIO_KEYS().then((c) => c.delete(offlineKey(d.id))).then(() => { AUDIO_IDS.delete(Number(d.id)); reply({ type: 'offline-set', id: d.id, on: false }); }));
  }
  if (d.type === 'list-offline') {
    e.waitUntil(AUDIO_KEYS().then(async (c) => {
      const keys = await c.keys();
      const ids = keys.map((r) => { const m = r.url.match(/\/offline\/(\d+)$/); return m ? Number(m[1]) : null; }).filter(Boolean);
      reply({ type: 'offline-list', ids });
    }));
  }
  if (d.type === 'clear-offline') {
    e.waitUntil(caches.delete(AUDIO).then(() => { AUDIO_IDS.clear(); reply({ type: 'offline-list', ids: [] }); }));
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // saved audio only. Normal streams never touch the worker: a proxied byte stream costs
  // a copy of every byte and dies with the worker when the phone locks, which is exactly
  // the "plays only while unlocked" failure. Saved tracks ask for this path instead.
  if (url.pathname.startsWith('/offline-audio/')) {
    const id = Number(url.pathname.split('/').pop());
    e.respondWith(AUDIO_KEYS().then(async (c) => {
      const hit = await c.match(offlineKey(id));
      // not saved after all: let the server answer, range included
      if (!hit) return fetch('/api/stream/' + id + url.search, { headers: req.headers });
      const range = req.headers.get('range');
      // the media element always asks for a byte range: answer it properly or seeking
      // inside a saved track jumps back to the start
      if (!range) return hit;
      const m = range.match(/bytes=(\d*)-(\d*)/);
      if (!m) return hit;
      const buf = await hit.arrayBuffer();
      const size = buf.byteLength;
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (!(start < size) || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      return new Response(buf.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-type': hit.headers.get('content-type') || 'audio/mpeg',
          'accept-ranges': 'bytes',
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'cache-control': 'private, max-age=86400',
        },
      });
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

  // the shell bundle is stale-while-revalidate: an old tab still opens instantly,
  // and the next load runs the current CSS/JS even when the URL did not change
  if (url.pathname === '/app.css' || url.pathname === '/app.js' || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // other static assets: cache-first, fill on first use
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
    return r;
  }).catch(() => hit)));
});
