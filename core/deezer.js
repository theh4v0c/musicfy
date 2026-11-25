'use strict';
// Deezer's public API needs no key and no account, and it returns the two things
// that make matching reliable: the ISRC and the exact duration.
const https = require('node:https');

const cache = new Map();
let lastCall = 0;

function throttle() {
  const wait = Math.max(0, 250 - (Date.now() - lastCall));
  return new Promise((r) => setTimeout(r, wait)).then(() => { lastCall = Date.now(); });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'MUSICFY/1.0', accept: 'application/json' }, timeout: 12000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('deezer ' + r.statusCode)); }
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { b += c; });
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('timeout', function () { this.destroy(new Error('deezer timeout')); }).on('error', reject);
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.max(A.size, B.size);
}

// canonical metadata for "artist - title", with ISRC when Deezer has it
async function canon(artist, title) {
  const key = `${norm(artist)}|${norm(title)}`;
  if (cache.has(key)) return cache.get(key);
  await throttle();
  const q = encodeURIComponent(`track:"${title}" artist:"${artist}"`);
  let data;
  try {
    data = await getJson(`https://api.deezer.com/search?q=${q}&limit=5`);
  } catch (e) {
    cache.set(key, null);
    return null;
  }
  const items = (data && data.data) || [];
  if (!items.length) { cache.set(key, null); return null; }

  let best = null;
  for (const it of items) {
    const artistScore = similarity(it.artist && it.artist.name, artist);
    const titleScore = similarity(it.title, title);
    const score = artistScore * 0.6 + titleScore * 0.4;
    if (!best || score > best.score) {
      best = {
        score,
        id: it.id,
        title: it.title,
        artist: (it.artist && it.artist.name) || '',
        album: (it.album && it.album.title) || '',
        duration: it.duration || null,
        cover: (it.album && it.album.cover_xl) || null,
      };
    }
  }
  if (!best || best.score < 0.45) { cache.set(key, null); return null; }

  // the search payload has no ISRC or BPM: one extra call for the winner
  try {
    await throttle();
    const full = await getJson(`https://api.deezer.com/track/${best.id}`);
    best.isrc = full.isrc || null;
    best.bpm = full.bpm || null;
    best.duration = full.duration || best.duration;
    best.release = full.release_date || null;
  } catch { best.isrc = null; }

  cache.set(key, best);
  return best;
}

// free text search, used when the caller only has a query string
async function search(q, limit = 8) {
  await throttle();
  const data = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch(() => null);
  return ((data && data.data) || []).map((it) => ({
    id: it.id,
    title: it.title,
    artist: (it.artist && it.artist.name) || '',
    album: (it.album && it.album.title) || '',
    duration: it.duration || null,
    cover: (it.album && it.album.cover_xl) || null,
  }));
}

// albums, not tracks: used by the album cover picker where a name like "Green"
// needs the artist attached to mean anything
async function searchAlbums(q, limit = 12) {
  await throttle();
  const data = await getJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=${limit}`).catch(() => null);
  return ((data && data.data) || []).map((it) => ({
    id: it.id,
    name: it.title || '',
    artist: (it.artist && it.artist.name) || '',
    cover: (it.cover_xl || it.cover_big || it.cover_medium) || null,
    tracks: it.nb_tracks || null,
  }));
}

// best Deezer artist for a name, then their related artists and top tracks
async function artistSearch(name) {
  const key = 'artist:' + norm(name);
  if (cache.has(key)) return cache.get(key);
  await throttle();
  const data = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=4`).catch(() => null);
  const items = (data && data.data) || [];
  let best = null;
  for (const it of items) { const s = similarity(it.name, name); if (!best || s > best.s) best = { s, id: it.id, name: it.name }; }
  const out = best && best.s >= 0.5 ? best : null;
  cache.set(key, out);
  return out;
}
async function relatedArtists(id) {
  const key = 'rel:' + id;
  if (cache.has(key)) return cache.get(key);
  await throttle();
  const data = await getJson(`https://api.deezer.com/artist/${id}/related?limit=12`).catch(() => ({ data: [] }));
  cache.set(key, data);
  return data;
}
async function artistTop(id, limit = 8) {
  const key = 'top:' + id + ':' + limit;
  if (cache.has(key)) return cache.get(key);
  await throttle();
  const data = await getJson(`https://api.deezer.com/artist/${id}/top?limit=${limit}`).catch(() => ({ data: [] }));
  cache.set(key, data);
  return data;
}

module.exports = { canon, search, searchAlbums, artistSearch, relatedArtists, artistTop };
