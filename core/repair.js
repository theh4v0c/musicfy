'use strict';
// Metadata repair: the catalogue says what the track really is, the model only decides
// how to present it. Nothing is written without an explicit apply.
const identity = require('./identity');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function propose(db, trackId) {
  const t = db.prepare('SELECT id, title, artist, album, year, genre, genre_family, bpm, key, duration FROM tracks WHERE id=?').get(trackId);
  if (!t) return null;
  let c = null;
  try { c = await identity.canon(t.artist || '', t.title || ''); } catch {}

  const proposal = {
    id: t.id,
    before: { title: t.title, artist: t.artist, album: t.album, year: t.year, genre: t.genre },
    after: {},
    reasons: [],
    confidence: 0,
  };

  if (c) {
    proposal.confidence = Math.round((c.score || 0) * 100);
    const titleDiffers = norm(c.title) !== norm(t.title);
    const artistDiffers = norm(c.artist) !== norm(t.artist);
    if (titleDiffers) { proposal.after.title = c.title; proposal.reasons.push(`title: "${t.title}" -> "${c.title}"`); }
    if (artistDiffers) { proposal.after.artist = c.artist; proposal.reasons.push(`artist: "${t.artist}" -> "${c.artist}"`); }
    if (c.album && norm(c.album) !== norm(t.album)) { proposal.after.album = c.album; proposal.reasons.push(`album: "${t.album || ''}" -> "${c.album}"`); }
    if (c.year && Number(c.year) !== Number(t.year)) { proposal.after.year = c.year; proposal.reasons.push(`year: ${t.year || '-'} -> ${c.year}`); }
    if (c.genre && norm(c.genre) !== norm(t.genre)) { proposal.after.genre = c.genre; proposal.reasons.push(`genre: "${t.genre || ''}" -> "${c.genre}"`); }
    if (c.family && c.family !== t.genre_family) proposal.after.genre_family = c.family;
  } else {
    proposal.reasons.push('no catalogue match, nothing to compare against');
  }
  proposal.changed = Object.keys(proposal.after).length > 0;
  return proposal;
}

function apply(db, trackId, fields) {
  const allowed = ['title', 'artist', 'album', 'year', 'genre', 'genre_family'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (fields[k] === undefined) continue;
    sets.push(`${k}=?`);
    params.push(fields[k] === '' ? null : fields[k]);
  }
  if (!sets.length) return { changed: 0 };
  // keep the identity key in step with the corrected title and artist
  const cur = db.prepare('SELECT title, artist FROM tracks WHERE id=?').get(trackId);
  if (!cur) return { changed: 0 };
  const title = fields.title !== undefined ? fields.title : cur.title;
  const artist = fields.artist !== undefined ? fields.artist : cur.artist;
  const dupKey = `${norm(artist)}|${norm(title)}`;
  const clash = db.prepare('SELECT id FROM tracks WHERE dup_key=? AND id != ?').get(dupKey, trackId);
  if (clash) return { changed: 0, error: 'another track already has that title and artist', clash: clash.id };
  sets.push('dup_key=?', 'updated_at=?');
  params.push(dupKey, Math.floor(Date.now() / 1000), trackId);
  db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id=?`).run(...params);
  return { changed: sets.length - 2 };
}

module.exports = { propose, apply };
