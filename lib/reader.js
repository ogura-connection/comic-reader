// The reading surface. Two modes:
//   - paged:  one page (or two, in spread) fit to screen; pinch to zoom/pan;
//             tap-zones / swipe / arrow keys to turn.
//   - vertical: continuous fit-width scroll (webtoon style), lazy-loaded.
// Reading direction (ltr / rtl) flips which side is "next". State (last page,
// mode, direction) is persisted via onUpdate.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const RI = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2.3"/><circle cx="8" cy="17" r="2.3"/></svg>',
  single: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="7" y="4" width="10" height="16" rx="1.6"/></svg>',
  double: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="4.5" width="7.5" height="15" rx="1.3"/><rect x="13" y="4.5" width="7.5" height="15" rx="1.3"/></svg>',
  scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3.5" width="10" height="17" rx="1.6"/><path d="M12 8.5v6M9.5 12l2.5 2.5 2.5-2.5"/></svg>',
  ltr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  rtl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6M11 6l-6 6 6 6"/></svg>',
  fitPage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="4" width="12" height="16" rx="1.6"/></svg>',
  fitWidth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="7" width="16" height="10" rx="1.4"/><path d="M2.5 4.5h19M2.5 19.5h19" stroke-width="1.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  warm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0-3 11.2V17a3 3 0 0 0 6 0v-2.8A6 6 0 0 0 12 3Z"/><path d="M9.5 17h5"/></svg>',
};

export function createReader({ mount, backend, comic, onExit, onUpdate }) {
  const total = backend.pageCount;
  let mode = comic.mode || 'paged';        // 'paged' | 'vertical' | 'spread'
  let direction = comic.direction || 'ltr';
  let coverAlone = comic.coverAlone !== false; // in spread, page 0 (cover) stands alone
  let fit = comic.fit === 'width' ? 'width' : 'page'; // single-paged: contain vs fill-width
  let cur = clamp(comic.lastPage || 0, 0, total - 1);

  // ---- shared page-blob cache (index -> {blob, url}) ----
  const cache = new Map();
  async function urlFor(i) {
    let e = cache.get(i);
    if (e) return e.url;
    const blob = await backend.getPageBlob(i);
    const url = URL.createObjectURL(blob);
    cache.set(i, { blob, url });
    return url;
  }
  function revokeOutside(keep) {
    for (const [i, e] of cache) {
      if (!keep.has(i)) { URL.revokeObjectURL(e.url); cache.delete(i); }
    }
  }

  // ---- DOM ----
  const root = document.createElement('div');
  root.className = 'reader';
  root.innerHTML = `
    <div class="stage"></div>
    <div class="comfort-veil"></div>
    <div class="spinner" hidden><span class="spin-ring"></span></div>
    <div class="progress-hair"></div>
    <div class="chrome top">
      <button class="icon-btn back" aria-label="Library">${RI.back}</button>
      <div class="title"></div>
      <button class="icon-btn menu-btn" aria-label="Settings">${RI.sliders}</button>
    </div>
    <div class="chrome bottom">
      <input class="slider" type="range" min="1" max="${total}" step="1">
      <div class="page-num"></div>
    </div>
    <div class="menu" hidden>
      <div class="menu-group">
        <div class="menu-label">Layout</div>
        <div class="menu-row" data-group="mode">
          <button class="seg" data-mode="paged">${RI.single}<span>Single</span></button>
          <button class="seg" data-mode="spread">${RI.double}<span>Double</span></button>
          <button class="seg" data-mode="vertical">${RI.scroll}<span>Scroll</span></button>
        </div>
      </div>
      <div class="menu-group">
        <div class="menu-label">Direction</div>
        <div class="menu-row" data-group="dir">
          <button class="seg" data-dir="ltr">${RI.ltr}<span>Western</span></button>
          <button class="seg" data-dir="rtl">${RI.rtl}<span>Manga</span></button>
        </div>
      </div>
      <div class="menu-group spread-only">
        <div class="menu-label">Cover page</div>
        <div class="menu-row" data-group="cover">
          <button class="seg" data-cover="solo">${RI.single}<span>Solo</span></button>
          <button class="seg" data-cover="paired">${RI.double}<span>Paired</span></button>
        </div>
      </div>
      <div class="menu-group page-only">
        <div class="menu-label">Fit</div>
        <div class="menu-row" data-group="fit">
          <button class="seg" data-fit="page">${RI.fitPage}<span>Page</span></button>
          <button class="seg" data-fit="width">${RI.fitWidth}<span>Width</span></button>
        </div>
      </div>
      <div class="menu-group">
        <div class="menu-label">Comfort</div>
        <label class="comfort-row">${RI.sun}<input class="comfort-slider" data-comfort="brightness" type="range" min="45" max="100" step="1"></label>
        <label class="comfort-row">${RI.warm}<input class="comfort-slider" data-comfort="warmth" type="range" min="0" max="100" step="1"></label>
      </div>
    </div>
    <div class="tap-hint" hidden>
      <div class="tap-hint-zone left"><span>${RI.back}</span></div>
      <div class="tap-hint-zone mid"><span>Tap: menu</span></div>
      <div class="tap-hint-zone right"><span>${RI.ltr}</span></div>
    </div>`;
  mount.appendChild(root);

  const stage = root.querySelector('.stage');
  const slider = root.querySelector('.slider');
  const pageNum = root.querySelector('.page-num');
  const menu = root.querySelector('.menu');
  const progressHair = root.querySelector('.progress-hair');
  const veil = root.querySelector('.comfort-veil');
  const spinner = root.querySelector('.spinner');
  const tapHint = root.querySelector('.tap-hint');
  root.querySelector('.title').textContent = comic.title;

  // ---- reading-comfort veil (global, persisted): a multiply wash that dims +
  // warms the page without touching the scrolling stage's compositing ----
  const comfort = {
    brightness: clamp(parseInt(localStorage.getItem('reader.brightness')) || 100, 45, 100),
    warmth: clamp(parseInt(localStorage.getItem('reader.warmth')) || 0, 0, 100),
  };
  function applyComfort() {
    const br = comfort.brightness / 100, w = comfort.warmth / 100;
    const r = Math.round(255 * br);
    const g = Math.round(255 * br * (1 - 0.12 * w));
    const b = Math.round(255 * br * (1 - 0.5 * w));
    veil.style.background = `rgb(${r},${g},${b})`;
    veil.style.opacity = (br < 1 || w > 0) ? '1' : '0';
  }

  // ---- per-page loading spinner (only shows if a load is genuinely slow) ----
  let spinTimer = 0;
  function showSpinner() { clearTimeout(spinTimer); spinTimer = setTimeout(() => { spinner.hidden = false; }, 180); }
  function hideSpinner() { clearTimeout(spinTimer); spinner.hidden = true; }
  function showPageError(retry) {
    hideSpinner();
    stage.innerHTML = `<div class="page-error"><p>This page couldn't load.</p><button class="btn retry-btn">Tap to retry</button></div>`;
    stage.querySelector('.retry-btn').addEventListener('click', retry);
  }

  function reflectMenu() {
    menu.querySelectorAll('[data-mode]').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === mode));
    menu.querySelectorAll('[data-dir]').forEach(b =>
      b.classList.toggle('on', b.dataset.dir === direction));
    menu.querySelectorAll('[data-cover]').forEach(b =>
      b.classList.toggle('on', b.dataset.cover === (coverAlone ? 'solo' : 'paired')));
    menu.querySelectorAll('[data-fit]').forEach(b =>
      b.classList.toggle('on', b.dataset.fit === fit));
    menu.querySelector('[data-comfort="brightness"]').value = String(comfort.brightness);
    menu.querySelector('[data-comfort="warmth"]').value = String(comfort.warmth);
  }

  // ---- persistence (debounced for page position) ----
  let saveTimer = null;
  function savePage() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => onUpdate({ lastPage: cur }), 400);
  }
  function setPageNum() {
    const idx = spreadIndices(cur);
    const last = idx[idx.length - 1];
    pageNum.textContent = idx.length > 1 ? `${idx[0] + 1}–${last + 1} / ${total}` : `${cur + 1} / ${total}`;
    slider.value = String(cur + 1);
    progressHair.style.width = `${((last + 1) / total) * 100}%`;
  }

  // ---- chrome (toolbar) auto-hide ----
  let chromeVisible = true;
  function toggleChrome(force) {
    chromeVisible = force === undefined ? !chromeVisible : force;
    root.classList.toggle('chrome-hidden', !chromeVisible);
    if (!chromeVisible) menu.hidden = true;
  }

  // ================= PAGED / SPREAD =================
  let pagedWrap = null;
  let renderSeq = 0;
  let zoom = { s: 1, x: 0, y: 0 };
  let pendingTurn = null;      // 'fwd' | 'back' | null — drives the slide-in animation

  const isWide = () => window.innerWidth > window.innerHeight;
  // The page(s) of the spread containing index i. Cover (and a trailing back
  // cover) stand alone; in portrait we fall back to a single page (iPad rotate).
  function spreadIndices(i) {
    if (mode !== 'spread' || !isWide()) return [i];
    if (coverAlone && i === 0) return [0];
    const base = coverAlone ? 1 : 0;
    const start = base + 2 * Math.floor((i - base) / 2);
    return start + 1 < total ? [start, start + 1] : [start];
  }

  async function renderPaged() {
    const token = ++renderSeq;
    const idx = spreadIndices(cur);
    cur = idx[0];                              // snap to the spread's lead page
    const ordered = (direction === 'rtl' && idx.length === 2) ? [...idx].reverse() : idx;
    const turn = pendingTurn; pendingTurn = null;
    // keep the old page on screen (spinner overlays it) until the new data is ready
    showSpinner();
    let urls;
    try { urls = await Promise.all(ordered.map(urlFor)); }
    catch (err) { if (token === renderSeq) showPageError(renderPaged); return; }
    if (token !== renderSeq) return;          // a newer page-turn superseded this one
    // direction-aware entrance: the new page slides in from the side we're heading to
    const fromRight = turn ? ((turn === 'fwd') === (direction === 'ltr')) : null;
    const anim = turn ? (fromRight ? ' turn-r' : ' turn-l') : ' turn-in';
    stage.innerHTML = `<div class="paged-wrap${ordered.length === 2 ? ' two' : ''}${anim}"></div>`;
    pagedWrap = stage.querySelector('.paged-wrap');
    resetZoom();
    pagedWrap.innerHTML = ordered.map((p, k) =>
      `<img class="page" alt="page ${p + 1}" src="${urls[k]}">`).join('');
    const imgs = [...pagedWrap.querySelectorAll('.page')];
    imgs.forEach(im => { im.onerror = () => { if (token === renderSeq) showPageError(renderPaged); }; });
    Promise.all(imgs.map(im => im.decode().catch(() => {}))).then(() => { if (token === renderSeq) hideSpinner(); });
    setPageNum();
    savePage();
    // preload neighbours, drop the rest
    const keep = new Set(idx);
    const fwd = idx[idx.length - 1];
    [fwd + 1, fwd + 2, idx[0] - 1].forEach(n => { if (n >= 0 && n < total) { keep.add(n); urlFor(n); } });
    revokeOutside(keep);
  }

  let zoomAnimTimer = 0;
  function applyZoom() {
    if (pagedWrap) pagedWrap.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`;
  }
  function applyZoomAnimated() {
    if (!pagedWrap) return;
    pagedWrap.style.transition = 'transform .22s var(--ease)';
    applyZoom();
    clearTimeout(zoomAnimTimer);
    zoomAnimTimer = setTimeout(() => { if (pagedWrap) pagedWrap.style.transition = ''; }, 240);
  }
  function resetZoom(animated) { zoom = { s: 1, x: 0, y: 0 }; animated ? applyZoomAnimated() : applyZoom(); }
  // In fit-width, a page taller than the screen is pannable vertically even at scale 1.
  function maxPanY() {
    const base = (zoom.s - 1) * stage.clientHeight;
    if (fit === 'width' && mode === 'paged' && pagedWrap) {
      const img = pagedWrap.querySelector('.page');
      if (img) return Math.max(base, img.getBoundingClientRect().height - stage.clientHeight);
    }
    return base;
  }
  function canPanVertically() { return zoom.s > 1 || maxPanY() > 0; }
  function clampPan() {
    const maxX = (zoom.s - 1) * stage.clientWidth;
    zoom.x = clamp(zoom.x, -maxX, 0);
    zoom.y = clamp(zoom.y, -maxPanY(), 0);
  }
  // zoom anchored on a screen point (double-tap / pinch share the same math)
  function zoomToPoint(clientX, clientY, ns = 2.6) {
    const r = stage.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const cx = (px - zoom.x) / zoom.s, cy = (py - zoom.y) / zoom.s;
    zoom.s = ns;
    zoom.x = px - ns * cx;
    zoom.y = py - ns * cy;
    clampPan();
    applyZoomAnimated();
  }
  function zoomToCenter(factor) {
    const ns = clamp(zoom.s * factor, 1, 6);
    if (ns <= 1.001) return resetZoom(true);
    const r = stage.getBoundingClientRect();
    zoomToPoint(r.left + stage.clientWidth / 2, r.top + stage.clientHeight / 2, ns);
  }

  // navigation — move spread-by-spread (variable step: cover is alone)
  const rightIsForward = () => direction === 'ltr';
  function advance() {
    const idx = spreadIndices(cur);
    const next = idx[idx.length - 1] + 1;
    if (next < total) { cur = next; pendingTurn = 'fwd'; renderPaged(); }
  }
  function retreat() {
    const first = spreadIndices(cur)[0];
    if (first > 0) { cur = spreadIndices(first - 1)[0]; pendingTurn = 'back'; renderPaged(); }
  }

  function jumpTo(i) {
    cur = clamp(i, 0, total - 1);
    if (mode === 'vertical') scrollToVPage(cur);
    else renderPaged();
  }

  // ---- pointer gestures (paged) ----
  const pointers = new Map();
  let pinch = null;       // {dist, s0, x0, y0, cx, cy}
  let single = null;      // {x0,y0,t0,tx0,ty0,moved}
  let hadPinch = false;   // suppress the stray tap when a pinch ends
  let lastTap = null;     // {t,x,y} — for double-tap detection
  let tapTimer = 0;       // deferred single-tap action (a 2nd tap can pre-empt it)

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function onDown(e) {
    if (mode === 'vertical') return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: dist(a, b), s0: zoom.s, x0: zoom.x, y0: zoom.y, ...mid(a, b) };
      single = null;
      hadPinch = true;
    } else if (pointers.size === 1) {
      single = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, tx0: zoom.x, ty0: zoom.y, moved: 0 };
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const ratio = dist(a, b) / (pinch.dist || 1);
      const ns = clamp(pinch.s0 * ratio, 1, 6);
      // keep the original pinch midpoint anchored
      const cx = (pinch.cx - pinch.x0) / pinch.s0;
      const cy = (pinch.cy - pinch.y0) / pinch.s0;
      zoom.s = ns;
      zoom.x = pinch.cx - ns * cx;
      zoom.y = pinch.cy - ns * cy;
      clampPan();
      applyZoom();
    } else if (single && pointers.size === 1) {
      const dx = e.clientX - single.x0, dy = e.clientY - single.y0;
      single.moved = Math.max(single.moved, Math.hypot(dx, dy));
      if (canPanVertically()) {   // pan (zoomed, or a tall page in fit-width)
        zoom.x = single.tx0 + dx;
        zoom.y = single.ty0 + dy;
        clampPan();
        applyZoom();
      }
    }
  }
  function onUp(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (zoom.s <= 1.02) resetZoom();
      // re-seed single from the remaining pointer
      if (pointers.size === 1) {
        const [r] = [...pointers.values()];
        single = { x0: r.x, y0: r.y, t0: e.timeStamp, tx0: zoom.x, ty0: zoom.y, moved: 0 };
      }
      return;
    }
    if (pointers.size > 0) return;
    if (hadPinch) { hadPinch = false; single = null; return; } // ended a pinch, not a tap
    if (!single) return;
    const dt = e.timeStamp - single.t0;
    const ex = p ? p.x : e.clientX, ey = p ? p.y : e.clientY;
    const dx = ex - single.x0, dy = ey - single.y0;
    const isTap = single.moved < 12 && dt < 300;

    if (isTap) {
      const now = e.timeStamp;
      const isDouble = lastTap && (now - lastTap.t) < 300 && Math.hypot(ex - lastTap.x, ey - lastTap.y) < 40;
      const frac = (ex - stage.getBoundingClientRect().left) / stage.clientWidth;
      const edge = frac <= 0.35 || frac >= 0.65;
      if (isDouble) {                                   // second quick tap on the same spot
        clearTimeout(tapTimer); tapTimer = 0; lastTap = null;
        if (zoom.s > 1) resetZoom(true);                // zoomed → snap back to fit
        else zoomToPoint(ex, ey);                       // zoom in toward the tapped point
        single = null; return;
      }
      if (zoom.s <= 1 && edge) {                        // page-turn zone — fire instantly (stays snappy)
        lastTap = null;
        if (frac >= 0.65) rightIsForward() ? advance() : retreat();
        else rightIsForward() ? retreat() : advance();
        single = null; return;
      }
      // centre tap (or any tap while zoomed) — defer so a double-tap can pre-empt it
      lastTap = { t: now, x: ex, y: ey };
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { lastTap = null; toggleChrome(); }, 250);
      single = null; return;
    }

    if (zoom.s > 1) { single = null; return; } // was panning, no nav
    // horizontal swipe turns the page (a vertical drag in fit-width just panned)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) rightIsForward() ? advance() : retreat();
      else rightIsForward() ? retreat() : advance();
    }
    single = null;
  }

  // ================= VERTICAL =================
  // Loading is driven by the scroll handler (a window around the current page),
  // not IntersectionObserver — simpler and dependable across browsers.
  let scrollRaf = 0;
  const guessH = () => Math.round(stage.clientWidth * 1.4);
  function renderVertical() {
    stage.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const d = document.createElement('div');
      d.className = 'vpage';
      d.dataset.index = String(i);
      d.style.minHeight = guessH() + 'px';
      frag.appendChild(d);
    }
    stage.appendChild(frag);
    stage.addEventListener('scroll', onScroll, { passive: true });
    scrollToVPage(cur);
    updateVertical();
  }
  function currentVPage() {
    const mid = stage.scrollTop + stage.clientHeight / 2;
    let best = cur, bestD = Infinity;
    for (const el of stage.children) {
      const c = el.offsetTop + el.offsetHeight / 2;
      const d = Math.abs(c - mid);
      if (d < bestD) { bestD = d; best = +el.dataset.index; }
    }
    return best;
  }
  async function loadVPage(i) {
    const el = stage.querySelector(`.vpage[data-index="${i}"]`);
    if (!el || el.dataset.loaded) return;
    el.dataset.loaded = '1';
    let url;
    try { url = await urlFor(i); }
    catch (err) { vPageError(el, i); return; }
    if (!el.dataset.loaded) return; // unloaded while awaiting
    const img = new Image();
    img.className = 'vimg';
    img.decoding = 'async';
    img.onload = () => { el.style.minHeight = ''; };
    img.onerror = () => vPageError(el, i);
    img.src = url;
    el.appendChild(img);
  }
  function vPageError(el, i) {
    delete el.dataset.loaded;
    el.innerHTML = `<div class="page-error vpage-error"><p>Page ${i + 1} couldn't load.</p><button class="btn retry-btn">Retry</button></div>`;
    el.querySelector('.retry-btn').addEventListener('click', () => { el.innerHTML = ''; loadVPage(i); });
  }
  function unloadVPage(el, i) {
    const h = el.offsetHeight || guessH(); // keep the slot height so scroll doesn't jump
    el.innerHTML = '';
    delete el.dataset.loaded;
    el.style.minHeight = h + 'px';
    const c = cache.get(i);
    if (c) { URL.revokeObjectURL(c.url); cache.delete(i); }
  }
  function updateVertical() {
    const c = currentVPage();
    const lo = Math.max(0, c - 3), hi = Math.min(total - 1, c + 3);
    for (let i = lo; i <= hi; i++) loadVPage(i);
    stage.querySelectorAll('.vpage[data-loaded]').forEach(el => {
      const i = +el.dataset.index;
      if (i < c - 6 || i > c + 6) unloadVPage(el, i);
    });
    if (c !== cur) { cur = c; savePage(); }
    setPageNum();
  }
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateVertical(); });
  }
  function scrollToVPage(i) {
    const el = stage.querySelector(`.vpage[data-index="${i}"]`);
    if (el) stage.scrollTop = el.offsetTop;
  }
  function teardownVertical() {
    stage.removeEventListener('scroll', onScroll);
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
  }

  // ================= mode switching =================
  function setMode(m) {
    if (m === mode) return;
    if (mode === 'vertical') teardownVertical();
    mode = m;
    root.dataset.mode = m;
    onUpdate({ mode: m });
    mountMode();
    reflectMenu();
    menu.hidden = true;
  }
  function setDirection(d) {
    if (d === direction) return;
    direction = d;
    root.dataset.dir = d;
    onUpdate({ direction: d });
    if (mode !== 'vertical') renderPaged();
    reflectMenu();
    menu.hidden = true;
  }
  function setCoverAlone(v) {
    if (v === coverAlone) return;
    coverAlone = v;
    onUpdate({ coverAlone: v });
    renderPaged();
    reflectMenu();
    menu.hidden = true;
  }
  function setFit(f) {
    if (f === fit) return;
    fit = f;
    root.dataset.fit = f;
    onUpdate({ fit: f });
    resetZoom();              // CSS reflows the page width; start tall pages at the top
    reflectMenu();
    menu.hidden = true;
  }
  let resizeRaf = 0;
  function onResize() {
    if (mode !== 'spread' || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; renderPaged(); });
  }
  function mountMode() {
    revokeOutside(new Set());
    if (mode === 'vertical') renderVertical();
    else renderPaged();
  }

  // ---- wiring ----
  root.querySelector('.back').addEventListener('click', () => { onUpdate({ lastPage: cur }); onExit(); });
  root.querySelector('.menu-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  menu.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  menu.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => setDirection(b.dataset.dir)));
  menu.querySelectorAll('[data-cover]').forEach(b => b.addEventListener('click', () => setCoverAlone(b.dataset.cover === 'solo')));
  menu.querySelectorAll('[data-fit]').forEach(b => b.addEventListener('click', () => setFit(b.dataset.fit)));
  menu.querySelectorAll('.comfort-slider').forEach(s => s.addEventListener('input', () => {
    comfort[s.dataset.comfort] = +s.value;
    localStorage.setItem('reader.' + s.dataset.comfort, String(s.value));
    applyComfort();
  }));
  slider.addEventListener('input', () => jumpTo(+slider.value - 1));
  window.addEventListener('resize', onResize);
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  // block Safari's native pinch so ours is the only zoom
  stage.addEventListener('gesturestart', e => e.preventDefault());

  function onKey(e) {
    if (e.key === 'ArrowRight') rightIsForward() ? advance() : retreat();
    else if (e.key === 'ArrowLeft') rightIsForward() ? retreat() : advance();
    else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); advance(); }
    else if (e.key === 'PageUp') retreat();
    else if (e.key === '+' || e.key === '=') zoomToCenter(1.35);
    else if (e.key === '-' || e.key === '_') zoomToCenter(1 / 1.35);
    else if (e.key === '0') resetZoom(true);
    else if (e.key === 'Home') jumpTo(0);
    else if (e.key === 'End') jumpTo(total - 1);
    else if (e.key === 'Escape') { onUpdate({ lastPage: cur }); onExit(); }
  }
  window.addEventListener('keydown', onKey);

  // one-time tap-zone hint on first ever open
  function maybeShowHint() {
    if (localStorage.getItem('reader.hintSeen')) return;
    tapHint.hidden = false;
    const dismiss = () => { tapHint.hidden = true; localStorage.setItem('reader.hintSeen', '1'); };
    setTimeout(() => { if (!tapHint.hidden) dismiss(); }, 2200);
    stage.addEventListener('pointerdown', dismiss, { once: true });
  }

  // ---- init ----
  root.dataset.mode = mode;
  root.dataset.dir = direction;
  root.dataset.fit = fit;
  reflectMenu();
  applyComfort();
  mountMode();
  maybeShowHint();
  // show controls briefly on open so they're discoverable, then auto-hide
  setTimeout(() => { if (menu.hidden) toggleChrome(false); }, 2600);

  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      teardownVertical();
      clearTimeout(saveTimer);
      clearTimeout(tapTimer);
      clearTimeout(spinTimer);
      clearTimeout(zoomAnimTimer);
      revokeOutside(new Set());
      backend.close();
      root.remove();
    },
  };
}
