import * as lib from './lib/library.js';
import { openComic } from './lib/archive.js';
import { makeThumb } from './lib/thumb.js';
import { createReader } from './lib/reader.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
let coverUrls = [];
let reader = null;

const titleFromName = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';

// ---------- toast ----------
function toast(msg, ms = 2600) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  if (ms) t._timer = setTimeout(() => t.classList.remove('show'), ms);
  return t;
}

// ---------- library view ----------
async function renderLibrary() {
  coverUrls.forEach(URL.revokeObjectURL);
  coverUrls = [];
  const comics = (await lib.getAllComics()).sort((a, b) => b.updatedAt - a.updatedAt);
  app.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'lib-header';
  header.innerHTML = `
    <h1>Comics</h1>
    <div class="spacer"></div>
    <button class="btn add-btn">＋ Add comics</button>`;
  header.querySelector('.add-btn').addEventListener('click', () => fileInput.click());
  app.appendChild(header);

  if (!comics.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <p class="empty-title">Your library is empty</p>
      <p class="empty-sub">Add <b>.cbz</b>, <b>.pdf</b>, or <b>.cbr/.cb7</b> files from your Files app.<br>
      They stay on this device and work offline.</p>
      <button class="btn add-btn-2">＋ Add comics</button>`;
    empty.querySelector('.add-btn-2').addEventListener('click', () => fileInput.click());
    app.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const c of comics) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const coverUrl = c.cover ? URL.createObjectURL(c.cover) : '';
    if (coverUrl) coverUrls.push(coverUrl);
    const pct = c.pageCount ? Math.round(((c.lastPage + 1) / c.pageCount) * 100) : 0;
    const started = c.lastPage > 0;
    tile.innerHTML = `
      <div class="cover">
        ${coverUrl ? `<img src="${coverUrl}" alt="">` : '<div class="cover-ph">📖</div>'}
        <span class="badge">${c.format === 'pdf' ? 'PDF' : c.format === 'archive' ? 'CBR' : 'CBZ'}</span>
        ${started ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
        <button class="tile-menu" aria-label="Menu">⋯</button>
      </div>
      <div class="tile-title">${escapeHtml(c.title)}</div>
      <div class="tile-sub">${started ? `p.${c.lastPage + 1} / ${c.pageCount}` : `${c.pageCount} pages`}</div>`;
    tile.querySelector('.cover').addEventListener('click', e => {
      if (e.target.closest('.tile-menu')) return;
      openReader(c.id);
    });
    tile.querySelector('.tile-menu').addEventListener('click', e => {
      e.stopPropagation();
      tileMenu(c);
    });
    grid.appendChild(tile);
  }
  app.appendChild(grid);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

// ---------- tile context menu ----------
function tileMenu(c) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${escapeHtml(c.title)}</div>
      <button data-act="read">Read</button>
      <button data-act="rename">Rename</button>
      <button data-act="unread">Mark as unread</button>
      <button data-act="delete" class="danger">Delete</button>
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
      if (confirm(`Delete "${c.title}"? This removes it from this device.`)) {
        await lib.deleteComic(c.id); renderLibrary();
      }
    }
  }));
  document.body.appendChild(sheet);
}

// ---------- add flow ----------
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (!files.length) return;
  const t = toast(`Adding…`, 0);
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    t.textContent = `Adding ${i + 1} / ${files.length}: ${f.name}`;
    try {
      const backend = await openComic(f);
      let cover = null;
      try { cover = await makeThumb(await backend.getPageBlob(0)); } catch (_) {}
      await lib.addComic({
        title: titleFromName(f.name),
        format: backend.format,
        pageCount: backend.pageCount,
        cover,
        direction: 'ltr',
        mode: 'paged',
      }, f);
      await backend.close();
      ok++;
    } catch (err) {
      console.error('add failed', f.name, err);
      const cbr = /\.cb[r7]$|\.rar$|\.7z$/i.test(f.name);
      toast(cbr
        ? `Couldn't open ${f.name}. CBR/CB7 is unreliable in-browser — converting it to CBZ is recommended.`
        : `Couldn't open ${f.name}: ${err.message || err}`, 5000);
    }
  }
  if (ok) toast(`Added ${ok} comic${ok > 1 ? 's' : ''}.`);
  else if (files.length) t.classList.remove('show');
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
    reader = createReader({
      mount: app,
      backend,
      comic,
      onUpdate: patch => lib.updateComic(id, patch),
      onExit: closeReader,
    });
    app.querySelector('.lib-header')?.style.setProperty('display', 'none');
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
  await lib.requestPersistence();
  await renderLibrary();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
