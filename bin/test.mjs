// Real assertions, not just status codes. Run: node bin/test.mjs
// defaults to a local instance; set BASE to test a deployed one
const BASE = process.env.BASE || 'http://localhost:8710';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
};
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const post = (p, b) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const patch = (p, b) => j(p, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const del = (p) => j(p, { method: 'DELETE' });

console.log('playlist lifecycle');
const created = await post('/api/playlists', { name: 'selftest ' + Date.now() });
ok('create playlist', created.status === 200 && created.body && created.body.id, JSON.stringify(created.body).slice(0, 80));
ok('a new playlist is listening by default', ((await j('/api/playlists')).body || []).find((x) => x.id === created.body?.id)?.kind === 'listen', 'kind=' + ((await j('/api/playlists')).body || []).find((x) => x.id === created.body?.id)?.kind);

const pid = created.body && created.body.id;
const tracks = await j('/api/tracks');
const t = (tracks.body || []).find((x) => !x.ladder);
ok('library has a track to work with', !!t);
if (pid && t) {
  const added = await post(`/api/playlists/${pid}/tracks`, { track_id: t.id });
  ok('add track', added.status === 200, JSON.stringify(added.body).slice(0, 60));
  const listed = await j(`/api/playlists/${pid}/tracks`);
  const listedRows = Array.isArray(listed.body) ? listed.body : (listed.body && listed.body.tracks) || [];
  ok('track is in the playlist', listedRows.some((x) => x.id === t.id), 'count=' + listedRows.length + ' type=' + typeof listed.body);
  const removed = await del(`/api/playlists/${pid}/tracks/${t.id}`);
  ok('remove track', removed.status === 200);
  const after = await j(`/api/playlists/${pid}/tracks`);
  const afterRows = Array.isArray(after.body) ? after.body : (after.body && after.body.tracks) || [];
  ok('playlist is empty again', afterRows.length === 0, 'count=' + afterRows.length);
  const renamed = await patch(`/api/tracks/${t.id}`, { title: (t.title || 'x') });
  ok('rename accepts same title', renamed.status === 200, JSON.stringify(renamed.body).slice(0, 60));
  const clash = await patch(`/api/tracks/${t.id}`, { title: t.title });
  ok('rename is idempotent', clash.status === 200);
}
if (pid) {
  const deleted = await del(`/api/playlists/${pid}`);
  ok('delete playlist', deleted.status === 200);
  const gone = await j(`/api/playlists/${pid}/tracks`);
  const goneRows = Array.isArray(gone.body) ? gone.body : (gone.body && gone.body.tracks) || [];
  ok('deleted playlist has no tracks', goneRows.length === 0);
}

console.log('download resolution');
const res = await j('/api/debug/resolve?artist=Burial&title=Archangel&duration=238');
ok('resolver answers', res.status === 200 && res.body && 'chosen' in res.body, JSON.stringify(res.body).slice(0, 80));
ok('resolver picks a source', !!(res.body && res.body.chosen), 'no candidate within tolerance');

console.log('search cache');
const q = 'burial archangel';
const s1 = await j('/api/search/ladder?q=' + encodeURIComponent(q));
const s2 = await j('/api/search/ladder?q=' + encodeURIComponent(q));
ok('search answers', s1.status === 200, String(s1.status));
ok('second search served from cache', !!(s2.body && s2.body.cached), 'cached=' + (s2.body && s2.body.cached));
ok('cache returns the same result count', (s1.body?.results || []).length === (s2.body?.results || []).length);

console.log('guards');
const short = await j('/api/search/ladder?q=a');
ok('one character query rejected', short.status === 400, String(short.status));
// oversized upload is checked by hand: sending 70MB from a test run is not worth the time

console.log('crate repair feedback');
const rj = await j('/api/playlists/__none__/repair');
ok('repair reports a job shape', rj.status === 200 && rj.body && rj.body.running === false && 'done' in rj.body && 'total' in rj.body, JSON.stringify(rj.body));
ok('repair reports the fields it changed', rj.status === 200 && Array.isArray(rj.body?.changes), JSON.stringify(rj.body));
const raj = await j('/api/albums/__none__/repair');
ok('album repair reports the same shape', raj.status === 200 && raj.body && raj.body.running === false && 'fields' in raj.body, JSON.stringify(raj.body));

console.log('discovery prompts');
const sug = await j('/api/ask/suggest');
const prompts = sug.body?.prompts || [];
ok('A&R suggestions include an outside-library prompt', prompts.length >= 3 && prompts.some((p) => /i (?:do not|don't) have/i.test(p)), JSON.stringify(prompts));
ok('A&R suggestions also keep a library prompt', prompts.some((p) => /not played|never played|bpm|added this week/i.test(p)), JSON.stringify(prompts));

console.log('upload duplicates');
// a minimal silent WAV, so the upload path is exercised without shipping a fixture
const wav = (() => {
  const samples = 8000, data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
})();
const upName = `selftest-dup-${Date.now()}.wav`;
const up1 = await fetch(`${BASE}/api/upload/track?name=${upName}`, { method: 'POST', body: wav });
const up1b = await up1.json();
ok('a file uploads once', up1.status === 200 && !!up1b.track, JSON.stringify(up1b));
const up2 = await fetch(`${BASE}/api/upload/track?name=${upName.replace('.wav', ' (2).wav')}`, { method: 'POST', body: wav });
const up2b = await up2.json();
ok('the same track is refused as a duplicate', up2.status === 409 && up2b.duplicate === true, `${up2.status} ${JSON.stringify(up2b)}`);
if (up1b.track) await post('/api/tracks/delete', { ids: [up1b.track] });

console.log('guards, again');
const badListen = await post('/api/listen', { track_id: 999999999 });
ok('an unknown track id is rejected, not a foreign-key error', badListen.status === 400 && /no such track/.test(badListen.body?.error || ''), `${badListen.status} ${JSON.stringify(badListen.body)}`);
const listenPl = await post('/api/playlists', { name: 'listen guard ' + Date.now() });
if (listenPl.body?.id) {
  await patch(`/api/playlists/${listenPl.body.id}`, { kind: 'listen' });
  const guarded = await post(`/api/playlists/${listenPl.body.id}/analyze`, {});
  ok('a listening playlist refuses analysis', guarded.status === 200 && guarded.body?.started === false && /listening/i.test(guarded.body?.note || ''), JSON.stringify(guarded.body));
  await del(`/api/playlists/${listenPl.body.id}`);
}

console.log('home radio');
const rad = await j(`/api/radio/${t ? t.id : 1}`);
ok('radio fills a queue instead of one card', Array.isArray(rad.body) && rad.body.length >= 10, `n=${Array.isArray(rad.body) ? rad.body.length : '?'}`);

console.log('typographic input');
const curly = await post('/api/agent', { q: '2 tracks by Aphex Twin I don’t have' });
ok('a curly apostrophe still means "outside my library"', curly.body?.action?.kind === 'playlist' && (curly.body.action.trackIds || []).length === 0, JSON.stringify(curly.body?.plan));

console.log('analysis version');
const an = await j('/api/analyze/status');
ok('analysis reports its version', Number(an.body?.version) >= 2, JSON.stringify(an.body));
ok('analysis accounting adds up', !!an.body && an.body.current + an.body.outdated + an.body.never === an.body.total,
  `${an.body?.current}+${an.body?.outdated}+${an.body?.never} != ${an.body?.total}`);
ok('prepped is a subset of current', !!an.body && an.body.prepped <= an.body.current);

console.log('playlist role');
const rolePl = await post('/api/playlists', { name: 'role ' + Date.now() });
const rolePid = rolePl.body?.id;
if (rolePid) {
  const setListen = await patch(`/api/playlists/${rolePid}`, { kind: 'listen' });
  const roleList = await j('/api/playlists');
  const roleRow = (roleList.body || []).find((x) => x.id === rolePid);
  ok('a playlist can be marked listening', setListen.status === 200 && roleRow?.kind === 'listen', JSON.stringify(roleRow));
  const setDj = await patch(`/api/playlists/${rolePid}`, { kind: 'dj' });
  const list2 = await j('/api/playlists');
  ok('and back to a DJ set', setDj.status === 200 && (list2.body || []).find((x) => x.id === rolePid)?.kind === 'dj');
  await del(`/api/playlists/${rolePid}`);
}

console.log('agent intents');
const rep = await post('/api/agent', { q: 'how much of my library has audio' });
ok('report_library', rep.body && rep.body.plan.intent === 'report_library', JSON.stringify(rep.body?.plan));
const find = await post('/api/agent', { q: 'find techno tracks I never played' });
ok('search_tracks', find.body && find.body.plan.intent === 'search_tracks', JSON.stringify(find.body?.plan));
const albq = await post('/api/agent', { q: 'Albums by fear factory' });
ok('albums by an artist is its own intent', albq.body?.plan?.intent === 'artist_albums', JSON.stringify(albq.body?.plan));
ok('the album list comes from the catalogue', albq.body?.action?.kind === 'albums' && (albq.body?.action?.albums || []).length > 0, JSON.stringify(albq.body?.action?.summary));
ok('each album says how much is here', (albq.body?.action?.albums || []).every((a) => typeof a.owned === 'number'));
const alb = await post('/api/agent', { q: 'download the album Pinkfong Animal Songs' });
ok('download_album previews instead of queueing', alb.body && alb.body.plan.intent === 'download_album' && alb.body.action && alb.body.action.kind === 'album', JSON.stringify(alb.body?.plan));

console.log('ask capabilities');
const h1 = await post('/api/ask', { q: 'what can you do for me' });
ok('capability question gets help', h1.body && h1.body.source === 'help', JSON.stringify(h1.body?.source));
ok('help answer is prose', typeof h1.body?.answer === 'string' && h1.body.answer.length > 40);
ok('help offers examples', Array.isArray(h1.body?.examples) && h1.body.examples.length >= 3);
const h2 = await post('/api/ask', { q: 'what can you assist me with' });
ok('assist phrasing also gets help', h2.body && h2.body.source === 'help', JSON.stringify(h2.body?.source));
const h3 = await post('/api/ask', { q: 'tracks in Dm between 120 and 130 bpm' });
ok('a real query is still a query', h3.body && h3.body.source !== 'help' && h3.body.filters && h3.body.filters.key === 'D');


console.log('guided ask');
const plBefore = ((await j('/api/playlists')).body || []).length;
const prop = await post('/api/agent', { q: 'create a dance music playlist of 10 tracks from my library' });
const act = prop.body && prop.body.action;
ok('a mutation returns a proposal', !!act && act.kind === 'playlist', JSON.stringify(prop.body?.plan));
ok('proposal lists up to the requested count', (act?.tracks || []).length > 0 && (act?.tracks || []).length <= 10, 'tracks=' + (act?.tracks || []).length);
ok('proposal explains the style', /dance floor/i.test(act?.reason || ''), act?.reason);
const plAfterPreview = ((await j('/api/playlists')).body || []).length;
ok('preview creates nothing', plAfterPreview === plBefore, plBefore + ' -> ' + plAfterPreview);
const confirmed = await post(`/api/agent/action/${act?.id}`, { confirm: true });
ok('confirm creates the playlist', confirmed.status === 200 && confirmed.body?.data?.playlist?.tracks === (act?.tracks || []).length, JSON.stringify(confirmed.body?.data));
const createdPid = confirmed.body?.data?.playlist?.id;
if (createdPid) await del(`/api/playlists/${createdPid}`);

const techno = await post('/api/agent', { q: 'create a techno playlist of 5 tracks from my library' });
const technoId = techno.body?.action?.id;
const cancelled = await post(`/api/agent/action/${technoId}`, { cancel: true });
ok('cancel dismisses the proposal', cancelled.status === 200 && !!cancelled.body?.cancelled);
const afterCancel = await post(`/api/agent/action/${technoId}`, { confirm: true });
ok('a cancelled proposal cannot be confirmed', afterCancel.status === 410, String(afterCancel.status));

const moodProp = await post('/api/agent', { q: 'create a playlist of 10 tracks that make people question everything from my library' });
ok('mood request gets a proposal', !!moodProp.body?.action, JSON.stringify(moodProp.body?.plan));
ok('mood is named in the reason', /unsettling/i.test(moodProp.body?.action?.reason || ''), moodProp.body?.action?.reason);

const refProp = await post('/api/agent', { q: 'create a dance playlist like Igorrr from my library' });
ok('reference artist gets a proposal', !!refProp.body?.action, JSON.stringify(refProp.body?.plan));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
