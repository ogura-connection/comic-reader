import * as lib from './lib/library.js';
import { openComic, archiveToCbz } from './lib/archive.js';
import { makeThumb } from './lib/thumb.js';
import { createReader } from './lib/reader.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
let coverUrls = [];
let reader = null;
let loadbar = null;

const titleFromName = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
const esc = s => s.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const I = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 6.4C10.4 4.9 7.4 4.2 4.4 4.7v13c3-.5 6 .2 7.6 1.8 1.6-1.6 4.6-2.3 7.6-1.8v-13C16.6 4.2 13.6 4.9 12 6.4Z"/><path d="M12 6.4v13.1"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.6C5 5.1 8 5.6 12 7.6c4-2 7-2.5 10-2v13c-3-.5-6 0-10 2-4-2-7-2.5-10-2Z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M14 6l4 4"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a6 6 0 1 1 0 12H8"/><path d="m6 5-3 3 3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
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

// ---------- library view ----------
async function renderLibrary() {
  coverUrls.forEach(URL.revokeObjectURL);
  coverUrls = [];
  const comics = (await lib.getAllComics()).sort((a, b) => b.updatedAt - a.updatedAt);
  app.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'lib-header';
  header.innerHTML = `
    <div class="brand">
      <span class="kicker">Reader</span>
      <h1>Comics<em>.</em></h1>
    </div>
    <div class="spacer"></div>
    ${comics.length ? `<span class="count">${comics.length} ${comics.length === 1 ? 'volume' : 'volumes'}</span>` : ''}
    <button class="btn accent add-btn">${I.plus} Add</button>`;
  header.querySelector('.add-btn').addEventListener('click', () => fileInput.click());
  app.appendChild(header);

  if (!comics.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="mark">${I.book}</div>
      <p class="empty-title">A library of your own</p>
      <p class="empty-sub">Add <b>.cbz</b>, <b>.pdf</b>, or <b>.cbr / .cb7</b> files from your Files app. They live on this device and read beautifully offline.</p>
      <button class="btn accent add-btn-2">${I.plus} Add comics</button>`;
    empty.querySelector('.add-btn-2').addEventListener('click', () => fileInput.click());
    app.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid';
  comics.forEach((c, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.setProperty('--i', i);
    const coverUrl = c.cover ? URL.createObjectURL(c.cover) : '';
    if (coverUrl) coverUrls.push(coverUrl);
    const pct = c.pageCount ? Math.round(((c.lastPage + 1) / c.pageCount) * 100) : 0;
    const started = c.lastPage > 0;
    const badge = c.format === 'pdf' ? 'PDF' : c.format === 'archive' ? 'CBR' : 'CBZ';
    tile.innerHTML = `
      <div class="cover-wrap">
        <div class="cover-glow" style="--glow:${c.accent || 'rgb(74,68,70)'}"></div>
        <div class="cover">
          ${coverUrl ? `<img src="${coverUrl}" alt="" loading="lazy">` : `<div class="cover-ph">${I.book}</div>`}
          <span class="chip">${badge}</span>
          ${started ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
          <button class="tile-menu" aria-label="Options">${I.dots}</button>
        </div>
      </div>
      <div class="tile-title">${esc(c.title)}</div>
      <div class="tile-sub ${started ? 'reading' : ''}">${started ? `Continue · ${c.lastPage + 1} / ${c.pageCount}` : `${c.pageCount} pages`}</div>`;
    tile.querySelector('.cover').addEventListener('click', e => {
      if (e.target.closest('.tile-menu')) return;
      openReader(c.id);
    });
    tile.querySelector('.tile-menu').addEventListener('click', e => { e.stopPropagation(); tileMenu(c); });
    grid.appendChild(tile);
  });
  app.appendChild(grid);
}

// ---------- tile context menu ----------
function tileMenu(c) {
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
    if (act === 'read') openReader(c.id);
    else if (act === 'rename') {
      const name = prompt('Title', c.title);
      if (name && name.trim()) { await lib.updateComic(c.id, { title: name.trim() }); renderLibrary(); }
    } else if (act === 'unread') { await lib.updateComic(c.id, { lastPage: 0 }); renderLibrary(); }
    else if (act === 'delete') {
      if (confirm(`Delete "${c.title}"? This removes it from this device.`)) { await lib.deleteComic(c.id); renderLibrary(); }
    }
  }));
  document.body.appendChild(sheet);
}

// ---------- add flow ----------
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
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
      let storeBlob = f, format = backend.format;
      if (format === 'archive' && f.size < 250 * 1024 * 1024) {
        t.textContent = `Converting ${i + 1} / ${files.length} · ${f.name} → CBZ`;
        try { storeBlob = await archiveToCbz(backend); format = 'zip'; }
        catch (e) { console.warn('CBZ conversion failed; keeping original', e); }
      }
      await lib.addComic({
        title: titleFromName(f.name), format, pageCount: backend.pageCount, cover, accent,
        direction: 'ltr', mode: 'paged',
      }, storeBlob);
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
async function openReader(id) {
  const comic = await lib.getComic(id);
  if (!comic) return;
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
  renderLibrary();
}

// ---------- boot ----------
async function boot() {
  loadbar = document.createElement('div');
  loadbar.className = 'loadbar';
  document.body.appendChild(loadbar);
  await lib.requestPersistence();
  await renderLibrary();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
