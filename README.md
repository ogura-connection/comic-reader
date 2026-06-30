# Comics — a self-hosted, install-free comic reader

A static web app (PWA) for reading **CBZ / PDF / CBR / CB7** comics on an iPad (or
anything) **without installing an app**. Open it in Safari, "Add to Home Screen",
and it behaves like a native reader. Your comics live on the device (IndexedDB)
and work offline. No server, no accounts, no ads.

## Use it on the iPad

1. Open the hosted URL in **Safari**.
2. Tap **Share → Add to Home Screen**. (This is a bookmark, **not** an App Store
   install — allowed on a locked-down iPad.)
3. Launch it from the home screen (runs fullscreen).
4. Tap **＋ Add comics** and pick files from the **Files app** (iCloud Drive,
   Dropbox, On My iPad — wherever your comics are).

### Reading
- **Tap** the right/left third to turn pages; **swipe**; or use arrow keys.
- **Tap the center** to show/hide the toolbar. Page turns slide in the reading
  direction; the very first time you open a book a quick hint shows the tap zones.
- **Pinch** to zoom anywhere; **double-tap** the page to zoom toward that spot,
  double-tap again to fit. Drag to pan.
- **⚙ menu**:
  - **Layout** — Single / Double / Scroll.
  - **Direction** — Western (→) / Manga (←).
  - **Fit** (single-page) — Page (fit to screen) or Width (fill the width; tall
    pages scroll vertically as you drag).
  - **Comfort** — Brightness and Warmth sliders (a night-friendly wash). These are
    app-wide and remembered.
  Layout / direction / fit are remembered **per book**.
- It always **resumes where you left off**.

### Keyboard (for when an iPad keyboard or a Mac is attached)
- **Library:** arrow keys move the selection, **Return** opens, **F2** renames,
  **Delete** removes, **Esc** backs out of a series.
- **Reader:** arrows / space / Page Up·Down turn pages, **+ / −** zoom,
  **0** resets zoom, **Home / End** jump to first / last page, **Esc** closes.

## Move your library to a new device / back it up
A static web app can't reach iCloud directly, so syncing is one tap of export +
one tap of import (save/open the file in the **Files** app → iCloud Drive):
- **⚙ (library) → Export library (.zip)** — packs every comic, cover, and your
  reading positions into one file. On the new device: **Add → pick the .zip →
  Import**. (Re-importing never overwrites newer local positions.)
- **Export reading progress (.json)** — a tiny file with just where you are in
  each book. Import it on another device that already has the same comics to
  catch your place up. Positions only ever move forward.
- The **⚙** sheet also shows how much on-device storage the library is using.

## Formats
| Format | Support | Notes |
|--------|---------|-------|
| **CBZ** (zip) | ✅ Best | Pages read on demand — fast, low memory, handles big files. |
| **PDF** | ✅ Good | Rendered crisply (≈2400px). |
| **CBR / CB7** (rar/7z) | ⚠️ Auto-converted on import | Extracted once when added and repackaged as **CBZ**, so every later read uses the fast/reliable zip path (libarchive never runs again). Some RARv5/solid archives may fail to extract — then it's kept as-is and Calibre conversion helps. Files over ~250MB are kept as-is to avoid a conversion memory spike. Mislabeled `.cbr` files that are really ZIPs skip straight to the fast path. |

## Honest limits
- **Huge scans:** iPad Safari may subsample images larger than ~16MP on decode.
  Normal manga/comics (~1600–2500px wide) are unaffected.
- **Storage:** iOS can evict site data after ~7 idle days. The app calls
  `navigator.storage.persist()` (installed PWAs usually get it granted) to resist
  this. Worst case you re-add files. Keep originals in iCloud/Files.

## iPad test checklist (do these on the real device)
- [ ] Add to Home Screen → branded splash → launches fullscreen, no Safari chrome.
- [ ] Add a .cbz → cover appears → opens → pages in order.
- [ ] Open a book, return to the library → covers stay sharp (no broken-image "?").
- [ ] Manga (←) direction turns pages right-to-left; turns slide the right way.
- [ ] Pinch-zoom feels smooth; **double-tap** zooms toward the spot, again to fit.
- [ ] Fit: Width fills the width; a tall page scrolls vertically.
- [ ] Brightness / Warmth sliders dim + warm the page and persist.
- [ ] Scroll (webtoon) layout loads pages as you scroll.
- [ ] A large comic (~200MB+) opens without crashing.
- [ ] Close & reopen a book → resumes the right page.
- [ ] Export library → Import on a fresh profile → everything restored.
- [ ] Turn off Wi-Fi → app still launches (offline shell).

---

## Project layout (for future tinkering)
```
index.html / app.css / app.js   app shell + library UI + orchestration
lib/library.js                  IndexedDB store (comics, files, positions)
lib/archive.js                  magic-byte format detect + zip/pdf/libarchive backends
lib/reader.js                   reading surface (modes, gestures, zoom, comfort, resume)
lib/backup.js                   library/progress export + import (.zip / .json)
lib/thumb.js                    cover thumbnails
vendor/                         zip.js (CBZ), pdf.js (PDF), libarchive.js (CBR/CB7)
sw.js / manifest.webmanifest    PWA offline shell + install metadata
tools/gen-splash.mjs            one-off: render the iOS launch-screen PNGs (dev only)
samples/                        test comics (cbz/pdf/cb7) — safe to delete
```

## Run locally
Any static server works (a service worker needs `localhost` or HTTPS):
```
cd comic-reader
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy
Anything that serves static files over HTTPS (GitHub Pages, Cloudflare Pages,
Netlify). No build step. Just upload the folder.
