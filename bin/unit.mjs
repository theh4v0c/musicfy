/* Unit tests for the pure functions. No server, no database, no network:
 *   node --test bin/unit.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../core/harmonic.js');
const A = require('../core/agent.js');
const G = require('../core/genre.js');
const L = require('../core/ladder.js');
const F = require('../core/folder.js');
const LLM = require('../core/llm.js');

const MINOR = { 1: 'G#', 2: 'D#', 3: 'A#', 4: 'F', 5: 'C', 6: 'G', 7: 'D', 8: 'A', 9: 'E', 10: 'B', 11: 'F#', 12: 'C#' };
const MAJOR = { 1: 'B', 2: 'F#', 3: 'C#', 4: 'G#', 5: 'D#', 6: 'A#', 7: 'F', 8: 'C', 9: 'G', 10: 'D', 11: 'A', 12: 'E' };

test('the twelve minor keys land on 1A..12A', () => {
  for (const [n, key] of Object.entries(MINOR)) {
    const c = H.camelotOf(key, 'minor');
    assert.equal(c && c.n, Number(n), `${key}m`);
    assert.equal(c && c.minor, true);
    assert.equal(H.camelotLabel(key, 'minor'), `${n}A`);
  }
});

test('the twelve major keys land on 1B..12B', () => {
  for (const [n, key] of Object.entries(MAJOR)) {
    assert.equal(H.camelotLabel(key, 'major'), `${n}B`);
  }
});

test('flats are the same key as their sharps', () => {
  assert.equal(H.camelotLabel('Db', 'major'), H.camelotLabel('C#', 'major'));
  assert.equal(H.camelotLabel('Eb', 'minor'), H.camelotLabel('D#', 'minor'));
  assert.equal(H.camelotLabel('Bb', 'major'), H.camelotLabel('A#', 'major'));
});

test('the four compatibility rules', () => {
  const a = (n, minor) => ({ n, minor });
  assert.equal(H.harmonicScore(a(8, true), a(8, true)), 1);      // same
  assert.equal(H.harmonicScore(a(8, true), a(8, false)), 0.9);   // relative major
  assert.equal(H.harmonicScore(a(8, true), a(9, true)), 0.85);   // one along
  assert.equal(H.harmonicScore(a(8, true), a(9, false)), 0.45);  // energy boost
  assert.equal(H.harmonicScore(a(8, true), a(10, true)), 0.4);   // two along
  assert.equal(H.harmonicScore(a(8, true), a(11, true)), 0);     // clash
  assert.equal(H.harmonicScore(a(12, true), a(1, true)), 0.85);  // wraps 12 -> 1
});

test('8A and 9B are not a match, 8A and 8B are the relative pair', () => {
  const eightA = H.camelotOf('A', 'minor');
  const nineB = H.camelotOf('G', 'major');
  const eightB = H.camelotOf('C', 'major');
  assert.equal(H.harmonicScore(eightA, nineB), 0.45);
  assert.equal(H.harmonicScore(eightA, eightB), 0.9);
  assert.notEqual(H.harmonicScore(eightA, nineB), 1);
});

test('harmonicOrder takes the best available move at every step', () => {
  const t = (key, scale) => ({ id: key + scale, key, key_scale: scale });
  const list = [t('A', 'minor'), t('F', 'major'), t('E', 'minor'), t('', null), t('B', 'minor'), t('C#', 'minor')];
  const out = H.harmonicOrder(list);
  assert.equal(out.length, list.length);
  assert.equal(out.at(-1).key, '');            // unkeyed last
  const keyed = out.filter((x) => x.key && H.camelotLabel(x.key, x.key_scale));
  for (let i = 1; i < keyed.length; i += 1) {
    const cur = H.camelotOf(keyed[i - 1].key, keyed[i - 1].key_scale);
    const chosen = H.camelotOf(keyed[i].key, keyed[i].key_scale);
    const remaining = keyed.slice(i).map((x) => H.camelotOf(x.key, x.key_scale));
    const best = Math.max(...remaining.map((c) => H.harmonicScore(cur, c)));
    assert.equal(H.harmonicScore(cur, chosen), best, `step ${i} was not the best available move`);
  }
});

test('recommend does not carry a second, wrong wheel', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = new URL('../core/', import.meta.url).pathname;
  const wheels = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /const CAMELOT\b|const MINOR_A\b/.test(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(wheels, ['harmonic.js'], `wheel defined in ${wheels.join(', ')}`);
  // and the score recommend now reads is the relative pair, not silence
  assert.equal(H.harmonicScore(H.camelotOf('A', 'minor'), H.camelotOf('C', 'major')), 0.9);
});

test('a compatible chain stays on the wheel', () => {
  const t = (key, scale) => ({ id: key + scale, key, key_scale: scale });
  // A minor -> E minor -> B minor -> F# minor is the classic 8A..11A walk
  const list = [t('F#', 'minor'), t('A', 'minor'), t('B', 'minor'), t('E', 'minor')];
  const keys = H.harmonicOrder(list).map((x) => H.camelotLabel(x.key, x.key_scale));
  for (let i = 1; i < keys.length; i += 1) {
    const a = { n: Number(keys[i - 1].slice(0, -1)), minor: keys[i - 1].endsWith('A') };
    const b = { n: Number(keys[i].slice(0, -1)), minor: keys[i].endsWith('A') };
    assert.ok(H.harmonicScore(a, b) > 0, `${keys[i - 1]} -> ${keys[i]}`);
  }
});

test('a new subject is not a follow-up', () => {
  assert.equal(A.isFollowUp('10 aphex twin'), false);
  assert.equal(A.isFollowUp('albums by fear factory'), false);
  assert.equal(A.isFollowUp('make it darker'), true);
  assert.equal(A.isFollowUp('the same but slower'), true);
  assert.equal(A.isFollowUp('two more'), true);
});

test('the brief filter rejects a single-word coincidence', () => {
  // "Kids" is a real song, but it is not about unicorns or robots
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'Kids', artist: 'MGMT', album: 'Oracular Spectacular', genre: 'Alternative',
  }), false);
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'Sleeping Unicorns', artist: 'The Kiboomers', album: 'x', genre: "Children's Music",
  }), true);
  assert.equal(A.briefMatches(['unicorns and robots'], {
    title: 'The Robot Song', artist: 'Remember White', album: 'x', genre: 'Pop',
  }), true);
});

test('a curly apostrophe is the same instruction', () => {
  assert.equal(A.cleanQuery('I don’t have it'), "I don't have it");
  assert.equal(A.planLocally('5 Gespona tracks I don’t have').intent, 'build_playlist');
  assert.equal(A.isFollowUp('make it darker'), true);
});

test('children’s music is recognised without a genre', () => {
  assert.equal(G.looksChildren({ title: 'Sprunki (Get Funky)', artist: 'ANGRYHED' }), true);
  assert.equal(G.looksChildren({ title: 'Friend Like You (Sped Up)', artist: 'Horror Skunx', album: 'Horror Skunx' }), true);
  assert.equal(G.looksChildren({ title: 'Kids', artist: 'MGMT', album: 'Oracular Spectacular' }), false);
  assert.equal(G.looksChildren({ genre: "Children's Music" }), true);
  assert.equal(G.looksChildren({ genre: 'Techno' }), false);
  assert.equal(G.looksChildren({ album: 'Nursery Rhymes', artist: 'Meshuggah', title: 'War' }), false);
});

test('a plain request is not answered with a remaster', () => {
  const plain = { title: 'Glints Collide', artist: 'Meshuggah', duration: 296, wantsRemaster: false };
  const remaster = { title: 'Glints Collide', artist: 'Meshuggah', duration: 296, wantsRemaster: false };
  const a = L.scoreCandidate({ title: 'Glints Collide', artist: 'Meshuggah', duration: 296 }, plain);
  const b = L.scoreCandidate({ title: 'Glints Collide (Remastered 2006)', artist: 'Meshuggah', duration: 297 }, remaster);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  assert.equal(L.titleForVersion('Glints Collide', 'Glints Collide', 'Glints Collide (Remastered 2006)'), 'Glints Collide');
  assert.equal(L.titleForVersion('Glints Collide (Remastered 2006)', 'Glints Collide', 'Glints Collide (Remastered 2006)'), 'Glints Collide (Remastered 2006)');
});

const O = require('../core/album-order.js');
const fakeDb = (writes) => ({ prepare: (sql) => ({ run: (...args) => writes.push({ sql, args }) }) });

test('album order writes missing numbers and sorts by them', () => {
  const writes = [];
  const rows = [
    { id: 1, title: 'Second', duration: 200, track_no: 2, disc_no: null },
    { id: 2, title: 'First', duration: 201, track_no: null, disc_no: null },
  ];
  const list = [
    { title: 'First', trackNumber: 1, discNumber: 1, duration: 201 },
    { title: 'Second', trackNumber: 2, discNumber: 1, duration: 200 },
  ];
  const out = O.apply(fakeDb(writes), rows.slice(), list);
  assert.deepEqual(out.map((r) => r.id), [2, 1]);
  assert.equal(out[0].track_no, 1);
  assert.equal(out.filled, 1);
  assert.equal(writes.filter((w) => /SET track_no/.test(w.sql)).length, 1);
  assert.equal(writes.filter((w) => /SET disc_no/.test(w.sql)).length, 2);
});

test('album order never overwrites a track number already on the row', () => {
  const rows = [{ id: 1, title: 'One', duration: 100, track_no: 9, disc_no: null }];
  const list = [{ title: 'One', trackNumber: 1, discNumber: 1, duration: 100 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out[0].track_no, 9);
  assert.equal(out.filled, 0);
});

test('album order falls back to duration for a mangled title', () => {
  const rows = [{ id: 4, title: 'C**k/ver10', duration: 300, track_no: null, disc_no: null }];
  const list = [{ title: 'Cock/ver10', trackNumber: 8, discNumber: 1, duration: 300 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out[0].track_no, 8);
});

test('album order keeps discs apart', () => {
  const rows = [
    { id: 1, title: 'D2T1', duration: 100, track_no: 1, disc_no: null },
    { id: 2, title: 'D1T2', duration: 100, track_no: 2, disc_no: null },
    { id: 3, title: 'D1T1', duration: 100, track_no: 1, disc_no: null },
  ];
  const list = [
    { title: 'D1T1', trackNumber: 1, discNumber: 1, duration: 100 },
    { title: 'D1T2', trackNumber: 2, discNumber: 1, duration: 100 },
    { title: 'D2T1', trackNumber: 1, discNumber: 2, duration: 100 },
  ];
  const out = O.apply(fakeDb([]), rows.slice(), list);
  assert.deepEqual(out.map((r) => r.id), [3, 2, 1]);
});

test('album order ignores a same-name release that shares almost no titles', () => {
  const rows = [
    { id: 1, title: 'Alpha', duration: 100, track_no: null, disc_no: null },
    { id: 2, title: 'Beta', duration: 100, track_no: null, disc_no: null },
    { id: 3, title: 'Gamma', duration: 100, track_no: null, disc_no: null },
    { id: 4, title: 'Delta', duration: 100, track_no: null, disc_no: null },
  ];
  const list = [{ title: 'Something Else', trackNumber: 1, discNumber: 1, duration: 100 }];
  const out = O.apply(fakeDb([]), rows, list);
  assert.equal(out.filled, 0);
  assert.equal(out[0].track_no, null);
});

test('a rate limit or bot check stops the client ladder', () => {
  // the exact lines yt-dlp printed on the store VPS
  assert.equal(L.blockedByAddress('ERROR: [youtube] x: Unable to download webpage: HTTP Error 429: Too Many Requests'), true);
  assert.equal(L.blockedByAddress('ERROR: [youtube] x: Sign in to confirm you’re not a bot'), true);
  assert.equal(L.blockedByAddress('ERROR: unable to download video data: HTTP Error 403: Forbidden'), true);
  // a real per-video problem must keep walking the clients
  assert.equal(L.blockedByAddress('ERROR: [youtube] dQw4w9WgXcQ: Video unavailable'), false);
  assert.equal(L.blockedByAddress('WARNING: Signature solving failed: some formats may be missing'), false);
  assert.equal(L.blockedByAddress(''), false);
});

test('the last-resort search is not double prefixed', () => {
  const plan = L.searchPlan('Afterclapp', 'Capitão de Areia');
  assert.deepEqual(plan, [
    'scsearch5:Afterclapp Capitão de Areia',
    'scsearch5:Capitão de Areia',
    'ytsearch1:Afterclapp Capitão de Areia',
  ]);
  for (const q of plan) assert.equal((q.match(/search\d+:/g) || []).length, 1, q);
  assert.equal(L.searchPlan('', '').length, 0);
  // an artist-only seed still produces a usable title query, never an empty one
  assert.deepEqual(L.searchPlan('Afterclapp', ''), ['scsearch5:Afterclapp', 'ytsearch1:Afterclapp']);
});

test('portuguese requests reach the same planner as english', () => {
  const Q = require('../core/query.js');
  // parse() only asks the database for genre/artist resolution; the filters do not need it
  const db = { prepare: () => ({ get: () => null, all: () => [] }) };
  assert.equal(A.planLocally('no estilo de Bedouin').intent, 'build_playlist');
  const build = A.planLocally('criar uma lista com 10 faixas ambient');
  assert.equal(build.intent, 'build_playlist');
  assert.equal(build.args.count, 10);
  assert.equal(A.planLocally('quantas faixas eu tenho').intent, 'report_library');
  assert.equal(A.planLocally('baixar o álbum Tal').intent, 'download_album');
  // a key, a tempo range and "never played" survive the normalisation
  const f = Q.parse('faixas em Dm entre 120 e 130 bpm', db);
  assert.equal(f.key, 'D');
  assert.equal(f.scale, 'minor');
  assert.deepEqual(f.bpm, { min: 120, max: 130 });
  assert.deepEqual(Q.parse('faixas que nunca tocou', db).plays, { max: 0 });
  assert.equal(Q.parse('faixas não baixadas', db).owned, false);
  // an artist name is not rewritten by the Portuguese reader
  const album = A.planLocally('albums de Fear Factory');
  assert.equal(album.intent, 'artist_albums');
  assert.match(album.args.artist, /Fear Factory/);
});

test('a playlist "based on" an artist names that artist', () => {
  // the exact request that returned 0 tracks
  assert.equal(A.seedArtist('create a playlist based on Bedouin'), 'Bedouin');
  assert.equal(A.seedArtist('a playlist based on electronic duo Bedouin'), 'Bedouin');
  assert.equal(A.seedArtist('tracks inspired by Floating Points'), 'Floating Points');
  assert.equal(A.seedArtist('playlist no estilo de Bedouin'), 'Bedouin');
  assert.equal(A.seedArtist('uma lista baseada em Bedouin'), 'Bedouin');
  assert.equal(A.seedArtist('songs like Burial'), 'Burial');
  // no seed named: the sentence is not an artist
  assert.equal(A.seedArtist('a playlist for a warehouse'), '');
  assert.equal(A.seedArtist('10 ambient tracks'), '');
  assert.equal(A.seedArtist('tracks like this'), '');
});

test('the plan prompt follows the request language', () => {
  const en = A.planPrompt('en', '', 'make a playlist');
  const pt = A.planPrompt('pt-BR', '', 'criar uma lista');
  assert.match(en, /Turn a music request into JSON/);
  assert.match(pt, /Transforme um pedido de música em JSON/);
  // the schema and the intent names are identical in both: one contract, one model
  assert.match(en, /artist_albums/);
  assert.match(pt, /artist_albums/);
  assert.match(pt, /schema exatamente/);
});

test('the agent writes its own sentences in the request language', () => {
  const pt = (s) => A.localizeReason(s, 'pt-BR');
  assert.equal(pt('None of these are in your library. 10 found in the catalogue for “Bedouin”. Confirm and I will fetch them.'),
    'Nenhuma destas está na sua biblioteca. 10 encontradas no catálogo para “Bedouin”. Confirme e eu baixo.');
  assert.equal(pt('1 of 1 tracks have audio. Families: electronic 1.'),
    '1 de 1 faixa tem áudio. Famílias: electronic 1.');
  assert.equal(pt('4 of 5 you already play.'), '4 de 5 você já toca.');
  // english is left alone
  assert.equal(A.localizeReason('Nothing new turned up this time.', 'en'), 'Nothing new turned up this time.');
});

test('release versions compare numerically', () => {
  const R = require('../core/release.js');
  assert.equal(R.compare('0.1.46', '0.1.45'), 1);
  assert.equal(R.compare('v0.1.46', '0.1.46'), 0);
  assert.equal(R.compare('0.1.9', '0.1.10'), -1);
  assert.equal(R.compare('1.0.0', '0.99.99'), 1);
  assert.equal(R.compare('0.2', '0.2.0'), 0);
});

test('storefront resolution follows settings, not a hardcoded US', () => {
  const S = require('../core/storefront.js');
  assert.equal(S.code('br'), 'BR');
  assert.equal(S.code('brazil'), '');
  assert.equal(S.fromName('Brazil'), 'BR');
  assert.equal(S.fromName('Brasil'), 'BR');
  // explicit > saved > geocoded name > env > US
  assert.equal(S.resolve({ explicit: 'jp', settings: { storefront_country: 'BR' }, env: {} }), 'JP');
  assert.equal(S.resolve({ settings: { storefront_country: 'pt' }, env: {} }), 'PT');
  assert.equal(S.resolve({ settings: { country: 'Brazil' }, env: {} }), 'BR');
  assert.equal(S.resolve({ settings: { country: 'BR' }, env: {} }), 'BR');
  assert.equal(S.resolve({ settings: {}, env: { MUSICFY_COUNTRY: 'de' } }), 'DE');
  assert.equal(S.resolve({ settings: {}, env: {} }), 'US');
});

test('the planner prompt carries examples, so the model is the guide', () => {
  const pt = A.planPrompt('pt-BR', '', '10 faixas de samba para uma festa');
  assert.match(pt, /"genres":\["samba"\]/);
  assert.match(pt, /"artists":\["Bedouin"\]/);
  assert.match(pt, /"intent":"download_album"/);
  assert.match(pt, /JSON only, no prose|Responda apenas JSON/);
});

test('duration matching rejects a long mix and keeps a remaster', () => {
  const L = require('../core/ladder.js');
  // the 2:12 track that accepted a 3:31 candidate at 60% slack
  assert.equal(L.durationFits(132, 211), false);
  assert.equal(L.durationFits(132, 140), true);
  assert.equal(L.durationFits(150, 240), false);
  // a long track still tolerates an edition that is a few seconds longer
  assert.equal(L.durationFits(600, 620), true);
  // ingest: a three hour set for a four minute track
  assert.equal(L.durationTooLong(240, 10800), true);
  assert.equal(L.durationTooLong(240, 300), false);
  assert.equal(L.durationCeiling(240), 344);
});

test('a rescue match must name the artist', () => {
  const L = require('../core/ladder.js');
  const seed = 'Wilson Simoninha, João Sabiá';
  assert.equal(L.artistInCandidate(seed, { title: 'Loiraça Belzebu do Leblon' }), false);
  assert.equal(L.artistInCandidate(seed, { title: 'Wilson Simoninha - Meninas do Leblon' }), true);
  assert.equal(L.artistInCandidate(seed, { title: 'Meninas do Leblon', uploader: 'Wilson Simoninha' }), true);
  // no artist to check: the filter does not reject
  assert.equal(L.artistInCandidate('', { title: 'anything' }), true);
});

test('a real Traktor NML uses numeric node types and file keys', () => {
  // Traktor writes TYPE="0" for a folder and TYPE="1" for a playlist, not the words
  const xml = `<NML><COLLECTION ENTRIES="2">
    <ENTRY TITLE="Mas Que Nada" ARTIST="Jorge Ben" BPM="92.5" MUSICAL_KEY="8A" PLAYTIME="180">
      <LOCATION DIR="/:Users/:me/:Music/Samba/:" FILE="Mas%20Que%20Nada.mp3"></LOCATION></ENTRY>
    <ENTRY TITLE="Caf&#233; da Manh&#227;" ARTIST="Sergio Mendes">
      <LOCATION DIR="/:Users/:me/:Music/:" FILE="Fanfarra.flac"></LOCATION></ENTRY>
    </COLLECTION>
    <PLAYLISTS><NODE TYPE="0" NAME="$ROOT"><SUBNODES>
      <NODE TYPE="1" NAME="Sabado"><PLAYLIST ENTRIES="2">
        <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="file://localhost/Users/me/Music/Samba/Mas%20Que%20Nada.mp3"></PRIMARYKEY></ENTRY>
        <ENTRY><PRIMARYKEY TYPE="TRACK" KEY="file://localhost/Users/me/Music/Fanfarra.flac"></PRIMARYKEY></ENTRY>
      </PLAYLIST></NODE>
    </SUBNODES></NODE></PLAYLISTS></NML>`;
  const r = F.parseTraktorNml(xml);
  assert.equal(r.playlists.length, 1);
  assert.equal(r.playlists[0].name, 'Sabado');
  assert.deepEqual(r.playlists[0].entries, ['/Users/me/Music/Samba/Mas Que Nada.mp3', '/Users/me/Music/Fanfarra.flac']);
  const first = r.files.get('/Users/me/Music/Samba/Mas Que Nada.mp3');
  assert.equal(first.bpm, 92.5);
  assert.equal(first.key, 'A');
  assert.equal(first.scale, 'minor');
  assert.equal(first.duration, 180);
  assert.equal(r.files.get('/Users/me/Music/Fanfarra.flac').title, 'Café da Manhã');
});

test('the NML this app exports can be imported back', () => {
  // export.js writes TYPE="1" nodes and 1-based collection indices, not file URIs
  const xml = `<NML><COLLECTION ENTRIES="2">
    <ENTRY TITLE="One" ARTIST="A"><LOCATION DIR="/:music/:" FILE="One.mp3"></LOCATION></ENTRY>
    <ENTRY TITLE="Two" ARTIST="B"><LOCATION DIR="/:music/:" FILE="Two.mp3"></LOCATION></ENTRY>
    </COLLECTION><PLAYLISTS>
    <NODE TYPE="0" NAME="ROOT" COUNT="1"><SUBNODES COUNT="1">
    <NODE TYPE="1" NAME="Set" COUNT="1"><PLAYLIST ENTRIES="2" TYPE="LIST" UUID="X">
      <ENTRY><PRIMARYKEY TYPE="0" KEY="1"/></ENTRY>
      <ENTRY><PRIMARYKEY TYPE="0" KEY="2"/></ENTRY>
    </PLAYLIST></NODE></SUBNODES></NODE></PLAYLISTS></NML>`;
  const r = F.parseTraktorNml(xml);
  assert.equal(r.playlists.length, 1);
  assert.deepEqual(r.playlists[0].entries, ['/music/One.mp3', '/music/Two.mp3']);
});

test('readPlaylist remembers the source file of each definition', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-m3u-'));
  const a = path.join(dir, 'a.m3u');
  fs.writeFileSync(a, '#EXTM3U\nOne.mp3\n');
  const r = F.readPlaylist(a);
  assert.equal(r.playlists[0].file, a);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rekordbox XML links playlist keys to collection locations', () => {
  const xml = `<DJ_PLAYLISTS><COLLECTION>
    <TRACK TrackID="7" Name="Magalenha" Artist="Sergio Mendes" AverageBpm="128" Tonality="12B" TotalTime="240" Location="file://localhost/Users/me/Music/Magalenha.flac"></TRACK>
    </COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Batucada">
    <TRACK Key="7"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>`;
  const r = F.parseRekordboxXml(xml);
  assert.equal(r.playlists[0].name, 'Batucada');
  assert.deepEqual(r.playlists[0].entries, ['/Users/me/Music/Magalenha.flac']);
  assert.equal(r.files.get('/Users/me/Music/Magalenha.flac').bpm, 128);
  assert.equal(r.files.get('/Users/me/Music/Magalenha.flac').key, 'E');
});

test('an M3U resolves paths against its own folder', () => {
  const r = F.parseM3u('#EXTM3U\n#EXTINF:180,A - B\na.mp3\n/abs/b.flac\nhttp://stream/x\n', '/music/sets/sabado.m3u');
  assert.equal(r.playlists[0].name, 'sabado');
  assert.deepEqual(r.playlists[0].entries, ['/music/sets/a.mp3', '/abs/b.flac']);
});

test('keys come in as Camelot or names', () => {
  assert.deepEqual(F.keyParts('8A'), { key: 'A', scale: 'minor' });
  assert.deepEqual(F.keyParts('12B'), { key: 'E', scale: 'major' });
  assert.deepEqual(F.keyParts('F#m'), { key: 'F#', scale: 'minor' });
  assert.deepEqual(F.keyParts('Bb'), { key: 'A#', scale: 'major' });
  assert.equal(F.keyParts('nonsense'), null);
});

test('a model plan with the wrong types is normalised at the boundary', () => {
  const n = A.normalizeArgs({ artists: 'Aphex Twin', genres: 'techno, house', count: '5', download: 'false', allowExternal: 'true' });
  assert.deepEqual(n.artists, ['Aphex Twin']);
  assert.deepEqual(n.genres, ['techno', 'house']);
  assert.equal(n.count, 5);
  assert.equal(A.toBool(n.download), false);
  assert.equal(A.toBool(n.allowExternal), true);
  assert.equal(A.toBool('no'), false);
});

test('the NML this app writes can be read by its own importer', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const exporter = require('../core/export.js');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE tracks (id INTEGER PRIMARY KEY, title TEXT, artist TEXT, album TEXT, genre TEXT,
      bpm REAL, key TEXT, key_scale TEXT, duration REAL, beat_grid TEXT, sections TEXT,
      year TEXT, track_no INTEGER, disc_no INTEGER);
    CREATE TABLE files (id INTEGER PRIMARY KEY, track_id INTEGER, tier TEXT, path TEXT, size INTEGER, bitrate INTEGER);
    CREATE TABLE playlist_tracks (playlist_id TEXT, track_id INTEGER, position INTEGER);`);
  db.prepare('INSERT INTO playlists VALUES (?,?)').run('p1', 'Set');
  db.prepare('INSERT INTO tracks VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('One', 'A', 'Alb', 'House', 124, 'A', 'minor', 180, '[]', '[]', '2020', 1, 1);
  db.prepare('INSERT INTO tracks VALUES (2,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('Two', 'B', 'Alb', 'House', 122, 'C', 'major', 200, '[]', '[]', '2020', 2, 1);
  db.prepare("INSERT INTO files VALUES (1,1,'owned','/music/One.mp3',1000,320000)").run();
  db.prepare("INSERT INTO files VALUES (2,2,'owned','/music/Two.mp3',1000,320000)").run();
  db.prepare('INSERT INTO playlist_tracks VALUES (?,?,?)').run('p1', 1, 0);
  db.prepare('INSERT INTO playlist_tracks VALUES (?,?,?)').run('p1', 2, 1);
  const r = F.parseTraktorNml(exporter.traktorNml(db, 'p1'));
  assert.equal(r.playlists.length, 1);
  assert.deepEqual(r.playlists[0].entries, ['/music/One.mp3', '/music/Two.mp3']);
  assert.equal(r.files.get('/music/One.mp3').title, 'One');
});

test('a model base URL keeps its path', () => {
  // OpenRouter mounts the API at /api/v1; an absolute /v1 path answered 404
  assert.equal(LLM.endpoint('https://openrouter.ai/api/v1').url.href, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(LLM.endpoint('https://host/openai/v1').url.href, 'https://host/openai/v1/chat/completions');
  assert.equal(LLM.endpoint('https://host').url.href, 'https://host/v1/chat/completions');
  assert.equal(LLM.endpoint('https://host/v1/chat/completions').url.href, 'https://host/v1/chat/completions');
});

test('the model picker asks the same base, without the chat path', () => {
  // the picker must not invent a second URL shape: whatever /chat/completions resolved to,
  // /models sits next to it
  assert.equal(LLM.modelsUrl('https://openrouter.ai/api/v1').url.href, 'https://openrouter.ai/api/v1/models');
  assert.equal(LLM.modelsUrl('https://host').url.href, 'https://host/v1/models');
  assert.equal(LLM.modelsUrl('https://host/v1/chat/completions').url.href, 'https://host/v1/models');
  assert.throws(() => LLM.modelsUrl('http://metadata.google.internal/v1'), /not a model endpoint/);
});

test('a kids play cannot reach the taste tables', () => {
  // the isolation is structural, not a filter someone can forget: kids plays are written
  // to their own table, and every taste query reads `listens`
  const { readFileSync } = require('node:fs');
  const src = readFileSync(new URL('../core/core.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function recordListen'), src.indexOf('function maybeAutoDownload'));
  assert.match(fn, /if \(kids\)/, 'recordListen must branch on kids before writing listens');
  assert.match(fn, /INSERT INTO kids_listens/);
  assert.match(src, /recordListen\(\{ \.\.\.b, track_id: tid, kids: kidsOn\(req\) \}\)/,
    '/api/listen must pass the cookie, not a client-supplied flag');
  assert.doesNotMatch(fn.slice(0, fn.indexOf('if (kids)')), /INSERT INTO listens/,
    'the listens insert must not run before the kids branch');
});
