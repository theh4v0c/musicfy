'use strict';
// Bandcamp search: parse the public search page, no API key, no account.
const https = require('node:https');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; musicfy/1.0)', accept: 'text/html' }, timeout: 20000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return get(r.headers.location).then(resolve, reject);
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('bandcamp ' + r.statusCode)); }
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('bandcamp timeout')));
    req.on('error', reject);
  });
}

const clean = (s) => String(s || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

async function searchBandcamp(query, limit = 12) {
  const url = `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=t`;
  const html = await get(url);
  const out = [];
  const blocks = html.split('<li class="searchresult data-search"').slice(1);
  for (const b of blocks) {
    if (out.length >= limit) break;
    const link = b.match(/<a class="title"[^>]*href="([^"]+)"/) || b.match(/href="(https:\/\/[^"]*bandcamp\.com\/(?:track|album)\/[^"?]+)/);
    if (!link) continue;
    const target = link[1].replace(/&amp;/g, '&');
    if (!/bandcamp\.com\/(track|album)\//.test(target)) continue;
    const titleMatch = b.match(/<div class="heading">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const artistMatch = b.match(/<div class="subhead">([\s\S]*?)<\/div>/);
    const title = clean(titleMatch ? titleMatch[1] : '');
    const artist = clean(artistMatch ? artistMatch[1] : '').replace(/^by\s+/i, '');
    if (!title) continue;
    out.push({
      source: 'bandcamp', rung: 'bandcamp', id: target, url: target,
      title, artist, duration: null, format: 'stream', bitrate: null,
      handle: { kind: 'bandcamp', url: target },
    });
  }
  return out;
}

module.exports = { searchBandcamp };
