// Downscale a page image into a small cover thumbnail AND pull a representative
// colour for the ambient gallery glow behind the tile.
const MAX = 480; // longest edge, px
const FALLBACK = 'rgb(74,68,70)';

export async function makeThumb(pageBlob) {
  let bmp;
  try { bmp = await createImageBitmap(pageBlob); }
  catch (_) { return { blob: pageBlob, color: FALLBACK }; }
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const color = dominantColor(ctx, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
  canvas.width = canvas.height = 0;
  return { blob: blob || pageBlob, color };
}

// Saturation-weighted average so colourful covers glow in their own hue and
// near-greyscale manga gives a soft neutral halo.
function dominantColor(ctx, w, h) {
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch (_) { return FALLBACK; }
  let r = 0, g = 0, b = 0, n = 0;
  const step = 4 * Math.max(1, Math.floor((w * h) / 4000));
  for (let i = 0; i < data.length; i += step) {
    const rr = data[i], gg = data[i + 1], bb = data[i + 2];
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const wt = 0.25 + sat;
    r += rr * wt; g += gg * wt; b += bb * wt; n += wt;
  }
  if (!n) return FALLBACK;
  return punch(r / n, g / n, b / n);
}

// lift saturation a touch and pin lightness to a glow-friendly mid range
function punch(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let s = 0, h = 0;
  if (d) {
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  s = Math.min(1, s * 1.45 + .12);
  const L = Math.min(.6, Math.max(.42, l * 0.9 + .12));
  const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = L - c / 2;
  let R = 0, G = 0, B = 0;
  if (h < 60) { R = c; G = x; } else if (h < 120) { R = x; G = c; } else if (h < 180) { G = c; B = x; }
  else if (h < 240) { G = x; B = c; } else if (h < 300) { R = x; B = c; } else { R = c; B = x; }
  const to = v => Math.round((v + m) * 255);
  return `rgb(${to(R)}, ${to(G)}, ${to(B)})`;
}
