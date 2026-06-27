# comic-reader

Static, install-free PWA comic reader (CBZ/PDF/CBR/CB7) for reading on a
locked-down iPad via "Add to Home Screen". No backend, no build step — plain
HTML/CSS/ES-modules. Comics stored on-device in IndexedDB.

## Key decisions
- **No build step.** Vendored libs in `vendor/`; heavy ones (pdf.js, libarchive)
  are lazy-loaded via dynamic `import()`. zip.js is a UMD global (`window.zip`).
- **Format detection by magic bytes** (`lib/archive.js`), not extension — iOS
  ignores the file-picker `accept` filter and many `.cbr` are really ZIPs.
- **CBZ = fast path** (zip.js random-access reads). **CBR/CB7 = best-effort**
  (libarchive WASM, whole-archive-in-memory). PDF via pdf.js → canvas → jpeg.
- Pages render as native `<img>` (object URLs) for max quality; only neighbours
  kept in memory, the rest revoked. Vertical mode lazy-loads via scroll handler
  (NOT IntersectionObserver — it doesn't fire reliably headless).
- Reading state (last page / mode / direction) persisted per book in IndexedDB.

## Gotchas
- Service worker (`sw.js`) caches the app shell → bump `CACHE` version when
  changing vendored libs or core files, or it serves stale code.
- `.menu[hidden]` rule is required — `.menu{display:flex}` otherwise overrides
  the `hidden` attribute.

## Verify
`python3 -m http.server` in the dir, or use the `comics` preview config. Drive
the add flow by feeding `samples/*` into `#file-input` via a DataTransfer.
