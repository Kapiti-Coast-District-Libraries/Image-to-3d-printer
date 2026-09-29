import {
  TracedPolygon,
  traceBinaryMaskToPolygons,
  tracePlanarColorPartition,
} from './vectorTracer';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RemovedColorRule {
  id: string;
  rgb: RGB;
  hex: string;
  tolerance: number; // 1..80
  scope: 'global' | 'exterior_only';
  enabled: boolean;
}

export type MergeItemTargetMode = 'surrounding' | 'cutout' | number;

export interface MergedRegionRule {
  id: string;
  x: number; // Pixel X in sourceImageData (0 .. width-1)
  y: number; // Pixel Y in sourceImageData (0 .. height-1)
  targetMode: MergeItemTargetMode;
}

export interface ResolvedMergedRegion {
  id: string;
  x: number;
  y: number;
  targetMode: MergeItemTargetMode;
  sourceSlotIndex: number;
  resolvedTargetSlot: number; // 0..3 for an AMS slot, or -1 for cutout/background
  sourceHex: string;
  targetHex: string;
  pixelCount: number;
}

export interface DetectedImageSwatch {
  hex: string;
  rgb: RGB;
  percent: number;
  isBorder: boolean;
}

export interface ColorSlotConfig {
  id: number; // 0..3 (AMS Slot 1..4)
  name: string;
  detectedHex: string;
  printHex: string; // User can override filament preview/export colour
  lockedSourceHex?: string | null; // Optional locked colour centroid for quantization
  enabled: boolean; // If false, this colour slot is removed / knocked out from the print & trace
  mergedIntoSlot?: number | null; // Optional target slot index (0..3) to merge this slot into
  zHeightOffsetMm: number; // Extra height offset in stepped/relief mode
  pixelCount: number;
  coveragePercent: number;
}

export type BgRemovalMode = 'perimeter_flood' | 'global_color' | 'alpha_only' | 'none';

export type ExtrusionMode = 'backed_inlay' | 'full_flush' | 'stepped_relief';

export type StrokeProfileStyle = 'flush_top_and_base' | 'raised_rim_and_base' | 'stepped_base_only';

export type BoxLidStyle = 'flush_recessed' | 'raised_rim_recessed' | 'cap_with_plug';

export type BoxPlateLayout = 'assembled' | 'side_by_side';

export type BoxExportParts = 'both' | 'box_only' | 'lid_only';

export interface TraceParameters {
  numColors: 2 | 3 | 4;
  bgRemovalMode: BgRemovalMode;
  bgTolerance: number; // 0..100
  customBgColor: RGB | null;
  removedColors: RemovedColorRule[];
  mergedRegions?: MergedRegionRule[];
  despeckleLevel: number; // 0..3
  minIslandPx: number; // e.g. 20
  smoothEpsilon: number; // e.g. 1.0
  cornerSimplify: number; // e.g. 0.35
  fieldBlurPasses: number; // 0..2
  closeColorGaps: boolean; // Ensures 100% shared-edge planar lock & heals interior micro-cracks
  seamOverlapMm: number; // Optional outward kerf overlap (0.00 - 0.15 mm) for face-down slicer fusion
  strokeEnabled: boolean; // Adds a smooth offset stroke outline around the logo that also forms the 3D base
  strokeWidthMm: number; // Physical stroke outline width in millimeters (e.g. 2.5mm)
  strokeColorHex: string; // Chosen colour for the stroke outline and base
  strokeFillInnerGaps: boolean; // Fills enclosed interior holes inside the stroke silhouette for a solid badge base
  strokeProfileStyle: StrokeProfileStyle; // Flush with top surface + base, raised rim + base, or stepped base collar
  boxMode?: boolean; // Turns the stroke outline into a hollow 3D box and the traced image into its fitted lid
  boxHeightMm?: number; // Total Z height of the hollow box in millimeters (e.g. 28mm)
  boxLidStyle?: BoxLidStyle; // How the traced image lid seats into or onto the hollow stroke box
  boxLidToleranceMm?: number; // XY fit clearance between lid and box wall in millimeters (e.g. 0.20mm)
  boxLedgeWidthMm?: number; // Width of the internal support ledge inside the box wall in millimeters (e.g. 1.4mm)
  boxPlateLayout?: BoxPlateLayout; // 'assembled' (lid over box with lift) or 'side_by_side' (flat on Z=0 for printing)
  boxLidLiftMm?: number; // Vertical Z lift of the lid in 'assembled' preview mode (0..45mm)
  boxExportParts?: BoxExportParts; // 'both' | 'box_only' | 'lid_only'
  extrusionMode: ExtrusionMode;
  targetWidthMm: number; // e.g. 90mm
  baseThicknessMm: number; // e.g. 2.0mm
  inlayThicknessMm: number; // e.g. 0.8mm
  baseSlotIndex: number; // Which of the 4 colours acts as the full silhouette backing in 'backed_inlay'
}

export interface TracedColorLayer {
  slotIndex: number; // 0..3 for artwork slots, 4 for dedicated Stroke / Box slot
  name: string;
  detectedHex: string;
  printHex: string;
  enabled: boolean;
  mergedIntoSlot?: number | null;
  mergedFromSlots?: number[];
  isStrokeAndBase?: boolean;
  pixelCount: number;
  rawPixelCount?: number;
  coveragePercent: number;
  polygons: TracedPolygon[];
}

export interface MultiColorTraceResult {
  width: number;
  height: number;
  quantizedImageData: ImageData;
  foregroundMask: Uint8Array;
  silhouettePolygons: TracedPolygon[];
  lidSilhouettePolygons: TracedPolygon[];
  lidInnerFillPolygons: TracedPolygon[];
  boxUpperWallPolygons: TracedPolygon[];
  boxLedgeWallPolygons: TracedPolygon[];
  boxInnerPlugPolygons: TracedPolygon[];
  layers: TracedColorLayer[];
  detectedBgHex: string;
  resolvedMergedRegions: ResolvedMergedRegion[];
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 0,
      g: parseInt(clean[1] + clean[1], 16) || 0,
      b: parseInt(clean[2] + clean[2], 16) || 0,
    };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

/**
 * Perceptual "redmean" weighted colour distance squared (0 .. ~585,000).
 */
export function colorDistSq(c1: RGB, c2: RGB): number {
  const rmean = (c1.r + c2.r) * 0.5;
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return (
    (2 + rmean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rmean) / 256) * db * db
  );
}

/**
 * Extracts up to `maxSwatches` distinct dominant colours from the source image
 * so the user can click any colour swatch to remove or restore it from the print/trace.
 */
export function extractDominantImageSwatches(
  imageData: ImageData,
  maxSwatches: number = 7
): DetectedImageSwatch[] {
  const { width, height, data } = imageData;
  const total = width * height;
  const buckets = new Map<
    string,
    { count: number; borderCount: number; sumR: number; sumG: number; sumB: number }
  >();

  const step = Math.max(1, Math.floor(total / 16000));
  let validSampled = 0;

  for (let i = 0; i < total; i += step) {
    const pIdx = i * 4;
    if (data[pIdx + 3] < 90) continue;
    validSampled++;

    const r = data[pIdx];
    const g = data[pIdx + 1];
    const b = data[pIdx + 2];

    const x = i % width;
    const y = (i - x) / width;
    const isBorder = x < 3 || x >= width - 3 || y < 3 || y >= height - 3;

    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
      if (isBorder) entry.borderCount++;
      entry.sumR += r;
      entry.sumG += g;
      entry.sumB += b;
    } else {
      buckets.set(key, {
        count: 1,
        borderCount: isBorder ? 1 : 0,
        sumR: r,
        sumG: g,
        sumB: b,
      });
    }
  }

  if (validSampled === 0) return [];

  const sorted = Array.from(buckets.values())
    .map((b) => {
      const rgb: RGB = {
        r: Math.round(b.sumR / b.count),
        g: Math.round(b.sumG / b.count),
        b: Math.round(b.sumB / b.count),
      };
      return {
        rgb,
        hex: rgbToHex(rgb),
        count: b.count,
        isBorder: b.borderCount > Math.max(2, b.count * 0.08),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Merge perceptually similar swatches so the user gets clean, distinct colour chips
  const merged: { rgb: RGB; hex: string; count: number; isBorder: boolean }[] = [];
  for (const item of sorted) {
    let foundSimilar = false;
    for (const m of merged) {
      if (colorDistSq(item.rgb, m.rgb) < 9500) {
        m.count += item.count;
        m.isBorder = m.isBorder || item.isBorder;
        foundSimilar = true;
        break;
      }
    }
    if (!foundSimilar) {
      merged.push({ ...item });
    }
  }

  return merged
    .sort((a, b) => {
      if (a.isBorder !== b.isBorder) return a.isBorder ? -1 : 1;
      return b.count - a.count;
    })
    .slice(0, maxSwatches)
    .map((m) => ({
      hex: m.hex,
      rgb: m.rgb,
      percent: Math.round((m.count / validSampled) * 1000) / 10,
      isBorder: m.isBorder,
    }));
}

/**
 * Estimate dominant background color from image border pixels.
 */
export function detectBorderBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number
): RGB {
  const samples: RGB[] = [];
  const addPixel = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] >= 128) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  };

  const stepX = Math.max(1, Math.floor(width / 24));
  const stepY = Math.max(1, Math.floor(height / 24));

  for (let x = 0; x < width; x += stepX) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  const buckets = new Map<string, { count: number; sumR: number; sumG: number; sumB: number }>();
  for (const s of samples) {
    const key = `${s.r >> 4},${s.g >> 4},${s.b >> 4}`;
    const b = buckets.get(key) || { count: 0, sumR: 0, sumG: 0, sumB: 0 };
    b.count++;
    b.sumR += s.r;
    b.sumG += s.g;
    b.sumB += s.b;
    buckets.set(key, b);
  }

  let best = { count: 0, sumR: 255, sumG: 255, sumB: 255 };
  for (const b of buckets.values()) {
    if (b.count > best.count) best = b;
  }

  return {
    r: Math.round(best.sumR / best.count),
    g: Math.round(best.sumG / best.count),
    b: Math.round(best.sumB / best.count),
  };
}

/**
 * Extracts foreground mask (1 = keep in print/trace, 0 = removed colour / background).
 * Supports both automatic border background removal and any number of user-chosen RemovedColorRules.
 */
function computeForegroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: BgRemovalMode,
  tolerance: number,
  customBg: RGB | null,
  removedColors: RemovedColorRule[]
): { fgMask: Uint8Array; bgRgb: RGB } {
  const total = width * height;
  const fgMask = new Uint8Array(total);
  fgMask.fill(1);

  const bgRgb = customBg || detectBorderBackgroundColor(data, width, height);

  // 1. Remove transparent pixels in all modes except 'none'
  let transparentCount = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] < 90) {
      if (mode !== 'none') fgMask[i] = 0;
      transparentCount++;
    }
  }

  // Helper to flood-fill remove a colour from the exterior border
  const applyFloodRemoval = (targetRgb: RGB, tol: number) => {
    const maxDistSq = (tol / 100) * (tol / 100) * 260000;
    const isMatch = (idx: number): boolean => {
      if (fgMask[idx] === 0) return true;
      const pIdx = idx * 4;
      if (data[pIdx + 3] < 90) return true;
      return (
        colorDistSq({ r: data[pIdx], g: data[pIdx + 1], b: data[pIdx + 2] }, targetRgb) <=
        maxDistSq
      );
    };

    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    const pushIfBg = (x: number, y: number) => {
      const idx = y * width + x;
      if (!visited[idx] && isMatch(idx)) {
        visited[idx] = 1;
        fgMask[idx] = 0;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < width; x++) {
      pushIfBg(x, 0);
      pushIfBg(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      pushIfBg(0, y);
      pushIfBg(width - 1, y);
    }

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;

      if (cx > 0) pushIfBg(cx - 1, cy);
      if (cx < width - 1) pushIfBg(cx + 1, cy);
      if (cy > 0) pushIfBg(cx, cy - 1);
      if (cy < height - 1) pushIfBg(cx, cy + 1);
    }
  };

  // Helper to globally knock out a colour across the entire image (including interior holes)
  const applyGlobalRemoval = (targetRgb: RGB, tol: number) => {
    const maxDistSq = (tol / 100) * (tol / 100) * 260000;
    for (let i = 0; i < total; i++) {
      if (fgMask[i] === 0) continue;
      const pIdx = i * 4;
      if (data[pIdx + 3] < 90) {
        fgMask[i] = 0;
        continue;
      }
      const dist = colorDistSq(
        { r: data[pIdx], g: data[pIdx + 1], b: data[pIdx + 2] },
        targetRgb
      );
      if (dist <= maxDistSq) {
        fgMask[i] = 0;
      }
    }
  };

  // 2. Apply primary background removal mode
  if (mode === 'global_color') {
    applyGlobalRemoval(bgRgb, tolerance);
  } else if (mode === 'perimeter_flood') {
    applyFloodRemoval(bgRgb, tolerance);
    if (transparentCount > total * 0.05) {
      for (let i = 0; i < total; i++) {
        if (data[i * 4 + 3] < 90) fgMask[i] = 0;
      }
    }
  }

  // 3. Apply all user-selected RemovedColorRules (chosen colours to strip from print/trace)
  for (const rule of removedColors) {
    if (!rule.enabled) continue;
    if (rule.scope === 'exterior_only') {
      applyFloodRemoval(rule.rgb, rule.tolerance);
    } else {
      applyGlobalRemoval(rule.rgb, rule.tolerance);
    }
  }

  return { fgMask, bgRgb };
}

/**
 * Edge-preserving smoothing filter to flatten gradients, shading, and JPEG noise prior to 4-color clustering.
 */
function flattenGradientsBilateral(
  data: Uint8ClampedArray,
  fgMask: Uint8Array,
  width: number,
  height: number,
  passes: number
): Uint8ClampedArray {
  if (passes <= 0) return new Uint8ClampedArray(data);

  let src = new Uint8ClampedArray(data);
  let dst = new Uint8ClampedArray(data);

  const rangeSigmaSq = 2800;

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!fgMask[idx]) continue;

        const pIdx = idx * 4;
        const r0 = src[pIdx];
        const g0 = src[pIdx + 1];
        const b0 = src[pIdx + 2];

        let sumR = r0 * 2;
        let sumG = g0 * 2;
        let sumB = b0 * 2;
        let weightSum = 2;

        const yMin = Math.max(0, y - 2);
        const yMax = Math.min(height - 1, y + 2);
        const xMin = Math.max(0, x - 2);
        const xMax = Math.min(width - 1, x + 2);

        for (let ny = yMin; ny <= yMax; ny++) {
          for (let nx = xMin; nx <= xMax; nx++) {
            const nIdx = ny * width + nx;
            if (!fgMask[nIdx] || nIdx === idx) continue;

            const npIdx = nIdx * 4;
            const nr = src[npIdx];
            const ng = src[npIdx + 1];
            const nb = src[npIdx + 2];

            const dr = nr - r0;
            const dg = ng - g0;
            const db = nb - b0;
            const dSq = dr * dr + dg * dg + db * db;

            if (dSq < rangeSigmaSq) {
              const w = 1.0 - dSq / rangeSigmaSq;
              sumR += nr * w;
              sumG += ng * w;
              sumB += nb * w;
              weightSum += w;
            }
          }
        }

        dst[pIdx] = Math.round(sumR / weightSum);
        dst[pIdx + 1] = Math.round(sumG / weightSum);
        dst[pIdx + 2] = Math.round(sumB / weightSum);
        dst[pIdx + 3] = 255;
      }
    }
    src.set(dst);
  }

  return src;
}

/**
 * Deterministic K-Means++ colour quantization strictly limited to k (<= 4) colours.
 */
function quantizeForegroundKMeans(
  smoothedData: Uint8ClampedArray,
  fgMask: Uint8Array,
  width: number,
  height: number,
  k: number,
  lockedCentroids: (RGB | null)[]
): { centroids: RGB[]; labels: Int8Array } {
  const total = width * height;

  const interiorIndices: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (
        fgMask[idx] &&
        fgMask[idx - 1] &&
        fgMask[idx + 1] &&
        fgMask[idx - width] &&
        fgMask[idx + width]
      ) {
        interiorIndices.push(idx);
      }
    }
  }

  const sampleSource = interiorIndices.length > 50 ? interiorIndices : [];
  if (sampleSource.length === 0) {
    for (let i = 0; i < total; i++) {
      if (fgMask[i]) sampleSource.push(i);
    }
  }

  if (sampleSource.length === 0) {
    return {
      centroids: Array.from({ length: k }, () => ({ r: 200, g: 200, b: 200 })),
      labels: new Int8Array(total).fill(-1),
    };
  }

  const stride = Math.max(1, Math.floor(sampleSource.length / 4000));
  const samples: RGB[] = [];
  for (let i = 0; i < sampleSource.length; i += stride) {
    const pIdx = sampleSource[i] * 4;
    samples.push({
      r: smoothedData[pIdx],
      g: smoothedData[pIdx + 1],
      b: smoothedData[pIdx + 2],
    });
  }

  const centroids: RGB[] = [];
  const isLocked: boolean[] = [];

  for (let c = 0; c < k; c++) {
    if (lockedCentroids[c]) {
      centroids.push({ ...lockedCentroids[c]! });
      isLocked.push(true);
    } else {
      isLocked.push(false);
    }
  }

  if (centroids.length === 0) {
    const freq = new Map<string, { count: number; rgb: RGB }>();
    for (const s of samples) {
      const key = `${s.r >> 3},${s.g >> 3},${s.b >> 3}`;
      const entry = freq.get(key);
      if (entry) {
        entry.count++;
      } else {
        freq.set(key, { count: 1, rgb: s });
      }
    }
    let best = samples[0];
    let maxCount = -1;
    for (const entry of freq.values()) {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        best = entry.rgb;
      }
    }
    centroids.push({ ...best });
  }

  while (centroids.length < k) {
    let bestCandidate = samples[0];
    let maxScore = -1;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let minDist = Infinity;
      for (const c of centroids) {
        const d = colorDistSq(s, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxScore) {
        maxScore = minDist;
        bestCandidate = s;
      }
    }
    centroids.push({ ...bestCandidate });
  }

  const finalCentroids: RGB[] = new Array(k);
  let unlockedCursor = 0;
  const unlockedSeeds = centroids.slice(lockedCentroids.filter(Boolean).length);
  for (let c = 0; c < k; c++) {
    if (lockedCentroids[c]) {
      finalCentroids[c] = { ...lockedCentroids[c]! };
    } else {
      finalCentroids[c] = unlockedSeeds[unlockedCursor++] || { r: 128, g: 128, b: 128 };
    }
  }

  const sumsR = new Float64Array(k);
  const sumsG = new Float64Array(k);
  const sumsB = new Float64Array(k);
  const counts = new Int32Array(k);

  for (let iter = 0; iter < 14; iter++) {
    sumsR.fill(0);
    sumsG.fill(0);
    sumsB.fill(0);
    counts.fill(0);

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let bestCluster = 0;
      let minDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = colorDistSq(s, finalCentroids[c]);
        if (d < minDist) {
          minDist = d;
          bestCluster = c;
        }
      }
      sumsR[bestCluster] += s.r;
      sumsG[bestCluster] += s.g;
      sumsB[bestCluster] += s.b;
      counts[bestCluster]++;
    }

    let moved = false;
    for (let c = 0; c < k; c++) {
      if (isLocked[c] || counts[c] === 0) continue;
      const nr = Math.round(sumsR[c] / counts[c]);
      const ng = Math.round(sumsG[c] / counts[c]);
      const nb = Math.round(sumsB[c] / counts[c]);
      if (nr !== finalCentroids[c].r || ng !== finalCentroids[c].g || nb !== finalCentroids[c].b) {
        finalCentroids[c] = { r: nr, g: ng, b: nb };
        moved = true;
      }
    }
    if (!moved) break;
  }

  const unlockedEntries: RGB[] = [];
  for (let c = 0; c < k; c++) {
    if (!isLocked[c]) {
      unlockedEntries.push(finalCentroids[c]);
    }
  }
  unlockedEntries.sort((a, b) => {
    const lumA = 0.299 * a.r + 0.587 * a.g + 0.114 * a.b;
    const lumB = 0.299 * b.r + 0.587 * b.g + 0.114 * b.b;
    return lumA - lumB;
  });
  let uIdx = 0;
  for (let c = 0; c < k; c++) {
    if (!isLocked[c]) {
      finalCentroids[c] = unlockedEntries[uIdx++];
    }
  }

  const labels = new Int8Array(total).fill(-1);
  const isInterior = new Uint8Array(total);
  for (const idx of interiorIndices) {
    isInterior[idx] = 1;
  }

  for (let i = 0; i < total; i++) {
    if (!fgMask[i]) continue;
    const pIdx = i * 4;
    const px: RGB = {
      r: smoothedData[pIdx],
      g: smoothedData[pIdx + 1],
      b: smoothedData[pIdx + 2],
    };
    let bestC = 0;
    let minD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = colorDistSq(px, finalCentroids[c]);
      if (d < minD) {
        minD = d;
        bestC = c;
      }
    }
    labels[i] = bestC;
  }

  if (interiorIndices.length > 50) {
    const cleanedLabels = new Int8Array(labels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!fgMask[idx] || isInterior[idx]) continue;

        let bestDist = 999;
        let bestLabel = labels[idx];
        for (let dy = -2; dy <= 2; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (isInterior[nIdx]) {
              const d = dx * dx + dy * dy;
              if (d < bestDist) {
                bestDist = d;
                bestLabel = labels[nIdx];
              }
            }
          }
        }
        cleanedLabels[idx] = bestLabel;
      }
    }
    labels.set(cleanedLabels);
  }

  return { centroids: finalCentroids, labels };
}

/**
 * Absorbs tiny isolated pixel speckles (< minIslandPx) into their surrounding foreground colour.
 */
function absorbSmallIslands(
  labels: Int8Array,
  width: number,
  height: number,
  minIslandPx: number
): void {
  if (minIslandPx <= 1) return;

  const total = width * height;
  const visited = new Uint8Array(total);
  const compIndices = new Int32Array(total);
  const neighborCounts = new Int32Array(8);

  for (let i = 0; i < total; i++) {
    const targetLabel = labels[i];
    if (targetLabel < 0 || visited[i]) continue;

    let head = 0;
    let tail = 0;
    visited[i] = 1;
    compIndices[tail++] = i;
    neighborCounts.fill(0);

    while (head < tail) {
      const curr = compIndices[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;

      const checkNeighbor = (nx: number, ny: number) => {
        const nIdx = ny * width + nx;
        const nLabel = labels[nIdx];
        if (nLabel === targetLabel) {
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            compIndices[tail++] = nIdx;
          }
        } else if (nLabel >= 0 && nLabel < 8) {
          neighborCounts[nLabel]++;
        }
      };

      if (cx > 0) checkNeighbor(cx - 1, cy);
      if (cx < width - 1) checkNeighbor(cx + 1, cy);
      if (cy > 0) checkNeighbor(cx, cy - 1);
      if (cy < height - 1) checkNeighbor(cx, cy + 1);
    }

    if (tail < minIslandPx) {
      let bestNeighborLabel = -1;
      let maxBorder = 0;
      for (let c = 0; c < 8; c++) {
        if (neighborCounts[c] > maxBorder) {
          maxBorder = neighborCounts[c];
          bestNeighborLabel = c;
        }
      }
      if (bestNeighborLabel >= 0) {
        for (let j = 0; j < tail; j++) {
          labels[compIndices[j]] = bestNeighborLabel;
        }
      }
    }
  }
}

/**
 * Heals unassigned interior cracks, anti-aliased transition gaps, and small pinholes inside
 * the outer silhouette so adjacent colours meet seamlessly with zero internal gaps.
 */
function healInteriorBackgroundGaps(
  fgMask: Uint8Array,
  width: number,
  height: number,
  maxHoleAreaPx: number
): void {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);

  // 1. Mark all exterior background pixels connected to the canvas border
  let head = 0;
  let tail = 0;
  const pushBorderBg = (idx: number) => {
    if (!fgMask[idx] && !visited[idx]) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    pushBorderBg(x);
    pushBorderBg((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushBorderBg(y * width);
    pushBorderBg(y * width + (width - 1));
  }

  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = (curr - cx) / width;

    if (cx > 0) pushBorderBg(curr - 1);
    if (cx < width - 1) pushBorderBg(curr + 1);
    if (cy > 0) pushBorderBg(curr - width);
    if (cy < height - 1) pushBorderBg(curr + width);
  }

  // 2. Inspect any interior (enclosed) fgMask === 0 component; heal if <= maxHoleAreaPx
  const compIndices = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    if (fgMask[i] || visited[i]) continue;

    let cHead = 0;
    let cTail = 0;
    visited[i] = 1;
    compIndices[cTail++] = i;

    while (cHead < cTail) {
      const curr = compIndices[cHead++];
      const cx = curr % width;
      const cy = (curr - cx) / width;

      const check = (nIdx: number) => {
        if (!fgMask[nIdx] && !visited[nIdx]) {
          visited[nIdx] = 1;
          compIndices[cTail++] = nIdx;
        }
      };

      if (cx > 0) check(curr - 1);
      if (cx < width - 1) check(curr + 1);
      if (cy > 0) check(curr - width);
      if (cy < height - 1) check(curr + width);
    }

    if (cTail <= maxHoleAreaPx) {
      for (let j = 0; j < cTail; j++) {
        fgMask[compIndices[j]] = 1;
      }
    }
  }
}

/**
 * Exact 2D Euclidean Distance Transform squared (Meijster / Felzenszwalb 2-pass separable algorithm).
 * Computes for every pixel the squared Euclidean distance (in px^2) to the nearest pixel where mask[i] === 1.
 */
function computeEuclideanDistanceSq(
  mask: Uint8Array,
  width: number,
  height: number
): Float32Array {
  const INF = 1e9;
  const total = width * height;
  const g = new Float32Array(total);
  const distSq = new Float32Array(total);

  // Pass 1: Vertical 1D distance transform along each column x
  for (let x = 0; x < width; x++) {
    let d = INF;
    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      if (mask[idx]) d = 0;
      else d += 1;
      g[idx] = d * d;
    }
    d = INF;
    for (let y = height - 1; y >= 0; y--) {
      const idx = y * width + x;
      if (mask[idx]) d = 0;
      else d += 1;
      const d2 = d * d;
      if (d2 < g[idx]) g[idx] = d2;
    }
  }

  // Pass 2: Horizontal 1D lower envelope along each row y
  const v = new Int32Array(width);
  const z = new Float32Array(width + 1);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for (let q = 1; q < width; q++) {
      const fq = g[rowOffset + q] + q * q;
      let s = 0;
      while (k >= 0) {
        const vk = v[k];
        s = (fq - (g[rowOffset + vk] + vk * vk)) / (2 * q - 2 * vk);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    k = 0;
    for (let q = 0; q < width; q++) {
      while (z[k + 1] < q) k++;
      const dx = q - v[k];
      distSq[rowOffset + q] = dx * dx + g[rowOffset + v[k]];
    }
  }

  return distSq;
}

/**
 * Absorbs user-clicked individual details/items into their surrounding colour (or an explicit slot / cutout)
 * prior to planar vector tracing so unwanted details seamlessly vanish into their surrounding surface.
 */
function applyManualMergedRegions(
  activeLabels: Int8Array,
  activeFgMask: Uint8Array,
  width: number,
  height: number,
  numColors: number,
  minIslandPx: number,
  mergedRegions: MergedRegionRule[] | undefined,
  resolveTargetSlot: (slotIdx: number) => number,
  getSlotDisplayHex: (slotIdx: number) => string
): ResolvedMergedRegion[] {
  const resolvedList: ResolvedMergedRegion[] = [];
  if (!mergedRegions || mergedRegions.length === 0) return resolvedList;

  const total = width * height;
  let totalFgBefore = 0;
  for (let i = 0; i < total; i++) {
    if (activeLabels[i] >= 0) totalFgBefore++;
  }

  const inComponent = new Uint8Array(total);
  const compIndices = new Int32Array(total);
  const exteriorToComp = new Uint8Array(total);
  const extQueue = new Int32Array(total);
  const shellDist = new Uint8Array(total);
  const shellQueue = new Int32Array(total);
  const dist1Counts = new Int32Array(8);
  const shellCounts = new Int32Array(8);

  for (const rule of mergedRegions) {
    const rx = Math.max(0, Math.min(width - 1, Math.round(rule.x)));
    const ry = Math.max(0, Math.min(height - 1, Math.round(rule.y)));
    let seedIdx = ry * width + rx;

    // If clicked pixel is slightly on a 1px crack/background, search within 5px radius for nearest foreground pixel
    if (activeLabels[seedIdx] < 0) {
      let bestDistSq = 999;
      let foundIdx = -1;
      for (let dy = -5; dy <= 5; dy++) {
        const ny = ry + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -5; dx <= 5; dx++) {
          const nx = rx + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (activeLabels[nIdx] >= 0) {
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDistSq) {
              bestDistSq = d2;
              foundIdx = nIdx;
            }
          }
        }
      }
      if (foundIdx < 0) continue;
      seedIdx = foundIdx;
    }

    const sourceSlotIndex = activeLabels[seedIdx];
    if (sourceSlotIndex < 0) continue;

    // 1. Flood-fill the 4-connected component of `sourceSlotIndex` starting from `seedIdx`
    inComponent.fill(0);
    let cHead = 0;
    let cTail = 0;
    inComponent[seedIdx] = 1;
    compIndices[cTail++] = seedIdx;

    while (cHead < cTail) {
      const curr = compIndices[cHead++];
      const cx = curr % width;
      const cy = (curr - cx) / width;

      if (cx > 0) {
        const n = curr - 1;
        if (!inComponent[n] && activeLabels[n] === sourceSlotIndex) {
          inComponent[n] = 1;
          compIndices[cTail++] = n;
        }
      }
      if (cx < width - 1) {
        const n = curr + 1;
        if (!inComponent[n] && activeLabels[n] === sourceSlotIndex) {
          inComponent[n] = 1;
          compIndices[cTail++] = n;
        }
      }
      if (cy > 0) {
        const n = curr - width;
        if (!inComponent[n] && activeLabels[n] === sourceSlotIndex) {
          inComponent[n] = 1;
          compIndices[cTail++] = n;
        }
      }
      if (cy < height - 1) {
        const n = curr + width;
        if (!inComponent[n] && activeLabels[n] === sourceSlotIndex) {
          inComponent[n] = 1;
          compIndices[cTail++] = n;
        }
      }
    }

    // 2. Identify exterior vs any tiny sub-islands strictly enclosed inside `inComponent`
    exteriorToComp.fill(0);
    if (cTail < total * 0.65) {
      let eHead = 0;
      let eTail = 0;
      const pushExt = (idx: number) => {
        if (!inComponent[idx] && !exteriorToComp[idx]) {
          exteriorToComp[idx] = 1;
          extQueue[eTail++] = idx;
        }
      };

      for (let x = 0; x < width; x++) {
        pushExt(x);
        pushExt((height - 1) * width + x);
      }
      for (let y = 0; y < height; y++) {
        pushExt(y * width);
        pushExt(y * width + (width - 1));
      }

      while (eHead < eTail) {
        const curr = extQueue[eHead++];
        const cx = curr % width;
        const cy = (curr - cx) / width;
        if (cx > 0) pushExt(curr - 1);
        if (cx < width - 1) pushExt(curr + 1);
        if (cy > 0) pushExt(curr - width);
        if (cy < height - 1) pushExt(curr + width);
      }

      // Count pixels strictly enclosed inside `inComponent` (e.g. an eye highlight glint inside a dark pupil)
      let enclosedCount = 0;
      for (let i = 0; i < total; i++) {
        if (!inComponent[i] && !exteriorToComp[i]) {
          enclosedCount++;
        }
      }
      if (enclosedCount > 0 && enclosedCount < cTail) {
        for (let i = 0; i < total; i++) {
          if (!inComponent[i] && !exteriorToComp[i]) {
            inComponent[i] = 1;
            compIndices[cTail++] = i;
          }
        }
      } else if (enclosedCount >= cTail) {
        // If `inComponent` was a thin outer ring enclosing a larger interior, treat non-component pixels as exterior
        for (let i = 0; i < total; i++) {
          if (!inComponent[i]) exteriorToComp[i] = 1;
        }
      }
    } else {
      for (let i = 0; i < total; i++) {
        if (!inComponent[i]) exteriorToComp[i] = 1;
      }
    }

    // 3. Determine target slot (surrounding colour, cutout, or explicit slot)
    let resolvedTargetSlot = sourceSlotIndex;

    if (rule.targetMode === 'cutout') {
      resolvedTargetSlot = -1;
    } else if (typeof rule.targetMode === 'number') {
      resolvedTargetSlot = resolveTargetSlot(
        Math.max(0, Math.min(numColors - 1, rule.targetMode))
      );
    } else {
      // 'surrounding': sample a 1..3px outward shell around `inComponent` so true surrounding colour beats any 1px anti-aliased halo
      shellDist.fill(0);
      dist1Counts.fill(0);
      shellCounts.fill(0);
      let sHead = 0;
      let sTail = 0;

      for (let j = 0; j < cTail; j++) {
        const curr = compIndices[j];
        const cx = curr % width;
        const cy = (curr - cx) / width;

        const addDist1 = (nIdx: number) => {
          if (!inComponent[nIdx] && exteriorToComp[nIdx] && shellDist[nIdx] === 0) {
            shellDist[nIdx] = 1;
            shellQueue[sTail++] = nIdx;
            const nLbl = activeLabels[nIdx];
            if (nLbl >= 0 && nLbl < numColors && nLbl !== sourceSlotIndex) {
              dist1Counts[nLbl]++;
            }
          }
        };

        if (cx > 0) addDist1(curr - 1);
        if (cx < width - 1) addDist1(curr + 1);
        if (cy > 0) addDist1(curr - width);
        if (cy < height - 1) addDist1(curr + width);
      }

      while (sHead < sTail) {
        const curr = shellQueue[sHead++];
        const d = shellDist[curr];
        if (d >= 3) continue;
        const cx = curr % width;
        const cy = (curr - cx) / width;

        const addNextShell = (nIdx: number) => {
          if (!inComponent[nIdx] && exteriorToComp[nIdx] && shellDist[nIdx] === 0) {
            shellDist[nIdx] = d + 1;
            shellQueue[sTail++] = nIdx;
            const nLbl = activeLabels[nIdx];
            if (nLbl >= 0 && nLbl < numColors && nLbl !== sourceSlotIndex) {
              shellCounts[nLbl]++;
            }
          }
        };

        if (cx > 0) addNextShell(curr - 1);
        if (cx < width - 1) addNextShell(curr + 1);
        if (cy > 0) addNextShell(curr - width);
        if (cy < height - 1) addNextShell(curr + width);
      }

      let bestSlot = -1;
      let bestScore = 0;
      for (let c = 0; c < numColors; c++) {
        if (c === sourceSlotIndex) continue;
        const score = dist1Counts[c] + shellCounts[c] * 1.5;
        if (score > bestScore) {
          bestScore = score;
          bestSlot = c;
        }
      }

      if (bestSlot >= 0) {
        resolvedTargetSlot = bestSlot;
      } else if (cTail < totalFgBefore * 0.25) {
        // Isolated floating island surrounded only by background -> merge into background (-1)
        resolvedTargetSlot = -1;
      } else {
        resolvedTargetSlot = sourceSlotIndex;
      }

      // 4. Apply target slot to all pixels in `compIndices`
      for (let j = 0; j < cTail; j++) {
        const idx = compIndices[j];
        activeLabels[idx] = resolvedTargetSlot;
        activeFgMask[idx] = resolvedTargetSlot >= 0 ? 1 : 0;
      }

      // 5. Absorb any thin 1-2px anti-aliased fringe islands left right along the merged boundary
      if (resolvedTargetSlot >= 0) {
        const maxHaloSize = Math.max(
          minIslandPx * 2,
          Math.min(110, Math.floor(cTail * 0.65))
        );
        const haloVisited = new Uint8Array(total);
        const haloComp = new Int32Array(maxHaloSize + 2);

        for (let s = 0; s < sTail; s++) {
          const bIdx = shellQueue[s];
          if (shellDist[bIdx] !== 1 || haloVisited[bIdx]) continue;
          const hLbl = activeLabels[bIdx];
          if (hLbl < 0 || hLbl === resolvedTargetSlot) continue;

          let hHead = 0;
          let hTail = 0;
          let exceeded = false;
          let targetBorderTouch = 0;
          let totalBorderTouch = 0;

          haloVisited[bIdx] = 1;
          haloComp[hTail++] = bIdx;

          while (hHead < hTail) {
            const curr = haloComp[hHead++];
            const cx = curr % width;
            const cy = (curr - cx) / width;

            const inspectHaloNeighbor = (nIdx: number) => {
              const nLbl = activeLabels[nIdx];
              if (nLbl === hLbl) {
                if (!haloVisited[nIdx]) {
                  haloVisited[nIdx] = 1;
                  if (hTail <= maxHaloSize) {
                    haloComp[hTail++] = nIdx;
                  } else {
                    exceeded = true;
                  }
                }
              } else {
                totalBorderTouch++;
                if (nLbl === resolvedTargetSlot) {
                  targetBorderTouch++;
                }
              }
            };

            if (cx > 0) inspectHaloNeighbor(curr - 1);
            if (cx < width - 1) inspectHaloNeighbor(curr + 1);
            if (cy > 0) inspectHaloNeighbor(curr - width);
            if (cy < height - 1) inspectHaloNeighbor(curr + width);
          }

          if (
            !exceeded &&
            hTail <= maxHaloSize &&
            totalBorderTouch > 0 &&
            targetBorderTouch / totalBorderTouch >= 0.58
          ) {
            for (let k = 0; k < hTail; k++) {
              activeLabels[haloComp[k]] = resolvedTargetSlot;
            }
            cTail += hTail;
          }
        }
      }
    }

    if (rule.targetMode !== 'surrounding') {
      for (let j = 0; j < cTail; j++) {
        const idx = compIndices[j];
        activeLabels[idx] = resolvedTargetSlot;
        activeFgMask[idx] = resolvedTargetSlot >= 0 ? 1 : 0;
      }
    }

    resolvedList.push({
      id: rule.id,
      x: rule.x,
      y: rule.y,
      targetMode: rule.targetMode,
      sourceSlotIndex,
      resolvedTargetSlot,
      sourceHex: getSlotDisplayHex(sourceSlotIndex),
      targetHex: resolvedTargetSlot >= 0 ? getSlotDisplayHex(resolvedTargetSlot) : '#0B0F17',
      pixelCount: cTail,
    });
  }

  return resolvedList;
}

/**
 * Full pipeline: Background & Custom Colour Removal -> Gradient Flattening -> 4-Colour K-Means++ -> Optional Outer Stroke & Base -> Zero-Gap Planar Vector Tracing.
 */
export function runMultiColorTracePipeline(
  sourceImageData: ImageData,
  params: TraceParameters,
  slotConfigs: ColorSlotConfig[]
): MultiColorTraceResult {
  const { width, height, data } = sourceImageData;
  const total = width * height;

  // 1. Foreground extraction, background removal, and custom chosen colour removal
  const { fgMask, bgRgb } = computeForegroundMask(
    data,
    width,
    height,
    params.bgRemovalMode,
    params.bgTolerance,
    params.customBgColor,
    params.removedColors
  );

  // If closeColorGaps is enabled, heal internal anti-aliased transition cracks between colours
  if (params.closeColorGaps) {
    healInteriorBackgroundGaps(
      fgMask,
      width,
      height,
      Math.max(140, params.minIslandPx * 8)
    );
  }

  // 2. Flatten gradients & shading with bilateral edge-preserving filter
  const smoothedData = flattenGradientsBilateral(
    data,
    fgMask,
    width,
    height,
    params.despeckleLevel
  );

  // Determine K-Means artwork slots vs the dedicated Stroke & Base / Hollow Box slot (slotIndex = 4).
  // Keeping all `params.numColors` (up to 4) slots for the artwork guarantees that enabling Stroke Outline
  // or Box Mode never drops one of the user's traced image colours.
  const effectiveStrokeEnabled = Boolean(params.strokeEnabled || params.boxMode);
  const effectiveStrokeWidthMm = effectiveStrokeEnabled
    ? Math.max(0.8, params.strokeWidthMm)
    : 0;
  const useDedicatedStrokeSlot = effectiveStrokeEnabled && effectiveStrokeWidthMm > 0;
  const numArtworkColors = params.numColors;
  const strokeSlotIdx = useDedicatedStrokeSlot ? 4 : -1;
  const lidInnerFillIdx = useDedicatedStrokeSlot ? 5 : -1;

  // 3. Quantize remaining foreground into `numArtworkColors` colours
  const lockedCentroids = slotConfigs
    .slice(0, numArtworkColors)
    .map((s) => (s.lockedSourceHex ? hexToRgb(s.lockedSourceHex) : null));

  const { centroids, labels } = quantizeForegroundKMeans(
    smoothedData,
    fgMask,
    width,
    height,
    numArtworkColors,
    lockedCentroids
  );

  // Helper to resolve transitive slot merges (e.g. Slot 4 merged into Slot 3)
  const resolveTargetSlot = (slotIdx: number): number => {
    if (useDedicatedStrokeSlot && slotIdx === strokeSlotIdx) return strokeSlotIdx;
    let curr = slotIdx;
    for (let step = 0; step < 4; step++) {
      const cfg = slotConfigs[curr];
      const next = cfg?.mergedIntoSlot;
      if (
        next == null ||
        next < 0 ||
        next >= params.numColors ||
        next === curr ||
        !(slotConfigs[next]?.enabled ?? true)
      ) {
        break;
      }
      curr = next;
    }
    return curr;
  };

  // Record raw unmerged pixel counts and remap artwork labels that are merged into another artwork slot
  // BEFORE island absorption and planar tracing so merged colours fuse into a single seamless region.
  const rawPixelCounts = new Int32Array(5);
  for (let i = 0; i < total; i++) {
    const lbl = labels[i];
    if (lbl >= 0 && lbl < numArtworkColors) {
      rawPixelCounts[lbl]++;
      const slotEnabled = slotConfigs[lbl]?.enabled ?? true;
      if (slotEnabled) {
        const targetSlot = resolveTargetSlot(lbl);
        if (targetSlot >= 0 && targetSlot < numArtworkColors) {
          labels[i] = targetSlot;
        }
      }
    }
  }

  // 4. Clean up small pixel islands before vector contour extraction
  absorbSmallIslands(labels, width, height, params.minIslandPx);

  // Build activeLabels map (-1 for background or removed slots, 0..numColors-1 for enabled slots)
  const activeFgMask = new Uint8Array(total);
  const activeLabels = new Int8Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const lbl = labels[i];
    if (lbl >= 0 && lbl < numArtworkColors) {
      const slotEnabled = slotConfigs[lbl]?.enabled ?? true;
      if (slotEnabled) {
        const targetSlot = resolveTargetSlot(lbl);
        if (slotConfigs[targetSlot]?.enabled ?? true) {
          activeFgMask[i] = 1;
          activeLabels[i] = targetSlot;
        }
      }
    }
  }

  // 4B. If Outer Stroke & Base (or Box Mode) is enabled, expand a smooth round-join offset collar around activeFgMask
  let computedStrokeRadiusPx = 0;
  let computedPxPerMm = 1;

  if (useDedicatedStrokeSlot && strokeSlotIdx >= 0) {
    // Measure current foreground pixel width so strokeWidthMm maps accurately to pixels
    let minX = width,
      maxX = 0;
    let hasFg = false;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (activeFgMask[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          hasFg = true;
        }
      }
    }

    if (hasFg) {
      const fgPxWidth = Math.max(16, maxX - minX);
      const approxTotalMm = Math.max(15, params.targetWidthMm);
      computedPxPerMm =
        fgPxWidth / Math.max(10, approxTotalMm - 2 * effectiveStrokeWidthMm);
      computedStrokeRadiusPx = Math.max(
        1.8,
        Math.min(48, effectiveStrokeWidthMm * computedPxPerMm)
      );
      const maxDistSq = computedStrokeRadiusPx * computedStrokeRadiusPx;

      const distSq = computeEuclideanDistanceSq(activeFgMask, width, height);

      for (let i = 0; i < total; i++) {
        if (!activeFgMask[i] && distSq[i] <= maxDistSq) {
          activeFgMask[i] = 1;
          activeLabels[i] = strokeSlotIdx;
        }
      }

      // If Solid Badge Base (Close Inner Gaps) or Box Mode is active, fill any remaining enclosed interior holes
      // inside the stroke silhouette with the Stroke & Base colour
      if (params.strokeFillInnerGaps || params.boxMode) {
        const exteriorVisited = new Uint8Array(total);
        const queue = new Int32Array(total);
        let head = 0,
          tail = 0;
        const pushExt = (idx: number) => {
          if (!activeFgMask[idx] && !exteriorVisited[idx]) {
            exteriorVisited[idx] = 1;
            queue[tail++] = idx;
          }
        };
        for (let x = 0; x < width; x++) {
          pushExt(x);
          pushExt((height - 1) * width + x);
        }
        for (let y = 0; y < height; y++) {
          pushExt(y * width);
          pushExt(y * width + (width - 1));
        }
        while (head < tail) {
          const curr = queue[head++];
          const cx = curr % width;
          const cy = (curr - cx) / width;
          if (cx > 0) pushExt(curr - 1);
          if (cx < width - 1) pushExt(curr + 1);
          if (cy > 0) pushExt(curr - width);
          if (cy < height - 1) pushExt(curr + width);
        }
        for (let i = 0; i < total; i++) {
          if (!activeFgMask[i] && !exteriorVisited[i]) {
            activeFgMask[i] = 1;
            activeLabels[i] = strokeSlotIdx;
          }
        }
      }
    }
  }

  // 4C. Apply manual click-to-merge region overrides (absorbs unwanted clicked details into their surrounding colour)
  const strokeRgb = hexToRgb(params.strokeColorHex || '#141821');
  const getSlotDisplayHex = (slotIdx: number): string => {
    if (useDedicatedStrokeSlot && slotIdx === strokeSlotIdx) {
      return (params.strokeColorHex || '#141821').toUpperCase();
    }
    const slot = slotConfigs[slotIdx];
    if (slot && slot.printHex && slot.lockedSourceHex) {
      return slot.printHex.toUpperCase();
    }
    return rgbToHex(centroids[slotIdx] || strokeRgb);
  };

  const resolvedMergedRegions = applyManualMergedRegions(
    activeLabels,
    activeFgMask,
    width,
    height,
    useDedicatedStrokeSlot ? 5 : params.numColors,
    params.minIslandPx,
    params.mergedRegions,
    resolveTargetSlot,
    getSlotDisplayHex
  );

  // 4D. Separate Outer Stroke Box Wall (strokeSlotIdx = 4) from Interior Lid Gap-Fill (lidInnerFillIdx = 5)
  // and compute the Inner Support Ledge / Deep Cavity mask (`innerDeepCavityMask`) for Box Mode.
  let innerDeepCavityMask: Uint8Array | undefined = undefined;
  if (useDedicatedStrokeSlot && strokeSlotIdx >= 0 && computedStrokeRadiusPx > 0) {
    // 1. Identify exterior outside the full silhouette
    const exteriorVisited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0,
      tail = 0;
    const pushExt = (idx: number) => {
      if (!activeFgMask[idx] && !exteriorVisited[idx]) {
        exteriorVisited[idx] = 1;
        queue[tail++] = idx;
      }
    };
    for (let x = 0; x < width; x++) {
      pushExt(x);
      pushExt((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      pushExt(y * width);
      pushExt(y * width + (width - 1));
    }
    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;
      if (cx > 0) pushExt(curr - 1);
      if (cx < width - 1) pushExt(curr + 1);
      if (cy > 0) pushExt(curr - width);
      if (cy < height - 1) pushExt(curr + width);
    }

    if (params.boxMode || params.strokeFillInnerGaps) {
      for (let i = 0; i < total; i++) {
        if (!activeFgMask[i] && !exteriorVisited[i]) {
          activeFgMask[i] = 1;
          activeLabels[i] = strokeSlotIdx;
        }
      }
    }

    // 2. Compute distance from exterior to separate the outer perimeter box wall from any interior lid bridges
    const distFromExtSq = computeEuclideanDistanceSq(exteriorVisited, width, height);
    const wallCutoffSq = (computedStrokeRadiusPx + 0.35) * (computedStrokeRadiusPx + 0.35);

    const rawLidMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const lbl = activeLabels[i];
      if (lbl >= 0 && lbl !== strokeSlotIdx) {
        rawLidMask[i] = 1;
      } else if (lbl === strokeSlotIdx && distFromExtSq[i] > wallCutoffSq) {
        rawLidMask[i] = 1;
      }
    }

    // Close any enclosed holes inside rawLidMask so the lid is 100% unified and the box cavity has 0 internal pillars
    const outsideLidVisited = new Uint8Array(total);
    head = 0;
    tail = 0;
    const pushOutsideLid = (idx: number) => {
      if (!rawLidMask[idx] && !outsideLidVisited[idx]) {
        outsideLidVisited[idx] = 1;
        queue[tail++] = idx;
      }
    };
    for (let x = 0; x < width; x++) {
      pushOutsideLid(x);
      pushOutsideLid((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      pushOutsideLid(y * width);
      pushOutsideLid(y * width + (width - 1));
    }
    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;
      if (cx > 0) pushOutsideLid(curr - 1);
      if (cx < width - 1) pushOutsideLid(curr + 1);
      if (cy > 0) pushOutsideLid(curr - width);
      if (cy < height - 1) pushOutsideLid(curr + width);
    }

    const lidCavityMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (activeFgMask[i] && !outsideLidVisited[i]) {
        lidCavityMask[i] = 1;
        if (activeLabels[i] === strokeSlotIdx) {
          activeLabels[i] = lidInnerFillIdx;
        }
      }
    }

    // 3. Compute `innerDeepCavityMask` by stepping inward from `outsideLidVisited` by `boxLedgeWidthMm`
    const distFromLidEdgeSq = computeEuclideanDistanceSq(outsideLidVisited, width, height);
    const ledgeMm = Math.max(0.6, params.boxLedgeWidthMm ?? 1.4);
    const ledgePx = Math.max(1.6, Math.min(32, ledgeMm * computedPxPerMm));
    const ledgeCutoffSq = ledgePx * ledgePx;

    innerDeepCavityMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (lidCavityMask[i] && distFromLidEdgeSq[i] > ledgeCutoffSq) {
        innerDeepCavityMask[i] = 1;
      }
    }
  }

  // 5. Build quantized preview ImageData (including the outer stroke if active)
  const quantizedImageData = new ImageData(width, height);
  const qData = quantizedImageData.data;
  const pixelCounts = new Int32Array(5);
  let totalFgPixels = 0;

  for (let i = 0; i < total; i++) {
    const lbl = activeLabels[i];
    const pIdx = i * 4;
    if (lbl >= 0) {
      const slotBucket =
        useDedicatedStrokeSlot && (lbl === strokeSlotIdx || lbl === lidInnerFillIdx)
          ? strokeSlotIdx
          : lbl;
      if (slotBucket >= 0 && slotBucket < 5) {
        pixelCounts[slotBucket]++;
      }
      totalFgPixels++;

      if (useDedicatedStrokeSlot && (lbl === strokeSlotIdx || lbl === lidInnerFillIdx)) {
        qData[pIdx] = strokeRgb.r;
        qData[pIdx + 1] = strokeRgb.g;
        qData[pIdx + 2] = strokeRgb.b;
        qData[pIdx + 3] = 255;
      } else {
        const slot = slotConfigs[lbl];
        const displayRgb =
          slot && slot.printHex && slot.lockedSourceHex
            ? hexToRgb(slot.printHex)
            : centroids[lbl] || strokeRgb;

        qData[pIdx] = displayRgb.r;
        qData[pIdx + 1] = displayRgb.g;
        qData[pIdx + 2] = displayRgb.b;
        qData[pIdx + 3] = 255;
      }
    } else {
      qData[pIdx + 3] = 0;
    }
  }

  // 6. Trace all colour regions & outer silhouette using the Zero-Gap Shared-Boundary Planar Partition Tracer
  const planarTrace = tracePlanarColorPartition(
    activeLabels,
    width,
    height,
    useDedicatedStrokeSlot ? 6 : params.numColors,
    {
      smoothEpsilon: params.smoothEpsilon,
      cornerSimplify: params.cornerSimplify,
      fieldBlurPasses: params.fieldBlurPasses,
      minIslandPx: params.minIslandPx,
      strokeSlotIdx: useDedicatedStrokeSlot ? strokeSlotIdx : undefined,
      innerDeepCavityMask,
    }
  );

  const silhouettePolygons = planarTrace.silhouettePolygons;
  const layers: TracedColorLayer[] = [];

  for (let c = 0; c < params.numColors; c++) {
    const detectedHex = rgbToHex(centroids[c] || { r: 128, g: 128, b: 128 });
    const existingSlot = slotConfigs[c];
    const enabled = existingSlot ? existingSlot.enabled : true;
    const resolvedTarget = enabled ? resolveTargetSlot(c) : c;
    const mergedIntoSlot = enabled && resolvedTarget !== c ? resolvedTarget : null;

    const mergedFromSlots: number[] = [];
    if (enabled && mergedIntoSlot === null) {
      for (let other = 0; other < params.numColors; other++) {
        if (other === c) continue;
        const otherEnabled = slotConfigs[other] ? slotConfigs[other].enabled : true;
        if (otherEnabled && resolveTargetSlot(other) === c) {
          mergedFromSlots.push(other);
        }
      }
    }

    const printHex =
      existingSlot && existingSlot.lockedSourceHex ? existingSlot.printHex : detectedHex;

    let polygons: TracedPolygon[] = [];
    if (enabled && mergedIntoSlot === null) {
      if (params.extrusionMode === 'stepped_relief') {
        const maskForColor = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
          const lbl = activeLabels[i];
          if (lbl >= c && lbl < params.numColors) {
            maskForColor[i] = 1;
          }
        }
        polygons = traceBinaryMaskToPolygons(maskForColor, width, height, {
          smoothEpsilon: params.smoothEpsilon,
          turdSizePx: Math.max(4, Math.floor(params.minIslandPx * 0.5)),
          fieldBlurPasses: params.fieldBlurPasses,
          cornerSimplify: params.cornerSimplify,
        });
      } else {
        polygons = planarTrace.layerPolygons[c] || [];
      }
    }

    layers.push({
      slotIndex: c,
      name: `AMS Slot ${c + 1}`,
      detectedHex,
      printHex,
      enabled,
      mergedIntoSlot,
      mergedFromSlots,
      isStrokeAndBase: false,
      pixelCount: pixelCounts[c],
      rawPixelCount: rawPixelCounts[c],
      coveragePercent:
        totalFgPixels > 0 ? Math.round((pixelCounts[c] / totalFgPixels) * 1000) / 10 : 0,
      polygons,
    });
  }

  // If Stroke Outline or Box Mode is active, append the dedicated Stroke / Hollow Box layer (slotIndex = 4)
  if (useDedicatedStrokeSlot && strokeSlotIdx === 4) {
    const strokeHex = (params.strokeColorHex || '#F8FAFC').toUpperCase();
    layers.push({
      slotIndex: 4,
      name: params.boxMode ? 'Hollow Box & Frame' : 'Stroke & Base',
      detectedHex: strokeHex,
      printHex: strokeHex,
      enabled: true,
      mergedIntoSlot: null,
      mergedFromSlots: [],
      isStrokeAndBase: true,
      pixelCount: pixelCounts[4],
      rawPixelCount: pixelCounts[4],
      coveragePercent:
        totalFgPixels > 0 ? Math.round((pixelCounts[4] / totalFgPixels) * 1000) / 10 : 0,
      polygons: planarTrace.combinedStrokePolygons,
    });
  }

  return {
    width,
    height,
    quantizedImageData,
    foregroundMask: activeFgMask,
    silhouettePolygons,
    lidSilhouettePolygons: planarTrace.lidSilhouettePolygons,
    lidInnerFillPolygons: useDedicatedStrokeSlot ? planarTrace.layerPolygons[5] || [] : [],
    boxUpperWallPolygons: planarTrace.boxUpperWallPolygons,
    boxLedgeWallPolygons: planarTrace.boxLedgeWallPolygons,
    boxInnerPlugPolygons: planarTrace.boxInnerPlugPolygons,
    layers,
    detectedBgHex: rgbToHex(bgRgb),
    resolvedMergedRegions,
  };
}
