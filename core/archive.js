// MUSICFY ladder: Internet Archive rung. Fully sovereign: no accounts, no keys, public API.
'use strict';
const https = require('node:https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('archive timeout')); });
  });
}

// Search IA audio items matching seed. Returns normalized candidates.
async function searchArchive(seed, { limit = 10 } = {}) {
  const q = `${seed.artist || ''} ${seed.title}`.trim();
  const url = 'https://archive.org/advancedsearch.php?q=' +
    encodeURIComponent(`(${q}) AND mediatype:audio`) +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&rows=${limit}&output=json`;
  const r = await get(url);
  if (r.status !== 200 || !r.json) return [];
  const docs = r.json?.response?.docs || [];
  return docs.map((d) => ({
    source: 'archive',
    rung: 'archive',
    id: d.identifier,
    title: d.title || d.identifier,
    artist: Array.isArray(d.creator) ? d.creator[0] : d.creator || '',
    duration: null,
    format: 'archive-item',
    bitrate: null,
    handle: { kind: 'archive', identifier: d.identifier },
  }));
}

// List playable audio files in an item
async function itemFiles(identifier) {
  const r = await get(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  if (r.status !== 200 || !r.json) return [];
  const files = r.json?.files || [];
  return files
    .filter((f) => /\.(mp3|flac|ogg)$/i.test(f.name || ''))
    .map((f) => ({
      file: f.name,
      format: /\.flac$/i.test(f.name) ? 'flac' : /\.mp3$/i.test(f.name) ? 'mp3' : 'ogg',
      duration: f.length && !String(f.length).includes(':') ? Number(f.length) : null,
      size: f.size ? Number(f.size) : null,
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`,
    }));
}

module.exports = { searchArchive, itemFiles };
