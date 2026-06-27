// IndexedDB-backed library. Metadata + cover live in `comics`; the raw comic
// file blob lives in `files` (kept separate so listing the grid never pulls
// hundreds of MB of comic data into memory).

const DB_NAME = 'comic-reader';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('comics')) {
        db.createObjectStore('comics', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? storeNames.map(n => t.objectStore(n))
      : t.objectStore(storeNames);
    let result;
    Promise.resolve(fn(stores, t)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqProm = req => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

// meta: {title, format, pageCount, cover(Blob), direction, mode, fit, lastPage}
export async function addComic(meta, fileBlob) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const record = {
    id,
    title: meta.title,
    format: meta.format,
    pageCount: meta.pageCount,
    cover: meta.cover || null,
    accent: meta.accent || null,
    direction: meta.direction || 'ltr',
    mode: meta.mode || 'paged',
    fit: meta.fit || 'width',
    lastPage: 0,
    size: fileBlob.size,
    addedAt: now,
    updatedAt: now,
  };
  await tx(['comics', 'files'], 'readwrite', ([comics, files]) => {
    comics.put(record);
    files.put({ id, blob: fileBlob });
  });
  return record;
}

export async function getAllComics() {
  const list = await tx('comics', 'readonly', store => reqProm(store.getAll()));
  return list;
}

export function getComic(id) {
  return tx('comics', 'readonly', store => reqProm(store.get(id)));
}

export async function getFileBlob(id) {
  const rec = await tx('files', 'readonly', store => reqProm(store.get(id)));
  return rec ? rec.blob : null;
}

export async function updateComic(id, patch) {
  return tx('comics', 'readwrite', async store => {
    const rec = await reqProm(store.get(id));
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: Date.now() });
    store.put(rec);
    return rec;
  });
}

export async function deleteComic(id) {
  await tx(['comics', 'files'], 'readwrite', ([comics, files]) => {
    comics.delete(id);
    files.delete(id);
  });
}

// Ask the browser to keep our data (resists iOS 7-day eviction). Best-effort.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) {}
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate();
    }
  } catch (_) {}
  return null;
}
