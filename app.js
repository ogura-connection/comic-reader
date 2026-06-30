import * as lib from './lib/library.js';
import * as backup from './lib/backup.js';
import { openComic, archiveToCbz } from './lib/archive.js';
import { makeThumb } from './lib/thumb.js';
import { createReader } from './lib/reader.js';
import { buildMetadata, seriesKey } from './lib/metadata.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
let coverUrls = [];
let reader = null;
let loadbar = null;

const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const I = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 6.4C10.4 4.9 7.4 4.2 4.4 4.7v13c3-.5 6 .2 7.6 1.8 1.6-1.6 4.6-2.3 7.6-1.8v-13C16.6 4.2 13.6 4.9 12 6.4Z"/><path d="M12 6.4v13.1"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.6C5 5.1 8 5.6 12 7.6c4-2 7-2.5 10-2v13c-3-.5-6 0-10 2-4-2-7-2.5-10-2Z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M14 6l4 4"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a6 6 0 1 1 0 12H8"/><path d="m6 5-3 3 3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.7 5.8 5.8 1.7-5.8 1.7-1.7 5.8-1.7-5.8L4.5 10l5.8-1.7Z"/><circle cx="18.5" cy="18.5" r="1.7"/><circle cx="5" cy="17" r="1.2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.9 7.9 0 0 0 0-2l1.7-1.3-1.7-3-2 .8a7.7 7.7 0 0 0-1.8-1l-.3-2.2H9.7l-.3 2.2a7.7 7.7 0 0 0-1.8 1l-2-.8-1.7 3L5.6 11a7.9 7.9 0 0 0 0 2l-1.7 1.3 1.7 3 2-.8c.5.4 1.1.8 1.8 1l.3 2.2h3.5l.3-2.2c.7-.2 1.3-.6 1.8-1l2 .8 1.7-3Z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>',
};
const numOf = c => { const n = parseFloat(c.number); return isNaN(n) ? 0 : n; };
const coverImg = cover => {
  if (!cover) return `<div class="cover-ph">${I.book}</div>`;
  const url = URL.createObjectURL(cover); coverUrls.push(url);
  return `<img src="${url}" alt="" loading="lazy">`;
};

// ---------- toast / loadbar ----------
function toast(msg, ms = 2600) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  if (ms) t._timer = setTimeout(() => t.classList.remove('show'), ms);
  return t;
}
const setLoading = on => loadbar && loadbar.classList.toggle('on', on);

// Safety net: never fail silently. Surface any uncaught error as a toast.
window.addEventListener('error', e => { if (e.message) toast(`Something broke: ${e.message}`, 5000); });
window.addEventListener('unhandledrejection', e => toast(`Something broke: ${e.reason?.message || e.reason}`, 5000));

// ---------- routing ----------
const showLibrary = () => renderLibrary();

// ---------- library keyboard navigation ----------
// Reader-first: arrows move the selection, Return opens, F2 renames, Delete
// removes, Esc backs out of a series view. Dormant on touch (no keydown).
let navTiles = [];
let navSel = -1;
let navBack = null;
function setNav(tiles, back) {
  navTiles = tiles;
  navBack = back || null;
  navSel = -1;
  tiles.forEach((t, i) => { t.tabIndex = -1; t.addEventListener('pointerdown', () => { navSel = i; }); });
}
function gridCols() {
  if (navTiles.length < 2) return 1;
  const top0 = navTiles[0].offsetTop;
  let c = 0;
  for (const t of navTiles) { if (Math.abs(t.offsetTop - top0) < 4) c++; else break; }
  return Math.max(1, c);
}
function selectNav(i) {
  i = Math.max(0, Math.min(navTiles.length - 1, i));
  navTiles.forEach(t => t.classList.remove('selected'));
  navSel = i;
  const t = navTiles[i];
  if (t) { t.classList.add('selected'); t.scrollIntoView({ block: 'nearest' }); }
}
function onLibKey(e) {
  if (reader || document.querySelector('.sheet-backdrop')) return; // reader / modal owns the keys
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key, at = navSel < 0 ? 0 : navSel, fresh = navSel < 0;
  if (!navTiles.length) { if (k === 'Escape' && navBack) { e.preventDefault(); navBack(); } return; }
  if (k === 'ArrowRight') { e.preventDefault(); selectNav(fresh ? 0 : at + 1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); selectNav(fresh ? 0 : at - 1); }
  else if (k === 'ArrowDown') { e.preventDefault(); selectNav(fresh ? 0 : at + gridCols()); }
  else if (k === 'ArrowUp') { e.preventDefault(); selectNav(fresh ? 0 : at - gridCols()); }
  else if (k === 'Home') { e.preventDefault(); selectNav(0); }
  else if (k === 'End') { e.preventDefault(); selectNav(navTiles.length - 1); }
  else if (k === 'Enter') { const n = navSel >= 0 && navTiles[navSel]._nav; if (n) { e.preventDefault(); n.open(); } }
  else if (k === 'F2') { const n = navSel >= 0 && navTiles[navSel]._nav; if (n && n.comic) { e.preventDefault(); renameComic(n.comic, n.refresh); } }
  else if (k === 'Delete' || k === 'Backspace') { const n = navSel >= 0 && navTiles[navSel]._nav; if (n && n.comic) { e.preventDefault(); deleteComic(n.comic, n.refresh); } }
  else if (k === 'Escape' && navBack) { e.preventDefault(); navBack(); }
}

// ---------- library view (grouped into series shelves + standalones) ----------
async function renderLibrary() {
  // Hold the old cover URLs until the new grid is mounted, then revoke. Revoking
  // up-front would leave the still-visible old <img>s (e.g. the library sitting
  // under the reader we just exited) pointing at dead blobs → broken-image "?".
  const stale = coverUrls;
  coverUrls = [];
  const [comics, seriesList] = await Promise.all([lib.getAllComics(), lib.getAllSeries()]);
  const seriesMap = new Map(seriesList.map(s => [s.key, s]));

  const groups = new Map();
  for (const c of comics) {
    const k = c.seriesKey || ('@' + c.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const entries = [...groups].map(([k, list]) => {
    list.sort((a, b) => numOf(a) - numOf(b));
    const sm = seriesMap.get(k);
    const lead = list[0];
    return {
      k, list, lead, sm,
      isSeries: list.length > 1,
      recent: Math.max(...list.map(c => c.updatedAt)),
      name: list.length > 1 ? (sm && sm.name || lead.seriesName || lead.title) : lead.title,
      cover: (sm && sm.cover) || lead.cover,
      accent: (sm && sm.accent) || lead.accent,
    };
  }).sort((a, b) => b.recent - a.recent);

  app.innerHTML = '';
  stale.forEach(URL.revokeObjectURL); // old <img>s now detached — safe to revoke
  app.appendChild(headerEl(comics.length));
  if (!comics.length) { app.appendChild(emptyEl()); return; }

  const grid = document.createElement('div');
  grid.className = 'grid';
  entries.forEach((e, i) => grid.appendChild(e.isSeries ? seriesTile(e, i) : comicTile(e.lead, i)));
  app.appendChild(grid);
  setNav([...grid.querySelectorAll('.tile')], null);
}

function headerEl(total) {
  const header = document.createElement('header');
  header.className = 'lib-header';
  header.innerHTML = `
    <div class="brand"><span class="kicker">Reader</span><h1>Comics<em>.</em></h1></div>
    <div class="spacer"></div>
    ${total ? `<span class="count">${total} ${total === 1 ? 'volume' : 'volumes'}</span>` : ''}
    <button class="icon-btn lib-settings" aria-label="Library settings">${I.gear}</button>
    <button class="btn accent add-btn">${I.plus} Add</button>`;
  header.querySelector('.add-btn').addEventListener('click', () => fileInput.click());
  header.querySelector('.lib-settings').addEventListener('click', libSettings);
  return header;
}

// ---------- library settings: export / import / storage ----------
function fmtBytes(n) {
  if (!n) return '0 MB';
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
function libSettings() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">Library</div>
      <div class="sheet-note storage-line">Calculating storage…</div>
      <button data-act="export-lib">${I.download} Export library (.zip)</button>
      <button data-act="export-prog">${I.upload} Export reading progress (.json)</button>
      <button data-act="import">${I.download} Import library or progress…</button>
      <button data-act="cancel" class="cancel">Cancel</button>
    </div>`;
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  lib.storageEstimate().then(est => {
    const line = sheet.querySelector('.storage-line');
    if (line) line.textContent = est ? `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)} available` : 'Stored on this device';
  });
  sheet.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'cancel') return close();
    if (act === 'import') { close(); fileInput.click(); return; }
    close();
    if (act === 'export-lib') {
      setLoading(true);
      toast('Packing library…', 0);
      try {
        const blob = await backup.exportLibrary((i, n, title) => toast(`Packing ${i} / ${n} · ${title}`, 0));
        download(blob, 'Comics-Library.zip');
        toast('Library exported. Save it to iCloud Drive / Files.', 4000);
      } catch (e) { console.error(e); toast(`Export failed: ${e.message || e}`, 5000); }
      finally { setLoading(false); }
    } else if (act === 'export-prog') {
      try { download(await backup.exportProgress(), 'Comics-Progress.json'); toast('Reading progress exported.'); }
      catch (e) { console.error(e); toast('Export failed.', 4000); }
    }
  }));
  document.body.appendChild(sheet);
}

async function importLibraryFile(f) {
  setLoading(true);
  toast('Importing library…', 0);
  try {
    const n = await backup.importLibrary(f, (i, tot, title) => toast(`Importing ${i} / ${tot} · ${title}`, 0));
    toast(n ? `Imported ${n} comic${n > 1 ? 's' : ''}.` : 'Library already up to date.');
  } catch (e) { console.error(e); toast(`Import failed: ${e.message || e}`, 5000); }
  finally { setLoading(false); renderLibrary(); }
}
async function importProgressFile(f) {
  toast('Syncing progress…', 0);
  try {
    const n = await backup.importProgress(f);
    toast(n ? `Updated ${n} book${n > 1 ? 's' : ''}.` : 'No matching books to update.');
  } catch (e) { console.error(e); toast('Progress import failed.', 4000); }
  renderLibrary();
}
function emptyEl() {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.innerHTML = `
    <div class="mark">${I.book}</div>
    <p class="empty-title">A library of your own</p>
    <p class="empty-sub">Add <b>.cbz</b>, <b>.pdf</b>, or <b>.cbr / .cb7</b> files from your Files app. They live on this device and read beautifully offline.</p>
    <button class="btn accent add-btn-2">${I.plus} Add comics</button>`;
  empty.querySelector('.add-btn-2').addEventListener('click', () => fileInput.click());
  return empty;
}

function comicTile(c, i) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.style.setProperty('--i', i);
  const pct = c.pageCount ? Math.round(((c.lastPage + 1) / c.pageCount) * 100) : 0;
  const started = c.lastPage > 0;
  const badge = c.format === 'pdf' ? 'PDF' : c.format === 'archive' ? 'CBR' : 'CBZ';
  tile.innerHTML = `
    <div class="cover-wrap">
      <div class="cover-glow" style="--glow:${c.accent || 'rgb(74,68,70)'}"></div>
      <div class="cover">
        ${coverImg(c.cover)}
        <span class="chip">${badge}</span>
        ${started ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
        <button class="tile-menu" aria-label="Options">${I.dots}</button>
      </div>
    </div>
    <div class="tile-title">${esc(c.title)}</div>
    <div class="tile-sub ${started ? 'reading' : ''}">${started ? `Continue · ${c.lastPage + 1} / ${c.pageCount}` : `${c.pageCount} pages`}</div>`;
  tile.querySelector('.cover').addEventListener('click', e => { if (e.target.closest('.tile-menu')) return; openReader(c.id, showLibrary); });
  tile.querySelector('.tile-menu').addEventListener('click', e => { e.stopPropagation(); comicMenu(c, showLibrary); });
  tile._nav = { comic: c, open: () => openReader(c.id, showLibrary), refresh: showLibrary };
  return tile;
}

function seriesTile(e, i) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.style.setProperty('--i', i);
  const count = e.list.length;
  const unit = e.lead.kind === 'volume' ? (count === 1 ? 'volume' : 'volumes') : (count === 1 ? 'issue' : 'issues');
  const reading = e.list.some(c => c.lastPage > 0);
  tile.innerHTML = `
    <div class="cover-wrap is-series">
      <div class="cover-glow" style="--glow:${e.accent || 'rgb(74,68,70)'}"></div>
      <div class="cover">
        ${coverImg(e.cover)}
        <span class="chip">${count} ${unit}</span>
      </div>
    </div>
    <div class="tile-title">${esc(e.name)}</div>
    <div class="tile-sub ${reading ? 'reading' : ''}">${reading ? 'Reading' : 'Series'} · ${count} ${unit}</div>`;
  tile.querySelector('.cover').addEventListener('click', () => showSeries(e.k));
  tile._nav = { open: () => showSeries(e.k) };
  return tile;
}

// ---------- series detail view ----------
async function showSeries(key) {
  const stale = coverUrls; // revoke only after the new view is built (see renderLibrary)
  coverUrls = [];
  const [allComics, sm] = await Promise.all([lib.getAllComics(), lib.getSeries(key)]);
  const list = allComics.filter(c => c.seriesKey === key).sort((a, b) => numOf(a) - numOf(b));
  if (!list.length) { stale.forEach(URL.revokeObjectURL); return showLibrary(); }
  const lead = list[0];
  const meta = sm || { key, name: lead.seriesName, cover: lead.cover, accent: lead.accent, genres: lead.genres, authors: lead.creators, year: lead.year, publisher: lead.publisher, summary: lead.summary };
  const authors = (meta.authors || []).map(a => a.name).filter((v, idx, arr) => v && arr.indexOf(v) === idx).slice(0, 4);
  const metaline = [authors.join(', '), meta.year, meta.publisher].filter(Boolean).join('  ·  ');
  const unit = lead.kind === 'volume' ? 'volumes' : 'issues';

  app.innerHTML = '';
  stale.forEach(URL.revokeObjectURL); // old <img>s detached — safe to revoke
  const view = document.createElement('div');
  view.className = 'series-view';
  view.innerHTML = `
    <div class="series-hero">
      <div class="series-hero-glow" style="--glow:${meta.accent || 'rgb(74,68,70)'}"></div>
      <button class="icon-btn series-back" aria-label="Library">${I.back}</button>
      <div class="series-hero-row">
        <div class="series-cover">${coverImg(meta.cover)}</div>
        <div class="series-info">
          <h1 class="series-title">${esc(meta.name || lead.seriesName || lead.title)}</h1>
          ${metaline ? `<div class="series-meta">${esc(metaline)}</div>` : ''}
          ${(meta.genres || []).length ? `<div class="genres">${meta.genres.slice(0, 6).map(g => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
          <button class="btn accent match-btn">${I.spark}<span>${meta.anilistId ? 'Re-match online' : 'Match online'}</span></button>
        </div>
      </div>
      ${meta.summary ? `<p class="series-summary">${esc(meta.summary)}</p>` : ''}
    </div>
    <div class="section-label">${list.length} ${unit}</div>
    <div class="grid vols"></div>`;
  app.appendChild(view);

  const grid = view.querySelector('.vols');
  list.forEach((c, i) => grid.appendChild(volTile(c, key, i)));
  view.querySelector('.series-back').addEventListener('click', showLibrary);
  view.querySelector('.match-btn').addEventListener('click', () => matchOnline(key, meta));
  setNav([...grid.querySelectorAll('.tile')], showLibrary);
}

function volTile(c, key, i) {
  const tile = document.createElement('div');
  tile.className = 'tile vol';
  tile.style.setProperty('--i', i);
  const pct = c.pageCount ? Math.round(((c.lastPage + 1) / c.pageCount) * 100) : 0;
  const started = c.lastPage > 0;
  const label = c.number ? `${c.kind === 'volume' ? 'Vol. ' : '#'}${c.number}` : c.title;
  tile.innerHTML = `
    <div class="cover-wrap">
      <div class="cover">
        ${coverImg(c.cover)}
        <span class="vol-badge">${esc(label)}</span>
        ${started ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
        <button class="tile-menu" aria-label="Options">${I.dots}</button>
      </div>
    </div>
    <div class="tile-sub ${started ? 'reading' : ''}">${started ? `p.${c.lastPage + 1} / ${c.pageCount}` : `${c.pageCount} pages`}</div>`;
  tile.querySelector('.cover').addEventListener('click', e => { if (e.target.closest('.tile-menu')) return; openReader(c.id, () => showSeries(key)); });
  tile.querySelector('.tile-menu').addEventListener('click', e => { e.stopPropagation(); comicMenu(c, () => showSeries(key)); });
  tile._nav = { comic: c, open: () => openReader(c.id, () => showSeries(key)), refresh: () => showSeries(key) };
  return tile;
}

// ---------- comic actions (shared by the context menu + keyboard) ----------
async function renameComic(c, refresh) {
  const name = prompt('Title', c.title);
  if (name && name.trim()) { await lib.updateComic(c.id, { title: name.trim() }); refresh(); }
}
async function deleteComic(c, refresh) {
  if (!confirm(`Delete "${c.title}"? This removes it from this device.`)) return;
  const key = c.seriesKey;
  await lib.deleteComic(c.id);
  if (key) {
    const rest = (await lib.getAllComics()).filter(x => x.seriesKey === key);
    if (!rest.length) return showLibrary();
  }
  refresh();
}

// ---------- comic context menu ----------
function comicMenu(c, refresh) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(c.title)}</div>
      <button data-act="read">${I.open} Read</button>
      <button data-act="rename">${I.pencil} Rename</button>
      <button data-act="unread">${I.undo} Mark as unread</button>
      <button data-act="delete" class="danger">${I.trash} Delete</button>
      <button data-act="cancel" class="cancel">Cancel</button>
    </div>`;
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    close();
    if (act === 'read') openReader(c.id, refresh);
    else if (act === 'rename') renameComic(c, refresh);
    else if (act === 'unread') { await lib.updateComic(c.id, { lastPage: 0 }); refresh(); }
    else if (act === 'delete') deleteComic(c, refresh);
  }));
  document.body.appendChild(sheet);
}

// ---------- online metadata match (AniList) ----------
async function matchOnline(key, meta) {
  const { searchManga } = await import('./lib/anilist.js');
  const t = toast('Searching AniList…', 0);
  let results;
  try { results = await searchManga(meta.name || ''); }
  catch (e) { t.classList.remove('show'); return toast('AniList lookup failed — check your connection.', 4000); }
  t.classList.remove('show');
  if (!results.length) return toast('No matches found on AniList.', 3500);

  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet match-sheet">
      <div class="sheet-title">Pick the right match</div>
      <div class="match-list">${results.map((r, i) => `
        <button class="match-item" data-i="${i}">
          ${r.cover ? `<img src="${r.cover}" alt="">` : '<div class="match-ph"></div>'}
          <div class="match-text">
            <div class="match-title">${esc(r.title)}${r.native ? ` <span>${esc(r.native)}</span>` : ''}</div>
            <div class="match-sub">${[r.format, r.year, (r.genres || []).slice(0, 3).join(', ')].filter(Boolean).map(esc).join('  ·  ')}</div>
          </div>
        </button>`).join('')}</div>
      <button data-act="cancel" class="cancel">None of these</button>
    </div>`;
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-act="cancel"]').addEventListener('click', close);
  sheet.querySelectorAll('.match-item').forEach(b => b.addEventListener('click', async () => {
    const r = results[+b.dataset.i];
    close();
    await applyMatch(key, r);
    toast(`Matched to “${r.title}”.`);
    showSeries(key);
  }));
  document.body.appendChild(sheet);
}

async function applyMatch(key, r) {
  const cur = await lib.getSeries(key) || { key };
  await lib.putSeries({
    ...cur,
    name: r.title || cur.name,
    summary: r.description || cur.summary,
    genres: r.genres && r.genres.length ? r.genres : cur.genres,
    authors: r.authors && r.authors.length ? r.authors : cur.authors,
    year: r.year || cur.year,
    anilistId: r.id,
    source: 'anilist',
  });
  // manga reads right-to-left — apply to volumes still on the default
  if (/JP/i.test(r.country) || /MANGA/i.test(r.format)) {
    const vols = (await lib.getAllComics()).filter(c => c.seriesKey === key && c.direction === 'ltr');
    for (const v of vols) await lib.updateComic(v.id, { direction: 'rtl' });
  }
}

// ---------- add flow ----------
fileInput.addEventListener('change', async () => {
  const picked = [...fileInput.files];
  fileInput.value = '';
  if (!picked.length) return;

  // route library bundles / progress files away from the add-as-comic path
  const files = [];
  for (const f of picked) {
    if (/\.json$/i.test(f.name)) { await importProgressFile(f); continue; }
    if (await backup.isLibraryBundle(f)) { await importLibraryFile(f); continue; }
    files.push(f);
  }
  if (!files.length) return;

  setLoading(true);
  const t = toast('Adding…', 0);
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    t.textContent = `Adding ${i + 1} / ${files.length} · ${f.name}`;
    try {
      const backend = await openComic(f);
      let cover = null, accent = null;
      try { const th = await makeThumb(await backend.getPageBlob(0)); cover = th.blob; accent = th.color; } catch (_) {}
      const md = buildMetadata({ comicInfo: backend.comicInfo, pdfInfo: backend.pdfInfo, filename: f.name });
      let storeBlob = f, format = backend.format;
      if (format === 'archive' && f.size < 250 * 1024 * 1024) {
        t.textContent = `Converting ${i + 1} / ${files.length} · ${f.name} → CBZ`;
        try { storeBlob = await archiveToCbz(backend); format = 'zip'; }
        catch (e) { console.warn('CBZ conversion failed; keeping original', e); }
      }
      const rec = await lib.addComic({
        title: md.display, format, pageCount: backend.pageCount, cover, accent,
        seriesName: md.seriesName, seriesKey: md.number ? seriesKey(md.seriesName) : null,
        number: md.number, kind: md.kind, year: md.year, creators: md.creators,
        summary: md.summary, publisher: md.publisher, genres: md.genres,
        direction: md.direction || 'ltr', mode: 'paged',
      }, storeBlob);
      await lib.touchSeries(rec);
      await backend.close();
      ok++;
    } catch (err) {
      console.error('add failed', f.name, err);
      const cbr = /\.cb[r7]$|\.rar$|\.7z$/i.test(f.name);
      toast(cbr
        ? `Couldn't open ${f.name}. CBR/CB7 can be unreliable in-browser — converting it to CBZ is recommended.`
        : `Couldn't open ${f.name}: ${err.message || err}`, 5000);
    }
  }
  setLoading(false);
  if (ok) toast(`Added ${ok} comic${ok > 1 ? 's' : ''}.`);
  else t.classList.remove('show');
  renderLibrary();
});

// ---------- reader ----------
let readerReturn = showLibrary;
async function openReader(id, returnTo = showLibrary) {
  const comic = await lib.getComic(id);
  if (!comic) return;
  readerReturn = returnTo;
  const t = toast('Opening…', 0);
  try {
    const blob = await lib.getFileBlob(id);
    const backend = await openComic(blob);
    t.classList.remove('show');
    document.body.classList.add('reading');
    reader = createReader({ mount: app, backend, comic, onUpdate: patch => lib.updateComic(id, patch), onExit: closeReader });
  } catch (err) {
    console.error(err);
    toast(`Couldn't open: ${err.message || err}`, 5000);
  }
}
function closeReader() {
  if (reader) { reader.destroy(); reader = null; }
  document.body.classList.remove('reading');
  readerReturn();
}

// ---------- boot ----------
async function boot() {
  loadbar = document.createElement('div');
  loadbar.className = 'loadbar';
  document.body.appendChild(loadbar);
  document.addEventListener('keydown', onLibKey);
  await lib.requestPersistence();
  await renderLibrary();
  // "Add comics" home-screen shortcut → open the picker (best-effort; needs a gesture)
  if (new URLSearchParams(location.search).has('add')) setTimeout(() => fileInput.click(), 250);
  if ('serviceWorker' in navigator) {
    // When a freshly-deployed worker takes over, reload once so the page runs
    // the new code instead of the stale cached shell. Guarded so a first-ever
    // visit (no prior controller) doesn't reload, and so it only fires once.
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
    }
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
