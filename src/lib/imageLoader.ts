/**
 * Turns an uploaded / pasted image into the ImageData the tracer works on.
 *
 * - Auto-crops away empty margins (plain background or transparency) so the artwork itself gets the
 *   full trace resolution. Logos sitting in a corner of a big page used to be traced at a fraction of
 *   the available pixels, which turned thin outlines into broken 1-2px lines.
 * - Scales the artwork so its longest side fills most of the trace budget, upscaling small images
 *   (smoothly) up to 3x so tiny logos trace with clean curves instead of pixel stair-steps.
 * - Centres it on a square canvas of the background colour, leaving room for perimeter background
 *   removal and for square / circle / rectangle frames drawn around the logo.
 */
export const TRACE_MAX_DIMENSION = 680;
const PAD = 24;
/** Share of the square trace canvas the artwork's longest side may fill (rest = room for frames) */
const ARTWORK_FILL = 0.74;

export interface PreparedTraceImage {
  imageData: ImageData;
  /** Region of the original image that was kept, in original pixels */
  crop: { x: number; y: number; w: number; h: number };
  /** Original px -> trace px scale */
  scale: number;
  wasCropped: boolean;
}

function dominantBorderColour(data: Uint8ClampedArray, w: number, h: number) {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number; a: number }>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const a = data[i + 3];
    const key = a < 90 ? -1 : ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, a: 0 };
    e.n++;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    e.a += a;
    buckets.set(key, e);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best = { n: 0, r: 255, g: 255, b: 255, a: 255 };
  let bestKey = 0;
  for (const [k, e] of buckets) {
    if (e.n > best.n) {
      best = e;
      bestKey = k;
    }
  }
  return {
    transparent: bestKey === -1,
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

/** Bounding box of everything that isn't background (ignores sparse JPEG noise). */
function contentBounds(data: Uint8ClampedArray, w: number, h: number, bg: ReturnType<typeof dominantBorderColour>) {
  const isContent = (i: number) => {
    const a = data[i + 3];
    if (bg.transparent) return a >= 90;
    if (a < 90) return false;
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    return dr * dr + dg * dg + db * db > 48 * 48;
  };
  const rowCount = new Int32Array(h);
  const colCount = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isContent((y * w + x) * 4)) {
        rowCount[y]++;
        colCount[x]++;
      }
    }
  }
  // A row/column counts as content only if it has a few real pixels (filters stray specks & scan dust)
  const minHits = 2;
  let x0 = 0;
  while (x0 < w && colCount[x0] < minHits) x0++;
  let x1 = w - 1;
  while (x1 > x0 && colCount[x1] < minHits) x1--;
  let y0 = 0;
  while (y0 < h && rowCount[y0] < minHits) y0++;
  let y1 = h - 1;
  while (y1 > y0 && rowCount[y1] < minHits) y1--;
  if (x0 >= x1 || y0 >= y1) return null;
  return { x0, y0, x1, y1 };
}

export function prepareTraceImageData(
  img: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  maxDimension: number = TRACE_MAX_DIMENSION
): PreparedTraceImage {
  const iw = img.width;
  const ih = img.height;

  // 1. Analyse at up to ~1600px (fast, but fine enough to find thin strokes)
  const aScale = Math.min(1, 1600 / Math.max(iw, ih));
  const aw = Math.max(1, Math.round(iw * aScale));
  const ah = Math.max(1, Math.round(ih * aScale));
  const ac = document.createElement('canvas');
  ac.width = aw;
  ac.height = ah;
  const actx = ac.getContext('2d', { willReadFrequently: true })!;
  actx.drawImage(img, 0, 0, aw, ah);
  const adata = actx.getImageData(0, 0, aw, ah).data;
  const bg = dominantBorderColour(adata, aw, ah);
  const b = contentBounds(adata, aw, ah, bg);

  let crop = { x: 0, y: 0, w: iw, h: ih };
  let wasCropped = false;
  if (b) {
    const margin = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.02) + 2;
    const cx0 = Math.max(0, b.x0 - margin);
    const cy0 = Math.max(0, b.y0 - margin);
    const cx1 = Math.min(aw - 1, b.x1 + margin);
    const cy1 = Math.min(ah - 1, b.y1 + margin);
    const keptArea = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (keptArea < aw * ah * 0.92) {
      crop = {
        x: Math.floor(cx0 / aScale),
        y: Math.floor(cy0 / aScale),
        w: Math.min(iw, Math.ceil((cx1 - cx0 + 1) / aScale)),
        h: Math.min(ih, Math.ceil((cy1 - cy0 + 1) / aScale)),
      };
      wasCropped = true;
    }
  }

  // 2. Scale the kept artwork to fill the trace budget (upscale small art up to 3x), centred on a
  //    square canvas with room around it: square / circle / rectangle frames are drawn in canvas pixels
  //    around the logo and get squashed smaller than the artwork if the canvas hugs it.
  const side = maxDimension;
  const maxInner = Math.round(side * ARTWORK_FILL) - PAD * 2;
  const scale = Math.min(3, maxInner / Math.max(crop.w, crop.h));
  const innerW = Math.max(32, Math.round(crop.w * scale));
  const innerH = Math.max(32, Math.round(crop.h * scale));
  const w = Math.max(side, innerW + PAD * 2);
  const h = Math.max(side, innerH + PAD * 2);
  const offX = Math.round((w - innerW) / 2);
  const offY = Math.round((h - innerH) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!bg.transparent) {
    ctx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, offX, offY, innerW, innerH);

  return { imageData: ctx.getImageData(0, 0, w, h), crop, scale, wasCropped };
}

/** Built-in sample artwork -> trace ImageData, prepared exactly like an uploaded image. */
export function renderSampleTraceImageData(sample: { renderToCanvas: (c: HTMLCanvasElement) => void }): ImageData {
  const canvas = document.createElement('canvas');
  sample.renderToCanvas(canvas);
  return prepareTraceImageData(canvas).imageData;
}
