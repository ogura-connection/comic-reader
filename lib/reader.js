// The reading surface. Two modes:
//   - paged:  one page (or two, in spread) fit to screen; pinch / double-tap to
//             zoom and pan; tap-zones / swipe / arrow keys to turn.
//   - vertical: continuous fit-width scroll (webtoon style), lazy-loaded.
// Reading direction (ltr / rtl) flips which side is "next". State (last page,
// mode, direction) is persisted via onUpdate.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createReader({ mount, backend, comic, onExit, onUpdate }) {
  const total = backend.pageCount;
  let mode = comic.mode || 'paged';        // 'paged' | 'vertical' | 'spread'
  let direction = comic.direction || 'ltr';
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
    <div class="chrome top">
      <button class="icon-btn back" aria-label="Back">‹ Library</button>
      <div class="title"></div>
      <button class="icon-btn menu-btn" aria-label="Settings">⚙</button>
    </div>
    <div class="chrome bottom">
      <input class="slider" type="range" min="1" max="${total}" step="1">
      <div class="page-num"></div>
    </div>
    <div class="menu" hidden>
      <div class="menu-row" data-group="mode">
        <span class="menu-label">Layout</span>
        <button data-mode="paged">Single</button>
        <button data-mode="spread">Double</button>
        <button data-mode="vertical">Scroll</button>
      </div>
      <div class="menu-row" data-group="dir">
        <span class="menu-label">Direction</span>
        <button data-dir="ltr">→ Western</button>
        <button data-dir="rtl">← Manga</button>
      </div>
    </div>`;
  mount.appendChild(root);

  const stage = root.querySelector('.stage');
  const slider = root.querySelector('.slider');
  const pageNum = root.querySelector('.page-num');
  const menu = root.querySelector('.menu');
  root.querySelector('.title').textContent = comic.title;

  function reflectMenu() {
    menu.querySelectorAll('[data-mode]').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === mode));
    menu.querySelectorAll('[data-dir]').forEach(b =>
      b.classList.toggle('on', b.dataset.dir === direction));
  }

  // ---- persistence (debounced for page position) ----
  let saveTimer = null;
  function savePage() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => onUpdate({ lastPage: cur }), 400);
  }
  function setPageNum() {
    pageNum.textContent = `${cur + 1} / ${total}`;
    slider.value = String(cur + 1);
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
  let zoom = { s: 1, x: 0, y: 0 };

  function pageStep() { return mode === 'spread' ? 2 : 1; }

  function indicesFor(i) {
    if (mode !== 'spread') return [i];
    // align spreads on even boundaries; show 2 unless last odd page
    const start = i - (i % 2);
    return start + 1 < total ? [start, start + 1] : [start];
  }

  async function renderPaged() {
    stage.innerHTML = '<div class="paged-wrap"></div>';
    pagedWrap = stage.querySelector('.paged-wrap');
    resetZoom();
    const idx = indicesFor(cur);
    const ordered = (mode === 'spread' && direction === 'rtl') ? [...idx].reverse() : idx;
    const urls = await Promise.all(ordered.map(urlFor));
    pagedWrap.innerHTML = ordered.map((p, k) =>
      `<img class="page" alt="page ${p + 1}" src="${urls[k]}">`).join('');
    setPageNum();
    savePage();
    // preload neighbours, drop the rest
    const keep = new Set(idx);
    const fwd = idx[idx.length - 1];
    [fwd + 1, fwd + 2, idx[0] - 1].forEach(n => { if (n >= 0 && n < total) { keep.add(n); urlFor(n); } });
    revokeOutside(keep);
  }

  function applyZoom() {
    if (pagedWrap) pagedWrap.style.transform = `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`;
  }
  function resetZoom() { zoom = { s: 1, x: 0, y: 0 }; applyZoom(); }
  function clampPan() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const maxX = (zoom.s - 1) * W, maxY = (zoom.s - 1) * H;
    zoom.x = clamp(zoom.x, -maxX, 0);
    zoom.y = clamp(zoom.y, -maxY, 0);
  }

  // navigation (index already in reading order)
  function go(deltaPages) {
    const next = clamp(cur + deltaPages, 0, total - 1);
    if (next === cur) return;
    cur = next;
    renderPaged();
  }
  const rightIsForward = () => direction === 'ltr';
  function advance() { go(pageStep()); }
  function retreat() { go(-pageStep()); }

  function jumpTo(i) {
    cur = clamp(i, 0, total - 1);
    if (mode === 'vertical') scrollToVPage(cur);
    else renderPaged();
  }

  // ---- pointer gestures (paged) ----
  const pointers = new Map();
  let pinch = null;       // {dist, s0, x0, y0, cx, cy}
  let single = null;      // {x0,y0,t0,tx0,ty0,moved}
  let lastTap = { t: 0, x: 0, y: 0 };

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
      if (zoom.s > 1) {            // pan
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
    if (!single || pointers.size > 0) return;
    const dt = e.timeStamp - single.t0;
    const dx = (p ? p.x : e.clientX) - single.x0;
    const dy = (p ? p.y : e.clientY) - single.y0;

    if (zoom.s > 1) { single = null; return; } // panning, no nav

    // swipe
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) rightIsForward() ? advance() : retreat();
      else rightIsForward() ? retreat() : advance();
      single = null; return;
    }
    // tap (small, quick)
    if (single.moved < 12 && dt < 300) {
      // double-tap zoom
      if (e.timeStamp - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        toggleDoubleZoom(e.clientX, e.clientY);
        lastTap.t = 0; single = null; return;
      }
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      const frac = (e.clientX - stage.getBoundingClientRect().left) / stage.clientWidth;
      if (frac > 0.35 && frac < 0.65) toggleChrome();
      else if (frac >= 0.65) rightIsForward() ? advance() : retreat();
      else rightIsForward() ? retreat() : advance();
    }
    single = null;
  }
  function toggleDoubleZoom(px, py) {
    const r = stage.getBoundingClientRect();
    const x = px - r.left, y = py - r.top;
    if (zoom.s > 1) { resetZoom(); }
    else {
      const ns = 2.5;
      zoom.s = ns; zoom.x = x - ns * x; zoom.y = y - ns * y;
      clampPan(); applyZoom();
    }
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
    const url = await urlFor(i);
    if (!el.dataset.loaded) return; // unloaded while awaiting
    const img = new Image();
    img.className = 'vimg';
    img.decoding = 'async';
    img.onload = () => { el.style.minHeight = ''; };
    img.src = url;
    el.appendChild(img);
  }
  function unloadVPage(el, i) {
    el.innerHTML = '';
    delete el.dataset.loaded;
    el.style.minHeight = guessH() + 'px';
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
  slider.addEventListener('input', () => jumpTo(+slider.value - 1));
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
    else if (e.key === 'Escape') { onUpdate({ lastPage: cur }); onExit(); }
  }
  window.addEventListener('keydown', onKey);

  // ---- init ----
  root.dataset.mode = mode;
  root.dataset.dir = direction;
  reflectMenu();
  mountMode();
  // show controls briefly on open so they're discoverable, then auto-hide
  setTimeout(() => { if (menu.hidden) toggleChrome(false); }, 2600);

  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      teardownVertical();
      clearTimeout(saveTimer);
      revokeOutside(new Set());
      backend.close();
      root.remove();
    },
  };
}
