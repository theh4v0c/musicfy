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
  offlineIds: new Set(),
};

const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// rung display: short labels, stable classes for color coding
function shortRung(rung) {
  switch ((rung || 'local').toLowerCase()) {
    case 'local': return { label: 'Local', cls: 'local' };
    case 'yt-dlp': case 'youtube': return { label: 'YT', cls: 'yt' };
    case 'soundcloud': return { label: 'SC', cls: 'sc' };
    case 'archive': return { label: 'WEB', cls: 'archive' };
    default: return { label: String(rung || 'Local'), cls: 'local' };
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
// deterministic gradient from a seed, so every placeholder has its own colour, not a flat box
function gradFor(seed) {
  const s = String(seed || '?');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = Math.abs(h) % 360;
  const b = (a + 30 + (Math.abs(h >> 9) % 90)) % 360;
  const l1 = 40 + (Math.abs(h >> 3) % 14);
  const l2 = 16 + (Math.abs(h >> 5) % 10);
  return `linear-gradient(135deg, hsl(${a} 58% ${l1}%), hsl(${b} 52% ${l2}%))`;
}
const ph = (t, cls) => {
  const seed = t ? `${t.artist || ''}${t.title || ''}` : '?';
  const letter = (t ? (t.title || '?') : '?').charAt(0).toUpperCase();
  return `<div class="${cls} ph" style="background:${gradFor(seed)};color:rgba(255,255,255,.9)">${esc(letter)}</div>`;
};
// uniform artwork setter: always a div with a background image, never a stale <img src>
function setArt(elId, url, letter) {
  const el = $(elId); if (!el) return;
  const base = (el.className || '').replace(/\bph\b/g, '').trim();
  if (url) {
    el.outerHTML = `<div id="${elId}" class="${base}" style="background-image:url('${url}');background-size:cover;background-position:center"></div>`;
  } else {
    el.outerHTML = `<div id="${elId}" class="${base} ph" style="background:${gradFor(letter || '?')};color:rgba(255,255,255,.9)">${esc((letter || '?').charAt(0).toUpperCase())}</div>`;
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
  // no request may hang the interface forever
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 60000);
  let r;
  try {
    r = await fetch(p, { signal: ctl.signal, ...(opts || {}) });
  } catch (e) {
    if (cached) return cached.body;
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  m.classList.add('open'); markCtxOpen();
  m.style.left = Math.max(8, innerWidth / 2 - 160) + 'px';
  m.style.top = '12%';
  m.onclick = null;
  m.querySelector('#rn-cancel').onclick = () => closeCtx(true);
  m.querySelector('#rn-save').onclick = async () => {
    const body = {
      title: m.querySelector('#rn-title').value.trim(),
      artist: m.querySelector('#rn-artist').value.trim(),
      album: m.querySelector('#rn-album').value.trim(),
    };
    try {
      const r = await api(`/api/tracks/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.error) return toast(r.error, 6000);
      closeCtx(true);
      state.allTracks = null;
      bustCache();
      toast('Renamed', 4000);
      refreshView();
    } catch { toast('Could not rename', 4000); }
  };
}

function openCtx(t, x, y) {
  markCtxOpen();
  ctxTarget = t;
  const m = $('ctx');
  const liked = isLiked(t);
  m.innerHTML = `
    <button data-act="play">${IC.play} Play</button>
    <button data-act="next">&#8594; Play next</button>
    <button data-act="queue">&#43; Add to queue</button>
    ${t.album ? '<button data-act="goalbum">Go to album</button>' : ''}
    ${t.artist ? '<button data-act="goartist">Go to artist</button>' : ''}
    <div class="ctx-sep"></div>
    <button data-act="like">${liked ? IC.heart + ' Remove from Liked Songs' : IC.heartFull + ' Save to Liked Songs'}</button>
    ${hasAudio(t) ? '' : '<button data-act="dl">Download this track</button>'}
    ${hasAudio(t) ? '<button data-act="cover">Change cover</button>' : ''}
    ${(hasAudio(t) && Number(t.bitrate || 0) > 0 && Number(t.bitrate) < 180000) ? '<button data-act="upgrade">Find higher quality</button>' : ''}
    ${hasAudio(t) ? '<button data-act="tofile">Download to device</button>' : ''}
    ${hasAudio(t) ? `<button data-act="analyze">${t.bpm ? 'Re-analyze' : 'Analyze'} BPM &amp; key</button>` : ''}
    ${hasAudio(t) ? '<button data-act="tags">Write Traktor tags</button>' : ''}
    ${hasAudio(t) ? `<button data-act="offline">${state.offlineIds && state.offlineIds.has(t.id) ? 'Remove from offline' : 'Save for offline'}</button>` : ''}
    <button data-act="addpl">Add to playlist</button>
    ${state.view === 'playlist' && state.playlistId ? '<button data-act="rmpl">Remove from this playlist</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="rename">Rename track</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="repair">Fix metadata</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="deltrack">Delete from library</button>' : ''}
    <button data-act="radiostart">Start track radio</button>`;
  m.classList.add('open');
  placeCtx(x, y);
}
// keep the sheet fully on screen, even when it is taller than the space below the finger
function placeCtx(x, y) {
  const m = $('ctx');
  if (!m) return;
  const r = m.getBoundingClientRect();
  const maxH = Math.max(160, innerHeight - 24);
  m.style.maxHeight = maxH + 'px';
  const h = m.getBoundingClientRect().height;
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
}
function showBack() {}
function closeCtx(force = false) {
  const el = $('ctx');
  // never yank the sheet away from someone who is typing in it, whoever asked
  const active = document.activeElement;
  if (!force && active && el.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
  // a preview or media element must stop when the sheet closes
  try { el.querySelectorAll('audio, video').forEach((a) => { a.pause(); a.removeAttribute('src'); a.load(); }); } catch {}
  el.classList.remove('open');
  el.onclick = null;
  el.style.transform = '';
  const bg = $('ctx-bg');
  if (bg) bg.hidden = true;
}
// every sheet sits above a full screen transparent backdrop; the backdrop is the only
// thing that dismisses it, so an outside tap can neither miss nor hit the page below
let ctxOpenedAt = 0;
let ctxOpenedByTouch = false;
function markCtxOpen() {
  ctxOpenedAt = Date.now();
  ctxOpenedByTouch = Date.now() - lastTouchAt < 1500;
  const bg = $('ctx-bg');
  if (bg) bg.hidden = false;
}
// safety net for browsers that still emit a click on the lift of a long press: the menu
// has just appeared under the finger, so a click in the first 350ms is not a real choice.
// A mouse-opened menu is never guarded: right click then click is a normal, fast action.
$('ctx').addEventListener('click', (e) => {
  if (ctxOpenedByTouch && Date.now() - ctxOpenedAt < 350) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });

let lastTouchAt = 0;
document.addEventListener('touchstart', () => { lastTouchAt = Date.now(); }, { capture: true, passive: true });
// iOS still raises contextmenu during a long press. It must not re-open or reposition a
// sheet that the long press already opened, so only a real mouse right click uses it.
document.addEventListener('contextmenu', (e) => {
  // a long press owns its own gesture; iOS still raises contextmenu for it
  if (Date.now() - lastTouchAt < 1500) { e.preventDefault(); e.stopPropagation(); return; }
  const row = e.target.closest('.trow, .tcard');
  if (!row) return;
  e.preventDefault();
  const el = $('ctx');
  if (el && el.classList.contains('open')) return;
  const t = findTrack(row);
  if (t) openCtx(t, e.clientX, e.clientY);
}, true);

// backdrop dismissal: pointer/touch down, so the closing tap can never leak through
(() => {
  const bg = $('ctx-bg');
  if (!bg) return;
  const dismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCtx(true);
  };
  bg.addEventListener('touchstart', dismiss, { passive: false });
  bg.addEventListener('mousedown', dismiss);
  bg.addEventListener('click', dismiss);
})();

$('ctx').addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act || !ctxTarget) return;
  const t = ctxTarget; closeCtx();
  if (act === 'play') playList([t], 0);
  if (act === 'next') { state.queue.splice(state.qi + 1, 0, t); toast('Playing next'); }
  if (act === 'queue') { state.queue.push(t); toast('Added to queue'); }
  if (act === 'goalbum' && t.album) { renderAlbum(t.album); return; }
  if (act === 'goartist' && t.artist) { renderArtist(t.artist); return; }
  if (act === 'like') toggleLike(t);
  if (act === 'addpl') openAddPl(t);
  if (act === 'radiostart') startRadio(t);
  if (act === 'analyze') {
    const pp = progressPill(`Analyzing ${t.title || 'track'}…`);
    try {
      const r = await api(`/api/analyze/track/${t.id}`, { method: 'POST', nocache: true });
      pp.done();
      if (r.error) return toast(r.error, 6000);
      const bpmTxt = r.bpm ? `${Math.round(r.bpm)} BPM` : 'BPM n/a';
      const keyTxt = r.key ? `${r.key}${r.key_scale === 'minor' ? 'm' : ''}` : 'key n/a';
      toast(`Analysed · ${bpmTxt} · ${keyTxt}`, 6000);
      state.allTracks = null; afterWrite(); refreshView();
    } catch { pp.done(); toast('Analysis failed', 5000); }
    return;
  }
  if (act === 'tags') {
    try {
      const dry = await api(`/api/tracks/${t.id}/tags?dryRun=1`, { method: 'POST', nocache: true });
      if (dry.error) return toast(dry.error, 6000);
      const ok = confirm(`Write Traktor + ID3 tags into the file?\n\n${dry.file}\nFrames: ${(dry.frames || []).join(', ')}\n\nA .mf.bak backup is kept once.`);
      if (!ok) return;
      const pp = progressPill('Writing tags…');
      const r = await api(`/api/tracks/${t.id}/tags`, { method: 'POST' });
      pp.done();
      if (r.error) return toast(r.error, 6000);
      toast('Tags written. Open the file in Traktor to see BPM, key and cues.', 5000);
    } catch { toast('Could not write tags', 4000); }
    return;
  }
  if (act === 'offline') {
    if (!('serviceWorker' in navigator)) { toast('Offline playback needs HTTPS — open the Pangolin URL', 6000); return; }
    const on = !(state.offlineIds && state.offlineIds.has(t.id));
    postToSw(on ? { type: 'cache-track', id: t.id } : { type: 'uncache-track', id: t.id });
    toast(on ? 'Saving for offline…' : 'Removed from offline', 4000);
    return;
  }
    if (act === 'upgrade') {
      closeCtx();
      try {
        const r = await api(`/api/tracks/${t.id}/download`, { method: 'POST' });
        if (!r.job) { toast('Could not queue an upgrade', 4000); return; }
        const pp = progressPill(`Checking for a better copy of ${(t.title || 'track').slice(0, 40)}…`);
        const j = await pollJob(r.job, (job) => { if (job && job.progress) pp.update(`Checking… ${Math.round(job.progress)}%`); });
        pp.done();
        if (!j) { toast('Upgrade is still running in the background', 6000); return; }
        if (j.state === 'done' && /kept the higher quality/i.test(j.detail || '')) {
          toast('No better copy found — your current file is the best available', 7000);
          return;
        }
        if (j.state === 'done') {
          toast('Upgraded to a better copy', 6000);
          bustCache(); state.allTracks = null; refreshView();
          return;
        }
        toast(`No better copy: ${(j.detail || j.state || 'unavailable').slice(0, 80)}`, 7000);
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
  const host = $('toasts');
  // never let a burst of toasts fill the screen
  while (host.children.length >= 4) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), Math.max(600, ms - 400));
  setTimeout(() => el.remove(), ms);
  return el;
}
// one toast that updates in place, for long multi-file work
function toastPersistent(initial) {
  const host = $('toasts');
  let el = document.getElementById('mf-toast-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mf-toast-status';
    el.className = 'toast';
    host.appendChild(el);
  }
  el.classList.remove('out');
  el.textContent = initial;
  return {
    update(t) { el.textContent = t; },
    done(finalMsg, ms = 6000) {
      el.textContent = finalMsg;
      el.classList.add('out');
      setTimeout(() => el.remove(), Math.max(600, ms));
    },
  };
}

// a persistent pill with an animated gradient fill, for work that takes a while
function progressPill(text) {
  let el = document.getElementById('mf-progress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mf-progress';
    el.className = 'progress-pill';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(text)}</span><i></i>`;
  el.classList.add('on');
  return {
    update(t) { const s = el.querySelector('span'); if (s) s.textContent = t; },
    done() { el.classList.remove('on'); },
  };
}

/* ============ add to playlist ============ */
function openAddPl(t) {
  markCtxOpen();
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
    closeCtx(true); m.style.transform = ''; m.onclick = null;
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
  // the library size is only useful where you manage the library; everywhere else it is noise
  const pill = $('pill'); if (pill) pill.hidden = !(v === 'library' || v === 'settings');
}
function nav(v, push = true) {
  closeInlinePreview();
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
  else if (v === 'djexport') renderDjExport();
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
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc(p.name)}</div>
    <button data-act="pl-play">Play</button>
    <button data-act="pl-rename">Rename</button>
    <button data-act="pl-cover">Change cover</button>
    <button data-act="pl-m3u">Export M3U</button>
    <button data-act="pl-rb">Export for Rekordbox (.xml)</button>
    <button data-act="pl-tr">Export for Traktor (.nml)</button>
    <button data-act="pl-usb">Export for CDJ USB</button>
    <button data-act="pl-tags">Write Traktor tags (crate)</button>
    <button data-act="pl-zip">Download to device (zip)</button>
    <button data-act="pl-delete">Delete playlist</button>`;
  m.classList.add('open');
  placeCtx(x, y);
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    closeCtx(true); m.onclick = null;
    if (act === 'pl-play') { playPlaylist(p.id); return; }
    if (act === 'pl-cover') { uploadPlaylistCover(p.id); return; }
    if (act === 'pl-m3u') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export.m3u`; return; }
    if (act === 'pl-rb') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/rekordbox.xml`; return; }
    if (act === 'pl-tr') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/traktor.nml`; return; }
    if (act === 'pl-usb') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/pioneer.zip`; return; }
    if (act === 'pl-tags') {
      try {
        const dry = await api(`/api/playlists/${encodeURIComponent(p.id)}/tags?dryRun=1`, { method: 'POST' });
        const ok = (dry.results || []).filter((r) => !r.skipped && !r.error).length;
        if (!ok) { toast('No MP3s to tag in this crate', 4000); return; }
        if (!confirm(`Write Traktor + ID3 tags into ${ok} file(s)?\n\nA .mf.bak backup is kept once per file.`)) return;
        const pp = progressPill(`Tagging ${ok} files…`);
        const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/tags`, { method: 'POST' });
        pp.done();
        toast(`Tagged ${r.count} files`, 5000);
      } catch { toast('Could not write tags', 4000); }
      return;
    }
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
// wires both gesture and mouse: long press on a phone, right click on a desktop
// simple action list for cards: desktop right click or phone long press
function openCardMenu(title, actions, x, y) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc(title)}</div>` +
    actions.map((a, i) => `<button data-ci="${i}">${esc(a.label)}</button>`).join('');
  m.classList.add('open');
  placeCtx(x, y);
  m.onclick = async (e) => {
    const b = e.target.closest('button[data-ci]');
    if (!b) return;
    const a = actions[Number(b.dataset.ci)];
    closeCtx(true);
    m.onclick = null;
    try { await a.run(); } catch { toast('That did not work', 4000); }
  };
}

function bindContext(el, fn) {
  el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); fn(e.clientX || 0, e.clientY || 0); };
  longPress(el, () => {
    const b = el.getBoundingClientRect();
    fn(Math.min(b.left, innerWidth - 240), Math.min(b.bottom + 6, innerHeight - 260));
  });
  return el;
}

let activeLongPressTimer = null;
function longPress(el, fn, holdMs = 500) {
  let t = null, fired = false, ox = 0, oy = 0, suppressUntil = 0;
  const cancel = () => { clearTimeout(t); t = null; activeLongPressTimer = null; };
  const start = (e) => {
    const p = (e.touches && e.touches[0]) || e;
    ox = p.clientX || 0; oy = p.clientY || 0;
    fired = false;
    cancel();
    t = setTimeout(() => {
      t = null;
      fired = true;
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
      fn();
    }, holdMs);
    activeLongPressTimer = t;
  };
  const move = (e) => {
    if (!t) return;
    const p = (e.touches && e.touches[0]) || e;
    // any real movement means the finger is scrolling, not holding (a resting thumb drifts
    // a little, so only a deliberate drag cancels)
    if (Math.abs((p.clientX || 0) - ox) > 14 || Math.abs((p.clientY || 0) - oy) > 14) cancel();
  };
  // the lift that opened the sheet must not also produce a click on whatever is now under
  // the finger (usually a menu item). cancel the gesture at source, on this element.
  const end = (e) => {
    if (fired) {
      suppressUntil = Date.now() + 700;
      fired = false;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    cancel();
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', () => { fired = false; cancel(); }, { passive: true });
  el.addEventListener('click', (e) => {
    if (fired || Date.now() < suppressUntil) { fired = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
}
// a long press must never fire while the page is scrolling
window.addEventListener('scroll', () => { if (activeLongPressTimer) { clearTimeout(activeLongPressTimer); activeLongPressTimer = null; } }, true);

/* ============ views ============ */
const greetPart = () => { const h = new Date().getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

function heroBanner(kicker, title, sub) {
  return `<div class="prep-hero"><div class="prep-kicker">${esc(kicker)}</div><div class="prep-title">${esc(title)}</div><p class="prep-sub">${esc(sub)}</p></div>`;
}

async function renderHome() {
  setNav('home'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = 'Home';
  const v = $('view');
  v.innerHTML = `
    <div class="hero-greet">Good ${greetPart()}.</div>
    <div class="hero-sub">${state.playlists.length} playlists</div>
    <div class="hero-actions"><button class="btn btn-primary" id="flow-btn">&#9654; Flow</button><span class="flow-hint">endless mix from what you play</span></div>
    <div class="quicktiles" id="quick"></div>
    <div id="rotation-slot"></div>
    <div id="discover-home"></div>
    <div class="sec-title">Recently played <small id="recent-hint"></small></div>
    <div class="row-scroller" id="recent-row"></div>
    <div class="sec-title">Your playlists <small>${state.playlists.length} TOTAL</small></div>
    <div class="pgrid" id="home-grid"></div>`;
  // personalised greeting: name from settings, time of day, live weather
  api('/api/greeting', { nocache: true }).then((g) => {
    const greet = v.querySelector('.hero-greet');
    const sub = v.querySelector('.hero-sub');
    if (greet) greet.textContent = g.name ? `Good ${g.part}, ${g.name}!` : `Good ${g.part}.`;
    if (sub) sub.textContent = g.sub || [g.fact, g.line].filter(Boolean).join(' · ');
  }).catch(() => {});
  drawQuick();
  const fb = $('flow-btn');
  if (fb) fb.onclick = async () => {
    fb.disabled = true;
    try {
      const d = await api('/api/flow?discovery=30', { nocache: true });
      if (!d.tracks || !d.tracks.length) { toast('Play a few tracks first so Flow can learn your taste'); return; }
      playList(d.tracks, 0, false, 'Flow');
    } catch { toast('Flow failed'); }
    fb.disabled = false;
  };
  const g = $('home-grid');
  for (const p of state.playlists) g.appendChild(pcard(p));
  renderDiscoverInto($('discover-home'));
  const rec = await loadRecentlyPlayed();
  drawRecents(rec);
  drawRotation(rec);
}

// discovery rails: newest, more-from-artists-you-play, and unfiled tracks
async function renderDiscoverInto(host) {
  if (!host) return;
  try {
    const d = await api('/api/discover', { nocache: true });
    if (!document.body.contains(host)) return;
    const rails = [
      ['Fresh in your library', 'NEWEST FIRST', d.recent, 'Fresh in your library'],
      ['More from artists you play', 'NOT YET HEARD', d.deeper, 'More from artists you play'],
      ['Not in any playlist', 'UNFILED', d.unplaylisted, 'Not in any playlist'],
    ];
    const seen = new Set();
    for (const [title, tag, list, origin] of rails) {
      const fresh = (list || []).filter((t) => t && t.id != null && !seen.has(t.id)).slice(0, 12);
      if (!fresh.length) continue;
      fresh.forEach((t) => seen.add(t.id));
      const h = document.createElement('div');
      h.className = 'sec-title';
      h.innerHTML = `${esc(title)} <small>${esc(tag)}</small>`;
      host.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row-scroller';
      for (const t of fresh) row.appendChild(trackCard(t, fresh, origin));
      host.appendChild(row);
    }
    if (!host.querySelector('.tcard')) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing to surface yet. Add tracks or play a few, and this fills in.';
      host.appendChild(e);
    }
  } catch {}
}

// Ask discovery: music in the same lane that is NOT in the library, with a one-tap fetch
async function renderExternalInto(host) {
  if (!host) return;
  host.innerHTML = '';
  try {
    const d = await api('/api/discover/outside', { nocache: true });
    if (!document.body.contains(host)) return;
    const groups = d.groups || [];
    if (!groups.length) return;
    for (const g of groups) {
      const h = document.createElement('div');
      h.className = 'sec-title';
      h.innerHTML = `Because you play ${esc(g.label)} <small>NOT IN YOUR LIBRARY</small>`;
      host.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row-scroller';
      for (const s of g.songs) {
        const card = document.createElement('div');
        card.className = 'tcard';
        card.innerHTML = `<div class="tcard-art ph" style="background:${gradFor((s.artist || '') + (s.title || ''))};color:rgba(255,255,255,.9)">${esc((s.artist || '?').charAt(0))}</div>
          <div class="tcard-name">${esc(s.title)}</div>
          <div class="tcard-sub">${esc(s.artist)}</div>
          <button class="tcard-play" title="Preview before downloading" aria-label="Preview before downloading">${IC.play}</button>`;
        if (s.cover) {
          const art = card.querySelector('.tcard-art');
          art.style.backgroundImage = `url("${s.cover}")`;
          art.style.backgroundSize = 'cover';
          art.style.backgroundPosition = 'center';
          art.textContent = '';
        }
        card.style.cursor = 'pointer';
        const preview = (e) => { if (e) e.stopPropagation(); toggleSuggestionPreview(s, card); };
        card.onclick = preview;
        card.querySelector('.tcard-play').onclick = preview;
        row.appendChild(card);
      }
      host.appendChild(row);
    }
  } catch {}
}

/* the algorithm, visible: radio built from what you actually played */
/* a suggestion is auditioned before it is downloaded: cover, details, 30s preview */
let inlinePreview = null;
function closeInlinePreview() {
  if (!inlinePreview) return;
  const a = inlinePreview.querySelector('audio');
  if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch {} }
  inlinePreview.remove();
  inlinePreview = null;
}
function toggleSuggestionPreview(s, anchor, opts = {}) {
  const key = `${s.title || ''}|${s.artist || ''}`;
  if (inlinePreview && inlinePreview.dataset.key === key) { closeInlinePreview(); return; }
  closeInlinePreview();
  const owned = !!(opts.owned || s.owned);
  const panel = document.createElement('div');
  panel.className = 'inline-preview';
  panel.dataset.key = key;
  const mins = s.duration ? `${Math.floor(s.duration / 60)}:${String(Math.round(s.duration % 60)).padStart(2, '0')}` : '';
  panel.innerHTML = `<div class="ip-art"></div>
    <div class="ip-meta"><b>${esc(s.title || '')}</b><span>${esc(s.artist || '')}${s.album ? ` · ${esc(s.album)}` : ''}${mins ? ` · ${mins}` : ''}</span></div>
    <div class="ip-actions"><button class="btn btn-primary" data-dl${owned ? ' disabled' : ''}>${owned ? 'In your library' : 'Download'}</button><button class="btn btn-ghost" data-close>Close</button></div>
    ${s.preview ? `<audio class="ip-audio" controls preload="none" src="${esc(s.preview)}"></audio>` : (s.owned && s.id ? `<audio class="ip-audio" controls preload="none" src="/api/stream/${s.id}"></audio>` : '<div class="ip-note">Finding a preview…</div>')}`;
  const art = panel.querySelector('.ip-art');
  if (s.cover) art.style.backgroundImage = `url("${s.cover}")`;
  const cardHost = anchor.closest('.ask-action');
  const shelf = anchor.closest('.row-scroller');
  if (cardHost) cardHost.insertAdjacentElement('afterend', panel);
  else if (shelf) shelf.insertAdjacentElement('afterend', panel);
  else anchor.insertAdjacentElement('afterend', panel);
  inlinePreview = panel;
  panel.querySelector('[data-close]').onclick = closeInlinePreview;
  let audioEl = panel.querySelector('audio');
  if (audioEl) audioEl.play().catch(() => {});
  const noteEl = panel.querySelector('.ip-note');
  if (!audioEl && noteEl) {
    api(`/api/preview?title=${encodeURIComponent(s.title || '')}&artist=${encodeURIComponent(s.artist || '')}&duration=${Number(s.duration) || ''}`, { nocache: true })
      .then((r) => {
        if (inlinePreview !== panel) return;
        if (!r || !r.url) { noteEl.textContent = 'No preview available.'; return; }
        audioEl = document.createElement('audio');
        audioEl.className = 'ip-audio';
        audioEl.controls = true;
        audioEl.preload = 'none';
        audioEl.src = r.url;
        noteEl.replaceWith(audioEl);
        audioEl.play().catch(() => {});
      })
      .catch(() => { if (inlinePreview === panel) noteEl.textContent = 'No preview available.'; });
  }
  const dl = panel.querySelector('[data-dl]');
  dl.onclick = async () => {
    if (owned) return;
    dl.disabled = true;
    try {
      const r = s.id
        ? await api(`/api/tracks/${s.id}/download`, { method: 'POST' })
        : await api('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rung: 'search', title: s.title, artist: s.artist, duration: s.duration }) });
      closeInlinePreview();
      toast(`Fetching ${s.title}`, 4000);
      openDownloads();
      if (r.job) waitForJob(r.job, s.title);
    } catch { dl.disabled = false; toast('Could not start', 3000); }
  };
}

/* right click menu for a ladder candidate: stream it, keep it in a playlist, or download it */
function openLadderCtx(c, x, y) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc((c.title || '').slice(0, 40))}</div>
    <button data-act="l-play">Play now</button>
    <button data-act="l-add">Add to playlist (stream)</button>
    <button data-act="l-dl">Download to library</button>`;
  m.classList.add('open');
  placeCtx(x, y);
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    closeCtx(true); m.onclick = null;
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
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Add "${esc((c.title || '').slice(0, 28))}" to</div>` +
    state.playlists.map((p) => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeCtx(true); m.style.transform = ''; m.onclick = null;
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
  const hint = $('recent-hint');
  if (!row || !hint) return; // the view changed while we were waiting
  if (!rec || !rec.length) { hint.textContent = 'PLAY SOMETHING AND IT LANDS HERE'; return; }
  hint.textContent = '';
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
          <button class="btn btn-ghost" id="pl-harm" title="Order by harmonic key progression (Camelot)">Harmonic</button>
          <button class="btn btn-ghost" id="pl-upload">Upload tracks</button>
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
      <div></div>
      <div>SOURCE</div>
      <div class="th" data-key="duration" style="text-align:right">TIME</div>
      <div></div>
    </div>
    <div id="tlist"></div>`;
  const list = await api(`/api/playlists/${encodeURIComponent(pid)}`);
  const plnEl = $('pln'); const pldurEl = $('pldur');
  if (!plnEl || !pldurEl) return; // navigated away
  state._currentList = list;
  plnEl.textContent = list.length;
  const totalS = list.reduce((a, t) => a + (t.duration || 0), 0);
  pldurEl.textContent = list.length ? `${Math.round(totalS / 60)} min` : '';
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
    sorted.forEach((t, i) => {
      registerRow(t);
      const row = trow(t, i, sorted);
      // drag to reorder, only when the list is shown in its stored order
      if (state.sort.key === 'pos') {
        row.ondragover = (e) => {
          if (!e.dataTransfer.types.includes('application/x-musicfy')) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('dragover');
        };
        row.ondragleave = () => row.classList.remove('dragover');
        row.ondrop = async (e) => {
          if (!e.dataTransfer.types.includes('application/x-musicfy')) return;
          e.preventDefault(); e.stopPropagation();
          row.classList.remove('dragover');
          let ids = [];
          try { ids = JSON.parse(e.dataTransfer.getData('application/x-musicfy')); } catch { return; }
          if (!Array.isArray(ids) || !ids.length || ids.includes(t.id)) return;
          const next = sorted.map((x) => x.id).filter((id) => !ids.includes(id));
          const at = next.indexOf(t.id);
          next.splice(at < 0 ? next.length : at, 0, ...ids);
          try {
            await api(`/api/playlists/${encodeURIComponent(pid)}/reorder`, {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: next }),
            });
            const byId = new Map(list.map((x) => [x.id, x]));
            list.length = 0;
            for (const id of next) { const x = byId.get(id); if (x) list.push(x); }
            renderRows();
          } catch { toast('Could not reorder', 3000); }
        };
      }
      tl.appendChild(row);
    });
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
  const upBtn = $('pl-upload');
  if (upBtn) upBtn.onclick = () => pickFiles('audio/*', async (files) => {
    const total = files.length;
    let ok = 0;
    const t = toastPersistent(`Uploading ${total} file${total > 1 ? 's' : ''} to this playlist…`);
    for (let i = 0; i < total; i += 1) {
      t.update(`Uploading ${i + 1} of ${total}: ${files[i].name.slice(0, 30)}`);
      try {
        const d = await uploadTrack(files[i]);
        await api(`/api/playlists/${encodeURIComponent(pid)}/tracks`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track_id: d.track }),
        });
        ok += 1;
      } catch {}
    }
    state.allTracks = null; bustCache(); await loadPlaylists();
    t.done(`Added ${ok} of ${total} track${total === 1 ? '' : 's'} to this playlist`, 6000);
    openPlaylist(pid, false);
  });
  const harmBtn = $('pl-harm');
  if (harmBtn) harmBtn.onclick = async () => {
    harmBtn.disabled = true;
    try {
      const r = await api(`/api/playlists/${encodeURIComponent(pid)}/harmonic`, { method: 'POST' });
      const fresh = await api(`/api/playlists/${encodeURIComponent(pid)}`, { nocache: true });
      list.length = 0; for (const x of fresh) list.push(x);
      state._currentList = list;
      state.sort = { key: 'pos', dir: 1 };
      renderRows();
      toast(`Ordered ${r.count} tracks harmonically`, 3000);
    } catch { toast('Could not order', 3000); }
    harmBtn.disabled = false;
  };
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
      <div class="plhead-art ph liked-art" style="background:linear-gradient(135deg,#ff6b47,#8a1d12)">${IC.heartFull}</div>
      <div>
        <div class="plhead-kicker">PLAYLIST</div>
        <h1 class="plhead-name">Liked Songs</h1>
        <div class="plhead-meta"><b id="likn">...</b> songs</div>
        <div class="plhead-actions"><button class="btn btn-primary" id="lik-play">${IC.play}&nbsp; Play</button></div>
      </div></div>
    <div id="liklist"></div>`;
  const list = await api('/api/likes/full');
  const liknEl = $('likn'); const el = $('liklist');
  if (!liknEl || !el) return; // navigated away
  state._currentList = list;
  liknEl.textContent = list.length;
  if (!list.length) { el.innerHTML = `<div class="empty">Nothing liked yet. Heart something from any playlist.</div>`; return; }
  list.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
  const lp = $('lik-play'); if (lp) lp.onclick = () => playList(list, 0, false, 'Liked Songs');
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
  v.innerHTML = `${heroBanner('LIBRARY', 'Your Library', 'Everything you own, and every playlist.')}<div class="lib-actions">
      <button class="btn btn-primary" id="lib-upload">Upload track</button>
      <button class="btn btn-ghost" id="lib-newpl">New playlist</button>
      <button class="btn btn-ghost" id="hist-import">Playlist from most-played</button>
      <button class="btn btn-ghost" id="meta-repair">Repair metadata</button>
    </div>
    <details class="advanced">
      <summary>Advanced &amp; maintenance</summary>
      <div class="lib-actions">
        <span class="meta-line" id="cache-pill">cache -</span>
        <button class="btn btn-ghost" id="cache-clear">Clear cache</button>
        <span class="meta-line" id="rung-health">sources -</span>
        <label class="auto-save" title="Save a track to disk automatically after it is played this many times. 0 turns it off.">
          Auto-save after <input id="auto-dl" class="mini-num" type="number" min="0" max="20" value="2"> plays
        </label>
      </div>
    </details>
    <div class="sec-title" style="margin-top:0">Playlists <small>${state.playlists.length} TOTAL</small></div>${orderControls()}<div class="pgrid" id="lib-grid"></div>`;
  const g = $('lib-grid');
  const liked = document.createElement('div');
  liked.className = 'pcard';
  liked.innerHTML = `<div class="pcard-art ph liked-art" style="background:linear-gradient(135deg,#ff6b47,#8a1d12)">${IC.heartFull}</div><div class="pcard-name">Liked Songs</div><div class="pcard-sub">${state.liked.size} songs</div><button class="pcard-play">${IC.play}</button>`;
  liked.querySelector('.pcard-play').onclick = (e) => { e.stopPropagation(); playLiked(); };
  liked.onclick = () => nav('liked');
  g.appendChild(liked);
  for (const p of sortedPlaylists().filter(matchesPlFilter)) g.appendChild(pcard(p));
  bindOrderControls(() => renderLibrary());
  const paintCache = () => {
    const s = cacheSize();
    const el = $('cache-pill');
    if (el) el.textContent = `${(s.bytes / 1024).toFixed(0)} KB cached · ${s.keys} items`;
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
    const el = $('rung-health');
    if (!el) return;
    const parts = Object.entries(h.rungs || {}).map(([k, v]) => `${k} ${v.ok ? 'ok' : 'down'}`);
    el.textContent = parts.length ? `sources: ${parts.join(', ')}` : 'sources: -';
    el.classList.toggle('warn', Object.values(h.rungs || {}).some((v) => !v.ok));
  }).catch(() => {});
  paintRungs();
  api('/api/settings', { nocache: true }).then((d) => { const v = d && d.settings ? d.settings.auto_download_plays : d.auto_download_plays; if (v != null) $('auto-dl').value = v; }).catch(() => {});
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

// DJ export: analysis coverage, a batch analyse for electronic, and per-playlist export
async function renderDjExport() {
  setNav('djexport'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = 'Prep';
  const v = $('view');
  v.innerHTML = `
    <div class="prep-hero">
      <div class="prep-kicker">SET PREPARATION</div>
      <div class="prep-title">Prep</div>
      <p class="prep-sub">Prep a crate for BPM, key and beat grid. Export copies the audio and writes cues from what is already prepped; it does not analyze on the way out.</p>
      <div class="prep-meter"><div class="prep-meter-bar"><i id="prep-fill" style="width:0%"></i></div><span id="prep-cov">…</span></div>
      <div class="prep-actions">
        <button class="btn btn-primary" id="dj-analyze">Analyze unanalyzed</button>
      </div>
    </div>
    <div class="sec-title">Crates <small>EXPORT READY</small></div>
    <div class="crate-grid" id="dj-list"></div>`;
  let remaining = 0;
  try {
    const st = await api('/api/analyze/status', { nocache: true });
    remaining = st.remaining || 0;
    const cov = document.getElementById('prep-cov');
    const fill = document.getElementById('prep-fill');
    const pct = st.total ? Math.round((st.analysed / st.total) * 100) : 0;
    if (cov) cov.textContent = `${st.prepped || 0}/${st.total} prepped · ${Math.max(0, st.total - (st.prepped || 0))} left`;
    if (fill) fill.style.width = pct + '%';
    const ab = document.getElementById('dj-analyze');
    if (ab) ab.textContent = remaining ? `Analyze ${remaining} unanalyzed` : 'All analyzed';
  } catch {}
  const btn = document.getElementById('dj-analyze');
  if (btn) btn.onclick = async () => {
    if (!remaining) { toast('Everything with audio is already analyzed'); return; }
    if (!confirm(`Analyze ${remaining} track${remaining === 1 ? '' : 's'}? This runs on the Pi and takes a while.`)) return;
    btn.disabled = true;
    try {
      const r = await api('/api/analyze/run?limit=500&workers=2', { method: 'POST' });
      toast(`Analyzing ${r.limit} tracks in the background`, 5000);
    } catch { toast('Could not start analysis'); }
    btn.disabled = false;
  };
  const list = document.getElementById('dj-list');
  if (!list) return;
  for (const p of state.playlists) {
    const cov = p.owned ? Math.round(((p.prepped || 0) / p.owned) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'crate';
    card.innerHTML = `
      <div class="crate-artwrap">
        <img class="crate-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=340&v=${state.artV || 0}" alt="" loading="lazy">
        <span class="crate-badge">${p.owned || 0}/${p.n_tracks || 0} audio</span>
      </div>
      <div class="crate-name">${esc(p.name)}</div>
      <div class="crate-ready"><i style="width:${cov}%"></i></div>
      <div class="crate-meta"><span>${p.n_tracks || 0} tracks · ${p.prepped || 0}/${p.owned || 0} prepped</span>${(p.owned && cov < 100) ? `<button class="crate-analyze">Prep ${Math.max(0, (p.owned || 0) - (p.prepped || 0))}</button>` : '<span class="crate-ready-tag">ready</span>'}</div>
      <div class="crate-acts">
        <button class="crate-btn" data-rb title="Download a ZIP with the audio + rekordbox XML">Rekordbox</button>
        <button class="crate-btn" data-tr title="Download a ZIP with the audio + Traktor NML">Traktor</button>
        <button class="crate-btn" data-usb title="ZIP of the audio under Contents/ for a CDJ USB">USB</button>
      </div>`;
    const missingPrep = Math.max(0, (p.owned || 0) - (p.prepped || 0));
    const exportCrate = (fmt) => {
      if (missingPrep && !confirm(`${missingPrep} track${missingPrep === 1 ? '' : 's'} in "${p.name}" have no beat grid. Cues will be missing. Export anyway?`)) return;
      toast(fmt === 'usb' ? 'Zipping for the CDJ…' : 'Zipping the crate…', 6000);
      if (fmt === 'usb') window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/pioneer.zip`;
      else window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export.zip?format=${fmt}`;
    };
    card.querySelector('[data-rb]').onclick = (e) => { e.stopPropagation(); exportCrate('rekordbox'); };
    card.querySelector('[data-tr]').onclick = (e) => { e.stopPropagation(); exportCrate('traktor'); };
    card.querySelector('[data-usb]').onclick = (e) => { e.stopPropagation(); exportCrate('usb'); };
    const abt = card.querySelector('.crate-analyze');
    if (abt) abt.onclick = async (e) => {
      e.stopPropagation();
      abt.disabled = true; abt.textContent = 'starting…';
      try {
        const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/analyze`, { method: 'POST' });
        if (r.count) {
          const pp = progressPill(`Analyzing ${r.count} track${r.count === 1 ? '' : 's'} in ${p.name}…`);
          setTimeout(() => pp.done(), 8000);
        } else {
          toast(r.note || 'Nothing to analyze in this crate', 5000);
        }
      } catch { toast('Could not start'); abt.disabled = false; abt.textContent = 'Analyze'; }
    };
    card.onclick = () => openPlaylist(p.id);
    list.appendChild(card);
  }
  if (!state.playlists.length) list.innerHTML = '<div class="empty">No playlists yet.</div>';
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
  v.innerHTML = `${heroBanner('CATALOGUE', 'Songs', 'Search, filter and play the whole library.')}<div class="songs-chips" id="songs-chips"></div>
    <div class="lib-actions songs-head">
      <input class="search" id="songs-q" placeholder="Filter by title, artist or album" autocomplete="off">
      <div class="mode-tabs" id="songs-filter">
        <button class="mode-tab on" data-f="all">All</button>
        <button class="mode-tab" data-f="owned">Downloaded</button>
        <button class="mode-tab" data-f="mirror" title="In the catalogue, but the audio is not downloaded to this server yet">Not downloaded</button>
      </div>
      <span class="meta-line" id="songs-stats"></span>
    </div>
    <div class="thead" id="songs-thead">
      <div class="th" data-key="pos">#</div><div></div>
      <div class="th" data-key="title">TITLE</div>
      <div class="th" data-key="artist">ARTIST</div>
      <div class="th" data-key="album">ALBUM</div>
      <div class="th" data-key="added_at">DATE ADDED</div>
      <div></div>
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
  if (!chips) return; // view changed while the library was loading
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
      <button class="chip-card sm" data-browse="covers"><b>Fix covers</b><span>OFFICIAL ALBUM ART</span></button>
      <button class="chip-card sm" data-browse="fixmeta"><b>Fix metadata</b><span>YEARS &amp; PLACEHOLDERS</span></button>
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
        if (!confirm('Replace album covers with the official artwork? This overwrites existing covers for albums with more than one track.')) return;
        toast('Fetching official album art', 6000);
        (async () => {
          let albums = 0, tracks = 0;
          try {
            const offset = state.coverOffset || 0;
            const r = await api(`/api/covers/albums?force=1&limit=25&offset=${offset}`, { method: 'POST' });
            albums = r.albums || 0; tracks = r.tracks || 0;
            state.coverOffset = r.next_offset || 0;
          } catch {}
          let singles = 0;
          try { const s = await api('/api/covers/fill?limit=40', { method: 'POST' }); singles = s.found || 0; } catch {}
          bustCache();
          state.artV = Date.now();
          toast(`Album art: ${albums} albums, ${tracks} songs. Singles: ${singles} found.`, 9000);
          renderSongs(false);
        })().catch(() => toast('cover lookup failed', 5000));
        return;
      }
      if (b.dataset.browse === 'fixmeta') {
        toast('Repairing metadata…', 5000);
        api('/api/maintenance/repair', { method: 'POST' }).then(async (r) => {
          let durFixed = 0, trkFixed = 0;
          try { const dd = await api('/api/maintenance/fill-durations', { method: 'POST' }); durFixed = dd.fixed || 0; } catch {}
          try { const tt = await api('/api/maintenance/fill-tracknos', { method: 'POST' }); trkFixed = tt.fixed || 0; } catch {}
          bustCache();
          toast(`Years fixed ${r.fixed_year || 0}, placeholders cleared ${r.cleared_placeholder_album || 0}, durations ${durFixed}, track numbers ${trkFixed}`, 7000);
          // refresh the rows in place: keep the scroll position, filter, query and expanded limit
          const sc = document.getElementById('songs-list');
          const viewEl = document.getElementById('view');
          const keep = { win: window.scrollY, view: viewEl ? viewEl.scrollTop : 0, list: sc ? sc.scrollTop : 0 };
          try {
            const fresh = await api('/api/tracks', { nocache: true });
            all.length = 0; all.push(...fresh);
            state.allTracks = all;
            draw();
            requestAnimationFrame(() => {
              try { window.scrollTo(0, keep.win); } catch {}
              if (viewEl) viewEl.scrollTop = keep.view;
              const sc2 = document.getElementById('songs-list');
              if (sc2) sc2.scrollTop = keep.list;
            });
          } catch {}
        }).catch(() => toast('Repair failed', 5000));
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
        card.innerHTML = `<div class="pcard-art ph" style="background:${gradFor(name)};color:rgba(255,255,255,.9)">${esc(name.charAt(0).toUpperCase())}</div>
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
      const art = document.createElement('div');
      art.className = 'pcard-art ph';
      art.style.background = gradFor(r.name);
      art.style.color = 'rgba(255,255,255,.9)';
      art.textContent = r.name.charAt(0).toUpperCase();
      let artEl = art;
      if (browse === 'albums') {
        const img = document.createElement('img');
        img.className = 'pcard-art';
        img.loading = 'lazy';
        img.alt = '';
        img.src = `/api/cover-album/${encodeURIComponent(r.name)}?v=${state.artV || 0}`;
        img.onerror = () => img.replaceWith(art);
        artEl = img;
      } else {
        const sample = all.find((t) => t.artist === r.name && t.has_art);
        if (sample) {
          const img = document.createElement('img');
          img.className = 'pcard-art';
          img.loading = 'lazy';
          img.alt = '';
          img.src = `/api/cover/${sample.id}?v=${state.artV || 0}`;
          img.onerror = () => img.replaceWith(art);
          artEl = img;
        }
      }
      const name = document.createElement('div');
      name.className = 'pcard-name';
      name.textContent = r.name;
      const sub = document.createElement('div');
      sub.className = 'pcard-sub';
      sub.textContent = `${r.n} tracks`;
      card.append(artEl, name, sub);
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

  const statsEl = $('songs-stats');
  if (statsEl) {
    api('/api/stats').then((s) => {
      statsEl.textContent = `${s.tracks} tracks · ${(s.owned_bytes / 1073741824).toFixed(1)} GB on disk`;
    }).catch(() => { statsEl.textContent = `${all.length} tracks`; });
  }

  const draw = () => {
    closeInlinePreview();
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
    const sth = $('songs-thead');
    if (sth) sth.querySelectorAll('.th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.key === sort.key);
      th.classList.toggle('desc', th.dataset.key === sort.key && sort.dir === -1);
    });
  };

  const sq = $('songs-q');
  if (sq) sq.oninput = (e) => { query = e.target.value.trim(); browse = null; state.genreFilter = null; limit = 60; draw(); };
  document.querySelectorAll('#songs-filter .mode-tab').forEach((b) => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('#songs-filter .mode-tab').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  const sth2 = $('songs-thead');
  if (sth2) sth2.querySelectorAll('.th').forEach((th) => th.onclick = () => {
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
  v.innerHTML = `${heroBanner('SYSTEM', 'Settings', 'Your identity, taste and playback defaults.')}
    <div class="set-grid">
      <section class="set-card">
        <h2>You</h2>
        <label>Display name<input id="set-name" value="${esc(s.display_name || '')}" placeholder="Your name"></label>
        <label>Email<input id="set-email" value="${esc(s.email || '')}" placeholder="you@example.com"></label>
        <label>Timezone<input id="set-tz" value="${esc(s.timezone || '')}" placeholder="America/Sao_Paulo"></label>
        <p class="set-note">IANA name, e.g. America/Sao_Paulo. Setting a city below fills it in automatically.</p>
      </section>
      <section class="set-card">
        <h2>Location</h2>
        <p class="set-note">Used by the greeting and its weather line. Type a city and the coordinates and time zone are looked up for you.</p>
        <label>City<input id="set-city" value="${esc(s.city || '')}" placeholder="Brasília"></label>
        <div class="set-facts" id="set-geo">${s.latitude && s.longitude
          ? `<div><b>${esc(s.city || '')}</b>${s.country ? ` · ${esc(s.country)}` : ''}</div><div>${Number(s.latitude).toFixed(3)}, ${Number(s.longitude).toFixed(3)}</div><div>${esc(s.timezone || '')}</div>`
          : '<div>No city set</div>'}</div>
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
        <label>Download folder<input id="set-root" value="${esc(s.download_root || '')}" placeholder="/srv/music/owned"></label>
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
        <label class="set-check"><input type="checkbox" id="set-autoplay"${s.autoplay_next !== false ? ' checked' : ''}> Continue with similar tracks when a playlist ends</label>
        <label>Buffer ahead
          <select id="set-buffer">
            <option value="0"${String(s.prefetch_ahead) === '0' ? ' selected' : ''}>off</option>
            <option value="1"${String(s.prefetch_ahead) === '1' ? ' selected' : ''}>1 track</option>
            <option value="2"${String(s.prefetch_ahead ?? 2) === '2' ? ' selected' : ''}>2 tracks</option>
          </select>
        </label>
        <div class="lib-actions"><button class="btn btn-ghost" id="set-clearbuf" type="button">Clear buffer</button><span class="set-note">Frees preloaded audio and cached pages</span></div>
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
  // keep the fade checkbox and its length select in agreement
  const fadeCb = document.getElementById('set-fade');
  const fadeSel = document.getElementById('set-fadems');
  if (fadeCb && fadeSel) {
    fadeCb.onchange = () => { fadeSel.value = fadeCb.checked ? (fadeSel.value === '0' ? '350' : fadeSel.value) : '0'; };
    fadeSel.onchange = () => { fadeCb.checked = fadeSel.value !== '0'; };
  }
  document.getElementById('set-save').onclick = async () => {
    const body = {
      display_name: document.getElementById('set-name').value.trim(),
      email: document.getElementById('set-email').value.trim(),
      timezone: document.getElementById('set-tz').value.trim(),
      city: document.getElementById('set-city').value.trim(),
      llm_base_url: document.getElementById('set-llm-url').value.trim(),
      llm_model: document.getElementById('set-llm-model').value.trim(),
      download_root: document.getElementById('set-root').value.trim(),
      preferred_format: document.getElementById('set-format').value,
      normalize_loudness: document.getElementById('set-normalize').checked,
      target_loudness: Number(document.getElementById('set-target').value),
      fade_on_play_ms: document.getElementById('set-fade').checked
        ? (Number(document.getElementById('set-fadems').value) || 350)
        : 0,
      autoplay_next: document.getElementById('set-autoplay').checked,
      prefetch_ahead: Number(document.getElementById('set-buffer').value),
      taste_genres: document.getElementById('set-taste-genres').value.trim(),
      taste_artists: document.getElementById('set-taste-artists').value.trim(),
      taste_context: document.getElementById('set-taste-context').value.trim(),
      taste_avoid: document.getElementById('set-taste-avoid').value.trim(),
    };
    const key = document.getElementById('set-llm-key').value.trim();
    if (key) body.llm_api_key = key;
    try {
      const r = await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const saved = r.settings || {};
      // the server may have resolved the city into coordinates and a time zone
      if (saved.timezone) document.getElementById('set-tz').value = saved.timezone;
      if (saved.city !== undefined) document.getElementById('set-city').value = saved.city || '';
      const geo = document.getElementById('set-geo');
      if (geo) {
        geo.innerHTML = saved.latitude && saved.longitude
          ? `<div><b>${esc(saved.city || '')}</b>${saved.country ? ` · ${esc(saved.country)}` : ''}</div><div>${Number(saved.latitude).toFixed(3)}, ${Number(saved.longitude).toFixed(3)}</div><div>${esc(saved.timezone || '')}</div>`
          : '<div>No city set</div>';
      }
      document.getElementById('set-msg').textContent = saved.city && !saved.latitude ? 'Saved, but that city was not found' : 'Saved';
      state.settings = { ...(state.settings || {}), ...body, ...saved };
      applyLoudnessGain(state.current);
      if (body.display_name) state.profileName = body.display_name;
    } catch { document.getElementById('set-msg').textContent = 'Could not save'; }
  };
  const cb = document.getElementById('set-clearbuf');
  if (cb) cb.onclick = async () => {
    try { for (const id of [...preload.keys()]) releasePreload(id); } catch {}
    try { clearAppCache(); } catch {}
    try { if (window.caches && caches.keys) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    toast('Buffer cleared', 3000);
  };
}

function renderActionCard(a, out, stateEl) {
  if (stateEl) stateEl.textContent = '';
  const card = document.createElement('div');
  card.className = 'ask-action';
  const head = document.createElement('div');
  head.className = 'ask-action-head';
  head.innerHTML = `<div><div class="ask-action-kicker">ON DECK</div><b>${esc(a.action.title)}</b></div><span>${esc(a.action.summary || '')}</span>`;
  card.appendChild(head);
  const meta = document.createElement('div');
  meta.className = 'ask-action-meta';
  meta.textContent = a.action.reason || '';
  card.appendChild(meta);
  const tracks = a.action.tracks || [];
  const list = document.createElement('div');
  list.className = 'ask-preview';
  tracks.slice(0, 20).forEach((t) => {
    const row = document.createElement('div');
    row.className = 'ask-preview-row';
    const art = document.createElement('div');
    art.className = 'apr-art';
    if (t.cover) art.style.backgroundImage = `url("${t.cover}")`;
    const play = document.createElement('button');
    play.className = 'apr-play';
    play.type = 'button';
    play.innerHTML = IC.play;
    play.title = t.preview ? 'Preview' : 'No preview for this one';
    play.disabled = !t.preview;
    const preview = (e) => { if (e) e.stopPropagation(); toggleSuggestionPreview(t, row, { owned: t.owned }); };
    play.onclick = preview;
    const title = document.createElement('span');
    title.className = 'apr-title';
    title.textContent = t.title || '';
    const artist = document.createElement('span');
    artist.className = 'apr-artist';
    artist.textContent = t.artist || '';
    const meta = document.createElement('div');
    meta.className = 'apr-meta';
    meta.append(title, artist);
    const tag = document.createElement('span');
    const kind = t.owned ? 'local' : t.source === 'online' ? 'new' : 'missing';
    tag.className = `apr-tag ${t.owned ? 'on' : t.source === 'online' ? 'new' : ''}`;
    tag.textContent = kind;
    row.append(play, art, meta, tag);
    row.style.cursor = 'pointer';
    row.onclick = (e) => { if (!e.target.closest('button')) preview(e); };
    list.appendChild(row);
  });
  if (tracks.length > 20) {
    const more = document.createElement('div');
    more.className = 'ask-preview-more';
    more.textContent = `+${tracks.length - 20} more`;
    list.appendChild(more);
  }
  card.appendChild(list);
  const safety = document.createElement('div');
  safety.className = 'ask-action-safety';
  safety.textContent = 'Nothing is saved until you pick one.';
  card.appendChild(safety);
  const acts = document.createElement('div');
  acts.className = 'ask-action-btns';
  const missing = tracks.filter((t) => !t.owned).length;
  const confirm = async (btn, alsoDownload) => {
      btn.disabled = true;
    try {
      const r = await api(`/api/agent/action/${a.action.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, download: !!alsoDownload }), nocache: true });
      card.remove();
      if (stateEl) stateEl.textContent = 'Done';
      if (r.spoken) toast(r.spoken, 5000);
      if (r.data && r.data.playlist) { afterWrite(); await loadPlaylists(); openPlaylist(r.data.playlist.id, false); }
      if (r.data && r.data.queued) openDownloads();
    } catch { btn.disabled = false; toast('That draft went stale, ask again', 5000); }
  };
  if (a.action.kind === 'playlist' && missing > 0) {
    const both = document.createElement('button');
    both.className = 'btn btn-primary';
    both.textContent = `Create + download ${missing}`;
    const only = document.createElement('button');
    only.className = 'btn btn-ghost';
    only.textContent = 'Playlist only';
    both.onclick = () => confirm(both, true);
    only.onclick = () => confirm(only, false);
    acts.append(both, only);
  } else {
    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = a.action.kind === 'playlist' ? 'Create playlist' : a.action.kind === 'album' ? 'Download album' : 'Download missing';
    ok.onclick = () => confirm(ok, a.action.kind !== 'playlist');
    acts.append(ok);
  }
  const no = document.createElement('button');
  no.className = 'btn btn-ghost';
  no.textContent = 'Cancel';
  no.onclick = async () => {
      try { await api(`/api/agent/action/${a.action.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: true }), nocache: true }); } catch {}
    card.remove();
    if (stateEl) stateEl.textContent = 'Cancelled';
  };
  acts.append(no);
  card.appendChild(acts);
  out.appendChild(card);
  try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
}

async function runAssistant(text, out, stateEl, box) {
    if (!text.trim()) return;
      closeInlinePreview();
    $('view').classList.add('asking');
    stateEl.textContent = 'Searching';
    stateEl.classList.add('thinking');
    out.innerHTML = '';
    const agentish = /\b(create|make|build|download|find|search|show|list|playlist|how many|how much|top rated|top \d)\b/i.test(text);
    try {
      if (agentish) {
        const a = await api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }), nocache: true });
        stateEl.classList.remove('thinking');
        stateEl.textContent = `${String(a.plan.intent).replace(/_/g, ' ')} · ${a.source === 'llm' ? 'planned by model' : 'planned locally'}`;
        if (!a.action) {
          const said = document.createElement('div');
          said.className = 'ai-said';
          said.textContent = a.spoken || '';
          out.appendChild(said);
        }
        if (a.action) { renderActionCard(a, out, stateEl); return; }
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
              <button class="tmore" title="Preview before downloading">${IC.play}</button>`;
            if (s.cover) {
              const art = row.querySelector('.tart');
              art.style.backgroundImage = `url("${s.cover}")`;
              art.style.backgroundSize = 'cover';
              art.style.backgroundPosition = 'center';
              art.textContent = '';
            }
            row.style.cursor = 'pointer';
            const preview = (e) => { if (e) e.stopPropagation(); toggleSuggestionPreview(s, row); };
            row.onclick = preview;
            row.querySelector('.tmore').onclick = preview;
            sec.appendChild(row);
          }
          out.appendChild(sec);
        }
        return;
      }
      const d = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }), nocache: true });
      stateEl.classList.remove('thinking');
      if (d.source === 'help') {
        stateEl.textContent = 'What I can do';
        const said = document.createElement('div');
        said.className = 'ai-said';
        said.textContent = d.answer || '';
        out.appendChild(said);
        const hint = document.createElement('div');
        hint.className = 'ask-hint';
        (d.examples || []).forEach((ex) => {
          const b = document.createElement('button');
          b.className = 'ask-ex';
          b.textContent = ex;
          b.onclick = () => { box.value = ex; runAssistant(ex, out, stateEl, box); };
          hint.appendChild(b);
        });
        out.appendChild(hint);
        return;
      }
      const f = d.filters || {};
      const bits = [];
      if (f.key) bits.push(`key ${f.key}${f.scale ? ' ' + f.scale : ''}`);
      if (f.bpm && (f.bpm.min != null || f.bpm.max != null)) bits.push(`${f.bpm.min ?? ''}–${f.bpm.max ?? ''} BPM`);
      if (f.genre) bits.push(f.genre);
      if (f.artist) bits.push(f.artist);
      if (f.text) bits.push(`“${f.text}”`);
      if (!d.count) {
        const term = (f.text || []).join(' ').trim();
        const label = term.replace(/\b\w/g, (c) => c.toUpperCase());
        stateEl.textContent = term ? `No ${label} in your library` : 'No tracks matched';
        if (term) {
          const find = document.createElement('button');
          find.className = 'btn btn-ghost';
          find.textContent = `Find ${label} online`;
          find.onclick = () => { box.value = `create a playlist with 3 ${term} tracks`; runAssistant(box.value, out, stateEl, box); };
          out.appendChild(find);
        }
        return;
      }
      stateEl.textContent = `${d.count} track${d.count === 1 ? '' : 's'}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
      const wrap = document.createElement('div');
      const tracks = d.results.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
      tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
      out.appendChild(wrap);
    } catch (e) {
      stateEl.classList.remove('thinking');
      stateEl.textContent = 'That did not go through — try a plain phrase like “tracks in Dm between 120 and 130 bpm”.';
    }
  }

async function renderAskAi() {
  closeInlinePreview();
  setNav('search');
  state.view = 'askai'; state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = 'Ask';
  const v = $('view');
  v.innerHTML = `${heroBanner('ASSISTANT', 'Ask', 'Search your library in plain language.')}<div class="search-wrap">
      <input class="search" id="ai-q" placeholder="Ask anything, for example: create a playlist of 10 ambient tracks" autocomplete="off">
      <div class="ask-hint">
        <button class="ask-ex">how much of my library has audio</button>
        <button class="ask-ex">find techno tracks I never played</button>
        <button class="ask-ex">create a playlist of 10 ambient tracks</button>
        <button class="ask-ex">tracks in Dm between 120 and 130 bpm</button>
      </div>
      <div class="ladder-state" id="ai-state"></div>
    </div><div id="ai-res"></div><div id="ask-discover"></div>`;
  const box = $('ai-q');
  const out = $('ai-res');
  const stateEl = $('ai-state');

  const run = (text) => runAssistant(text, out, stateEl, box);

  box.onkeydown = (e) => { if (e.key === 'Enter') run(box.value); };
  v.querySelectorAll('.ask-ex').forEach((b) => b.onclick = () => { box.value = b.textContent; run(box.value); });
  box.focus();
  renderExternalInto($('ask-discover'));
  // dynamic examples: your top artist this week, your key, your tempo
  api('/api/ask/suggest', { nocache: true }).then((d) => {
    const hint = v.querySelector('.ask-hint');
    if (!hint || !d.prompts || !d.prompts.length) return;
    hint.innerHTML = '';
    for (const label of d.prompts.slice(0, 4)) {
      const b = document.createElement('button');
      b.className = 'ask-ex';
      b.textContent = label;
      b.onclick = () => { box.value = label; run(label); };
      hint.appendChild(b);
    }
  }).catch(() => {});
}

async function renderSearch() {
  closeInlinePreview();
  setNav('search'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = 'Search';
  const v = $('view');
  v.innerHTML = `${heroBanner('SEARCH', 'Search', 'Search your library and the web, or ask for a playlist.')}<div class="search-wrap">
      <input class="search" id="q" placeholder="Search tracks or ask: create a playlist of 10 ambient tracks" autocomplete="off">
      <div class="ask-hint" id="search-hints">
        <button class="ask-ex">tracks in Dm between 120 and 130 bpm</button>
        <button class="ask-ex">create a playlist of 10 ambient tracks</button>
        <button class="ask-ex">how much of my library has audio</button>
      </div>
      <div class="mode-tabs" id="mode-tabs">
        <button class="mode-tab loc on" data-loc="lib"><span class="chk">✓</span>Library</button>
        <button class="mode-tab loc on" data-loc="web"><span class="chk">✓</span>Web sources</button>
        <button class="mode-tab" id="long-sets" data-on="false" title="Include DJ mixes, sets and long recordings"><span class="chk"></span>Long sets</button>
      </div>
      <div class="ladder-state" id="ladder-state"></div>
    </div><div id="qres"></div><div id="search-discover"></div>`;
  renderExternalInto($('search-discover'));
  const q = $('q'); q.focus();
  if (!state.allTracks) state.allTracks = await api('/api/tracks');
  const all = state.allTracks;
  const res = $('qres');
  let mode = 'all';
  let searchLib = state.searchLib !== false;
  let searchWeb = state.searchWeb !== false;
  let ladderCtl = null; // {abort}

  const setLoc = (b, on) => {
    b.classList.toggle('on', on);
    const c = b.querySelector('.chk'); if (c) c.textContent = on ? '✓' : '';
  };
  document.querySelectorAll('.mode-tab.loc').forEach((b) => {
    setLoc(b, b.dataset.loc === 'lib' ? searchLib : searchWeb);
    b.onclick = () => {
      if (b.dataset.loc === 'lib') { searchLib = !searchLib; state.searchLib = searchLib; setLoc(b, searchLib); }
      else { searchWeb = !searchWeb; state.searchWeb = searchWeb; setLoc(b, searchWeb); }
      if (!searchLib && !searchWeb) toast('Choose Library or Web sources to search', 3000);
      draw();
    };
  });
  const assistantish = /\b(create|make|build|download|playlist|how many|how much|top rated|top \d|what can|help)\b/i;
  const submit = () => {
    const text = q.value.trim();
    if (!text) { draw(); return; }
    if (assistantish.test(text)) { runAssistant(text, res, $('ladder-state'), q); q.focus(); return; }
    $('view').classList.remove('asking');
    draw();
  };
  document.querySelectorAll('#search-hints .ask-ex').forEach((b) => b.onclick = () => {
    q.value = b.textContent;
    submit();
    q.focus();
  });
  const paintLS = () => {
    const ls = $('long-sets');
    if (!ls) return;
    ls.dataset.on = String(!!state.longSets);
    ls.classList.toggle('on', !!state.longSets);
    const c = ls.querySelector('.chk'); if (c) c.textContent = state.longSets ? '✓' : '';
  };
  paintLS();
  const lsBtn = $('long-sets');
  if (lsBtn) lsBtn.onclick = () => {
    state.longSets = !state.longSets;
    paintLS();
    if (q.value.trim()) draw();
  };


  const draw = async () => {
    closeInlinePreview();
    mode = searchLib && searchWeb ? 'all' : searchLib ? 'library' : 'ladder';
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
    const agentish = /\b(create|make|build|download|find|search|show|list|playlist|how many|how much|top rated|top \d)\b/i.test(text);
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
              <button class="tmore" title="Preview before downloading">${IC.play}</button>`;
            if (s.cover) {
              const art = row.querySelector('.tart');
              art.style.backgroundImage = `url("${s.cover}")`;
              art.style.backgroundSize = 'cover';
              art.style.backgroundPosition = 'center';
              art.textContent = '';
            }
            row.style.cursor = 'pointer';
            const preview = (e) => { if (e) e.stopPropagation(); toggleSuggestionPreview(s, row); };
            row.onclick = preview;
            row.querySelector('.tmore').onclick = preview;
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
            bindContext(card, (x, y) => openCardMenu(a.name, [
              { label: 'Search this artist', run: async () => { q.value = a.name; draw(); } },
              { label: 'Download their latest album', run: async () => {
                  const r = await api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ q: `download the latest album by ${a.name}` }) });
                  if (r.action) renderActionCard(r, box, null);
                  else toast(r.spoken || 'Queueing', 8000);
                } },
            ], x, y));
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
            const queueAlbum = () => {
              toast(`Checking "${al.name}"`, 3000);
              api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ q: `download the album ${al.name} by ${al.artist}` }) })
                .then((r) => {
                  if (r.action) renderActionCard(r, box, null);
                  else { toast(r.spoken || 'Queueing album', 9000); if (r.data && r.data.queued) openDownloads(); }
                })
                .catch(() => toast('Could not queue that album', 4000));
            };
            card.onclick = queueAlbum;
            card.oncontextmenu = (e) => { e.preventDefault(); queueAlbum(); };
            longPress(card, queueAlbum);
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
            <button class="tmore" title="Preview before downloading">${IC.play}</button>`;
          const preview = (e) => { if (e) e.stopPropagation(); toggleSuggestionPreview(s, row); };
          row.style.cursor = 'pointer';
          row.onclick = (e) => { if (!e.target.closest('button')) preview(e); };
          row.querySelector('.tmore').onclick = preview;
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
    holder.innerHTML = `<div class="sec-title" >Web sources <small>SEARCHING SOURCES...</small></div>
      <div class="ladder-loading">resolving "${esc(s)}" across youtube, soundcloud and archive</div>
      ${Array.from({ length: 4 }).map(() => `<div class="trow lrow skeleton"><div class="tno"></div><div class="tart"></div><div class="tmeta"><div class="sk-line w60"></div><div class="sk-line w35"></div></div></div>`).join('')}`;
    if (mode === 'ladder' || !appendAfterLibrary) res.innerHTML = '';
    res.appendChild(holder);
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 25000);
      const r = await fetch(`/api/search/ladder?q=${encodeURIComponent(s)}${state.longSets ? '' : '&durCap=720'}`, { signal: ac.signal }).finally(() => clearTimeout(timer));
      const data = await r.json();
      if (ctl.abort) return;
      const box = document.createElement('div');
      if (!data.connected) {
        box.innerHTML = `<div class="sec-title">Web sources <small>OFFLINE</small></div><div class="empty">No web sources available right now.</div>`;
        holder.replaceWith(box); return;
      }
      if (r.status !== 200) {
        box.innerHTML = `<div class="sec-title" >Web sources <small>ERROR</small></div><div class="empty">${esc(data.error || 'search failed')}</div>`;
        holder.replaceWith(box); return;
      }
      // catalogue answers first; the ladder is a fallback you open deliberately
      const hasCatalogue = (((data.catalogue || {}).songs) || []).length > 0;
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
          box.innerHTML = `<div class="sec-title" >Web sources <small>NO MATCHES</small></div><div class="empty">No usable matches for "${esc(s)}"</div>`;
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
            if (c.rung === 'yt-dlp' || c.rung === 'ytmusic' || c.rung === 'ytmusic-album') {
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
            } else if (c.url) {
              audio.src = `/api/ladder/stream/generic?u=${encodeURIComponent(c.url)}`;
              audio.play().catch(() => toast('stream refused'));
              paintLadder();
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
        if (!hasCatalogue) outer.appendChild(fold);
        holder.replaceWith(outer);
      } else {
        holder.replaceWith(box);
      }
    } catch (e) {
      if (ctl.abort) return;
      const box = document.createElement('div');
      box.innerHTML = `<div class="sec-title" >Web sources <small>${e.name === 'AbortError' ? 'TIMEOUT' : 'ERROR'}</small></div><div class="empty">${e.name === 'AbortError' ? 'Web search took too long. Try a narrower query.' : esc(e.message)}</div>`;
      holder.replaceWith(box);
    }
  };

  // debounce ladder searches: only fire when typing pauses
  let deb = null;
  q.oninput = () => {
    clearTimeout(deb);
    if (assistantish.test(q.value)) return;
    $('view').classList.remove('asking');
    deb = setTimeout(draw, 350);
  };
  q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
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
    <div class="tmeta"><div class="tt">${esc(t.title)}</div>${t.album ? `<div class="talbum-line">${t.artist ? `<span class="tal-artist">${esc(t.artist)}</span><span class="tal-sep"> &middot; </span>` : ''}<span class="alink">${esc(t.album)}</span></div>` : ''}${t.genre || t.genre_family ? `<button class="genrechip" data-kind="genre">${esc(t.genre_family || t.genre)}</button>` : ''}${t.bpm ? `<div class="tbpm">${Math.round(t.bpm)} BPM${t.key ? ` <button class="keychip key-${keyHueClass(t.key, t.key_scale)}" data-kind="key" title="Sort by key">${esc(t.key)}${t.key_scale === 'minor' ? 'm' : ''}</button>` : ''}</div>` : ''}</div>
    <div class="tartist"><span class="alink ${t.artist ? '' : 'muted'}" data-kind="artist">${esc(t.artist || 'unknown artist')}</span></div>
    <div class="talbum"><span class="alink" data-kind="album">${esc(t.album || '')}</span></div>
    <div class="tadded">${esc(added)}</div>
    <button class="like ${liked ? 'on' : ''}" title="Like" aria-label="Like">${liked ? IC.heartFull : IC.heart}</button>
    ${hasAudio(t)
      ? `<div class="trbadge rung-${esc(shortRung(t.rung).cls)}"><b>${esc(shortRung(t.rung).label)}</b> ${esc(t.quality || '')}</div>`
      : t.streamable
        ? `<div class="trbadge rung-yt" title="Plays from the source when you press play."><b>STREAM</b></div>`
        : `<div class="trbadge rung-mirror" title="Metadata only. Press the download icon to get the audio."><b>Not downloaded</b></div>`}
    <div class="tdur">${t.duration ? fmt(t.duration) : '—'}${state.offlineIds && state.offlineIds.has(t.id) ? '<span class="offline-dot" title="Available offline"></span>' : ''}</div>
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
  const albLinks = el.querySelectorAll('.talbum .alink, .talbum-line .alink');
  if (t.album) albLinks.forEach((a) => { a.onclick = (e) => { e.stopPropagation(); renderAlbum(t.album); }; });
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

function setStatus(text) {
  // dedicated element only: the artist line is not ours to rewrite
  const el = document.getElementById('pb-status');
  if (!el) return;
  // the animated dot carries the movement; the text stays still and quiet
  el.textContent = String(text || '').replace(/\.{2,}$/, '');
  el.hidden = !text;
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
  if (badge) { badge.className = 'trbadge rung-local'; badge.innerHTML = '<b>Local</b>'; }
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
        // refresh the row in place: rebuilding the view threw away the search results
        if (state.view === 'search' || state.view === 'songs') { if (trackId) markRowOwned(trackId); }
        else refreshView();
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

// poll a job and return its final row (with .detail), so the caller can report the outcome
async function pollJob(jobId, onTick, tries = 150) {
  for (let i = 0; i < tries; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const j = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (onTick) { try { onTick(j); } catch {} }
      if (['done', 'error', 'unavailable', 'cancelled', 'skipped'].includes(j.state)) return j;
    } catch {}
  }
  return null;
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
        <div class="plhead-meta"><b id="g-n">...</b> tracks <span id="g-albums"></span></div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="g-play">${IC.play}&nbsp; Play</button>
        </div>
      </div></div>
    <div id="g-list"></div>`;
  let list = [];
  try { list = await api(`/api/group/artist/${encodeURIComponent(name)}`); } catch {}
  state._currentList = list;
  const gnA = $('g-n'); const elA = $('g-list');
  if (!gnA || !elA) return;
  const albums = [...new Set(list.map((t) => t.album).filter(Boolean))];
  gnA.textContent = list.length;
  const gaA = $('g-albums');
  if (gaA) gaA.textContent = albums.length ? `· ${albums.length} album${albums.length === 1 ? '' : 's'}` : '';
  if (!list.length) { elA.innerHTML = `<div class="empty">No owned tracks for this artist yet. Search the web and download some.</div>`; return; }
  if (albums.length) {
    const chips = document.createElement('div');
    chips.className = 'songs-chips artist-albums';
    albums.slice(0, 12).forEach((al) => {
      const chip = document.createElement('button');
      chip.className = 'chip-card sm';
      const n = list.filter((t) => t.album === al).length;
      chip.innerHTML = `<b>${esc(al)}</b><span>${n} TRACK${n === 1 ? '' : 'S'}</span>`;
      chip.onclick = () => renderAlbum(al);
      chips.appendChild(chip);
    });
    if (albums.length > 12) {
      const more = document.createElement('button');
      more.className = 'chip-card sm';
      more.innerHTML = `<b>+${albums.length - 12}</b><span>MORE ALBUMS</span>`;
      more.onclick = () => toast(`${albums.length} albums, showing the first 12`, 4000);
      chips.appendChild(more);
    }
    v.insertBefore(chips, elA);
  }
  list.forEach((t, i) => { registerRow(t); elA.appendChild(trow(t, i, list)); });
  const gpA = $('g-play'); if (gpA) gpA.onclick = () => playList(list, 0, false, name);
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
  const gnB = $('g-n'); const elB = $('g-list');
  if (!gnB || !elB) return;
  gnB.textContent = list.length;
  if (!list.length) elB.innerHTML = `<div class="empty">Nothing from this album is here yet. Use Download album to fetch the full tracklist.</div>`;
  else list.forEach((t, i) => { registerRow(t); elB.appendChild(trow(t, i, list)); });
  const gpB = $('g-play'); if (gpB) gpB.onclick = () => { if (list.length) playList(list, 0, false, name); };
  $('g-dl').onclick = async () => {
    const btn = $('g-dl');
    const label = btn.textContent;
    btn.disabled = true;
    // the catalogue lookup can take a moment; say so instead of looking frozen
    btn.textContent = 'Checking the tracklist…';
    try {
      const r = await api('/api/albums/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      toast(r.queued ? `Downloading ${r.queued} of ${r.total} tracks` : 'Everything on this album is already here', 6000);
      if (r.queued) { openDownloads(); refreshView(); }
    } catch { toast('Could not queue the album', 4000); }
    btn.textContent = label;
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
      ${lib.catalogue ? `<span>·</span><span>${lib.catalogue} catalogue-only</span>` : ''}
      <span>·</span><span>${d.active} running</span><span>·</span><span>${d.queued} queued</span>${d.failed ? `<span>·</span><span class="warn-txt">${d.failed} failed</span>` : ''}
    </div>
    <div class="dl-libbar"><i style="width:${pct}%"></i></div>
    <div class="dl-tools">
      ${d.failed ? `<button class="dl-act" id="dl-retry-all">Retry all failed (${d.failed})</button>` : ''}
      ${(d.active + d.queued) ? `<button class="dl-act" id="dl-cancel-all">Cancel all (${d.active + d.queued})</button>` : ''}
      ${lib.missing && !(d.active + d.queued) ? `<button class="dl-act" id="dl-fill">Fill ${lib.missing} missing track${lib.missing === 1 ? '' : 's'}</button>` : ''}
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
  const ahead = state.settings && state.settings.prefetch_ahead != null ? Number(state.settings.prefetch_ahead) : 2;
  if (ahead <= 0) return;
  const next = state.queue[state.qi + 1];
  if (next) prefetchTrack(next);
  const after = state.queue[state.qi + 2];
  if (ahead >= 2 && after) setTimeout(() => prefetchTrack(after), 6000);
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
  try { audio.volume = targetVolume(); } catch {}
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
  if (audio.duration && audio.duration > 1 && !state._advancing && audio.currentTime > audio.duration - 0.4) {
    state._advancing = true;
    setStatus('Next track');
    setTimeout(() => { state._advancing = false; }, 2500);
    nextTrack();
    return;
  }
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
  $('np-badge').textContent = `${rung} ${q}`;
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
let continuing = false;
function nextTrack() {
  if (!state.queue.length) return;
  if (state.repeat && state.qi >= state.queue.length - 1) return playAt(0);
  if (state.qi >= state.queue.length - 1) {
    // end of the playlist: keep the vibe going from the last track instead of stopping
    if (state.settings && state.settings.autoplay_next === false) { audio.pause(); return; }
    continueQueue();
    return;
  }
  playAt(state.qi + 1);
}
async function continueQueue() {
  if (continuing) return;
  continuing = true;
  const last = state.queue[state.queue.length - 1];
  try {
    const list = await api(`/api/radio/${last.id}`, { nocache: true });
    const have = new Set(state.queue.map((t) => t.id));
    const add = (list || []).filter((t) => t && !have.has(t.id)).slice(0, 15);
    if (add.length) {
      state.queue.push(...add);
      toast('Continuing with similar tracks', 3000);
      playAt(state.qi + 1);
    } else {
      audio.pause();
    }
  } catch { audio.pause(); }
  continuing = false;
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
audio.addEventListener('ended', () => { setStatus('Next track'); nextTrack(); });
audio.addEventListener('waiting', () => setStatus('Buffering'));
audio.addEventListener('playing', () => setStatus(null));
audio.addEventListener('stalled', () => setStatus('Reconnecting'));
audio.addEventListener('pause', () => { if (!audio.ended) setStatus(null); });
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
// collapsible sidebar: the toggle lives inside it, collapsed is an icon rail
(() => {
  const app = $('app');
  const btn = $('side-collapse');
  if (!app || !btn) return;
  const apply = (c) => {
    app.classList.toggle('side-collapsed', c);
    btn.title = c ? 'Show sidebar' : 'Hide sidebar';
    btn.setAttribute('aria-label', btn.title);
  };
  apply(localStorage.getItem('mf-side-collapsed') === '1');
  btn.onclick = () => {
    const c = !app.classList.contains('side-collapsed');
    localStorage.setItem('mf-side-collapsed', c ? '1' : '0');
    apply(c);
  };
})();
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
$('pb-title').onclick = (e) => { e.stopPropagation(); openNowPlaying(); };
// the player bar is not a context-menu target: right click and the dots button open
// the menu, a plain click expands the now playing view
function openNowPlaying() { if (!state.current) return; $('np').hidden = false; setTimeout(fitNowPlaying, 30); }
$('pb-art').addEventListener('click', () => setTimeout(fitNowPlaying, 30), true);
document.querySelector('.pb-left').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); currentCtx(e.clientX, e.clientY); };
document.querySelector('.pb-left').onclick = (e) => {
  if (e.target.closest('button') || e.target.closest('#pb-art') || e.target.closest('#pb-artist')) return;
  openNowPlaying();
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
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Add ${ids.length} to playlist</div>` +
    state.playlists.map((p) => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeCtx(true); m.style.transform = ''; m.onclick = null;
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
  const t = toastPersistent(`Uploading ${total} file${total > 1 ? 's' : ''}…`);
  for (let i = 0; i < total; i += 1) {
    const f = files[i];
    t.update(`Uploading ${i + 1} of ${total}: ${f.name.slice(0, 34)}`);
    try { await uploadTrack(f); ok += 1; }
    catch (e) { failed += 1; }
  }
  state.allTracks = null;
  bustCache();
  t.done(failed ? `Added ${ok}, ${failed} failed` : `Added ${ok} track${ok > 1 ? 's' : ''}`, 8000);
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

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (typing) { if (e.key === 'Escape' && tag === 'INPUT') e.target.blur(); return; }
  // space belongs to the focused control, not to the player, when a control has focus
  const onControl = e.target.closest && e.target.closest('button, a, [role="button"], [role="slider"]');
  if (e.key === ' ' && !onControl) { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight' && !onControl) nextTrack();
  if (e.key === 'ArrowLeft' && !onControl) prevTrack();
  if (e.key === 'Escape') { closeCtx(); $('queue-drawer').hidden = true; }
});

/* ============ offline (service worker) ============ */
function postToSw(msg) {
  try {
    const sw = navigator.serviceWorker;
    const target = sw && (sw.controller || (state.sw && state.sw.active));
    if (target) target.postMessage(msg);
  } catch {}
}
function onSwMessage(e) {
  const d = e.data || {};
  if (d.type === 'offline-list') { state.offlineIds = new Set(d.ids || []); try { refreshView(); } catch {} }
  else if (d.type === 'offline-set') {
    if (d.on) state.offlineIds.add(d.id); else state.offlineIds.delete(d.id);
    toast(d.on ? 'Saved for offline' : 'Removed from offline', 3000);
    try { refreshView(); } catch {}
  } else if (d.type === 'offline-fail') { toast('Could not save for offline', 4000); }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', onSwMessage);
  navigator.serviceWorker.register('/sw.js').then((reg) => { state.sw = reg; }).catch(() => {});
  navigator.serviceWorker.ready.then(() => postToSw({ type: 'list-offline' })).catch(() => {});
}

/* ============ boot ============ */
async function loadPlaylists() {
  state.playlists = await api('/api/playlists', { nocache: true });
  $('pl-count').textContent = state.playlists.length;
  renderSidebar();
}
(async () => {
  const bootView = state.view; // capture before any await so an early nav wins
  try {
    try { primeFromCache(); } catch {}
    try { restoreQueue(); } catch {}
    try { const s = await api('/api/settings', { nocache: true }); state.settings = s.settings || {}; } catch { state.settings = {}; }
    await loadPlaylists();
    try { await syncLikes(); } catch {}
    paintPill();
    // do not stomp a view the user opened while boot was loading playlists
    if (state.view === bootView) renderHome();
  } catch (e) {
    $('view').innerHTML = `<div class="empty">core unreachable: ${esc(e.message)}</div>`;
  }
})();
