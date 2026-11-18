// MUSICFY v3. Full interaction model: queue, likes, context menu, play states, recents.
'use strict';
const $ = (id) => document.getElementById(id);
const audio = $('audio');

const state = {
  playlists: [],
  view: 'home', playlistId: null,
  queue: [], qi: -1, current: null, origin: '',
  liked: new Set(JSON.parse(localStorage.getItem('mf-liked') || '[]')),
  history: [],
  allTracks: null,
  selected: null, selectedEl: null,
  sort: { key: 'pos', dir: 1 },
  selectedIds: new Set(),
  anchorId: null,
  artV: 0,
  longSets: false,
  artistName: null, albumName: null,
};

const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// rung display: short labels, stable classes for color coding
function shortRung(rung) {
  switch ((rung || 'local').toLowerCase()) {
    case 'local': return { label: 'OWNED', cls: 'local' };
    case 'yt-dlp': case 'youtube': return { label: 'YT', cls: 'yt' };
    case 'soundcloud': return { label: 'SC', cls: 'sc' };
    case 'archive': return { label: 'WEB', cls: 'archive' };
    default: return { label: String(rung || 'OWNED').toUpperCase(), cls: 'local' };
  }
}

/* inline SVG icon set: no emoji glyphs anywhere */
const IC = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72c0 .83.92 1.34 1.62.9l10.4-6.86c.64-.42.64-1.34 0-1.76L9.62 4.24C8.92 3.8 8 4.31 8 5.14z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h2.4v14H7z"/><path d="M18.6 5.2v13.6c0 .8-.9 1.3-1.6.9l-9.3-6.8c-.6-.4-.6-1.3 0-1.7l9.3-6.8c.7-.5 1.6 0 1.6.8z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.6 5h2.4v14h-2.4z"/><path d="M5.4 5.2v13.6c0 .8.9 1.3 1.6.9l9.3-6.8c.6-.4.6-1.3 0-1.7L7 4.4c-.7-.5-1.6 0-1.6.8z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20.5s-8-4.9-8-11a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1c0 6.1-8 11-8 11z"/></svg>',
  heartFull: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-8-4.9-8-11a4.6 4.6 0 0 1 8-3.1 4.6 4.6 0 0 1 8 3.1c0 6.1-8 11-8 11z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};
const fmt = (s) => (!s || !isFinite(s)) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const artUrl = (t, s) => t && t.has_art ? `/api/cover/${t.id}?s=${s}&v=${state.artV || 0}` : null;
const ph = (t, cls) => `<div class="${cls} ph">${esc((t ? (t.title || '?') : '?').charAt(0).toUpperCase())}</div>`;
// uniform artwork setter: always a div with a background image, never a stale <img src>
function setArt(elId, url, letter) {
  const el = $(elId); if (!el) return;
  const base = (el.className || '').replace(/\bph\b/g, '').trim();
  if (url) {
    el.outerHTML = `<div id="${elId}" class="${base}" style="background-image:url('${url}');background-size:cover;background-position:center"></div>`;
  } else {
    el.outerHTML = `<div id="${elId}" class="${base} ph">${esc((letter || '?').charAt(0).toUpperCase())}</div>`;
  }
}
const artTag = (t, cls, size) => artUrl(t, size)
  ? `<img class="${cls}" src="${artUrl(t, size)}" alt="" loading="lazy" draggable="false">`
  : ph(t, cls);
const hasAudio = (t) => !!(t && (t.owned || t.rung === 'local'));
const saveLiked = () => localStorage.setItem('mf-liked', JSON.stringify([...state.liked]));

const CACHE_PREFIX = 'mf:cache:';
const CACHEABLE = /^\/api\/(playlists|tracks|likes|likes\/full|recent|history\/stats|stats)(\?|$)/;
const cacheAge = (p) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + p);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { body: o.body, age: (Date.now() - o.t) / 1000 };
  } catch { return null; }
};
const cachePut = (p, body) => {
  try { localStorage.setItem(CACHE_PREFIX + p, JSON.stringify({ t: Date.now(), body })); } catch {}
};

async function api(p, opts) {
  const isGet = !opts || !opts.method || opts.method === 'GET';
  const bypass = !!(opts && opts.nocache);
  const cached = isGet && !bypass && CACHEABLE.test(p) ? cacheAge(p) : null;
  if (cached && cached.age < 90) return cached.body;
  const r = await fetch(p, opts);
  if (!r.ok) {
    if (cached) return cached.body;       // stale beats broken while offline
    throw new Error(r.status);
  }
  const body = await r.json();
  if (isGet && !bypass && CACHEABLE.test(p)) cachePut(p, body);
  return body;
}

/* paint the shell from cache before the network answers */
function primeFromCache() {
  for (const p of ['/api/playlists', '/api/tracks']) {
    const c = cacheAge(p);
    if (!c) continue;
    if (p === '/api/playlists' && Array.isArray(c.body)) state.playlists = c.body;
    if (p === '/api/tracks' && Array.isArray(c.body)) state.allTracks = c.body;
  }
  if (state.playlists.length) renderSidebar();
}

function cacheSize() {
  let bytes = 0, n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) { bytes += (localStorage.getItem(k) || '').length; n++; }
  }
  return { bytes, keys: n };
}

function clearAppCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
  state.allTracks = null;
  toast(`Cache cleared (${keys.length} entries)`);
  refreshView();
}

/* ============ likes (server-synced, localStorage cache for instant paint) ============ */
let serverLiked = null;
async function syncLikes() {
  try {
    serverLiked = new Set((await api('/api/likes')).map(r => r.track_id));
    serverLiked.forEach(id => state.liked.add(id));
    saveLiked();
  } catch {}
}
const isLiked = (t) => state.liked.has(t.id);

/* ============ context menu ============ */
let ctxTarget = null;
// in-app rename editor, shared by both track menus
function ctxRename(t) {
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Rename</div>
    <div class="ctx-form">
      <label>Title<input id="rn-title" value="${esc(t.title || '')}"></label>
      <label>Artist<input id="rn-artist" value="${esc(t.artist || '')}"></label>
      <label>Album<input id="rn-album" value="${esc(t.album || '')}"></label>
      <div class="ctx-row"><button class="btn btn-primary" id="rn-save">Save</button><button class="btn btn-ghost" id="rn-cancel">Cancel</button></div>
    </div>`;
  m.classList.add('open'); showBack();
  m.style.left = Math.max(8, innerWidth / 2 - 160) + 'px';
  m.style.top = '12%';
  m.onclick = null;
  m.querySelector('#rn-cancel').onclick = () => m.classList.remove('open');
  m.querySelector('#rn-save').onclick = async () => {
    const body = {
      title: m.querySelector('#rn-title').value.trim(),
      artist: m.querySelector('#rn-artist').value.trim(),
      album: m.querySelector('#rn-album').value.trim(),
    };
    try {
      const r = await api(`/api/tracks/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.error) return toast(r.error, 6000);
      m.classList.remove('open');
      state.allTracks = null;
      bustCache();
      toast('Renamed', 4000);
      refreshView();
    } catch { toast('Could not rename', 4000); }
  };
}

function openCtx(t, x, y) {
  ctxOpenedAt = Date.now();
  ctxTarget = t;
  const m = $('ctx');
  const liked = isLiked(t);
  m.innerHTML = `
    <button data-act="play">${IC.play} Play</button>
    <button data-act="next">&#8594; Play next</button>
    <button data-act="queue">&#43; Add to queue</button>
    <div class="ctx-sep"></div>
    <button data-act="like">${liked ? IC.heart + ' Remove from Liked Songs' : IC.heartFull + ' Save to Liked Songs'}</button>
    ${hasAudio(t) ? '' : '<button data-act="dl">Download this track</button>'}
    ${hasAudio(t) ? '<button data-act="cover">Change cover</button>' : ''}
    ${(hasAudio(t) && Number(t.bitrate || 0) > 0 && Number(t.bitrate) < 180000) ? '<button data-act="upgrade">Find higher quality</button>' : ''}
    ${hasAudio(t) ? '<button data-act="tofile">Download to device</button>' : ''}
    <button data-act="addpl">Add to playlist</button>
    ${state.view === 'playlist' && state.playlistId ? '<button data-act="rmpl">Remove from this playlist</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="rename">Rename track</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="repair">Fix metadata</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="deltrack">Delete from library</button>' : ''}
    <button data-act="radiostart">Start track radio</button>`;
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function showBack() {}
function closeCtx(force = false) {
  const el = $('ctx');
  // never yank the sheet away from someone who is typing in it, whoever asked
  const active = document.activeElement;
  if (!force && active && el.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  el.classList.remove('open');
  el.onclick = null;
  el.style.transform = '';

}
let ctxOpenedAt = 0;
// close on any press outside the menu, in the capture phase so nothing can swallow it
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });

// desktop dismissal: a real mouse press outside the sheet closes it. Touch devices also
// synthesise mouse events after a tap, so those are ignored for a moment after a real touch.
let lastTouchAt = 0;
document.addEventListener('touchstart', () => { lastTouchAt = Date.now(); }, { capture: true, passive: true });
document.addEventListener('mousedown', (e) => {
  if (!ctx.classList.contains('open')) return;
  if (Date.now() - ctxOpenedAt < 150) return;
  if (Date.now() - lastTouchAt < 800) return;
  if (ctx.contains(e.target)) return;
  closeCtx();
}, true);

document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.trow, .tcard');
  if (!row) return;
  e.preventDefault();
  const t = findTrack(row);
  if (t) openCtx(t, e.clientX, e.clientY);
});
$('ctx').addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act || !ctxTarget) return;
  const t = ctxTarget; closeCtx();
  if (act === 'play') playList([t], 0);
  if (act === 'next') { state.queue.splice(state.qi + 1, 0, t); toast('Playing next'); }
  if (act === 'queue') { state.queue.push(t); toast('Added to queue'); }
  if (act === 'like') toggleLike(t);
  if (act === 'addpl') openAddPl(t);
  if (act === 'radiostart') startRadio(t);
    if (act === 'upgrade') {
      closeCtx();
      try {
        await api(`/api/tracks/${t.id}/download`, { method: 'POST' });
        toast('Looking for a better copy. It is only replaced if the new file is better.', 7000);
        openDownloads();
      } catch { toast('Could not queue an upgrade', 4000); }
      return;
    }
    if (act === 'rename') { ctxRename(t); return; }
  if (act === 'repair') {
    try {
      const p = await api(`/api/repair/${t.id}`, { nocache: true });
      if (!p.changed) { toast(p.reasons[0] || 'Nothing to correct', 6000); return; }
      if (!confirm(`Apply these corrections?\n\n${p.reasons.join('\n')}`)) return;
      const r = await api(`/api/repair/${t.id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.after) });
      if (r.error) return toast(r.error, 6000);
      afterWrite(); state.allTracks = null;
      toast(`Fixed ${r.changed} fields`, 5000);
      refreshView();
    } catch { toast('Repair failed', 4000); }
    return;
  }
  if (act === 'tofile') { window.location.href = `/api/tracks/${t.id}/file`; return; }
  if (act === 'cover') { uploadTrackCover(t.id); return; }
  if (act === 'dl') {
    fetch(`/api/tracks/${t.id}/download`, { method: 'POST' })
      .then(r => r.json()).then(d => toast(d.job ? 'Downloading this track' : (d.error || 'failed')))
      .catch(() => toast('download failed'));
  }
  if (act === 'rmpl') {
    try {
      await api(`/api/playlists/${encodeURIComponent(state.playlistId)}/tracks/${t.id}`, { method: 'DELETE' });
      toast('Removed from playlist'); refreshView();
    } catch { toast('Remove failed'); }
  }
  if (act === 'deltrack') {
    const msg = hasAudio(t)
      ? `Delete "${t.title}"? The audio file is removed from disk and the track disappears from every playlist.`
      : `Delete "${t.title}" from the library?`;
    if (!confirm(msg)) return;
    try {
      // remember where the list was scrolled so deleting does not move the page
      const hosts = [...document.querySelectorAll(`.trow[data-tid="${t.id}"]`)].map((r) => r.parentElement).filter(Boolean);
      const tops = hosts.map((h) => h.scrollTop);
      const winY = window.scrollY;
      document.querySelectorAll(`.trow[data-tid="${t.id}"]`).forEach((row) => row.remove());
      await api(`/api/tracks/${t.id}`, { method: 'DELETE', nocache: true });
      afterWrite();
      state.allTracks = null;
      await loadPlaylists();
      hosts.forEach((h, i) => { h.scrollTop = tops[i] || 0; });
      window.scrollTo(0, winY);
      const counter = document.querySelector('#g-n');
      if (counter) counter.textContent = String(Math.max(0, (Number(counter.textContent) || 1) - 1));
      toast('Deleted from library', 4000);
      const inQueue = state.queue.findIndex((q) => q.id === t.id);
      if (inQueue >= 0) {
        const wasCurrent = inQueue === state.qi;
        state.queue.splice(inQueue, 1);
        // keep the playhead on the same song, and make sure the next skip lands on the
        // track that followed the deleted one rather than jumping over it
        if (inQueue <= state.qi) state.qi = Math.max(-1, state.qi - 1);
        saveQueue();
        if (wasCurrent) toast('Deleted. It keeps playing until the end, then the queue continues.', 6000);
      }
      // no refreshView here: the row is already gone and the scroll position is restored
    } catch { toast('Delete failed', 4000); }
  }
});

function findTrack(rowEl) {
  const tid = Number(rowEl.dataset.tid);
  if (state._rows?.get(tid)) return state._rows.get(tid);
  if (state.allTracks) return state.allTracks.find(t => t.id === tid);
  return null;
}
function registerRow(t) {
  if (!state._rows) state._rows = new Map();
  state._rows.set(t.id, t);
}

/* ============ toasts ============ */
function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), Math.max(600, ms - 400));
  setTimeout(() => el.remove(), ms);
  return el;
}

/* ============ add to playlist ============ */
function openAddPl(t) {
  ctxOpenedAt = Date.now();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Add to playlist</div>` +
    state.playlists.map(p => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('') +
    `<div class="ctx-sep"></div><button data-newpl="1">&#43; New playlist</button>`;
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = '50%'; m.style.top = '50%';
  m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    m.classList.remove('open'); m.style.transform = ''; m.onclick = null;
    if (b.dataset.newpl) {
      const name = prompt('Playlist name:'); if (!name) return;
      const np = await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      await api(`/api/playlists/${np.id}/tracks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: t.id }) });
      await loadPlaylists();
      toast(`Added to ${name}`);
    } else {
      await api(`/api/playlists/${b.dataset.pl}/tracks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: t.id }) });
      const pl = state.playlists.find(p => p.id === b.dataset.pl);
      toast(`Added to ${pl ? pl.name : 'playlist'}`);
    }
  };
}

/* ============ likes toggle ============ */
async function toggleLike(t) {
  if (isLiked(t)) {
    state.liked.delete(t.id); if (serverLiked) serverLiked.delete(t.id);
    saveLiked(); toast('Removed from Liked Songs');
    try { await api('/api/likes', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: t.id }) }); } catch {}
  } else {
    state.liked.add(t.id); if (serverLiked) serverLiked.add(t.id);
    saveLiked(); toast('Added to Liked Songs');
    try { await api('/api/likes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: t.id }) }); } catch {}
  }
  document.querySelectorAll(`.trow[data-tid="${t.id}"] .like`).forEach(b => {
    b.innerHTML = isLiked(t) ? IC.heartFull : IC.heart;
    b.classList.toggle('on', isLiked(t));
  });
  ['pb-like', 'np-like', 'mini-like'].forEach((id) => {
    if (state.current && state.current.id === t.id) {
      $(id).innerHTML = isLiked(t) ? IC.heartFull : IC.heart;
      $(id).classList.toggle('on', isLiked(t));
    }
  });
}

/* ============ radio ============ */
async function startRadio(t) {
  toast('Building radio...');
  try {
    const list = await api(`/api/radio/${t.id}`);
    if (!list.length) { toast('No radio available'); return; }
    playList(list, 0, false, `Radio · ${t.title}`);
  } catch { toast('Radio failed'); }
}

/* ============ navigation ============ */
function setNav(v) {
  state.view = v;
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === v));
}
function nav(v, push = true) {
  const qd = $('queue-drawer'); if (qd) qd.hidden = true;
  if (typeof clearSelection === 'function') clearSelection();
  if (push && state.view && v !== state.view) state.history.push({ v: state.view, pid: state.playlistId });
  $('back').hidden = !state.history.length;
  const resetScroll = () => {
    try { window.scrollTo(0, 0); } catch {}
    const view = document.getElementById('view');
    if (view) view.scrollTop = 0;
    const list = document.getElementById('songs-list');
    if (list) list.scrollTop = 0;
  };
  if (v === 'home') renderHome();
  else if (v === 'search') renderSearch();
  else if (v === 'library') renderLibrary();
  else if (v === 'liked') renderLiked();
  else if (v === 'songs') renderSongs(push);
  else if (v === 'askai') renderAskAi();
  else if (v === 'settings') renderSettings();
  else if (v === 'import') renderImport();
  resetScroll();
  if (v === 'import') { const f = document.getElementById('imp-name'); if (f) f.scrollIntoView({ block: 'start' }); }
  else if (v === 'artist' && state.artistName) renderArtist(state.artistName, false);
  else if (v === 'album' && state.albumName) renderAlbum(state.albumName, false);
}
function goBack() {
  const h = state.history.pop() || { v: 'home' };
  $('back').hidden = !state.history.length;
  if (h.v === 'playlist') openPlaylist(h.pid, false);
  else if (h.v === 'artist' && h.name) renderArtist(h.name, false);
  else if (h.v === 'album' && h.name) renderAlbum(h.name, false);
  else nav(h.v, false);
}

/* ============ sidebar ============ */
function renderSidebar() {
  const el = $('slib');
  el.innerHTML = '';
  const add = document.createElement('button');
  add.className = 'slib-add';
  add.textContent = '+ New playlist';
  add.onclick = async () => {
    const name = prompt('New playlist name:'); if (!name) return;
    await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    afterWrite();
    await loadPlaylists();
    toast('Playlist created');
  };
  el.appendChild(add);
  const imp = document.createElement('button');
  imp.className = 'slib-add';
  imp.textContent = '+ Import Spotify playlist';
  imp.onclick = async () => {
    const url = prompt('Paste a Spotify playlist link or ID:');
    if (!url) return;
    toast('Mirroring playlist...');
    try {
      const r = await api('/api/mirror/spotify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      await loadPlaylists();
      toast(`${r.tracks} tracks mirrored`);
      openPlaylist(r.playlist, false);
    } catch (e) { toast('Import failed'); }
  };
  el.appendChild(imp);

  const tools = document.createElement('div');
  tools.className = 'slib-tools';
  tools.innerHTML = `<input class="slib-filter" id="pl-filter" placeholder="Filter playlists" value="${esc(state.plFilter || '')}" autocomplete="off">
    <select class="slib-sort" id="pl-sort" aria-label="Sort playlists">
      ${PL_ORDERS.map(([v, label]) => `<option value="${v}" ${plOrder() === v ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`;
  el.appendChild(tools);
  const filterInput = tools.querySelector('#pl-filter');
  filterInput.oninput = (e) => {
    state.plFilter = e.target.value;
    renderSlibItems();
  };
  tools.querySelector('#pl-sort').onchange = (e) => {
    localStorage.setItem('mf-pl-order', e.target.value);
    renderSlibItems();
    if (state.view === 'library') renderLibrary();
  };

  renderSlibItems();
}

function renderSlibItems() {
  const el = $('slib');
  if (!el) return;
  el.querySelectorAll('.slib-item').forEach((r) => r.remove());
  const liked = { id: 'liked', name: 'Liked Songs', n: state.liked.size, liked: true };
  const items = [liked, ...sortedPlaylists(state.playlists)].filter(matchesPlFilter);
  for (const p of items) {
    const row = document.createElement('div');
    row.className = 'slib-item' + (state.playlistId === p.id ? ' on' : '');
    row.innerHTML = p.liked
      ? `<div class="slib-art ph" style="display:flex;align-items:center;justify-content:center;color:var(--liked)">${IC.heartFull}</div>
         <div style="min-width:0"><div class="slib-name">Liked Songs</div><div class="slib-sub">${p.n} songs</div></div>`
      : `<img class="slib-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=88&v=${state.artV || 0}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
         <div style="min-width:0"><div class="slib-name">${esc(p.name)}</div><div class="slib-sub">playlist &middot; ${p.n_tracks}</div></div>`;
    row.onclick = () => p.liked ? nav('liked') : openPlaylist(p.id);
    if (!p.liked) {
      row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openPlaylistMenu(p, e.clientX, e.clientY); };
      longPress(row, () => openPlaylistMenu(p, innerWidth / 2 - 110, innerHeight / 2 - 80));
    }
    if (!p.liked) {
      row.ondragover = (e) => { if (e.dataTransfer.types.includes('application/x-musicfy')) { e.preventDefault(); row.classList.add('drop'); } };
      row.ondragleave = () => row.classList.remove('drop');
      row.ondrop = async (e) => {
        e.preventDefault(); row.classList.remove('drop');
        const ids = JSON.parse(e.dataTransfer.getData('application/x-musicfy') || '[]');
        if (ids.length) { await addTracksToPlaylist(p.id, ids); clearSelection(); }
      };
    }
    el.appendChild(row);
  }
}

/* playlist context menu: play, rename, delete */
function openPlaylistMenu(p, x, y) {
  ctxOpenedAt = Date.now();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc(p.name)}</div>
    <button data-act="pl-play">Play</button>
    <button data-act="pl-rename">Rename</button>
    <button data-act="pl-cover">Change cover</button>
    <button data-act="pl-m3u">Export M3U</button>
    <button data-act="pl-zip">Download to device (zip)</button>
    <button data-act="pl-delete">Delete playlist</button>`;
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    m.classList.remove('open'); m.onclick = null;
    if (act === 'pl-play') { playPlaylist(p.id); return; }
    if (act === 'pl-cover') { uploadPlaylistCover(p.id); return; }
    if (act === 'pl-m3u') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export.m3u`; return; }
    if (act === 'pl-zip') { toast('Building the zip, this can take a minute', 6000); window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/zip`; return; }
    if (act === 'pl-rename') {
      const name = prompt('Rename playlist:', p.name); if (!name) return;
      await api(`/api/playlists/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      afterWrite(); await loadPlaylists(); toast('Renamed');
      if (state.playlistId === p.id) openPlaylist(p.id, false);
      return;
    }
    if (act === 'pl-delete') {
      if (!confirm(`Delete playlist "${p.name}"? Tracks stay in your library.`)) return;
      await api(`/api/playlists/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      afterWrite(); await loadPlaylists();
      toast('Playlist deleted. Tracks are still in Songs.');
      if (state.playlistId === p.id) { state.playlistId = null; state.history = []; nav('home'); }
      else refreshView();
    }
  };
}

/* long press helper: fires fn after 500ms hold, suppresses the trailing click */
function longPress(el, fn, holdMs = 500) {
  let t = null, fired = false, ox = 0, oy = 0;
  const start = (e) => {
    const p = (e.touches && e.touches[0]) || e;
    ox = p.clientX || 0; oy = p.clientY || 0;
    fired = false;
    t = setTimeout(() => { fired = true; fn(); }, holdMs);
  };
  const move = (e) => {
    const p = (e.touches && e.touches[0]) || e;
    if (Math.abs((p.clientX || 0) - ox) > 12 || Math.abs((p.clientY || 0) - oy) > 12) clearTimeout(t);
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(t), { passive: true });
  el.addEventListener('touchcancel', () => clearTimeout(t), { passive: true });
  el.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}

/* ============ views ============ */
const greetPart = () => { const h = new Date().getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

async function renderHome() {
  setNav('home'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = 'MUSICFY';
  const v = $('view');
  v.innerHTML = `
    <div class="hero-greet">Good ${greetPart()}.</div>
    <div class="hero-sub">${state.playlists.length} playlists</div>
    <div class="quicktiles" id="quick"></div>
    <div id="rotation-slot"></div>
    <div class="sec-title">Recently played <small id="recent-hint"></small></div>
    <div class="row-scroller" id="recent-row"></div>
    <div class="sec-title">Your playlists <small>${state.playlists.length} TOTAL</small></div>
    <div class="pgrid" id="home-grid"></div>`;
  drawQuick();
  const g = $('home-grid');
  for (const p of state.playlists) g.appendChild(pcard(p));
  const rec = await loadRecentlyPlayed();
  drawRecents(rec);
  drawRotation(rec);
}

/* the algorithm, visible: radio built from what you actually played */
/* right click menu for a ladder candidate: stream it, keep it in a playlist, or download it */
function openLadderCtx(c, x, y) {
  ctxOpenedAt = Date.now();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc((c.title || '').slice(0, 40))}</div>
    <button data-act="l-play">Play now</button>
    <button data-act="l-add">Add to playlist (stream)</button>
    <button data-act="l-dl">Download to library</button>`;
  m.classList.add('open');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    m.classList.remove('open'); m.onclick = null;
    if (act === 'l-play') { window.__ladderPlay ? window.__ladderPlay(c) : null; }
    if (act === 'l-add') { openAddPlStream(c); }
    if (act === 'l-dl') {
      try {
        const r2 = await fetch('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rung: c.rung, id: c.id, url: c.url, thumb: c.thumb, file: c.handle?.file || c.file, title: c.title, artist: c.artist }) });
        const d = await r2.json();
        if (d.job) { toast(`Downloading: ${c.title}`, 5000); waitForJob(d.job, c.title); } else toast(d.error || 'failed', 5000);
      } catch { toast('download failed'); }
    }
  };
}

/* add a stream-only entry to a playlist: present immediately, resolved on play */
function openAddPlStream(c) {
  ctxOpenedAt = Date.now();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Add "${esc((c.title || '').slice(0, 28))}" to</div>` +
    state.playlists.map((p) => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    m.classList.remove('open'); m.style.transform = ''; m.onclick = null;
    await api(`/api/playlists/${encodeURIComponent(b.dataset.pl)}/tracks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: { rung: c.rung, id: c.id, url: c.url || '', title: c.title, artist: c.artist || '', album: c.album || '', duration: c.duration || null } }),
    }).catch(() => {});
    await loadPlaylists();
    toast('Added to playlist. It streams from source when you play it.');
  };
}

/* cards on home: play button on hover, click or long press opens the track menu */
function trackCard(t, list, origin) {
  registerRow(t);
  const c = document.createElement('div');
  c.className = 'tcard';
  c.innerHTML = `${artTag(t, 'tcard-art', 300)}
    <div class="tcard-name">${esc(t.title)}</div>
    <div class="tcard-sub">${esc(t.artist || '')}</div>
    <button class="tcard-play" aria-label="Play ${esc(t.title)}">${IC.play}</button>`;
  c.querySelector('.tcard-play').onclick = (e) => {
    e.stopPropagation();
    playList(list, list.indexOf(t), false, origin);
  };
  const at = () => { const r = c.getBoundingClientRect(); return { x: r.left + 12, y: r.bottom - 6 }; };
  // a plain click does nothing on purpose: play from the hover button, menu from right click
  c.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openCtx(t, e.clientX, e.clientY); };
  longPress(c, () => { const p = at(); openCtx(t, p.x, p.y); });
  return c;
}

/* all time, from 175k real Spotify plays */
async function drawAllTime() {
  const slot = $('alltime-slot');
  if (!slot) return;
  const h = await api('/api/history/stats').catch(() => null);
  if (!h || !h.top_artists || !h.top_artists.length) return;
  const years = h.first && h.last ? `${new Date(h.first).getFullYear()} to ${new Date(h.last).getFullYear()}` : '';
  slot.innerHTML = `<div class="sec-title">All time <small>${h.plays.toLocaleString()} PLAYS - ${h.hours.toLocaleString()} HOURS - ${years}</small></div>
    <div class="row-scroller" id="at-row"></div>`;
  const row = slot.querySelector('#at-row');
  h.top_artists.slice(0, 14).forEach((a) => {
    const c = document.createElement('button');
    c.className = 'chip-card';
    c.innerHTML = `<b>${esc(a.artist)}</b><span>${a.plays} plays</span>`;
    c.onclick = () => renderArtist(a.artist);
    row.appendChild(c);
  });
}

async function drawRotation(rec) {
  const slot = $('rotation-slot');
  if (!slot || !rec || !rec.length) return;
  const seedTrack = rec[0];
  const list = await api(`/api/radio/${seedTrack.id}`).catch(() => []);
  if (!list.length) return;
  const row = document.createElement('div');
  row.innerHTML = `<div class="sec-title">Your rotation <small>BUILT FROM ${esc((seedTrack.title || '').toUpperCase()).slice(0, 40)}</small></div>
    <div class="row-scroller" id="rot-row"></div>`;
  slot.appendChild(row);
  const strip = row.querySelector('#rot-row');
  list.slice(0, 12).forEach((t) => strip.appendChild(trackCard(t, list, 'Your rotation')));
}

function drawQuick() {
  const q = $('quick');
  const likedCount = state.liked.size;
  const withAudio = (state.allTracks || []).filter(hasAudio).length;
  // these are shortcuts, not a second copy of the playlist grid
  const tiles = [
    { go: 'liked', name: 'Liked Songs', sub: `${likedCount} songs`, art: '/api/cover-liked' },
  ];
  q.innerHTML = tiles.map((t) => `<div class="qtile" data-go="${esc(t.go)}">
      ${t.art ? `<img class="qtile-art" src="${t.art}" onerror="this.style.display='none'">` : `<div class="qtile-art ph">${IC.play}</div>`}
      <div class="qtile-name">${esc(t.name)}</div><div class="qtile-sub">${esc(t.sub)}</div></div>`).join('');
  q.querySelectorAll('.qtile').forEach(el => {
    el.onclick = async () => {
      const go = el.dataset.go;
      if (go === 'liked') return nav('liked');
      if (go === 'songs-owned') { nav('songs'); return; }
      if (go === 'ask') { nav('search'); return; }
      if (go === 'picks') {
        el.classList.add('busy');
        try {
          const r = await api('/api/recommend/weekly', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 30, limit: 25 }) });
          if (r.created) { afterWrite(); await loadPlaylists(); toast(`Created "${r.created.name}" with ${r.created.tracks} tracks`, 6000); openPlaylist(r.created.id, false); }
          else toast(r.reason || 'Not enough listening yet', 6000);
        } catch { toast('Could not build picks', 4000); }
        el.classList.remove('busy');
      }
    };
  });
  q.querySelectorAll('.qtile-play').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.play;
      if (id === 'liked') playLiked();
      else playPlaylist(id);
    };
  });
}

async function drawRecents(rec) {
  const row = $('recent-row');
  if (!rec || !rec.length) { $('recent-hint').textContent = 'PLAY SOMETHING AND IT LANDS HERE'; return; }
  $('recent-hint').textContent = '';
  for (const t of rec) row.appendChild(trackCard(t, rec, 'Recently played'));
}

async function loadRecentlyPlayed() {
  try { return await api('/api/recent?limit=20'); } catch { return []; }
}

function pcard(p) {
  const el = document.createElement('div');
  el.className = 'pcard';
  el.innerHTML = `
    <img class="pcard-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=340&v=${state.artV || 0}" alt="" loading="lazy" draggable="false">
    <div class="pcard-name">${esc(p.name)}</div>
    <div class="pcard-sub">${p.n_tracks} tracks</div>
    <button class="pcard-play" aria-label="Play ${esc(p.name)}">${IC.play}</button>`;
  el.querySelector('.pcard-play').onclick = (e) => { e.stopPropagation(); playPlaylist(p.id); };
  el.onclick = () => openPlaylist(p.id);
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openPlaylistMenu(p, e.clientX, e.clientY); };
  longPress(el, () => openPlaylistMenu(p, innerWidth / 2 - 110, innerHeight / 2 - 80));
  el.ondragover = (e) => { if (e.dataTransfer.types.includes('application/x-musicfy')) { e.preventDefault(); el.classList.add('drop'); } };
  el.ondragleave = () => el.classList.remove('drop');
  el.ondrop = async (e) => {
    e.preventDefault(); el.classList.remove('drop');
    const ids = JSON.parse(e.dataTransfer.getData('application/x-musicfy') || '[]');
    if (ids.length) { await addTracksToPlaylist(p.id, ids); clearSelection(); }
  };
  return el;
}

async function openPlaylist(pid, push = true) {
  const p = state.playlists.find(x => x.id === pid) || { id: pid, name: pid };
  if (push) state.history.push({ v: state.view === 'playlist' ? 'playlist' : state.view, pid: state.playlistId });
  $('back').hidden = !state.history.length;
  setNav('library'); state.view = 'playlist'; state.playlistId = pid;
  renderSidebar();
  $('view-title').textContent = p.name;
  const v = $('view');
  v.innerHTML = `<div class="plhead">
      ${plHeadArt(pid, p.name)}
      <div>
        <div class="plhead-kicker">PLAYLIST</div>
        <h1 class="plhead-name">${esc(p.name)}</h1>
        <div class="plhead-meta"><b id="pln">...</b> tracks &middot; <span id="pldur"></span></div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="pl-play">${IC.play}&nbsp; Play</button>
          <button class="btn btn-ghost" id="pl-shuf">${IC.shuffle}&nbsp; Shuffle</button>
          <button class="icon-btn" id="pl-menu" title="Playlist options">${IC.dots}</button>
        </div>
      </div>
    </div>
    <div class="thead" id="pl-thead">
      <div class="th" data-key="pos">#</div><div></div>
      <div class="th" data-key="title">TITLE</div>
      <div class="th" data-key="artist">ARTIST</div>
      <div class="th" data-key="album">ALBUM</div>
      <div class="th" data-key="date_added">DATE ADDED</div>
      <div>SOURCE</div>
      <div class="th" data-key="duration" style="text-align:right">TIME</div>
      <div></div>
    </div>
    <div id="tlist"></div>`;
  const list = await api(`/api/playlists/${encodeURIComponent(pid)}`);
  state._currentList = list;
  $('pln').textContent = list.length;
  const totalS = list.reduce((a, t) => a + (t.duration || 0), 0);
  $('pldur').textContent = list.length ? `${Math.round(totalS / 60)} min` : '';
  state.sort = { key: 'pos', dir: 1 };
  const renderRows = () => {
    let sorted = [...list];
    if (state.sort.key !== 'pos') {
      sorted.sort((a, b) => {
        const va = a[state.sort.key] ?? '', vb = b[state.sort.key] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * state.sort.dir;
        return String(va).localeCompare(String(vb)) * state.sort.dir;
      });
    }
    const tl = $('tlist'); tl.innerHTML = '';
    sorted.forEach((t, i) => { registerRow(t); tl.appendChild(trow(t, i, sorted)); });
    $('pl-thead').querySelectorAll('.th').forEach(th => {
      th.classList.toggle('sorted', th.dataset.key === state.sort.key && state.sort.key !== 'pos');
      th.classList.toggle('desc', th.dataset.key === state.sort.key && state.sort.dir === -1);
    });
  };
  $('pl-thead').querySelectorAll('.th').forEach(th => th.onclick = () => {
    const k = th.dataset.key; if (!k) return;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: 1 };
    renderRows();
  });
  renderRows();
  const missing = list.filter((t) => !hasAudio(t));
  if (missing.length) {
    const dl = document.createElement('button');
    dl.className = 'btn btn-ghost';
    dl.textContent = `Download ${missing.length}`;
    dl.onclick = async () => {
      dl.disabled = true;
      try {
        const r = await api(`/api/playlists/${encodeURIComponent(pid)}/download`, { method: 'POST' });
        toast(`${r.queued} downloads queued`, 5000);
        openDownloads();
      } catch { toast('could not queue downloads', 5000); }
      dl.disabled = false;
    };
    document.querySelector('.plhead-actions').appendChild(dl);
  }
  $('pl-menu').onclick = (e) => {
    e.stopPropagation();
    const r = e.target.getBoundingClientRect();
    openPlaylistMenu(p, r.left - 150, r.bottom + 6);
  };
  $('pl-play').onclick = () => playList(list, 0, false, p.name);
  $('pl-shuf').onclick = () => playList(list, 0, true, p.name);
}

function plHeadArt(pid, name) {
  return `<img class="plhead-art" src="/api/cover-playlist/${encodeURIComponent(pid)}?s=420&v=${state.artV || 0}" alt="" draggable="false"
    onerror="this.outerHTML='<div class=plhead-art ph>${esc(name.charAt(0).toUpperCase())}</div>'">`;
}

async function renderLiked() {
  setNav('library'); state.view = 'liked'; state.playlistId = 'liked'; renderSidebar();
  $('view-title').textContent = 'Liked Songs';
  const v = $('view');
  v.innerHTML = `<div class="plhead">
      <div class="plhead-art ph liked-art">${IC.heartFull}</div>
      <div>
        <div class="plhead-kicker">PLAYLIST</div>
        <h1 class="plhead-name">Liked Songs</h1>
        <div class="plhead-meta"><b id="likn">...</b> songs</div>
        <div class="plhead-actions"><button class="btn btn-primary" id="lik-play">${IC.play}&nbsp; Play</button></div>
      </div></div>
    <div id="liklist"></div>`;
  const list = await api('/api/likes/full');
  state._currentList = list;
  $('likn').textContent = list.length;
  const el = $('liklist');
  if (!list.length) { el.innerHTML = `<div class="empty">Nothing liked yet. Heart something from any playlist.</div>`; return; }
  list.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
  $('lik-play').onclick = () => playList(list, 0, false, 'Liked Songs');
}

const PL_ORDERS = [
  ['alpha', 'Name A-Z'],
  ['alphaDesc', 'Name Z-A'],
  ['dateNew', 'Newest first'],
  ['dateOld', 'Oldest first'],
  ['recent', 'Recently updated'],
  ['size', 'Most tracks'],
];
const plOrder = () => localStorage.getItem('mf-pl-order') || 'alpha';
const plFilter = () => (state.plFilter || '').toLowerCase().trim();

function sortedPlaylists(list) {
  const mode = plOrder();
  const out = (list || state.playlists).slice();
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const byDate = (a, b) => String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || ''));
  const byUpdated = (a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
  if (mode === 'alphaDesc') out.sort((a, b) => byName(b, a));
  else if (mode === 'dateNew') out.sort((a, b) => byDate(b, a));
  else if (mode === 'dateOld') out.sort(byDate);
  else if (mode === 'recent') out.sort((a, b) => byUpdated(b, a));
  else if (mode === 'size') out.sort((a, b) => (b.n_tracks || 0) - (a.n_tracks || 0));
  else out.sort(byName);
  return out;
}

function matchesPlFilter(p) {
  const f = plFilter();
  return !f || String(p.name || '').toLowerCase().includes(f);
}

function orderControls() {
  const mode = plOrder();
  return `<div class="mode-tabs" id="pl-order">
      ${PL_ORDERS.map(([v, label]) => `<button class="mode-tab ${mode === v ? 'on' : ''}" data-order="${v}">${label}</button>`).join('')}
    </div>`;
}

function bindOrderControls(rerender) {
  document.querySelectorAll('#pl-order .mode-tab').forEach((b) => b.onclick = () => {
    localStorage.setItem('mf-pl-order', b.dataset.order);
    const sel = document.getElementById('pl-sort');
    if (sel) sel.value = b.dataset.order;
    renderSlibItems();
    rerender();
  });
}

async function renderLibrary() {
  state.genreFilter = null;
  setNav('library'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = 'Your Library';
  const v = $('view');
  v.innerHTML = `<div class="lib-actions">
      <button class="btn btn-primary" id="lib-upload">Upload track</button>
      <button class="btn btn-ghost" id="lib-newpl">New playlist</button>
      <span class="pill" id="cache-pill">CACHE -</span>
      <button class="btn btn-ghost" id="cache-clear">Clear cache</button>
    </div>
    <div class="lib-actions">
      <button class="btn btn-ghost" id="hist-import">Import from history</button>
      <button class="btn btn-ghost" id="meta-repair">Repair metadata</button>
      <span class="pill" id="rung-health">RUNGS -</span>
      <label class="pill" id="auto-dl-wrap" title="Download a track automatically after this many plays. 0 disables.">
        AUTO DOWNLOAD <input id="auto-dl" class="mini-num" type="number" min="0" max="20" value="2">
      </label>
    </div>
    <div class="sec-title" style="margin-top:0">Playlists <small>${state.playlists.length} TOTAL</small></div>${orderControls()}<div class="pgrid" id="lib-grid"></div>`;
  const g = $('lib-grid');
  const liked = document.createElement('div');
  liked.className = 'pcard';
  liked.innerHTML = `<div class="pcard-art ph liked-art">${IC.heartFull}</div><div class="pcard-name">Liked Songs</div><div class="pcard-sub">${state.liked.size} songs</div><button class="pcard-play">${IC.play}</button>`;
  liked.querySelector('.pcard-play').onclick = (e) => { e.stopPropagation(); playLiked(); };
  liked.onclick = () => nav('liked');
  g.appendChild(liked);
  for (const p of sortedPlaylists().filter(matchesPlFilter)) g.appendChild(pcard(p));
  bindOrderControls(() => renderLibrary());
  const paintCache = () => {
    const s = cacheSize();
    $('cache-pill').textContent = `CACHE ${(s.bytes / 1024).toFixed(0)} KB - ${s.keys} ITEMS`;
  };
  paintCache();
  $('lib-upload').onclick = () => pickFile('audio/*', uploadTrack);
  $('cache-clear').onclick = async () => {
    clearAppCache();
    if (window.caches && caches.keys) {
      try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
    }
    paintCache();
  };
  $('hist-import').onclick = async () => {
    const name = prompt('Playlist name for your most played tracks:', 'From your history');
    if (!name) return;
    toast('Building playlist from history');
    try {
      const r = await api('/api/history/materialize', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, limit: 100, minPlays: 3 }) });
      await loadPlaylists();
      if (r.playlist) { toast(`${r.added} tracks added`); openPlaylist(r.playlist, false); }
      else toast(r.note || 'nothing to import');
    } catch { toast('import failed'); }
  };
  $('meta-repair').onclick = async () => {
    toast('Repairing metadata');
    try {
      const r = await api('/api/maintenance/repair', { method: 'POST' });
      toast(`Years fixed ${r.fixed_year}, placeholders cleared ${r.cleared_placeholder_album}`);
      state.allTracks = null;
    } catch { toast('repair failed'); }
  };
  const paintRungs = () => api('/api/health/rungs').then((h) => {
    const parts = Object.entries(h.rungs || {}).map(([k, v]) => `${k.toUpperCase()} ${v.ok ? 'OK' : 'DOWN'}`);
    $('rung-health').textContent = parts.length ? parts.join(' | ') : 'RUNGS -';
    $('rung-health').classList.toggle('warn', Object.values(h.rungs || {}).some((v) => !v.ok));
  }).catch(() => {});
  paintRungs();
  api('/api/settings').then((s) => { $('auto-dl').value = s.auto_download_plays; }).catch(() => {});
  $('auto-dl').onchange = (e) => {
    const v = Math.max(0, Math.min(20, Number(e.target.value) || 0));
    api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auto_download_plays: v }) })
      .then(() => toast(v ? `Auto download after ${v} plays` : 'Auto download off'))
      .catch(() => toast('setting failed'));
  };
  $('lib-upload').onclick = () => pickFile('audio/*', uploadTrack);
  $('lib-newpl').onclick = async () => {
    const name = prompt('New playlist name:'); if (!name) return;
    await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    afterWrite(); await loadPlaylists(); renderLibrary(); toast('Playlist created');
  };
}

/* every track the server knows about, playlist membership or not */
// shared: when a genre card was clicked, show that genre's tracks
function renderGenreView(host, all, limit) {
  const genre = state.genreFilter;
  if (!genre) return false;
  const list = all.filter((t) => String(t.genre_family || t.genre || '').toLowerCase() === genre.toLowerCase());
  host.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = `<div class="sec-title" style="margin-top:0">${esc(genre)} <small>${list.length} TRACKS</small>
    <button class="btn btn-ghost" id="genre-clear" style="margin-left:10px">Clear</button></div>`;
  host.appendChild(head);
  head.querySelector('#genre-clear').onclick = () => { state.genreFilter = null; refreshView(); };
  if (!list.length) {
    host.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Nothing tagged with that genre yet.' }));
    return true;
  }
  const wrap = document.createElement('div');
  list.slice(0, limit).forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, list)); });
  host.appendChild(wrap);
  if (list.length > limit) {
    const more = Object.assign(document.createElement('button'), { className: 'btn btn-ghost show-all', textContent: `Show all ${list.length}` });
    more.onclick = () => { renderGenreView(host, all, list.length); };
    host.appendChild(more);
  }
  return true;
}

async function renderSongs(push = true) {
  if (push && state.view !== 'songs') state.history.push({ v: state.view, pid: state.playlistId, name: state.artistName || state.albumName });
  $('back').hidden = !state.history.length;
  setNav('songs'); state.view = 'songs'; state.playlistId = null; state.artistName = null; state.albumName = null;
  renderSidebar();
  $('view-title').textContent = 'Songs';
  const v = $('view');
  v.innerHTML = `<div class="songs-chips" id="songs-chips"></div>
    <div class="lib-actions songs-head">
      <input class="search" id="songs-q" placeholder="Filter by title, artist or album" autocomplete="off">
      <div class="mode-tabs" id="songs-filter">
        <button class="mode-tab on" data-f="all">All</button>
        <button class="mode-tab" data-f="owned">Owned</button>
        <button class="mode-tab" data-f="mirror">No audio yet</button>
      </div>
      <span class="pill" id="songs-stats">...</span>
      <span class="pill" id="hist-stats">NO HISTORY</span>
      <button class="btn btn-ghost" id="hist-scan">Rescan history</button>
    </div>
    <div class="thead" id="songs-thead">
      <div class="th" data-key="pos">#</div><div></div>
      <div class="th" data-key="title">TITLE</div>
      <div class="th" data-key="artist">ARTIST</div>
      <div class="th" data-key="album">ALBUM</div>
      <div class="th" data-key="added_at">DATE ADDED</div>
      <div>SOURCE</div>
      <div class="th" data-key="duration" style="text-align:right">TIME</div>
      <div></div>
    </div>
    <div id="songs-list"></div>`;

  const all = await api('/api/tracks').catch(() => []);
  state._songs = all;
  let filter = 'all';
  let query = '';
  state.genreFilter = null;
  let sort = { key: 'title', dir: 1 };
  let limit = 60;
  let browse = null;

  const chips = $('songs-chips');
  const paintChips = () => {
    const artists = new Set(all.map((t) => t.artist).filter(Boolean));
    const albums = new Set(all.map((t) => t.album).filter(Boolean));
    chips.innerHTML = `
      <button class="chip-card sm" data-browse="artists"><b>Artists</b><span>${artists.size}</span></button>
      <button class="chip-card sm" data-browse="albums"><b>Albums</b><span>${albums.size}</span></button>
      <button class="chip-card sm" data-browse="import"><b>Import track</b><span>SPOTIFY LINK</span></button>
      <button class="chip-card sm" data-browse="dedupe"><b>Remove duplicates</b><span>KEEPS BEST QUALITY</span></button>
      <button class="chip-card sm" data-browse="picks"><b>For you</b><span>FROM WHAT YOU PLAY</span></button>
      <button class="chip-card sm" data-browse="importpl"><b>Import playlist</b><span>PASTE A LIST OR A LINK</span></button>
      <button class="chip-card sm" data-browse="recentdl"><b>Recently downloaded</b><span>NEWEST FIRST</span></button>
      <button class="chip-card sm" data-browse="upload"><b>Upload files</b><span>MP3, FLAC, M4A, WAV</span></button>
      <button class="chip-card sm" data-browse="uploadfolder"><b>Upload a folder</b><span>ADDS EVERY TRACK INSIDE</span></button>
      <button class="chip-card sm" data-browse="fillgenres"><b>Fill genres</b><span>FROM MUSICBRAINZ</span></button>
      <button class="chip-card sm" data-browse="covers"><b>Find missing covers</b><span>LOOKS UP ARTWORK</span></button>
      <button class="chip-card sm" data-browse="bpm"><b>Sort by BPM</b><span>${all.filter((t) => t.bpm).length} ANALYSED</span></button>
      <button class="chip-card sm" data-browse="genres"><b>Genres</b><span>BROWSE BY FAMILY</span></button>`;
    chips.querySelectorAll('[data-browse]').forEach((b) => b.onclick = async () => {
      if (b.dataset.browse === 'import') { importSpotifyTrack(); return; }
      if (b.dataset.browse === 'picks') {
        try {
          const r = await api('/api/recommend/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 60, limit: 25 }) });
          if (r.created) { afterWrite(); await loadPlaylists(); toast(`Created "${r.created.name}" with ${r.created.tracks} tracks`, 6000); openPlaylist(r.created.id, false); }
          else toast(r.reason || 'Not enough listening yet', 6000);
        } catch { toast('Could not build picks', 4000); }
        return;
      }
      if (b.dataset.browse === 'importpl') { nav('import'); return; }
      if (b.dataset.browse === 'recentdl') {
        const theadEl = document.getElementById('songs-thead');
        if (theadEl) theadEl.style.display = '';
        const list = await api('/api/library/recent-downloads', { nocache: true }).catch(() => []);
        const host = document.getElementById('songs-list');
        if (!host) return;
        host.innerHTML = `<div class="sec-title" style="margin-top:0">Recently downloaded <small>${list.length} NEWEST FIRST</small></div>`;
        const wrap = document.createElement('div');
        const tracks = list.map((r) => ({ ...r, rung: 'local' }));
        tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
        host.appendChild(wrap);
        return;
      }
      if (b.dataset.browse === 'upload') {
        pickFiles('audio/*', (files) => uploadFiles(files));
        return;
      }
      if (b.dataset.browse === 'uploadfolder') {
        pickFiles('audio/*', (files) => uploadFiles(files), { directory: true });
        return;
      }
      if (b.dataset.browse === 'fillgenres') {
        toast('Tagging genres from MusicBrainz, this runs in the background', 6000);
        api('/api/genre/run?limit=200', { method: 'POST' }).then(() => {
          setTimeout(() => { bustCache(); state.allTracks = null; renderSongs(false); toast('Genre pass started', 4000); }, 2000);
        }).catch(() => toast('could not start genre pass', 4000));
        return;
      }
      if (b.dataset.browse === 'genres') {
        // the server knows every family in the library; the loaded page does not
        let rows = [];
        try {
          const st = await api('/api/genre/status', { nocache: true });
          const KNOWN = ['metal', 'electronic', 'hip hop', 'jazz', 'classical', 'rock', 'folk', 'soul', 'reggae', 'pop'];
          rows = (st.families || []).filter((f) => KNOWN.includes(String(f.g).toLowerCase())).map((f) => [f.g, f.c]);
        } catch {}
        if (!rows.length) {
          // fall back to the loaded tracks, but only real families: the genre column
          // also carries catalogue labels like composer or actress
          const KNOWN2 = ['metal', 'electronic', 'hip hop', 'jazz', 'classical', 'rock', 'folk', 'soul', 'reggae', 'pop'];
          const fams = {};
          for (const t of all) {
            const g = String(t.genre_family || '').toLowerCase();
            if (!g || !KNOWN2.includes(g)) continue;
            fams[g] = (fams[g] || 0) + 1;
          }
          rows = Object.entries(fams).sort((a, b) => b[1] - a[1]);
        }
        if (!rows.length) {
          toast('No genres tagged yet. Press Fill genres first.', 5000);
          return;
        }
        browse = 'genres';
        limit = 60;
        draw();
        return;
      }
      if (b.dataset.browse === 'bpm') {
        sort = { key: 'bpm', dir: -1 };
        browse = null;
        limit = 60;
        draw();
        return;
      }
      if (b.dataset.browse === 'covers') {
        const missing = all.filter((t) => !t.has_art).length;
        if (!missing) { toast('Every track has a cover', 4000); return; }
        toast(`Looking up ${Math.min(missing, 40)} covers`, 6000);
        api('/api/covers/fill?limit=40', { method: 'POST' }).then((r) => {
          bustCache();
          state.artV = Date.now();
          const names = (r.missing_titles || []).slice(0, 4).join(', ');
          const more = (r.missing_titles || []).length > 4 ? ` and ${r.missing_titles.length - 4} more` : '';
          toast((r.found ? `${r.found} covers found. ` : '') + `${r.remaining} still missing` + (names ? `: ${names}${more}` : ''), 12000);
          renderSongs(false);
        }).catch(() => toast('cover lookup failed', 5000));
        return;
      }
      if (b.dataset.browse === 'dedupe') {
        if (!confirm('Merge duplicate tracks? The best quality copy is kept and playlists, likes and plays move to it.')) return;
        toast('Checking for duplicates', 4000);
        api('/api/maintenance/dedupe', { method: 'POST' }).then((r) => {
          bustCache();
          toast(r.removed ? `${r.removed} duplicates removed across ${r.groups} groups` : 'No duplicates found', 6000);
          renderSongs(false);
        }).catch(() => toast('dedupe failed', 5000));
        return;
      }
      browse = browse === b.dataset.browse ? null : b.dataset.browse;
      limit = 60;
      draw();
    });
  };

  const drawBrowse = (host) => {
    if (!browse) return false;
    if (browse === 'genres') {
      // real families only: the genre column also holds labels like composer or actress
      const KNOWN = ['metal', 'electronic', 'hip hop', 'jazz', 'classical', 'rock', 'folk', 'soul', 'reggae', 'pop'];
      const fams = {};
      for (const t of all) {
        const g = String(t.genre_family || '').toLowerCase();
        if (g && KNOWN.includes(g)) fams[g] = (fams[g] || 0) + 1;
      }
      const rows = Object.entries(fams).sort((a, b) => b[1] - a[1]);
      host.innerHTML = `<div class="sec-title">Genres <small>${rows.length}</small></div><div class="pgrid" id="browse-grid"></div>`;
      const grid = host.querySelector('#browse-grid');
      for (const [name, n] of rows) {
        const card = document.createElement('div');
        card.className = 'pcard';
        card.innerHTML = `<div class="pcard-art ph">${esc(name.charAt(0).toUpperCase())}</div>
          <div class="pcard-name">${esc(name)}</div><div class="pcard-sub">${n} tracks</div>`;
        card.onclick = () => { browse = null; state.genreFilter = name; limit = 60; draw(); };
        grid.appendChild(card);
      }
      return true;
    }
    const key = browse === 'artists' ? 'artist' : 'album';
    const counts = new Map();
    for (const t of all) {
      const name = t[key];
      if (!name) continue;
      const e = counts.get(name) || { name, n: 0 };
      e.n += 1;
      counts.set(name, e);
    }
    const rows = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
    const theadEl = document.getElementById('songs-thead');
    if (theadEl) theadEl.style.display = 'none';
    host.innerHTML = `<div class="sec-title">${browse === 'artists' ? 'Artists' : 'Albums'} <small>${rows.length}</small></div><div class="pgrid" id="browse-grid"></div>`;
    const g = host.querySelector('#browse-grid');
    for (const r of rows.slice(0, limit)) {
      const card = document.createElement('div');
      card.className = 'pcard';
      card.innerHTML = `<div class="pcard-art ph">${esc(r.name.charAt(0).toUpperCase())}</div>
        <div class="pcard-name">${esc(r.name)}</div><div class="pcard-sub">${r.n} tracks</div>`;
      card.onclick = () => (browse === 'artists' ? renderArtist(r.name) : renderAlbum(r.name));
      g.appendChild(card);
    }
    if (rows.length > limit) {
      const more = document.createElement('button');
      more.className = 'btn btn-ghost show-all';
      more.textContent = `Show all ${rows.length}`;
      more.onclick = () => { limit = rows.length; draw(); };
      host.appendChild(more);
    }
    return true;
  };

  api('/api/stats').then((s) => {
    $('songs-stats').textContent = `${s.tracks} TRACKS · ${(s.owned_bytes / 1073741824).toFixed(1)}G ON DISK`;
  }).catch(() => { $('songs-stats').textContent = `${all.length} TRACKS`; });

  const paintHistory = (h) => {
    if (!h || !h.plays) { $('hist-stats').textContent = 'NO HISTORY'; return; }
    const from = h.first ? new Date(h.first).getFullYear() : '';
    const to = h.last ? new Date(h.last).getFullYear() : '';
    $('hist-stats').textContent = `${h.plays.toLocaleString()} PLAYS ${from}-${to}`;
  };
  api('/api/history/stats').then(paintHistory).catch(() => {});
  $('hist-scan').onclick = async () => {
    $('hist-scan').disabled = true;
    toast('Scanning history folder');
    try {
      const r = await api('/api/history/scan', { method: 'POST' });
      const added = r.stats ? r.stats.new_plays : 0;
      toast(added ? `${added} new plays imported` : 'No new history files');
      paintHistory(await api('/api/history/stats'));
    } catch (e) { toast('Scan failed'); }
    finally { $('hist-scan').disabled = false; }
  };

  const draw = () => {
    if (state.genreFilter) { renderGenreView($("songs-list"), all, 60); return; }
    let list = all.slice();
    if (filter === 'owned') list = list.filter((t) => hasAudio(t));
    if (filter === 'mirror') list = list.filter((t) => !hasAudio(t));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
    }
    if (sort.key !== 'pos') {
      list.sort((a, b) => {
        const va = a[sort.key] ?? '', vb = b[sort.key] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
        return String(va).localeCompare(String(vb)) * sort.dir;
      });
    }
    const el = $('songs-list');
    el.innerHTML = '';
    if (drawBrowse(el)) return;
    if (!list.length) { el.innerHTML = `<div class="empty">Nothing matches that filter.</div>`; return; }
    const theadBack = document.getElementById('songs-thead');
    if (theadBack) theadBack.style.display = '';
    const shown = list.slice(0, limit);
    shown.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
    if (list.length > limit) {
      const more = document.createElement('button');
      more.className = 'btn btn-ghost show-all';
      more.textContent = `Show all ${list.length}`;
      more.onclick = () => { limit = list.length; draw(); };
      el.appendChild(more);
    }
    $('songs-thead').querySelectorAll('.th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.key === sort.key);
      th.classList.toggle('desc', th.dataset.key === sort.key && sort.dir === -1);
    });
  };

  $('songs-q').oninput = (e) => { query = e.target.value.trim(); browse = null; state.genreFilter = null; limit = 60; draw(); };
  document.querySelectorAll('#songs-filter .mode-tab').forEach((b) => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('#songs-filter .mode-tab').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  $('songs-thead').querySelectorAll('.th').forEach((th) => th.onclick = () => {
    const k = th.dataset.key; if (!k) return;
    sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: 1 };
    draw();
  });
  paintChips();
  draw();
}

async function importSpotifyTrack() {
  const url = prompt('Paste a Spotify track link or ID:');
  if (!url) return;
  toast('Looking up the track', 4000);
  try {
    const r = await api('/api/mirror/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    state.allTracks = null;
    toast(`Added ${r.title}`, 5000);
    renderSongs(false);
  } catch { toast('Could not find that track', 5000); }
}

async function renderImport() {
  setNav('songs'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = 'Import playlist';
  const v = $('view');
  try { window.scrollTo(0, 0); } catch {}
  v.innerHTML = `<div class="inline-panel">
      <label class="ip-label">Playlist name
        <input id="imp-name" placeholder="Driving, Sunday morning...">
      </label>
      <label class="ip-label">Spotify playlist link, or one track per line
        <textarea id="imp-text" rows="8" placeholder="https://open.spotify.com/playlist/...&#10;&#10;or&#10;Burial - Archangel"></textarea>
      </label>
      <div class="ip-actions">
        <button class="btn btn-primary" id="imp-go">Import</button>
        <button class="btn btn-ghost" id="imp-back">Back to songs</button>
      </div>
      <p class="set-note">A Spotify link imports the playlist. Any other service needs its tracks pasted.</p>
    </div>`;
  $('imp-back').onclick = () => nav('songs');
  $('imp-go').onclick = async () => {
    const text = $('imp-text').value.trim();
    const name = $('imp-name').value.trim() || 'Imported playlist';
    if (!text) return toast('Nothing to import', 3000);
    const link = text.match(/https?:\/\/\S+/);
    try {
      if (link && /spotify\.com/.test(link[0])) {
        const r = await api('/api/mirror/spotify', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: link[0], target: link[0], name }) });
        afterWrite(); await loadPlaylists();
        toast(r && r.created ? `Imported ${r.created} tracks` : 'Imported from Spotify', 7000);
        nav('songs');
        return;
      }
      if (link) return toast('Only Spotify links import directly. Paste the track list for other services.', 8000);
      const r = await api('/api/import/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, text }) });
      afterWrite(); await loadPlaylists();
      toast(`Imported ${r.playlist.tracks} tracks${r.queued ? `, ${r.queued} downloading` : ''}`, 7000);
      if (r.playlist.id) openPlaylist(r.playlist.id, false); else nav('songs');
    } catch (e) { toast('Import failed: ' + (e.message || 'unknown'), 8000); }
  };
  const f = $('imp-text');
  if (f) f.focus();
}

async function renderSettings() {
  setNav('settings'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = 'Settings';
  const v = $('view');
  v.innerHTML = '<div class="ladder-state">Loading...</div>';
  let d = { settings: {}, llm: {} };
  try { d = await api('/api/settings', { nocache: true }); } catch {}
  const s = d.settings || {};
  const l = d.llm || {};
  v.innerHTML = `
    <div class="set-grid">
      <section class="set-card">
        <h2>You</h2>
        <label>Display name<input id="set-name" value="${esc(s.display_name || '')}" placeholder="Your name"></label>
        <label>Email<input id="set-email" value="${esc(s.email || '')}" placeholder="you@example.com"></label>
        <label>Timezone<input id="set-tz" value="${esc(s.timezone || '')}" placeholder="America/Sao_Paulo"></label>
      </section>
      <section class="set-card">
        <h2>Taste</h2>
        <p class="set-note">Optional. Used to shape recommendations; the app learns from what you play anyway.</p>
        <label>Genres you love<input id="set-taste-genres" value="${esc(s.taste_genres || '')}" placeholder="techno, dub techno, ambient, jazz"></label>
        <label>Artists you love<input id="set-taste-artists" value="${esc(s.taste_artists || '')}" placeholder="Burial, Overmono, Floating Points"></label>
        <label>Usually listening<input id="set-taste-context" value="${esc(s.taste_context || '')}" placeholder="long drives, focus work, evening sets"></label>
        <label>Keep out of picks<input id="set-taste-avoid" value="${esc(s.taste_avoid || '')}" placeholder="christmas music, metalcore"></label>
      </section>
      <section class="set-card">
        <h2>Model endpoint</h2>
        <p class="set-note">Used by the Ask view. ${l.configured ? 'Currently configured.' : 'Not configured.'}</p>
        <label>Base URL<input id="set-llm-url" value="${esc(s.llm_base_url || l.base_url || '')}" placeholder="https://host/v1"></label>
        <label>Model<input id="set-llm-model" value="${esc(s.llm_model || l.model || '')}" placeholder="model name"></label>
        <label>API key<input id="set-llm-key" type="password" placeholder="${l.has_key ? 'stored, leave blank to keep' : 'not set'}"></label>
      </section>
      <section class="set-card">
        <h2>Downloads</h2>
        <label>Download folder<input id="set-root" value="${esc(s.download_root || 'EXTERNAL_MOUNT/owned')}"></label>
        <label>Download format
          <select id="set-format">
            <option value="best"${(s.preferred_format || 'best') === 'best' ? ' selected' : ''}>keep the original (no transcoding)</option>
            <option value="m4a"${s.preferred_format === 'm4a' ? ' selected' : ''}>m4a (smaller)</option>
            <option value="mp3"${s.preferred_format === 'mp3' ? ' selected' : ''}>mp3 (universal)</option>
          </select>
        </label>
        <p class="set-note">Applies to downloads from streaming sources only. Files you upload are stored byte for byte, and lossless files are never converted.</p>
      </section>
      <section class="set-card">
        <h2>Playback</h2>
        <label class="set-check"><input type="checkbox" id="set-normalize"${s.normalize_loudness ? ' checked' : ''}> Normalize loudness</label>
        <p class="set-note">Turns loud tracks down towards a common level, using the loudness measured during analysis. It never boosts, so it cannot add distortion.</p>
        <label class="set-check"><input type="checkbox" id="set-fade"${s.fade_on_play_ms ? ' checked' : ''}> Fade tracks in and out</label>
        <label>Fade length
          <select id="set-fadems">
            <option value="0"${!s.fade_on_play_ms ? ' selected' : ''}>off</option>
            <option value="350"${String(s.fade_on_play_ms) === '350' ? ' selected' : ''}>0.35 s</option>
            <option value="800"${String(s.fade_on_play_ms) === '800' ? ' selected' : ''}>0.8 s</option>
            <option value="1500"${String(s.fade_on_play_ms) === '1500' ? ' selected' : ''}>1.5 s</option>
          </select>
        </label>
        <label>Target level
          <select id="set-target">
            <option value="-12"${String(s.target_loudness) === '-12' ? ' selected' : ''}>-12 dB (loud)</option>
            <option value="-14"${String(s.target_loudness ?? -14) === '-14' ? ' selected' : ''}>-14 dB (default)</option>
            <option value="-18"${String(s.target_loudness) === '-18' ? ' selected' : ''}>-18 dB (quiet)</option>
          </select>
        </label>
      </section>
      <section class="set-card">
        <h2>Library</h2>
        <div class="set-facts" id="set-facts">Reading...</div>
      </section>
    </div>
    <div class="set-actions"><button class="btn btn-primary" id="set-save">Save settings</button><span id="set-msg" class="set-note"></span></div>`;
  api('/api/stats', { nocache: true }).then((st) => {
    const f = document.getElementById('set-facts');
    if (f) f.innerHTML = `<div><b>${st.tracks}</b> tracks</div><div><b>${(st.owned_bytes / 1e9).toFixed(2)} GB</b> on disk</div><div><b>${st.listens}</b> plays recorded</div>`;
  }).catch(() => {});
  document.getElementById('set-save').onclick = async () => {
    const body = {
      display_name: document.getElementById('set-name').value.trim(),
      email: document.getElementById('set-email').value.trim(),
      timezone: document.getElementById('set-tz').value.trim(),
      llm_base_url: document.getElementById('set-llm-url').value.trim(),
      llm_model: document.getElementById('set-llm-model').value.trim(),
      download_root: document.getElementById('set-root').value.trim(),
      preferred_format: document.getElementById('set-format').value,
      normalize_loudness: document.getElementById('set-normalize').checked,
      target_loudness: Number(document.getElementById('set-target').value),
      fade_on_play_ms: Number(document.getElementById('set-fadems').value),
      taste_genres: document.getElementById('set-taste-genres').value.trim(),
      taste_artists: document.getElementById('set-taste-artists').value.trim(),
      taste_context: document.getElementById('set-taste-context').value.trim(),
      taste_avoid: document.getElementById('set-taste-avoid').value.trim(),
    };
    const key = document.getElementById('set-llm-key').value.trim();
    if (key) body.llm_api_key = key;
    try {
      await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      document.getElementById('set-msg').textContent = 'Saved';
      state.settings = { ...(state.settings || {}), ...body };
      applyLoudnessGain(state.current);
      if (body.display_name) state.profileName = body.display_name;
    } catch { document.getElementById('set-msg').textContent = 'Could not save'; }
  };
}

async function renderAskAi() {
  setNav('askai'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = 'Ask';
  const v = $('view');
  v.innerHTML = `<div class="search-wrap">
      <input class="search" id="ai-q" placeholder="Ask anything, for example: create a playlist of 10 ambient tracks" autocomplete="off">
      <div class="ask-hint">
        <button class="ask-ex">how much of my library has audio</button>
        <button class="ask-ex">find techno tracks I never played</button>
        <button class="ask-ex">create a playlist of 10 ambient tracks</button>
        <button class="ask-ex">tracks in Dm between 120 and 130 bpm</button>
      </div>
      <div class="ladder-state" id="ai-state"></div>
    </div><div id="ai-res"></div>`;
  const box = $('ai-q');
  const out = $('ai-res');
  const stateEl = $('ai-state');

  const run = async (text) => {
    if (!text.trim()) return;
    stateEl.textContent = 'Thinking...';
    out.innerHTML = '';
    const agentish = /\b(create|make|build|download|find|search|show|list|how many)\b/i.test(text);
    try {
      if (agentish) {
        const a = await api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }), nocache: true });
        stateEl.textContent = `${String(a.plan.intent).replace('_', ' ')} | ${a.source === 'llm' ? 'planned by model' : 'planned locally'}`;
        const said = document.createElement('div');
        said.className = 'ai-said';
        said.textContent = a.spoken || '';
        out.appendChild(said);
        if (a.data && a.data.album) {
          const alb = document.createElement('div');
          alb.className = 'ask-meta';
          alb.innerHTML = `<span class="ask-pill">${esc(a.data.album.name)}</span><span class="ask-src">${esc(a.data.album.artist || '')} · ${a.data.album.tracks} tracks · ${a.data.queued || 0} queued</span>`;
          out.appendChild(alb);
        }
        if (a.data && a.data.playlist) {
          const btn = document.createElement('button');
          btn.className = 'btn btn-primary';
          btn.textContent = `Open "${a.data.playlist.name}" (${a.data.playlist.tracks})`;
          btn.onclick = async () => { afterWrite(); await loadPlaylists(); openPlaylist(a.data.playlist.id, false); };
          out.appendChild(btn);
        }
        const lib = (a.data && a.data.library) || [];
        if (lib.length) {
          const wrap = document.createElement('div');
          const tracks = lib.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
          tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
          out.appendChild(wrap);
        }
        const cat = (a.data && a.data.catalogue) || [];
        if (cat.length) {
          const sec = document.createElement('div');
          sec.innerHTML = `<div class="sec-title">In the catalogue <small>${cat.length}</small></div>`;
          for (const s of cat.slice(0, 12)) {
            const row = document.createElement('div');
            row.className = 'trow';
            row.innerHTML = `<div class="tno"></div><div class="tart ph">${esc((s.artist || '?').charAt(0))}</div>
              <div class="tmeta"><div class="tt">${esc(s.title || '')}</div><div class="tbpm">${s.duration ? fmt(s.duration) : ''}</div></div>
              <div class="tartist"><span class="alink">${esc(s.artist || '')}</span></div>
              <div class="talbum">${esc(s.album || '')}</div><div class="tadded"></div><div class="tdur"></div>
              <button class="tmore" title="Download">${IC.download}</button>`;
            row.querySelector('.tmore').onclick = async (e) => {
              e.stopPropagation();
              try { await api('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rung: 'search', title: s.title, artist: s.artist, duration: s.duration }) });
                toast('Fetching', 3000); openDownloads(); } catch { toast('Could not start', 3000); }
            };
            sec.appendChild(row);
          }
          out.appendChild(sec);
        }
        return;
      }
      const d = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }), nocache: true });
      stateEl.textContent = `${d.count} tracks, ${d.source === 'llm' ? 'model' : 'local'} parsing`;
      const wrap = document.createElement('div');
      const tracks = d.results.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
      tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
      out.appendChild(wrap);
    } catch {
      stateEl.textContent = 'Could not answer that';
    }
  };

  box.onkeydown = (e) => { if (e.key === 'Enter') run(box.value); };
  v.querySelectorAll('.ask-ex').forEach((b) => b.onclick = () => { box.value = b.textContent; run(box.value); });
  box.focus();
}

async function renderSearch() {
  setNav('search'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = 'Search';
  const v = $('view');
  v.innerHTML = `<div class="search-wrap">
      <input class="search" id="q" placeholder="Artists, tracks, albums... or anything to search the ladder" autocomplete="off">
      <div class="mode-tabs" id="mode-tabs">
        <button class="mode-tab on" data-mode="all">All</button>
        <button class="mode-tab" data-mode="library">Library</button>
        <button class="mode-tab" data-mode="ladder">Ladder</button>
        <button class="mode-tab" id="long-sets" data-on="false" title="Include DJ mixes, sets and long recordings">Long sets</button>
      </div>
      <div class="ladder-state" id="ladder-state"></div>
    </div><div id="qres"></div>`;
  const q = $('q'); q.focus();
  if (!state.allTracks) state.allTracks = await api('/api/tracks');
  const all = state.allTracks;
  const res = $('qres');
  let mode = 'all';
  let ladderCtl = null; // {abort}

  const setPlaceholder = () => {
    q.placeholder = mode === 'ladder'
      ? 'Find audio sources for a track'
      : 'Artists, tracks, albums';
  };
  document.querySelectorAll('.mode-tab[data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.mode-tab[data-mode]').forEach(x => x.classList.toggle('on', x === b));
    setPlaceholder();
    if (mode === 'ask' && !q.value.trim()) q.focus();
    draw();
  });
  document.querySelectorAll('.ask-ex').forEach(b => b.onclick = () => {
    q.value = b.textContent;
    draw();
    q.focus();
  });
  setPlaceholder();
  $('long-sets').onclick = () => {
    state.longSets = !state.longSets;
    $('long-sets').dataset.on = String(state.longSets);
    $('long-sets').classList.toggle('on', state.longSets);
    if (q.value.trim()) draw();
  };


  const draw = async () => {
    const s = q.value.trim().toLowerCase();
    if (state.genreFilter) { renderGenreView(res, all, 60); return; }
    res.innerHTML = '';
    if (!s) {
      res.innerHTML = `<div class="sec-title" style="margin-top:0">Browse all <small>${all.length} TRACKS</small></div>`;
      const g = document.createElement('div'); g.className = 'pgrid';
      for (const p of state.playlists) g.appendChild(pcard(p));
      res.appendChild(g); return;
    }
    if (mode === 'ladder') { await drawLadder(s); return; }

    // match word by word: "burial archangel" must find Archangel by Burial
    const rawWords = s.split(/\s+/).filter(Boolean);
    const words = rawWords.filter((w) => w.length > 2);
    const needHits = words.length >= 2 ? 2 : 1;
    const scored = all.map(t => {
      const tt = String(t.title || '').toLowerCase();
      const aa = String(t.artist || '').toLowerCase();
      const al = String(t.album || '').toLowerCase();
      let score = 0;
      let hits = 0;
      for (const w of words) {
        let hit = false;
        if (tt === w) { score += 45; hit = true; }
        else if (tt.startsWith(w)) { score += 28; hit = true; }
        else if (tt.includes(w)) { score += 14; hit = true; }
        if (aa.includes(w)) { score += 22; hit = true; }
        else if (al.includes(w)) { score += 7; hit = true; }
        if (hit) hits += 1;
      }
      if (words.length && hits === words.length) score += 30;   // every word accounted for
      return { t, score, hits };
    }).filter(x => x.score > 0 && x.hits >= needHits).sort((a, b) => b.score - a.score);
    const inLibrary = scored.length > 0;
    if (inLibrary) {
      const top = scored[0].t; registerRow(top);
      const topEl = document.createElement('div');
      topEl.className = 'topresult';
      topEl.innerHTML = `<div class="sec-title" style="margin-top:0">Top result</div>
        <div class="topresult-card">
          ${artTag(top, 'topresult-art', 300)}
          <div class="topresult-name">${esc(top.title)}</div>
          <div class="topresult-sub">${esc(top.artist || '')}${top.album ? ' · ' + esc(top.album) : ''}</div>
          <button class="pcard-play topresult-play">${IC.play}</button>
        </div>`;
      topEl.querySelector('.topresult-play').onclick = () => playList([top], 0, false, 'Search');
      res.appendChild(topEl);
      const artists = {};
      all.forEach(t => { const a = (t.artist || '').toLowerCase().trim(); if (a && (a.includes(s) || s.includes(a))) artists[t.artist] = (artists[t.artist] || 0) + 1; });
      const topArtist = Object.entries(artists).sort((x, y) => y[1] - x[1])[0];
      if (topArtist && topArtist[1] > 0) {
        const aEl = document.createElement('div');
        aEl.innerHTML = `<div class="sec-title" style="margin-top:0">Artist</div>
          <div class="topresult-card artist-card">
            <div class="topresult-art ph" style="display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:var(--fg-mute)">${esc(topArtist[0].charAt(0).toUpperCase())}</div>
            <div class="topresult-name">${esc(topArtist[0])}</div>
            <div class="topresult-sub">${topArtist[1]} tracks in your library</div>
          </div>`;
        aEl.querySelector('.artist-card').onclick = () => renderArtist(topArtist[0]);
        res.appendChild(aEl);
      }
      const box = document.createElement('div');
      box.innerHTML = `<div class="sec-title">Tracks <small>${Math.min(scored.length, 40)}</small></div>`;
      const list = scored.slice(0, 40).map(x => x.t);
      list.forEach((t, i) => { registerRow(t); box.appendChild(trow(t, i, list)); });
      res.appendChild(box);
    }
    if (mode === 'all' && (!inLibrary || scored[0].score < 100)) await drawLadder(s, inLibrary);
  };

  const drawAsk = async (text) => {
    res.innerHTML = `<div class="ladder-state">Thinking about "${esc(text)}"...</div>`;
    // verbs like create, find, download go to the agent; questions go to the query engine
    const agentish = /\b(create|make|build|download|find|search|show|list|how many)\b/i.test(text);
    if (agentish) {
      let a;
      try {
        a = await api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }), nocache: true });
      } catch { a = null; }
      if (a && a.spoken) {
        res.innerHTML = '';
        const head = document.createElement('div');
        head.innerHTML = `<div class="sec-title" style="margin-top:0">Result <small>${esc(String(a.plan.intent).replace('_', ' ').toUpperCase())}</small></div>
          <div class="ask-meta"><span class="ask-pill">${esc(a.spoken)}</span><span class="ask-src">${a.source === 'llm' ? 'planned by model' : 'planned locally'}</span></div>`;
        res.appendChild(head);
        if (a.data && a.data.playlist) {
          const open = document.createElement('button');
          open.className = 'btn';
          open.textContent = `Open "${a.data.playlist.name}"`;
          open.onclick = async () => { afterWrite(); await loadPlaylists(); openPlaylist(a.data.playlist.id, false); };
          res.appendChild(open);
        }
        const lib = (a.data && a.data.library) || [];
        if (lib.length) {
          const wrap = document.createElement('div');
          const tracks = lib.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
          tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
          res.appendChild(wrap);
        }
        const cat = (a.data && a.data.catalogue) || [];
        if (cat.length) {
          const sec = document.createElement('div');
          sec.innerHTML = `<div class="sec-title">Also in the catalogue <small>${cat.length}</small></div>`;
          for (const s of cat.slice(0, 10)) {
            const row = document.createElement('div');
            row.className = 'trow';
            row.innerHTML = `<div class="tno"></div><div class="tart ph">${esc((s.artist || '?').charAt(0))}</div>
              <div class="tmeta"><div class="tt">${esc(s.title || '')}</div><div class="tbpm">${s.duration ? fmt(s.duration) : ''}</div></div>
              <div class="tartist"><span class="alink">${esc(s.artist || '')}</span></div>
              <div class="talbum">${esc(s.album || '')}</div><div class="tadded"></div><div class="tdur"></div>
              <button class="tmore" title="Download">${IC.download}</button>`;
            row.querySelector('.tmore').onclick = async (e) => {
              e.stopPropagation();
              try {
                await api('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ rung: 'ytmusic', title: s.title, artist: s.artist, duration: s.duration }) });
                toast('Fetching', 3000); openDownloads();
              } catch { toast('Could not start', 3000); }
            };
            sec.appendChild(row);
          }
          res.appendChild(sec);
        }
        return;
      }
    }
    let d;
    try {
      d = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: text, previous: state.askPrevious || null }), nocache: true });
    } catch (e) {
      res.innerHTML = `<div class="empty">Could not answer that.</div>`;
      return;
    }
    res.innerHTML = '';
    state.askPrevious = d.filters || null;
    const head = document.createElement('div');
    const notes = (d.filters && d.filters.notes) || [];
    head.innerHTML = `<div class="sec-title" style="margin-top:0">Answer <small>${d.count} TRACKS</small></div>
      <div class="ask-meta">${notes.length ? notes.map((n) => `<span class="ask-pill">${esc(n)}</span>`).join('') : '<span class="ask-pill">no filters</span>'}
      <span class="ask-src">${d.source === 'llm' ? 'parsed by model' : 'parsed locally'}</span>
      ${d.relaxed ? '<span class="ask-pill warn">' + esc(String(d.relaxed)) + '</span>' : ''}</div>`;
    res.appendChild(head);

    if (d.count) {
      const bar = document.createElement('div');
      bar.className = 'ask-actions';
      bar.innerHTML = `<button class="btn" id="ask-create">Create playlist from these ${d.count}</button>`;
      res.appendChild(bar);
      bar.querySelector('#ask-create').onclick = async () => {
        const name = prompt('Playlist name:', text.slice(0, 60));
        if (!name) return;
        try {
          const r = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ q: text, create: true, name }), nocache: true });
          if (r.playlist) { afterWrite(); await loadPlaylists(); toast(`Created "${r.playlist.name}" with ${r.playlist.tracks} tracks`, 5000); openPlaylist(r.playlist.id, false); }
          else toast('Nothing to add', 4000);
        } catch { toast('Could not create the playlist', 4000); }
      };
    }

    const list = document.createElement('div');
    if (!d.count) { list.innerHTML = `<div class="empty">Nothing in the library matches that.</div>`; res.appendChild(list); return; }
    const tracks = d.results.map((r) => ({ ...r, rung: r.owned ? 'local' : null, owned: r.owned }));
    tracks.forEach((t, i) => { registerRow(t); list.appendChild(trow(t, i, tracks)); });
    res.appendChild(list);
    if (d.count > tracks.length) {
      const more = document.createElement('div');
      more.className = 'ladder-state';
      more.textContent = `Showing ${tracks.length} of ${d.count}. Narrow the question to see the rest.`;
      res.appendChild(more);
    }
  };

  const renderCatalogue = (box, data) => {
      const cat = data.catalogue || {};
      if ((cat.artists && cat.artists.length) || (cat.albums && cat.albums.length)) {
        if (cat.artists && cat.artists.length) {
          const sec = document.createElement('div');
          sec.innerHTML = `<div class="sec-title">Artists <small>${cat.artists.length}</small></div><div class="row-scroller" id="cat-artists"></div>`;
          const row = sec.querySelector('#cat-artists');
          for (const a of cat.artists) {
            const card = document.createElement('button');
            card.className = 'chip-card';
            card.innerHTML = `<b>${esc(a.name)}</b><span>${esc(a.genre || 'artist')}</span>`;
            card.onclick = () => { q.value = a.name; draw(); };
            row.appendChild(card);
          }
          box.appendChild(sec);
        }
        if (cat.albums && cat.albums.length) {
          const sec = document.createElement('div');
          sec.innerHTML = `<div class="sec-title">Albums <small>${cat.albums.length}</small></div><div class="row-scroller" id="cat-albums"></div>`;
          const row = sec.querySelector('#cat-albums');
          for (const al of cat.albums) {
            const card = document.createElement('button');
            card.className = 'chip-card';
            card.innerHTML = `<b>${esc(al.name)}</b><span>${esc(al.artist || '')}${al.year ? ' · ' + al.year : ''}</span>`;
            card.onclick = () => { q.value = `${al.artist} ${al.name}`; draw(); };
            row.appendChild(card);
          }
          box.appendChild(sec);
        }
      }

      if (cat.songs && cat.songs.length) {
        const sec = document.createElement('div');
        sec.innerHTML = `<div class="sec-title">Songs <small>${cat.songs.length} IN CATALOGUE</small></div><div id="cat-songs"></div>`;
        const host = sec.querySelector('#cat-songs');
        cat.songs.forEach((s, i) => {
          const row = document.createElement('div');
          row.className = 'trow';
          row.innerHTML = `<div class="tno"><span class="tno-num">${String(i + 1).padStart(2, '0')}</span></div>
            <div class="tart ph">${esc((s.artist || '?').charAt(0))}</div>
            <div class="tmeta"><div class="tt">${esc(s.title || '')}</div>
              <div class="tbpm">${s.duration ? fmt(s.duration) : ''}${s.family ? ' · ' + esc(s.family) : ''}</div></div>
            <div class="tartist"><span class="alink">${esc(s.artist || '')}</span></div>
            <div class="talbum">${esc(s.album || '')}</div>
            <div class="tadded"></div><div class="tdur">${s.year || ''}</div>
            <button class="tmore" title="Find audio for this track">${IC.download}</button>`;
          row.querySelector('.tmore').onclick = async (e) => {
            e.stopPropagation();
            row.querySelector('.tmore').classList.add('busy');
            try {
              const r = await api('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rung: 'ytmusic', title: s.title, artist: s.artist, duration: s.duration }) });
              if (r.job) { toast(`Fetching ${s.title}`.slice(0, 60), 4000); openDownloads(); }
              else toast('No source found', 4000);
            } catch { toast('Could not start download', 4000); }
            row.querySelector('.tmore').classList.remove('busy');
          };
          host.appendChild(row);
        });
        box.appendChild(sec);
      }

  };

  const renderCanonical = (d) => {
    if (!d || !d.canonical) return null;
    const c = d.canonical;
    const el = document.createElement('div');
    el.className = 'canon-line';
    el.innerHTML = `<span class="canon-pill">catalogue</span>
      <span class="canon-name">${esc(c.artist || '')}${c.artist ? ' - ' : ''}${esc(c.title || '')}</span>
      ${c.album ? `<span class="canon-sub">${esc(c.album)}</span>` : ''}
      ${c.duration ? `<span class="canon-sub">${fmt(c.duration)}</span>` : ''}
      ${c.family ? `<span class="canon-sub">${esc(c.family)}</span>` : ''}`;
    return el;
  };

  const drawLadder = async (s, appendAfterLibrary = false) => {
    if (ladderCtl) ladderCtl.abort = true;
    const ctl = { abort: false }; ladderCtl = ctl;
    const holder = document.createElement('div');
    holder.innerHTML = `<div class="sec-title">Ladder <small>SEARCHING SOURCES...</small></div>
      <div class="ladder-loading">resolving "${esc(s)}" across youtube, soundcloud and archive</div>
      ${Array.from({ length: 4 }).map(() => `<div class="trow lrow skeleton"><div class="tno"></div><div class="tart"></div><div class="tmeta"><div class="sk-line w60"></div><div class="sk-line w35"></div></div></div>`).join('')}`;
    if (mode === 'ladder' || !appendAfterLibrary) res.innerHTML = '';
    res.appendChild(holder);
    try {
      const r = await fetch(`/api/search/ladder?q=${encodeURIComponent(s)}${state.longSets ? '' : '&durCap=720'}`);
      const data = await r.json();
      if (ctl.abort) return;
      const box = document.createElement('div');
      if (!data.connected) {
        box.innerHTML = `<div class="sec-title">Ladder <small>OFFLINE</small></div><div class="empty">No ladder rungs available.</div>`;
        holder.replaceWith(box); return;
      }
      if (r.status !== 200) {
        box.innerHTML = `<div class="sec-title">Ladder <small>ERROR</small></div><div class="empty">${esc(data.error || 'search failed')}</div>`;
        holder.replaceWith(box); return;
      }
      // catalogue answers first; the ladder is a fallback you open deliberately
      const webBox = document.createElement('div');
      webBox.className = 'ladder-fold';
      const foldHead = document.createElement('div');
      foldHead.className = 'sec-title';
      foldHead.innerHTML = `Web sources <small>${data.results.length || 0} MATCHES</small>
        <button class="btn btn-ghost" id="fold-web" style="margin-left:10px">Show</button>`;
      const foldBody = document.createElement('div');
      foldBody.hidden = true;
      foldBody.appendChild(box);
      foldHead.querySelector('#fold-web').onclick = (e) => {
        foldBody.hidden = !foldBody.hidden;
        e.target.textContent = foldBody.hidden ? 'Show' : 'Hide';
      };
      webBox.appendChild(foldHead);
      webBox.appendChild(foldBody);
      if (!data.results.length) {
        const cat = data.catalogue || {};
        const hasCat = (cat.songs && cat.songs.length) || (cat.albums && cat.albums.length);
        box.innerHTML = '';
        if (hasCat) {
          renderCatalogue(box, data);
          const note = document.createElement('div');
          note.className = 'ladder-note';
          note.textContent = 'No open source has this audio yet. Use the download arrow on a catalogue row to fetch it.';
          box.appendChild(note);
        } else {
          box.innerHTML = `<div class="sec-title">Ladder <small>NO MATCHES</small></div><div class="empty">No usable matches for "${esc(s)}"</div>`;
        }
        if (data.catalogue && ((data.catalogue.songs || []).length || (data.catalogue.albums || []).length)) {
          const catBox = document.createElement('div');
          renderCatalogue(catBox, data);
          holder.replaceWith(catBox);
          catBox.appendChild(webBox);
        } else {
          holder.replaceWith(box);
        }
        return;
      }
      const total = data.results.length;
      box.innerHTML = `<div class="sec-title">Open web matches <small>${total}</small></div>`;
      renderCatalogue(box, data);
      const canonEl = renderCanonical(data);
      if (canonEl) box.appendChild(canonEl);
      const note = document.createElement('div');
      note.className = 'ladder-note';
      note.textContent = data.canonical
        ? 'Verified against the catalogue: rows marked VERIFIED run the same length as the original. Click to play, arrow to keep it.'
        : 'Streamed from open web sources. No accounts, nothing to break. Click a row to play, arrow to save it to your library forever.';
      box.appendChild(note);
      if (data.albums && data.albums.length) {
        const sec = document.createElement('div');
        sec.innerHTML = `<div class="sec-title">Albums <small>${data.albums.length}</small></div>
          <div class="row-scroller" id="album-row"></div>`;
        const strip = sec.querySelector('#album-row');
        for (const a of data.albums) {
          const card = document.createElement('button');
          card.className = 'chip-card';
          card.innerHTML = `<b>${esc(a.name)}</b><span>${esc(a.artist || (a.kind === 'library' ? 'YOUR LIBRARY' : 'ARCHIVE'))}</span>`;
          card.onclick = () => {
            if (a.kind === 'library') { renderAlbum(a.name); return; }
            fetch(`/api/ladder/archive/${encodeURIComponent(a.id)}/files`).then(r => r.json()).then((d) => {
              const files = (d.files || []).slice(0, 25);
              if (!files.length) return toast('No audio files in that item');
              const host = document.createElement('div');
              host.innerHTML = `<div class="sec-title">${esc(a.name)} <small>${files.length} FILES</small></div>`;
              for (const f of files) {
                const row = document.createElement('div');
                row.className = 'trow lrow';
                row.innerHTML = `<div class="tno"></div><div class="tart ph">A</div>
                  <div class="tmeta"><div class="tt">${esc((f.name || '').slice(0, 70))}</div><div class="ta">${esc((f.format || '').toUpperCase())}</div></div>
                  <div class="talbum ladder-chip rung-archive">WEB</div><div class="tadded"></div><div class="tdur"></div>
                  <button class="lrow-play" title="Play">${IC.play}</button>
                  <button class="tmore ladder-dl" title="Download">${IC.download}</button>`;
                row.onclick = () => { audio.src = f.url; audio.play().catch(() => {}); toast(`Playing ${(f.name || '').slice(0, 40)}`); };
                row.querySelector('.lrow-play').onclick = (e) => { e.stopPropagation(); audio.src = f.url; audio.play().catch(() => {}); };
                row.querySelector('.ladder-dl').onclick = (e) => {
                  e.stopPropagation();
                  fetch('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ rung: 'archive', id: a.id, file: f.name, title: f.name, artist: a.artist }) })
                    .then(r => r.json()).then(x => toast(x.job ? 'Downloading' : (x.error || 'failed')))
                    .catch(() => toast('download failed'));
                };
                host.appendChild(row);
              }
              box.insertBefore(host, box.querySelector('.sec-title.songs-anchor') || null);
              host.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }).catch(() => toast('archive lookup failed'));
          };
          strip.appendChild(card);
        }
        box.appendChild(sec);
      }
      const songs = data.results.filter(c => !c.duration || c.duration <= 720);
      const longs = data.results.filter(c => c.duration && c.duration > 720);
      let rowNo = 0;

      const buildRows = (rows, title, note) => {
        if (!rows.length) return;
        const sec = document.createElement('div');
        sec.innerHTML = `<div class="sec-title">${title} <small>${rows.length}</small></div>${note ? `<div class="ladder-note">${note}</div>` : ''}`;
        box.appendChild(sec);
        rows.forEach((c) => {
          rowNo += 1;
          const el = document.createElement('div');
          el.className = 'trow lrow';
          const dur = c.duration ? fmt(c.duration) : '';
          const letter = (c.rung || '?').charAt(0).toUpperCase();
          const art = c.thumb
            ? `<img class="tart" src="${esc(c.thumb)}" alt="" loading="lazy" draggable="false">`
            : `<div class="tart ph">${esc(letter)}</div>`;
          const label = shortRung(c.rung).label;
          el.innerHTML = `
            <div class="tno"><span class="tno-num">${String(rowNo).padStart(2, '0')}</span></div>
            ${art}
            <div class="tmeta"><div class="tt">${esc(c.title || c.filename || '')}</div><div class="ta">${esc(c.artist || '')}</div></div>
            <div class="talbum ladder-chip rung-${esc(shortRung(c.rung).cls)}" title="match score ${c.score}">${esc(label)} ${c.score}${c.verified ? ' <b class="verif">VERIFIED</b>' : ''}</div>
            <div class="tadded">${esc(c.format === 'stream' ? 'STREAM' : (c.format || '').toUpperCase())}</div>
            <div class="tdur">${dur}</div>
            <button class="lrow-play" title="Play" aria-label="Play">${IC.play}</button>
            <button class="tmore ladder-dl" title="Download to library">${IC.download}</button>`;
          el.querySelector('.lrow-play').onclick = (e) => {
            e.stopPropagation();
            if (window.__ladderPlay) window.__ladderPlay(c);
          };
          const badgeFor = () => `${label} · STREAM`;
          const paintLadder = (extra) => {
            $('pb-title').textContent = c.title || '';
            $('pb-artist').textContent = c.artist || '';
            setArt('pb-art', c.thumb, letter);
            const b = $('pb-badge'); b.hidden = false;
            b.textContent = extra || badgeFor();
            b.className = `pb-badge rung-${shortRung(c.rung).cls}`;
            $('mini').hidden = false;
            $('mini-title').textContent = c.title || '';
            $('mini-artist').textContent = c.artist || '';
            setArt('mini-art', c.thumb, letter);
            state.current = { ladder: true, ...c };
            state.origin = 'Ladder';
            paintRows();
          };
          const streamIt = () => {
            if (c.rung === 'yt-dlp') {
              audio.src = `/api/ladder/stream/youtube/${c.id}`;
              audio.play().catch(() => toast('stream refused'));
              paintLadder();
            } else if (c.rung === 'soundcloud') {
              if (!c.url) { toast('no soundcloud url'); return; }
              audio.src = `/api/ladder/stream/soundcloud?u=${encodeURIComponent(c.url)}`;
              audio.play().catch(() => toast('stream refused'));
              paintLadder();
            } else if (c.rung === 'archive') {
              fetch(`/api/ladder/archive/${encodeURIComponent(c.id)}/files`).then(r => r.json()).then(d => {
                const f = (d.files || [])[0];
                if (!f) { toast('No audio files in item'); return; }
                audio.src = f.url;
                audio.play().catch(() => {});
                paintLadder(`${label} · ${(f.format || '').toUpperCase()}`);
              }).catch(() => toast('archive lookup failed'));
            } else {
              toast('no play path for this source');
            }
          };
          el.onclick = streamIt;
          window.__ladderPlay = (cand) => {
            if (cand.rung === 'ytmusic' || cand.rung === 'yt-dlp') {
              audio.src = `/api/ladder/stream/youtube/${cand.id}`;
              audio.play().catch(() => {});
              paintLadder();
            } else if (cand.rung === 'soundcloud' || cand.rung === 'bandcamp') {
              if (cand.rung === 'soundcloud') audio.src = `/api/ladder/stream/soundcloud?u=${encodeURIComponent(cand.url)}`;
              else audio.src = `/api/ladder/stream/generic?u=${encodeURIComponent(cand.url)}`;
              audio.play().catch(() => {});
              paintLadder();
            } else if (cand.rung === 'archive') {
              fetch(`/api/ladder/archive/${encodeURIComponent(cand.id)}/files`).then(r => r.json()).then(d => {
                const f = (d.files || [])[0]; if (!f) return toast('No audio files in item');
                audio.src = f.url; audio.play().catch(() => {});
                paintLadder(`${label} · ${(f.format || '').toUpperCase()}`);
              }).catch(() => {});
            }
          };
          el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openLadderCtx(c, e.clientX, e.clientY); };
          longPress(el, () => openLadderCtx(c, innerWidth / 2 - 110, innerHeight / 2 - 80), 650);
          const dlBtn = el.querySelector('.ladder-dl');
          dlBtn.onclick = async (e) => {
            e.stopPropagation();
            if (dlBtn.dataset.busy) return;
            dlBtn.dataset.busy = '1';
            dlBtn.classList.add('busy');
            try {
              const r = await fetch('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rung: c.rung, id: c.id, url: c.url, file: c.handle?.file || c.file, title: c.title, artist: c.artist }) });
              const d = await r.json();
              if (!d.job) throw new Error(d.error || 'failed');
              toast(`Downloading: ${c.title || c.filename}`, 5000);
              await waitForJob(d.job, c.title || c.filename);
            } catch (err) {
              toast('Download failed');
            } finally {
              dlBtn.dataset.busy = '';
              dlBtn.classList.remove('busy');
            }
          };
          box.appendChild(el);
        });
      };

      buildRows(songs, 'Songs');
      buildRows(longs, 'Long form', 'Mixes, sets and full recordings.');
      if (data.catalogue && ((data.catalogue.songs || []).length || (data.catalogue.albums || []).length)) {
        const outer = document.createElement('div');
        renderCatalogue(outer, data);
        const fold = document.createElement('div');
        fold.className = 'ladder-fold';
        const head = document.createElement('div');
        head.className = 'sec-title';
        head.innerHTML = `Web sources <small>${data.results.length} MATCHES</small>
          <button class="btn btn-ghost" id="fold-web" style="margin-left:10px">Show</button>`;
        const body = document.createElement('div');
        body.hidden = true;
        body.appendChild(box);
        head.querySelector('#fold-web').onclick = (e) => {
          body.hidden = !body.hidden;
          e.target.textContent = body.hidden ? 'Show' : 'Hide';
        };
        fold.appendChild(head);
        fold.appendChild(body);
        outer.appendChild(fold);
        holder.replaceWith(outer);
      } else {
        holder.replaceWith(box);
      }
    } catch (e) {
      if (ctl.abort) return;
      const box = document.createElement('div');
      box.innerHTML = `<div class="sec-title">Ladder <small>ERROR</small></div><div class="empty">${esc(e.message)}</div>`;
      holder.replaceWith(box);
    }
  };

  // debounce ladder searches: only fire when typing pauses
  let deb = null;
  q.oninput = () => { clearTimeout(deb); deb = setTimeout(draw, 350); };
  draw();
}

/* ============ track row ============ */
// circle of fifths grouping: nearby keys share a colour, so compatible tracks read as one block
const KEY_CLASS = {
  C: 'c', G: 'g', D: 'd', A: 'a', E: 'e', B: 'b', 'F#': 'fs', 'C#': 'cs', 'G#': 'gs', 'D#': 'ds', 'A#': 'as', F: 'f',
};
const CAMELOT = {
  'A': 8, 'A#': 3, 'B': 10, 'C': 5, 'C#': 0, 'D': 7, 'D#': 2, 'E': 9, 'F': 4, 'F#': 11, 'G': 6, 'G#': 1,
};
function camelotOf(key, scale) {
  const k = String(key || '').toUpperCase().replace('♯', '#');
  const base = CAMELOT[k];
  if (base === undefined) return 99;
  return scale === 'minor' ? base + 1 : base;
}

function sortSongsByKey() {
  if (state.view !== 'songs') { state.pendingKeySort = true; return; }
  const rows = [...document.querySelectorAll('.trow')];
  const value = (row) => {
    const chip = row.querySelector('.keychip');
    if (!chip) return 999;
    const txt = chip.textContent.trim();
    const minor = /m$/.test(txt);
    const key = txt.replace(/m$/, '');
    return camelotOf(key, minor ? 'minor' : 'major') * 1000 + (Number((row.querySelector('.tbpm') || {}).textContent) || 0) / 10000;
  };
  rows.sort((a, b) => value(a) - value(b));
  const host = rows[0] && rows[0].parentElement;
  if (!host) return;
  for (const r of rows) host.appendChild(r);
  toast('Sorted by harmonic key', 3000);
}

function keyHueClass(key, scale) {
  const k = String(key || '').toUpperCase().replace('♯', '#');
  const cls = KEY_CLASS[k] || 'c';
  return `${cls}${scale === 'minor' ? '-m' : ''}`;
}

function trow(t, i, list) {
  registerRow(t);
  const el = document.createElement('div');
  el.className = 'trow'; el.dataset.tid = t.id;
  const liked = isLiked(t);
  const stamp = t.date_added || t.added_at;
  const added = stamp ? new Date(stamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  el.innerHTML = `
    <div class="tno"><span class="tno-num">${String(i + 1).padStart(2, '0')}</span><button class="tno-play" aria-label="Play">${IC.play}</button></div>
    ${artTag(t, 'tart', 96)}
    <div class="tmeta"><div class="tt">${esc(t.title)}</div>${t.album ? `<div class="talbum-line"><span class="alink">${esc(t.album)}</span></div>` : ''}${t.genre || t.genre_family ? `<button class="genrechip" data-kind="genre">${esc(t.genre_family || t.genre)}</button>` : ''}${t.bpm ? `<div class="tbpm">${Math.round(t.bpm)} BPM${t.key ? ` <button class="keychip key-${keyHueClass(t.key, t.key_scale)}" data-kind="key" title="Sort by key">${esc(t.key)}${t.key_scale === 'minor' ? 'm' : ''}</button>` : ''}</div>` : ''}</div>
    <div class="tartist"><span class="alink ${t.artist ? '' : 'muted'}" data-kind="artist">${esc(t.artist || 'unknown artist')}</span></div>
    <div class="talbum"><span class="alink" data-kind="album">${esc(t.album || '')}</span></div>
    <div class="tadded">${esc(added)}</div>
    <button class="like ${liked ? 'on' : ''}" title="Like" aria-label="Like">${liked ? IC.heartFull : IC.heart}</button>
    ${hasAudio(t)
      ? `<div class="trbadge rung-${esc(shortRung(t.rung).cls)}"><b>${esc(shortRung(t.rung).label)}</b> ${esc(t.quality || '')}</div>`
      : t.streamable
        ? `<div class="trbadge rung-yt" title="Plays from the source when you press play."><b>STREAM</b></div>`
        : `<div class="trbadge rung-mirror" title="Metadata only. Press the download icon to get the audio."><b>NO AUDIO</b></div>`}
    <div class="tdur">${fmt(t.duration)}</div>
    ${hasAudio(t)
      ? `<button class="tmore" title="More options">${IC.dots}</button>`
      : `<button class="tmore tdl" title="Download this track">${IC.download}</button>`}`;
  el.querySelector('.tno-play').onclick = (e) => {
    e.stopPropagation();
    if (state.current && state.current.id === t.id && audio.src) { togglePlay(); return; }
    playList(list || [t], list ? list.indexOf(t) : 0, false, state.view);
  };
  const artEl = el.querySelector('.tart');
  if (artEl) {
    artEl.style.cursor = 'pointer';
    artEl.title = 'Track options';
    artEl.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openCtx(t, e.clientX, e.clientY); };
    artEl.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      // anchored to the cover so the menu lands where the thumb is
      const b = artEl.getBoundingClientRect();
      openCtx(t, Math.min(b.left, innerWidth - 240), Math.min(b.bottom + 6, innerHeight - 260));
    };
    longPress(artEl, () => openCtx(t, innerWidth / 2 - 110, innerHeight / 2 - 140));
  }
  el.querySelector('.like').onclick = (e) => { e.stopPropagation(); toggleLike(t); };
  const moreBtn = el.querySelector('.tmore');
  if (moreBtn.classList.contains('tdl')) {
    moreBtn.onclick = async (e) => {
      e.stopPropagation();
      if (moreBtn.dataset.busy) return;
      moreBtn.dataset.busy = '1';
      moreBtn.classList.add('busy');
      try {
        const r = await fetch(`/api/tracks/${t.id}/download`, { method: 'POST' });
        const d = await r.json();
        if (!d.job) throw new Error(d.error || 'failed');
        toast(`Downloading: ${t.title}`, 5000);
        openDownloads();
        trackProgress(t.id, moreBtn);
        await waitForJob(d.job, t.title, t.id);
      } catch (err) {
        toast(`Download failed: ${t.title}`);
      } finally {
        moreBtn.dataset.busy = '';
        moreBtn.classList.remove('busy');
      }
    };
  } else {
    moreBtn.onclick = (e) => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); openCtx(t, r.left - 180, r.bottom + 4); };
  }
  const art = el.querySelector('.tartist .alink');
  if (art && t.artist) art.onclick = (e) => { e.stopPropagation(); renderArtist(t.artist); };
  const keyBtn = el.querySelector('.keychip');
  if (keyBtn) keyBtn.onclick = (e) => { e.stopPropagation(); state._keySort = (state._keySort || 0) + 1; sortSongsByKey(); };
  const alb = el.querySelector('.talbum .alink');
  if (t.album) alb.onclick = (e) => { e.stopPropagation(); renderAlbum(t.album); };
  el.tabIndex = 0;
  el.setAttribute('role', 'row');
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); playList(list || [t], list ? list.indexOf(t) : 0, false, state.view); }
    if (e.key === ' ') { e.preventDefault(); selectRow(el, t, e.metaKey || e.ctrlKey); state.anchorId = t.id; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll('.trow')];
      const i = rows.indexOf(el);
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    }
  };
  el.draggable = true;
  el.ondragstart = (e) => {
    const ids = state.selectedIds.has(t.id) && state.selectedIds.size > 1 ? [...state.selectedIds] : [t.id];
    e.dataTransfer.setData('application/x-musicfy', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copy';
  };
  el.onclick = (e) => {
    if (e.target.closest('button')) return;
    if (e.shiftKey && state.anchorId != null && list) {
      const ids = list.map((x) => x.id);
      const a = ids.indexOf(state.anchorId);
      const b = ids.indexOf(t.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        state.selectedIds.clear();
        document.querySelectorAll('.trow.selected').forEach((r) => r.classList.remove('selected'));
        for (let i = lo; i <= hi; i++) state.selectedIds.add(ids[i]);
        document.querySelectorAll('.trow').forEach((r) => {
          if (state.selectedIds.has(Number(r.dataset.tid))) r.classList.add('selected');
        });
        renderSelectionBar();
        return;
      }
    }
    selectRow(el, t, e.metaKey || e.ctrlKey);
    state.anchorId = t.id;
  };
  el.ondblclick = (e) => { if (!e.target.closest('button')) playList(list || [t], list ? list.indexOf(t) : 0, false, state.view); };
  el.oncontextmenu = (e) => { e.preventDefault(); openCtx(t, e.clientX, e.clientY); };
  longPress(el, () => openCtx(t, innerWidth / 2 - 110, innerHeight / 2 - 80), 700);
  return el;
}

/* poll a download job and report the result to the user */
// show progress for a track being downloaded, right where the user clicked
function trackProgress(trackId, anchorEl) {
  const row = document.querySelector(`.trow[data-tid="${trackId}"]`);
  if (!row || row.querySelector('.row-prog')) return;
  const bar = document.createElement('div');
  bar.className = 'row-prog';
  bar.innerHTML = '<i style="width:2%"></i>';
  row.appendChild(bar);
  const fill = bar.querySelector('i');
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > 15 * 60 * 1000) { bar.remove(); return; }
    try {
      const d = await api('/api/downloads', { nocache: true });
      const item = (d.items || []).find((i) => i.track_id === trackId && (i.state === 'running' || i.state === 'queued'));
      if (item) fill.style.width = Math.max(4, item.progress || 4) + '%';
      const done = (d.items || []).find((i) => i.track_id === trackId && i.state === 'done');
      if (!item && done) { fill.style.width = '100%'; setTimeout(() => bar.remove(), 800); return; }
      if (!item && !done) { bar.remove(); return; }
    } catch {}
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 800);
}

// loudness normalisation: turn every track down to a common target, never boost
// short fades at both ends: not a true crossfade, but no hard cut between tracks
let fadeTimer = null;
function fadeTo(target, ms = 400) {
  clearInterval(fadeTimer);
  const start = audio.volume;
  const steps = Math.max(1, Math.round(ms / 40));
  let i = 0;
  fadeTimer = setInterval(() => {
    i += 1;
    const v = start + (target - start) * (i / steps);
    try { audio.volume = Math.max(0, Math.min(1, v)); } catch {}
    if (i >= steps) clearInterval(fadeTimer);
  }, 40);
}
function targetVolume() {
  const s = state.settings || {};
  const base = Number(state.volume ?? 0.9);
  const t = state.current;
  if (!s.normalize_loudness || !t || t.loudness == null) return Math.min(1, base);
  const gainDb = Number(s.target_loudness ?? -14) - Number(t.loudness);
  return Math.max(0, Math.min(1, base * Math.pow(10, Math.max(-18, Math.min(0, gainDb)) / 20)));
}

function applyLoudnessGain(t) {
  const s = state.settings || {};
  const base = Number(state.volume ?? 0.9);
  if (!s.normalize_loudness || !t || t.loudness == null) {
    try { audio.volume = Math.max(0, Math.min(1, base)); } catch {}
    return;
  }
  const target = Number(s.target_loudness ?? -14);
  const gainDb = target - Number(t.loudness);
  const gain = Math.pow(10, Math.max(-18, Math.min(0, gainDb)) / 20);   // only ever quieter
  try { audio.volume = Math.max(0, Math.min(1, base * gain)); } catch {}
}

function bustCache() {
  for (const p of ['/api/tracks', '/api/playlists', '/api/recent', '/api/likes/full', '/api/stats']) {
    try { localStorage.removeItem(CACHE_PREFIX + p); } catch {}
  }
  state.allTracks = null;
}

/* flip the row in place so the badge changes the moment the file lands */
function markRowOwned(trackId) {
  const row = document.querySelector(`.trow[data-tid="${trackId}"]`);
  if (!row) return;
  const badge = row.querySelector('.trbadge');
  if (badge) { badge.className = 'trbadge rung-local'; badge.innerHTML = '<b>OWNED</b>'; }
}

async function waitForJob(jobId, title, trackId = null, tries = 90) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const j = await api(`/api/jobs/${jobId}`);
      if (j.state === 'done') {
        bustCache();
        if (trackId) markRowOwned(trackId);
        toast(`Downloaded: ${title}`, 7000);
        refreshView();
        return true;
      }
      if (j.state === 'error') {
        const why = (j.detail || '').replace(/^error\s*/i, '').slice(0, 90);
        toast(`Download failed: ${title}${why ? ' (' + why + ')' : ''}`, 8000);
        return false;
      }
    } catch (e) { /* keep waiting */ }
  }
  toast('Download is still running in the background', 7000);
  return false;
}

/* artist page: all owned tracks for one artist */
async function renderArtist(name, push = true) {
  if (push) state.history.push({ v: state.view, pid: state.playlistId, name: state.artistName || state.albumName });
  $('back').hidden = !state.history.length;
  state.artistName = name; state.albumName = null;
  setNav('library'); state.view = 'artist'; state.playlistId = null; renderSidebar();
  $('view-title').textContent = name;
  const v = $('view');
  v.innerHTML = `<div class="plhead">
      <div class="plhead-art ph">${esc(name.charAt(0).toUpperCase())}</div>
      <div>
        <div class="plhead-kicker">ARTIST</div>
        <h1 class="plhead-name">${esc(name)}</h1>
        <div class="plhead-meta"><b id="g-n">...</b> tracks in your library</div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="g-play">${IC.play}&nbsp; Play</button>
        </div>
      </div></div>
    <div id="g-list"></div>`;
  let list = [];
  try { list = await api(`/api/group/artist/${encodeURIComponent(name)}`); } catch {}
  state._currentList = list;
  $('g-n').textContent = list.length;
  const el = $('g-list');
  if (!list.length) { el.innerHTML = `<div class="empty">No owned tracks for this artist yet. Search the ladder and download some.</div>`; return; }
  list.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
  $('g-play').onclick = () => playList(list, 0, false, name);
}

/* album page: all owned tracks for one album */
async function renderAlbum(name, push = true) {
  if (push) state.history.push({ v: state.view, pid: state.playlistId, name: state.artistName || state.albumName });
  $('back').hidden = !state.history.length;
  state.albumName = name; state.artistName = null;
  setNav('library'); state.view = 'album'; state.playlistId = null; renderSidebar();
  $('view-title').textContent = name;
  const v = $('view');
  const first = (await api(`/api/group/album/${encodeURIComponent(name)}`))[0];
  v.innerHTML = `<div class="plhead">
      <img class="plhead-art" src="/api/cover-album/${encodeURIComponent(name)}?v=${state.artV || 0}" alt="" loading="lazy"
        onerror="this.outerHTML='<div class=plhead-art ph>${esc(name.charAt(0).toUpperCase())}</div>'">
      <div>
        <div class="plhead-kicker">ALBUM</div>
        <h1 class="plhead-name">${esc(name)}</h1>
        <div class="plhead-meta"><b id="g-n">...</b> tracks &middot; ${esc(first?.artist || '')}</div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="g-play">${IC.play}&nbsp; Play</button>
          <button class="btn btn-ghost" id="g-dl">Download album</button>
          <button class="btn btn-ghost" id="g-pick">Choose tracks</button>
        </div>
      </div></div>
    <div id="g-list"></div>`;
  let list = [];
  try { list = await api(`/api/group/album/${encodeURIComponent(name)}`); } catch {}
  state._currentList = list;
  $('g-n').textContent = list.length;
  const el = $('g-list');
  if (!list.length) { el.innerHTML = `<div class="empty">No owned tracks for this album.</div>`; return; }
  list.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
  $('g-play').onclick = () => playList(list, 0, false, name);
  $('g-dl').onclick = async () => {
    const btn = $('g-dl');
    btn.disabled = true;
    try {
      const r = await api('/api/albums/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      toast(r.queued ? `Downloading ${r.queued} of ${r.total} tracks` : 'Everything on this album is already here', 6000);
      if (r.queued) openDownloads();
    } catch { toast('Could not queue the album', 4000); }
    btn.disabled = false;
  };
  $('g-pick').onclick = async () => {
    state.albumPick = !state.albumPick;
    document.querySelectorAll('.trow').forEach((row) => {
      const on = state.albumPick;
      row.classList.toggle('picking', on);
      let box = row.querySelector('.pick-box');
      if (on && !box) {
        box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'pick-box';
        box.onclick = (e) => e.stopPropagation();
        row.insertBefore(box, row.firstChild);
      } else if (!on && box) { box.remove(); }
    });
    $('g-pick').textContent = state.albumPick ? 'Download chosen' : 'Choose tracks';
    if (!state.albumPick) {
      const ids = [...document.querySelectorAll('.pick-box')].filter((b) => b.checked).map((b) => Number(b.closest('.trow').dataset.tid));
      const chosen = list.filter((t) => ids.includes(t.id));
      if (!chosen.length) { toast('Nothing selected', 3000); return; }
      let n = 0;
      for (const t of chosen) { try { await api(`/api/tracks/${t.id}/download`, { method: 'POST' }); n += 1; } catch {} }
      toast(`Downloading ${n} tracks`, 5000);
      if (n) openDownloads();
    }
  };
}

/* re-render whatever view is active, after data changes */
function refreshView() {
  if (state.view === 'songs') renderSongs(false);
  else if (state.view === 'search') renderSearch();
  else if (state.view === 'playlist' && state.playlistId) openPlaylist(state.playlistId, false);
  else if (state.view === 'liked') renderLiked();
  else if (state.view === 'artist' && state.artistName) renderArtist(state.artistName, false);
  else if (state.view === 'album' && state.albumName) renderAlbum(state.albumName, false);
  else if (state.view === 'library') renderLibrary();
  else if (state.view === 'home') renderHome();
}

/* row selection: single click selects, double click plays */
function selectRow(el, t, additive = false) {
  const ids = state.selectedIds;
  if (!additive) {
    ids.clear();
    document.querySelectorAll('.trow.selected').forEach((r) => r.classList.remove('selected'));
  }
  if (ids.has(t.id) && additive) { ids.delete(t.id); el.classList.remove('selected'); }
  else { ids.add(t.id); el.classList.add('selected'); }
  state.selected = t;
  renderSelectionBar();
}

function renderSelectionBar() {
  const n = state.selectedIds.size;
  const app = document.getElementById('app');
  if (app) app.classList.toggle('has-selection', n > 0);
  const old = document.getElementById('selbar');
  if (old) old.remove();          // inline bar is rebuilt with the view
  if (n < 2) return;              // a single click just highlights the row, no action bar
  const host = $('selhost') || $('view'); if (!host) return;
  const bar = document.createElement('div');
  bar.className = 'selbar inline';
  bar.id = 'selbar';
  bar.innerHTML = `<span class="selcount" id="selcount">${n} selected</span>
    <button class="btn btn-primary" id="sel-create">New playlist</button>
    <button class="btn btn-ghost" id="sel-add">Add to playlist</button>
    <button class="btn btn-ghost" id="sel-clear">Clear</button>`;
  host.appendChild(bar);
  bar.querySelector('#sel-create').onclick = selCreatePlaylist;
  bar.querySelector('#sel-add').onclick = selAddToPlaylist;
  bar.querySelector('#sel-clear').onclick = clearSelection;
}

async function selCreatePlaylist() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const name = prompt('Playlist name for the selection:');
  if (!name) return;
  const np = await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  afterWrite();
  await addTracksToPlaylist(np.id, ids);
  clearSelection();
  openPlaylist(np.id, false);
}

function selAddToPlaylist() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  openAddPlIds(ids);
}

function clearSelection() {
  state.selectedIds.clear();
  document.querySelectorAll('.trow.selected').forEach((r) => r.classList.remove('selected'));
  renderSelectionBar();
}

function paintPill() {
  const el = $('pill');
  if (!el) return;
  api('/api/stats', { nocache: true }).then((s) => {
    el.textContent = `${s.tracks} TRACKS · ${(s.owned_bytes / 1073741824).toFixed(1)}G`;
  }).catch(() => { el.textContent = ''; });
}

function afterWrite() { try { bustCache(); } catch {} try { paintPill(); } catch {} }

async function addTracksToPlaylist(pid, ids) {
  for (const id of ids) {
    await api(`/api/playlists/${encodeURIComponent(pid)}/tracks`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: id }),
    }).catch(() => {});
  }
  const p = state.playlists.find((x) => x.id === pid);
  toast(`Added ${ids.length} to ${p ? p.name : 'playlist'}`);
  await loadPlaylists();
}

/* ============ queue drawer ============ */
audio.addEventListener('canplay', () => prefetchNext());

function saveQueue() {
  try {
    localStorage.setItem('mf-queue', JSON.stringify({
      queue: state.queue.map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, rung: t.rung, has_art: t.has_art, quality: t.quality })),
      qi: state.qi, origin: state.origin,
    }));
  } catch {}
}

function restoreQueue() {
  try {
    const raw = localStorage.getItem('mf-queue');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.queue) || !s.queue.length) return;
    state.queue = s.queue;
    state.qi = Math.min(s.qi ?? 0, s.queue.length - 1);
    state.origin = s.origin || '';
    state.current = state.queue[state.qi] || null;
    if (state.current) {
      paintNowPlaying();
      $('pb-badge').hidden = false;
    }
    renderQueue();
  } catch {}
}

function renderQueue() {
  const el = $('queue-list');
  const up = state.queue.slice(state.qi + 1);
  el.innerHTML = (state.current ? `<div class="q-now">
      ${artTag(state.current, 'q-art', 96)}
      <div><div class="q-label">NOW PLAYING</div><div class="q-title">${esc(state.current.title)}</div><div class="q-sub">${esc(state.current.artist || '')}</div></div>
    </div>` : '') +
    `<div class="q-label" style="margin:14px 0 6px">NEXT IN QUEUE ${up.length ? '(' + up.length + ')' : ''}</div>` +
    (up.length ? up.map((t, i) => {
      registerRow(t);
      return `<div class="q-row" data-q="${state.qi + 1 + i}">
        ${artTag(t, 'q-art sm', 96)}
        <div style="min-width:0"><div class="q-title">${esc(t.title)}</div><div class="q-sub">${esc(t.artist || '')}</div></div>
        <button class="q-rm" data-i="${state.qi + 1 + i}" title="Remove">&times;</button>
      </div>`;
    }).join('') : `<div class="q-empty">Queue is empty. Right click any track to add.</div>`);
  el.querySelectorAll('.q-row').forEach(r => r.onclick = (e) => {
    if (e.target.closest('.q-rm')) return;
    playAt(Number(r.dataset.q));
  });
  el.querySelectorAll('.q-rm').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.i);
    if (i > state.qi) { state.queue.splice(i, 1); saveQueue(); renderQueue(); }
  });
}

/* ============ downloads panel ============ */
let dlTimer = null;

async function renderDownloads() {
  const host = $('dl-list');
  if (!host) return;
  let d;
  try { d = await api('/api/downloads'); } catch { return; }
  const all = (d.items || []).filter((i) => i.state === 'running' || i.state === 'queued' || i.state === 'error');
  all.sort((a, b) => {
    const rank = (x) => (x.state === 'running' ? 0 : x.state === 'queued' ? 1 : 2);
    return rank(a) - rank(b) || (b.id - a.id);
  });
  const items = all.slice(0, 120);
  const lib = d.library || { total: 0, with_audio: 0, missing: 0 };
  const pct = lib.total ? Math.round((lib.with_audio / lib.total) * 100) : 0;
  host.innerHTML = `<div class="dl-summary">
      <span class="dl-lib">${lib.with_audio} of ${lib.total} tracks have audio (${pct}%)</span>
      <span>·</span><span>${d.active} running</span><span>·</span><span>${d.queued} queued</span>${d.failed ? `<span>·</span><span class="warn-txt">${d.failed} failed</span>` : ''}
    </div>
    <div class="dl-libbar"><i style="width:${pct}%"></i></div>
    <div class="dl-tools">
      ${d.failed ? `<button class="dl-act" id="dl-retry-all">Retry all failed (${d.failed})</button>` : ''}
      ${(d.active + d.queued) ? `<button class="dl-act" id="dl-cancel-all">Cancel all (${d.active + d.queued})</button>` : ''}
      ${lib.missing && !(d.active + d.queued) ? `<button class="dl-act" id="dl-fill">Download ${lib.missing} missing</button>` : ''}
      ${d.failed ? `<button class="dl-act" id="dl-clear-failed">Dismiss failed (${d.failed})</button>` : ''}
    </div>` + (items.length ? items.map((i) => `
      <div class="dl-row" data-job="${i.id}">
        <div class="dl-line">
          <span class="dl-title">${esc(i.title || 'track')}</span>
          <span class="dl-pct">${i.state === 'running' ? i.progress + '%' : i.state}</span>
        </div>
        <div class="dl-bar"><i style="width:${i.state === 'done' ? 100 : Math.max(2, i.progress || 0)}%"></i></div>
        ${i.detail && i.state === 'error' ? `<div class="dl-err">${esc(i.detail.slice(0, 60))}</div>` : ''}
        <div class="dl-actions">
          ${i.state === 'error' ? `<button class="dl-act" data-retry="${i.id}">Retry</button>` : ''}
          ${i.state === 'running' || i.state === 'queued' ? `<button class="dl-act" data-cancel="${i.id}">Cancel</button>` : ''}
        </div>
      </div>`).join('') : `<div class="q-empty">Nothing in the queue.</div>`);

  host.querySelectorAll('[data-retry]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await api(`/api/downloads/${b.dataset.retry}/retry`, { method: 'POST' }); toast('Retrying', 3000); } catch { toast('retry failed', 3000); }
    renderDownloads();
  });
  host.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    b.disabled = true;
    try { await api(`/api/downloads/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Cancelled', 3000); } catch { toast('cancel failed', 3000); }
    renderDownloads();
  });

  const cancelAll = host.querySelector('#dl-cancel-all');
  if (cancelAll) cancelAll.onclick = async () => {
    cancelAll.disabled = true;
    try { const r = await api('/api/downloads/cancel-all', { method: 'POST' }); toast(`${r.cancelled} downloads cancelled`, 5000); } catch { toast('cancel failed', 4000); }
    renderDownloads();
  };
  const fill = host.querySelector('#dl-fill');
  if (fill) fill.onclick = async () => {
    fill.disabled = true;
    try {
      const r = await api('/api/maintenance/redownload-missing?limit=400', { method: 'POST' });
      toast(`${r.queued} downloads queued`, 5000);
      setTimeout(renderDownloads, 1500);
    } catch { toast('could not queue', 4000); fill.disabled = false; }
  };
  const clearFailed = host.querySelector('#dl-clear-failed');
  if (clearFailed) clearFailed.onclick = async () => {
    clearFailed.disabled = true;
    try { const r = await api('/api/downloads/clear-failed', { method: 'POST' }); toast(`${r.cleared} failed entries cleared`, 5000); } catch { toast('could not clear', 4000); }
    renderDownloads();
  };

  const retryAll = host.querySelector('#dl-retry-all');
  if (retryAll) retryAll.onclick = async () => {
    retryAll.disabled = true;
    try { const r = await api('/api/downloads/retry-failed', { method: 'POST' }); toast(`${r.queued} downloads requeued`, 5000); } catch { toast('retry failed', 4000); }
    renderDownloads();
  };

  const busy = d.active > 0 || d.queued > 0;
  if (busy && !dlTimer) dlTimer = setInterval(() => { renderDownloads(); }, 2000);
  if (!busy && dlTimer) { clearInterval(dlTimer); dlTimer = null; refreshView(); }
}

function openDownloads() {
  const d = $('dl-drawer');
  d.hidden = false;
  document.getElementById('app').classList.add('queue-open');
  renderDownloads();
}
function closeDownloads() {
  $('dl-drawer').hidden = true;
  document.getElementById('app').classList.remove('queue-open');
  if (dlTimer) { clearInterval(dlTimer); dlTimer = null; }
}
$('dl-btn').onclick = (e) => { e.stopPropagation(); $('dl-drawer').hidden ? openDownloads() : closeDownloads(); };
$('dl-close').onclick = closeDownloads;

/* ============ preload ============ */
// fetch the next track ahead of time and keep the bytes in memory; works the same
// on iPhone, Android and desktop because it avoids the resolver round trip at play time
const preload = new Map();
const PRELOAD_MAX = 2;

function releasePreload(id) {
  const p = preload.get(id);
  if (p) {
    try { if (p.el) { p.el.src = ''; p.el.load(); } } catch {}
    preload.delete(id);
  }
}

/* warm the next track the way a phone does it: a hidden media element buffers bytes,
   and local files are cacheable so the second read comes off the device. */
function prefetchTrack(t) {
  if (!t || !t.id || t.ladder) return;
  if (preload.has(t.id)) return;
  try {
    if (t.streamable && !t.owned) {
      fetch(`/api/prewarm/${t.id}`).catch(() => {});   // resolver warm, bytes cannot cross origin
      preload.set(t.id, { el: null, at: Date.now() });
    } else {
      const el = new Audio();
      el.preload = 'auto';
      el.muted = true;
      el.src = `/api/stream/${t.id}`;
      el.load();
      preload.set(t.id, { el, at: Date.now() });
    }
    while (preload.size > PRELOAD_MAX) {
      const oldest = [...preload.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      releasePreload(oldest[0]);
    }
  } catch {}
}

function prefetchNext() {
  const next = state.queue[state.qi + 1];
  if (next) prefetchTrack(next);
  const after = state.queue[state.qi + 2];
  if (after) setTimeout(() => prefetchTrack(after), 6000);
}

/* ============ playback ============ */
function playList(list, i = 0, shuffled = false, origin = '') {
  if (!list.length) return;
  state.origin = origin;
  state.queue = shuffled ? shuffleArr([...list]) : [...list];
  if (shuffled && list[i]) state.queue = [list[i], ...state.queue.filter(t => t.id !== list[i].id)];
  playAt(shuffled ? 0 : Math.min(Math.max(0, i), list.length - 1));
}
const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function playLiked() {
  const list = await api('/api/likes/full');
  if (!list.length) { toast('No liked songs yet'); return; }
  playList(list, 0, false, 'Liked Songs');
}
async function playPlaylist(pid, shuffled = false) {
  const list = await api(`/api/playlists/${encodeURIComponent(pid)}`);
  if (!list.length) { toast('Playlist is empty'); return; }
  const p = state.playlists.find(x => x.id === pid);
  playList(list, 0, shuffled, p ? p.name : '');
}

function trackPlayable(t) {
  if (!t) return false;
  return hasAudio(t) || t.streamable || !!t.rung || !!t.owned;
}

async function playAt(i, opts = {}) {
  if (i < 0 || i >= state.queue.length) return;
  // in the car you cannot see a message, so skip past silent tracks instead of stopping
  if (opts.skipUnplayable !== false) {
    let j = i;
    let hops = 0;
    while (j < state.queue.length && !trackPlayable(state.queue[j]) && hops < 12) { j += 1; hops += 1; }
    if (j >= state.queue.length || !trackPlayable(state.queue[j])) {
      toast('Nothing playable in the queue. Download some tracks first.', 6000);
      return;
    }
    if (hops) i = j;
  }
  state.qi = i; state.current = state.queue[i];
  saveQueue();
  const t = state.current;
  applyLoudnessGain(t);
  audio.src = `/api/stream/${t.id}`;
  const want = targetVolume();
  const fadeMs = Number((state.settings || {}).fade_on_play_ms || 350);
  try { audio.volume = 0; } catch {}
  audio.addEventListener('playing', () => { if (!state._fadingIn) { state._fadingIn = true; fadeTo(want, fadeMs); setTimeout(() => { state._fadingIn = false; }, fadeMs + 100); } }, { once: true });
  try { await audio.play(); } catch {}
  prefetchNext();
  // do not log a play the moment it starts: wait until it is genuinely being listened to
  state._listenTrack = t;
  state._listenLogged = false;
  paintNowPlaying();
  paintRows();
  if (!$('queue-drawer').hidden) renderQueue();
}

function mediaArtwork(t) {
  const url = t && t.has_art ? `/api/cover/${t.id}?s=512` : (t && t.thumb ? t.thumb : null);
  return url ? [{ src: url, sizes: '512x512', type: 'image/jpeg' }] : [];
}

function paintMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || 'Unknown track',
      artist: t.artist || '',
      album: t.album || '',
      artwork: mediaArtwork(t),
    });
  } catch {}
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}

function syncPositionState() {
  // intentionally empty: publishing a position state makes iOS show a scrubber and
  // rewind / forward buttons instead of previous and next track on car displays
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
  const clear = (action) => { try { navigator.mediaSession.setActionHandler(action, null); } catch {} };
  // every seek affordance is cleared first, otherwise iOS keeps drawing rewind / forward
  ['seekbackward', 'seekforward', 'seekto', 'skipad', 'nextslide', 'previousslide', 'seekto'].forEach(clear);
  set('play', () => audio.play().catch(() => {}));
  set('pause', () => audio.pause());
  set('previoustrack', () => prevTrack(true));
  set('nexttrack', () => nextTrack());
  set('stop', () => { audio.pause(); audio.currentTime = 0; });
}
bindMediaSession();
document.addEventListener('visibilitychange', () => { if (!document.hidden) bindMediaSession(); });
audio.addEventListener('play', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
audio.addEventListener('pause', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('timeupdate', () => {
  const t = state._listenTrack;
  if (t && !state._listenLogged) {
    const played = audio.currentTime;
    const half = (Number(t.duration) || 0) > 0 ? (Number(t.duration) / 2) : 30;
    if (played >= Math.min(30, Math.max(15, half))) {
      state._listenLogged = true;
      fetch('/api/listen', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track_id: t.id, ms_played: Math.round(played * 1000), source: t.rung || 'local' }) }).catch(() => {});
    }
  } syncPositionState(); });
audio.addEventListener('seeking', () => { syncPositionState(); });

function fitNowPlaying() {
  const np = $('np');
  if (!np) return;
  const vv = window.visualViewport;
  if (vv && vv.height) {
    np.style.top = `${Math.round(vv.offsetTop)}px`;
    np.style.height = `${Math.round(vv.height)}px`;
    np.style.bottom = 'auto';
  } else {
    np.style.top = '0';
    np.style.height = '100%';
    np.style.bottom = '0';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitNowPlaying);
  window.visualViewport.addEventListener('scroll', fitNowPlaying);
}
window.addEventListener('orientationchange', () => setTimeout(fitNowPlaying, 120));

function paintNowPlaying() {
  const t = state.current; if (!t) return;
  try { bindMediaSession(); paintMediaSession(t); } catch {}
  const rung = (t.rung || 'local').toUpperCase(), q = t.quality || '';
  $('pb-title').textContent = t.title || '';
  $('pb-artist').textContent = t.artist || '';
  setArt('pb-art', artUrl(t, 128), t.title);
  $('pb-like').innerHTML = isLiked(t) ? IC.heartFull : IC.heart;
  $('pb-like').classList.toggle('on', isLiked(t));
  $('pb-badge').hidden = false;
  $('pb-badge').className = `pb-badge rung-${shortRung(t.rung).cls}`;
  $('pb-badge').textContent = `${shortRung(t.rung).label} ${q}`;
  $('mini').hidden = false;
  $('mini-title').textContent = t.title || '';
  $('mini-artist').textContent = t.artist || '';
  setArt('mini-art', artUrl(t, 96), t.title);
  $('np-title').textContent = t.title || '';
  $('np-artist').textContent = t.artist || '';
  setArt('np-art', artUrl(t, 640), t.title);
  $('np-bg-img').src = artUrl(t, 640) || '';
  $('np-like').innerHTML = isLiked(t) ? IC.heartFull : IC.heart;
  $('np-like').classList.toggle('on', isLiked(t));
  $('np-badge').hidden = false;
  $('np-badge').textContent = `${rung} ${q} · OWNED`;
  $('np-ctx').textContent = state.origin || '';
}

function paintRows() {
  document.querySelectorAll('.trow, .q-row').forEach(r => {
    const tid = Number(r.dataset.tid || r.dataset.q && state.queue[Number(r.dataset.q)]?.id);
    const on = state.current && tid === state.current.id;
    r.classList.toggle('playing', !!on);
    if (r.classList.contains('trow')) {
      const num = r.querySelector('.tno-num');
      const btn = r.querySelector('.tno-play');
      if (on && !audio.paused) { num.style.display = 'none'; btn.style.display = 'inline-flex'; btn.innerHTML = IC.pause; }
      else { num.style.display = ''; btn.style.display = ''; btn.innerHTML = IC.play; }
    }
  });
}

const togglePlay = () => state.current ? (audio.paused ? audio.play() : audio.pause()) : null;
function nextTrack() {
  if (!state.queue.length) return;
  if (state.repeat && state.qi >= state.queue.length - 1) return playAt(0);
  if (state.qi >= state.queue.length - 1) {
    // end of the queue: keep playing instead of stopping dead
    if (state.queue.length > 1) return playAt(0);
    audio.pause();
    return;
  }
  playAt(state.qi + 1);
}
function prevTrack(force = false) {
  if (!force && audio.currentTime > 3) { audio.currentTime = 0; return; }
  playAt(Math.max(0, state.qi - 1));
}

/* ============ audio events ============ */
/* a track with no stored audio is not a playback error: say so instead of silently skipping */
audio.addEventListener('error', async () => {
  const t = state.current;
  // a stream row pointing at an expired source: re-resolve once before giving up
  if (t && !state._retriedSrc?.[t.id] && /\/api\/stream\//.test(audio.src || '')) {
    state._retriedSrc = state._retriedSrc || {};
    state._retriedSrc[t.id] = true;
    try {
      const r = await fetch(`/api/stream/${t.id}`, { method: 'HEAD' });
      if (r.status === 302 || r.status === 200) {
        audio.src = `/api/stream/${t.id}?r=${Date.now()}`;
        audio.play().catch(() => {});
        return;
      }
    } catch {}
  }
  if (t && t.id) {
    let status = 0;
    try { const r = await fetch(`/api/stream/${t.id}`, { method: 'HEAD' }); status = r.status; } catch {}
    if (status === 404) {
      setPlayIcons(false);
      paintRows();
      // the row claimed audio that is no longer there: correct the view instead of lying
      bustCache();
      state.allTracks = null;
      toast(`No audio stored for ${t.title || 'this track'}. It has been queued for download.`, 7000);
      fetch(`/api/tracks/${t.id}/download`, { method: 'POST' }).catch(() => {});
      setTimeout(() => { try { refreshView(); } catch {} }, 600);
      return;
    }
  }
  if (!state.queue.length || state.qi < 0) return;
  const failed = state.current;
  const tried = state._failed || (state._failed = new Set());
  if (failed && failed.id) tried.add(failed.id);
  if (tried.size > 4) { tried.clear(); toast('Several tracks could not play', 4000); return; }
  toast(`Skipping ${(failed && failed.title ? failed.title : 'track')}`, 2500);
  setTimeout(() => { nextTrack(); }, 400);
});

audio.addEventListener('play', () => { setPlayIcons(true); paintRows(); if (state._failed) state._failed.clear(); });
audio.addEventListener('pause', () => { setPlayIcons(false); paintRows(); });
audio.addEventListener('loadedmetadata', () => { $('t-dur').textContent = fmt(audio.duration); $('np-dur').textContent = fmt(audio.duration); });
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = `${(audio.currentTime / audio.duration) * 100}%`;
  $('bar-fill').style.width = pct; $('np-bar-fill').style.width = pct;
  $('t-cur').textContent = fmt(audio.currentTime); $('np-cur').textContent = fmt(audio.currentTime);
});
audio.addEventListener('ended', nextTrack);
audio.addEventListener('error', () => { if (state.current) $('pb-title').textContent = `error: ${state.current.title}`; });

function setPlayIcons(playing) {
  $('toggle').innerHTML = playing ? IC.pause : IC.play;
  $('np-toggle').innerHTML = playing ? IC.pause : IC.play;
  $('mini-toggle').innerHTML = playing ? IC.pause : IC.play;
}

/* static markup icon bootstrap */
['shuffle','prev','toggle','next','repeat','mini-toggle','np-shuffle','np-prev','np-toggle','np-next','np-repeat'].forEach((id) => {
  const el = $(id); if (!el) return;
  const kind = id.replace('np-', '').replace('mini-', '');
  el.innerHTML = { shuffle: IC.shuffle, prev: IC.prev, toggle: IC.play, next: IC.next, repeat: IC.repeat }[kind] || IC.play;
});
$('pb-like').innerHTML = IC.heart;
$('mini-like').innerHTML = IC.heart;
$('np-like').innerHTML = IC.heart;
$('np-close').innerHTML = IC.chevDown;

/* ============ wiring ============ */
const seek = (barEl) => (e) => {
  const r = barEl.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * (audio.duration || 0);
};
$('bar').onclick = seek($('bar'));
$('np-bar').onclick = seek($('np-bar'));
/* iOS Safari ignores audio.volume (always 1). Keep the slider for desktop and Android,
   and on Apple platforms surface the truth: use the hardware buttons. */
const IOS_VOLUME_LOCKED = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function applyVolume(v) {
  const val = Math.max(0, Math.min(100, Number(v))) / 100;
  state.volume = val;
  applyLoudnessGain(state.current);
  audio.muted = val === 0;
  document.querySelectorAll('#vol, #np-vol').forEach((el) => { if (el && Number(el.value) !== Math.round(val * 100)) el.value = Math.round(val * 100); });
  document.querySelectorAll('#np-mute').forEach((b) => { b.classList.toggle('on', audio.muted); });
  try { localStorage.setItem('mf-volume', String(Math.round(val * 100))); } catch {}
}
$('vol').oninput = (e) => applyVolume(e.target.value);
$('np-vol').oninput = (e) => applyVolume(e.target.value);
$('np-mute').onclick = () => {
  const next = !audio.muted;
  audio.muted = next;
  if (!next && !IOS_VOLUME_LOCKED && audio.volume === 0) audio.volume = 0.9;
  $('np-mute').classList.toggle('on', next);
};
try {
  const saved = Number(localStorage.getItem('mf-volume') ?? 90);
  applyVolume(saved);
} catch { applyVolume(90); }
document.querySelectorAll('#vol, #np-vol').forEach((el) => {
  el.disabled = false;
  el.title = IOS_VOLUME_LOCKED ? 'iOS only honours the hardware volume buttons, but 0 mutes' : 'Volume';
});
/* no inline instructions: the slider mutes at zero, the buttons stay where they are */

$('toggle').onclick = togglePlay;
$('mini-toggle').onclick = togglePlay;
$('np-toggle').onclick = togglePlay;
$('next').onclick = nextTrack; $('np-next').onclick = nextTrack;
$('prev').onclick = prevTrack; $('np-prev').onclick = prevTrack;
$('shuffle').onclick = (e) => { state.shuffle = !state.shuffle; e.currentTarget.setAttribute('aria-pressed', state.shuffle); };
$('repeat').onclick = (e) => { state.repeat = !state.repeat; e.currentTarget.setAttribute('aria-pressed', state.repeat); };
$('np-shuffle').onclick = () => $('shuffle').click();
$('np-repeat').onclick = () => $('repeat').click();
$('pb-like').onclick = () => state.current && toggleLike(state.current);
$('np-like').onclick = () => state.current && toggleLike(state.current);
$('mini-like') && ($('mini-like').onclick = () => state.current && toggleLike(state.current));

document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { state.history = []; $('back').hidden = true; nav(b.dataset.nav); });
$('back').onclick = goBack;
$('pb-art').onclick = () => {
  const c = state.current;
  if (c && !c.ladder && c.album) { renderAlbum(c.album); return; }
  $('np').hidden = false;
};
$('pb-artist').onclick = () => { const c = state.current; if (c && c.artist) renderArtist(c.artist); };
const currentCtx = (x, y) => { if (state.current) openCtx(state.current, x, y); };
$('pb-menu').onclick = (e) => {
  e.stopPropagation();
  const r = $('pb-menu').getBoundingClientRect();
  currentCtx(r.left - 150, r.top - 8);
};
$('pb-title').onclick = (e) => { e.stopPropagation(); const r = $('pb-title').getBoundingClientRect(); currentCtx(r.left, r.bottom + 6); };
document.querySelector('.pb-left').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); currentCtx(e.clientX, e.clientY); };
document.querySelector('.pb-left').onclick = (e) => {
  if (e.target.closest('button') || e.target.closest('#pb-art') || e.target.closest('#pb-artist')) return;
  const r = document.querySelector('.pb-left').getBoundingClientRect();
  currentCtx(r.left + 20, Math.max(80, r.top - 240));
};
longPress(document.querySelector('.pb-left'), () => {
  const r = document.querySelector('.pb-left').getBoundingClientRect();
  currentCtx(r.left + 20, Math.max(80, r.top - 260));
});
$('np-artist').onclick = () => { const c = state.current; if (c && c.artist) renderArtist(c.artist); };
$('mini').onclick = (e) => { if (!e.target.closest('button')) $('np').hidden = false; };
$('mini').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); currentCtx(e.clientX, e.clientY); };
longPress($('mini'), () => {
  const r = $('mini').getBoundingClientRect();
  currentCtx(r.left + 16, Math.max(70, r.top - 250));
});
$('np-close').onclick = () => { $('np').hidden = true; };
$('np-art').oncontextmenu = (e) => { if (!state.current) return; e.preventDefault(); openCtx(state.current, e.clientX, e.clientY); };
$('np-art').onclick = (e) => {
  if (!state.current) return;
  e.stopPropagation();
  const b = $('np-art').getBoundingClientRect();
  openCtx(state.current, Math.min(b.left, innerWidth - 240), Math.min(b.bottom + 6, innerHeight - 260));
};
longPress($('np-art'), () => { if (state.current) openCtx(state.current, innerWidth / 2 - 110, innerHeight / 2 - 140); });
const npOpen = (open) => { $('np').hidden = !open; if (open) fitNowPlaying(); };
$('pb-art').addEventListener('click', () => setTimeout(fitNowPlaying, 30), true);
$('mini').addEventListener('click', () => setTimeout(fitNowPlaying, 30), true);
const closeQueue = () => {
  $('queue-drawer').hidden = true;
  document.getElementById('app').classList.remove('queue-open');
};
$('queue-btn').onclick = (e) => {
  e.stopPropagation();
  const d = $('queue-drawer');
  d.hidden = !d.hidden;
  document.getElementById('app').classList.toggle('queue-open', !d.hidden);
  if (!d.hidden) renderQueue();
};
$('queue-close').onclick = closeQueue;
// any click outside the drawer closes it so it never eats clicks on rows
document.addEventListener('click', (e) => {
  const d = $('queue-drawer');
  if (!d || d.hidden) return;
  if (!d.contains(e.target) && !e.target.closest('#queue-btn')) closeQueue();
});

/* selection bar actions live on the inline bar, see renderSelectionBar */

/* add many tracks to a playlist, with a picker */
function openAddPlIds(ids) {
  ctxOpenedAt = Date.now();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Add ${ids.length} to playlist</div>` +
    state.playlists.map((p) => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    m.classList.remove('open'); m.style.transform = ''; m.onclick = null;
    await addTracksToPlaylist(b.dataset.pl, ids);
    clearSelection();
  };
}

/* upload local audio files */
async function uploadTrack(file) {
  const r = await fetch(`/api/upload/track?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  const d = await r.json();
  if (!r.ok || !d.track) throw new Error(d.error || 'upload failed');
  return d;
}

async function uploadFiles(files) {
  const total = files.length;
  let ok = 0;
  let failed = 0;
  toast(`Uploading ${total} file${total > 1 ? 's' : ''}`);
  for (let i = 0; i < total; i += 1) {
    const f = files[i];
    toast(`Uploading ${i + 1} of ${total}: ${f.name.slice(0, 34)}`, 60000);
    try { await uploadTrack(f); ok += 1; }
    catch (e) { failed += 1; }
  }
  state.allTracks = null;
  bustCache();
  toast(failed ? `Added ${ok}, ${failed} failed` : `Added ${ok} track${ok > 1 ? 's' : ''}`, 8000);
  refreshView();
}

function pickFile(accept, onFile) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) onFile(f); inp.remove(); };
  document.body.appendChild(inp);
  inp.click();
}

// several files at once, or a whole folder
function pickFiles(accept, onFiles, { directory = false } = {}) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.multiple = true;
  if (directory) { inp.webkitdirectory = true; inp.directory = true; }
  inp.style.display = 'none';
  inp.onchange = () => {
    const files = [...(inp.files || [])].filter((f) => /\.(mp3|flac|m4a|aac|ogg|opus|wav|aiff?)$/i.test(f.name));
    if (files.length) onFiles(files);
    inp.remove();
  };
  document.body.appendChild(inp);
  inp.click();
}

async function uploadTrackCover(id) {
  pickFile('image/*', async (file) => {
    const r = await fetch(`/api/tracks/${id}/cover`, { method: 'POST', body: file });
    if (r.ok) { state.artV = Date.now(); toast('Cover updated'); refreshView(); }
    else toast('Cover upload failed');
  });
}

async function uploadPlaylistCover(pid) {
  pickFile('image/*', async (file) => {
    const r = await fetch(`/api/playlists/${encodeURIComponent(pid)}/cover`, { method: 'POST', body: file });
    if (r.ok) { state.artV = Date.now(); toast('Playlist cover updated'); await loadPlaylists(); refreshView(); }
    else toast('Cover upload failed');
  });
}

document.addEventListener('scroll', () => { const m = $('ctx'); if (m && m.classList.contains('open')) m.classList.remove('open'); }, true);
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight') nextTrack();
  if (e.key === 'ArrowLeft') prevTrack();
  if (e.key === 'Escape') { closeCtx(); $('queue-drawer').hidden = true; }
});

/* ============ boot ============ */
async function loadPlaylists() {
  state.playlists = await api('/api/playlists', { nocache: true });
  $('pl-count').textContent = state.playlists.length;
  renderSidebar();
}
(async () => {
  try {
    try { primeFromCache(); } catch {}
    try { restoreQueue(); } catch {}
    try { const s = await api('/api/settings', { nocache: true }); state.settings = s.settings || {}; } catch { state.settings = {}; }
    await loadPlaylists();
    syncLikes();
    paintPill();
    renderHome();
  } catch (e) {
    $('view').innerHTML = `<div class="empty">core unreachable: ${esc(e.message)}</div>`;
  }
})();
