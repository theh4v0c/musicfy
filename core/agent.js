'use strict';
// Three intents, executed deterministically. The model only picks the intent and its
// arguments; it never runs code and never sees the database.
const identity = require('./identity');
const queryEngine = require('./query');
const mood = require('./mood');
const deezer = require('./deezer');

const INTENTS = ['build_playlist', 'search_tracks', 'download_album', 'download_missing', 'report_library'];

function planLocally(text) {
  const t = String(text || '').toLowerCase();
  const countMatch = t.match(/(\d{1,3})\s*(?:[a-z-]+\s+){0,4}(?:songs?|tracks?|items?)/i);
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
  if (wantsDownload) return { intent: 'download_missing', args: { query: text } };
  return { intent: 'report_library', args: {} };
}

async function planWithModel(llm, text) {
  const prompt = `Turn a music request into JSON. Reply with JSON only, no prose.
{"intent":"build_playlist|search_tracks|download_album|download_missing|report_library","args":{...}}
args by intent:
- build_playlist: {"query":"the request as written","count":20,"download":false,
   "brief":true|false,
   "artists":["real artist names named or implied, e.g. the band Imagine Dragons"],
   "themes":["1-4 short search phrases that find real recordings for this brief, e.g. 'children's music', 'unicorn song for kids'"],
   "genres":["broad genres if named"],"allowExternal":true|false}
  brief is true only when the request describes a person, an age, an occasion or several
  likes. A genre or a tempo ("a dance playlist", "techno around 130") is not a brief:
  leave brief false, artists and themes empty, and let the style handle it.
- search_tracks: {"query":"words to search","limit":20}
- download_album: {"query":"artist or album"}
- download_missing: {"query":"album or artist if named"}
Rules:
- A brief with a person, an age, an occasion or several likes is build_playlist even without the word playlist.
- themes must be things a catalogue can actually search: not 'unicorns' alone but "unicorn song for kids".
- artists only real artists; never invent.
- allowExternal is true when they say not to limit to the library, or ask for things they do not have.
- count defaults to 20. download is true only if they ask to download.
Request: ${text}`;
  const out = await llm.askRaw(prompt, 20000);
  const parsed = JSON.parse(String(out).replace(/^```(json)?/i, '').replace(/```$/, '').trim());
  if (!INTENTS.includes(parsed.intent)) throw new Error('unknown intent');
  if (!parsed.args || typeof parsed.args !== 'object') parsed.args = {};
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
    const words = String(plan.args.query || '')
      .replace(/\b(find|search|show|which|list|what|me|my|songs?|tracks?|music|in|the|library|outside|from|that|are|is|do|i|have|any|like|similar|to|don'?t|doesn'?t|dont|not|new|missing|discover|unheard)\b/gi, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    const likeArtist = /\b(like|similar to|in the style of|sounds like)\s+([a-z0-9 .&'_-]{2,40})/i.exec(String(plan.args.query || ''));
    try {
      if (likeArtist) {
        // "like Burial that I don't have" is about the artist Burial, not that sentence
        const who = String(likeArtist[2] || '').split(/\s+(?:that|which|who|i|in|from|to|and|but|not|do|dont|don'?t)\s+/i)[0].trim();
        catalogue = (await identity.artistSongs(who, 30)).slice(0, Math.min(Number(plan.args.limit) || 20, 30));
      }
      if (!catalogue.length) catalogue = (await identity.catalog(words || '', { songs: 10, albums: 0, artists: 0 })).songs || [];
    } catch {}
    const wantsNew = /\b(don'?t have|not in (?:my|the) library|outside|discover|unheard|new|missing)\b/i.test(String(plan.args.query || ''));
    if (wantsNew && catalogue.length) {
      const tracks = catalogue.slice(0, 20).map((t) => ({
        key: `${String(t.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(t.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`,
        title: t.title, artist: t.artist, album: t.album || '', duration: t.duration || null,
        cover: t.cover || null, preview: t.preview || null, owned: false, source: 'online',
      }));
      return {
        spoken: `${tracks.length} tracks outside your library match that. Nothing is downloaded until you say so.`,
        data: { library, catalogue, filters: filters.notes || [] },
        action: {
          kind: 'download', title: `Outside your library`, summary: `${tracks.length} new tracks`,
          reason: `Found in the catalogue for “${String(plan.args.query || '').trim().slice(0, 60)}”.`,
          tracks, id: null,
        },
      };
    }
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


// ---------- guided actions: build a proposal, execute only on confirm ----------
function dupOf(artist, title) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(artist)}|${norm(title)}`;
}

function listName(query) {
  const n = String(query || '')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\b(create|make|build|please|a|an|the|playlist|of|with|for|me|tracks?|songs?|items?|top|rated|best|rating)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!n) return 'Made by request';
  return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 60);
}

function ownedIdFor(db, dupKey) {
  return db.prepare(`SELECT t.id, EXISTS(SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
    FROM tracks t WHERE t.dup_key=?`).get(dupKey);
}

// related artists of the tracks we picked, so online candidates follow taste, not a keyword
async function onlineFill(db, localPicks, need, queryText) {
  if (need <= 0) return [];
  let seeds = [...new Set(localPicks.map((t) => t.artist).filter(Boolean))].slice(0, 3);
  let direct = null;
  if (!seeds.length && queryText) {
    direct = await deezer.artistSearch(queryText).catch(() => null);
    if (direct) seeds = [direct.name];
  }
  if (!seeds.length) {
    seeds = db.prepare(`SELECT artist FROM tracks WHERE artist IS NOT NULL AND artist != ''
      GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 3`).all().map((r) => r.artist);
  }
  const inLib = new Set(db.prepare('SELECT dup_key FROM tracks').all().map((r) => r.dup_key));
  const seen = new Set();
  const seenTitle = new Set();
  const out = [];
  const add = (t) => {
    if (!t || !t.title || !t.artist || !t.duration || t.duration < 90) return;
    const key = dupOf(t.artist.name, t.title);
    if (inLib.has(key) || seen.has(key)) return;
    const titleKey = String(t.title).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(remaster(?:ed)?|version|edit)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenTitle.has(titleKey)) return;
    seenTitle.add(titleKey);
    seen.add(key);
    out.push({
      title: t.title, artist: t.artist.name, album: (t.album && t.album.title) || '',
      duration: t.duration, key, source: 'online', owned: false,
      cover: (t.album && t.album.cover_medium) || null, preview: t.preview || null,
    });
  };
  if (direct) {
    const top = await deezer.artistTop(direct.id, Math.max(need, 5)).catch(() => ({ data: [] }));
    for (const t of (top.data || [])) { if (out.length >= need) break; add(t); }
  }
  for (const seed of seeds) {
    if (out.length >= need) break;
    const artist = await deezer.artistSearch(seed).catch(() => null);
    if (!artist) continue;
    const related = await deezer.relatedArtists(artist.id).catch(() => ({ data: [] }));
    for (const r of (related.data || []).slice(0, 4)) {
      if (out.length >= need) break;
      const top = await deezer.artistTop(r.id, 5).catch(() => ({ data: [] }));
      for (const t of (top.data || [])) {
        if (out.length >= need) break;
        add(t);
      }
    }
  }
  return out;
}

/* a brief names people and things, not a tempo. "unicorns and robots for a five year
   old who likes Imagine Dragons" is not a keyword search, so it gets its own path:
   match the named artists and themes locally, then go and find the rest outside. */
const BRIEF_STOP = new Set(['the', 'and', 'for', 'with', 'her', 'his', 'she', 'he', 'likes', 'like', 'song', 'songs', 'kids', 'kid', 'children', 'child', 'music', 'band', 'from', 'that', 'this', 'about', 'into']);
function briefWords(themes) {
  const out = new Set();
  for (const t of themes || []) {
    for (const w of String(t).toLowerCase().split(/[^a-z0-9']+/)) {
      if (w.length > 3 && !BRIEF_STOP.has(w)) out.add(w);
    }
  }
  return [...out];
}

async function briefFill(db, { artists = [], themes = [], need = 0 }) {
  if (need <= 0) return [];
  const inLib = new Set(db.prepare('SELECT dup_key FROM tracks').all().map((r) => r.dup_key));
  const seen = new Set();
  const words = briefWords(themes);
  const out = [];
  const push = (t) => {
    if (!t || !t.title || !t.artist || out.length >= need) return;
    const key = dupOf(t.artist, t.title);
    if (inLib.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({
      key, title: t.title, artist: t.artist, album: t.album || '', duration: t.duration || null,
      cover: t.cover || null, preview: t.preview || null, source: 'online', owned: false,
    });
  };
  // named artists and themes share the outside slots; otherwise the artist fills the
  // list and the unicorns never arrive
  const artistBudget = themes.length ? Math.max(2, Math.floor(need / 2)) : need;
  let artistCount = 0;
  for (const a of artists) {
    if (artistCount >= artistBudget) break;
    const list = await identity.artistSongs(a, 10).catch(() => []);
    for (const t of list) { if (artistCount >= artistBudget) break; push(t); artistCount += 1; }
  }
  // the themes take turns, so a brief with two subjects gets both of them
  const lists = [];
  for (const th of themes) {
    const res = await identity.catalog(th, { songs: 12, albums: 0, artists: 0 }).catch(() => ({ songs: [] }));
    lists.push((res.songs || []).filter((t) => {
      if (!words.length) return true;
      const hay = `${t.title} ${t.album} ${t.genre || ''}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    }));
  }
  for (let i = 0; out.length < need && i < 12; i += 1) {
    let took = false;
    for (const list of lists) {
      if (out.length >= need) break;
      if (list[i]) { push(list[i]); took = true; }
    }
    if (!took) break;
  }
  // still short: broaden each theme without the strict word filter
  for (const list of lists) {
    if (out.length >= need) break;
    for (const t of list) { if (out.length >= need) break; push(t); }
  }
  return out;
}

async function propose(db, plan) {
  if (plan.intent === 'build_playlist') {
    const q = String(plan.args.query || '').trim();
    const count = Math.max(1, Math.min(Number(plan.args.count) || 20, 100));
    const artists = (plan.args.artists || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 4);
    const themes = (plan.args.themes || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 4);
    const brief = plan.args.brief === true || artists.length > 0;
    const picked = mood.select(db, q, count);
    const moodNames = { question: 'Question everything', feel: 'Emotional', euphoric: 'Euphoric' };
    const styleNames = { burningman: 'Burning Man', indiedance: 'Indie dance', downtempo: 'Downtempo', techno: 'Techno', house: 'House', dance: 'Dance floor' };
    const textName = listName(q);
    let auto;
    if (picked.ctx.mood) auto = moodNames[picked.ctx.mood.id];
    else if (picked.ctx.style) {
      const styleName = styleNames[picked.ctx.style.id];
      auto = textName.length > styleName.length ? textName : styleName;
    } else auto = textName;
    let name = plan.args.name ? String(plan.args.name).slice(0, 60) : String(auto || 'Made by request').slice(0, 60);
    if (brief) {
      // a brief makes a better title than the sentence: "Unicorns, robots · Imagine Dragons"
      const cores = [];
      for (const t of themes) {
        const core = String(t).split(/\s+(?:song|songs|music|for|by)\b/i)[0].trim();
        if (core && !artists.some((a) => core.toLowerCase().includes(a.toLowerCase()))) cores.push(core);
      }
      const head = [...new Set(cores)].slice(0, 2).join(', ');
      const label = [head, artists.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
      if (label) name = label.charAt(0).toUpperCase() + label.slice(1);
    }

    const onlyLocal = /\b(only|just|from)\s+(my|the)\s+library\b|\bno new\b/i.test(q);
    const wantsNew = /\b(new|discover|online|unreleased|not in my library|find more|don'?t limit)\b/i.test(q);
    const discovery = onlyLocal ? 0 : wantsNew ? 1 : 0.25;
    let local = [];
    if (brief) {
      // the brief names people and things: match those, not the sentence
      const words = briefWords(themes);
      const names = artists.map((a) => a.toLowerCase());
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.genre, t.genre_family,
          (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
          (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays
        FROM tracks t`).all();
      local = rows.filter((t) => {
        const hay = `${t.title || ''} ${t.album || ''} ${t.genre || ''} ${t.genre_family || ''}`.toLowerCase();
        const byArtist = names.some((a) => String(t.artist || '').toLowerCase().includes(a));
        const byTheme = words.some((w) => hay.includes(w));
        return byArtist || byTheme;
      }).sort((a, b) => (b.owned || 0) - (a.owned || 0)).slice(0, count);
    }
    if (!local.length) local = picked.tracks;
    const allowExternal = plan.args.allowExternal !== false && !onlyLocal;
    let online = [];
    if (brief) {
      online = allowExternal ? await briefFill(db, { artists, themes, need: Math.max(0, count - local.length) }) : [];
    } else {
      const targetOnline = onlyLocal ? 0 : Math.max(Math.round(count * discovery), count - local.length);
      if (targetOnline > 0 && local.length > count - targetOnline) local = local.slice(0, Math.max(0, count - targetOnline));
      online = await onlineFill(db, local, Math.min(targetOnline, Math.max(0, count - local.length)), picked.ctx.text.join(' '));
    }
    // if the network gave us less than we hoped, top up from the rest of the local picks
    if (local.length + online.length < count) {
      const rest = picked.tracks.filter((t) => !local.includes(t)).slice(0, count - local.length - online.length);
      local = [...local, ...rest];
    }

    const tracks = [
      ...local.map((t) => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album,
        bpm: t.bpm, key: t.key, key_scale: t.key_scale, owned: !!t.owned, source: 'library', cover: `/api/cover/${t.id}`,
        preview: t.owned ? `/api/stream/${t.id}` : null,
      })),
      ...online,
    ];
    const missing = tracks.filter((t) => !t.owned).length;
    const played = local.filter((t) => Number(t.plays) > 0).length;
    let reasonBits = [picked.reason];
    if (brief) {
      const cores = [];
      for (const t of themes) {
        const core = String(t).split(/\s+(?:song|songs|music|for|by)\b/i)[0].trim();
        if (core && !artists.some((a) => core.toLowerCase().includes(a.toLowerCase()))) cores.push(core);
      }
      const what = [...new Set(cores)].slice(0, 3).join(', ');
      reasonBits = [`For a brief: ${[what, artists.join(', ')].filter(Boolean).join(' · ')}.`];
      reasonBits.push(`${local.length} in your library, ${online.length} new.`);
    } else if (local.length) reasonBits.push(`${played} of ${local.length} you already play.`);
    // 'include some I don't have' is an instruction, not a search term
    const FILLER = /^(include|including|some|any|ones|tracks|songs|track|song|that|which|i|dont|don't|have|has|not|no|in|my|library|new|find|more|from|the|a|an|and|or|with|of|for|to|please|create|make|build|playlist|crate|set)$/i;
    const sourceName = picked.ctx.text.filter((w) => !FILLER.test(w)).join(' ');
    if (!brief) {
      reasonBits.push(online.length ? (local.length ? `${online.length} new from artists around your rotation.` : `${online.length} new from ${sourceName ? `“${sourceName}”` : 'the catalogue'}.`) : (targetOnline ? 'Nothing new turned up this time.' : 'All from your library.'));
    }
    return {
      kind: 'playlist', name, trackIds: local.map((t) => t.id), online, tracks,
      download: !!plan.args.download,
      title: name,
      // fragments are sentences: every one of them starts with a capital
      reason: reasonBits.join(' ')
        .replace(/\s*\.\s*/g, '. ')
        .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase())
        .trim(),
      summary: `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${tracks.length - missing} local · ${missing} new`,
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
    if (plan.args.latest && byArtist.length) album = byArtist.sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    let list = album ? songs.filter((s) => String(s.album || '').toLowerCase() === String(album.name).toLowerCase()) : songs;
    if (!list.length && album) list = songs;
    if (!list.length) return null;
    const tracks = list.map((s) => {
      const key = dupOf(s.artist, s.title);
      const row = ownedIdFor(db, key);
      return { title: s.title, artist: s.artist || '', album: s.album || album?.name || '', duration: s.duration || null, key, owned: !!(row && row.owned) };
    });
    const missing = tracks.filter((t) => !t.owned).length;
    return {
      kind: 'album', album: album ? { name: album.name, artist: album.artist } : null,
      tracks, trackIds: [], download: true,
      title: album ? `Download "${album.name}"` : 'Download album',
      reason: album ? `${missing} of ${tracks.length} tracks are not local. Nothing is queued until you confirm.` : 'Catalogue match, nothing queued yet.',
      summary: album ? `${tracks.length} tracks · ${missing} missing` : `${tracks.length} tracks`,
    };
  }

  if (plan.intent === 'download_missing') {
    const q = String(plan.args.query || '').trim();
    const term = q.toLowerCase().replace(/\b(the|download|missing|tracks?|songs?|from|of|in|my|library|album|by)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const like = `%${term}%`;
    const base = `SELECT t.id, t.title, t.artist, t.album FROM tracks t
      WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`;
    const scoped = q && like.length > 4
      ? db.prepare(`${base} AND (lower(COALESCE(t.album,'')) LIKE ? OR lower(COALESCE(t.artist,'')) LIKE ? OR lower(t.title) LIKE ?) LIMIT 100`).all(like, like, like)
      : [];
    let missing = scoped;
    if (!missing.length) {
      if (q && like.length > 4) {
        // nothing missing under that name: say it is complete instead of dumping the
        // whole library's gaps on someone who asked about one album
        const any = db.prepare(`SELECT COUNT(*) c FROM tracks WHERE lower(COALESCE(album,'')) LIKE ? OR lower(COALESCE(artist,'')) LIKE ?`).get(like, like).c;
        if (any) return { kind: 'none', reason: `Everything matching “${term || q}” is already in your library.` };
      }
      missing = db.prepare(`${base} LIMIT 100`).all();
    }
    return {
      kind: 'missing', trackIds: missing.map((t) => t.id), tracks: missing.map((t) => ({ ...t, owned: false })),
      download: true,
      title: 'Download missing audio',
      reason: `${missing.length} tracks have no local audio. They are queued only after you confirm.`,
      summary: `${missing.length} tracks`,
    };
  }
  return null;
}

function commit(db, proposal, deps) {
  const at = Math.floor(Date.now() / 1000);
  let queued = 0;
  if (proposal.kind === 'playlist') {
    const pid = `ai-${Date.now().toString(36)}`;
    db.prepare('INSERT INTO playlists (id,name,source,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(pid, proposal.name, 'ai', at, at);
    const ids = [...proposal.trackIds];
    for (const t of (proposal.online || [])) {
      let row = ownedIdFor(db, t.key);
      if (!row) {
        const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,added_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t.key, t.key, t.title, t.artist, t.album, null, t.duration || null, 'catalogue', at, at);
        row = { id: Number(r.lastInsertRowid), owned: 0 };
      }
      ids.push(row.id);
    }
    let pos = 0;
    for (const id of ids) {
      db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id,track_id,position,added_at) VALUES (?,?,?,?)')
        .run(pid, id, pos++, at);
    }
    if (proposal.download) {
      const rows = db.prepare(`SELECT t.id, t.title, t.artist FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
        WHERE pt.playlist_id=? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned')`).all(pid);
      for (const t of rows) { if (deps.enqueueTrackDownload(t)) queued += 1; }
    }
    return { spoken: `Created "${proposal.name}" with ${ids.length} tracks${queued ? `, ${queued} downloading` : ''}.`,
      data: { playlist: { id: pid, name: proposal.name, tracks: ids.length }, queued } };
  }
  if (proposal.kind === 'album') {
    for (const t of proposal.tracks) {
      let row = ownedIdFor(db, t.key);
      if (!row) {
        const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,added_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t.key, t.key, t.title, t.artist, t.album, null, t.duration || null, 'catalogue', at, at);
        row = { id: Number(r.lastInsertRowid), owned: 0 };
      }
      if (!row.owned && deps.enqueueTrackDownload({ id: row.id, title: t.title, artist: t.artist, duration: t.duration })) queued += 1;
    }
    const name = proposal.album ? proposal.album.name : 'album';
    return { spoken: `Queueing ${queued} tracks from "${name}".`, data: { album: proposal.album, queued } };
  }
  if (proposal.kind === 'download') {
    for (const t of proposal.tracks || []) {
      let row = ownedIdFor(db, t.key);
      if (!row) {
        const r = db.prepare(`INSERT INTO tracks (uid,dup_key,title,artist,album,year,duration,format,added_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t.key, t.key, t.title, t.artist || '', t.album || '', null, t.duration || null, 'catalogue', at, at);
        row = { id: Number(r.lastInsertRowid), owned: 0 };
      }
      if (!row.owned && deps.enqueueTrackDownload({ id: row.id, title: t.title, artist: t.artist, duration: t.duration })) queued += 1;
    }
    return { spoken: `Queued ${queued} track${queued === 1 ? '' : 's'} from outside your library.`, data: { queued } };
  }
  if (proposal.kind === 'missing') {
    for (const id of proposal.trackIds) {
      const t = db.prepare('SELECT id, title, artist FROM tracks WHERE id=?').get(id);
      if (t && deps.enqueueTrackDownload(t)) queued += 1;
    }
    return { spoken: `Queued ${queued} downloads.`, data: { queued } };
  }
  return { spoken: 'Nothing to do.', data: {} };
}

module.exports = { planLocally, planWithModel, execute, propose, commit };

