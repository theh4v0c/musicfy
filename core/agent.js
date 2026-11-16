'use strict';
// Three intents, executed deterministically. The model only picks the intent and its
// arguments; it never runs code and never sees the database.
const identity = require('./identity');
const queryEngine = require('./query');

const INTENTS = ['build_playlist', 'search_tracks', 'download_album', 'download_missing', 'report_library'];

function planLocally(text) {
  const t = String(text || '').toLowerCase();
  const countMatch = t.match(/(\d{1,3})\s*(?:songs?|tracks?)/);
  const count = countMatch ? Math.min(Number(countMatch[1]), 100) : 20;
  const wantsPlaylist = /\b(playlist|set|mix|selection)\b/.test(t) || /\bcreate\b/.test(t);
  const wantsDownload = /\bdownload\b/.test(t);
  if (/\balbum\b/.test(t) && wantsDownload) {
    const latest = /\b(latest|newest|new|recent)\b/.test(t);
    const name = String(text)
      .replace(/\b(download|get|grab|the|album|by|from|please|of|latest|newest|new|recent|release)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return { intent: 'download_album', args: { query: name || text, latest } };
  }
  if (wantsPlaylist) return { intent: 'build_playlist', args: { query: text, count, download: wantsDownload } };
  if (/\b(find|search|show|which|list|what)\b/.test(t) && !/\bplaylist\b/.test(t)) {
    return { intent: 'search_tracks', args: { query: text, limit: count } };
  }
  if (wantsDownload) return { intent: 'download_missing', args: {} };
  return { intent: 'report_library', args: {} };
}

async function planWithModel(llm, text) {
  const prompt = `Choose one intent and arguments for a music library request.
Intents: build_playlist {query, count, download}, search_tracks {query, limit}, download_album {query}, download_missing {}, report_library {}.
Reply with JSON only: {"intent":"...","args":{...}}.
Rules: prefer search_tracks when the user asks to find, show or list songs, especially songs not in playlists. Prefer build_playlist only when they ask to create a playlist. Prefer report_library for questions about counts or coverage.
Request: ${text}`;
  const out = await llm.askRaw(prompt, 8000);
  const parsed = JSON.parse(String(out).replace(/^```(json)?/i, '').replace(/```$/, '').trim());
  if (!INTENTS.includes(parsed.intent)) throw new Error('unknown intent');
  return parsed;
}

async function execute(db, plan, deps) {
  const { enqueueTrackDownload } = deps;
  if (plan.intent === 'report_library') {
    const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
    const withAudio = db.prepare("SELECT COUNT(DISTINCT track_id) c FROM files WHERE tier='owned'").get().c;
    const families = db.prepare("SELECT genre_family g, COUNT(*) c FROM tracks WHERE genre_family IS NOT NULL GROUP BY g ORDER BY c DESC").all();
    return { spoken: `${withAudio} of ${total} tracks have audio. Families: ${families.map((f) => `${f.g} ${f.c}`).join(', ') || 'none tagged'}.`, data: { total, withAudio, families } };
  }

  if (plan.intent === 'search_tracks') {
    const words = String(plan.args.query || '').replace(/\b(find|search|show|which|list|what|me|my|songs?|tracks?|music|in|the|library|outside|from|that|are|is|do|i|have|any)\b/gi, ' ').trim();
    const filters = queryEngine.parse(words || plan.args.query || '', db);
    filters.limit = Math.min(Number(plan.args.limit) || 40, 100);
    let library = queryEngine.run(db, filters);
    if (!library.length && words) {
      // no structured match: fall back to a plain text sweep of the whole catalogue
      const like = `%${words.toLowerCase()}%`;
      library = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.genre_family, t.bpm, t.key,
          (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays,
          (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
        FROM tracks t WHERE lower(t.title) LIKE ? OR lower(COALESCE(t.artist,'')) LIKE ?
        ORDER BY t.title LIMIT ?`).all(like, like, filters.limit);
    }
    let catalogue = [];
    try { catalogue = (await identity.catalog(words || '', { songs: 10, albums: 0, artists: 0 })).songs || []; } catch {}
    return {
      spoken: `${library.length} tracks in your library, ${catalogue.length} in the catalogue.`,
      data: { library, catalogue, filters: filters.notes || [] },
    };
  }

  if (plan.intent === 'download_album') {
    const q = String(plan.args.query || '').trim();
    let albums = [];
    let songs = [];
    try {
      const cat = await identity.catalog(q, { songs: 40, albums: 8, artists: 0 });
      albums = cat.albums || [];
      songs = cat.songs || [];
    } catch {}
    // narrow to the album that best matches, so we do not queue a whole artist
    const want = q.toLowerCase();
    const words = want.split(/\s+/).filter((w) => w.length > 2);
    const byArtist = albums.filter((a) => {
      const artist = String(a.artist || '').toLowerCase();
      return words.length && words.every((w) => artist.includes(w));
    });
    let album = albums.find((a) => String(a.name || '').toLowerCase().includes(want))
      || albums.find((a) => want.includes(String(a.name || '').toLowerCase()))
      || (byArtist.length ? byArtist.sort((a, b) => (b.year || 0) - (a.year || 0))[0] : null)
      || albums[0] || null;
    if (plan.args.latest && byArtist.length) {
      album = byArtist.sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    }
    let list = album
      ? songs.filter((s) => String(s.album || '').toLowerCase() === String(album.name).toLowerCase())
      : songs;
    if (!list.length && album) list = songs;   // the catalogue returns artist rows when it has no tracklist
    if (!list.length) return { spoken: 'I could not find that album in the catalogue.', data: { album: null, queued: 0 } };
    let queued = 0;
    for (const s of list) {
      const key = `${String(s.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(s.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      let row = db.prepare('SELECT id FROM tracks WHERE dup_key=?').get(key);
      if (!row) {
        const t2 = Date.now();
        const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,added_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(key, key, s.title, s.artist || '', s.album || album?.name || '', s.year || null, s.duration || null, 'catalogue', t2, t2);
        row = { id: Number(r.lastInsertRowid) };
      }
      if (enqueueTrackDownload({ id: row.id, title: s.title, artist: s.artist, duration: s.duration })) queued += 1;
    }
    return {
      spoken: album ? `Queueing "${album.name}" by ${album.artist}, ${queued} tracks.` : `Queueing ${queued} tracks from the catalogue.`,
      data: { album: album ? { name: album.name, artist: album.artist, tracks: list.length } : null, queued },
    };
  }

  if (plan.intent === 'download_missing') {
    const missing = db.prepare(`SELECT t.id, t.title, t.artist FROM tracks t
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned') LIMIT 100`).all();
    let queued = 0;
    for (const t of missing) { if (enqueueTrackDownload(t)) queued += 1; }
    return { spoken: `Queued ${queued} downloads.`, data: { queued } };
  }

  // build_playlist: prefer the catalogue, fall back to the library
  const q = String(plan.args.query || '').replace(/\b(create|make|build|a|an|the|playlist|with|songs?|tracks?)\b/gi, ' ').trim();
  const count = Math.min(Number(plan.args.count) || 20, 100);
  let songs = [];
  try {
    const cat = await identity.catalog(q, { songs: Math.max(count, 25), albums: 0, artists: 0 });
    songs = cat.songs || [];
  } catch {}
  const localFilters = queryEngine.parse(q, db);
  localFilters.limit = count;
  const local = queryEngine.run(db, localFilters);

  const pid = `ai-${Date.now().toString(36)}`;
  const name = String(plan.args.name || q || 'Made by request').slice(0, 60);
  db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(pid, name, 'ai', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

  let added = 0, queued = 0;
  const seen = new Set();
  const addTrack = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)')
      .run(pid, id, added++, Math.floor(Date.now() / 1000));
  };

  // catalogue tracks first: create a row if we do not already have it
  for (const s of songs.slice(0, count)) {
    const dupKey = `${String(s.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(s.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    let row = db.prepare('SELECT id FROM tracks WHERE dup_key=?').get(dupKey);
    if (!row) {
      const t = Date.now();
      const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,added_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(dupKey, dupKey, s.title, s.artist || '', s.album || '', s.year || null, s.duration || null, 'catalogue', t, t);
      row = { id: Number(r.lastInsertRowid) };
    }
    addTrack(row.id);
  }
  for (const t of local) { if (added < count) addTrack(t.id); }

  if (plan.args.download) {
    const rows = db.prepare(`SELECT t.id, t.title, t.artist FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
      WHERE pt.playlist_id=? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).all(pid);
    for (const t of rows) { if (enqueueTrackDownload(t)) queued += 1; }
  }

  return {
    spoken: `Created "${name}" with ${added} tracks${queued ? `, ${queued} downloading` : ''}.`,
    data: { playlist: { id: pid, name, tracks: added }, queued },
  };
}

module.exports = { planLocally, planWithModel, execute };
