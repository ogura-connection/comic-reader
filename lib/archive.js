// Opens a comic file and exposes a uniform reader interface:
//   { pageCount, format, async getPageBlob(i), close() }
// Format is detected by magic bytes (not the file extension) because iOS
// ignores the file-picker `accept` filter and many `.cbr` files are really ZIPs.

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};

const mimeFor = name => MIME[(name.split('.').pop() || '').toLowerCase()] || 'image/jpeg';

const natCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Junk paths that show up in archives but aren't pages.
const isImagePath = p =>
  IMAGE_RE.test(p) && !p.includes('__MACOSX') && !p.split('/').pop().startsWith('.');

export async function detectFormat(blob) {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const b = (...sig) => sig.every((v, i) => head[i] === v);
  if (b(0x50, 0x4b)) return 'zip';                            // PK.. (ZIP / CBZ)
  if (b(0x52, 0x61, 0x72, 0x21)) return 'archive';            // Rar! (RAR / CBR)
  if (b(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return 'archive';// 7z (CB7)
  if (b(0x25, 0x50, 0x44, 0x46)) return 'pdf';               // %PDF
  return 'zip'; // optimistic fallback — most comics are zips
}

export async function openComic(blob) {
  const format = await detectFormat(blob);
  if (format === 'pdf') return openPdf(blob);
  if (format === 'archive') return openArchive(blob);
  return openZip(blob);
}

// ---- CBZ (zip.js, random-access reads straight from the blob) ----
async function openZip(blob) {
  const zip = window.zip;
  zip.configure({ useWebWorkers: false });
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  const entries = (await reader.getEntries())
    .filter(e => !e.directory && isImagePath(e.filename))
    .sort((a, b) => natCompare(a.filename, b.filename));
  if (!entries.length) { await reader.close(); throw new Error('No images found in archive.'); }
  return {
    format: 'zip',
    pageCount: entries.length,
    async getPageBlob(i) {
      return entries[i].getData(new zip.BlobWriter(mimeFor(entries[i].filename)));
    },
    async close() { try { await reader.close(); } catch (_) {} },
  };
}

// ---- CBR / CB7 (libarchive.js wasm — best effort, lazy-loaded) ----
async function openArchive(blob) {
  const { Archive } = await import('../vendor/libarchive/libarchive.js');
  Archive.init();
  const archive = await Archive.open(new File([blob], 'comic'));
  const entries = (await archive.getFilesArray())
    .filter(e => isImagePath(e.path + e.file.name))
    .sort((a, b) => natCompare(a.path + a.file.name, b.path + b.file.name));
  if (!entries.length) throw new Error('No images found in archive.');
  return {
    format: 'archive',
    pageCount: entries.length,
    async getPageBlob(i) { return entries[i].file.extract(); },
    async close() { try { archive.worker && archive.worker.terminate(); } catch (_) {} },
  };
}

// ---- PDF (pdf.js, rendered to canvas at high DPI — lazy-loaded) ----
async function openPdf(blob) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  return {
    format: 'pdf',
    pageCount: doc.numPages,
    async getPageBlob(i) {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      // Render so the long edge is ~2400px — crisp on Retina without blowing memory.
      const scale = Math.min(4, Math.max(1, 2400 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
      canvas.width = canvas.height = 0; // free the backing store
      return out;
    },
    async close() { try { await doc.destroy(); } catch (_) {} },
  };
}
