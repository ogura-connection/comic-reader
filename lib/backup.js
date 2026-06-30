// Library portability. Two flavours, both saved/opened via the iOS Files app
// (iCloud Drive), since a static web app can't reach iCloud directly:
//   - Full bundle  (.zip): every comic file + cover + metadata + reading state.
//     Move your whole library to a new device, or keep it as a backup.
//   - Progress     (.json): just where you are in each book + per-book settings.
//     Sync your place between devices that already hold the same comics.
// Reuses the zip.js global (window.zip) that's already loaded for CBZ.

import * as lib from './library.js';

const FILE_EXT = { zip: 'cbz', pdf: 'pdf', archive: 'cbz' };
const skey = k => encodeURIComponent(k).replace(/%/g, '_');

function zipjs() {
  const zip = window.zip;
  zip.configure({ useWebWorkers: false });
  return zip;
}

// ---- full library bundle ----
export async function exportLibrary(onProgress) {
  const zip = zipjs();
  const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), { level: 0 });
  const comics = await lib.getAllComics();
  const series = await lib.getAllSeries();
  const manifest = { version: 1, exportedAt: Date.now(), comics: [], series: [] };

  for (let i = 0; i < comics.length; i++) {
    const c = comics[i];
    if (onProgress) onProgress(i + 1, comics.length, c.title);
    const blob = await lib.getFileBlob(c.id);
    const ext = FILE_EXT[c.format] || 'bin';
    const filePath = blob ? `files/${c.id}.${ext}` : null;
    const coverPath = c.cover ? `covers/${c.id}.jpg` : null;
    if (blob) await writer.add(filePath, new zip.BlobReader(blob));
    if (c.cover) await writer.add(coverPath, new zip.BlobReader(c.cover));
    const meta = { ...c }; delete meta.cover;
    manifest.comics.push({ ...meta, file: filePath, cover: coverPath });
  }
  for (const s of series) {
    const coverPath = s.cover ? `series/${skey(s.key)}.jpg` : null;
    if (s.cover) await writer.add(coverPath, new zip.BlobReader(s.cover));
    const meta = { ...s }; delete meta.cover;
    manifest.series.push({ ...meta, cover: coverPath });
  }
  await writer.add('library.json', new zip.TextReader(JSON.stringify(manifest)));
  return writer.close();
}

// Quick sniff (used to route a picked .zip to import vs. add-as-comic).
export async function isLibraryBundle(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return false; // not a zip
  try {
    const zip = zipjs();
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    const entries = await reader.getEntries();
    await reader.close();
    return entries.some(e => e.filename === 'library.json');
  } catch { return false; }
}

export async function importLibrary(file, onProgress) {
  const zip = zipjs();
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const entries = await reader.getEntries();
  const byName = new Map(entries.map(e => [e.filename, e]));
  const manifestEntry = byName.get('library.json');
  if (!manifestEntry) { await reader.close(); throw new Error('Not a library bundle'); }
  const manifest = JSON.parse(await manifestEntry.getData(new zip.TextWriter()));

  const comics = [], files = {}, series = [];
  const list = manifest.comics || [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (onProgress) onProgress(i + 1, list.length, m.title);
    const rec = { ...m }; const filePath = rec.file, coverPath = rec.cover;
    delete rec.file; delete rec.cover;
    rec.cover = (coverPath && byName.has(coverPath))
      ? await byName.get(coverPath).getData(new zip.BlobWriter('image/jpeg')) : null;
    if (filePath && byName.has(filePath)) {
      files[rec.id] = await byName.get(filePath).getData(new zip.BlobWriter('application/octet-stream'));
    }
    comics.push(rec);
  }
  for (const m of (manifest.series || [])) {
    const rec = { ...m }; const coverPath = rec.cover; delete rec.cover;
    rec.cover = (coverPath && byName.has(coverPath))
      ? await byName.get(coverPath).getData(new zip.BlobWriter('image/jpeg')) : null;
    series.push(rec);
  }
  await reader.close();
  return lib.importLibraryData({ comics, files, series });
}

// ---- reading-progress only ----
export async function exportProgress() {
  const comics = await lib.getAllComics();
  const items = comics.map(c => ({
    id: c.id, title: c.title, seriesKey: c.seriesKey, number: c.number, pageCount: c.pageCount,
    lastPage: c.lastPage, mode: c.mode, direction: c.direction, fit: c.fit, updatedAt: c.updatedAt,
  }));
  return new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), items })], { type: 'application/json' });
}

export async function importProgress(file) {
  const data = JSON.parse(await file.text());
  const items = data.items || [];
  const local = await lib.getAllComics();
  const byId = new Map(local.map(c => [c.id, c]));
  let applied = 0;
  for (const it of items) {
    // match on id first; else by series/title + number + length (a different device)
    const target = byId.get(it.id) || local.find(c =>
      (c.seriesKey || c.title) === (it.seriesKey || it.title) &&
      (c.number || null) === (it.number || null) && c.pageCount === it.pageCount);
    if (!target) continue;
    if ((it.updatedAt || 0) <= (target.updatedAt || 0)) continue; // never regress a position
    const patch = {};
    if (typeof it.lastPage === 'number') patch.lastPage = Math.max(0, Math.min(it.lastPage, (target.pageCount || 1) - 1));
    if (it.mode) patch.mode = it.mode;
    if (it.direction) patch.direction = it.direction;
    if (it.fit) patch.fit = it.fit;
    await lib.updateComic(target.id, patch);
    applied++;
  }
  return applied;
}
