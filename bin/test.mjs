// Real assertions, not just status codes. Run: node bin/test.mjs
const BASE = process.env.BASE || 'http://LAN_IP:8710';
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

console.log('agent intents');
const rep = await post('/api/agent', { q: 'how much of my library has audio' });
ok('report_library', rep.body && rep.body.plan.intent === 'report_library', JSON.stringify(rep.body?.plan));
const find = await post('/api/agent', { q: 'find techno tracks I never played' });
ok('search_tracks', find.body && find.body.plan.intent === 'search_tracks', JSON.stringify(find.body?.plan));
const alb = await post('/api/agent', { q: 'download the album Pinkfong Animal Songs' });
ok('download_album', alb.body && alb.body.plan.intent === 'download_album', JSON.stringify(alb.body?.plan));

console.log('ask capabilities');
const h1 = await post('/api/ask', { q: 'what can you do for me' });
ok('capability question gets help', h1.body && h1.body.source === 'help', JSON.stringify(h1.body?.source));
ok('help answer is prose', typeof h1.body?.answer === 'string' && h1.body.answer.length > 40);
ok('help offers examples', Array.isArray(h1.body?.examples) && h1.body.examples.length >= 3);
const h2 = await post('/api/ask', { q: 'what can you assist me with' });
ok('assist phrasing also gets help', h2.body && h2.body.source === 'help', JSON.stringify(h2.body?.source));
const h3 = await post('/api/ask', { q: 'tracks in Dm between 120 and 130 bpm' });
ok('a real query is still a query', h3.body && h3.body.source !== 'help' && h3.body.filters && h3.body.filters.key === 'D');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
