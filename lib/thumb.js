// Downscale a page image blob into a small cover thumbnail for the library grid.
const MAX = 480; // longest edge, px

export async function makeThumb(pageBlob) {
  let bmp;
  try {
    bmp = await createImageBitmap(pageBlob);
  } catch (_) {
    return pageBlob; // decode failed — fall back to the full page as cover
  }
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
  canvas.width = canvas.height = 0;
  return blob || pageBlob;
}
