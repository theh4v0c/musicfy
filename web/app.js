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
  arLast: null,          // the last A&R plan, for "make it darker" within a session
  artV: 0,
  longSets: false,
  artistName: null, albumName: null,
  offlineIds: new Set(),
  tier: (() => { try { return localStorage.getItem('mf-tier') === 'listener' ? 'listener' : 'dj'; } catch { return 'dj'; } })(),
};

function applyTier(tier, persist = true) {
  state.tier = tier === 'listener' ? 'listener' : 'dj';
  document.body.classList.toggle('tier-listener', state.tier === 'listener');
  if (persist) { try { localStorage.setItem('mf-tier', state.tier); } catch {} }
  if (state.tier === 'listener' && state.view === 'djexport') nav('home');
}
applyTier(state.tier, false);
const LOC = () => (window.I18N && window.I18N.lang === 'pt-BR' ? 'pt-BR' : 'en');
const tr = (s) => (window.I18N ? window.I18N.t(String(s ?? '')) : String(s ?? ''));
/* One in-app dialog for every confirmation and one-line prompt. A native confirm() is
   invisible in an installed web app and ignores the interface language. */
let askDone = null;
function askDialog(opts = {}) {
  const dlg = $('ask-dialog');
  if (!dlg) return Promise.resolve(opts.value !== undefined ? String(opts.value ?? '') : true);
  const title = $('ask-title');
  const msg = $('ask-message');
  const input = $('ask-input');
  const ok = $('ask-ok');
  const cancel = $('ask-cancel');
  const isPrompt = opts.value !== undefined;
  title.textContent = opts.title || '';
  title.parentElement.hidden = !opts.title;
  msg.textContent = opts.message || '';
  msg.hidden = !opts.message;
  input.hidden = !isPrompt;
  input.value = isPrompt ? String(opts.value ?? '') : '';
  ok.textContent = opts.confirm || (isPrompt ? tr('Save') : tr('Confirm'));
  cancel.textContent = opts.cancel || tr('Cancel');
  if (dlg.open) dlg.close();
  return new Promise((resolve) => {
    const finish = (value) => {
      if (askDone !== finish) return;
      askDone = null;
      if (dlg.open) dlg.close();
      resolve(value);
    };
    askDone = finish;
    ok.onclick = () => finish(isPrompt ? input.value.trim() : true);
    cancel.onclick = () => finish(isPrompt ? null : false);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
    dlg.oncancel = (e) => { e.preventDefault(); finish(isPrompt ? null : false); };
    dlg.onclick = (e) => { if (e.target === dlg) finish(isPrompt ? null : false); };
    dlg.showModal();
    setTimeout(() => { if (isPrompt) { input.focus(); input.select(); } else ok.focus(); }, 20);
  });
}
const uiConfirm = (message, opts = {}) => askDialog({ ...opts, message }).then((v) => v === true);
const uiPrompt = (message, value = '', opts = {}) => askDialog({ ...opts, message, value }).then((v) => (typeof v === 'string' ? v : null));

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
const fmtSize = (bytes) => `${(Number(bytes || 0) / 1e9).toLocaleString(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
const artUrl = (t, s) => t && t.has_art ? `/api/cover/${t.id}?s=${s}&v=${state.artV || 0}` : null;
// deterministic gradient from a seed, so every placeholder has its own colour, not a flat box
function gradFor() {
  // real artwork is the only source of colour. A generated rainbow made one row of
  // covers look like a different product; the placeholder is a quiet surface instead.
  return 'linear-gradient(135deg, var(--bg-elev2), var(--bg-elev))';
}
const ph = (t, cls) => {
  const seed = t ? `${t.artist || ''}${t.title || ''}` : '?';
  const letter = (t ? (t.title || '?') : '?').charAt(0).toUpperCase();
  return `<div class="${cls} ph" style="background:${gradFor(seed)};color:var(--fg-mute)">${esc(letter)}</div>`;
};
// uniform artwork setter: always a div with a background image, never a stale <img src>
function setArt(elId, url, letter) {
  const el = $(elId); if (!el) return;
  const base = (el.className || '').replace(/\bph\b/g, '').trim();
  if (url) {
    el.outerHTML = `<div id="${elId}" class="${base}" style="background-image:url('${url}');background-size:cover;background-position:center"></div>`;
  } else {
    el.outerHTML = `<div id="${elId}" class="${base} ph" style="background:${gradFor(letter || '?')};color:var(--fg-mute)">${esc((letter || '?').charAt(0).toUpperCase())}</div>`;
  }
}
const artTag = (t, cls, size) => artUrl(t, size)
  ? `<img class="${cls}" src="${artUrl(t, size)}" alt="" loading="lazy" decoding="async" fetchpriority="low" draggable="false">`
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
  // the interface language travels with every request: the agent answers in it, and a
  // server that knows the language does not need the page to translate its prose
  const lang = (window.I18N && window.I18N.lang) || 'en';
  let r;
  try {
    // a read after a write must not come from the HTTP cache either: the app cache was
    // bypassed, the transport was not, so a deleted playlist could still be in the answer
    const fetchOpts = { signal: ctl.signal, ...(opts || {}), cache: bypass ? 'no-store' : 'default', headers: { 'x-mf-lang': lang, ...((opts && opts.headers) || {}) } };
    r = await fetch(p, fetchOpts);
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
// metadata is the one place values are written, so it is a real dialog: native focus
// trap, Escape and backdrop, one primary Save. The sheet menu stays for actions.
function openMetaDialog({ title, subtitle, fields, onSave, saveLabel }) {
  const d = $('meta-dialog');
  const form = $('meta-form');
  $('meta-dialog-title').textContent = title;
  const sub = $('meta-dialog-sub');
  sub.textContent = subtitle || '';
  sub.hidden = !subtitle;
  $('meta-save').textContent = saveLabel || 'Save';
  const err = $('meta-error');
  err.hidden = true; err.textContent = '';
  $('meta-fields').innerHTML = fields.map((f) => {
    const input = `<input id="mf-${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}>`;
    if (!f.toggle) return `<label class="meta-field"><span>${esc(f.label)}</span>${input}</label>`;
    return `<div class="meta-toggle">
      <label class="meta-check"><input type="checkbox" id="mf-${f.key}-on"${f.checked ? ' checked' : ''}> ${esc(f.toggleLabel || `Set ${String(f.label).toLowerCase()}`)}</label>
      <label class="meta-field"><span>${esc(f.label)}</span>${input}</label>
    </div>`;
  }).join('');
  const sync = () => {
    for (const f of fields) {
      if (!f.toggle) continue;
      const on = d.querySelector(`#mf-${f.key}-on`).checked;
      const input = d.querySelector(`#mf-${f.key}`);
      input.disabled = !on;
      input.closest('.meta-field').classList.toggle('off', !on);
    }
  };
  for (const f of fields) if (f.toggle) d.querySelector(`#mf-${f.key}-on`).onchange = sync;
  sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    for (const f of fields) {
      if (f.toggle && !d.querySelector(`#mf-${f.key}-on`).checked) continue;
      body[f.key] = d.querySelector(`#mf-${f.key}`).value.trim();
    }
    const btn = $('meta-save');
    btn.disabled = true;
    try {
      const problem = await onSave(body);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      d.close();
    } catch {
      err.textContent = 'Could not save those changes';
      err.hidden = false;
    } finally { btn.disabled = false; }
  };
  $('meta-cancel').onclick = () => d.close();
  if (!d.open) d.showModal();
  const first = d.querySelector('.meta-fields input:not([type="checkbox"])');
  if (first) setTimeout(() => first.focus(), 30);
}

// in-app metadata editor for one track
function ctxRename(t) {
  closeCtx(true);
  openMetaDialog({
    title: 'Edit metadata',
    subtitle: [t.artist, t.title].filter(Boolean).join(' - '),
    fields: [
      { key: 'title', label: 'Title', value: t.title },
      { key: 'artist', label: 'Artist', value: t.artist },
      { key: 'album', label: 'Album', value: t.album },
      { key: 'year', label: 'Year', value: t.year, inputmode: 'numeric', placeholder: 'e.g. 2002' },
    ],
    onSave: async (body) => {
      const res = await fetch(`/api/tracks/${t.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || 'Could not save this track';
      state.allTracks = null;
      bustCache();
      toast('Metadata saved', 4000);
      refreshView();
      return null;
    },
  });
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
    ${t.has_art ? '<button data-act="cover-pl">Use this cover for a playlist</button>' : ''}
    ${(hasAudio(t) && Number(t.bitrate || 0) > 0 && Number(t.bitrate) < 180000) ? '<button data-act="upgrade">Find higher quality</button>' : ''}
    ${hasAudio(t) ? '<button data-act="tofile">Download to device</button>' : ''}
    ${hasAudio(t) ? `<button data-act="analyze">${t.bpm ? 'Re-analyze' : 'Analyze'} BPM &amp; key</button>` : ''}
    ${hasAudio(t) ? '<button data-act="tags">Write Traktor tags</button>' : ''}
    ${hasAudio(t) ? `<button data-act="offline">${state.offlineIds && state.offlineIds.has(t.id) ? 'Remove from offline' : 'Save for offline'}</button>` : ''}
    <button data-act="addpl">Add to playlist</button>
    ${state.view === 'playlist' && state.playlistId ? '<button data-act="rmpl">Remove from this playlist</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="rename">Edit metadata</button>' : ''}
    ${(!t.ladder && t.id) ? '<button data-act="repair">Fix metadata</button>' : ''}
    ${(!t.ladder && t.id && t.meta_locked) ? '<button data-act="unlock">Let catalogue fix metadata</button>' : ''}
    ${(!t.ladder && t.id) ? `<button data-act="deltrack">${state.selectedIds.size > 1 && state.selectedIds.has(t.id) ? `Delete ${state.selectedIds.size} selected` : 'Delete from library'}</button>` : ''}
    <button data-act="radiostart">Start track radio</button>`;
  m.classList.add('open');
  placeCtx(x, y);
  // the goo runs after the sheet is measured at full size, or the clamp is wrong
  m.classList.remove('goo');
  void m.offsetWidth;
  m.classList.add('goo');
}
// keep the sheet fully on screen, even when it is taller than the space below the finger
function placeCtx(x, y) {
  const m = $('ctx');
  if (!m) return;
  // desktop has a transport docked at the bottom: a menu that ends under it looks cut
  const bar = document.querySelector('.playerbar');
  const dock = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
  const floor = innerHeight - dock - 8;
  const r = m.getBoundingClientRect();
  const maxH = Math.max(160, floor - 8);
  m.style.maxHeight = maxH + 'px';
  const h = m.getBoundingClientRect().height;
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, floor - h)) + 'px';
  // tell the reader there is more when the list is taller than the space
  m.classList.toggle('scrolls', m.scrollHeight > m.clientHeight + 1);
}

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
      const keyTxt = r.key ? keyLabel(r) : 'key n/a';
      toast(`Analysed · ${bpmTxt} · ${keyTxt}`, 6000);
      state.allTracks = null; afterWrite(); refreshView();
    } catch { pp.done(); toast('Analysis failed', 5000); }
    return;
  }
  if (act === 'tags') {
    try {
      const dry = await api(`/api/tracks/${t.id}/tags?dryRun=1`, { method: 'POST', nocache: true });
      if (dry.error) return toast(dry.error, 6000);
      const ok = await uiConfirm(`${tr('Write Traktor + ID3 tags into the file?')}\n\n${dry.file}\nFrames: ${(dry.frames || []).join(', ')}\n\n${tr('A .mf.bak backup is kept once.')}`);
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
    if (!('serviceWorker' in navigator)) { toast('Offline playback needs HTTPS - open the https:// URL', 6000); return; }
    const on = !(state.offlineIds && state.offlineIds.has(t.id));
    postToSw(on ? { type: 'cache-track', id: t.id } : { type: 'uncache-track', id: t.id });
    toast(on ? 'Saving for offline…' : 'Removed from offline', 4000);
    return;
  }
    if (act === 'upgrade') {
      closeCtx();
      try {
        const r = await api(`/api/tracks/${t.id}/download`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ upgrade: true }),
        });
        if (!r.job) { toast('Could not queue an upgrade', 4000); return; }
        const pp = progressPill(`Checking for a better copy of ${(t.title || 'track').slice(0, 40)}…`);
        const j = await pollJob(r.job, (job) => { if (job && job.progress) pp.update(`Checking… ${Math.round(job.progress)}%`); });
        pp.done();
        if (!j) { toast('Upgrade is still running in the background', 6000); return; }
        if (j.state === 'done' && /kept the higher quality/i.test(j.detail || '')) {
          toast('No better copy found - your current file is the best available', 7000);
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
      if (!(await uiConfirm(`${tr('Apply these corrections?')}\n\n${p.reasons.join('\n')}`))) return;
      const r = await api(`/api/repair/${t.id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.after) });
      if (r.error) return toast(r.error, 6000);
      patchTrackEverywhere(t.id, p.after);
      toast(`Fixed ${r.changed} fields`, 5000);
    } catch { toast('Repair failed', 4000); }
    return;
  }
  if (act === 'unlock') {
    try {
      await api(`/api/tracks/${t.id}/unlock`, { method: 'POST' });
      t.meta_locked = null;
      toast('Catalogue can correct this track now', 4000);
    } catch { toast('Could not release the lock', 4000); }
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
  if (act === 'cover-pl') { openCoverToPlaylist(t); return; }
  if (act === 'deltrack') {
    // the menu knows about the selection: right-clicking one of twelve selected tracks
    // means the twelve, not the one under the cursor
    const many = state.selectedIds.size > 1 && state.selectedIds.has(t.id);
    const ids = many ? [...state.selectedIds] : [t.id];
    if (many) { await deleteTracks(ids); return; }
    const msg = hasAudio(t)
      ? tr(`Delete "${t.title}"? The audio file is removed from disk and the track disappears from every playlist.`)
      : tr(`Delete "${t.title}" from the library?`);
    if (!(await uiConfirm(msg))) return;
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

/* Delete any number of tracks: one confirmation, one request, one refresh. */
async function deleteTracks(input) {
  const ids = [...new Set((input || []).map(Number).filter(Boolean))];
  if (!ids.length) return;
  const all = state.allTracks || [];
  const withAudio = ids.filter((id) => { const t = all.find((x) => x.id === id) || (state._rows && state._rows.get(id)); return t && hasAudio(t); });
  const one = ids.length === 1;
  const msg = one
    ? (withAudio.length ? 'Delete this track? The audio file is removed from disk and it disappears from every playlist.' : 'Delete this track from the library?')
    : `Delete ${ids.length} tracks?${withAudio.length ? ` ${withAudio.length} audio file${withAudio.length === 1 ? ' is' : 's are'} removed from disk` : ''} and they disappear from every playlist.`;
  if (!(await uiConfirm(tr(msg), { confirm: tr('Delete') }))) return;

  // the rows go at once, so a forty track delete does not crawl
  for (const id of ids) document.querySelectorAll(`.trow[data-tid="${id}"]`).forEach((r) => r.remove());
  const scrolls = [...document.querySelectorAll('.view, .list-scroll')].map((el) => el.scrollTop);
  const winY = window.scrollY;

  let deleted = 0;
  try {
    const r = await api('/api/tracks/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    deleted = r.deleted || 0;
  } catch {
    toast('Delete failed', 4000);
    refreshView();
    return;
  }

  // the queue drops them; if the playing track was one of them it keeps playing until
  // the end of the file, then the queue continues without it
  const wasCurrent = state.current && ids.includes(state.current.id);
  state.queue = state.queue.filter((q) => !ids.includes(q.id));
  if (state.qi >= state.queue.length) state.qi = state.queue.length - 1;
  saveQueue();

  clearSelection();
  state.allTracks = null;
  afterWrite();
  await loadPlaylists().catch(() => {});
  refreshView();
  requestAnimationFrame(() => {
    [...document.querySelectorAll('.view, .list-scroll')].forEach((el, i) => { if (scrolls[i] != null) el.scrollTop = scrolls[i]; });
    window.scrollTo(0, winY);
  });
  toast(`Deleted ${deleted} track${deleted === 1 ? '' : 's'}${wasCurrent ? ' - the current one keeps playing until the end' : ''}`, 5000);
}

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

/* Metadata repair changes a few fields, not the page. Re-render everything and the view
   flashes and jumps for a title; patch the objects and the visible nodes instead. */
function patchTrackEverywhere(id, fields) {
  if (id == null || !fields) return;
  const merge = (o) => { if (o && Number(o.id) === Number(id)) Object.assign(o, fields); };
  if (state.allTracks) state.allTracks.forEach(merge);
  if (state._currentList) state._currentList.forEach(merge);
  if (state._rows && state._rows.get(Number(id))) Object.assign(state._rows.get(Number(id)), fields);
  state.queue.forEach(merge);
  merge(state.current);
  const t = (state._rows && state._rows.get(Number(id))) || state.current || fields;
  document.querySelectorAll(`.trow[data-tid="${id}"]`).forEach((row) => {
    const tt = row.querySelector('.tt'); if (tt) tt.textContent = t.title || '';
    const artist = row.querySelector('.tartist .alink'); if (artist) artist.textContent = t.artist || 'unknown artist';
    const talbum = row.querySelector('.talbum .alink'); if (talbum) talbum.textContent = t.album || '';
    const talArtist = row.querySelector('.tal-artist'); if (talArtist) talArtist.textContent = t.artist || '';
    const albumLinks = row.querySelectorAll('.talbum-line .alink');
    if (albumLinks.length) albumLinks[albumLinks.length - 1].textContent = t.album || '';
  });
  document.querySelectorAll(`.tcard[data-id="${id}"]`).forEach((card) => {
    const name = card.querySelector('.tcard-name'); if (name) name.textContent = t.title || '';
    const artist = card.querySelector('.tcard-artist'); if (artist) artist.textContent = t.artist || '';
  });
  if (state.current && Number(state.current.id) === Number(id)) paintNowPlaying();
  // the next full read must see the server's copy, not a 90-second-old cached list
  try { localStorage.removeItem(CACHE_PREFIX + '/api/tracks'); } catch {}
}

/* ============ toasts ============ */
function toast(msg, ms = 2600) {
  const host = $('toasts');
  // never let a burst of toasts fill the screen
  while (host.children.length >= 4) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = tr(msg);
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
  el.textContent = tr(initial);
  return {
    update(t) { el.textContent = tr(t); },
    done(finalMsg, ms = 6000) {
      el.textContent = tr(finalMsg);
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
  el.innerHTML = `<span>${esc(tr(text))}</span><i></i>`;
  el.classList.add('on');
  return {
    update(t) { const s = el.querySelector('span'); if (s) s.textContent = tr(t); },
    done() { el.classList.remove('on'); },
  };
}

/* A repair runs a catalogue lookup per track, so it is watched rather than awaited:
   the result is the point, and "started" is not a result. */
async function watchRepair(url) {
  const pill = progressPill('Checking metadata…');
  try {
    const r = await api(url, { method: 'POST' });
    if (!r.started && r.note) { pill.done(); toast(r.note, 5000); return; }
    let j = r.job || { running: true, total: r.count, done: 0 };
    for (let i = 0; i < 300 && j.running; i += 1) {
      pill.update(`Fixing metadata ${j.done || 0}/${j.total || r.count}`);
      await new Promise((res) => setTimeout(res, 1200));
      j = await api(url, { nocache: true }).catch(() => j);
    }
    pill.done();
    const parts = [];
    if (j.fixed) {
      const bits = Object.entries(j.fields || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`);
      parts.push(`${j.fixed} changed${bits.length ? ` (${bits.join(' · ')})` : ''}`);
    }
    if (j.same) parts.push(`${j.same} already correct`);
    if (j.failed) parts.push(`${j.failed} could not be changed`);
    toast(`Metadata: ${j.done || j.total} checked - ${parts.join(', ') || 'nothing to do'}`, 9000);
    if (j.fixed) {
      if (Array.isArray(j.changes) && j.changes.length) {
        for (const c of j.changes) patchTrackEverywhere(c.id, c);
      } else {
        // older server: preserve the scroll position instead of jumping to the top
        const view = document.getElementById('view');
        const top = view ? view.scrollTop : 0;
        bustCache(); state.allTracks = null;
        setTimeout(() => { try { refreshView(); if (view) view.scrollTop = top; } catch {} }, 300);
      }
    }
  } catch (e) {
    pill.done();
    toast(`Metadata repair failed (${e.message || 'request'})`, 6000);
  }
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
      const name = await uiPrompt(tr('Playlist name:')); if (!name) return;
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
/* Paint every heart that shows this track from one place, so the row, the bar and the
   cover can never disagree about the same track. */
function paintLike(t) {
  if (!t || t.id == null) return;
  const on = isLiked(t);
  const icon = on ? IC.heartFull : IC.heart;
  document.querySelectorAll(`.trow[data-tid="${t.id}"] .like`).forEach((b) => {
    b.innerHTML = icon;
    b.classList.toggle('on', on);
  });
  if (state.current && state.current.id === t.id) {
    ['pb-like', 'np-like', 'mini-like'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = icon;
      el.classList.toggle('on', on);
    });
  }
}

const likeInFlight = new Set();
async function toggleLike(t) {
  if (!t || t.id == null || likeInFlight.has(t.id)) return;
  likeInFlight.add(t.id);
  const wasLiked = isLiked(t);
  if (wasLiked) { state.liked.delete(t.id); if (serverLiked) serverLiked.delete(t.id); }
  else { state.liked.add(t.id); if (serverLiked) serverLiked.add(t.id); }
  saveLiked();
  paintLike(t);
  toast(wasLiked ? 'Removed from Liked Songs' : 'Added to Liked Songs');
  try {
    await api('/api/likes', {
      method: wasLiked ? 'DELETE' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track_id: t.id }),
    });
  } catch {
    // the server refused: put the heart back rather than keep a state the library does
    // not have. This is the one that looked like "the like is on the wrong cover".
    if (wasLiked) { state.liked.add(t.id); if (serverLiked) serverLiked.add(t.id); }
    else { state.liked.delete(t.id); if (serverLiked) serverLiked.delete(t.id); }
    saveLiked();
    paintLike(t);
    toast('Could not save that like');
  } finally {
    likeInFlight.delete(t.id);
    paintLike(t);
  }
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
const DETAIL_VIEWS = new Set(['playlist', 'artist', 'album', 'import']);
function paintBack() {
  const el = $('back');
  if (el) el.hidden = !(DETAIL_VIEWS.has(state.view) && state.history.length);
}
function setNav(v) {
  state.view = v;
  document.querySelectorAll('.snav-btn').forEach(b => {
    const on = b.dataset.nav === v;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // the bottom bar is the phone's destination list: A&R is one of them, Prep is desktop
  // Studio only. Every view has exactly one active tab.
  document.querySelectorAll('.bn-btn').forEach(b => {
    const on = b.dataset.nav === v;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // the library size is only useful where you manage the library; everywhere else it is noise
  const pill = $('pill'); if (pill) pill.hidden = v !== 'songs';
}
function nav(v, push = true) {
  if (state.tier === 'listener' && v === 'djexport') v = 'home';
  closeInlinePreview();
  const qd = $('queue-drawer'); if (qd) qd.hidden = true;
  if (typeof clearSelection === 'function') clearSelection();
  if (push && state.view && v !== state.view) state.history.push({ v: state.view, pid: state.playlistId });
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
  paintBack();
}
function goBack() {
  const h = state.history.pop() || { v: 'home' };
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
    const name = await uiPrompt(tr('New playlist name:')); if (!name) return;
    await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind: 'listen' }) });
    afterWrite();
    await loadPlaylists();
    toast('Listening playlist created - switch it to DJ set when you want it prepped');
  };
  el.appendChild(add);
  const imp = document.createElement('button');
  imp.className = 'slib-add';
  imp.textContent = '+ Import Spotify playlist';
  imp.onclick = async () => {
    const url = await uiPrompt(tr('Paste a Spotify playlist link or ID:'));
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
  const items = [liked, ...numberedPlaylists(state.playlists)].filter(matchesPlFilter);
  for (const p of items) {
    const row = document.createElement('div');
    row.className = 'slib-item' + (state.playlistId === p.id ? ' on' : '');
    row.innerHTML = p.liked
      ? `<div class="slib-art ph" style="display:flex;align-items:center;justify-content:center;color:var(--liked)">${IC.heartFull}</div>
         <div style="min-width:0"><div class="slib-name">Liked Songs</div><div class="slib-sub">${p.n} ${Number(p.n) === 1 ? 'song' : 'songs'}</div></div>`
      : `<img class="slib-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=88&v=${state.artV || 0}" alt="" loading="lazy" data-cover-hide>
         <div style="min-width:0"><div class="slib-name"><span class="pl-idx">${idxLabel(p.idx)}</span>${esc(p.name)}</div><div class="slib-sub">${p.n_tracks} ${Number(p.n_tracks) === 1 ? 'track' : 'tracks'}</div></div>`;
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
function uploadToPlaylist(pid) {
  pickFiles('audio/*', async (files) => {
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
}

function openPlaylistMenu(p, x, y) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title"><span class="ctx-name">${esc(p.name)}</span></div>
    <button data-act="pl-play">Play</button>
    <button data-act="pl-upload">Upload tracks</button>
    <button data-act="pl-rename">Rename</button>
    <button data-act="pl-cover">Change cover</button>
    <button data-act="pl-cover-track">Use a track's cover</button>
    <button data-act="pl-repair">Fix metadata (crate)</button>
    <button data-act="pl-fixcovers">Fix album covers (crate)</button>
    <button data-act="pl-upgrade">Find higher quality (crate)</button>
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
    // Ask for confirmation inside the sheet. A native confirm() is invisible in some
    // installed web apps; the menu closed and the button looked dead.
    if (act === 'pl-delete') {
      m.innerHTML = `<div class="ctx-title">${tr('Delete playlist')} “${esc(p.name)}”?</div>
        <button data-act="pl-delete-yes">${tr('Delete playlist')}</button>
        <button data-act="pl-delete-no">${tr('Keep it')}</button>`;
      m.onclick = async (ev) => {
        const bb = ev.target.closest('button'); if (!bb) return;
        if (bb.dataset.act === 'pl-delete-no') { closeCtx(true); m.onclick = null; return; }
        closeCtx(true); m.onclick = null;
        try {
          await api(`/api/playlists/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
          afterWrite(); await loadPlaylists();
          toast('Playlist deleted. Tracks are still in Songs.');
          if (state.playlistId === p.id) { state.playlistId = null; state.history = []; nav('home'); }
          else refreshView();
        } catch (err) { toast(`Could not delete: ${err.message || err}`, 5000); }
      };
      return;
    }
    closeCtx(true); m.onclick = null;
    if (act === 'pl-play') { playPlaylist(p.id); return; }
    if (act === 'pl-upload') { uploadToPlaylist(p.id); return; }
    if (act === 'pl-cover') { uploadPlaylistCover(p.id); return; }
    if (act === 'pl-cover-track') { openCoverPicker(p.id); return; }
    if (act === 'pl-repair') {
      await watchRepair(`/api/playlists/${encodeURIComponent(p.id)}/repair`);
      return;
    }
    if (act === 'pl-fixcovers') {
      try { const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/covers`, { method: 'POST' }); toast(`Updating covers for ${r.count} tracks in the background`, 7000); setTimeout(() => { state.artV = Date.now(); }, 6000); } catch { toast('Could not start cover repair', 4000); }
      return;
    }
    if (act === 'pl-upgrade') {
      try { const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/upgrade`, { method: 'POST' }); toast(r.queued ? `${r.queued} higher quality downloads queued` : 'No low-bitrate tracks to upgrade', 6000); if (r.queued) toast(`${r.queued} queued - see Downloads for progress`, 6000); } catch { toast('Could not queue upgrades', 4000); }
      return;
    }
    if (act === 'pl-m3u') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export.m3u`; return; }
    if (act === 'pl-rb') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/rekordbox.xml`; return; }
    if (act === 'pl-tr') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/traktor.nml`; return; }
    if (act === 'pl-usb') { window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/pioneer.zip`; return; }
    if (act === 'pl-tags') {
      try {
        const dry = await api(`/api/playlists/${encodeURIComponent(p.id)}/tags?dryRun=1`, { method: 'POST' });
        const ok = (dry.results || []).filter((r) => !r.skipped && !r.error).length;
        if (!ok) { toast('No MP3s to tag in this playlist', 4000); return; }
        if (!(await uiConfirm(`${tr('Write Traktor + ID3 tags into')} ${ok} ${tr('file(s)?')}\n\n${tr('A .mf.bak backup is kept once per file.')}`))) return;
        const pp = progressPill(`Tagging ${ok} files…`);
        const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/tags`, { method: 'POST' });
        pp.done();
        toast(`Tagged ${r.count} files`, 5000);
      } catch { toast('Could not write tags', 4000); }
      return;
    }
    if (act === 'pl-zip') { toast('Building the zip, this can take a minute', 6000); window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/zip`; return; }
    if (act === 'pl-rename') {
      const name = await uiPrompt(tr('Rename playlist:'), p.name); if (!name) return;
      await api(`/api/playlists/${encodeURIComponent(p.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      afterWrite(); await loadPlaylists(); toast('Renamed');
      if (state.playlistId === p.id) openPlaylist(p.id, false);
      return;
    }

  };
}

/* long press helper: fires fn after 500ms hold, suppresses the trailing click */
// wires both gesture and mouse: long press on a phone, right click on a desktop
// simple action list for cards: desktop right click or phone long press
function openCardMenu(title, actions, x, y) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title"><span class="ctx-name">${esc(title)}</span></div>` +
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

/* a click should leave a mark: a lens ring from the pointer, and a short press.
   no canvas, no WebGL, and nothing at all under reduce-motion. */
function rippleAt(el, x, y) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const size = Math.max(r.width, r.height) * 1.2;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${(x || r.left + r.width / 2) - r.left - size / 2}px`;
  span.style.top = `${(y || r.top + r.height / 2) - r.top - size / 2}px`;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(span);
  el.classList.remove('pressed');
  void el.offsetWidth;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 140);
  span.addEventListener('animationend', () => span.remove(), { once: true });
  setTimeout(() => span.remove(), 700);
}
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .flow-key, .mpick, .mtile, .tcard, .pcard, .qtile, .crate, .snav-btn, .bn-btn, .dl-act, .mode-tab, .ask-ex, .action-chip');
  if (el) rippleAt(el, e.clientX, e.clientY);
}, { passive: true });

/* ============ views ============ */
const greetPart = () => { const h = new Date().getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };

/* one control vocabulary: the same three views everywhere a list can be shown */
const VIEW_ICONS = {
  list: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3h9M5 8h9M5 13h9"/><circle cx="2" cy="3" r=".9" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="2" cy="13" r=".9" fill="currentColor" stroke="none"/></svg>',
  grid: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  compact: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="3" height="3" rx="1"/><rect x="7" y="2" width="3" height="3" rx="1"/><rect x="12" y="2" width="2" height="3" rx="1"/><rect x="2" y="7" width="3" height="3" rx="1"/><rect x="7" y="7" width="3" height="3" rx="1"/><rect x="12" y="7" width="2" height="3" rx="1"/><rect x="2" y="12" width="3" height="2" rx="1"/><rect x="7" y="12" width="3" height="2" rx="1"/><rect x="12" y="12" width="2" height="2" rx="1"/></svg>',
};
const VIEW_LABELS = { list: 'List', grid: 'Grid', compact: 'Compact' };
/* A genre tag is a family if we have one, otherwise a real genre. Role words that iTunes
   returns in the genre field ("Composer", "Actress") are not genres and are not shown. */
const NOT_A_GENRE = /^(composer|actress|actor|writer|producer|manager|author|artist)$/i;
function genreTag(t) {
  if (!t) return '';
  if (t.genre_family) return String(t.genre_family);
  const g = String(t.genre || '').trim();
  return g && !NOT_A_GENRE.test(g) ? g : '';
}

/* Key names, in either notation, from one setting: "Am" or "8A". The wheel values are the
   same numbers the analysis and the harmonic ordering use. */
const CAMELOT_MINOR = { 'G#': 1, 'D#': 2, 'A#': 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, 'F#': 11, 'C#': 12 };
const CAMELOT_MAJOR = { B: 1, 'F#': 2, 'C#': 3, 'G#': 4, 'D#': 5, 'A#': 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const FLAT_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const keyFormat = () => (state.settings && state.settings.key_format) === 'camelot' ? 'camelot' : 'notes';
function keyLabel(t) {
  if (!t || !t.key) return '';
  const minor = String(t.key_scale || '').toLowerCase() === 'minor';
  if (keyFormat() === 'notes') return `${t.key}${minor ? 'm' : ''}`;
  const k = FLAT_SHARP[t.key] || String(t.key).replace('♯', '#');
  const n = (minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[k];
  return n ? `${n}${minor ? 'A' : 'B'}` : `${t.key}${minor ? 'm' : ''}`;
}

const songView = () => { try { return localStorage.getItem('mf-view-songs') || 'list'; } catch { return 'list'; } };
const libView = () => { try { return localStorage.getItem('mf-view-library') || 'grid'; } catch { return 'grid'; } };
const plView = () => { try { return localStorage.getItem('mf-view-playlist') || 'list'; } catch { return 'list'; } };
function viewSwitch(scope, current) {
  return `<div class="view-switch" data-scope="${esc(scope)}" role="group" aria-label="View">${['list', 'grid', 'compact']
    .map((v) => `<button class="vw${current === v ? ' on' : ''}" data-v="${v}" title="${VIEW_LABELS[v]}" aria-pressed="${current === v}">${VIEW_ICONS[v]}</button>`)
    .join('')}</div>`;
}
function bindViewSwitch(scope, onChange) {
  document.querySelectorAll(`.view-switch[data-scope="${scope}"] .vw`).forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(`mf-view-${scope}`, b.dataset.v);
      document.querySelectorAll(`.view-switch[data-scope="${scope}"] .vw`).forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      });
      onChange(b.dataset.v);
    };
  });
}

async function renderHome() {
  setNav('home'); state.playlistId = null; renderSidebar();
  // the name, where the sidebar is not on screen to carry it
  $('view-title').innerHTML = `<span class="wordmark">MUSICFY</span><span class="view-name">${tr('Home')}</span>`;
  const v = $('view');
  v.innerHTML = `
    <section class="mast">
      <div class="mast-glow" id="mast-glow"></div>
      <div class="mast-meta"><span id="mast-clock"></span><span class="mast-flex"></span></div>
      <div class="mast-main">
        <div class="mast-copy">
          <h1 class="mast-greet" id="mast-greet">Good ${greetPart()}.</h1>
          <p class="mast-note" id="mast-note"><span class="mast-fact">${state.playlists.length} playlist${state.playlists.length === 1 ? '' : 's'}, ready when you are.</span></p>
        </div>
        <div class="mast-side">
          <button class="flow-key beam" id="flow-btn" aria-label="Start Flow">
            <span class="flow-key-k">${IC.play}</span>
            <span class="flow-key-t"><b>Flow</b><i>endless mix from what you play</i></span>
          </button>
          <button class="mast-resume" id="mast-resume" hidden></button>
        </div>
      </div>
    </section>
    <div id="rotation-slot"></div>
    <!-- the masthead greets and offers Flow; these belong to the page, after the first rail -->
    <div class="home-context">
      <div class="mast-picks" id="mast-picks" hidden></div>
    </div>
    <div id="home-lazy">
      <div id="discover-home"></div>
      <div class="sec-title">Recently played <small id="recent-hint"></small></div>
      <div class="row-scroller" id="recent-row"></div>
      <div class="sec-title">Your playlists <small>${Number(state.playlists.length).toLocaleString(LOC())} TOTAL</small></div>
      <div class="pgrid" id="home-grid"></div>
    </div>`;
  // the masthead reports the session, not the weather: time, place, what was last on
  const paintClock = () => {
    const clock = document.getElementById('mast-clock');
    if (!clock) return;
    const d = new Date();
    const day = d.toLocaleDateString(LOC(), { weekday: 'short' });
    const hm = d.toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
    clock.textContent = `${day} ${hm}`;
  };
  paintClock();
  if (state._clockTimer) clearInterval(state._clockTimer);
  state._clockTimer = setInterval(() => {
    if (!document.getElementById('mast-clock')) { clearInterval(state._clockTimer); state._clockTimer = null; return; }
    paintClock();
  }, 30000);
  api('/api/greeting', { nocache: true }).then((g) => {
    const greet = document.getElementById('mast-greet');
    const note = document.getElementById('mast-note');
    if (greet) {
      // said the way a person would say it: no "Good evening" at 2am, and a long
      // session gets acknowledged instead of a clock reading
      const hour = Number(g.hour);
      const late = hour >= 23 || hour < 5;
      const longSession = g.session && Number(g.session.minutes) >= 120;
      const phrase = late ? 'Late one' : longSession ? 'Deep in it' : (g.part === 'morning' ? 'Morning' : g.part === 'afternoon' ? 'Afternoon' : 'Evening');
      const salutation = `${phrase}${g.name ? ',' : '.'}`;
      greet.innerHTML = g.name
        ? `${esc(salutation)} <span class="mast-name">${esc(g.name)}</span>`
        : esc(salutation);
    }
    if (note) {
      const fact = String(g.fact || g.sub || '').replace(/\s*·\s*$/, '');
      note.innerHTML = fact ? `<span class="mast-fact">${esc(fact)}</span>` : '';
    }
    // the greeting already counts this week's additions; the library list may not be
    // loaded yet when the tiles first render
    if (g.stats && Number.isFinite(Number(g.stats.addedWeek))) {
      state._addedWeek = Number(g.stats.addedWeek);
    }

  }).catch(() => {});
  loadMastPicks();
  // a queue survives the session: offer to pick it up instead of starting cold
  const rq = state.queue && state.queue[state.qi];
  const resume = document.getElementById('mast-resume');
  if (resume && rq) {
    resume.hidden = false;
    resume.innerHTML = `<span class="mast-resume-k">Resume</span><b>${esc(rq.title || 'last track')}</b>`;
    resume.onclick = () => { playAt(state.qi); };
  }
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
  const rec = await loadRecentlyPlayed();
  drawRotation(rec);
  // nothing below the fold is fetched until it is about to be seen: 90 idle requests
  // on a phone delay the first play more than the audio itself does
  const lazy = document.getElementById('home-lazy');
  if (!lazy) return;
  // recents and the playlist grid cost no requests: both are already in memory, so they
  // paint at once. Only the discovery rails need the network, and only they wait.
  const paintKnown = () => {
    if (lazy.dataset.known) return;
    lazy.dataset.known = '1';
    drawRecents(rec);
    const grid = $('home-grid');
    if (grid) {
      for (const p of state.playlists.slice(0, 12)) grid.appendChild(pcard(p));
      if (state.playlists.length > 12) {
        const more = document.createElement('button');
        more.className = 'btn btn-ghost';
        more.textContent = `All ${state.playlists.length} playlists`;
        more.onclick = () => nav('library');
        grid.after(more);
      }
    }
  };
  paintKnown();
  // capture the host: a stale timer from an earlier render used to look the id up again
  // and append a second empty block into the page that replaced it
  const discoverHost = document.getElementById('discover-home');
  const fillRest = () => {
    if (!lazy.isConnected || lazy.dataset.filled) return;
    lazy.dataset.filled = '1';
    renderDiscoverInto(discoverHost);
  };
  // playback wins the network: the rails wait for a scroll, or for six quiet seconds.
  // On a phone in a car the press of play happens first, and it must not queue behind
  // fifty covers and a page of playlist art.
  let timer = setTimeout(fillRest, 6000);
  const nowFill = () => { clearTimeout(timer); fillRest(); };
  addEventListener('scroll', nowFill, { once: true, passive: true });
  audio.addEventListener('playing', () => clearTimeout(timer), { once: true });
  audio.addEventListener('pause', () => { if (!lazy.dataset.filled) timer = setTimeout(fillRest, 1500); }, { once: true });
}

// discovery rails: newest, more-from-artists-you-play, and unfiled tracks
async function renderDiscoverInto(host) {
  if (!host || host.dataset.drawn === '1') return;
  host.dataset.drawn = '1';
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
      const fresh = (list || []).filter((t) => t && t.id != null && !seen.has(t.id)).slice(0, 8);
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
      // An empty page used to be one grey sentence in the gap under the mast. It is a
      // block that says what is missing, what fills it and where the action lives. The mark
      // is an empty cover with a broken waveform in it: the app's own unit (artwork) and the
      // thing that is absent (audio), drawn in the same stroke language as the rest.
      const e = document.createElement('div');
      e.className = 'hollow';
      e.innerHTML = `<svg class="hollow-mark" viewBox="0 0 64 56" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="12" y="6" width="40" height="40" rx="7" stroke-dasharray="3 3" opacity=".6"/>
          <path d="M21 26h9M34 26h9" stroke="var(--acc)" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div>
          <b>${tr('An empty library, for now.')}</b>
          <p>${window.musicfyDesktop
            ? tr('MUSICFY plays files you already own. Add a folder with ⌘O, or download one track, and the page has something to say.')
            : tr('MUSICFY plays files you already own. Add a folder in Settings → Library folder, or download one track, and the page has something to say.')}</p>
        </div>`;
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
        card.innerHTML = `<div class="tcard-art ph" style="background:${gradFor((s.artist || '') + (s.title || ''))};color:var(--fg-mute)">${esc((s.artist || '?').charAt(0))}</div>
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
/* One source of sound at a time: a preview and the main player must never overlap, in
   either direction. Both helpers are cheap and safe to call when nothing is playing. */
function pausePreviews() {
  document.querySelectorAll('.inline-preview audio, audio.ip-audio').forEach((el) => {
    try { if (!el.paused) el.pause(); } catch {}
  });
}
function pauseMainForPreview() {
  try { if (!audio.paused) audio.pause(); } catch {}
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
    <div class="ip-status" data-status hidden></div>
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
  if (audioEl) { pauseMainForPreview(); audioEl.play().catch(() => {}); }
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
        pauseMainForPreview();
        audioEl.play().catch(() => {});
      })
      .catch(() => { if (inlinePreview === panel) noteEl.textContent = 'No preview available.'; });
  }
  const dl = panel.querySelector('[data-dl]');
  const st = panel.querySelector('[data-status]');
  const say = (text, tone) => {
    if (!st) return;
    st.hidden = !text;
    st.textContent = text || '';
    st.dataset.tone = tone || '';
  };
  dl.onclick = async () => {
    if (owned) return;
    dl.disabled = true;
    dl.textContent = 'Downloading…';
    say(`Finding “${s.title}”…`);
    try {
      const r = s.id
        ? await api(`/api/tracks/${s.id}/download`, { method: 'POST' })
        : await api('/api/ladder/download', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rung: 'search', title: s.title, artist: s.artist, duration: s.duration }) });
      // the panel stays open: this is the confirmation, and it names the track
      say(`Downloading “${s.title}”${s.artist ? ' - ' + s.artist : ''} · 0%`);
      const res = await watchDownload({
        trackId: s.id || null, job: r.job,
        onTick: (pct, state2) => {
          if (state2 === 'done') return;
          say(`Downloading “${s.title}”${s.artist ? ' - ' + s.artist : ''} · ${pct}%`);
        },
      });
      if (res.ok) {
        dl.textContent = 'Downloaded';
        say(`“${s.title}” is in your library`, 'ok');
        bustCache();
        if (s.id) markRowOwned(s.id);
        if (state.view === 'search' || state.view === 'songs') { /* rows patched in place */ }
      } else if (res.why === 'still running') {
        dl.disabled = false;
        dl.textContent = 'Still downloading';
        say('Still running in the background - it will land in your library', '');
      } else {
        dl.disabled = false;
        dl.textContent = 'Retry download';
        say(`Could not get “${s.title}”${res.why ? ' - ' + String(res.why).replace(/^error\s*/i, '').slice(0, 70) : ''}`, 'bad');
      }
    } catch (e) {
      dl.disabled = false;
      dl.textContent = 'Retry download';
      say(`Could not start: ${(e.message || 'unknown').slice(0, 70)}`, 'bad');
    }
  };
}

/* right click menu for a ladder candidate: stream it, keep it in a playlist, or download it */
function openLadderCtx(c, x, y) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title"><span class="ctx-name">${esc((c.title || '').slice(0, 40))}</span></div>
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
  c.dataset.id = t.id;
  c.innerHTML = `${artTag(t, 'tcard-art', 300)}
    <div class="tcard-name">${esc(t.title)}</div>
    <div class="tcard-sub">${t.artist ? `<button class="alink tcard-artist" type="button">${esc(t.artist)}</button>` : ''}</div>
    <button class="tcard-play" aria-label="Play ${esc(t.title)}">${IC.play}</button>`;
  const play = (e) => {
    if (e) e.stopPropagation();
    playList(list, list.indexOf(t), false, origin);
  };
  c.querySelector('.tcard-play').onclick = play;
  // a card is a record you can press, not a picture: clicking it plays it
  c.onclick = (e) => { if (e.target.closest('.alink')) return; play(e); };
  const cardArtist = c.querySelector('.tcard-artist');
  if (cardArtist) cardArtist.onclick = (e) => { e.stopPropagation(); renderArtist(t.artist); };
  const at = () => { const r = c.getBoundingClientRect(); return { x: r.left + 12, y: r.bottom - 6 }; };
  c.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openCtx(t, e.clientX, e.clientY); };
  longPress(c, () => { const p = at(); openCtx(t, p.x, p.y); });
  return c;
}

/* all time, from 175k real Spotify plays */


async function drawRotation(rec) {
  const slot = $('rotation-slot');
  if (!slot || !rec || !rec.length) return;
  const includeChildren = !!(state.settings && state.settings.taste_include_children);
  const seedTrack = includeChildren ? rec[0] : rec.find((t) => t.genre_family !== 'children');
  if (!seedTrack) return;
  const list = await api(`/api/radio/${seedTrack.id}`).catch(() => []);
  if (!list.length) return;
  const row = document.createElement('div');
  row.innerHTML = `<div class="sec-title">Your rotation <small>BUILT FROM ${esc((seedTrack.title || '').toUpperCase()).slice(0, 40)}</small></div>
    <div class="row-scroller" id="rot-row"></div>`;
  slot.appendChild(row);
  const strip = row.querySelector('#rot-row');
  list.slice(0, 12).forEach((t) => strip.appendChild(trackCard(t, list, 'Your rotation')));
}

/* three records worth pulling out, each with the reason it is there */
async function loadMastPicks(fresh) {
  const host = document.getElementById('mast-picks');
  if (!host) return;
  try {
    const d = await api(`/api/home/picks${fresh ? '?fresh=1' : ''}`, { nocache: true });
    const picks = (d.picks || []).slice(0, 3);
    if (!picks.length) { host.hidden = true; return; }
    if (!picks.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `<div class="mast-picks-head"><span>On deck</span><button class="mpick-shuffle" type="button" title="Other picks">shuffle</button></div>
      <div class="mast-picks-row">${picks.map((p) => `
        <button class="mpick" type="button" data-id="${p.id}">
          ${p.has_art
            ? `<img class="mpick-art" src="/api/cover/${p.id}?s=140&v=${state.artV || 0}" alt="" loading="lazy" decoding="async">`
            : `<span class="mpick-art ph">${esc(String(p.title || '?').charAt(0))}</span>`}
          <span class="mpick-t"><b>${esc(p.title || '')}</b><i>${esc(p.reason || '')}</i></span>
        </button>`).join('')}</div>`;
    host.querySelectorAll('.mpick').forEach((el) => {
      el.onclick = () => {
        const i = picks.findIndex((p) => p.id === Number(el.dataset.id));
        if (i < 0) return;
        playList(picks.map((p) => ({ ...p, owned: 1 })), i, false, 'On deck');
      };
    });
    const sh = host.querySelector('.mpick-shuffle');
    if (sh) sh.onclick = () => { sh.disabled = true; loadMastPicks(true); };
  } catch {
    host.hidden = true;
    const start = document.getElementById('ai-start');
    if (start) start.hidden = false;
  }
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

function plistRow(p) {
  const el = document.createElement('div');
  el.className = 'lrow';
  const liked = p.liked || p.id === '__liked';
  // the same leading play circle a track row has; the number rides on the cover
  el.innerHTML = `<button class="lrow-play" aria-label="Play">${IC.play}</button>
    <div class="lrow-artwrap">
      ${liked
        ? `<div class="lrow-art ph" style="background:linear-gradient(135deg,#ff6b47,#8a1d12)">${IC.heartFull}</div>`
        : `<img class="lrow-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=120&v=${state.artV || 0}" alt="" loading="lazy" decoding="async">`}
    </div>
    <div class="lrow-t"><b>${p.idx ? `<span class="lrow-no">${idxLabel(p.idx)}</span>` : ''}${esc(p.name)}</b><i>${p.n_tracks || 0} track${Number(p.n_tracks) === 1 ? '' : 's'}${p.kind === 'listen' ? ' · listening' : ''}</i></div>`;
  el.querySelector('.lrow-play').onclick = (e) => {
    e.stopPropagation();
    if (liked) playLiked(); else playPlaylist(p.id);
  };
  if (liked) el.onclick = () => nav('liked');
  else {
    el.onclick = () => openPlaylist(p.id);
    el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openPlaylistMenu(p, e.clientX, e.clientY); };
    longPress(el, () => openPlaylistMenu(p, innerWidth / 2 - 110, innerHeight / 2 - 80));
  }
  return el;
}

function pcard(p, idx) {
  const el = document.createElement('div');
  el.className = 'pcard';
  // the play button belongs to the cover, not to the card: otherwise every view
  // size needs its own offset and they never line up
  el.innerHTML = `
    <div class="pcard-artwrap">
      <img class="pcard-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=340&v=${state.artV || 0}" alt="" loading="lazy" draggable="false">
      <button class="pcard-play" aria-label="Play ${esc(p.name)}">${IC.play}</button>
    </div>
    <div class="pcard-name">${esc(p.name)}</div>
    <div class="pcard-sub">${idx ? `<span class="pcard-no">${idxLabel(idx)}</span> · ` : ''}${p.n_tracks} tracks${p.kind === 'listen' ? ' · listening' : ''}</div>`;
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
  setNav('library'); state.view = 'playlist'; state.playlistId = pid; paintBack();
  renderSidebar();
  $('view-title').textContent = p.name;
  const v = $('view');
  const plNo = (numberedPlaylists().find((x) => x.id === pid) || {}).idx;
  v.innerHTML = `<div class="plhead">
      ${plHeadArt(pid, p.name)}
      <div>
        <div class="plhead-kicker">PLAYLIST${plNo ? ` <span class="pl-idx">${idxLabel(plNo)}</span>` : ''}</div>
        <h1 class="plhead-name">${esc(p.name)}</h1>
        <div class="plhead-meta"><b id="pln">...</b> <span id="pln-w">tracks</span> &middot; <span id="pldur"></span><span id="plan">${p.kind === 'listen'
          ? ' &middot; listening only'
          : (!p.owned ? ' &middot; no audio'
            : (p.prepped === p.owned ? ' &middot; analysed, current' : ` &middot; ${Math.max(0, (p.owned || 0) - (p.prepped || 0))} need analysis`))}</span></div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="pl-play">${IC.play}&nbsp; Play</button>
          <button class="btn btn-ghost" id="pl-shuf">${IC.shuffle}&nbsp; Shuffle</button>
          <button class="btn btn-ghost" id="pl-harm" title="Order by harmonic key progression (Camelot)">Harmonic</button>
          <div class="kind-switch" id="pl-kind" role="group" aria-label="How this playlist is used">
            <button class="mode-tab${p.kind === 'listen' ? '' : ' on'}" data-kind="dj" title="Prepped for DJ export">DJ set</button>
            <button class="mode-tab${p.kind === 'listen' ? ' on' : ''}" data-kind="listen" title="Playback only - Prep leaves it alone">Listening</button>
          </div>
          ${viewSwitch('playlist', plView())}
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
  // how the playlist is used decides whether Prep touches it at all
  document.querySelectorAll('#pl-kind .mode-tab').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const kind = b.dataset.kind;
      if ((p.kind || 'dj') === kind) return;
      try {
        await api(`/api/playlists/${encodeURIComponent(pid)}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }),
        });
        p.kind = kind;
        const row = state.playlists.find((x) => x.id === pid);
        if (row) row.kind = kind;
        document.querySelectorAll('#pl-kind .mode-tab').forEach((x) => x.classList.toggle('on', x.dataset.kind === kind));
        toast(kind === 'listen'
          ? 'Listening only - Prep will not analyse this playlist'
          : 'DJ set - Prep will analyse it for export', 5000);
      } catch { toast('Could not change how this playlist is used', 4000); }
    };
  });
  plnEl.textContent = list.length;
  const plnW = document.getElementById('pln-w'); if (plnW) plnW.textContent = list.length === 1 ? 'track' : 'tracks';
  paintPlMode();
  const totalS = list.reduce((a, t) => a + (t.duration || 0), 0);
  pldurEl.textContent = list.length ? `${Math.round(totalS / 60).toLocaleString(LOC())} min` : '';
  state.sort = { key: 'pos', dir: 1 };
  function paintPlMode() {
    const mode = plView();
    const head = document.getElementById('pl-thead');
    if (head) head.style.display = mode === 'list' ? '' : 'none';
  }
  const renderRows = () => {
    let sorted = [...list];
    if (state.sort.key === 'pos') {
      // the stored order is the ascending one; clicking "#" asks for it reversed
      if (state.sort.dir === -1) sorted.reverse();
    } else {
      const sortKey = state.sort.key;
      sorted.sort((a, b) => {
        const va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
        const diff = typeof va === 'number' && typeof vb === 'number'
          ? (va - vb) * state.sort.dir
          : String(va).localeCompare(String(vb), LOC()) * state.sort.dir;
        // a batch shares one timestamp; the id decides inside it, so "date added" really
        // shows the newest file first instead of an arbitrary row of the batch
        return diff || (a.id - b.id) * state.sort.dir;
      });
    }
    const tl = $('tlist'); tl.innerHTML = '';
    const mode = plView();
    if (mode !== 'list') {
      // the same card as every other shelf, so a crate can be read by cover
      tl.className = `sg-grid${mode === 'compact' ? ' compact' : ''}`;
      sorted.forEach((t) => { registerRow(t); tl.appendChild(trackCard(t, sorted, p.name)); });
      return;
    }
    tl.className = '';
    sorted.forEach((t, i) => {
      registerRow(t);
      const row = trow(t, i, sorted);
      // drag to reorder, only when the list is shown in its stored order
      if (state.sort.key === 'pos' && state.sort.dir === 1) {
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
      th.classList.toggle('sorted', th.dataset.key === state.sort.key);
      th.classList.toggle('desc', th.dataset.key === state.sort.key && state.sort.dir === -1);
    });
  };
  $('pl-thead').querySelectorAll('.th').forEach(th => th.onclick = () => {
    const k = th.dataset.key; if (!k) return;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: 1 };
    renderRows();
  });
  renderRows();
  // list, grid or compact inside a crate, remembered like every other list
  bindViewSwitch('playlist', () => { paintPlMode(); renderRows(); });
  const missing = list.filter((t) => !hasAudio(t));
  if (missing.length) {
    const dl = document.createElement('button');
    dl.className = 'btn btn-ghost';
    dl.textContent = `Download ${missing.length}`;
    dl.onclick = async () => {
      dl.disabled = true;
      try {
        const r = await api(`/api/playlists/${encodeURIComponent(pid)}/download`, { method: 'POST' });
        toast(`${r.queued} downloads queued - progress stays in the Downloads tab`, 6000);
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
    data-cover-initial="${esc(name.charAt(0).toUpperCase())}">`;
}

async function renderLiked() {
  setNav('library'); state.view = 'liked'; state.playlistId = 'liked'; renderSidebar();
  $('view-title').textContent = tr('Liked Songs');
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

/* every playlist carries the number of its place in the current order, so a crate can
   be referred to as "the 5th" without renaming anything */
function numberedPlaylists(list) {
  return sortedPlaylists(list).map((p, i) => ({ ...p, idx: i + 1 }));
}
const idxLabel = (n) => String(n).padStart(2, '0');

function sortedPlaylists(list) {
  const mode = plOrder();
  const out = (list || state.playlists).slice();
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), LOC());
  const byDate = (a, b) => String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || ''), LOC());
  const byUpdated = (a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || ''), LOC());
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
  $('view-title').textContent = tr('Playlists');
  const v = $('view');
  v.innerHTML = `<h1 class="sr-only">Playlists</h1>
    <p class="page-sub">Listening lists and DJ sets, ordered and ready to open.</p>
    <div class="lib-actions">
      <button class="btn btn-primary" id="lib-upload">Upload track</button>
      <button class="btn btn-ghost" id="lib-newpl">New playlist</button>
      <button class="btn btn-ghost" id="hist-import">Playlist from most-played</button>
    </div>
    <div class="sec-title" style="margin-top:0">Playlists <small>${Number(state.playlists.length).toLocaleString(LOC())} TOTAL</small></div>
    <div class="list-bar">${orderControls()}${viewSwitch('library', libView())}</div>
    <div class="pgrid" id="lib-grid"></div>`;
  const drawGrid = (view) => {
    const g = $('lib-grid');
    if (!g) return;
    g.className = view === 'list' ? 'plist' : view === 'compact' ? 'pgrid compact' : 'pgrid';
    g.innerHTML = '';
    const rows = numberedPlaylists().filter(matchesPlFilter);
    if (view === 'list') {
      g.appendChild(plistRow({ id: '__liked', name: 'Liked Songs', n_tracks: state.liked.size, liked: true }));
      for (const p of rows) g.appendChild(plistRow(p));
      return;
    }
    const liked = document.createElement('div');
    liked.className = 'pcard';
    liked.innerHTML = `<div class="pcard-artwrap"><div class="pcard-art ph liked-art" style="background:linear-gradient(135deg,#ff6b47,#8a1d12)">${IC.heartFull}</div><button class="pcard-play" aria-label="Play Liked Songs">${IC.play}</button></div><div class="pcard-name">Liked Songs</div><div class="pcard-sub">${state.liked.size} songs</div>`;
    liked.querySelector('.pcard-play').onclick = (e) => { e.stopPropagation(); playLiked(); };
    liked.onclick = () => nav('liked');
    g.appendChild(liked);
    for (const p of rows) g.appendChild(pcard(p, p.idx));
  };
  drawGrid(libView());
  bindViewSwitch('library', (v) => drawGrid(v));
  bindOrderControls(() => renderLibrary());
  $('hist-import').onclick = async () => {
    const name = await uiPrompt(tr('Playlist name for your most played tracks:'), tr('From your history'));
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
  $('lib-upload').onclick = () => pickFile('audio/*', (f) => uploadFiles([f]));
  $('lib-newpl').onclick = async () => {
    const name = await uiPrompt(tr('New playlist name:')); if (!name) return;
    await api('/api/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind: 'listen' }) });
    afterWrite(); await loadPlaylists(); renderLibrary(); toast('Listening playlist created - switch it to DJ set when you want it prepped');
  };
}

// DJ export: analysis coverage, a batch analyse for electronic, and per-playlist export
const PREP_ORDERS = [
  ['alpha', 'Name A-Z'],
  ['alphaDesc', 'Name Z-A'],
  ['size', 'Most tracks'],
  ['todo', 'Least prepped'],
  ['ready', 'Most prepped'],
];
const prepOrder = () => { try { return localStorage.getItem('mf-prep-order') || 'alpha'; } catch { return 'alpha'; } };
const prepView = () => { try { return localStorage.getItem('mf-view-prep') || 'grid'; } catch { return 'grid'; } };
// listening playlists are not prepped; they can be shown, but they carry no prep controls
const prepShowListen = () => { try { return localStorage.getItem('mf-prep-listen') === '1'; } catch { return false; } };
const crateCoverage = (p) => (p.owned ? (p.prepped || 0) / p.owned : 0);
function sortedCrates() {
  const show = prepShowListen();
  const out = [...state.playlists].filter((p) => show || p.kind !== 'listen');
  const mode = prepOrder();
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), LOC());
  if (mode === 'alphaDesc') out.sort((a, b) => byName(b, a));
  else if (mode === 'size') out.sort((a, b) => (b.n_tracks || 0) - (a.n_tracks || 0));
  else if (mode === 'todo') out.sort((a, b) => crateCoverage(a) - crateCoverage(b) || (b.owned || 0) - (a.owned || 0));
  else if (mode === 'ready') out.sort((a, b) => crateCoverage(b) - crateCoverage(a));
  else out.sort(byName);
  return out.map((p, i) => ({ ...p, idx: i + 1 }));
}

async function renderDjExport() {
  if (state.tier === 'listener') return nav('home');
  setNav('djexport'); state.playlistId = null; renderSidebar();
  $('view-title').textContent = tr('Prep');
  const v = $('view');
  v.innerHTML = `
    <div class="prep-hero">
      <div class="prep-kicker">EXPORT</div>
      <div class="prep-title">Prep</div>
      <p class="prep-sub">The playlists you play out - BPM, key, beat grid and cue points ready to export. Listening playlists stay off this page.</p>
      <div class="prep-meter"><div class="prep-meter-bar"><i id="prep-fill" style="width:0%"></i></div><span id="prep-cov">…</span></div>
      <div class="prep-actions">
        <button class="btn btn-primary" id="dj-analyze">Analyze unanalyzed</button>
        <button class="btn btn-ghost" id="dj-compat" hidden>Make playable</button>
      </div>
    </div>
    <div class="sec-title">Playlists <small>EXPORT READY</small></div>
    <div class="list-bar"><div class="mode-tabs" id="crate-order">
      ${PREP_ORDERS.map(([v, label]) => `<button class="mode-tab${prepOrder() === v ? ' on' : ''}" data-order="${v}">${label}</button>`).join('')}
    </div><div class="list-bar-tools">${(() => {
      const listen = state.playlists.filter((p) => p.kind === 'listen').length;
      const show = prepShowListen();
      return listen ? `<button class="mode-tab${show ? ' on' : ''}" id="prep-listen">${show ? 'Hide' : 'Show'} listening (${listen})</button>` : '';
    })()}${viewSwitch('prep', prepView())}</div></div>
    <div class="crate-grid" id="dj-list"></div>`;
  let remaining = 0;
  try {
    const st = await api('/api/analyze/status', { nocache: true });
    remaining = st.remaining || 0;
    const cov = document.getElementById('prep-cov');
    const fill = document.getElementById('prep-fill');
    const pct = st.total ? Math.round((st.current / st.total) * 100) : 0;
    if (cov) {
      cov.textContent = [
        `${Number(st.current).toLocaleString(LOC())}/${Number(st.total).toLocaleString(LOC())} up to date`,
        st.outdated ? `${Number(st.outdated).toLocaleString(LOC())} without cue points` : '',
        st.never ? `${Number(st.never).toLocaleString(LOC())} never analysed` : '',
      ].filter(Boolean).join(' · ');
    }
    if (fill) fill.style.width = pct + '%';
    const ab = document.getElementById('dj-analyze');
    if (ab) {
      // never-analysed is a library-wide job; outdated is per playlist, and a button
      // that only says "update a playlist below" is a button that does not act
      ab.hidden = !remaining;
      ab.textContent = `Analyse ${Number(remaining).toLocaleString(LOC())} never analysed`;
    }
  } catch {}
  const btn = document.getElementById('dj-analyze');
  if (btn) btn.onclick = async () => {
    if (!remaining) { toast('Every track with audio has been analysed at least once'); return; }
    if (!(await uiConfirm(tr(`Analyze ${remaining} track${remaining === 1 ? '' : 's'}? This runs on this machine and takes a while.`)))) return;
    btn.disabled = true;
    try {
      const r = await api('/api/analyze/run?limit=500&workers=2', { method: 'POST' });
      toast(`Analyzing ${r.limit} tracks in the background`, 5000);
    } catch { toast('Could not start analysis'); }
    btn.disabled = false;
  };
  // formats neither rekordbox nor Traktor can open (webm, ogg, opus, wma, ALAC)
  try {
    const t = await api('/api/maintenance/transcode', { nocache: true });
    const cb = document.getElementById('dj-compat');
    if (cb && t.count) {
      cb.hidden = false;
      cb.textContent = `Make ${t.count} playable`;
      cb.onclick = async () => {
        if (!(await uiConfirm(tr(`${t.count} file${t.count === 1 ? '' : 's'} are in a format rekordbox and Traktor cannot open. Convert them to m4a now? The originals are replaced.`)))) return;
        cb.disabled = true;
        try {
          const r = await api('/api/maintenance/transcode', { method: 'POST' });
          toast(`Converting ${r.count} file${r.count === 1 ? '' : 's'} in the background`, 6000);
          cb.hidden = true;
        } catch { toast('Could not start the conversion', 4000); cb.disabled = false; }
      };
    }
  } catch {}
  const list = document.getElementById('dj-list');
  if (!list) return;
  const pad = (n) => String(n).padStart(2, '0');
  const prepWork = (p) => Math.max(0, (p.owned || 0) - (p.prepped || 0));
  const prepMeta = (p) => {
    const bits = [`${p.n_tracks || 0} tracks`, `${p.prepped || 0}/${p.owned || 0} up to date`];
    if (p.outdated) bits.push(`${p.outdated} without cue points`);
    if (p.never) bits.push(`${p.never} never analysed`);
    return bits.join(' · ');
  };
  const prepState = (p) => {
    if (p.kind === 'listen') return '';
    if (!p.owned) return '';
    const work = prepWork(p);
    if (work > 0) {
      const label = (p.never || 0) > 0 ? `Prep ${work}` : `Update ${work}`;
      const why = [p.never ? `${p.never} never analysed` : '', p.outdated ? `${p.outdated} need cue points` : '']
        .filter(Boolean).join(' · ') || 'this playlist is up to date';
      return `<button class="crate-analyze" title="${esc(why)}">${label}</button>`;
    }
    return `<span class="crate-row-state"><span class="crate-ready-tag">ready</span><button class="crate-again" title="Analyse every track again, including cue points">Re-analyse</button></span>`;
  };
  const drawCrates = (view) => {
    list.className = view === 'list' ? 'crate-list' : view === 'compact' ? 'crate-grid compact' : 'crate-grid';
    list.innerHTML = '';
    for (const p of sortedCrates()) {
      const cov = p.owned ? Math.round(((p.prepped || 0) / p.owned) * 100) : 0;
      const listening = p.kind === 'listen';
      const card = document.createElement('div');
      card.className = view === 'list' ? 'crate-row' : 'crate';
      if (view === 'list') {
        card.innerHTML = `
          <span class="lrow-idx">${pad(p.idx)}</span>
          <img class="crate-row-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=120&v=${state.artV || 0}" alt="" loading="lazy">
          <div class="crate-row-t"><b>${esc(p.name)}</b><i>${listening ? `${p.n_tracks || 0} tracks · listening only` : prepMeta(p)}</i></div>
          <div class="crate-row-controls">
            ${prepState(p)}
            ${listening ? '' : `<div class="crate-row-acts">
              <button class="crate-btn" data-rb title="rekordbox XML + audio">Rekordbox</button>
              <button class="crate-btn" data-tr title="Traktor NML + audio">Traktor</button>
              <button class="crate-btn" data-usb title="CDJ USB">USB</button>
            </div>`}
          </div>`;
      } else {
        card.innerHTML = `
        <div class="crate-artwrap">
          <img class="crate-art" src="/api/cover-playlist/${encodeURIComponent(p.id)}?s=340&v=${state.artV || 0}" alt="" loading="lazy">
          <span class="crate-badge">${p.owned || 0}/${p.n_tracks || 0} audio</span>
        </div>
        <div class="crate-name"><span class="crate-no">${pad(p.idx)}</span>${esc(p.name)}</div>
        ${listening
          ? `<div class="crate-meta"><span>${p.n_tracks || 0} tracks · listening only</span></div>`
          : `<div class="crate-ready"><i style="width:${cov}%"></i></div>
             <div class="crate-meta"><span>${prepMeta(p)}</span>${prepState(p)}</div>
             <div class="crate-acts">
               <button class="crate-btn" data-rb title="Download a ZIP with the audio + rekordbox XML">Rekordbox</button>
               <button class="crate-btn" data-tr title="Download a ZIP with the audio + Traktor NML">Traktor</button>
               <button class="crate-btn" data-usb title="Pioneer device export: export.pdb, analysis files and audio - extract to the root of a FAT32 USB">USB</button>
             </div>`}`;
      }
      const missingPrep = prepWork(p);
      const exportCrate = async (fmt) => {
        if (missingPrep && fmt !== 'usb' && !(await uiConfirm(`${missingPrep} ${tr(missingPrep === 1 ? 'track' : 'tracks')} ${tr('in')} "${p.name}" ${tr('have no cue data at the current analyser. Cues will be missing. Export anyway?')}`))) return;
        toast(fmt === 'usb' ? 'Building the CDJ library…' : 'Zipping the playlist…', 6000);
        if (fmt === 'usb') window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export/pioneer.zip`;
        else window.location.href = `/api/playlists/${encodeURIComponent(p.id)}/export.zip?format=${fmt}`;
      };
      const rb = card.querySelector('[data-rb]');
      if (rb) rb.onclick = (e) => { e.stopPropagation(); exportCrate('rekordbox'); };
      const tr = card.querySelector('[data-tr]');
      if (tr) tr.onclick = (e) => { e.stopPropagation(); exportCrate('traktor'); };
      const usb = card.querySelector('[data-usb]');
      if (usb) usb.onclick = (e) => { e.stopPropagation(); exportCrate('usb'); };
      const runPrep = (btn, force) => async (e) => {
        if (e) e.stopPropagation();
        const meta = card.querySelector('.crate-meta span');
        const label0 = btn.textContent;
        btn.disabled = true;
        btn.textContent = force ? 'Re-analysing' : 'Starting';
        try {
          const r = await api(`/api/playlists/${encodeURIComponent(p.id)}/analyze${force ? '?force=1' : ''}`, { method: 'POST' });
          if (!r.count) {
            toast(r.note || 'Nothing to prep in this playlist', 5000);
            btn.disabled = false;
            btn.textContent = label0;
            return;
          }
          // the analyser takes seconds per track: count them off instead of going quiet
          const tick = async () => {
            let j = null;
            try { j = await api(`/api/playlists/${encodeURIComponent(p.id)}/analyze`, { nocache: true }); } catch {}
            if (!j) { setTimeout(tick, 2500); return; }
            const done = Number(j.done) || 0;
            const total = Number(j.total) || r.count;
            const shown = Math.min(total, done + (Number(j.active) || (j.running ? 1 : 0)));
            btn.textContent = `${force ? 'Re-analysing' : 'Prepping'} ${shown}/${total}`;
            if (meta) meta.textContent = `${p.n_tracks || 0} tracks · ${force ? 're-analysing' : 'prepping'} ${shown}/${total}`;
            if (j.running) { setTimeout(tick, 1500); return; }
            btn.disabled = false;
            btn.textContent = done ? `Done ${done}` : label0;
            toast(`${done} of ${total} ${force ? 're-analysed' : 'prepped'}${j.failed ? ` · ${j.failed} failed` : ''}`, 5000);
            setTimeout(() => refreshView(), 900);
          };
          setTimeout(tick, 800);
        } catch { toast('Could not start'); btn.disabled = false; btn.textContent = label0; }
      };
      const abt = card.querySelector('.crate-analyze');
      if (abt) abt.onclick = runPrep(abt, false);
      const again = card.querySelector('.crate-again');
      if (again) again.onclick = runPrep(again, true);
      card.onclick = () => openPlaylist(p.id);
      list.appendChild(card);
    }
    if (!list.children.length) list.innerHTML = '<div class="empty">No DJ playlists yet. Mark a playlist as a DJ set to prep it.</div>';
  };
  drawCrates(prepView());
  bindViewSwitch('prep', (v) => drawCrates(v));
  const listenToggle = document.getElementById('prep-listen');
  if (listenToggle) listenToggle.onclick = () => {
    try { localStorage.setItem('mf-prep-listen', prepShowListen() ? '0' : '1'); } catch {}
    renderDjExport();
  };
  document.querySelectorAll('#crate-order .mode-tab').forEach((b) => {
    b.onclick = () => {
      localStorage.setItem('mf-prep-order', b.dataset.order);
      document.querySelectorAll('#crate-order .mode-tab').forEach((x) => x.classList.toggle('on', x === b));
      drawCrates(prepView());
    };
  });
}

/* every track the server knows about, playlist membership or not */
// shared: when a genre card was clicked, show that genre's tracks
function renderGenreView(host, all, limit) {
  const genre = state.genreFilter;
  if (!genre) return false;
  const wantNone = genre === '__none__';
  const list = all.filter((t) => {
    const fam = String(t.genre_family || '').toLowerCase().trim();
    return wantNone ? !fam : fam === genre.toLowerCase();
  });
  host.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = `<div class="sec-title" style="margin-top:0">${esc(genre === '__none__' ? 'No family yet' : genre)} <small>${list.length} TRACKS</small>
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
  setNav('songs'); state.view = 'songs'; paintBack(); state.playlistId = null; state.artistName = null; state.albumName = null;
  renderSidebar();
  $('view-title').textContent = tr('Library');
  const v = $('view');
  v.innerHTML = `<h1 class="sr-only">Library</h1>
    <div class="songs-chips" id="songs-chips"></div>
    <div class="lib-actions songs-head">
      <input class="search" id="songs-q" placeholder="Filter this library" autocomplete="off">
      <div class="mode-tabs" id="songs-filter">
        <button class="mode-tab on" data-f="all">All</button>
        <button class="mode-tab" data-f="owned">Downloaded</button>
        <button class="mode-tab" data-f="mirror" title="In the catalogue, but the audio is not downloaded to this server yet">Not downloaded</button>
      </div>
      ${viewSwitch('songs', songView())}
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
  // the page arrives in the catalogue's own order, which is what the "#" column counts;
  // starting on "title" made the first click on "#" land on the order already on screen
  let sort = { key: 'pos', dir: 1 };
  let limit = 60;
  let browse = null;

  const chips = $('songs-chips');
  if (!chips) return; // view changed while the library was loading
  const paintChips = () => {
    const artists = new Set(all.map((t) => t.artist).filter(Boolean));
    const albums = new Set(all.map((t) => t.album).filter(Boolean));
    // four ways into the library, and one Tools menu. Ten equal pills across five phone
    // rows pushed the first track to 68% of the screen.
    chips.innerHTML = `
      <button class="action-chip" data-browse="artists"><b>Artists</b><span>${Number(artists.size).toLocaleString(LOC())}</span></button>
      <button class="action-chip" data-browse="albums"><b>Albums</b><span>${Number(albums.size).toLocaleString(LOC())}</span></button>
      <button class="action-chip" data-browse="genres"><b>Genres</b><span>BROWSE BY FAMILY</span></button>
      <button class="action-chip" data-browse="picks"><b>For you</b><span>FROM WHAT YOU PLAY</span></button>
      <details class="chip-tools">
        <summary class="action-chip"><b>Tools</b><span>IMPORT · SORT</span></summary>
        <div class="chip-menu" role="menu">
          <button class="chip-menu-item" data-browse="recentdl" role="menuitem"><b>Recently downloaded</b></button>
          <button class="chip-menu-item" data-browse="bpm" role="menuitem"><b>Sort by BPM</b></button>
          <button class="chip-menu-item" data-browse="upload" role="menuitem"><b>Upload files</b></button>
          <button class="chip-menu-item" data-browse="uploadfolder" role="menuitem"><b>Upload a folder</b></button>
          <button class="chip-menu-item" data-browse="import" role="menuitem"><b>Import track</b></button>
          <button class="chip-menu-item" data-browse="importpl" role="menuitem"><b>Import playlist</b></button>
        </div>
      </details>`;
    chips.querySelectorAll('[data-browse]').forEach((b) => b.onclick = async () => {
      const menu = b.closest('details');
      if (menu) menu.open = false;
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
        if (!(await uiConfirm(tr('Replace album covers with the official artwork? This overwrites existing covers for albums with more than one track.')))) return;
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
        if (!(await uiConfirm(tr('Merge duplicate tracks? The best quality copy is kept and playlists, likes and plays move to it.')))) return;
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
      // every family the library actually has, plus the untagged rest, so the card
      // counts add up to the library instead of to a whitelist
      const fams = new Map();
      let untagged = 0;
      for (const t of all) {
        const g = String(t.genre_family || '').toLowerCase().trim();
        if (g) fams.set(g, (fams.get(g) || 0) + 1);
        else untagged += 1;
      }
      const rows = [...fams.entries()].sort((a, b) => b[1] - a[1]);
      const tagged = rows.reduce((n, [, c]) => n + c, 0);
      host.innerHTML = `<div class="sec-title">Genres <small>${rows.length} families · ${tagged} of ${all.length} tracks</small></div><div class="pgrid" id="browse-grid"></div>`;
      const grid = host.querySelector('#browse-grid');
      const cards = rows.map(([name, n]) => ({ name, n }));
      if (untagged) cards.push({ name: 'no family', n: untagged });
      for (const { name, n } of cards) {
        const untag = name === 'no family';
        const card = document.createElement('div');
        card.className = 'pcard';
        card.innerHTML = `<div class="pcard-art ph" style="background:${untag ? 'var(--bg-elev2)' : gradFor(name)};color:var(--fg-mute)">${esc(name.charAt(0).toUpperCase())}</div>
          <div class="pcard-name">${esc(name)}</div><div class="pcard-sub">${n} tracks</div>`;
        card.onclick = () => { browse = null; state.genreFilter = untag ? '__none__' : name; limit = 60; draw(); };
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
    const rows = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, LOC()));
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
      statsEl.textContent = `${Number(s.tracks).toLocaleString(LOC())} tracks · ${fmtSize(s.owned_bytes)} on disk`;
    }).catch(() => { statsEl.textContent = `${all.length} tracks`; });
  }

  const draw = () => {
    closeInlinePreview();
    if (state.genreFilter) { renderGenreView($("songs-list"), all, 60); return; }
    let list = all.slice();
    if (filter === 'owned') list = list.filter((t) => hasAudio(t));
    if (filter === 'mirror') list = list.filter((t) => !hasAudio(t));
    if (query) {
      // in Brazil people type without accents: "abris" must find "Ábris"
      const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const q = fold(query);
      list = list.filter((t) => fold(`${t.title} ${t.artist} ${t.album}`).includes(q));
    }
    if (sort.key === 'pos') {
      // the order the page loaded is position one; the header toggles it
      if (sort.dir === -1) list.reverse();
    } else {
      list.sort((a, b) => {
        const va = a[sort.key] ?? '', vb = b[sort.key] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
        return String(va).localeCompare(String(vb), LOC()) * sort.dir;
      });
    }
    const el = $('songs-list');
    el.innerHTML = '';
    if (drawBrowse(el)) return;
    if (!list.length) {
      el.innerHTML = `<div class="empty">${tr('Nothing matches that filter.')}<br><button class="btn btn-ghost" id="songs-search-everywhere" type="button">${tr('Search everywhere')}</button></div>`;
      const go = document.getElementById('songs-search-everywhere');
      if (go) go.onclick = () => { state.searchPending = query || ''; nav('search'); };
      return;
    }
    const view = songView();
    const theadBack = document.getElementById('songs-thead');
    if (theadBack) theadBack.style.display = view === 'list' ? '' : 'none';
    const shown = list.slice(0, limit);
    if (view !== 'list') {
      // compact is a denser grid of the same cards, not a denser list
      const grid = document.createElement('div');
      grid.className = view === 'compact' ? 'sg-grid compact' : 'sg-grid';
      shown.forEach((t) => { registerRow(t); grid.appendChild(trackCard(t, list, 'Songs')); });
      el.appendChild(grid);
    } else {
      shown.forEach((t, i) => { registerRow(t); el.appendChild(trow(t, i, list)); });
    }
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
  bindViewSwitch('songs', () => { limit = 60; draw(); });
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
  const url = await uiPrompt(tr('Paste a Spotify track link or ID:'));
  if (!url) return;
  toast('Looking up the track', 4000);
  try {
    const r = await api('/api/mirror/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    // the list is cached for 90 seconds; without this the track exists on the server and
    // is invisible in Songs and in search, which is exactly what "impossible to find" was
    bustCache();
    await renderSongs(false);
    // put the row on screen instead of leaving the person to hunt for it
    const q = document.getElementById('songs-q');
    if (q) { q.value = r.title || ''; q.oninput({ target: q }); }
    const row = document.querySelector(`.trow[data-tid="${r.track}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 2600);
    }
    toast(r.existing ? `“${r.title}” was already in your library` : `Imported “${r.title}”`, 5000);
    // an imported track has no audio yet: start it through the row's own download path,
    // which reports progress in place
    const dl = row && row.querySelector('.tmore.tdl');
    if (dl) dl.click();
  } catch { toast('Could not find that track', 5000); }
}

async function renderImport() {
  setNav('songs'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = tr('Import playlist');
  const v = $('view');
  try { window.scrollTo(0, 0); } catch {}
  v.innerHTML = `<div class="inline-panel">
      <label class="ip-label">Playlist name
        <input id="imp-name" placeholder="Driving, Sunday morning...">
      </label>
      <label class="ip-label">Spotify playlist link, or one track per line
        <textarea id="imp-text" rows="8" placeholder="https://open.spotify.com/playlist/...&#10;&#10;or&#10;Artist - Title"></textarea>
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
        const made = r && (r.playlist || r.created);
        toast(`Imported ${(r && r.tracks) || (r && r.created) || 0} tracks`, 7000);
        // land on the thing that was just imported, not at the top of the library
        if (made && typeof made === 'object' && made.id) openPlaylist(made.id, false);
        else if (typeof made === 'string') openPlaylist(made, false);
        else nav('songs');
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
  $('view-title').textContent = tr('Settings');
  const v = $('view');
  v.innerHTML = '<div class="ladder-state">Loading...</div>';
  let d = { settings: {}, llm: {} };
  try { d = await api('/api/settings', { nocache: true }); } catch {}
  const s = d.settings || {};
  const l = d.llm || {};
  v.innerHTML = `<h1 class="sr-only">Settings</h1>
    <p class="page-sub">You, the library, the model endpoint and how downloads behave.</p>
    <div class="set-wrap">
    <section class="set-card set-mode" data-tone="acc">
      <div class="set-mode-head">
        <h2>Mode</h2>
        <div class="kind-switch" id="set-tier" role="group" aria-label="Interface mode">
          <button class="mode-tab${state.tier === 'listener' ? ' on' : ''}" data-tier="listener" aria-pressed="${state.tier === 'listener'}">Listener</button>
          <button class="mode-tab${state.tier === 'dj' ? ' on' : ''}" data-tier="dj" aria-pressed="${state.tier === 'dj'}">DJ</button>
        </div>
      </div>
      <p class="set-note">Listener hides Prep, harmonic tools and DJ exports. DJ shows everything.</p>
    </section>
    <div class="set-grid">
      <section class="set-card" data-tone="acc">
        <h2>You</h2>
        <label>Display name<input id="set-name" value="${esc(s.display_name || '')}" placeholder="Your name"></label>
        <p class="set-note">The first word is used by the greeting on Home. Nothing else reads it.</p>
        <label>Timezone<input id="set-tz" value="${esc(s.timezone || '')}" placeholder="Continent/City"></label>
        <p class="set-note">IANA name, e.g. America/Sao_Paulo. Drives the greeting hour, the "at this hour you usually listen" line and the weather. Setting a city below fills it in automatically.</p>
        <label>Language
          <select id="set-lang">
            <option value="en"${window.I18N && window.I18N.lang === 'en' ? ' selected' : ''}>English</option>
            <option value="pt-BR"${window.I18N && window.I18N.lang === 'pt-BR' ? ' selected' : ''}>Português (Brasil)</option>
          </select>
        </label>
        <p class="set-note">The interface language for this browser. Names of tracks, artists and playlists are never translated.</p>
        <div class="lib-actions set-onb">
          <button class="btn btn-ghost" id="set-onboarding" type="button">Run setup again</button>
          <span class="set-note">Name, place, mode and music folder, in five steps.</span>
        </div>
      </section>
      <section class="set-card" data-tone="acc">
        <h2>Location</h2>
        <p class="set-note">Used by the greeting and its weather line. Type a city and the coordinates and time zone are looked up for you.</p>
        <label>City<input id="set-city" value="${esc(s.city || '')}" placeholder="Your city"></label>
        <div class="set-facts" id="set-geo">${s.latitude && s.longitude
          ? `<div><b>${esc(s.city || '')}</b>${s.country ? ` · ${esc(s.country)}` : ''}</div><div>${Number(s.latitude).toFixed(3)}, ${Number(s.longitude).toFixed(3)}</div><div>${esc(s.timezone || '')}</div>`
          : '<div>No city set</div>'}</div>
      </section>
      <section class="set-card" data-tone="ok">
        <h2>Taste</h2>
        <p class="set-note">Optional. Used to shape recommendations; the app learns from what you play anyway.</p>
        <label>Genres you love<input id="set-taste-genres" value="${esc(s.taste_genres || '')}" placeholder="Genres, comma separated"></label>
        <label>Artists you love<input id="set-taste-artists" value="${esc(s.taste_artists || '')}" placeholder="Artists, comma separated"></label>
        <label>Usually listening<input id="set-taste-context" value="${esc(s.taste_context || '')}" placeholder="When you listen"></label>
        <label>Keep out of picks<input id="set-taste-avoid" value="${esc(s.taste_avoid || '')}" placeholder="Genres to keep out"></label>
        <div class="avoid-terms" id="set-avoid-terms" aria-live="polite"></div>
        <p class="set-note">Commas. "no" and "non" are ignored, so "non pop" means pop. Matched against genre, family, artist, album and title.</p>
        <label class="set-check"><input type="checkbox" id="set-taste-children"${s.taste_include_children ? ' checked' : ''}> Let children's music shape recommendations</label>
        <p class="set-note">Off: children's plays stay in your history but do not move your top genres, tempo, key, picks or rotation.</p>
      </section>
      <section class="set-card" data-tone="mute">
        <h2>Maintenance</h2>
        <p class="set-note">Housekeeping for the library itself. Nothing here changes your files unless it says so.</p>
        <div class="set-tools">
          <button class="btn btn-ghost" id="set-repair" type="button" title="Reads the tags of every file and fills title, artist, album, year and track number from MusicBrainz">Repair metadata</button>
          <button class="btn btn-ghost" id="set-genres" type="button" title="Asks MusicBrainz for a genre per artist and stores a genre family for recommendations">Fill genres</button>
          <button class="btn btn-ghost" id="set-covers" type="button" title="Downloads album art for albums that have none. Existing covers are kept">Fix covers</button>
          <button class="btn btn-ghost" id="set-dedupe" type="button" title="Removes a copy only when two files are the same recording. Different versions are never merged">Remove duplicates</button>
          <button class="btn btn-ghost" id="set-cache-clear" type="button" title="Drops cover, preview and page caches. No audio file is touched">Clear cache</button>
        </div>
        <ul class="set-note set-list">
          <li>Repair metadata reads the tags and fills title, artist, album, year and track number from MusicBrainz.</li>
          <li>Fill genres tags one genre per artist and a family, which is what picks and Flow use.</li>
          <li>Fix covers fetches album art for albums that have none; existing covers are kept.</li>
          <li>Remove duplicates deletes a file only when it is the same recording; a remix, a live take or another bitrate stays.</li>
          <li>Clear cache drops covers, previews and pages kept for speed. No audio file is touched.</li>
        </ul>
        <p class="set-note" id="set-maint" data-tone="">Nothing run yet.</p>
        <p class="set-note" id="set-cache">cache -</p>
        <p class="set-note" id="set-rungs">sources -</p>
        <label>Auto-save after plays<input id="set-auto-dl" type="number" min="0" max="20" value="${Number(s.auto_download_plays ?? 2)}"></label>
        <p class="set-note">A streamed track with no file is downloaded after this many plays. 0 turns automatic saving off.</p>
      </section>
      <section class="set-card" data-tone="acc">
        <h2>Model endpoint</h2>
        <p class="set-note">A language model turns one sentence into a structured request: key, BPM, year, genre, plays, count and order. MUSICFY sends the sentence and nothing else - never your library, your files or your listening history.</p>
        <p class="set-note">Two callers only. A&amp;R uses it when the request is a brief: a person, an age, an occasion, several likes ("a birthday set for a 7 year old who loves dinosaurs"). Ask uses it when the question is fuzzy ("something darker", "less vocals"). Everything else - genres, keys, tempo, years, counts - is parsed by the built-in rules, without a network call.</p>
        <p class="set-note">Without an endpoint both fall back to those rules, which cover the explicit requests and miss the conversational ones. Covers, metadata, search inside your library, downloads and playback never use it.</p>
        <div class="llm-row">
          <p class="set-note llm-status" id="set-llm-status" data-tone="idle"><span class="llm-dot" data-state="idle"></span> <span>Checking...</span></p>
          <div class="llm-actions">
            <button class="btn btn-ghost" id="set-llm-test" type="button">Test connection</button>
            <button class="btn btn-ghost" id="set-llm-list" type="button">Load models</button>
          </div>
        </div>
        <label>Base URL<input id="set-llm-url" value="${esc(s.llm_base_url || l.base_url || '')}" placeholder="https://host/v1"></label>
        <label>Model<input id="set-llm-model" list="set-llm-models" autocomplete="off" value="${esc(s.llm_model || l.model || '')}" placeholder="model name"></label>
        <datalist id="set-llm-models"></datalist>
        <p class="set-note" id="set-llm-models-note" hidden></p>
        <label>API key<input id="set-llm-key" type="password" placeholder="${l.has_key ? 'stored, leave blank to keep' : 'not set'}"></label>
      </section>
      <section class="set-card">
        <h2>Downloads</h2>
        <label>Download format
          <select id="set-format">
            <option value="best"${(s.preferred_format || 'best') === 'best' ? ' selected' : ''}>keep the original (no transcoding)</option>
            <option value="m4a"${s.preferred_format === 'm4a' ? ' selected' : ''}>m4a (smaller)</option>
            <option value="mp3"${s.preferred_format === 'mp3' ? ' selected' : ''}>mp3 (universal)</option>
          </select>
        </label>
        <p class="set-note">Applies to downloads from streaming sources only. "Keep the original" stores what the source serves without re-encoding. m4a and mp3 convert only when the source uses a different codec; when the source already serves AAC, m4a is a container fix with no re-encode. Files you upload are stored byte for byte, and lossless files are never converted.</p>
        <label>Catalogue country<input id="set-storefront" value="${esc(s.storefront_country || '')}" placeholder="" maxlength="2"></label>
        <p class="set-note">Two letters. The catalogue differs by country: a release in Brazil can be missing from the US store. Empty follows the country of the city above. Set it while travelling when you want another storefront; Deezer is queried too, so the answer does not depend on one store.</p>
      </section>
      <section class="set-card">
        <h2>Playback</h2>
        <label class="dj-only">Key names
          <select id="set-keyfmt">
            <option value="notes"${(s.key_format || 'notes') === 'notes' ? ' selected' : ''}>Musical (Am, F#m)</option>
            <option value="camelot"${s.key_format === 'camelot' ? ' selected' : ''}>Wheel values (8A, 11A)</option>
          </select>
        </label>
        <p class="set-note dj-only">Display only. Exports always write musical notation, which is what Rekordbox and Traktor read.</p>
        <label class="set-check"><input type="checkbox" id="set-normalize"${s.normalize_loudness ? ' checked' : ''}> Normalize loudness</label>
        <p class="set-note">Turns loud tracks down towards a common level, using the loudness measured during analysis. It only ever attenuates - it cannot add distortion and it never rewrites a file. iOS ignores per-track volume, so on a phone or in a car this does nothing.</p>
        <label>Target level
          <select id="set-target">
            <option value="-12"${String(s.target_loudness) === '-12' ? ' selected' : ''}>-12 dB (loud)</option>
            <option value="-14"${String(s.target_loudness ?? -14) === '-14' ? ' selected' : ''}>-14 dB (default)</option>
            <option value="-18"${String(s.target_loudness) === '-18' ? ' selected' : ''}>-18 dB (quiet)</option>
          </select>
        </label>
        <label class="set-check"><input type="checkbox" id="set-autoplay"${s.autoplay_next !== false ? ' checked' : ''}> Continue with similar tracks when a playlist ends</label>
        <p class="set-note">Target level is the loudness every track is turned down to while Normalize is on. -14 dB matches the streaming services; -18 dB leaves more headroom for a DJ set.</p>
        <label>Buffer ahead
          <select id="set-buffer">
            <option value="0"${String(s.prefetch_ahead) === '0' ? ' selected' : ''}>off</option>
            <option value="1"${String(s.prefetch_ahead ?? 1) === '1' ? ' selected' : ''}>1 track</option>
            <option value="2"${String(s.prefetch_ahead) === '2' ? ' selected' : ''}>2 tracks</option>
          </select>
        </label>
        <p class="set-note">Buffer ahead keeps the next track preloaded. More buffer means no wait between tracks and more data held in memory; off frees the memory on a small device.</p>
        <div class="lib-actions"><button class="btn btn-ghost" id="set-clearbuf" type="button">Clear buffer</button><span class="set-note">Frees preloaded audio and cached pages</span></div>
        <div class="lib-actions"><button class="btn btn-ghost" id="set-copylog" type="button">Copy playback log</button><span class="set-note">For a stop in the car: what the phone and the server saw</span></div>
        <p class="set-note" id="set-playlog"></p>
      </section>
      <section class="set-card">
        <h2>Library</h2>
        <p class="set-note">Read-only counts: tracks, disk use, plays recorded and how many tracks have cue points.</p>
        <div class="set-facts" id="set-facts">Reading...</div>
      </section>
      <section class="set-card" data-tone="ok">
        <h2>Library folder</h2>
        <p class="set-note">Point at a folder you already have. The files stay where they are: nothing is copied, moved or renamed. Playlists written by Traktor, rekordbox, M3U or PLS are imported with their order, and the BPM and key they already carry are kept.</p>
        <label>Music folder<select id="set-folder-select"><option value="">Choose a folder…</option></select></label>
        <label id="set-folder-path-row" hidden>Folder or playlist file<input id="set-folder" placeholder="/path/to/music"></label>
        <div class="lib-actions">
          <button class="btn btn-ghost" id="set-folder-pick" type="button" hidden>Choose folder</button>
          <button class="btn btn-primary" id="set-folder-scan" type="button">Scan folder</button>
          <span class="set-note" id="set-folder-out">Not scanned yet.</span>
        </div>
        <p class="set-note">A track removed from the library later leaves its file on disk. Nothing here writes to your files.</p>
      </section>
    </div>
    <div class="set-actions"><button class="btn btn-primary" id="set-save">Save settings</button><span id="set-msg" class="set-note"></span></div>
    <div class="set-about">
      <span>MUSICFY <b id="set-version">v${esc(d.version || '')}</b></span>
      <span id="set-update-msg" class="set-note">Checking for updates...</span>
      <button class="btn btn-ghost" id="set-check-update" type="button">Check for updates</button>
      <button class="btn btn-ghost" id="set-update" type="button" hidden>Update now</button>
      <button class="btn btn-ghost" id="set-restart" type="button" hidden>Restart now</button>
    </div>
    <p class="set-credit">Developed by Roger Lima · WNL</p>
    </div>`;
  // what the player did last, including while the screen was locked
  try {
    const logEl = document.getElementById('set-playlog');
    const log = JSON.parse(localStorage.getItem('mf_play_log') || '[]').slice(-6).reverse();
    if (logEl) logEl.textContent = log.length
      ? `Playback log: ${log.map((e) => `${e.t} ${e.ev}${e.id ? ` #${e.id}` : ''}${e.src ? ` (${e.src})` : ''}`).join(' · ')}`
      : 'Playback log: nothing recorded yet.';
  } catch {}

  Promise.all([api('/api/stats', { nocache: true }), api('/api/analyze/status', { nocache: true })]).then(([st, an]) => {
    const f = document.getElementById('set-facts');
    if (!f) return;
    f.innerHTML = `<div><b>${Number(st.tracks).toLocaleString(LOC())}</b> tracks</div><div><b>${fmtSize(st.owned_bytes)}</b> on disk</div><div><b>${Number(st.listens).toLocaleString(LOC())}</b> plays recorded</div>`
      + `<div><b>${Number(an.current).toLocaleString(LOC())}</b> current · <b>${Number(an.outdated).toLocaleString(LOC())}</b> without cue points</div>`;
  }).catch(() => {});
  // one button that collects the client log and the server's media requests, so a stop in
  // the car can be explained without guessing
  const copyLog = document.getElementById('set-copylog');
  if (copyLog) copyLog.onclick = async () => {
    let server = null;
    try { server = await api('/api/diag/media', { nocache: true }); } catch {}
    let client = [];
    try { client = JSON.parse(localStorage.getItem('mf_play_log') || '[]'); } catch {}
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const text = JSON.stringify({
      app: 'MUSICFY', version: d.version || '', ua: navigator.userAgent, lang: window.I18N && window.I18N.lang,
      service_worker: sw, hidden: document.hidden,
      settings: { normalize_loudness: !!s.normalize_loudness, target_loudness: s.target_loudness, prefetch_ahead: s.prefetch_ahead },
      client_log: client, server,
    }, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      toast('Playback log copied', 4000);
    } catch {
      try { await navigator.clipboard.writeText(text); toast(tr('Playback log copied'), 4000); } catch { toast(tr('Could not copy the playback log'), 4000); }
    }
  };

  // the exclusion field, shown back as the terms the app will actually use
  const avoidInput = document.getElementById('set-taste-avoid');
  const avoidHost = document.getElementById('set-avoid-terms');
  const paintAvoid = () => {
    if (!avoidHost || !avoidInput) return;
    const terms = avoidInput.value.split(/[\n,;]+|\band\b/gi)
      .map((t) => t.trim().toLowerCase().replace(/^(?:no|non|not|without|avoid|skip|exclude|off)\s+/, '').replace(/\s+(?:music|tracks?|songs?)$/, ''))
      .filter(Boolean);
    avoidHost.innerHTML = terms.length
      ? `<span class="avoid-label">never in picks</span>` + [...new Set(terms)].map((t) => `<span class="avoid-term">${esc(t)}</span>`).join('')
      : '<span class="avoid-empty">Nothing excluded.</span>';
  };
  if (avoidInput) { avoidInput.addEventListener('input', paintAvoid); paintAvoid(); }

  // setup is repeatable: the flow edits the same fields this page does, so the button is a
  // shortcut, not a second source of truth
  const onbBtn = document.getElementById('set-onboarding');
  if (onbBtn) onbBtn.onclick = async () => {
    await onbPost({ onboarding_done: false, onboarding_step: 0 });
    state.settings = state.settings || {};
    state.settings.onboarding_done = false;
    openOnboarding(0);
  };
  const langSel = document.getElementById('set-lang');
  if (langSel && window.I18N) langSel.onchange = () => window.I18N.set(langSel.value);
  const llmStatus = document.getElementById('set-llm-status');
  const paintLlm = async () => {
    if (!llmStatus) return;
    const dot = llmStatus.querySelector('.llm-dot');
    const text = llmStatus.querySelector('span:last-child');
    const tone = (v) => { llmStatus.dataset.tone = v; };
    if (!l.configured) {
      if (dot) dot.dataset.state = 'off';
      tone('off');
      if (text) text.textContent = 'Not configured. A&R and Ask use the local planner.';
      return;
    }
    if (dot) dot.dataset.state = 'wait';
    tone('wait');
    if (text) text.textContent = 'Checking the endpoint...';
    try {
      const r = await api('/api/llm/status', { nocache: true });
      if (dot) dot.dataset.state = r.ok ? 'ok' : 'bad';
      tone(r.ok ? 'ok' : 'bad');
      if (text) text.textContent = r.ok
        ? `Connected · ${r.model || 'model'} · ${r.ms} ms`
        : `No answer: ${r.error || 'unknown error'}`;
    } catch (e) {
      if (dot) dot.dataset.state = 'bad';
      tone('bad');
      if (text) text.textContent = `No answer: ${e.message || 'unknown error'}`;
    }
  };
  const llmTest = document.getElementById('set-llm-test');
  if (llmTest) llmTest.onclick = () => paintLlm();
  paintLlm();

  // Once the base URL and key are stored, the endpoint can say which models it serves.
  // A gateway without /models answers 404: the field stays free text.
  const llmList = document.getElementById('set-llm-list');
  const llmModelList = document.getElementById('set-llm-models');
  const llmModelNote = document.getElementById('set-llm-models-note');
  const loadModels = async () => {
    if (!llmList || !llmModelList) return;
    const label = llmList.textContent;
    llmList.disabled = true;
    llmList.textContent = tr('Loading…');
    try {
      const r = await api('/api/llm/models', { nocache: true });
      if (r.ok && r.models.length) {
        llmModelList.innerHTML = r.models.map((m) => `<option value="${esc(m)}"></option>`).join('');
        if (llmModelNote) {
          llmModelNote.hidden = false;
          llmModelNote.textContent = tr('Models listed. Pick one from the field, or keep typing.');
        }
      } else if (llmModelNote) {
        llmModelNote.hidden = false;
        llmModelNote.textContent = r.error
          ? `${tr('This endpoint does not list models:')} ${r.error}`
          : tr('This endpoint does not list models. Type the name.');
      }
    } catch (e) {
      if (llmModelNote) {
        llmModelNote.hidden = false;
        llmModelNote.textContent = `${tr('Could not list models:')} ${e.message || 'unknown error'}`;
      }
    } finally {
      llmList.disabled = false;
      llmList.textContent = label;
    }
  };
  if (llmList) {
    llmList.onclick = loadModels;
    // the picker only makes sense once there is an endpoint and a key to ask; after a save
    // that sets them it appears, without leaving the page
    llmList.hidden = !(l && l.configured);
    if (l && l.configured) loadModels();
  }
  document.querySelectorAll('#set-tier .mode-tab').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.tier === state.tier) return;
      b.disabled = true;
      try {
        await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ui_tier: b.dataset.tier }) });
        applyTier(b.dataset.tier);
        location.reload();
      } catch { b.disabled = false; toast('Could not change the mode', 4000); }
    };
  });
  const versionEl = document.getElementById('set-version');
  const updateMsg = document.getElementById('set-update-msg');
  const updateBtn = document.getElementById('set-update');
  const checkBtn = document.getElementById('set-check-update');
  const restartBtn = document.getElementById('set-restart');
  const checkUpdate = async () => {
    if (!updateMsg) return;
    updateMsg.textContent = 'Checking for updates...';
    try {
      const r = await api('/api/update/status?check=1', { nocache: true });
      if (versionEl && r.version) versionEl.textContent = `v${r.version}`;
      // files newer than the running process: the update happened, the restart did not
      if (r.pending_restart) {
        updateMsg.textContent = `Version ${r.disk} is installed. Restart to run it.`;
        if (updateBtn) updateBtn.hidden = true;
        if (restartBtn) restartBtn.hidden = false;
        return;
      }
      if (r.error) { updateMsg.textContent = `Could not check: ${r.error}`; if (updateBtn) updateBtn.hidden = true; return; }
      if (!r.git) {
        // a bundle install compares versions with the published release
        if (r.behind > 0) {
          updateMsg.textContent = `Version ${r.latest || ''} is available.`;
          if (updateBtn) updateBtn.hidden = false;
        } else {
          updateMsg.textContent = 'Up to date.';
          if (updateBtn) updateBtn.hidden = true;
        }
        return;
      }
      if (r.behind > 0) {
        updateMsg.textContent = `Update available (${r.behind} new commit${r.behind === 1 ? '' : 's'}).`;
        if (updateBtn) updateBtn.hidden = false;
      } else {
        updateMsg.textContent = 'Up to date.';
        if (updateBtn) updateBtn.hidden = true;
      }
    } catch (e) { updateMsg.textContent = `Could not check: ${e.message || 'unknown error'}`; }
  };
  if (checkBtn) checkBtn.onclick = checkUpdate;
  if (restartBtn) restartBtn.onclick = async () => {
    restartBtn.disabled = true;
    updateMsg.textContent = 'Restarting…';
    try {
      await api('/api/restart', { method: 'POST' });
      // the server replaces itself; wait for the new process, then reload the page
      setTimeout(() => { try { location.reload(); } catch {} }, 4000);
    } catch (e) {
      updateMsg.textContent = `Restart failed: ${e.message || 'unknown error'}`;
      restartBtn.disabled = false;
    }
  };
  if (updateBtn) updateBtn.onclick = async () => {
    if (!(await uiConfirm(tr('Update MUSICFY now? The new version is downloaded first; a restart is needed before it is active.')))) return;
    updateBtn.disabled = true;
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'update failed');
      if (data.restarting) {
        updateMsg.textContent = `Updated to ${data.to || ''}. Restarting…`;
        toast('Updated; MUSICFY is restarting', 8000);
      } else {
        updateMsg.textContent = `Updated${data.to ? ` to ${data.to}` : ''}. Restart with: ${data.restart || 'musicfy restart'}`;
        if (restartBtn) restartBtn.hidden = false;
        toast('Update pulled; restart MUSICFY to apply it', 8000);
      }
      updateBtn.hidden = true;
    } catch (e) { updateMsg.textContent = `Update failed: ${e.message || 'unknown error'}`; updateBtn.disabled = false; }
  };
  checkUpdate();

  const saveBtn = document.getElementById('set-save');
  const saveMsg = document.getElementById('set-msg');

  /* The save button covers everything on the page, so the message has to be about what
     actually changed. It used to say "picks updated" whenever the exclusion field was
     non-empty, which is a sentence about a setting nobody touched. */
  const readForm = () => {
    const body = {
      display_name: document.getElementById('set-name').value.trim(),
      timezone: document.getElementById('set-tz').value.trim(),
      city: document.getElementById('set-city').value.trim(),
      llm_base_url: document.getElementById('set-llm-url').value.trim(),
      llm_model: document.getElementById('set-llm-model').value.trim(),
      preferred_format: document.getElementById('set-format').value,
      storefront_country: document.getElementById('set-storefront').value.trim().toUpperCase(),
      key_format: document.getElementById('set-keyfmt').value,
      normalize_loudness: document.getElementById('set-normalize').checked,
      target_loudness: Number(document.getElementById('set-target').value),
      autoplay_next: document.getElementById('set-autoplay').checked,
      prefetch_ahead: Number(document.getElementById('set-buffer').value),
      taste_genres: document.getElementById('set-taste-genres').value.trim(),
      taste_artists: document.getElementById('set-taste-artists').value.trim(),
      taste_context: document.getElementById('set-taste-context').value.trim(),
      taste_avoid: document.getElementById('set-taste-avoid').value.trim(),
      taste_include_children: document.getElementById('set-taste-children').checked,
    };
    const key = document.getElementById('set-llm-key').value.trim();
    if (key) body.llm_api_key = key;
    return body;
  };
  // compare against what the form showed, not the raw settings: fields with defaults
  // (booleans, selects) are absent from the stored object and looked like edits
  let baseline = readForm();
  const same = (a, b) => {
    if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
    if (typeof a === 'number' || typeof b === 'number') return Number(a ?? 0) === Number(b ?? 0);
    return String(a ?? '') === String(b ?? '');
  };
  const changedKeys = () => Object.keys(readForm()).filter((k) => !same(readForm()[k], baseline[k]));
  const LABELS = {
    display_name: 'name', timezone: 'time zone', city: 'city',
    llm_base_url: 'model endpoint', llm_model: 'model', llm_api_key: 'API key',
    preferred_format: 'format',
    normalize_loudness: 'loudness switch', target_loudness: 'target level',
    autoplay_next: 'autoplay', prefetch_ahead: 'buffer',
    taste_genres: 'genres', taste_artists: 'artists', taste_context: 'listening context',
    taste_avoid: 'pick exclusions', taste_include_children: 'children in taste',
  };
  const paintDirty = () => {
    if (!saveBtn) return;
    const n = changedKeys().length;
    saveBtn.classList.toggle('dirty', n > 0);
    // a green "Saved" must not sit there while the form has unsaved edits
    if (n > 0) { saveBtn.classList.remove('saved'); saveBtn.textContent = 'Save settings'; }
    if (saveMsg) {
      saveMsg.textContent = n ? 'Unsaved changes' : '';
      saveMsg.dataset.tone = n ? 'warn' : '';
    }
  };
  v.querySelectorAll('input, select, textarea').forEach((el) => {
    el.addEventListener('input', paintDirty);
    el.addEventListener('change', paintDirty);
  });
  paintDirty();

  document.getElementById('set-save').onclick = async () => {
    const body = readForm();
    const changed = Object.keys(body).filter((k) => !same(body[k], baseline[k]));
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
      const notFound = saved.city && !saved.latitude;
      if (saveBtn) {
        saveBtn.classList.remove('dirty');
        saveBtn.classList.add('saved');
        saveBtn.textContent = notFound ? 'Saved' : (!changed.length ? 'No changes' : 'Saved');
        setTimeout(() => {
          if (!saveBtn) return;
          saveBtn.classList.remove('saved');
          saveBtn.textContent = 'Save settings';
        }, 2800);
      }
      if (saveMsg) {
        // build the sentence from translated parts: the dictionary matches whole strings,
        // so "Saved · time zone" never reached the label "time zone"
        const tr = (x) => (window.I18N ? window.I18N.t(x) : x);
        const labelOf = (k) => tr(LABELS[k] || k);
        if (notFound) saveMsg.textContent = 'Saved, but that city was not found';
        else if (!changed.length) saveMsg.textContent = 'Nothing changed';
        else if (changed.length === 1) saveMsg.textContent = `${tr('Saved')} · ${labelOf(changed[0])}`;
        else if (changed.length <= 3) saveMsg.textContent = `${tr('Saved')} · ${changed.map(labelOf).join(', ')}`;
        else saveMsg.textContent = `${tr('Saved')} · ${changed.length} ${tr('settings')}`;
        saveMsg.dataset.tone = 'ok';
      }
      baseline = { ...baseline, ...body };
      if (['llm_base_url', 'llm_model', 'llm_api_key'].some((k) => changed.includes(k))) {
        if (llmList) llmList.hidden = false;
        paintLlm();
        loadModels();
      }
      paintAvoid();
      state.settings = { ...(state.settings || {}), ...body, ...saved };
      applyLoudnessGain(state.current);
      if (body.display_name) state.profileName = body.display_name;
    } catch {
      if (saveBtn) { saveBtn.classList.remove('saved'); saveBtn.textContent = 'Save settings'; }
      if (saveMsg) { saveMsg.textContent = 'Could not save'; saveMsg.dataset.tone = 'bad'; }
    }
  };
  const cb = document.getElementById('set-clearbuf');
  if (cb) cb.onclick = async () => {
    try { for (const id of [...preload.keys()]) releasePreload(id); } catch {}
    try { clearAppCache(); } catch {}
    try { if (window.caches && caches.keys) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    toast('Buffer cleared', 3000);
  };

  /* maintenance: housekeeping used to sit on the Library page, where it was noise */
  const paintCache = () => {
    const el = document.getElementById('set-cache');
    if (!el) return;
    const c = cacheSize();
    el.textContent = `${(c.bytes / 1024).toFixed(0)} KB cached · ${c.keys} items`;
  };
  paintCache();
  const setCacheClear = document.getElementById('set-cache-clear');
  if (setCacheClear) setCacheClear.onclick = async () => {
    clearAppCache();
    try { if (window.caches && caches.keys) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    paintCache();
    toast('Cache cleared', 3000);
  };
  // maintenance answers in the card, with numbers, instead of a toast that disappears
  const maintEl = document.getElementById('set-maint');
  const maint = (text, tone) => {
    text = tr(text);
    if (!maintEl) return;
    maintEl.textContent = text;
    maintEl.dataset.tone = tone || '';
  };
  const setRepair = document.getElementById('set-repair');
  if (setRepair) setRepair.onclick = async () => {
    setRepair.disabled = true;
    maint('Repairing metadata…');
    try {
      const r = await api('/api/maintenance/repair', { method: 'POST' });
      let durations = 0;
      try { const d = await api('/api/maintenance/fill-durations', { method: 'POST' }); durations = d.fixed || 0; } catch {}
      const bits = [];
      if (r.fixed_year) bits.push(`${Number(r.fixed_year).toLocaleString(LOC())} year${r.fixed_year === 1 ? '' : 's'} normalised`);
      if (r.cleared_placeholder_album) bits.push(`${r.cleared_placeholder_album} placeholder album${r.cleared_placeholder_album === 1 ? '' : 's'} cleared`);
      if (r.cleaned_titles) bits.push(`${r.cleaned_titles} media label${r.cleaned_titles === 1 ? '' : 's'} removed from titles`);
      if (r.trimmed) bits.push(`${r.trimmed} trimmed`);
      if (durations) bits.push(`${durations} duration${durations === 1 ? '' : 's'} filled`);
      maint(bits.length
        ? `Repair: ${bits.join(' · ')}${r.unknown_artists ? ` · ${r.unknown_artists} still have no artist` : ''}`
        : `Repair: nothing to fix - years, albums and titles are clean${r.unknown_artists ? `; ${r.unknown_artists} tracks have no artist` : ''}.`,
        bits.length ? 'ok' : 'muted');
      state.allTracks = null;
      bustCache();
    } catch (e) { maint(`Repair failed${e.message ? ` (${e.message})` : ''}`, 'bad'); }
    setRepair.disabled = false;
  };
  const folderField = document.getElementById('set-folder');  const folderRow = document.getElementById('set-folder-path-row');
  const folderSelect = document.getElementById('set-folder-select');
  const showFolderPath = (show) => { if (folderRow) folderRow.hidden = !show; };
  if (folderField) {
    try { folderField.value = localStorage.getItem('mf-folder') || ''; } catch {}
  }
  // The picker lists places this install may already scan, so the common case is a choice
  // instead of a path typed from memory. "Other folder…" brings the field back, which is
  // the only way a browser on another machine can name a folder.
  if (folderSelect && folderField) {
    const choose = async () => {
      let folders = [];
      try { folders = (await api('/api/library/folders', { nocache: true })).folders || []; } catch {}
      const chosen = folderField.value.trim();
      const matched = folders.some((f) => f.path === chosen);
      const options = [`<option value=""${chosen ? '' : ' selected'}>${esc(tr('Choose a folder…'))}</option>`];
      for (const f of folders) {
        options.push(`<option value="${esc(f.path)}"${f.path === chosen ? ' selected' : ''}>${esc(f.label)}</option>`);
      }
      options.push(`<option value="__other"${chosen && !matched ? ' selected' : ''}>${esc(tr('Other folder…'))}</option>`);
      folderSelect.innerHTML = options.join('');
      showFolderPath(!!chosen && !matched);
    };
    folderSelect.onchange = () => {
      const v = folderSelect.value;
      if (v === '__other') {
        folderField.value = '';
        showFolderPath(true);
        folderField.focus();
        return;
      }
      if (!v) return;
      folderField.value = v;
      showFolderPath(false);
    };
    choose();
  }
  const setFolderScan = document.getElementById('set-folder-scan');
  // the desktop shell can open the native folder picker; a browser tab cannot
  const folderPick = document.getElementById('set-folder-pick');
  if (folderPick && window.musicfyDesktop) {
    folderPick.hidden = false;
    folderPick.onclick = async () => {
      const picked = await window.musicfyDesktop.pickFolder();
      if (!picked) return;
      folderField.value = picked;
      showFolderPath(true);
      if (folderSelect) folderSelect.value = '__other';
      folderField.focus();
    };
  }
  if (setFolderScan) setFolderScan.onclick = async () => {
    const field = document.getElementById('set-folder');
    const out = document.getElementById('set-folder-out');
    const tr = (x) => (window.I18N ? window.I18N.t(x) : x);
    const target = (field.value || '').trim();
    if (!target) {
      out.textContent = tr('Choose a folder first.');
      out.dataset.tone = 'bad';
      field.focus();
      return;
    }
    setFolderScan.disabled = true;
    out.dataset.tone = '';
    out.textContent = tr('Looking at the folder...');
    try { localStorage.setItem('mf-folder', target); } catch {}
    try {
      // this browser may be on another machine: the server decides which folders it may read
      const probe = await api('/api/library/scan', { nocache: true });
      if (!probe.local && !(probe.roots || []).length) {
        out.textContent = tr('A scan from another machine needs MUSICFY_MUSIC_ROOTS set on the server.');
        out.dataset.tone = 'bad';
        setFolderScan.disabled = false;
        return;
      }
      const started = await api('/api/library/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });
      if (!started.started) throw new Error(started.error || 'could not start');
      for (let i = 0; i < 3000; i += 1) {
        await new Promise((r) => setTimeout(r, 1200));
        const st = await api('/api/library/scan', { nocache: true });
        if (st.running) {
          out.textContent = st.total
            ? `${Number(st.done).toLocaleString(LOC())} / ${Number(st.total).toLocaleString(LOC())}`
            : tr('Looking at the folder...');
          continue;
        }
        const count = (n, one, many) => `${n} ${tr(n === 1 ? one : many)}`;
        const bits = [];
        if (st.added) bits.push(count(st.added, 'added one', 'added many'));
        if (st.linked) bits.push(count(st.linked, 'already here one', 'already here many'));
        if (st.skipped) bits.push(count(st.skipped, 'known one', 'known many'));
        if (st.missing) bits.push(count(st.missing, 'missing one', 'missing many'));
        if (st.playlists) bits.push(count(st.playlists, 'playlist one', 'playlist many'));
        out.textContent = st.error
          ? `${tr('Scan stopped:')} ${st.error}`
          : `${Number(st.total).toLocaleString(LOC())} ${tr('files read')}${bits.length ? ` - ${bits.join(', ')}` : ''}.`;
        out.dataset.tone = st.error ? 'bad' : 'ok';
        toast(st.error ? `Folder scan: ${st.error}` : `Library folder: ${bits.join(', ') || tr('nothing new')}`, 7000);
        state.allTracks = null;
        bustCache();
        break;
      }
    } catch (e) {
      out.textContent = `${tr('Could not scan:')} ${e.message || 'unknown'}`;
      out.dataset.tone = 'bad';
      toast(`Could not scan: ${e.message || 'unknown'}`, 6000);
    }
    setFolderScan.disabled = false;
  };
  const setGenres = document.getElementById('set-genres');
  if (setGenres) setGenres.onclick = async () => {
    setGenres.disabled = true;
    maint('Asking MusicBrainz, one artist at a time…');
    try {
      // 409 means a pass is already running: watch that one instead of failing
      await api('/api/genre/run?limit=200', { method: 'POST' }).catch(() => {});
      for (let i = 0; i < 400; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await api('/api/genre/status', { nocache: true }).catch(() => null);
        if (!st) break;
        const j = st.job || {};
        if (j.running) {
          maint(`Genres: ${j.checked} artists checked · ${j.tagged} newly tagged · ${st.tagged} of ${st.total} tracks have a genre`);
        } else {
          maint(j.error
            ? `Genres: stopped - ${j.error}`
            : `Genres: ${j.checked} artists checked · ${j.tagged} newly tagged · ${j.families} families learned · ${st.tagged} of ${st.total} tracks now have a genre`, j.error ? 'bad' : 'ok');
          state.allTracks = null;
          break;
        }
      }
    } catch (e) { maint(`Could not start the genre pass: ${e.message || 'unknown'}`, 'bad'); }
    setGenres.disabled = false;
  };
  const setCovers = document.getElementById('set-covers');
  if (setCovers) setCovers.onclick = async () => {
    setCovers.disabled = true;
    maint('Looking for official album art…');
    try {
      const r = await api('/api/covers/fill?limit=60', { method: 'POST' });
      state.artV = Date.now();
      if (r.found) {
        maint(`Covers: ${r.found} found of ${r.tried} tried${r.failed ? ` · ${r.failed} could not be saved` : ''} · ${r.remaining} still without art`, 'ok');
      } else if (r.failed) {
        maint(`Covers: ${r.tried} tried, ${r.failed} could not be saved. Check that ffmpeg is installed and the data folder is writable, then run musicfy doctor.`, 'bad');
      } else {
        const names = (r.missing_titles || []).slice(0, 3).map((t) => `“${String(t).slice(0, 40)}”`).join(', ');
        maint(`Covers: ${r.tried} tried, none matched${names ? ` - the catalogue has nothing for ${names}` : ''}. ${r.remaining} still without art.`, 'warn');
      }
      state.allTracks = null;
    } catch (e) { maint(`Cover repair failed: ${e.message || 'unknown'}`, 'bad'); }
    setCovers.disabled = false;
  };
  const setDedupe = document.getElementById('set-dedupe');
  if (setDedupe) setDedupe.onclick = async () => {
    setDedupe.disabled = true;
    try {
      const preview = await api('/api/maintenance/duplicates', { nocache: true });
      if (!preview.groups && !preview.extra_files) {
        const versions = Number(preview.versions) || 0;
        maint(versions
          ? `Duplicates: none - ${versions} group${versions === 1 ? '' : 's'} are different versions (live, remaster, remix) and were left alone.`
          : 'Duplicates: none - no two rows share artist, title, album and length.', 'ok');
        setDedupe.disabled = false;
        return;
      }
      const bits = [];
      if (preview.tracks) bits.push(`${preview.tracks} duplicate track${preview.tracks === 1 ? '' : 's'}`);
      if (preview.extra_files) bits.push(`${preview.extra_files} extra file${preview.extra_files === 1 ? '' : 's'}`);
      const names = (preview.sample || []).slice(0, 3).map((x) => `${x.artist ? x.artist + ' - ' : ''}${x.title}`).join('; ');
      if (!(await uiConfirm(`${tr('Remove')} ${bits.join(' ' + tr('and') + ' ')}? ${tr('The best copy is kept, playlists and likes move to it, and the extra files are deleted from disk.')}${names ? `\n\n${names}` : ''}`))) { setDedupe.disabled = false; return; }
      const r = await api('/api/maintenance/dedupe', { method: 'POST' });
      maint(`Duplicates: ${r.removed} track${r.removed === 1 ? '' : 's'} merged, ${r.files} file${r.files === 1 ? '' : 's'} removed`, 'ok');
      state.allTracks = null;
      bustCache();
    } catch (e) { maint(`Could not remove duplicates: ${e.message || 'unknown'}`, 'bad'); }
    setDedupe.disabled = false;
  };
  const rungs = document.getElementById('set-rungs');
  if (rungs) {
    api('/api/health/rungs').then((h) => {
      const parts = Object.entries(h.rungs || {}).map(([k, v]) => `${k} ${v.ok ? 'ok' : 'down'}`);
      rungs.textContent = parts.length ? `Sources: ${parts.join(', ')}` : 'Sources: not checked yet';
    }).catch(() => {});
  }
  const autoDl = document.getElementById('set-auto-dl');
  if (autoDl) autoDl.onchange = (e) => {
    const v = Math.max(0, Math.min(20, Number(e.target.value) || 0));
    api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auto_download_plays: v }) })
      .then(() => toast(v ? `Auto-save after ${v} plays` : 'Auto-save off'))
      .catch(() => toast('setting failed'));
  };
}

function renderAlbumsCard(a, out, stateEl) {
  if (stateEl) stateEl.textContent = '';
  const card = document.createElement('div');
  card.className = 'ask-action';
  const head = document.createElement('div');
  head.className = 'ask-action-head';
  head.innerHTML = `<div><div class="ask-action-kicker">ON DECK</div><b>${esc(a.action.title)}</b></div><span>${esc(a.action.summary || '')}</span>`;
  card.appendChild(head);
  if (a.action.reason) {
    const meta = document.createElement('div');
    meta.className = 'ask-action-meta';
    meta.textContent = a.action.reason;
    card.appendChild(meta);
  }
  const list = document.createElement('div');
  list.className = 'ask-albums';
  for (const al of (a.action.albums || [])) {
    const row = document.createElement('div');
    row.className = 'ask-album';
    const art = document.createElement('div');
    art.className = 'ask-album-art';
    if (al.cover) art.style.backgroundImage = `url("${al.cover}")`;
    const meta = document.createElement('div');
    meta.className = 'ask-album-meta';
    const owned = Number(al.owned) || 0;
    const total = Number(al.tracks) || 0;
    const bits = [al.year, total ? `${total} track${total === 1 ? '' : 's'}` : '', owned ? `${owned}${total ? ` of ${total}` : ''} here` : 'not in library'].filter(Boolean);
    meta.innerHTML = `<b>${esc(al.name)}</b><span>${esc(bits.join(' · '))}</span>`;
    // only a complete album opens; a partial or absent one offers the missing tracks
    const complete = total > 0 ? owned >= total : owned > 0;
    const act = document.createElement('button');
    act.className = `btn ${complete ? 'btn-ghost' : 'btn-primary'} ask-album-act`;
    if (complete) {
      act.textContent = 'Open';
      act.onclick = (e) => { e.stopPropagation(); renderAlbum(al.name); };
    } else {
      act.textContent = 'Download';
      act.onclick = async (e) => {
        e.stopPropagation();
        act.disabled = true;
        act.textContent = 'Queueing…';
        try {
          const r = await api('/api/albums/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: al.name }) });
          act.textContent = r.queued ? `${r.queued} queued` : 'Already here';
          toast(r.queued ? `${r.queued} tracks queued from “${al.name}”` : `Nothing missing from “${al.name}”`, 6000);
        } catch { act.disabled = false; act.textContent = 'Download'; toast('Could not queue that album', 4000); }
      };
    }
    row.append(art, meta, act);
    // an owned album opens; an outside album downloads, because its page would be empty
    row.onclick = () => { if (complete) renderAlbum(al.name); else act.click(); };
    list.appendChild(row);
  }
  card.appendChild(list);
  out.appendChild(card);
}

function renderActionCard(a, out, stateEl) {
  if (a.action && a.action.kind === 'albums') { renderAlbumsCard(a, out, stateEl); return; }
  if (stateEl) stateEl.textContent = '';
  const card = document.createElement('div');
  card.className = 'ask-action';
  const head = document.createElement('div');
  head.className = 'ask-action-head';
  head.innerHTML = `<div><div class="ask-action-kicker">ON DECK</div><b>${esc(a.action.title)}</b></div><span>${esc(a.action.summary || '')}</span>`;
  card.appendChild(head);
  const said = (out.querySelector('.answer-said') || {}).textContent || '';
  if (a.action.reason && a.action.reason !== said) {
    const meta = document.createElement('div');
    meta.className = 'ask-action-meta';
    meta.textContent = a.action.reason;
    card.appendChild(meta);
  }
  const tracks = a.action.tracks || [];
  // nothing found is an answer, not a draft: no confirm button for an empty set
  if (!tracks.length) {
    const none = document.createElement('div');
    none.className = 'ask-action-safety';
    none.textContent = 'Nothing to build from this one.';
    card.appendChild(none);
    out.appendChild(card);
    return;
  }
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
      if (r.data && r.data.queued) toast(`${r.data.queued} downloads queued in the background`, 6000);
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
    ok.textContent = a.action.kind === 'playlist' ? 'Create playlist'
      : a.action.kind === 'album' ? 'Download album'
      : a.action.kind === 'download' ? `Download ${tracks.length}`
      : 'Download missing';
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

/* Play and queue on any answer, at once, with the queue's undo on the same card. */
function answerActions(tracks, out) {
  if (!tracks || !tracks.length) return null;
  const acts = document.createElement('div');
  acts.className = 'answer-notes ask-actions';
  const play = document.createElement('button');
  play.className = 'btn btn-primary';
  play.textContent = `Play ${tracks.length}`;
  play.onclick = () => playList(tracks, 0, false, 'A&R');
  const queue = document.createElement('button');
  queue.className = 'btn btn-ghost';
  queue.textContent = `Queue ${tracks.length}`;
  queue.onclick = () => {
    const added = tracks.filter((t) => hasAudio(t) || t.rung);
    if (!added.length) { toast('None of these have audio yet', 4000); return; }
    const start = state.queue.length;
    state.queue.push(...added);
    saveQueue();
    queue.disabled = true;
    queue.textContent = `Queued ${added.length}`;
    const undo = document.createElement('button');
    undo.className = 'btn btn-ghost';
    undo.textContent = 'Undo';
    undo.onclick = () => {
      state.queue.splice(start, added.length);
      if (state.qi >= state.queue.length) state.qi = state.queue.length - 1;
      saveQueue();
      undo.remove();
      queue.disabled = false;
      queue.textContent = `Queue ${tracks.length}`;
      toast('Queue restored', 2500);
    };
    acts.appendChild(undo);
    toast(`${added.length} queued`, 3000);
  };
  acts.append(play, queue);
  out.appendChild(acts);
  return acts;
}

/* "no Imagine Dragons" is an instruction, not a search. It writes one permanent
   exclusion, shows what it wrote, and offers the undo. */
const TEACH_RE = /^(?:no|not|don'?t play|do not play|never play|stop playing|avoid|skip|ban|exclude)\s+(.{2,60})$/i;

async function teachExclusion(raw, out, stateEl, box) {
  const term = raw.trim().replace(/[.!]+$/, '');
  stateEl.classList.remove('thinking');
  stateEl.textContent = '';
  out.innerHTML = '';
  let before = '';
  try {
    const d = await api('/api/settings', { nocache: true });
    before = String((d.settings || {}).taste_avoid || '');
    const next = [...before.split(',').map((x) => x.trim()).filter(Boolean), term].join(', ');
    await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taste_avoid: next }) });
    state.settings = { ...(state.settings || {}), taste_avoid: next };
  } catch { toast('Could not save that exclusion', 4000); return; }

  const card = document.createElement('div');
  card.className = 'answer';
  card.innerHTML = `<div class="answer-head"><span class="answer-kicker">TAUGHT</span><span class="answer-q">${esc(term)}</span></div>
    <p class="answer-said">Excluded from picks, Flow, the rotation and the harmonic queue from now on.</p>
    <div class="avoid-terms"><span class="avoid-label">never in picks</span><span class="avoid-term">${esc(term)}</span></div>`;
  const acts = document.createElement('div');
  acts.className = 'answer-notes';
  const undo = document.createElement('button');
  undo.className = 'btn btn-ghost';
  undo.textContent = 'Undo';
  undo.onclick = async () => {
    try {
      await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taste_avoid: before }) });
      state.settings = { ...(state.settings || {}), taste_avoid: before };
      card.remove();
      toast('Exclusion removed', 3000);
    } catch { toast('Could not undo', 3000); }
  };
  acts.appendChild(undo);
  card.appendChild(acts);
  out.appendChild(card);
  if (box) box.value = '';
}

async function runAssistant(text, out, stateEl, box) {
    // curly quotes from a phone keyboard are the same instruction
    text = String(text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    if (!text.trim()) return;
      closeInlinePreview();
    $('view').classList.add('asking');
    stateEl.textContent = 'Searching';
    stateEl.classList.add('thinking');
    out.innerHTML = '';
    // the sentence decides the destination, not a verb list: "10 electronic tracks I
    // don't have" and "outside my library" were going to the library filter
    // This is the A&R view: the agent reads every sentence. A regex deciding which
    // sentences "look like requests" is how a Portuguese sentence fell through to the
    // keyword parser and answered with tracks tagged Christmas by mistake.
    const agentish = true;
    try {
      if (agentish) {
        // the server can merge a short follow-up into the previous plan; only the client
        // knows what that plan was, and only for this session
        const a = await api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text, previous: state.arLast || undefined }), nocache: true });
        if (a.plan) state.arLast = { question: a.question || text, plan: a.plan };
        stateEl.classList.remove('thinking');
        const src = String(a.source || 'rules');
        // a help answer has no plan; reading a.plan.intent threw and the answer never showed
        stateEl.textContent = a.plan
          ? `${String(a.plan.intent).replace(/_/g, ' ')} · ${/llm/.test(src) ? 'model' : 'local'}${/follow/.test(src) ? ' · follow-up' : ''}${/outside/.test(src) ? ' · outside' : ''}`
          : (src === 'help' ? 'What I can do' : src);
        if (!a.action) {
          const said = document.createElement('div');
          said.className = 'ai-said';
          // the capability answer comes back as `answer`, not as a spoken draft line
          said.textContent = a.spoken || a.answer || '';
          out.appendChild(said);
        }
        if (Array.isArray(a.examples) && a.examples.length) {
          const hint = document.createElement('div');
          hint.className = 'ask-hint';
          for (const ex of a.examples) {
            const b = document.createElement('button');
            b.className = 'ask-ex';
            b.dataset.ask = ex;
            b.textContent = tr(ex);
            b.onclick = () => { box.value = b.textContent; run(ex); };
            hint.appendChild(b);
          }
          out.appendChild(hint);
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
          const tracks = lib.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
          answerActions(tracks, out);
          const wrap = document.createElement('div');
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
          b.dataset.ask = ex;
          b.textContent = tr(ex);
          b.onclick = () => { box.value = b.textContent; runAssistant(ex, out, stateEl, box); };
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
      const tracks = d.results.map((r) => ({ ...r, rung: r.owned ? 'local' : null }));
      answerActions(tracks, out);
      const wrap = document.createElement('div');
      tracks.forEach((t, i) => { registerRow(t); wrap.appendChild(trow(t, i, tracks)); });
      out.appendChild(wrap);
    } catch (e) {
      stateEl.classList.remove('thinking');
      stateEl.textContent = 'That did not go through - try a plain phrase like “tracks between 120 and 130 BPM”.';
    }
  }

let arRecoTimer = null;

function paintArReco(host, picks) {
  if (!host) return;
  if (!picks || !picks.length) {
    host.hidden = true;
    const start = document.getElementById('ai-start');
    if (start) start.hidden = false;
    return;
  }
  host.hidden = false;
  // the three-step explainer is for an empty library; once there are picks, the picks
  // are the point and the tutorial would push them below the fold
  const start = document.getElementById('ai-start');
  if (start) start.hidden = true;
  host.innerHTML = `<div class="sec-title">${tr('For you now')}<button class="icon-btn" id="ai-reco-new" type="button" title="${tr('New picks')}" aria-label="${tr('New picks')}">↻</button></div>
    <p class="set-note ai-reco-note">${tr('Nothing is saved or downloaded until you confirm.')}</p>`;
  const row = document.createElement('div');
  row.className = 'row-scroller';
  picks.forEach((t) => row.appendChild(trackCard(t, picks, 'For you now')));
  host.appendChild(row);
  const again = host.querySelector('#ai-reco-new');
  if (again) again.onclick = () => loadArReco(true);
}

async function loadArReco(force = false) {
  const host = document.getElementById('ai-reco');
  if (!host) return;
  if (!force && state.arReco && Date.now() - state.arReco.at < 5 * 60 * 1000) {
    paintArReco(host, state.arReco.picks);
    return;
  }
  host.hidden = false;
  host.innerHTML = `<div class="sec-title">${tr('For you now')}</div><div class="ladder-state">${tr('Choosing picks…')}</div>`;
  try {
    const d = await api('/api/recommend?limit=8&days=30', { nocache: true });
    state.arReco = { at: Date.now(), picks: d.picks || [] };
    if (!document.body.contains(host)) return;
    paintArReco(host, state.arReco.picks);
  } catch { host.hidden = true; }
}

async function renderAskAi() {
  closeInlinePreview();
  setNav('askai');
  state.view = 'askai'; state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = tr('A&R');
  const v = $('view');
  // Generic on purpose: a fresh install must show examples that make sense without the
  // owner's library, artists or taste. No real artist names, no library-derived prompts.
  v.innerHTML = `<h1 class="sr-only">A&amp;R</h1>
    <p class="page-sub">Describe what you want; it builds a draft before anything is saved.</p>
    <div class="search-wrap">
      <input class="search" id="ai-q" placeholder="Describe what you want: a playlist, a filter or a question" autocomplete="off">
      <div class="ask-hint">
        <button class="ask-ex" data-ask="create a playlist of 20 tracks">create a playlist of 20 tracks</button>
        <button class="ask-ex" data-ask="tracks between 120 and 130 BPM">tracks between 120 and 130 BPM</button>
        <button class="ask-ex" data-ask="how much of my library has audio">how much of my library has audio</button>
        <button class="ask-ex" data-ask="what can you do">what can you do</button>
      </div>
      <div class="ladder-state" id="ai-state"></div>
    </div>
    <div class="ask-start" id="ai-start">
      <div class="ask-start-step"><b>1</b><span>Describe a set, a filter or a question.</span></div>
      <div class="ask-start-step"><b>2</b><span>You see the plan and the tracks as a draft.</span></div>
      <div class="ask-start-step"><b>3</b><span>Nothing is saved or downloaded until you confirm.</span></div>
    </div>
    <div class="ai-reco" id="ai-reco" hidden></div>
    <div id="ai-res"></div><div id="ask-discover"></div>`;
  const box = $('ai-q');
  const out = $('ai-res');
  const stateEl = $('ai-state');

  if (arRecoTimer) { clearInterval(arRecoTimer); arRecoTimer = null; }
  loadArReco();
  arRecoTimer = setInterval(() => {
    if (state.view !== 'askai') { clearInterval(arRecoTimer); arRecoTimer = null; return; }
    loadArReco(true);
  }, 5 * 60 * 1000);

  const run = (text) => {
    const start = document.getElementById('ai-start');
    if (start) start.hidden = true;
    const reco = document.getElementById('ai-reco');
    if (reco) reco.hidden = true;
    const teach = String(text || '').trim().match(TEACH_RE);
    if (teach) return teachExclusion(teach[1], out, stateEl, box);
    return runAssistant(text, out, stateEl, box);
  };
  if (state.arPending) {
    const q0 = state.arPending;
    state.arPending = null;
    box.value = q0;
    run(q0);
  }

  box.onkeydown = (e) => { if (e.key === 'Enter') run(box.value); };
  v.querySelectorAll('.ask-ex').forEach((b) => b.onclick = () => { box.value = b.textContent; run(box.value); });
  box.focus();
  renderExternalInto($('ask-discover'));
  // The examples stay generic. They used to be replaced on load with "10 tracks by
  // <artist from this library>", which reads as a bug on a fresh install and as a
  // presumption on someone else's.
}

async function renderSearch() {
  closeInlinePreview();
  setNav('search'); state.playlistId = null; state.genreFilter = null; renderSidebar();
  $('view-title').textContent = tr('Search');
  const v = $('view');
  v.innerHTML = `<h1 class="sr-only">Search</h1>
    <div class="search-wrap">
      <div class="search-field">
        <input class="search" id="q" placeholder="Search tracks, artists and albums" autocomplete="off">
        <span class="search-status status" id="search-status" hidden></span>
      </div>
      <div class="ask-hint" id="search-hints">
        <button class="ask-ex" data-ar data-ask="create a playlist of 20 tracks">create a playlist of 20 tracks</button>
        <button class="ask-ex" data-ar data-ask="tracks between 120 and 130 BPM">tracks between 120 and 130 BPM</button>
        <button class="ask-ex" data-ar data-ask="how much of my library has audio">how much of my library has audio</button>
      </div>
      <div class="mode-tabs" id="mode-tabs">
        <span class="filters-label">Scope</span>
        <button class="mode-tab on" data-search-scope="both" aria-pressed="true">Both</button>
        <button class="mode-tab" data-search-scope="lib" aria-pressed="false">This library</button>
        <button class="mode-tab" data-search-scope="web" aria-pressed="false">Web</button>
        <button class="mode-tab" id="long-sets" data-on="false" aria-pressed="false" title="Include DJ mixes, sets and long recordings">Long sets</button>
      </div>
      <div class="ladder-state" id="ladder-state"></div>
    </div><div id="search-sets"></div><div id="qres"></div><div id="search-discover"></div>`;
  renderExternalInto($('search-discover'));
  const q = $('q'); q.focus();
  if (!state.allTracks) state.allTracks = await api('/api/tracks');
  const all = state.allTracks;
  const res = $('qres');
  let mode = 'all';
  let searchLib = state.searchLib !== false;
  let searchWeb = state.searchWeb !== false;
  let ladderCtl = null; // {abort}

  const scopeBtns = [...document.querySelectorAll('[data-search-scope]')];
  const paintScope = () => {
    const cur = !searchLib ? 'web' : !searchWeb ? 'lib' : 'both';
    scopeBtns.forEach((b) => {
      const on = b.dataset.searchScope === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  scopeBtns.forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.searchScope;
      searchLib = s !== 'web';
      searchWeb = s !== 'lib';
      state.searchLib = searchLib;
      state.searchWeb = searchWeb;
      paintScope();
      draw();
    };
  });
  paintScope();
  if (state.searchPending) {
    const pending = state.searchPending;
    state.searchPending = null;
    q.value = pending;
  }
  // a question about the library, not a search for a word: tempo, key, counting, making
  const assistantish = /\b(create|make|build|download|playlist|how many|how much|top rated|top \d|what can|help|which|who|when)\b|\b(tracks?|songs?)\b[^.]*\b(in|between|around|with|from)\b|\bbpm\b/i;
  const disc = $('search-discover');
  const statusEl = $('search-status');
  const setSearchStatus = (text) => {
    if (!statusEl) return;
    statusEl.innerHTML = text ? `${esc(text)}<span class="dots"><i></i><i></i><i></i></span>` : '';
    statusEl.hidden = !text;
  };
  // no Search|Ask switch any more: asking has its own destination, so this page has one job
  const hints = $('search-hints');
  const submit = () => {
    const text = q.value.trim();
    if (!text) { if (disc) disc.hidden = false; draw(); return; }
    // a sentence that asks for something is A&R's job; searching its words answers nothing
    const requestish = /\b(create|make|build|download|find|search|show|list|playlist|crate|how many|how much)\b/i.test(text)
      || /\b(crie|criar|cria|fa[cç]a|fazer|monte|montar|lista|playlist|baixar|baixe|quantas?|quantos?|procure|mostre)\b/i.test(text)
      || /^\s*\d{1,3}\s+\S+/i.test(text);
    if (requestish) { state.arPending = text; nav('askai'); return; }
    // a plain search ends the draft conversation; a short instruction continues it
    const followish = !!state.lastAgent && /^(more|fewer|less|another|add|remove|drop|make (?:it|them)|same|also|but|now|instead|plus|minus|swap|replace|darker|lighter|faster|slower|shorter|longer|no |without |only |just |and )/i.test(text);
    if (!followish) state.lastAgent = null;
    if (disc) disc.hidden = true;   // suggestions are for browsing
    $('view').classList.remove('asking');
    draw();
  };
  // every example is a question, so it opens the place that answers them
  // the examples are questions; A&R is where a question is answered
  document.querySelectorAll('#search-hints .ask-ex').forEach((b) => b.onclick = () => {
    q.value = b.textContent;
    state.arPending = b.dataset.ask || b.textContent;
    nav('askai');
  });
  const paintLS = () => {
    const ls = $('long-sets');
    if (!ls) return;
    ls.dataset.on = String(!!state.longSets);
    ls.classList.toggle('on', !!state.longSets);
    ls.setAttribute('aria-pressed', String(!!state.longSets));
  };
  paintLS();
  const lsBtn = $('long-sets');
  if (lsBtn) lsBtn.onclick = () => {
    state.longSets = !state.longSets;
    paintLS();
    if (q.value.trim()) draw();
  };


  const setsEl = $('search-sets');
  const paintSets = (needle) => {
    if (!setsEl) return;
    setsEl.innerHTML = '';
    if (!needle) return;
    const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const hits = (state.playlists || []).filter((p) => fold(p.name).includes(fold(needle))).slice(0, 8);
    if (!hits.length) return;
    const head = document.createElement('div');
    head.className = 'sec-title';
    head.textContent = tr('Playlists');
    setsEl.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'pgrid';
    hits.forEach((p) => grid.appendChild(pcard(p)));
    setsEl.appendChild(grid);
  };
  const draw = async () => {
    closeInlinePreview();
    if (statusEl && q.value.trim()) setSearchStatus('Searching', 'thinking');
    mode = searchLib && searchWeb ? 'all' : searchLib ? 'library' : 'ladder';
    const s = q.value.trim().toLowerCase();
    paintSets(s);
    if (state.genreFilter) { renderGenreView(res, all, 60); return; }
    res.innerHTML = '';
    if (!s) {
      res.innerHTML = `<div class="sec-title" style="margin-top:0">Browse all <small>${Number(all.length).toLocaleString(LOC())} TRACKS</small></div>`;
      const g = document.createElement('div'); g.className = 'pgrid';
      for (const p of state.playlists) g.appendChild(pcard(p));
      res.appendChild(g); return;
    }
    if (mode === 'ladder') { await drawLadder(s); return; }

    // match word by word: "burial archangel" must find Archangel by Burial
    const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const rawWords = fold(s).split(/\s+/).filter(Boolean);
    const words = rawWords.filter((w) => w.length > 2);
    const needHits = words.length >= 2 ? 2 : 1;
    const scored = all.map(t => {
      const tt = fold(t.title);
      const aa = fold(t.artist);
      const al = fold(t.album);
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
      const sf = fold(s);
      all.forEach(t => { const a = fold(t.artist).trim(); if (a && (a.includes(sf) || sf.includes(a))) artists[t.artist] = (artists[t.artist] || 0) + 1; });
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
    setSearchStatus('');
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
            card.className = 'cat-card';
            card.innerHTML = `<span class="cat-art">${esc(String(a.name || '?').charAt(0).toUpperCase())}</span><b>${esc(a.name)}</b><span>${esc(a.genre || 'artist')}</span>`;
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
            card.className = 'cat-card';
            card.innerHTML = `<span class="cat-art">${al.artwork ? `<img src="${esc(al.artwork)}" alt="" loading="lazy">` : esc(String(al.name || '?').charAt(0).toUpperCase())}</span><b>${esc(al.name)}</b><span>${esc(al.artist || '')}${al.year ? ' · ' + al.year : ''}</span>`;
            const queueAlbum = () => {
              toast(`Checking "${al.name}"`, 3000);
              api('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ q: `download the album ${al.name} by ${al.artist}` }) })
                .then((r) => {
                  if (r.action) renderActionCard(r, box, null);
                  else { toast(r.spoken || 'Queueing album', 9000); if (r.data && r.data.queued) toast(`${r.data.queued} queued - see Downloads for progress`, 6000); }
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
          card.className = 'cat-card';
          card.innerHTML = `<span class="cat-art">${esc(String(a.name || '?').charAt(0).toUpperCase())}</span><b>${esc(a.name)}</b><span>${esc(a.artist || (a.kind === 'library' ? 'YOUR LIBRARY' : 'ARCHIVE'))}</span>`;
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
    const value = q.value.trim();
    if (!value && disc) disc.hidden = false;
    if (!value) { setSearchStatus(''); return; }
    if (assistantish.test(value)) { setSearchStatus('Press Enter to search', 'idle'); return; }
    $('view').classList.remove('asking');
    setSearchStatus('Searching', 'thinking');
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

// The page header card, the same shape Prep has always used. The page name stays in the
// top bar too; this is the visual header, not the document title.
function pageHero(kicker, title, sub) {
  // The top bar names the page. A kicker and a title repeated it two more times and cost
  // about 50px on every view; the card keeps the one line that says what the page is for.
  return `<div class="page-hero">
    <p class="prep-sub">${esc(sub)}</p>
  </div>`;
}

function trow(t, i, list) {
  registerRow(t);
  const el = document.createElement('div');
  el.className = 'trow'; el.dataset.tid = t.id;
  const liked = isLiked(t);
  const stamp = t.date_added || t.added_at;
  const added = stamp ? new Date(stamp * 1000).toLocaleDateString(LOC(), { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  el.innerHTML = `
    <div class="tno"><span class="tno-num">${String(i + 1).padStart(2, '0')}</span><button class="tno-play" aria-label="Play">${IC.play}</button></div>
    ${artTag(t, 'tart', 96)}
    <div class="tmeta"><div class="tt">${esc(t.title)}</div>${(t.artist || t.album) ? `<div class="talbum-line${t.album ? '' : ' no-album'}">${t.artist ? `<span class="tal-artist alink" data-kind="artist">${esc(t.artist)}</span>` : ''}${t.artist && t.album ? '<span class="tal-sep"> &middot; </span>' : ''}${t.album ? `<span class="alink" data-kind="album">${esc(t.album)}</span>` : ''}</div>` : ''}${genreTag(t) ? `<button class="genrechip" data-kind="genre">${esc(genreTag(t))}</button>` : ''}${t.bpm ? `<div class="tbpm">${Math.round(t.bpm)} BPM${t.key ? ` <button class="keychip key-${keyHueClass(t.key, t.key_scale)}" data-kind="key" title="Sort by key">${esc(keyLabel(t))}</button>` : ''}</div>` : ''}</div>
    <div class="tartist"><span class="alink ${t.artist ? '' : 'muted'}" data-kind="artist">${esc(t.artist || 'unknown artist')}</span></div>
    <div class="talbum"><span class="alink" data-kind="album">${esc(t.album || '')}</span></div>
    <div class="tadded">${esc(added)}</div>
    <button class="like ${liked ? 'on' : ''}" title="Like" aria-label="Like">${liked ? IC.heartFull : IC.heart}</button>
    ${hasAudio(t)
      ? `<div class="trbadge rung-${esc(shortRung(t.rung).cls)}"><b>${esc(shortRung(t.rung).label)}</b> ${esc(t.quality || '')}</div>`
      : t.streamable
        ? `<div class="trbadge rung-yt" title="Plays from the source when you press play."><b>STREAM</b></div>`
        : `<div class="trbadge rung-mirror" title="Metadata only. Press the download icon to get the audio."><b>Not downloaded</b></div>`}
    <div class="tdur">${t.duration ? fmt(t.duration) : '-'}${state.offlineIds && state.offlineIds.has(t.id) ? '<span class="offline-dot" title="Available offline"></span>' : ''}</div>
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
  el.querySelectorAll('.tal-artist, .tartist .alink').forEach((a) => {
    if (!t.artist) return;
    a.onclick = (e) => { e.stopPropagation(); renderArtist(t.artist); };
  });
  const keyBtn = el.querySelector('.keychip');
  if (keyBtn) keyBtn.onclick = (e) => { e.stopPropagation(); state._keySort = (state._keySort || 0) + 1; sortSongsByKey(); };
  // the artist sits inside the album line on a phone; it must not open the album
  const albLinks = el.querySelectorAll('.talbum .alink, .talbum-line .alink:not(.tal-artist)');
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

function targetVolume() {
  const s = state.settings || {};
  const base = Number(state.volume ?? 0.9);
  const t = state.current;
  if (!s.normalize_loudness || !t || t.loudness == null) return Math.min(1, base);
  const gainDb = Number(s.target_loudness ?? -14) - Number(t.loudness);
  return Math.max(0, Math.min(1, base * Math.pow(10, Math.max(-18, Math.min(0, gainDb)) / 20)));
}

function setStatus(text) {
  // dedicated elements only: the artist line is not ours to rewrite. The mobile player
  // hides the bar, so it needs its own status or a stall there is completely silent.
  // the word is followed by three dots that carry the movement, not a dot before it
  const value = String(text || '').replace(/\.{2,}$/, '');
  for (const id of ['pb-status', 'np-status', 'mini-status']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = value ? `${esc(value)}<span class="dots"><i></i><i></i><i></i></span>` : '';
    el.hidden = !value;
  }
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
  // album and artist pages are cached GETs too; after a delete they would resurrect rows
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(`${CACHE_PREFIX}/api/group/`)) localStorage.removeItem(k);
    }
  } catch {}
  state.allTracks = null;
}

/* flip the row in place so the badge changes the moment the file lands */
function markRowOwned(trackId) {
  const row = document.querySelector(`.trow[data-tid="${trackId}"]`);
  if (!row) return;
  const badge = row.querySelector('.trbadge');
  if (badge) { badge.className = 'trbadge rung-local'; badge.innerHTML = '<b>Local</b>'; }
}

/* Watch a download and report it in place. Downloads never change the screen: the
   control that started one keeps the answer, and the Downloads tab is only ever opened
   by the person pressing its button. */
async function watchDownload({ trackId, job, onTick, minutes = 15 }) {
  const started = Date.now();
  while (Date.now() - started < minutes * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const d = await api('/api/downloads', { nocache: true });
      const item = (d.items || []).find((i) => (trackId && Number(i.track_id) === Number(trackId)) || (job && i.job_id === job));
      if (item) {
        const pct = item.state === 'done' ? 100 : Math.max(0, Math.min(99, Number(item.progress) || 0));
        if (onTick) onTick(pct, item.state);
        if (item.state === 'done') return { ok: true };
        if (['error', 'failed'].includes(item.state)) return { ok: false, why: item.detail };
        continue;
      }
      if (job) {
        const j = await api(`/api/jobs/${encodeURIComponent(job)}`);
        if (j.state === 'done') { if (onTick) onTick(100, 'done'); return { ok: true }; }
        if (j.state === 'error') return { ok: false, why: j.detail };
      }
    } catch {}
  }
  return { ok: false, why: 'still running' };
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
  state.artistName = name; state.albumName = null;
  setNav('library'); state.view = 'artist'; paintBack(); state.playlistId = null; renderSidebar();
  $('view-title').textContent = name;
  const v = $('view');
  v.innerHTML = `<div class="plhead">
      <div class="plhead-art ph">${esc(name.charAt(0).toUpperCase())}</div>
      <div>
        <div class="plhead-kicker">ARTIST</div>
        <h1 class="plhead-name">${esc(name)}</h1>
        <div class="plhead-meta"><b id="g-n">...</b> <span id="g-n-w">tracks</span> <span id="g-albums"></span></div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="g-play">${IC.play}&nbsp; Play</button>
        </div>
      </div></div>
    <div id="g-list"></div>`;
  let list = [];
  try { list = await api(`/api/group/artist/${encodeURIComponent(name)}`, { nocache: true }); } catch {}
  state._currentList = list;
  const gnA = $('g-n'); const elA = $('g-list');
  if (!gnA || !elA) return;
  const albums = [...new Set(list.map((t) => t.album).filter(Boolean))];
  gnA.textContent = list.length;
  { const w = $('g-n-w'); if (w) w.textContent = list.length === 1 ? 'track' : 'tracks'; }
  const gaA = $('g-albums');
  if (gaA) gaA.textContent = albums.length ? `· ${albums.length} album${albums.length === 1 ? '' : 's'}` : '';
  if (!list.length) { elA.innerHTML = `<div class="empty">No owned tracks for this artist yet. Search the web and download some.</div>`; return; }
  // An artist has no artwork of its own in this library, and the old page spent 192px on
  // an empty square with an initial. Its albums do have art (real, or the generated tile
  // the album page already serves), so the hero becomes a mosaic of them and the album list
  // becomes the same cards the Library uses.
  const covers = albums.slice(0, 4);
  if (covers.length) {
    const art = v.querySelector('.plhead-art.ph');
    if (art) {
      art.classList.remove('ph');
      art.classList.add('artist-mosaic');
      art.dataset.count = String(Math.min(covers.length, 4));
      art.innerHTML = covers
        .map((al) => `<img src="/api/cover-album/${encodeURIComponent(al)}?v=${state.artV || 0}" alt="" loading="eager">`)
        .join('');
    }
  }
  if (albums.length) {
    const head = document.createElement('div');
    head.className = 'sec-title';
    head.innerHTML = `${tr('Albums')} <small>${albums.length}</small>`;
    const grid = document.createElement('div');
    grid.className = 'pgrid artist-albums';
    const addCard = (al) => {
      const onAlbum = list.filter((t) => t.album === al);
      const year = (onAlbum.find((t) => t.year) || {}).year || '';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pcard';
      card.title = al;
      const img = document.createElement('img');
      img.className = 'pcard-art';
      img.loading = 'lazy';
      img.alt = '';
      img.src = `/api/cover-album/${encodeURIComponent(al)}?v=${state.artV || 0}`;
      img.onerror = () => {
        const ph = document.createElement('div');
        ph.className = 'pcard-art ph';
        ph.textContent = al.charAt(0).toUpperCase();
        img.replaceWith(ph);
      };
      const title = document.createElement('div');
      title.className = 'pcard-name';
      title.textContent = al;
      const sub = document.createElement('div');
      sub.className = 'pcard-sub';
      sub.textContent = [year, `${onAlbum.length} ${tr(onAlbum.length === 1 ? 'track' : 'tracks')}`]
        .filter(Boolean).join(' · ');
      card.append(img, title, sub);
      card.onclick = () => renderAlbum(al);
      grid.appendChild(card);
    };
    albums.slice(0, 12).forEach(addCard);
    v.insertBefore(head, elA);
    v.insertBefore(grid, elA);
    if (albums.length > 12) {
      const more = document.createElement('button');
      more.className = 'btn btn-ghost show-all';
      more.textContent = tr(`Show all ${albums.length}`);
      more.onclick = () => { grid.innerHTML = ''; albums.forEach(addCard); more.remove(); };
      v.insertBefore(more, elA);
    }
  }
  list.forEach((t, i) => { registerRow(t); elA.appendChild(trow(t, i, list)); });
  const gpA = $('g-play'); if (gpA) gpA.onclick = () => playList(list, 0, false, name);
}

/* album page: all owned tracks for one album */
async function renderAlbum(name, push = true) {
  if (push) state.history.push({ v: state.view, pid: state.playlistId, name: state.artistName || state.albumName });
  state.albumName = name; state.artistName = null;
  setNav('library'); state.view = 'album'; paintBack(); state.playlistId = null; renderSidebar();
  $('view-title').textContent = name;
  const v = $('view');
  const first = (await api(`/api/group/album/${encodeURIComponent(name)}`, { nocache: true }))[0];
  v.innerHTML = `<div class="plhead">
      <img class="plhead-art" src="/api/cover-album/${encodeURIComponent(name)}?v=${state.artV || 0}" alt="" loading="lazy"
        data-cover-initial="${esc(name.charAt(0).toUpperCase())}">
      <div>
        <div class="plhead-kicker">ALBUM</div>
        <h1 class="plhead-name">${esc(name)}</h1>
        <div class="plhead-meta"><b id="g-n">...</b> <span id="g-n-w">tracks</span> &middot; ${esc(first?.artist || '')}</div>
        <div class="plhead-actions">
          <button class="btn btn-primary" id="g-play">${IC.play}&nbsp; Play</button>
          <button class="btn btn-ghost" id="g-dl">Download album</button>
          <button class="btn btn-ghost" id="g-pick">Choose tracks</button>
          <button class="btn btn-ghost" id="g-repair">Fix metadata</button>
          <button class="btn btn-ghost" id="g-album-edit">Edit album</button>
          <button class="btn btn-ghost" id="g-covers">Choose cover</button>
          <button class="btn btn-ghost" id="g-upgrade">Find higher quality</button>
          <button class="btn btn-ghost" id="g-delete">Delete album</button>
        </div>
      </div></div>
    <div id="g-list"></div>`;
  let list = [];
  try { list = await api(`/api/group/album/${encodeURIComponent(name)}`, { nocache: true }); } catch {}
  state._currentList = list;
  const gnB = $('g-n'); const elB = $('g-list');
  if (!gnB || !elB) return;
  gnB.textContent = list.length;
  { const w = $('g-n-w'); if (w) w.textContent = list.length === 1 ? 'track' : 'tracks'; }
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
      if (r.queued) { toast(`${r.queued} queued - see Downloads for progress`, 6000); refreshView(); }
    } catch { toast('Could not queue the album', 4000); }
    btn.textContent = label;
    btn.disabled = false;
  };
  $('g-repair').onclick = () => watchRepair(`/api/albums/${encodeURIComponent(name)}/repair`);
  const albumEdit = $('g-album-edit');
  if (albumEdit) albumEdit.onclick = () => openBulkEdit(list.map((t) => t.id), (body) => {
    if (body.album !== undefined && body.album) renderAlbum(body.album);
    else refreshView();
  });
  $('g-covers').onclick = () => openAlbumCoverPicker(name, (first && first.artist) || '');
  $('g-delete').onclick = async () => {
    if (!list.length) return;
    const withAudio = list.filter((t) => hasAudio(t)).length;
    const msg = `Delete the album "${name}"? ${list.length} track${list.length === 1 ? '' : 's'} will be removed from the library and from every playlist${withAudio ? `, and ${withAudio} audio file${withAudio === 1 ? '' : 's'} will be deleted from disk` : ''}. This cannot be undone.`;
    if (!(await uiConfirm(tr(msg)))) return;
    try {
      const r = await api('/api/tracks/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: list.map((t) => t.id) }),
      });
      toast(`Album deleted - ${r.deleted} track${r.deleted === 1 ? '' : 's'} removed`, 5000);
      state.allTracks = null;
      bustCache();
      nav('songs');
    } catch (e) { toast(`Could not delete the album: ${e.message || 'unknown'}`, 6000); }
  };
  $('g-upgrade').onclick = async () => {
    try { const r = await api(`/api/albums/${encodeURIComponent(name)}/upgrade`, { method: 'POST' }); toast(r.queued ? `${r.queued} higher quality downloads queued` : 'No low-bitrate tracks to upgrade', 6000); if (r.queued) toast(`${r.queued} queued - see Downloads for progress`, 6000); } catch { toast('Could not queue upgrades', 4000); }
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
      toast(`Downloading ${n} tracks - progress stays in the Downloads tab`, 6000);
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
    <button class="btn btn-ghost" id="sel-edit">Edit album</button>
    <button class="btn btn-ghost" id="sel-delete">Delete</button>
    <button class="btn btn-ghost" id="sel-clear">Clear</button>`;
  host.appendChild(bar);
  bar.querySelector('#sel-create').onclick = selCreatePlaylist;
  bar.querySelector('#sel-add').onclick = selAddToPlaylist;
  bar.querySelector('#sel-edit').onclick = openBulkEdit;
  bar.querySelector('#sel-delete').onclick = () => deleteTracks([...state.selectedIds]);
  bar.querySelector('#sel-clear').onclick = clearSelection;
}

/* Move a selection to the right album. An album is not part of a track's identity, so
   this cannot collide with another row; it is one UPDATE per selected track. */
function openBulkEdit(idsArg, afterSave) {
  const ids = Array.isArray(idsArg) ? idsArg : [...state.selectedIds];
  if (!ids.length) return;
  const rows = ids.map((id) => (state._rows && state._rows.get(id)) || {}).filter(Boolean);
  const same = (key) => {
    const vals = rows.map((r) => String(r[key] ?? ''));
    return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : '';
  };
  openMetaDialog({
    title: `Edit ${ids.length} track${ids.length === 1 ? '' : 's'}`,
    subtitle: 'Album and year apply to every selected track.',
    fields: [
      { key: 'album', label: 'Album', value: same('album'), toggle: true, checked: true, toggleLabel: 'Set album', placeholder: 'album name' },
      { key: 'year', label: 'Year', value: same('year'), toggle: true, checked: false, toggleLabel: 'Set year', inputmode: 'numeric', placeholder: 'e.g. 1998' },
    ],
    onSave: async (body) => {
      if (body.album === undefined && body.year === undefined) return 'Tick album or year first';
      const res = await fetch('/api/tracks/edit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || 'Could not update those tracks';
      state.allTracks = null;
      bustCache();
      clearSelection();
      toast(`${data.updated} track${data.updated === 1 ? '' : 's'} updated`, 4000);
      if (typeof afterSave === 'function') afterSave(body); else refreshView();
      return null;
    },
  });
}

async function selCreatePlaylist() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const name = await uiPrompt(tr('Playlist name for the selection:'));
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
  // it takes 138px of the top bar on every page; it belongs to Library and Settings
  el.hidden = state.view !== 'songs';
  api('/api/stats', { nocache: true }).then((s) => {
    el.textContent = `${Number(s.tracks).toLocaleString(LOC())} TRACKS · ${fmtSize(s.owned_bytes)}`;
  }).catch(() => { el.textContent = ''; });
}

function afterWrite() { try { bustCache(); } catch {} try { paintPill(); } catch {} }

/* patch only the rows whose audio state changed, so filters and scroll survive */
async function refreshRowsInPlace() {
  const all = await api('/api/tracks', { nocache: true });
  state.allTracks = all;
  const byId = new Map(all.map((t) => [t.id, t]));
  for (const row of [...document.querySelectorAll('.trow[data-tid]')]) {
    const t = byId.get(Number(row.dataset.tid));
    if (!t) continue;
    const badge = row.querySelector('.trbadge');
    const hadAudio = !!(badge && !badge.classList.contains('rung-mirror'));
    const hasAudioNow = !!(t.owned || t.rung === 'local');
    if (hadAudio === hasAudioNow) continue;
    const list = state._currentList && state._currentList.length ? state._currentList : all;
    const idx = Math.max(0, list.findIndex((x) => x.id === t.id));
    const withState = { ...t, owned: hasAudioNow ? 1 : 0 };
    row.replaceWith(trow(withState, idx, list));
  }
}

/* A download landing changes the library, the playlists and any open list. The drawer
   polled only while it was open, so a closed drawer left every view stale until reload. */
let dlWatchTimer = null;
let dlLastDone = null;
async function watchDownloads() {
  try {
    const d = await api('/api/downloads', { nocache: true });
    const busy = (d.active || 0) + (d.queued || 0);
    // any change in the queue's outcome means a view may be stale, not just a success
    const done = (Number(d.done) || 0) * 1000 + (Number(d.failed) || 0) * 10 + (Number(d.skipped) || 0);
    if (dlLastDone != null && done !== dlLastDone) {
      bustCache();
      try { await loadPlaylists(); } catch {}
      try { paintPill(); } catch {}
      // a list the user is filtering must not be rebuilt under them: patch the rows
      if (state.view === 'songs' || state.view === 'search') { try { await refreshRowsInPlace(); } catch {} }
      else { try { refreshView(); } catch {} }
      if (!$('dl-drawer').hidden) renderDownloads();
    }
    dlLastDone = done;
    const want = busy ? 4000 : 15000;
    if (dlWatchTimer) clearInterval(dlWatchTimer);
    dlWatchTimer = setInterval(watchDownloads, want);
  } catch {
    if (dlWatchTimer) clearInterval(dlWatchTimer);
    dlWatchTimer = setInterval(watchDownloads, 15000);
  }
}

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
audio.addEventListener('canplay', () => setStatus(null));
audio.addEventListener('timeupdate', maybePrefetch);
audio.addEventListener('loadstart', () => setStatus('Loading'));

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
      const app = $('app'); if (app) app.classList.remove('no-track');
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
  // 'unavailable' means no usable source was found: that has to stay visible, or the
  // row simply disappears and the download looks like it did nothing
  const all = (d.items || []).filter((i) => ['running', 'queued', 'error', 'unavailable'].includes(i.state));
  all.sort((a, b) => {
    const rank = (x) => (x.state === 'running' ? 0 : x.state === 'queued' ? 1 : x.state === 'error' ? 2 : 3);
    return rank(a) - rank(b) || (b.id - a.id);
  });
  const items = all.slice(0, 120);
  const lib = d.library || { total: 0, with_audio: 0, missing: 0 };
  const pct = lib.total ? Math.round((lib.with_audio / lib.total) * 100) : 0;
  const missingOpen = state.missingOpen === true;
  const missingPrompt = !!(lib.missing && localStorage.getItem('mf-missing-hidden') !== '1');
  const queueLine = [
    lib.catalogue ? `${lib.catalogue} catalogue-only` : '',
    `${d.active} running`,
    `${d.queued} queued`,
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join('<span class="dl-dot">·</span>');
  host.innerHTML = `<div class="dl-summary">
      <span class="dl-lib">${lib.with_audio} of ${lib.total} tracks have audio (${pct}%)</span>
      <span class="dl-sub">${queueLine}${d.failed ? `<span class="dl-dot">·</span><span class="warn-txt">${d.failed} failed</span>` : ''}</span>
    </div>
    <div class="dl-libbar"><i style="width:${pct}%"></i></div>
    <div class="dl-tools">
      ${d.failed ? `<button class="dl-act" id="dl-retry-all">Retry all failed (${d.failed})</button>` : ''}
      ${(d.active + d.queued) ? `<button class="dl-act" id="dl-cancel-all">Cancel all (${d.active + d.queued})</button>` : ''}
      ${missingPrompt && !(d.active + d.queued) ? `<button class="dl-act" id="dl-see-missing">${missingOpen ? 'Hide the list' : `See the ${lib.missing} missing`}</button>
      <button class="dl-act" id="dl-fill">Fill ${lib.missing} missing track${lib.missing === 1 ? '' : 's'}</button>
      <button class="dl-act" id="dl-hide-missing">Not now</button>` : ''}
      ${d.failed ? `<button class="dl-act" id="dl-clear-failed">Dismiss failed (${d.failed})</button>` : ''}
    </div>
    <div class="dl-missing" id="dl-missing-list" ${missingOpen ? '' : 'hidden'}></div>` + (items.length ? items.map((i) => {
      const label = i.state === 'running' ? `${i.progress}%`
        : i.state === 'queued' ? 'waiting'
        : i.state === 'unavailable' ? 'no source'
        : i.state === 'error' ? 'failed'
        : i.state;
      return `
      <div class="dl-row" data-job="${i.id}">
        <div class="dl-line">
          <span class="dl-title">${esc(i.title || 'track')}</span>
          <span class="dl-pct${i.state === 'unavailable' || i.state === 'error' ? ' warn' : ''}">${esc(label)}</span>
        </div>
        ${i.state === 'unavailable' || i.state === 'error' ? '' : `<div class="dl-bar"><i style="width:${i.state === 'done' ? 100 : Math.max(2, i.progress || 0)}%"></i></div>`}
        ${i.detail && (i.state === 'error' || i.state === 'unavailable') ? `<div class="dl-err">${esc(i.detail.slice(0, 70))}</div>` : ''}
        <div class="dl-actions">
          ${i.state === 'error' || i.state === 'unavailable' ? `<button class="dl-act" data-retry="${i.id}">Retry</button>` : ''}
          ${i.state === 'running' || i.state === 'queued' ? `<button class="dl-act" data-cancel="${i.id}">Cancel</button>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="q-empty">Nothing in the queue.</div>`);

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
  const seeMissing = host.querySelector('#dl-see-missing');
  if (seeMissing) seeMissing.onclick = async () => {
    state.missingOpen = !state.missingOpen;
    await renderDownloads();          // the list only exists after the redraw
    if (!state.missingOpen) return;
    const box = document.getElementById('dl-missing-list');
    if (!box) return;
    box.innerHTML = '<div class="dl-missing-empty">Reading the library…</div>';
    try {
      const r = await api('/api/downloads/missing', { nocache: true });
      box.innerHTML = (r.tracks || []).map((t) => `<div class="dl-missing-row">
          <div class="dl-missing-t"><b>${esc(t.title || '')}</b><i>${esc(t.artist || '')}</i></div>
          <button class="dl-act" data-grab="${t.id}">Download</button>
        </div>`).join('') || '<div class="dl-missing-empty">Nothing is missing.</div>';
      box.querySelectorAll('[data-grab]').forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          b.textContent = 'Queued';
          try { await api(`/api/tracks/${b.dataset.grab}/download`, { method: 'POST' }); } catch { b.textContent = 'Failed'; }
        };
      });
    } catch { box.innerHTML = '<div class="dl-missing-empty">Could not read the list.</div>'; }
  };
  const hideMissing = host.querySelector('#dl-hide-missing');
  if (hideMissing) hideMissing.onclick = () => {
    localStorage.setItem('mf-missing-hidden', '1');
    state.missingOpen = false;
    toast('Missing tracks stay hidden until you clear this', 4000);
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
function isIOS() {
  const p = navigator.platform || '';
  if (/iP(hone|ad|od)/.test(p)) return true;
  return p === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// fetch the next track ahead of time and keep the bytes in memory; works the same
// on iPhone, Android and desktop because it avoids the resolver round trip at play time
const preload = new Map();
const PRELOAD_MAX = 1;

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
    } else if (isIOS()) {
      // iOS keeps one audio session. A second media element loading in the background is
      // how the track that was playing loses its session when the screen goes dark, so on
      // iOS the warm-up is a plain ranged fetch: DNS, TLS and the file's first pages.
      fetch(streamUrl(t), { headers: { Range: 'bytes=0-65535' } }).catch(() => {});
      preload.set(t.id, { el: null, at: Date.now() });
    } else {
      const el = new Audio();
      el.preload = 'auto';
      el.muted = true;
      el.src = streamUrl(t);
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
  const ahead = state.settings && state.settings.prefetch_ahead != null ? Number(state.settings.prefetch_ahead) : 1;
  if (ahead <= 0) return;
  // a prefetch on a metered or slow link steals the bandwidth of the track that is
  // playing, which is how a car ends up stalling on a track that was already fine
  const conn = navigator.connection || {};
  if (conn.saveData) return;
  if (/^(slow-2g|2g|3g)$/.test(conn.effectiveType || '')) return;
  const next = state.queue[state.qi + 1];
  if (next) prefetchTrack(next);
  const after = state.queue[state.qi + 2];
  if (ahead >= 2 && after) setTimeout(() => prefetchTrack(after), 6000);
}

/* only warm the next track after the current one has played a while and holds buffer:
   asking for three streams at once over one slow uplink is what made the whole thing slow */
let prefetchedFor = null;
function maybePrefetch() {
  const t = state.current;
  if (!t || prefetchedFor === t.id || audio.paused) return;
  if (audio.currentTime < 8) return;
  const b = audio.buffered;
  const ahead = b && b.length ? b.end(b.length - 1) - audio.currentTime : 0;
  // a slow link buffers barely ahead, and waiting for twelve seconds of slack meant the
  // next track never got warmed: every change was a cold start
  if (ahead < 6) return;
  prefetchedFor = t.id;
  prefetchNext();
}

/* ============ playback ============ */
/* A car failure leaves no trace once the phone is unlocked. Keep the last events in
   localStorage so Settings can show what actually happened on the lock screen. */
function logPlay(ev, extra = {}) {
  try {
    const log = JSON.parse(localStorage.getItem('mf_play_log') || '[]');
    // the timestamp goes last: a caller's own `t` (a position) used to overwrite it
    log.push({ ...extra, ev, t: new Date().toISOString().slice(11, 19) });
    localStorage.setItem('mf_play_log', JSON.stringify(log.slice(-60)));
  } catch {}
}

function playList(list, i = 0, shuffled = false, origin = '') {
  const app = $('app'); if (app) app.classList.remove('no-track');
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

// a saved track plays from the offline copy; everything else goes straight to the server
function streamUrl(t, bust) {
  if (!t || !t.id) return '';
  // always the server path: the service worker is not allowed anywhere near audio,
  // because iOS kills it on lock and takes the stream down with it
  const base = `/api/stream/${t.id}`;
  return bust ? `${base}?r=${Date.now()}` : base;
}

/* A saved track is bytes in Cache Storage. Reading them is a page operation the worker
   does not mediate, so the audio element holds a blob it owns and the lock screen cannot
   take it away. */
const savedBlobs = new Map();
const SAVED_BLOB_KEEP = 6;
// the source of the next tracks, resolved while there is still audio playing. At the
// end of a track iOS can suspend the page before a Cache Storage read resolves, so the
// read must not happen on the "ended" path: it happens here instead.
const warmSrc = new Map();
async function savedAudioUrl(id) {
  if (savedBlobs.has(id)) {
    // refresh the insertion order so the LRU means "least recently played"
    const url = savedBlobs.get(id);
    savedBlobs.delete(id);
    savedBlobs.set(id, url);
    return url;
  }
  try {
    const c = await caches.open('mf-audio-v2');
    const hit = await c.match('/offline/' + id);
    if (!hit) return null;
    const url = URL.createObjectURL(await hit.blob());
    savedBlobs.set(id, url);
    // keep enough for a warmed queue; never release a URL that is waiting to be played.
    // warmSrc is capped at 4, so this loop always has a victim before the map can grow.
    while (savedBlobs.size > SAVED_BLOB_KEEP) {
      const victim = [...savedBlobs.keys()].find((k) => !warmSrc.has(k));
      if (victim === undefined) break;
      try { URL.revokeObjectURL(savedBlobs.get(victim)); } catch {}
      savedBlobs.delete(victim);
    }
    return url;
  } catch { return null; }
}

async function warmTrack(t) {
  if (!t || !t.id || warmSrc.has(t.id)) return null;
  try {
    const src = await offlineSrcIfNeeded(t, streamUrl(t));
    if (src) warmSrc.set(t.id, src);
    while (warmSrc.size > 4) {
      const oldest = warmSrc.keys().next().value;
      if (state.current && oldest === state.current.id) break;
      warmSrc.delete(oldest);
    }
    return src;
  } catch { return null; }
}

function warmUpcoming() {
  const ahead = Math.max(1, Number((state.settings && state.settings.prefetch_ahead) ?? 1) || 1);
  for (let k = 1; k <= ahead + 1; k += 1) {
    const t = state.queue[state.qi + k];
    if (t) warmTrack(t);
  }
  // The next track's bytes, not only its URL. A locked phone changing source at the end
  // of a track has to open a new connection at the worst possible moment; with the bytes
  // already in memory the change is local and instant.
  if (ahead >= 1) prefetchNextBytes(state.queue[state.qi + 1]);
}

/* one track of runway, held as a blob. Two entries at most: a phone in a car has better
   things to do with its memory than hold the whole queue. */
const prefetchBlobs = new Map();
let prefetching = false;
async function prefetchNextBytes(t) {
  if (!t || !t.id || prefetching) return;
  if (!hasAudio(t) || prefetchBlobs.has(t.id)) return;
  if (t.saved || (state.offlineIds && state.offlineIds.has(t.id))) return; // already on disk
  prefetching = true;
  try {
    const r = await fetch(`/api/stream/${t.id}`);
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    prefetchBlobs.set(t.id, url);
    while (prefetchBlobs.size > 2) {
      const [k, u] = prefetchBlobs.entries().next().value;
      try { URL.revokeObjectURL(u); } catch {}
      prefetchBlobs.delete(k);
    }
  } catch {} finally { prefetching = false; }
}

/* A saved track plays from the device, always. Not "only when the OS says offline":
 * in a car the server is behind a tunnel, a dead hotspot or a locked screen, and
 * navigator.onLine says true the whole time. The stream is the fallback. */
async function offlineSrcIfNeeded(t, src) {
  if (!t || !t.id) return src;
  // a prefetched track is already in memory: use it before any network path
  if (prefetchBlobs.has(t.id)) return prefetchBlobs.get(t.id);
  const saved = state.offlineIds && state.offlineIds.has(t.id);
  if (!saved) return src;
  return (await savedAudioUrl(t.id)) || src;
}

function trackPlayable(t) {
  if (!t) return false;
  return hasAudio(t) || t.streamable || !!t.rung || !!t.owned;
}

/* The one place a track starts. No await: by the time we get here the source is a
   string (a blob URL or a stream path), so the 'ended' handler can hand it to the
   element in the same task iOS is willing to run. */
let playToken = 0;
function startAudio(i, src, opts = {}) {
  if (i < 0 || i >= state.queue.length) return;
  playToken += 1;
  state.qi = i; state.current = state.queue[i];
  if (!opts.resume) state._resumeAt = 0;
  saveQueue();
  const t = state.current;
  pausePreviews();
  applyLoudnessGain(t);
  audio.src = src;
  try { audio.volume = targetVolume(); } catch {}
  prefetchedFor = null;
  const p = audio.play();
  // a locked iPhone can refuse the new source with NotAllowedError. Record it, and let
  // the unlock handler retry: silently ignoring the rejection hid the whole failure.
  if (p && p.catch) p.catch((e) => logPlay('play-blocked', { id: t.id, why: (e && e.name) || 'error' }));
  // do not log a play the moment it starts: wait until it is genuinely being listened to
  state._listenTrack = t;
  state._listenLogged = false;
  paintNowPlaying();
  paintRows();
  if (!$('queue-drawer').hidden) renderQueue();
  warmUpcoming();
  state._wantPlaying = true;
  logPlay('start', { id: t.id, src: String(src).startsWith('blob:') ? 'blob' : 'stream' });
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
  const t = state.queue[i];
  const ready = warmSrc.get(t.id);
  if (ready) return startAudio(i, ready, opts);
  const token = playToken;
  const src = await offlineSrcIfNeeded(t, streamUrl(t));
  if (token !== playToken) return;            // a newer play superseded this one
  startAudio(i, src, opts);
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

/* The lock screen can only run what is already in memory.
 *
 * nextTrack() and prevTrack() await a Cache Storage read for a saved track, and iOS
 * suspends that read while the screen is off: pressing skip then did nothing at all.
 * The remote handlers below are synchronous. They hand the element a source that was
 * warmed while the last track was playing, or the stream path, and start it in the same
 * task the system gave us. The queue's own buttons keep the async path, where there is
 * time to read the device.
 */
function sourceNow(t) {
  if (!t || !t.id) return '';
  return prefetchBlobs.get(t.id) || warmSrc.get(t.id) || streamUrl(t);
}

function remotePlay() {
  state._userPaused = false;
  state._wantPlaying = true;
  const t = state.current;
  logPlay('remote-play', { hidden: document.hidden, paused: audio.paused, src: !!audio.getAttribute('src') });
  if (!t) return;
  if (!audio.getAttribute('src')) return startAudio(state.qi, sourceNow(t));
  const p = audio.play();
  if (p && p.catch) p.catch((e) => {
    // a source that died during a long lock is rebuilt from the queue, not ignored, and
    // it resumes where the listener was instead of starting the track again
    logPlay('remote-play-blocked', { why: (e && e.name) || 'error' });
    state._resumeAt = audio.currentTime || 0;
    startAudio(state.qi, sourceNow(t), { resume: true });
  });
}

function remotePause() {
  state._userPaused = true;
  logPlay('remote-pause', { hidden: document.hidden });
  audio.pause();
}

function remoteNext() {
  logPlay('remote-next', { from: state.current && state.current.id, qi: state.qi });
  if (!state.queue.length) return;
  if (state.repeat && state.qi >= state.queue.length - 1) {
    const first = state.queue[0];
    if (first) startAudio(0, sourceNow(first));
    return;
  }
  const next = state.qi + 1;
  if (next < state.queue.length) {
    startAudio(next, sourceNow(state.queue[next]));
    return;
  }
  // end of the queue: this is the one case that needs the radio endpoint. It is only
  // reached when the queue was not extended ahead, which the engine does while playing.
  nextTrack();
}

function remotePrev() {
  logPlay('remote-prev', { at: Math.round(audio.currentTime || 0), qi: state.qi });
  if (audio.currentTime > 3) { try { audio.currentTime = 0; } catch {} return; }
  const prev = Math.max(0, state.qi - 1);
  const t = state.queue[prev];
  if (t) startAudio(prev, sourceNow(t));
  else { try { audio.currentTime = 0; } catch {} }
}

function remoteStop() {
  state._userPaused = true;
  logPlay('remote-stop', {});
  audio.pause();
  try { audio.currentTime = 0; } catch {}
}

const mediaActions = {
  play: remotePlay, pause: remotePause, stop: remoteStop,
  previoustrack: remotePrev, nexttrack: remoteNext,
};

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
  const clear = (action) => { try { navigator.mediaSession.setActionHandler(action, null); } catch {} };
  // every seek affordance is cleared first, otherwise iOS keeps drawing rewind / forward
  ['seekbackward', 'seekforward', 'seekto', 'skipad', 'nextslide', 'previousslide', 'seekto'].forEach(clear);
  for (const [action, fn] of Object.entries(mediaActions)) set(action, fn);
}
bindMediaSession();
// a popover that only closes when its own button is pressed again is a trap on a phone
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.chip-tools[open]').forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});
window.MF_MEDIA = mediaActions;   // a phone has no console: the lock-screen handlers can be exercised
window.addEventListener('pageshow', (e) => { if (e.persisted) bindMediaSession(); });
document.addEventListener('visibilitychange', () => {
  logPlay(document.hidden ? 'lock' : 'unlock', {
    id: state.current && state.current.id, paused: audio.paused, at: Math.round(audio.currentTime || 0),
  });
  if (document.hidden) return;
  bindMediaSession();
  // the lock screen can leave the element paused with a queue waiting: pick it up again
  if (state._wantPlaying && !state._userPaused && audio.paused && state.current) {
    const ready = warmSrc.get(state.current.id);
    if (ready) startAudio(state.qi, ready, { resume: true });
    else audio.play().catch(() => {});
  }
});
audio.addEventListener('play', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
audio.addEventListener('pause', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('timeupdate', () => {
  // A stream can stop a fraction before its declared end and never emit 'ended'. This
  // guard advances first, so it must use the warmed source: it used to call the async
  // nextTrack(), which is exactly the await that does not finish on a locked phone.
  if (audio.duration && audio.duration > 1 && !state._advancing && audio.currentTime > audio.duration - 0.4) {
    state._advancing = true;
    setStatus('Next track');
    logPlay('end-guard', { id: state.current && state.current.id });
    setTimeout(() => { state._advancing = false; }, 2500);
    advanceAtEnd();
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
  const bar = $('playerbar');
  if (bar) bar.hidden = false;
  try { bindMediaSession(); paintMediaSession(t); } catch {}
  const rung = (t.rung || 'local').toUpperCase(), q = t.quality || '';
  $('pb-title').textContent = t.title || '';
  $('pb-artist').textContent = t.artist || '';
  setArt('pb-art', artUrl(t, 128), t.title);
  // one painter for the bar, the mini player and the full-screen cover: the mini heart
  // used to keep the previous track's state, or stay an outline on a liked track
  paintLike(t);
  $('pb-badge').hidden = false;
  $('pb-badge').className = `pb-badge rung-${shortRung(t.rung).cls}`;
  $('pb-badge').textContent = `${shortRung(t.rung).label} ${q}`;
  $('mini').hidden = false;
  $('mini-title').textContent = t.title || '';
  $('mini-artist').textContent = t.artist || '';
  setArt('mini-art', artUrl(t, 96), t.title);
  $('np-title').textContent = t.title || '';
  $('np-artist').textContent = t.artist || '';
  $('np-album').textContent = t.album || '';
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

// a restored queue has a current track but no audio loaded yet: pressing play used to
// do nothing until you skipped and came back
const togglePlay = () => {
  if (!state.current) return null;
  if (!audio.getAttribute('src')) return playAt(state.qi);
  if (audio.paused) { state._userPaused = false; pausePreviews(); return audio.play().catch(() => {}); }
  state._userPaused = true;
  return audio.pause();
};
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
/* Called from 'ended', which on a locked iPhone is the only task we are guaranteed.
   If the next source was warmed, this hands it to the element without awaiting anything.
   If it was not, the async path is still tried rather than giving up. */
function advanceAtEnd() {
  // 'ended' and 'error' can both arrive for the same track: advance once
  const from = state.current && state.current.id;
  if (state._endedFor === from && Date.now() - (state._endedAt || 0) < 5000) return;
  state._endedFor = from; state._endedAt = Date.now();
  if (state.repeat && state.qi >= state.queue.length - 1) { playAt(0); return; }
  const i = state.qi + 1;
  const t = state.queue[i];
  if (t) {
    // the prefetched blob wins: it needs no connection at the moment the screen is off
    const ready = prefetchBlobs.get(t.id) || warmSrc.get(t.id);
    if (ready) {
      logPlay('advance', { to: t.id, src: String(ready).startsWith('blob:') ? 'blob' : 'stream' });
      startAudio(i, ready);
      return;
    }
  }
  logPlay('advance-cold', { next: t ? t.id : null });
  nextTrack();
}

/* the queue must already have a next track when the last one ends. Asking the radio
   endpoint at that moment needs the network, and a locked phone does not get to make
   that request. */
let extending = false;
async function maybeExtendQueue() {
  if (extending || !state.queue.length) return;
  if (state.qi < state.queue.length - 2) return;
  const last = state.queue[state.queue.length - 1];
  if (!last) return;
  extending = true;
  try {
    const list = await api(`/api/radio/${last.id}`, { nocache: true });
    const have = new Set(state.queue.map((t) => t.id));
    const add = (list || []).filter((t) => t && !have.has(t.id)).slice(0, 15);
    if (add.length) { state.queue.push(...add); warmUpcoming(); }
  } catch {}
  extending = false;
}

function prevTrack(force = false) {
  if (!force && audio.currentTime > 3) { audio.currentTime = 0; return; }
  playAt(Math.max(0, state.qi - 1));
}

/* a dropped stream must resume where the listener was, not at the start of the track:
   that is what a tunnel hiccup or a locked phone used to cost */
function resumeStream(t) {
  if (!t || !t.id) return;
  state._resumeAt = audio.currentTime || 0;
  try { audio.src = streamUrl(t, true); audio.load(); } catch {}
  audio.play().catch(() => {});
}
/* if a stream sits with nothing to play for long enough, reload it once */
let stallTimer = null;
function armStallRecovery() {
  if (stallTimer) return;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (!state.current || audio.paused || audio.readyState >= 3) return;
    resumeStream(state.current);
  }, 12000);
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
      const r = await fetch(streamUrl(t), { method: 'HEAD' });
      if (r.status === 302 || r.status === 200) {
        resumeStream(t);
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

audio.addEventListener('play', () => {
  state._wantPlaying = true; setPlayIcons(true); paintRows();
  if (window.musicfyDesktop) window.musicfyDesktop.setPlaying(true);
  if (state._failed) state._failed.clear();
  logPlay('play', { id: state.current && state.current.id, hidden: document.hidden });
});
audio.addEventListener('pause', () => {
  // A pause the system makes while the screen is off is not the listener's wish. Clearing
  // the intent there is what made a locked phone stay silent until it was unlocked.
  if (!audio.ended && (!document.hidden || state._userPaused)) state._wantPlaying = false;
  if (window.musicfyDesktop) window.musicfyDesktop.setPlaying(false);
  logPlay('pause', {
    id: state.current && state.current.id, hidden: document.hidden, user: !!state._userPaused,
    ended: audio.ended, at: Math.round(audio.currentTime || 0),
  });
  setPlayIcons(false); paintRows();
});
// the events that precede a silent stop: keep them, with how much runway was left
['waiting', 'stalled', 'suspend'].forEach((ev) => audio.addEventListener(ev, () => {
  let ahead = 0;
  try { const b = audio.buffered; if (b && b.length) ahead = Math.max(0, b.end(b.length - 1) - audio.currentTime); } catch {}
  logPlay(ev, { id: state.current && state.current.id, hidden: document.hidden, ready: audio.readyState, ahead: Math.round(ahead) });
}));
audio.addEventListener('loadedmetadata', () => {
  $('t-dur').textContent = fmt(audio.duration); $('np-dur').textContent = fmt(audio.duration);
  const at = Number(state._resumeAt || 0);
  if (at > 0.5 && Number.isFinite(audio.duration) && at < audio.duration - 1) {
    try { audio.currentTime = at; } catch {}
  }
  state._resumeAt = 0;
});
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = `${(audio.currentTime / audio.duration) * 100}%`;
  $('bar-fill').style.width = pct; $('np-bar-fill').style.width = pct;
  $('t-cur').textContent = fmt(audio.currentTime); $('np-cur').textContent = fmt(audio.currentTime);
  paintSeekAria();
  // keep two tracks of runway on the queue, while there is still audio playing to hide
  // the request behind
  if (state.qi >= state.queue.length - 2 && audio.duration - audio.currentTime > 20) maybeExtendQueue();
});
audio.addEventListener('ended', () => {
  logPlay('ended', { id: state.current && state.current.id });
  setStatus('Next track');
  advanceAtEnd();
});
audio.addEventListener('waiting', () => { setStatus('Buffering'); armStallRecovery(); });
audio.addEventListener('playing', () => { setStatus(null); if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } });
audio.addEventListener('stalled', () => { setStatus('Reconnecting'); armStallRecovery(); });
audio.addEventListener('pause', () => { if (!audio.ended) setStatus(null); });
audio.addEventListener('error', () => {
  logPlay('error', { id: state.current && state.current.id, code: audio.error && audio.error.code });
  if (state.current) $('pb-title').textContent = `error: ${state.current.title}`;
  // a server that closes the socket at the end of a track surfaces as a media error.
  // Treat it as the end rather than stranding the queue on that track.
  const nearEnd = audio.duration && Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 1;
  if (nearEnd) advanceAtEnd();
});

function setPlayIcons(playing) {
  $('toggle').innerHTML = playing ? IC.pause : IC.play;
  $('np-toggle').innerHTML = playing ? IC.pause : IC.play;
  $('mini-toggle').innerHTML = playing ? IC.pause : IC.play;
}

/* Covers that 404 fall back to a generated tile. This used to be inline onerror=,
   which the CSP correctly refuses to run. */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  if (img.dataset.coverHide !== undefined) { img.style.visibility = 'hidden'; return; }
  if (img.dataset.coverInitial !== undefined) {
    const tile = document.createElement('div');
    tile.className = 'plhead-art ph';
    tile.textContent = img.dataset.coverInitial;
    img.replaceWith(tile);
  }
}, true);

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
const bindSeekSlider = (barEl) => {
  if (!barEl) return;
  barEl.onclick = seek(barEl);
  barEl.onkeydown = (e) => {
    if (!audio.duration) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
    else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - step);
    else if (e.key === 'Home') audio.currentTime = 0;
    else if (e.key === 'End') audio.currentTime = Math.max(0, audio.duration - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
};
bindSeekSlider($('bar'));
bindSeekSlider($('np-bar'));
function paintSeekAria() {
  const dur = Number(audio.duration) || 0;
  const now = Math.min(Number(audio.currentTime) || 0, dur || Infinity);
  for (const id of ['bar', 'np-bar']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute('aria-valuemax', String(Math.round(dur)));
    el.setAttribute('aria-valuenow', String(Math.round(now)));
    el.setAttribute('aria-valuetext', `${fmt(now)} / ${fmt(dur)}`);
  }
}
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
document.querySelectorAll('#vol, #np-vol').forEach((el) => { el.disabled = false; el.title = 'Volume'; });
if (IOS_VOLUME_LOCKED) {
  // iOS ignores audio.volume entirely. A slider that moves and changes nothing is worse
  // than no slider: keep the one control that does work, mute.
  document.querySelectorAll('#vol, #np-vol').forEach((el) => {
    el.hidden = true;
    const row = el.closest('.np-volume, .pb-right, .pb-progress');
    if (row) row.classList.add('volume-locked');
  });
  const npRow = document.querySelector('.np-volume');
  if (npRow) npRow.title = 'This device sets volume with its own buttons; tap the speaker to mute';
}
/* no inline instructions: the slider mutes at zero, the buttons stay where they are */

$('toggle').onclick = togglePlay;
$('mini-toggle').onclick = togglePlay;
$('np-toggle').onclick = togglePlay;
$('next').onclick = nextTrack; $('np-next').onclick = nextTrack;
// handlers receive the event as an argument: passing prevTrack directly made that
// event count as "force", so back skipped the track instead of restarting it
$('prev').onclick = () => prevTrack(); $('np-prev').onclick = () => prevTrack();
$('shuffle').onclick = (e) => { state.shuffle = !state.shuffle; e.currentTarget.setAttribute('aria-pressed', state.shuffle); };
$('repeat').onclick = (e) => { state.repeat = !state.repeat; e.currentTarget.setAttribute('aria-pressed', state.repeat); };
$('np-shuffle').onclick = () => $('shuffle').click();
$('np-repeat').onclick = () => $('repeat').click();
$('pb-like').onclick = (e) => { e.stopPropagation(); state.current && toggleLike(state.current); };
$('np-like').onclick = (e) => { e.stopPropagation(); state.current && toggleLike(state.current); };
$('mini-like') && ($('mini-like').onclick = (e) => { e.stopPropagation(); state.current && toggleLike(state.current); });

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
  // the heart repaints its icon during the click, which detaches the target; the path
  // captured at dispatch still contains the button, so use that instead of closest()
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const hitControl = path.some((x) => x && (x.tagName === 'BUTTON' || x.id === 'pb-art' || x.id === 'pb-artist'));
  if (hitControl || e.target.closest('button') || e.target.closest('#pb-art') || e.target.closest('#pb-artist')) return;
  openNowPlaying();
};
longPress(document.querySelector('.pb-left'), () => {
  const r = document.querySelector('.pb-left').getBoundingClientRect();
  currentCtx(r.left + 20, Math.max(80, r.top - 260));
});
/* every link inside the sheet closes it. Navigating underneath a full-screen cover is
   the same as doing nothing: you tap the artist and the artist page opens out of sight. */
const npArtist = () => { const c = state.current; if (c && c.artist) { $('np').hidden = true; renderArtist(c.artist); } };
const npAlbum = () => { const c = state.current; if (c && c.album) { $('np').hidden = true; renderAlbum(c.album); } };
$('np-artist').onclick = npArtist;
$('np-album').onclick = npAlbum;
$('np-add').onclick = () => { if (state.current && state.current.id) openAddPlIds([state.current.id]); };
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
;
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

/* put a track's artwork on a playlist, chosen from the playlists themselves */
function openCoverToPlaylist(t) {
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Cover of “${esc(String(t.title || '').slice(0, 34))}” goes to</div>` +
    state.playlists.map((p) => `<button data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeCtx(true); m.style.transform = ''; m.onclick = null;
    try {
      await api(`/api/playlists/${encodeURIComponent(b.dataset.pl)}/cover-from-track`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trackId: t.id }),
      });
      state.artV = Date.now();
      await loadPlaylists();
      refreshView();
      toast(`Cover set from “${t.title}”`, 4000);
    } catch (err) { toast('Could not use that cover', 4000); }
  };
}

/* or from the playlist side: pick one of its tracks */
async function openCoverPicker(pid) {
  let list = [];
  try { list = await api(`/api/playlists/${encodeURIComponent(pid)}`); } catch {}
  const withArt = (list || []).filter((x) => x.has_art).slice(0, 60);
  if (!withArt.length) { toast('No track in this crate has artwork yet', 5000); return; }
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">Use a track's cover</div>` +
    withArt.map((x) => `<button data-tid="${x.id}" class="ctx-cover"><span class="ctx-cover-art" style="background-image:url('/api/cover/${x.id}?s=80&v=${state.artV || 0}')"></span><span class="ctx-cover-name">${esc(String(x.title || '').slice(0, 30))}</span></button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeCtx(true); m.style.transform = ''; m.onclick = null;
    try {
      await api(`/api/playlists/${encodeURIComponent(pid)}/cover-from-track`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trackId: Number(b.dataset.tid) }),
      });
      state.artV = Date.now();
      await loadPlaylists();
      refreshView();
      toast('Playlist cover updated', 4000);
    } catch { toast('Could not use that cover', 4000); }
  };
}

/* album covers: a one-word album needs the artist in the query, and more than one scan
   can exist. Show the candidates; the person picks. */
async function openAlbumCoverPicker(album, artist) {
  let d = null;
  try {
    d = await api(`/api/albums/${encodeURIComponent(album)}/cover-options?artist=${encodeURIComponent(artist || '')}`, { nocache: true });
  } catch {}
  const options = (d && d.options) || [];
  if (!options.length) {
    toast(`No cover candidates for ${artist ? `${artist} - ` : ''}${album}`, 6000);
    return;
  }
  markCtxOpen();
  const m = $('ctx');
  m.innerHTML = `<div class="ctx-title">${esc(album)} - choose a cover</div>` +
    options.map((o) => `<button class="ctx-cover" data-cover="${esc(o.cover)}">
      <span class="ctx-cover-art" style="background-image:url('${esc(o.cover)}')"></span>
      <span class="ctx-cover-name">${esc(o.artist || '')} · ${esc(o.name || '')}${o.tracks ? ` · ${o.tracks} tracks` : ''}</span>
    </button>`).join('');
  m.classList.add('open');
  m.style.left = '50%'; m.style.top = '45%'; m.style.transform = 'translate(-50%,-50%)';
  m.onclick = async (e) => {
    const b = e.target.closest('button[data-cover]'); if (!b) return;
    closeCtx(true); m.style.transform = ''; m.onclick = null;
    const pill = progressPill('Setting the cover…');
    try {
      const r = await api(`/api/albums/${encodeURIComponent(album)}/cover`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: b.dataset.cover }),
      });
      pill.done();
      state.artV = Date.now();
      toast(`Cover set on ${r.count} track${r.count === 1 ? '' : 's'}`, 4000);
      refreshView();
    } catch { pill.done(); toast('Could not set that cover', 4000); }
  };
}

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
  if (!r.ok || !d.track) {
    const e = new Error(d.error || 'upload failed');
    // a duplicate is a result, not a failure: keep the fields the summary needs
    e.duplicate = !!d.duplicate;
    e.title = d.title || '';
    e.artist = d.artist || '';
    throw e;
  }
  return d;
}

async function uploadFiles(files) {
  const total = files.length;
  let ok = 0;
  let failed = 0;
  let duplicates = 0;
  let replaced = 0;
  let why = '';
  const dups = [];
  const t = toastPersistent(`Uploading ${total} file${total > 1 ? 's' : ''} - duplicates are skipped…`);
  for (let i = 0; i < total; i += 1) {
    const f = files[i];
    t.update(`Uploading ${i + 1} of ${total}: ${f.name.slice(0, 34)}`);
    try {
      const d = await uploadTrack(f);
      ok += 1;
      if (d.replaced) replaced += 1;
    } catch (e) {
      if (e.duplicate) { duplicates += 1; dups.push(e.artist ? `${e.artist} - ${e.title}` : (e.title || f.name)); }
      else { failed += 1; why = e.message || 'upload failed'; }
    }
  }
  state.allTracks = null;
  bustCache();
  // duplicates are skipped, not silently added: say how many and which ones
  const bits = [];
  if (ok) bits.push(`Added ${ok} track${ok === 1 ? '' : 's'}${replaced ? ` (${replaced} replaced a lower-quality copy)` : ''}`);
  if (duplicates) bits.push(`${duplicates} already in your library${dups.length ? ` (${dups.slice(0, 2).join('; ')}${dups.length > 2 ? '…' : ''})` : ''}`);
  if (failed) bits.push(`${failed} failed - ${why}`);
  t.done(bits.join(' · ') || 'Nothing to upload', duplicates || failed ? 10000 : 8000);
  if (duplicates && !ok) toast('Those tracks were not uploaded again. Use "Find higher quality" to replace a copy.', 9000);
  await loadPlaylists().catch(() => {});
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

/* ============ command palette ============ */
let paletteItems = [];
let paletteIndex = 0;

function paletteActions() {
  const acts = [
    { label: 'Home', hint: 'Go', run: () => nav('home') },
    { label: 'Search', hint: 'Go', run: () => nav('search') },
    { label: 'Library', hint: 'Go', run: () => nav('songs') },
    { label: 'Playlists', hint: 'Go', run: () => nav('library') },
  ];
  if (state.tier === 'dj') acts.push({ label: 'Prep', hint: 'Go', run: () => nav('djexport') });
  acts.push({ label: 'A&R', hint: 'Go', run: () => nav('askai') });
  acts.push({ label: 'Settings', hint: 'Go', run: () => nav('settings') });
  if (state.view === 'playlist' && state.playlistId) {
    const pid = state.playlistId;
    const name = (state.playlists.find((p) => p.id === pid) || {}).name || '';
    acts.unshift({ label: `Play “${name}”`, hint: 'Playlist', run: () => playPlaylist(pid) });
    acts.unshift({ label: `Shuffle “${name}”`, hint: 'Playlist', run: () => playPlaylist(pid, true) });
    acts.push({ label: 'Export this playlist for Rekordbox', hint: 'Download', run: () => { window.location.href = `/api/playlists/${encodeURIComponent(pid)}/export/rekordbox.xml`; } });
    acts.push({ label: 'Export this playlist for Traktor', hint: 'Download', run: () => { window.location.href = `/api/playlists/${encodeURIComponent(pid)}/export/traktor.nml`; } });
  }
  acts.push({
    label: state.tier === 'dj' ? 'Switch to Listener mode' : 'Switch to DJ mode',
    hint: 'Mode',
    run: async () => {
      await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ui_tier: state.tier === 'dj' ? 'listener' : 'dj' }) });
      location.reload();
    },
  });
  acts.push({
    label: 'Play library shuffled', hint: 'Play',
    run: async () => { const all = state.allTracks || await api('/api/tracks'); playList(all || [], 0, true, 'Library'); },
  });
  acts.push({
    label: 'Scan a folder', hint: 'Settings',
    run: () => { nav('settings'); setTimeout(() => { const f = $('set-folder'); if (f) f.focus(); }, 350); },
  });
  return acts;
}

function paintPalette() {
  const list = $('palette-list');
  const q = $('palette-q');
  if (!list || !q) return;
  const needle = String(q.value || '').trim().toLowerCase();
  const acts = paletteActions().filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const playlists = needle
    ? (state.playlists || []).filter((p) => String(p.name || '').toLowerCase().includes(needle)).slice(0, 5)
      .map((p) => ({ label: p.name, hint: `${Number(p.n_tracks || 0).toLocaleString(LOC())} ${tr('tracks')}`, run: () => openPlaylist(p.id, false) }))
    : [];
  const tracks = needle && state.allTracks
    ? state.allTracks.filter((t) => `${t.title || ''} ${t.artist || ''}`.toLowerCase().includes(needle)).slice(0, 8)
      .map((t) => ({ label: t.title || '', hint: t.artist || tr('Track'), run: () => playList([t], 0, false, 'Command palette') }))
    : [];
  paletteItems = [...acts, ...playlists, ...tracks];
  paletteIndex = Math.max(0, Math.min(paletteIndex, paletteItems.length - 1));
  list.innerHTML = '';
  if (!paletteItems.length) {
    q.removeAttribute('aria-activedescendant');
    const empty = document.createElement('div');
    empty.className = 'palette-item empty';
    empty.textContent = tr('No matches');
    list.appendChild(empty);
    return;
  }
  paletteItems.forEach((a, i) => {
    const b = document.createElement('button');
    b.id = `palette-opt-${i}`;
    b.className = `palette-item${i === paletteIndex ? ' on' : ''}`;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(i === paletteIndex));
    b.innerHTML = `<b>${esc(a.label)}</b><small>${esc(a.hint || '')}</small>`;
    b.onclick = () => runPalette(i);
    list.appendChild(b);
  });
  q.setAttribute('aria-activedescendant', `palette-opt-${paletteIndex}`);
}

function runPalette(i) {
  const item = paletteItems[i];
  if (!item) return;
  closePalette();
  Promise.resolve().then(item.run).catch(() => toast('That did not work', 4000));
}

function closePalette() {
  const dlg = $('palette');
  if (dlg && dlg.open) dlg.close();
}

async function openPalette() {
  const dlg = $('palette');
  if (!dlg) return;
  if (!dlg.open) dlg.showModal();
  const q = $('palette-q');
  if (q) { q.value = ''; q.focus(); }
  paletteIndex = 0;
  const key = document.getElementById('palette-key');
  if (key) key.textContent = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K';
  if (!state.allTracks) {
    try { state.allTracks = await api('/api/tracks'); } catch {}
  }
  paintPalette();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'k') {
    e.preventDefault();
    const dlg = $('palette');
    if (dlg && dlg.open) closePalette(); else openPalette();
    return;
  }
  if ($('palette') && $('palette').open) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, Math.max(0, paletteItems.length - 1)); paintPalette(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); paintPalette(); return; }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); return; }
  }
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (typing) { if (e.key === 'Escape' && tag === 'INPUT') e.target.blur(); return; }
  // space belongs to the focused control, not to the player, when a control has focus
  const onControl = e.target.closest && e.target.closest('button, a, [role="button"], [role="slider"]');
  if (e.key === ' ' && !onControl) { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight' && !onControl) nextTrack();
  if (e.key === 'ArrowLeft' && !onControl) prevTrack();
  if (e.key === 'Escape') { closeCtx(); $('queue-drawer').hidden = true; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size) {
    e.preventDefault();
    deleteTracks([...state.selectedIds]);
  }
});

const paletteInput = $('palette-q');
if (paletteInput) paletteInput.addEventListener('input', () => { paletteIndex = 0; paintPalette(); });
const paletteBtn = $('palette-btn');
if (paletteBtn) paletteBtn.onclick = () => openPalette();
const paletteDlg = $('palette');
if (paletteDlg) {
  paletteDlg.addEventListener('click', (e) => { if (e.target === paletteDlg) closePalette(); });
  paletteDlg.addEventListener('close', () => { paletteItems = []; paletteIndex = 0; });
}

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

/* ============ first run ============ */
/* Five questions, one per screen, every one skippable, and the promise first: the library,
 * the settings and the listening history stay on this computer. The fields are the ones the
 * app actually uses (greeting, local hour, mode, folder), so nothing here is a survey. */
const ONB_LAST = 4;             // steps 0..4, then the done screen
let onb = null;

const onbPhrase = () => {
  const part = greetPart();
  return part === 'night' ? 'Late one' : part === 'morning' ? 'Morning' : part === 'afternoon' ? 'Afternoon' : 'Evening';
};

function onbPost(patch) {
  return api('/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  }).catch(() => null);
}

function closeOnboarding() {
  const el = document.getElementById('onb');
  if (el) el.remove();
  onb = null;
}

function openOnboarding(start = 0) {
  if (document.getElementById('onb')) return;
  const el = document.createElement('div');
  el.className = 'onb';
  el.id = 'onb';
  el.innerHTML = `
    <div class="onb-card" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div class="onb-top">
        <span class="onb-count" id="onb-count"></span>
        <div class="onb-top-right">
          <div class="onb-lang" role="group" aria-label="${tr('Language')}">
            <button type="button" data-lang="en" aria-pressed="${(window.I18N ? window.I18N.lang : 'en') === 'en'}">EN</button>
            <button type="button" data-lang="pt-BR" aria-pressed="${(window.I18N ? window.I18N.lang : 'en') === 'pt-BR'}">PT</button>
          </div>
          <button class="onb-skip" id="onb-skip" type="button">${tr('Skip setup')}</button>
        </div>
      </div>
      <div class="onb-track" aria-hidden="true"><i id="onb-fill"></i></div>
      <div class="onb-body" id="onb-body"></div>
      <div class="onb-foot">
        <p class="onb-privacy">${tr('Stays on this computer. No account, no upload.')}</p>
        <div class="onb-nav">
          <button class="onb-back" id="onb-back" type="button">${tr('Back')}</button>
          <button class="btn btn-primary" id="onb-next" type="button">${tr('Continue')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const s = state.settings || {};
  onb = {
    el,
    step: Math.min(ONB_LAST + 1, Math.max(0, Number(start) || 0)),
    name: s.display_name || '',
    city: s.city || '',
    citySaved: s.city || '',
    mode: s.ui_tier === 'listener' ? 'listener' : 'dj',
    folder: '',
    busy: false,
  };
  el.querySelector('#onb-skip').onclick = () => onbSkip();
  el.querySelectorAll('.onb-lang button').forEach((b) => { b.onclick = () => onbSwitchLang(b.dataset.lang); });
  el.querySelector('#onb-back').onclick = () => onbGo(onb.step - 1);
  el.querySelector('#onb-next').onclick = () => onbNext();
  el.addEventListener('keydown', onbKeys);
  onbRender();
}

function onbRender() {
  const body = document.getElementById('onb-body');
  if (!body || !onb) return;
  const step = onb.step;
  const done = step > ONB_LAST;
  document.getElementById('onb-count').textContent = done
    ? tr('Done')
    : `${String(step + 1).padStart(2, '0')} / ${String(ONB_LAST + 1).padStart(2, '0')}`;
  document.getElementById('onb-fill').style.width = `${Math.round((Math.min(step + 1, ONB_LAST + 1) / (ONB_LAST + 1)) * 100)}%`;
  document.getElementById('onb-skip').hidden = done;
  document.getElementById('onb-back').hidden = step === 0 || done;
  const next = document.getElementById('onb-next');
  next.textContent = done ? tr('Open my library') : step === 0 ? tr('Come in') : tr('Continue');

  if (done) {
    const bits = [onb.mode === 'listener' ? tr('Listener') : tr('DJ')];
    if (onb.city) bits.push(onb.city);
    const ready = onb.name ? `${tr('Ready')}, ${onb.name}.` : `${tr('Ready')}.`;
    body.innerHTML = `
      <p class="onb-kicker">${tr('READY')}</p>
      <h2 class="onb-title" id="onb-title">${esc(ready)}</h2>
      <p class="onb-copy">${tr('Everything you just told it lives on this computer, in a folder you could delete if you changed your mind. There is no account to cancel.')}</p>
      <ul class="onb-facts">${bits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      <p class="onb-note">${tr('Repeatable: Settings → You → Run setup again.')}</p>`;
    onbFocus();
    return;
  }

  if (step === 0) {
    body.innerHTML = `
      <p class="onb-kicker">MUSICFY</p>
      <h2 class="onb-title" id="onb-title">${tr('Your music. Not a rental.')}</h2>
      <p class="onb-copy">${tr('No account, no cloud, no “Sign in with Google”. It runs on this computer, from files that are already on it. Skip whatever you like: none of this is a contract.')}</p>
      <ul class="onb-facts">
        <li>${tr('Reads the folders you already have. It does not reorganise them.')}</li>
        <li>${tr('Settings, plays and history stay on this computer.')}</li>
        <li>${tr('Nothing is uploaded. A download happens when you ask for one, which is the whole idea.')}</li>
      </ul>
      <p class="onb-note" id="onb-path"></p>`;
    if (window.musicfyDesktop && window.musicfyDesktop.info) {
      window.musicfyDesktop.info().then((i) => {
        const p = document.getElementById('onb-path');
        if (p && i && i.home) p.textContent = `${tr('Your data lives in')} ${i.home}`;
      }).catch(() => {});
    }
    onbFocus();
    return;
  }

  if (step === 1) {
    body.innerHTML = `
      <p class="onb-kicker">${tr('YOU')}</p>
      <h2 class="onb-title" id="onb-title">${tr('What should I call you?')}</h2>
      <p class="onb-copy">${tr('The greeting uses it, and nothing else does. Leave it empty and it will address you like a bank statement.')}</p>
      <label class="onb-field">${tr('Your name')}<input id="onb-name" type="text" maxlength="40" autocomplete="given-name" value="${esc(onb.name)}" placeholder="${tr('A name, or nothing')}"></label>
      <p class="onb-preview" id="onb-preview"></p>`;
    const input = document.getElementById('onb-name');
    input.addEventListener('input', () => { onb.name = input.value; onbPaintPreview(); });
    onbPaintPreview();
    onbFocus();
    return;
  }

  if (step === 2) {
    body.innerHTML = `
      <p class="onb-kicker">${tr('PLACE')}</p>
      <h2 class="onb-title" id="onb-title">${tr('Where are you, roughly?')}</h2>
      <p class="onb-copy">${tr('So it says good evening at the right hour. The city is looked up once, right now, for coordinates and time zone, and then it stays here. Leave it blank and live in UTC like a server.')}</p>
      <label class="onb-field">${tr('City')}<input id="onb-city" type="text" maxlength="60" autocomplete="address-level2" value="${esc(onb.city)}" placeholder="Brasília"></label>
      <p class="onb-note" id="onb-resolved">${onb.city ? esc(onb.city) : ''}</p>`;
    const input = document.getElementById('onb-city');
    // the lookup happens when the field is left, not on every keystroke, and not as a
    // surprise after Continue: the person sees the place it resolved to before moving on
    input.addEventListener('input', () => { onb.city = input.value; });
    input.addEventListener('blur', () => { onbResolveCity(); });
    onbFocus();
    return;
  }

  if (step === 3) {
    body.innerHTML = `
      <p class="onb-kicker">${tr('MODE')}</p>
      <h2 class="onb-title" id="onb-title">${tr('How do you listen?')}</h2>
      <p class="onb-copy">${tr('This changes the whole app, not a theme. Switch it later if you change your mind.')}</p>
      <div class="onb-modes" role="group" aria-label="${tr('Mode')}">
        <button class="onb-mode" data-mode="dj" type="button" aria-pressed="${onb.mode === 'dj'}">
          <b>${tr('DJ')}</b><span>${tr('Prep, BPM and key, harmonic mixing, CDJ exports. For sets that have to hold together.')}</span>
        </button>
        <button class="onb-mode" data-mode="listener" type="button" aria-pressed="${onb.mode === 'listener'}">
          <b>${tr('Listener')}</b><span>${tr('Library, playlists, playback. Prep and analysis stay out of sight, along with the homework.')}</span>
        </button>
      </div>`;
    body.querySelectorAll('.onb-mode').forEach((b) => {
      b.onclick = () => {
        onb.mode = b.dataset.mode;
        body.querySelectorAll('.onb-mode').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === onb.mode)));
      };
    });
    onbFocus();
    return;
  }

  body.innerHTML = `
    <p class="onb-kicker">${tr('MUSIC')}</p>
    <h2 class="onb-title" id="onb-title">${tr('Where does the music live?')}</h2>
    <p class="onb-copy">${tr('Point at a folder. The files stay where they are; this reads them in place. Nothing is copied, and nothing is uploaded to a service that will lose interest in two years.')}</p>
    <div id="onb-folder"></div>
    <p class="onb-scan" id="onb-scan"></p>`;
  onbFolders();
  onbFocus();
}

function onbFocus() {
  if (!onb) return;
  const input = document.querySelector('#onb-body input');
  if (input) { input.focus(); input.select(); return; }
  const chosen = document.querySelector('#onb-body .onb-mode[aria-pressed="true"]');
  if (chosen) { chosen.focus(); return; }
  const next = document.getElementById('onb-next');
  if (next && !next.disabled) next.focus();
}

function onbPaintPreview() {
  const el = document.getElementById('onb-preview');
  if (!el) return;
  const name = (document.getElementById('onb-name')?.value || '').trim();
  el.innerHTML = name
    ? `${esc(tr(onbPhrase()))}, <b>${esc(name)}</b>.`
    : esc(`${tr(onbPhrase())}.`);
}

async function onbFolders() {
  const host = document.getElementById('onb-folder');
  if (!host) return;
  if (window.musicfyDesktop) {
    host.innerHTML = `<button class="btn btn-ghost" id="onb-pick" type="button">${tr('Choose folder')}</button>
      <p class="onb-note">${tr('A folder inside Music works best. Nothing is moved.')}</p>`;
    document.getElementById('onb-pick').onclick = async () => {
      const picked = await window.musicfyDesktop.pickFolder();
      if (picked) onbScan(picked);
    };
    return;
  }
  let folders = [];
  try { folders = (await api('/api/library/folders', { nocache: true })).folders || []; } catch {}
  if (!folders.length) {
    host.innerHTML = `<p class="onb-note">${tr('This server has no folder to offer. Add one later in Settings.')}</p>`;
    return;
  }
  host.innerHTML = `<label class="onb-field">${tr('Music folder')}<select id="onb-folder-select"><option value="">${tr('Choose a folder…')}</option>${folders
    .map((f) => `<option value="${esc(f.path)}">${esc(f.label)}</option>`).join('')}</select></label>`;
  document.getElementById('onb-folder-select').onchange = (e) => { if (e.target.value) onbScan(e.target.value); };
}

async function onbScan(folder) {
  const out = document.getElementById('onb-scan');
  onb.folder = folder;
  if (out) out.textContent = tr('Reading the folder…');
  try {
    await api('/api/library/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: folder }) });
  } catch (e) {
    if (out) out.textContent = `${tr('Could not read that folder:')} ${e.message || ''}`;
    return;
  }
  for (let i = 0; i < 3000; i += 1) {
    await new Promise((r) => setTimeout(r, 1200));
    const el = document.getElementById('onb-scan');
    if (!el || !onb) return;
    let st = null;
    try { st = await api('/api/library/scan', { nocache: true }); } catch { continue; }
    if (st.running) {
      el.dataset.tone = '';
      el.textContent = st.total
        ? `${Number(st.done).toLocaleString(LOC())} / ${Number(st.total).toLocaleString(LOC())}`
        : tr('Reading the folder…');
      continue;
    }
    el.dataset.tone = st.error ? 'bad' : 'ok';
    el.textContent = st.error
      ? `${tr('Scan stopped:')} ${st.error}`
      : `${Number(st.total).toLocaleString(LOC())} ${tr('files read')} · ${st.added} ${tr('added')}`;
    state.allTracks = null;
    bustCache();
    return;
  }
}

function onbGo(step) {
  if (!onb) return;
  const n = Math.min(ONB_LAST + 1, Math.max(0, step));
  if (n === onb.step) return;
  onb.step = n;
  onbRender();
}

async function onbResolveCity() {
  if (!onb) return;
  const input = document.getElementById('onb-city');
  if (!input) return;
  const q = input.value.trim();
  if (q === onb.citySaved) return;
  onb.citySaved = q;
  onb.city = q;
  if (!q) {
    const empty = document.getElementById('onb-resolved');
    if (empty) empty.textContent = '';
    return;
  }
  const note = document.getElementById('onb-resolved');
  if (note) note.textContent = tr('Looking up the city…');
  const r = await onbPost({ city: q });
  const saved = (r && r.settings) || null;
  if (!onb) return;
  if (saved) {
    state.settings.city = saved.city || '';
    state.settings.timezone = saved.timezone || state.settings.timezone;
    state.settings.latitude = saved.latitude;
    state.settings.longitude = saved.longitude;
  }
  const el = document.getElementById('onb-resolved');
  if (!el) return;
  if (saved && saved.city) {
    onb.city = saved.city;
    el.dataset.tone = 'ok';
    el.textContent = [saved.city, saved.country, saved.timezone].filter(Boolean).join(' · ');
  } else {
    el.dataset.tone = 'bad';
    el.textContent = tr('Could not find that city. The hour will use this computer’s time zone.');
  }
}

async function onbSwitchLang(lang) {
  if (!onb || (window.I18N && window.I18N.lang === lang)) return;
  // switching language reloads the page so the chrome translates too; save the screen and
  // whatever is already typed, and the overlay resumes exactly where it was
  const patch = { onboarding_step: onb.step };
  const name = document.getElementById('onb-name');
  if (name) patch.display_name = name.value.trim();
  const city = document.getElementById('onb-city');
  if (city) patch.city = city.value.trim();
  await onbPost(patch);
  if (window.I18N) window.I18N.set(lang);
}

async function onbNext() {  if (!onb || onb.busy) return;
  const step = onb.step;
  if (step > ONB_LAST) { onbFinish(); return; }
  const next = document.getElementById('onb-next');
  onb.busy = true;
  if (next) next.disabled = true;
  try {
    if (step === 1) {
      onb.name = (document.getElementById('onb-name')?.value || '').trim();
      state.profileName = onb.name;
      state.settings.display_name = onb.name;
      await onbPost({ display_name: onb.name });
    }
    if (step === 2) {
      await onbResolveCity();
    }
    if (step === 3) {
      await onbPost({ ui_tier: onb.mode });
      state.settings.ui_tier = onb.mode;
      applyTier(onb.mode);
    }
    onb.step = step + 1;
    onbRender();
    await onbPost({ onboarding_step: onb.step });
  } finally {
    if (onb) {
      onb.busy = false;
      const again = document.getElementById('onb-next');
      if (again) again.disabled = false;
      onbFocus();
    }
  }
}

async function onbFinish() {
  if (!onb) return;
  await onbPost({ onboarding_done: true, onboarding_step: ONB_LAST + 1 });
  state.settings.onboarding_done = true;
  closeOnboarding();
  toast(tr('Setup done.'), 4000);
  refreshView();
}

async function onbSkip() {
  if (!onb) return;
  await onbPost({ onboarding_done: true, onboarding_step: 0 });
  state.settings.onboarding_done = true;
  closeOnboarding();
  refreshView();
}

function onbKeys(e) {
  if (!onb) return;
  if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); onbNext(); return; }
  if (e.key === 'Escape') { e.preventDefault(); if (onb.step > 0) onbGo(onb.step - 1); return; }
  if (e.key !== 'Tab') return;
  const f = [...onb.el.querySelectorAll('button, input, select')]
    .filter((x) => !x.hidden && !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
    try {
      const s = await api('/api/settings', { nocache: true });
      state.settings = s.settings || {};
      applyTier(state.settings.ui_tier || 'dj');
      // a fresh install is walked through setup once; an install that already chose a mode
      // is onboarding_done on the server, so it never sees the overlay
      state.needsOnboarding = state.settings.onboarding_done === false;
    } catch { state.settings = {}; applyTier(state.tier); }
    await loadPlaylists();
    try { await syncLikes(); } catch {}
    paintPill();
    // do not stomp a view the user opened while boot was loading playlists
    if (state.view === bootView) renderHome();
    if (state.needsOnboarding) openOnboarding(Number(state.settings.onboarding_step) || 0);
    try { watchDownloads(); } catch {}
  } catch (e) {
    $('view').innerHTML = `<div class="empty">core unreachable: ${esc(e.message)}</div>`;
  }
})();
