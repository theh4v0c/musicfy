'use strict';
// MusicBrainz lookup: free, no account, gives ISRC and canonical duration.
const https = require('node:https');

const UA = 'MUSICFY/1.0 ( self-hosted music; contact: local )';
const cache = new Map();       // "artist|title" -> { isrc, duration, at }
let lastCall = 0;

function throttle() {
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));
  return new Promise((r) => setTimeout(r, wait)).then(() => { lastCall = Date.now(); });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA, accept: 'application/json' }, timeout: 15000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('mb ' + r.statusCode)); }
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('timeout', function () { this.destroy(new Error('mb timeout')); }).on('error', reject);
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function lookup(artist, title) {
  if (!artist || !title) return null;
  const key = `${norm(artist)}|${norm(title)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600 * 1000) return hit;

  await throttle();
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  let data;
  try {
    data = await get(`https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=5`);
  } catch (e) {
    if (/503|429/.test(String(e.message))) {
      await new Promise((r) => setTimeout(r, 2500));
      try { data = await get(`https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=5`); } catch (e2) { /* fall through */ }
    }
  }
  if (!data) {
    cache.set(key, { isrc: null, duration: null, at: Date.now() - 6.9 * 24 * 3600 * 1000, err: String(e.message) });
    return cache.get(key);
  }
  const recs = data.recordings || [];
  let best = null;
  for (const r of recs) {
    const dur = r.length ? r.length / 1000 : null;
    const score = Number(r.score || 0);
    if (!best || score > best.score) {
      best = {
        score, dur,
        isrc: (r.isrcs && r.isrcs[0]) || null,
        mbid: r.id,
        title: r.title || null,
        artist: (r['artist-credit'] && r['artist-credit'][0] && r['artist-credit'][0].name) || null,
      };
    }
  }
  if (best && !best.isrc && best.mbid) {
    try {
      await throttle();
      const full = await get(`https://musicbrainz.org/ws/2/recording/${best.mbid}?inc=isrcs&fmt=json`);
      if (full && Array.isArray(full.isrcs) && full.isrcs.length) best.isrc = full.isrcs[0];
      if (full && full.length && !best.dur) best.dur = full.length / 1000;
    } catch {}
  }
  const out = { isrc: best ? best.isrc : null, duration: best ? best.dur : null, at: Date.now(), confidence: best ? best.score : 0 };
  cache.set(key, out);
  return out;
}

// resolve a free text query to one canonical recording, with ISRC when MusicBrainz has it
async function resolve(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const key = `q:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600 * 1000) return hit;

  // MusicBrainz answers 503 to bare multi word queries but is fine with field syntax,
  // so always send a fielded query: "artist - title" when we can see it, else title only
  let url;
  const dash = q.match(/^(.+?)\s+-\s+(.+)$/);
  if (dash) {
    url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(`recording:"${dash[2]}" AND artist:"${dash[1]}"`)}&fmt=json&limit=5`;
  } else {
    url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(`recording:"${q}"`)}&fmt=json&limit=5`;
  }
  let data = null;
  // MusicBrainz answers 503 under load and the JSON still parses, so retry rather than
  // treating an empty result as "no such track"
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await throttle();
    try {
      const got = await getJson(url);
      if (got && Array.isArray(got.recordings) && got.recordings.length) { data = got; break; }
      if (got && got.error) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); continue; }
      data = got;
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  if (!data) return null;
  const recs = (data && data.recordings) || [];
  if (!recs.length) return null;
  const withIsrc = recs.filter((r) => (r.isrcs || []).length);
  const pick = (withIsrc.length ? withIsrc : recs)
    .slice()
    .sort((a, b) => (Number(b.score || 0) - Number(a.score || 0)) || ((b.isrcs || []).length - (a.isrcs || []).length))[0];
  const out = {
    title: pick.title || null,
    artist: (pick['artist-credit'] && pick['artist-credit'][0] && pick['artist-credit'][0].name) || null,
    duration: pick.length ? pick.length / 1000 : null,
    isrc: (pick.isrcs && pick.isrcs[0]) || null,
    mbid: pick.id,
    confidence: Number(pick.score || 0),
    at: Date.now(),
  };
  if (!out.isrc && out.mbid) {
    try {
      await throttle();
      const full = await getJson(`https://musicbrainz.org/ws/2/recording/${out.mbid}?inc=isrcs&fmt=json`);
      if (full && Array.isArray(full.isrcs) && full.isrcs.length) out.isrc = full.isrcs[0];
    } catch {}
  }
  cache.set(key, out);
  return out;
}

module.exports = { lookup, resolve };
