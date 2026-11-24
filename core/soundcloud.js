'use strict';
const paths = require('./paths');
const nodePath = require('node:path');
// SoundCloud, the way scdl does it: scrape a public client_id from the site, use the
// public API, and take the artist's original file when downloads are enabled.
// No account, no payment. Falls back to the best transcoding otherwise.
const https = require('node:https');
const fs = require('node:fs');

const API = 'https://api-v2.soundcloud.com';
const CACHE = nodePath.join(paths.DATA, 'sc-client.json');
let clientId = null;
let clientAt = 0;

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, { timeout: opts.timeout || 20000, method: opts.method || 'GET', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', accept: '*/*' } }, (res) => {
      if (opts.follow !== false && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(req(new URL(res.headers.location, url).toString(), { ...opts, follow: opts.follow }));
      }
      if (opts.json) {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`sc ${res.statusCode}`));
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
        return;
      }
      resolve(res);
    });
    r.on('timeout', () => r.destroy(new Error('sc timeout')));
    r.on('error', reject);
    r.end(opts.body || undefined);
  });
}

async function scrapeClientId() {
  const page = await req('https://soundcloud.com/', { follow: true });
  let html = '';
  page.setEncoding('utf8');
  for await (const chunk of page) html += chunk;
  const scripts = [...html.matchAll(/src="(https:\/\/[^"]*sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).slice(0, 8);
  for (const src of scripts) {
    try {
      const res = await req(src);
      let js = '';
      res.setEncoding('utf8');
      for await (const chunk of res) js += chunk;
      const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
      if (m) return m[1];
    } catch {}
  }
  throw new Error('could not scrape a soundcloud client id');
}

// yt-dlp already keeps a working public client_id on disk; reuse it instead of
// scraping the site, which no longer exposes one in the bundles
const YTDLP_CACHE = [
  `${process.env.HOME || '/root'}/.cache/yt-dlp/soundcloud/client_id.json`,
  '/root/.cache/yt-dlp/soundcloud/client_id.json',
];

function fromYtdlpCache() {
  for (const p of YTDLP_CACHE) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.data && j.data.length >= 20) return j.data;
    } catch {}
  }
  return null;
}

async function getClientId() {
  if (clientId && Date.now() - clientAt < 12 * 3600 * 1000) return clientId;
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (cached && cached.id && Date.now() - cached.at < 12 * 3600 * 1000) {
      clientId = cached.id; clientAt = cached.at;
      return clientId;
    }
  } catch {}
  let id = fromYtdlpCache();
  if (!id) {
    try { await req('https://api.soundcloud.com/'); } catch {}
    const { execFileSync } = require('node:child_process');
    try {
      execFileSync(paths.YTDLP,
        ['--no-warnings', '--print', 'id', 'https://api.soundcloud.com/tracks/3419282'],
        { timeout: 60000, stdio: 'ignore' });
    } catch {}
    id = fromYtdlpCache();
  }
  if (!id) id = await scrapeClientId().catch(() => null);
  if (!id) throw new Error('no soundcloud client id available');
  clientId = id; clientAt = Date.now();
  try { fs.writeFileSync(CACHE, JSON.stringify({ id, at: clientAt }), { mode: 0o600 }); } catch {}
  return id;
}

const isScUrl = (u) => /^https:\/\/(www\.|api\.|api-v2\.|m\.)?soundcloud\.com\//.test(String(u || '')) || /^https:\/\/api\.soundcloud\.com\/tracks\//.test(String(u || ''));

function trackIdFrom(url) {
  const s = String(url || '');
  let m = s.match(/soundcloud(?:\.com)?%3Atracks%3A(\d+)/i) || s.match(/soundcloud:tracks:(\d+)/i);
  if (m) return m[1];
  m = s.match(/\/tracks\/(\d+)/);
  if (m) return m[1];
  m = s.match(/api\.soundcloud\.com\/tracks\/(?:soundcloud%3Atracks%3A)?(\d+)/i);
  return m ? m[1] : null;
}

async function trackInfo(url) {
  const cid = await getClientId();
  const id = trackIdFrom(url);
  if (id) return req(`${API}/tracks/${id}?client_id=${cid}`, { json: true });
  // permalink urls (soundcloud.com/artist/track) resolve through the API
  const resolved = await req(`${API}/resolve?url=${encodeURIComponent(url)}&client_id=${cid}`, { json: true });
  if (!resolved || !resolved.id) throw new Error('could not resolve soundcloud url');
  return resolved;
}

// the artist's own file (wav/flac/aiff) when downloads are enabled on the track
async function originalUrl(url) {
  const t = await trackInfo(url);
  // has_downloads is not always present on the track endpoint, downloadable is the real flag
  if (!t || !t.downloadable) return null;
  const cid = await getClientId();
  return `${API}/tracks/${t.id}/download?client_id=${cid}`;
}

// best progressive mp3 for instant playback
async function progressiveUrl(url) {
  const t = await trackInfo(url);
  const list = (t && t.media && t.media.transcodings) || [];
  const pick = list.find((x) => x.format && x.format.protocol === 'progressive' && /mp3/.test(x.format.mime_type || ''))
    || list.find((x) => x.format && x.format.protocol === 'progressive');
  if (!pick) return null;
  const cid = await getClientId();
  const res = await req(`${pick.url}?client_id=${cid}`, { json: true });
  return res && res.url ? res.url : null;
}

// original file downloads need an OAuth token from a free SoundCloud session.
// No plan is required, but the endpoint rejects anonymous requests with 401.
const TOKEN_FILE = nodePath.join(paths.DATA, 'soundcloud.json');
function authHeaders() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (j && j.token) return { authorization: `OAuth ${j.token}` };
  } catch {}
  return {};
}
function hasToken() {
  return Object.keys(authHeaders()).length > 0;
}

module.exports = { isScUrl, trackInfo, originalUrl, progressiveUrl, getClientId, authHeaders, hasToken };
