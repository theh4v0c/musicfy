'use strict';
// Three intents, executed deterministically. The model only picks the intent and its
// arguments; it never runs code and never sees the database.
const identity = require('./identity');
const queryEngine = require('./query');
const mood = require('./mood');
const deezer = require('./deezer');
const exclude = require('./exclude');
const fs = require('node:fs');
const nodePath = require('node:path');
const paths = require('./paths');

/* What "never play X" means here too: mood filters the library for the request, but the
   catalogue fill was never filtered, so a taught exclusion could come back as a new
   download. A term named in the request still overrides the ban for that request. */
function bannedTerms() {
  try {
    const s = JSON.parse(fs.readFileSync(nodePath.join(paths.DATA, 'settings.json'), 'utf8'));
    return exclude.parse(s.taste_avoid || '');
  } catch { return []; }
}

const INTENTS = ['build_playlist', 'search_tracks', 'artist_albums', 'download_album', 'download_missing', 'report_library'];

/* Phone keyboards emit ’ ‘ “ ”. Every instruction regex here is written with ASCII
   quotes, so "I don’t have" silently missed the outside request and answered with the
   library. Normalise once, at the edge. */
function cleanQuery(text) {
  return String(text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

const FOLLOW_RE = /^(more|fewer|less|another|add|remove|drop|make (?:it|them)|same|also|but|now|instead|plus|minus|swap|replace|darker|lighter|faster|slower|shorter|longer|no |without |only |just |and )/i;
/* A follow-up is an instruction about the previous draft. "Short and not a genre word"
   was too generous: "10 aphex twin" is a new subject and inherited the previous genres. */
const FOLLOW_MODIFIER = /^(?:(?:a|an|the|it|them|that|this|more|fewer|less|another|same|but|and|also|now|instead|plus|minus|only|just|no|without|darker|lighter|faster|slower|shorter|longer|louder|quieter|tracks?|songs?|ones?|please|ok|okay|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s*)+$/i;
function isFollowUp(text) {
  const t = cleanQuery(text).trim();
  if (!t) return false;
  if (FOLLOW_RE.test(t)) return true;
  return FOLLOW_MODIFIER.test(t);
}

/* Apply an instruction to the plan it refers to. The deterministic pass covers count
   and scope; anything about mood goes through the model, which is given the old plan. */
function mergePlan(prev, text) {
  const plan = JSON.parse(JSON.stringify(prev && prev.plan ? prev.plan : {}));
  plan.args = plan.args || {};
  const t = cleanQuery(text).toLowerCase();
  const num = t.match(/\b(\d{1,3})\b/);
  const explicit = num && /\b(tracks?|songs?|items?|make it|give me|of them)\b/.test(t);
  const delta = num ? Number(num[1]) : 5;
  if (explicit) plan.args.count = Math.max(1, Math.min(100, Number(num[1])));
  else {
    if (/\b(more|another|add|plus|bigger|longer)\b/.test(t)) plan.args.count = Math.min(100, (Number(plan.args.count) || 20) + delta);
    if (/\b(fewer|less|remove|drop|minus|shorter|smaller)\b/.test(t)) plan.args.count = Math.max(5, (Number(plan.args.count) || 20) - delta);
  }
  if (/\b(only|just)\b[^.]*\b(my|the)\s+library\b/.test(t) || /\bno new\b/.test(t)) plan.args.allowExternal = false;
  if (/\b(don'?t limit|outside|from outside|new tracks?|discover)\b/.test(t)) plan.args.allowExternal = true;
  // "no Imagine Dragons" / "drop the unicorns" removes that from the brief
  const drop = t.match(/\b(?:no|without|drop|remove|minus)\s+([a-z0-9 '&.-]{2,40})/);
  if (drop) {
    const word = drop[1].trim().toLowerCase();
    plan.args.artists = (plan.args.artists || []).filter((a) => !word.includes(String(a).toLowerCase()));
    plan.args.themes = (plan.args.themes || []).filter((th) => !word.includes(String(th).toLowerCase()));
  }
  plan.args.query = `${prev && prev.question ? cleanQuery(prev.question) : ''} — ${cleanQuery(text)}`.trim();
  return plan;
}

function planLocally(text) {
  text = cleanQuery(text);
  // the same Portuguese reader the query engine uses: intent words, counts and ranges,
  // never prepositions, so an artist name survives. Kept in its original case as well:
  // "albums by Fear Factory" must not become "fear factory".
  let nt = text;
  try { nt = require('./query').normalizePortuguese(text); } catch {}
  const t = String(nt || '').toLowerCase();
  const countMatch = t.match(/(\d{1,3})\s*(?:[a-z-]+\s+){0,4}(?:songs?|tracks?|items?)/i);
  // "10 aphex twin" asks for ten things even without the noun; a unit is not a request
  const leading = t.match(/^\s*(\d{1,3})\s+\S/i);
  const bareCount = !!leading && !/^\s*\d{1,3}\s*(?:bpm|minutes?|hours?|seconds?|years?)\b/i.test(t);
  const count = countMatch ? Math.min(Number(countMatch[1]), 100)
    : bareCount ? Math.min(Number(leading[1]), 100) : 20;
  // "build me 20 tracks of dark techno" is a draft request, not a library report. The
  // verb list was missing every synonym of create except 'create', so the most natural
  // way to ask for a set fell through to report_library and answered with a count.
  // a counted noun is a request for that many tracks ("10 ambient tracks I don't
  // have"), and a style with a tempo is a set ("20 dark techno at 130"). Both used to
  // fall through to report_library, which answered a request for music with a count.
  const reportish = /\b(how many|how much|what do i have|what'?s in|what is in|do i have any)\b/.test(t);
  const countedRequest = countMatch && !reportish;
  const styledTempo = /\b\d{2,3}\s*bpm\b|\bat\s+1[0-9]{2}\b/.test(t);
  const wantsPlaylist = /\b(playlist|set|mix|selection|lineup)\b/.test(t)
    || /\b(create|build|make|curate|put together|throw together|assemble)\b/.test(t)
    || /\b(give me|i need|i want|can you get|can i get)\b/.test(t)
    || /\b(something|anything)\b/.test(t) || /\bmusic for\b/.test(t)
    // "no estilo de X" / "baseado em X" is a request for music, not a library report
    || /\b(?:no estilo de|estilo|basead[oa] (?:em|no)|parecid[oa] com)\b/.test(t)
    || countedRequest || (bareCount && !reportish) || styledTempo || (childAudience(t) && !reportish);
  const wantsDownload = /\bdownload\b/.test(t);
  // "albums by Fear Factory" / "Fear Factory's discography" is a catalogue listing
  // match against the original text, not the lowercased copy: the artist's casing is
  // part of the name ("Fear Factory", not "fear factory")
  const byAlbums = nt.match(/\b(?:albums?|discography)(?:\s+[\w'áéíóúâêôãõç]+){0,3}\s+(?:by|from|of|de)\s+(.+)$/i);
  const ownsAlbums = text.match(/^(.+?)(?:'s|’s)\s+(?:albums?|discography)\s*[?.!]*$/i);
  const trailingAlbums = text.match(/^(.+?)\s+(?:albums?|discography)\s*[?.!]*$/i);
  const whatAlbums = text.match(/\bwhat albums (?:does|do) (.+?) have\b/i);
  const artistAlbums = byAlbums || ownsAlbums || whatAlbums || trailingAlbums;
  if (artistAlbums) {
    const artist = String(artistAlbums[1] || '')
      .replace(/\b(?:please|for me|now|the|all|download|get|grab)\b/gi, ' ')
      .replace(/[?.!]+$/, '')
      .replace(/\s+/g, ' ').trim();
    if (artist) return { intent: 'artist_albums', args: { artist } };
  }
  if (/\balbum\b/.test(t) && wantsDownload) {
    const latest = /\b(latest|newest|new|recent)\b/.test(t);
    const name = String(text)
      .replace(/\b(download|get|grab|the|album|by|from|please|of|latest|newest|new|recent|release)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return { intent: 'download_album', args: { query: name || text, latest } };
  }
  if (wantsPlaylist) return { intent: 'build_playlist', args: { query: text, count, download: wantsDownload } };
  // counting and coverage questions, even when they start with 'what'
  if (/\b(how many|how much|what do i have|what'?s in|what is in|do i have any)\b/.test(t)) {
    return { intent: 'report_library', args: { query: text } };
  }
  if (/\b(find|search|show|which|list|what)\b/.test(t) && !/\bplaylist\b/.test(t)) {
    return { intent: 'search_tracks', args: { query: text, limit: count } };
  }
  if (wantsDownload) return { intent: 'download_missing', args: { query: text } };
  return { intent: 'report_library', args: { query: text } };
}

const PLAN_SCHEMA = `{"intent":"build_playlist|search_tracks|artist_albums|download_album|download_missing|report_library","args":{...}}
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
- artist_albums: {"artist":"the artist whose albums they asked for"}
- download_album: {"query":"artist or album"}
- download_missing: {"query":"album or artist if named"}
Rules:
- "albums by X", "X's discography", "what albums does X have" is artist_albums, never search_tracks.
- A brief with a person, an age, an occasion or several likes is build_playlist even without the word playlist.
- themes must be things a catalogue can actually search: not 'unicorns' alone but "unicorn song for kids".
- artists only real artists; never invent, and never put instruction words or genres there.
- A genre or style after "de"/"of" ("uma lista de techno", "10 faixas de samba") is a genre, not an artist.
- genres are broad names (techno, samba, jazz); themes are 1-4 short search phrases for the catalogue.
- allowExternal is true when they say not to limit to the library, or ask for things they do not have.
- count defaults to 20. download is true only if they ask to download.
Examples, request -> JSON:
"uma lista de techno que eu não tenho" -> {"intent":"build_playlist","args":{"query":"uma lista de techno que eu não tenho","count":20,"genres":["techno"],"allowExternal":true}}
"10 faixas de samba para uma festa" -> {"intent":"build_playlist","args":{"query":"10 faixas de samba para uma festa","count":10,"genres":["samba"],"themes":["samba party"],"allowExternal":true}}
"create a playlist based on Bedouin" -> {"intent":"build_playlist","args":{"query":"create a playlist based on Bedouin","count":20,"artists":["Bedouin"],"allowExternal":true}}
"baixar o álbum Random Access Memories" -> {"intent":"download_album","args":{"query":"Daft Punk Random Access Memories"}}
"quantas faixas eu tenho" -> {"intent":"report_library","args":{"query":"quantas faixas eu tenho"}}
"algo mais escuro" (after a draft) -> {"intent":"build_playlist","args":{"query":"algo mais escuro","count":20}}`;

/* The agent speaks the interface language: same endpoint, same model, a prompt written in
   the language the request arrives in, instead of translating the answer afterwards. */
/* The agent's own sentences, written in the language of the request. Nothing here is
   translated from a previous answer: each sentence has a Portuguese form and an English
   one, and the request decides which set is used. */
const PT_SENTENCES = [
  [/^For a brief: (.+)\.$/, 'Para um briefing: $1.'],
  [/^(\d+) clean catalogue tracks; nothing from your library, which has no explicit flag\.$/,
    '$1 faixas limpas do catálogo; nada da sua biblioteca, que não tem marcação de conteúdo explícito.'],
  [/^(\d+) from your library — it has no explicit flag, so check these before playing them to a child\.$/,
    '$1 da sua biblioteca — ela não tem marcação de conteúdo explícito, então confira antes de tocar para uma criança.'],
  [/^(\d+) in your library, (\d+) new\.$/, '$1 na sua biblioteca, $2 novas.'],
  [/^The catalogue did not answer just now, so this is your library only\.$/,
    'O catálogo não respondeu agora, então isto é só a sua biblioteca.'],
  [/^(\d+) of (\d+) you already play\.$/, '$1 de $2 você já toca.'],
  [/^None of these are in your library\.$/, 'Nenhuma destas está na sua biblioteca.'],
  [/^Nothing in your library matched\.$/, 'Nada na sua biblioteca correspondeu.'],
  [/^(\d+) tracks? match (.+), (\d+) with audio\.$/, '$1 faixas correspondem a $2, $3 com áudio.'],
  [/^(\d+) tracks? in your library, (\d+) in the catalogue\.$/, '$1 faixas na sua biblioteca, $2 no catálogo.'],
  [/^Queued (\d+) downloads?\.$/, '$1 downloads na fila.'],
  [/^(\d+) of (\d+) tracks have audio\. Families: (.+)\.$/, (m, a, b, c) => `${a} de ${b} ${b === '1' ? 'faixa tem' : 'faixas têm'} áudio. Famílias: ${c}.`],
  [/^I could not find that album in the catalogue\.$/, 'Não encontrei esse álbum no catálogo.'],
  [/^(\d+) found in the catalogue for “(.+)”\.$/, '$1 encontradas no catálogo para “$2”.'],
  [/^(\d+) found in the catalogue\.$/, '$1 encontradas no catálogo.'],
  [/^Confirm and I will fetch them\.$/, 'Confirme e eu baixo.'],
  [/^Nothing by “(.+)” is in your library, and the catalogue returned no match for that name\.$/,
    'Nada de “$1” está na sua biblioteca, e o catálogo não achou esse nome.'],
  [/^(\d+) by “(.+)” in your library, nothing new found\.$/, '$1 de “$2” na sua biblioteca, nada novo encontrado.'],
  [/^(\d+) by “(.+)” in your library, (\d+) new from the catalogue\.$/, '$1 de “$2” na sua biblioteca, $3 novas do catálogo.'],
  [/^(\d+) new from artists around your rotation\.$/, '$1 novas de artistas da sua rotação.'],
  [/^(\d+) new from “(.+)”\.$/, '$1 novas de “$2”.'],
  [/^(\d+) new from the catalogue\.$/, '$1 novas do catálogo.'],
  [/^Nothing new turned up this time\.$/, 'Nada novo apareceu desta vez.'],
  [/^All from your library\.$/, 'Tudo da sua biblioteca.'],
  [/^nothing in your library matched\.?$/i, 'nada na sua biblioteca correspondeu.'],
  [/^(\d+) in your library fit\.?$/, '$1 na sua biblioteca servem.'],
  [/^(.+) from your library\.?$/, '$1 da sua biblioteca.'],
  [/^You do not have (.+) yet, so this follows the request instead$/,
    'Você ainda não tem $1, então isto segue o pedido'],
  [/^follows (.+): (\d+) BPM, (.+)$/, 'segue $1: $2 BPM, $3'],
  [/^(.+): under (\d+) BPM\.$/, '$1: abaixo de $2 BPM.'],
];

function localizeReason(text, lang) {
  const raw = String(text || '');
  if (!isPt(lang) || !raw) return raw;
  // a rule may cover the whole answer (two sentences: a count and a family breakdown)
  for (const [re, to] of PT_SENTENCES) {
    if (re.test(raw.trim())) return raw.trim().replace(re, to);
  }
  return raw.split(/(?<=[.!?])\s+/).map((sentence) => {
    const trimmed = sentence.trim();
    for (const [re, to] of PT_SENTENCES) {
      if (re.test(trimmed)) return trimmed.replace(re, to);
    }
    return sentence;
  }).join(' ');
}

const isPt = (lang) => String(lang || '').toLowerCase().startsWith('pt');
// the agent's own words: two templates, chosen by the request's language
function say(lang, en, pt) { return isPt(lang) ? pt : en; }

function planPrompt(lang, context, text) {
  const pt = String(lang || '').toLowerCase().startsWith('pt');
  const head = pt
    ? `Transforme um pedido de música em JSON. Responda apenas JSON, sem texto.
O pedido pode estar em português ou em inglês. Leia como está escrito, mantenha os nomes de
intent e o schema exatamente como abaixo, e escreva artistas e temas na grafia normal.
Um pedido de playlist em português devolve "query" em português e um "name" curto em
português. Os "themes" são frases curtas que um catálogo consegue encontrar e, como o
catálogo indexa em inglês, escreva-os em inglês (por exemplo "armazém" -> "warehouse
techno").`
    : `Turn a music request into JSON. Reply with JSON only, no prose.
The request may be written in Portuguese or in English. Read it as it is written, keep the
intent names and the JSON schema exactly as below, and put artist and theme names in their
normal spelling.`;
  return `${head}${context}
${PLAN_SCHEMA}
Request: ${text}`;
}

async function planWithModel(llm, text, previous, lang = 'en') {
  const context = previous && previous.plan
    ? `\nThis is a follow-up. The previous request was: ${previous.question}\nIts plan was: ${JSON.stringify(previous.plan)}\nReturn the updated plan: keep what still applies, change only what the new instruction changes, and keep the same intent unless it says otherwise.\n`
    : '';
  const prompt = planPrompt(lang, context, text);
  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    let raw = '';
    try { raw = String(await llm.askRaw(prompt, 20000, { json: true }) || ''); } catch (e) { if (attempt === 1) throw e; continue; }
    const cleaned = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    if (!parsed && attempt === 2) console.error('[agent] model raw:', String(raw).slice(0, 240).replace(/\s+/g, ' '));
  }
  if (!parsed) throw new Error('model returned nothing usable');
  if (!INTENTS.includes(parsed.intent)) throw new Error('unknown intent');
  if (!parsed.args || typeof parsed.args !== 'object') parsed.args = {};
  return parsed;
}

async function execute(db, plan, deps, lang = 'en') {
  const { enqueueTrackDownload } = deps;
  if (plan.intent === 'report_library') {
    const total = db.prepare('SELECT COUNT(*) c FROM tracks').get().c;
    const withAudio = db.prepare("SELECT COUNT(DISTINCT track_id) c FROM files WHERE tier='owned'").get().c;
    const families = db.prepare("SELECT genre_family g, COUNT(*) c FROM tracks WHERE genre_family IS NOT NULL GROUP BY g ORDER BY c DESC").all();
    // "how many techno tracks" is a filtered question, not a library-wide one
    const q = String((plan.args && plan.args.query) || '').trim();
    if (q) {
      try {
        // the question words are not search terms
        const cleaned = q
          .replace(/\b(how many|how much|do i have|have i got|are there|is there|do i own|what do i have|what is in|what's in|how many of|in my library|do i|i have|my)\b/gi, ' ')
          .replace(/\s+/g, ' ').trim();
        const filters = queryEngine.parse(cleaned || q, db);
        const scoped = filters.genre || filters.family || filters.key || filters.bpm || (filters.text && filters.text.length);
        if (scoped) {
          filters.limit = 5000;
          let rows = queryEngine.run(db, filters);
          // a stray word must not zero out a real genre match
          if (!rows.length && filters.text && filters.text.length) rows = queryEngine.run(db, { ...filters, text: [] });
          const owned = rows.filter((t) => t.owned).length;
          const what = filters.notes && filters.notes.length ? filters.notes.join(', ') : q;
          return {
            spoken: `${rows.length} track${rows.length === 1 ? '' : 's'} match ${what}${owned ? `, ${owned} with audio` : ''}.`,
            data: { total: rows.length, withAudio: owned, families, library: rows.slice(0, 50) },
          };
        }
      } catch {}
    }
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
    // descriptor words ('deeply melodic') must not zero out a real genre or play filter
    if (!library.length && filters.text && filters.text.length) {
      library = queryEngine.run(db, { ...filters, text: [] });
    }
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
  db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(pid, name, 'ai', 'listen', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

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
  const { foldLower } = require('./text');
  const norm = (v) => foldLower(v).replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(artist)}|${norm(title)}`;
}

function listName(query) {
  // \w is ASCII: it turned "não" into "n o" and stored that in the playlist name
  const n = String(query || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\b(create|make|build|please|a|an|the|playlist|of|with|for|me|tracks?|songs?|items?|top|rated|best|rating|at|around|about|bpm|by|like|i|my|library|outside|unheard|discover|don'?t|do|not|have|own|it|from|that|this)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!n) return 'Made by request';
  return (n.charAt(0).toUpperCase() + n.slice(1)).slice(0, 60);
}

function ownedIdFor(db, dupKey) {
  return db.prepare(`SELECT t.id, EXISTS(SELECT 1 FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned
    FROM tracks t WHERE t.dup_key=?`).get(dupKey);
}

// related artists of the tracks we picked, so online candidates follow taste, not a keyword
/* iTunes matches fuzzily: searching a name that does not exist returns real but
   unrelated songs. A fill is only allowed to answer the question that was asked, so a
   result must share a word with the request or at least its genre family. */
const REL_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'tracks', 'track', 'songs', 'song', 'from', 'into', 'some', 'any', 'new', 'more', 'like', 'music']);
function relevanceGate(queryText) {
  const words = String(queryText || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !REL_STOP.has(w));
  if (!words.length) return () => true;                 // no subject to test against
  const genreLib = require('./genre');
  const families = new Set(words.map((w) => genreLib.familyOfString(w)).filter(Boolean));
  return (t) => {
    const hay = `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.genre || ''}`.toLowerCase();
    if (words.some((w) => hay.includes(w))) return true;
    const fam = t.family || (t.genre ? genreLib.familyOfString(t.genre) : null);
    return !!(fam && families.has(fam));
  };
}

async function onlineFill(db, localPicks, need, queryText) {
  if (need <= 0) return [];
  const related = relevanceGate(queryText);
  const inLib = new Set(db.prepare('SELECT dup_key FROM tracks').all().map((r) => r.dup_key));
  const seen = new Set();
  const seenTitle = new Set();
  const out = [];
  const keep = (t) => {
    if (!t || !t.title || !t.artist) return false;
    if (t.duration && t.duration < 90) return false;
    const key = dupOf(t.artist, t.title);
    if (inLib.has(key) || seen.has(key)) return false;
    const titleKey = String(t.title).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(remaster(?:ed)?|version|edit)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenTitle.has(titleKey)) return false;
    seenTitle.add(titleKey);
    seen.add(key);
    return true;
  };
  const push = ({ title, artist, album, duration, cover, preview, genre, family, explicit }) => {
    if (out.length >= need) return;
    // the catalogue answering a different question is not an answer
    if (!related({ title, artist, album, genre, family })) return;
    if (!keep({ title, artist, duration })) return;
    out.push({ title, artist, album: album || '', duration: duration || null, source: 'online', owned: false,
      cover: cover || null, preview: preview || null, explicit: !!explicit, key: dupOf(artist, title) });
  };

  /* The query comes first, and it goes to the catalogue that needs no key. The old order
     asked Deezer to name an artist from the sentence; when that failed it silently fell
     back to the most-played artists in the library, so "ambient I don't have" answered
     with the user's own metal. A fallback must never pretend to be an answer. */
  if (queryText) {
    const cat = await identity.catalog(queryText, { songs: Math.max(need * 3, 25), albums: 0, artists: 0 }).catch(() => ({ songs: [] }));
    for (const t of (cat.songs || [])) { if (out.length >= need) break; push(t); }
    if (out.length < need) {
      const songs = await identity.artistSongs(queryText, Math.max(need * 2, 20)).catch(() => []);
      for (const t of songs) { if (out.length >= need) break; push(t); }
    }
  }

  // related artists of what was picked keeps an unqualified request on taste
  let seeds = [...new Set((localPicks || []).map((t) => t.artist).filter(Boolean))].slice(0, 3);
  if (!seeds.length && queryText) {
    const direct = await deezer.artistSearch(queryText).catch(() => null);
    if (direct) seeds = [direct.name];
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
        push({ title: t.title, artist: t.artist && t.artist.name, album: (t.album && t.album.title) || '',
          duration: t.duration, cover: (t.album && t.album.cover_medium) || null, preview: t.preview || null });
      }
    }
  }

  // a request with no subject at all ("surprise me") may start from what is played most
  if (!out.length && !queryText) {
    const top = db.prepare(`SELECT artist FROM tracks WHERE artist IS NOT NULL AND artist != ''
      GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 3`).all().map((r) => r.artist);
    for (const seed of top) {
      if (out.length >= need) break;
      const songs = await identity.artistSongs(seed, 8).catch(() => []);
      for (const t of songs) { if (out.length >= need) break; push(t); }
    }
  }
  return out;
}

/* a brief names people and things, not a tempo. "unicorns and robots for a five year
   old who likes Imagine Dragons" is not a keyword search, so it gets its own path:
   match the named artists and themes locally, then go and find the rest outside. */
/* A seven-year-old is a different audience, not a different genre. The only safety
   signal we have is the catalogue's explicit flag, so a child brief is built from the
   catalogue and never from library rows, which carry no such flag. */
function childAudience(text) {
  const t = String(text || '').toLowerCase();
  const age = t.match(/\b(\d{1,2})\s*(?:year|yr)s?[ -]?old\b/) || t.match(/\b(\d{1,2})\s*yo\b/);
  if (age && Number(age[1]) < 13) return true;
  // people write the age as a word as often as a digit
  if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:year|yr)s?[ -]?old\b/.test(t)) return true;
  // "play Baby by Justin Bieber" is a song, not an audience: only a possessive counts
  return /\b(kids?|children|child|toddler|preschool|nursery|my (daughter|son|niece|nephew|granddaughter|grandson))\b/.test(t)
    || /\bfor (?:my|our|the) baby\b/.test(t)
    || /\b(crian[cç]a|filh[ao]|beb[eê]|menin[oa]|sobrinh[ao])\b/.test(t);
}

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

/* One predicate, used by the fill and tested directly. briefWords() returns an array;
   the old guard tested `.size`, which was undefined, so every catalogue result passed. */
function briefMatches(themes, t) {
  const words = briefWords(themes);
  if (!words.length) return true;
  const hay = `${t.title || ''} ${t.album || ''} ${t.genre || ''}`.toLowerCase();
  // a brief says "robots", a title says "The Robot Song": one plural is not a miss
  const forms = (w) => [w, w.replace(/s$/, '')];
  if (words.some((w) => forms(w).some((f) => f.length > 2 && hay.includes(f)))) return true;
  return /children/i.test(String(t.genre || ''));
}

async function briefFill(db, { artists = [], themes = [], need = 0, childSafe = false }) {
  if (need <= 0) return [];
  const inLib = new Set(db.prepare('SELECT dup_key FROM tracks').all().map((r) => r.dup_key));
  const seen = new Set();
  const words = briefWords(themes);
  const out = [];
  const push = (t) => {
    if (!t || !t.title || !t.artist || out.length >= need) return;
    // the catalogue says which recordings are explicit; a children's set uses only clean
    if (childSafe && t.explicit) return;
    const key = dupOf(t.artist, t.title);
    if (inLib.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({
      key, title: t.title, artist: t.artist, album: t.album || '', duration: t.duration || null,
      cover: t.cover || null, preview: t.preview || null, explicit: !!t.explicit, source: 'online', owned: false,
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
    const res = await identity.catalog(th, { songs: childSafe ? 30 : 12, albums: 0, artists: 0 }).catch(() => ({ songs: [] }));
    // filter against this theme, not the union: "samba party" + "samba" required both
    // words in every row, so the broad genre list came back empty
    lists.push((res.songs || []).filter((t) => briefMatches([th], t)));
  }
  for (let i = 0; out.length < need && i < 12; i += 1) {
    let took = false;
    for (const list of lists) {
      if (out.length >= need) break;
      if (list[i]) { push(list[i]); took = true; }
    }
    if (!took) break;
  }
  // Short is short. Padding a brief with whatever the catalogue happened to return is
  // how "5 tracks by zzqqxxv" came back with five unrelated songs.
  return out;
}

/* "Albums by X" is answered from the catalogue, not from the three rows that happen to
   be in the library. Each album says how much of it is already here, so a download is a
   choice rather than a blind queue. */
async function artistAlbums(db, artist) {
  const name = String(artist || '').trim();
  if (!name) return { kind: 'albums', title: 'Albums', albums: [], reason: 'Name an artist to list their albums.', summary: 'no artist' };
  const cat = await identity.catalog(name, { songs: 0, albums: 40, artists: 0 }).catch(() => ({ albums: [] }));
  const want = name.toLowerCase();
  const seen = new Set();
  const albums = [];
  for (const a of (cat.albums || [])) {
    if (!a || !a.name) continue;
    const who = String(a.artist || '').toLowerCase();
    if (!who.includes(want) && !want.includes(who)) continue;
    const key = `${String(a.name).toLowerCase()}|${a.year || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END) owned
      FROM tracks t LEFT JOIN files f ON f.track_id=t.id AND f.tier='owned'
      WHERE lower(COALESCE(t.album,''))=lower(?)`).get(a.name) || {};
    albums.push({
      name: a.name, artist: a.artist, year: a.year || null,
      tracks: a.tracks || null, cover: a.cover || a.artwork || null,
      inLibrary: rows.total || 0, owned: rows.owned || 0,
    });
  }
  // albums already in the library come first, even when the catalogue's relevance list
  // does not reach them: "Open" must be possible for what you own
  const local = db.prepare(`SELECT COALESCE(NULLIF(TRIM(t.album),''),'') album, COUNT(*) n,
      SUM(CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END) owned
    FROM tracks t LEFT JOIN files f ON f.track_id=t.id AND f.tier='owned'
    WHERE lower(COALESCE(t.artist,'')) LIKE ?
    GROUP BY t.album HAVING album != ''`).all(`%${want}%`);
  const have = new Set(albums.map((a) => String(a.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  const own = [];
  for (const l of local) {
    const key = String(l.album).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || have.has(key)) continue;
    have.add(key);
    own.push({ name: l.album, artist: name, year: null, tracks: l.n,
      cover: `/api/cover-album/${encodeURIComponent(l.album)}`,
      inLibrary: l.n, owned: l.owned });
  }
  albums.sort((a, b) => (b.year || 0) - (a.year || 0));
  albums.unshift(...own);
  return {
    kind: 'albums',
    title: `Albums by ${name}`,
    artist: name,
    albums: albums.slice(0, 40),
    reason: albums.length
      ? `${albums.length} album${albums.length === 1 ? '' : 's'}${own.length ? ` · ${own.length} already in your library` : ''}. Open one you have, or download it.`
      : `The catalogue returned no albums for “${name}”.`,
    summary: `${albums.length} album${albums.length === 1 ? '' : 's'}`,
  };
}

// "create a playlist based on Bedouin" names an artist without the word "by". The rules
// planner only looked for "by X", so the whole sentence went to the catalogue, which
// answered with nothing and the playlist came back empty.
// A word after "de" that names a style is a genre, not an artist. The family regexes are
// English-centric, so the Brazilian styles are listed explicitly.
// \\b does not sit next to an accented letter (it is not an ASCII word character), so
// "forró" never matched. A letter-class boundary works for both spellings.
const PT_GENRES = /(?:^|[^\p{L}])(samba-enredo|samba|pagode|forr[oó]|xote|bai[aã]o|piseiro|arrocha|tecnobrega|brega|carimb[oó]|lambada|frevo|maracatu|ax[eé]|bossa nova|mpb|choro|seresta|mod[aã]o|sertanejo|funk carioca|baile funk|funk|trap|rap|gospel|louvor)(?![\p{L}])/iu;
function genreWord(name) {
  const v = String(name || '');
  const hit = v.match(PT_GENRES);
  if (hit) return hit[1];
  try {
    for (const [, re] of require('./genre').FAMILIES) {
      const m = v.match(re);
      if (m) return m[0];
    }
  } catch {}
  return '';
}

function looksLikeGenre(name) {
  const v = String(name || '').trim();
  if (!v) return false;
  if (PT_GENRES.test(v)) return true;
  try { return require('./genre').FAMILIES.some(([, re]) => re.test(v)); } catch { return false; }
}

function seedArtist(text) {
  const m = String(text || '').match(
    /(?:\bbased on\b|\binspired by\b|\bin the style of\b|\bsimilar to\b|\bsounds? like\b|\b(?:artists?|music|something|songs?|tracks?)\s+like\b|\bby\b|\bno estilo de\b|\bbasead[oa] (?:em|no)\b|\bparecid[oa] com\b|\bpor\b)\s+(.{2,60})/i);
  if (!m) return '';
  let name = m[1]
    .replace(/\b(?:please|for me|now|the|all|download|get|grab|playlist|crate|set|mix|tracks?|songs?)\b/gi, ' ')
    .replace(/[?.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "tracks like this" points at nothing: do not turn it into an artist name
  if (/^(?:this|that|these|those|it|them|mine|yours|theirs|his|hers)$/i.test(name)) return '';
  // "electronic duo Bedouin" is a description of the artist, not the artist
  for (let i = 0; i < 5; i += 1) {
    const next = name.replace(/^(?:an?|the|electronic|techno|house|ambient|downtempo|indie|duo|trio|band|group|artist|producer|dj|singer|composer|brasileir[oa])\s+/i, '').trim();
    if (next === name) break;
    name = next;
  }
  return name;
}

async function propose(db, plan, lang = 'en') {
  if (plan.intent === 'build_playlist') {
    const q = String(plan.args.query || '').trim();
    const count = Math.max(1, Math.min(Number(plan.args.count) || 20, 100));
    const artists = (plan.args.artists || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 4);
    const themes = (plan.args.themes || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 4);
    const genres = (plan.args.genres || []).map((g) => String(g).trim()).filter(Boolean).slice(0, 4);
    let normQ0 = q;
    try { normQ0 = require('./query').normalizePortuguese(q); } catch {}
    const onlyLocalEarly = /\b(only|just|from)\s+(my|the)\s+library\b|\bno new\b/i.test(normQ0);
    const BRIEF_RE = /\b(for my|she likes|he likes|they like|who likes|shes into|hes into|don'?t limit|birthday|wedding|kids?|children|toddler|for (?:my|our|the) baby|story time|year old|\d+\s*yo|about (unicorns?|robots?|dinosaurs?|space|animals?))\b/i;
    // the same occasions in Portuguese; without these a Portuguese brief fell through to
    // a plain library search
    const BRIEF_PT = /\b(?:para (?:a|o|minha|meu|nossa|nosso)|anivers[aá]rio|festa|casamento|crian[cç]a|filh[ao]|beb[eê]|gosta de|curte|anos de idade)\b/i;
    // the model is good at naming artists and themes, unreliable at deciding what a brief
    // is: 'a techno set for a warehouse' is not one. Decide locally.
    const brief = BRIEF_RE.test(q) || BRIEF_PT.test(q) || artists.length > 0 || themes.length > 0;
    if (brief && !themes.length && !artists.length) {
      // the model called it a brief but gave us nothing to look for: use the sentence,
      // minus the instructions, as the search phrase
      const fallback = q.replace(/\b(create|make|build|playlist|for|my|a|an|the|please|some|of|with|songs?|tracks?|uma|um|lista|para|minha|meu|nossa|nosso|criar|montar|fazer|com|das?|dos?)\b/gi, ' ')
        .replace(/\s+/g, ' ').trim();
      if (fallback) themes.push(fallback.slice(0, 60));
    }
    const picked = mood.select(db, String(plan.args.query || q), count);
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

    const onlyLocal = /\b(only|just|from)\s+(my|the)\s+library\b|\bno new\b/i.test(normQ0);
    const wantsNew = /\b(new|discover|online|unreleased|not in my library|find more|don'?t limit)\b/i.test(normQ0);
    // "something I don't have" is a request for music that is NOT here. Without this the
    // answer was the user's own shelf, which is the opposite of what was asked.
    const outsideOnly = /\b(?:not in (?:my|the) library|outside (?:my|the) library|don'?t have|do not have|i don'?t own|unheard|new to me|discover)\b/i.test(normQ0);
    const discovery = onlyLocal ? 0 : (wantsNew || outsideOnly) ? 1 : 0.25;
    // catalogue queries must not carry the instruction words
    // the catalogue query is built from the normalised sentence: "10 faixas de X" has
    // already become "10 tracks by X", so the instruction words actually match
    const searchQ = normQ0
      .replace(/\b(i|we|you|do|does|don'?t|do not|not|have|has|own|my|the|outside|in|library|unheard|discover|new|to|me|from|with|some|any|that|which|are|is|and|or|of|for|please|create|make|build|playlist|crate|set|tracks?|songs?|uma|um|lista|para|minha|meu|nossa|nosso|criar|montar|fazer|com|das?|dos?|que)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    // "tracks by X" names one artist. If X is not here, the mood of the sentence is not a
    // substitute for X, and neither is whatever the catalogue returned for a name it did
    // not recognise — the honest answer is that there is nothing.
    // read the artist from the normalised sentence: "10 faixas de X" becomes "10 tracks by X"
    let normQ = q;
    try { normQ = require('./query').normalizePortuguese(q); } catch {}
    const byName = (normQ.match(/\bby\s+([\p{L}\p{N}][\p{L}\p{N} .&'\-]{1,48})/iu) || [])[1];
    // "by X" means only X. "based on X" / "like X" means use X to search, not a hard
    // filter: an English request like "a playlist like Berghain" names a club, and
    // filtering every catalogue result by that word returned nothing.
    // The model already classified the sentence. "10 faixas de samba para uma festa"
    // normalises to "10 tracks by samba para uma festa", and treating that as an artist
    // emptied both the library and the catalogue. A genre is not a name.
    const modelClassified = genres.length > 0 || themes.length > 0 || looksLikeGenre(byName || seedArtist(q));
    const strictArtist = !!byName && !modelClassified;
    const wantedArtist = modelClassified
      ? ''
      : byName
        ? byName.replace(/\b(i|we|you|don'?t|do not|have|has|not|my|the|library|please|now|that|which|are|is|and|or|new|unheard)\b.*$/i, '').trim()
        : seedArtist(q);
    let local = [];
    if (brief) {
      // the brief names people and things: match those, not the sentence
      const words = briefWords(themes);
      const names = artists.map((a) => a.toLowerCase());
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.genre, t.genre_family,
          (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
          (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays
        FROM tracks t`).all();
      const phrases = themes.map((th) => String(th).toLowerCase()).filter(Boolean);
      const wordList = [...words];
      const needWords = Math.min(2, Math.max(1, wordList.length));
      local = rows.filter((t) => {
        const hay = `${t.title || ''} ${t.album || ''} ${t.genre || ''} ${t.genre_family || ''}`.toLowerCase();
        const byArtist = names.some((a) => String(t.artist || '').toLowerCase().includes(a));
        // one shared word is a coincidence ("party" in a techno title); a phrase or two
        // words is a match
        const phraseHit = phrases.some((ph) => ph.length > 4 && hay.includes(ph));
        const hits = wordList.filter((w) => hay.includes(w)).length;
        return byArtist || phraseHit || hits >= needWords;
      }).sort((a, b) => (b.owned || 0) - (a.owned || 0)).slice(0, count);
    }
    // a brief that matched nothing in the library is not an invitation to play the
    // current rotation: that is how a seven-year-old's playlist filled with dark techno
    if (brief && !local.length) local = [];
    if (outsideOnly) {
      // "I don't have" wins over a named artist: the answer is not their shelf copy
      local = [];
    } else if (wantedArtist) {
      const needle = wantedArtist.toLowerCase();
      const rows = db.prepare(`SELECT t.id, t.title, t.artist, t.album, t.bpm, t.key, t.key_scale, t.genre, t.genre_family,
          (SELECT COUNT(*) FROM files f WHERE f.track_id=t.id AND f.tier='owned') owned,
          (SELECT COUNT(*) FROM listens l WHERE l.track_id=t.id) plays
        FROM tracks t`).all();
      local = rows.filter((t) => String(t.artist || '').toLowerCase().includes(needle));
    } else if (!local.length && !brief) local = picked.tracks;
    const childSafe = childAudience(q);
    // no explicit flag exists for library files, so a child's set is catalogue-only
    if (childSafe && brief && !onlyLocalEarly) local = [];
    // a brief goes outside unless the request says to stay in the library
    const allowExternal = !onlyLocal && (brief || plan.args.allowExternal !== false);
    // a brief that says "don't limit yourself" must leave room outside: 20 local tracks
    // and nothing new is the same failure in a different coat
    if (brief && allowExternal && local.length >= count) local = local.slice(0, Math.max(1, Math.round(count * 0.6)));
    let online = [];
    // hoisted: the reason below reads it after the branch has closed
    let targetOnline = 0;
    if (brief) {
      if (childSafe) {
        const hasKidTheme = themes.some((th) => /child|kid|family|preschool|nursery/i.test(String(th)));
        if (!hasKidTheme) themes.push("children's dance party");
        // a second, plainer angle so a 15-track request is not left short by one narrow query
        if (!themes.some((th) => /kids? (dance|party|songs)|children's music/i.test(String(th)))) {
          themes.push('kids dance songs');
        }
      }
      // genres are broad names: they belong in the catalogue search even when the model
      // also gave narrower themes. Without this, "samba para uma festa" searched only
      // "samba party" and matched nothing.
      online = allowExternal ? await briefFill(db, {
        artists, themes: [...themes, ...genres], need: Math.max(0, count - local.length), childSafe,
      }) : [];
    } else {
      targetOnline = onlyLocal ? 0 : Math.max(Math.round(count * discovery), count - local.length);
      if (outsideOnly) targetOnline = count;
      if (wantedArtist) targetOnline = Math.max(targetOnline, count - local.length);
      if (targetOnline > 0 && !outsideOnly && local.length > count - targetOnline) local = local.slice(0, Math.max(0, count - targetOnline));
      // a count is not a search term: "10 ambient" used to be sent to the catalogue whole
      const onlineQuery = (wantedArtist || genres.join(' ') || genreWord(byName || seedArtist(q)) || searchQ || picked.ctx.text.join(' '))
        .replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
      online = await onlineFill(db, outsideOnly || wantedArtist ? [] : local,
        Math.min(targetOnline, Math.max(0, count - local.length)),
        onlineQuery);
    }
    // "by X" means X is the artist. A song called "Meshuggah" by someone else is not one.
    if (strictArtist && online.length) {
      const needle = wantedArtist.toLowerCase();
      online = online.filter((t) => String(t.artist || '').toLowerCase().includes(needle));
    }
    // the taught exclusions apply to the catalogue too, unless this request names the term
    const avoidNow = bannedTerms().filter((w) => !q.toLowerCase().includes(w));
    if (avoidNow.length) {
      local = local.filter((t) => !exclude.matches(avoidNow, t));
      online = online.filter((t) => !exclude.matches(avoidNow, t));
    }
    // if the network gave us less than we hoped, top up from the rest of the local picks —
    // unless the request was explicitly for music that is not here
    if (!outsideOnly && !wantedArtist && local.length + online.length < count) {
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
      // a genre request should name the genre, not the English catalogue phrase the model
      // used to search it ("forró dance")
      const subject = (!artists.length && genres.length) ? genres.join(', ') : [what, artists.join(', ')].filter(Boolean).join(' · ');
      reasonBits = [say(lang, `For a brief: ${subject}.`, `Para um briefing: ${subject}.`)];
      if (childSafe && !onlyLocal) {
        reasonBits.push(`${online.length} clean catalogue tracks; nothing from your library, which has no explicit flag.`);
      } else if (childSafe) {
        reasonBits.push(`${local.length} from your library — it has no explicit flag, so check these before playing them to a child.`);
      } else {
        reasonBits.push(`${local.length} in your library, ${online.length} new.`);
      }
      if (allowExternal && !online.length && identity.recentError()) {
        reasonBits.push('The catalogue did not answer just now, so this is your library only.');
      }
    } else if (local.length) reasonBits.push(`${played} of ${local.length} you already play.`);
    // 'include some I don't have' is an instruction, not a search term
    const FILLER = /^(include|including|some|any|ones|tracks|songs|track|song|that|which|i|dont|don't|have|has|not|no|in|my|library|new|find|more|from|the|a|an|and|or|with|of|for|to|please|create|make|build|playlist|crate|set|by|like)$/i;
    const sourceName = (wantedArtist || genres.join(' ') || searchQ || picked.ctx.text.join(' '))
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => !FILLER.test(w))
      .join(' ');
    if (outsideOnly) {
      reasonBits = [`None of these are in your library.`, `${online.length} found in the catalogue${sourceName ? ` for “${sourceName}”` : ''}.`, online.length ? 'Confirm and I will fetch them.' : ''];
    } else if (wantedArtist && !tracks.length) {
      reasonBits = [`Nothing by “${wantedArtist}” is in your library, and the catalogue returned no match for that name.`];
    } else if (wantedArtist) {
      reasonBits = [`${local.length} by “${wantedArtist}” in your library, ${online.length ? `${online.length} new from the catalogue.` : 'nothing new found.'}`];
    } else if (!brief) {
      if (online.length) reasonBits.push(local.length ? `${online.length} new from artists around your rotation.` : `${online.length} new from ${sourceName ? `“${sourceName}”` : 'the catalogue'}.`);
      else if (targetOnline && identity.recentError()) reasonBits.push('The catalogue did not answer just now, so this is your library only.');
      else reasonBits.push(targetOnline ? 'Nothing new turned up this time.' : 'All from your library.');
    }
    if (!tracks.length && wantedArtist) name = say(lang, `Nothing by ${wantedArtist}`, `Nada de ${wantedArtist}`);
    return {
      kind: 'playlist', name, trackIds: local.map((t) => t.id), online, tracks,
      download: !!plan.args.download,
      title: name,
      // fragments are sentences: every one of them starts with a capital
      reason: localizeReason(reasonBits.join(' ')
        .replace(/\s*\.\s*/g, '. ')
        .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, c) => pre + c.toUpperCase())
        .trim(), lang),
      summary: say(lang,
        `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${tracks.length - missing} local · ${missing} new`,
        `${tracks.length} ${tracks.length === 1 ? 'faixa' : 'faixas'} · ${tracks.length - missing} ${tracks.length - missing === 1 ? 'local' : 'locais'} · ${missing} ${missing === 1 ? 'nova' : 'novas'}`),
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

function commit(db, proposal, deps, lang = 'en') {
  const at = Math.floor(Date.now() / 1000);
  let queued = 0;
  if (proposal.kind === 'playlist') {
    const pid = `ai-${Date.now().toString(36)}`;
    db.prepare('INSERT INTO playlists (id,name,source,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(pid, proposal.name, 'ai', 'listen', at, at);
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
    return { spoken: say(lang,
      `Created "${proposal.name}" with ${ids.length} tracks${queued ? `, ${queued} downloading` : ''}.`,
      `Criei “${proposal.name}” com ${ids.length} ${ids.length === 1 ? 'faixa' : 'faixas'}${queued ? `, ${queued} baixando` : ''}.`),
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

module.exports = { planLocally, planWithModel, execute, propose, commit, isFollowUp, mergePlan, relevanceGate, childAudience, artistAlbums, briefWords, briefMatches, cleanQuery, seedArtist, planPrompt, localizeReason };

