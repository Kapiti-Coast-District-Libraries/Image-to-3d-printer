import { ExtrudedModelResult, buildExtrudedModel } from './meshExtruder';
import {
  MultiColorTraceResult,
  TraceParameters,
  runMultiColorTracePipeline,
} from './colorQuantizer';
import { SAMPLE_ARTWORKS } from './sampleArtworks';
import { CustomizerConfig } from '../types';

export interface PrintEstimateMetrics {
  approxTotalGrams: number;
  approxMinutes: number;
  costNzd: number;
  signDescription: string;
  activeColorCount: number;
}

/**
 * Computes physical filament weight (g), estimated print time (min), and Maker Space cost ($NZD)
 * directly from the 3D manifold mesh geometry and multi-colour configuration.
 */
export function computePrintEstimate(
  model: ExtrudedModelResult | null,
  params: TraceParameters,
  projectName: string
): PrintEstimateMetrics {
  if (!model || model.parts.length === 0) {
    return {
      approxTotalGrams: 12,
      approxMinutes: 25,
      costNzd: 2.5,
      signDescription: `${projectName} (${params.targetWidthMm}mm)`,
      activeColorCount: params.numColors,
    };
  }

  // Compute exact mesh volume in mm^3 using signed tetrahedron volume on closed manifold parts
  let totalVolumeMm3 = 0;
  for (const part of model.parts) {
    const verts = part.vertices;
    const tris = part.triangles;
    let partVol = 0;
    for (let i = 0; i < tris.length; i++) {
      const [i0, i1, i2] = tris[i];
      const v0 = verts[i0];
      const v1 = verts[i1];
      const v2 = verts[i2];
      if (!v0 || !v1 || !v2) continue;
      partVol +=
        v0.x * (v1.y * v2.z - v1.z * v2.y) +
        v0.y * (v1.z * v2.x - v1.x * v2.z) +
        v0.z * (v1.x * v2.y - v1.y * v2.x);
    }
    totalVolumeMm3 += Math.abs(partVol) / 6.0;
  }

  // Fallback to bounding box approximation if mesh volume is unexpectedly tiny
  const { width, depth, height } = model.dimensionsMm;
  if (totalVolumeMm3 < 100) {
    const fillRatio = params.boxMode ? 0.28 : 0.62;
    totalVolumeMm3 = width * depth * height * fillRatio;
  }

  const volumeCm3 = totalVolumeMm3 / 1000.0;
  // Effective slicer density (walls + top/bottom shells + 15% gyroid infill ≈ 0.58 of solid PLA 1.24g/cm3)
  const effectiveDensityGPerCm3 = params.boxMode ? 0.68 : 0.74;
  const uniqueColorSlots = new Set(model.parts.map((p) => p.slotIndex)).size;

  // AMS purge/prime tower allowance for multi-colour changes
  const colorSwapLayers =
    params.extrusionMode === 'full_flush'
      ? Math.round(params.baseThicknessMm / 0.2)
      : Math.round(params.inlayThicknessMm / 0.2);
  const purgeGrams =
    uniqueColorSlots > 1 ? Math.round(uniqueColorSlots * colorSwapLayers * 0.65) : 0;

  const approxTotalGrams = Math.max(
    4,
    Math.round(volumeCm3 * effectiveDensityGPerCm3 + purgeGrams)
  );

  // Print time estimation: ~2.1 mins per gram + multi-colour filament swap overhead
  const swapMinutes =
    uniqueColorSlots > 1 ? Math.round((uniqueColorSlots - 1) * colorSwapLayers * 1.15) : 0;
  const approxMinutes = Math.max(12, Math.round(approxTotalGrams * 1.95 + swapMinutes));

  // Library Maker Space pricing: $0.20 per gram (minimum $2.00 NZD), rounded to nearest $0.50
  const rawCost = Math.max(2.0, approxTotalGrams * 0.2);
  const costNzd = Math.round(rawCost * 2) / 2;

  const shapePrefix =
    params.strokeShape === 'square'
      ? 'Square '
      : params.strokeShape === 'circle'
      ? 'Circle '
      : params.strokeShape === 'rectangle'
      ? 'Rect '
      : '';
  const modeLabel = params.boxMode
    ? `${shapePrefix}Box + ${
        params.boxLidStyle === 'flush_recessed'
          ? 'Flush Lid'
          : params.boxLidStyle === 'raised_rim_recessed'
          ? 'Rim Lid'
          : 'Cap & Plug Lid'
      }`
    : params.strokeEnabled
    ? `${shapePrefix}Badge + Stroke`
    : 'Multi-Colour Plaque';

  const dimsLabel = `${Math.round(width)}×${Math.round(depth)}×${height.toFixed(1)}mm`;
  const signDescription = `${projectName.replace(/_/g, ' ')} · ${modeLabel} (${dimsLabel}, ${uniqueColorSlots}C)`;

  return {
    approxTotalGrams,
    approxMinutes,
    costNzd,
    signDescription,
    activeColorCount: uniqueColorSlots,
  };
}

/**
 * Compresses an ImageData into a compact PNG DataURL (max 260px dimension)
 * so custom uploaded images fit comfortably inside the Firestore JSON recipe (<45 KB).
 */
export function encodeImageDataToCompactDataUrl(
  imageData: ImageData,
  maxDim = 260
): string {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = imageData.width;
  srcCanvas.height = imageData.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);

  const scale = Math.min(1, maxDim / Math.max(imageData.width, imageData.height));
  const targetW = Math.max(16, Math.round(imageData.width * scale));
  const targetH = Math.max(16, Math.round(imageData.height * scale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW;
  outCanvas.height = targetH;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  return outCanvas.toDataURL('image/png');
}

/**
 * Reconstructs the source ImageData from a CustomizerConfig (either from built-in sampleId or compact DataURL).
 */
export async function loadConfigImageData(
  config: CustomizerConfig,
  maxTraceDim = 460
): Promise<ImageData> {
  if (config.sourceImageDataUrl) {
    return new Promise<ImageData>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxTraceDim / Math.max(img.width, img.height));
        const w = Math.max(16, Math.round(img.width * scale));
        const h = Math.max(16, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(ctx.getImageData(0, 0, w, h));
      };
      img.onerror = (e) => reject(e);
      img.src = config.sourceImageDataUrl!;
    });
  }

  const sample =
    SAMPLE_ARTWORKS.find((s) => s.id === config.sampleId) || SAMPLE_ARTWORKS[0];
  const canvas = document.createElement('canvas');
  sample.renderToCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Deterministically reconstructs the 2D trace result and 3D manifold meshes on demand
 * from a saved PrintSubmission's CustomizerConfig.
 */
export async function reconstructFromConfig(
  config: CustomizerConfig,
  overrideParams?: Partial<TraceParameters>
): Promise<{
  imageData: ImageData;
  traceResult: MultiColorTraceResult;
  extrudedModel: ExtrudedModelResult;
}> {
  const imageData = await loadConfigImageData(config);
  const effectiveParams: TraceParameters = {
    ...config.params,
    ...overrideParams,
  };
  const traceResult = runMultiColorTracePipeline(
    imageData,
    effectiveParams,
    config.slotConfigs
  );
  const extrudedModel = buildExtrudedModel(traceResult, effectiveParams);
  return { imageData, traceResult, extrudedModel };
}
