// MUSICFY spotify (mirror-plane reader): no OAuth, public embed JSON only.
'use strict';
const https = require('node:https');

function fetchJson(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', accept: 'text/html' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function extractEntity(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) return null;
  const d = JSON.parse(m[1]);
  const data = d?.props?.pageProps?.state?.data || {};
  return data.entity || null;
}

// idOrUrl: spotify track/playlist id or full open.spotify.com URL
function parseId(idOrUrl) {
  const m = String(idOrUrl).match(/(track|playlist|album)[:/]([A-Za-z0-9]{16,30})/);
  if (m) return { kind: m[1], id: m[2] };
  if (/^[A-Za-z0-9]{16,30}$/.test(idOrUrl.trim())) return { kind: 'track', id: idOrUrl.trim() };
  return null;
}

async function trackInfo(id) {
  const html = await fetchJson(`https://open.spotify.com/embed/track/${id}`);
  const e = extractEntity(html);
  if (!e || !e.name) return null;
  return {
    kind: 'track', id: e.id || id,
    title: e.title || e.name,
    artists: (e.artists || []).map((a) => a.name),
    durationMs: e.duration || null,
    release: e.releaseDate?.isoString?.slice(0, 10) || null,
    cover: e.coverArt?.sources?.[0]?.url || e.thumbnail || null,
  };
}

async function playlistInfo(id) {
  const html = await fetchJson(`https://open.spotify.com/embed/playlist/${id}`);
  const e = extractEntity(html);
  if (!e || !e.trackList) return null;
  // playlist embeds carry cover art as a CDN url in markup, not always in the entity
  const cdn = html.match(/https:\/\/image-cdn[^"'\\ ]+/);
  return {
    kind: 'playlist', id: e.id || id,
    title: e.title || e.name,
    cover: e.coverArt?.sources?.[0]?.url || (cdn ? cdn[0] : null),
    tracks: (e.trackList || []).map((t) => ({
      uri: t.uri,
      id: (t.uri || '').split(':').pop(),
      title: t.title,
      // embed items carry the artist line in subtitle; newer payloads may send artists[]
      artists: (t.artists || []).map((a) => a.name).length
        ? (t.artists || []).map((a) => a.name)
        : String(t.subtitle || '').split(',').map((s) => s.trim()).filter(Boolean),
      durationMs: t.duration || null,
    })),
  };
}

async function resolve(idOrUrl) {
  const p = parseId(idOrUrl);
  if (!p) throw new Error('unrecognized id or url');
  if (p.kind === 'playlist') { const pl = await playlistInfo(p.id); if (pl) return pl; return trackInfo(p.id); }
  return trackInfo(p.id);
}

module.exports = { resolve, trackInfo, playlistInfo, parseId };
