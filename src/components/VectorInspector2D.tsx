import React, { useEffect, useRef, useState } from 'react';
import { MultiColorTraceResult, RGB } from '../lib/colorQuantizer';
import { Point } from '../lib/vectorTracer';
import {
  Crosshair,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eraser,
  MousePointerClick,
  Undo2,
  X,
} from 'lucide-react';

export type InspectorSubMode = 'vector_paths' | 'quantized_flat' | 'side_by_side';

export type EyedropperTarget = 'background' | 'remove_color' | number | null;

interface VectorInspector2DProps {
  sourceImageData: ImageData | null;
  traceResult: MultiColorTraceResult | null;
  subMode: InspectorSubMode;
  highlightedSlot: number | null;
  eyedropperTarget: EyedropperTarget;
  onPickColorFromImage: (rgb: RGB) => void;
  onToggleSlotEnabled?: (slotIndex: number) => void;
  onCancelEyedropper?: () => void;
  mergeItemMode?: boolean;
  onToggleMergeItemMode?: () => void;
  onMergeItemAtPixel?: (pixelX: number, pixelY: number) => void;
  mergedRegionsCount?: number;
  onUndoLastMergedRegion?: () => void;
  onClearMergedRegions?: () => void;
}

export const VectorInspector2D: React.FC<VectorInspector2DProps> = ({
  sourceImageData,
  traceResult,
  subMode,
  highlightedSlot,
  eyedropperTarget,
  onPickColorFromImage,
  onToggleSlotEnabled,
  onCancelEyedropper,
  mergeItemMode = false,
  onToggleMergeItemMode,
  onMergeItemAtPixel,
  mergedRegionsCount = 0,
  onUndoLastMergedRegion,
  onClearMergedRegions,
}) => {
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const quantizedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [showControlNodes, setShowControlNodes] = useState(true);
  const [showOuterSilhouette, setShowOuterSilhouette] = useState(true);
  const [zoom, setZoom] = useState(1);

  // Render Source Image Canvas
  useEffect(() => {
    const canvas = sourceCanvasRef.current;
    if (!canvas || !sourceImageData) return;
    canvas.width = sourceImageData.width;
    canvas.height = sourceImageData.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(sourceImageData, 0, 0);
    }
  }, [sourceImageData, subMode, eyedropperTarget]);

  // Render Quantized 4-Colour Flattened Canvas
  useEffect(() => {
    const canvas = quantizedCanvasRef.current;
    if (!canvas || !traceResult) return;
    canvas.width = traceResult.width;
    canvas.height = traceResult.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(traceResult.quantizedImageData, 0, 0);
    }
  }, [traceResult, subMode]);

  const getPixelCoordsFromElement = (
    clientX: number,
    clientY: number,
    el: Element
  ): { x: number; y: number } | null => {
    if (!sourceImageData) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = Math.max(
      0,
      Math.min(
        sourceImageData.width - 1,
        Math.floor(((clientX - rect.left) / rect.width) * sourceImageData.width)
      )
    );
    const y = Math.max(
      0,
      Math.min(
        sourceImageData.height - 1,
        Math.floor(((clientY - rect.top) / rect.height) * sourceImageData.height)
      )
    );
    return { x, y };
  };

  const handleElementClick = (clientX: number, clientY: number, el: Element) => {
    const coords = getPixelCoordsFromElement(clientX, clientY, el);
    if (!coords || !sourceImageData) return;

    if (mergeItemMode && onMergeItemAtPixel) {
      onMergeItemAtPixel(coords.x, coords.y);
      return;
    }

    if (eyedropperTarget !== null) {
      const idx = (coords.y * sourceImageData.width + coords.x) * 4;
      onPickColorFromImage({
        r: sourceImageData.data[idx],
        g: sourceImageData.data[idx + 1],
        b: sourceImageData.data[idx + 2],
      });
    }
  };

  if (!traceResult || !sourceImageData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
        No image loaded for vector inspection.
      </div>
    );
  }

  const ringToSvgPath = (ring: Point[]): string => {
    if (ring.length < 3) return '';
    return (
      ring
        .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
        .join(' ') + ' Z'
    );
  };

  // Count total vector nodes and closed paths
  let totalPaths = 0;
  let totalNodes = 0;
  for (const layer of traceResult.layers) {
    if (!layer.enabled) continue;
    for (const poly of layer.polygons) {
      totalPaths += 1 + poly.holes.length;
      totalNodes += poly.outer.length;
      for (const h of poly.holes) totalNodes += h.length;
    }
  }

  const getEyedropperLabel = () => {
    if (eyedropperTarget === 'remove_color') {
      return 'Click any colour on the image below to remove it from the print & trace';
    }
    if (eyedropperTarget === 'background') {
      return 'Click the exterior background colour on the image below';
    }
    if (typeof eyedropperTarget === 'number') {
      return `Click any shade on the image below to lock AMS Slot ${eyedropperTarget + 1}`;
    }
    return '';
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0B0F17] overflow-hidden">
      {/* Merge Item Active Banner */}
      {mergeItemMode && (
        <div className="border-b border-cyan-500/40 bg-cyan-500/15 px-4 py-2.5 flex items-center justify-between text-xs text-cyan-100">
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-cyan-300 animate-pulse" />
            <span className="font-medium">
              Merge Item Mode: Click any unwanted detail or island on the artwork below to absorb it into its surrounding colour
            </span>
          </div>
          <div className="flex items-center gap-2">
            {mergedRegionsCount > 0 && onUndoLastMergedRegion && (
              <button
                type="button"
                onClick={onUndoLastMergedRegion}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium cursor-pointer"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo Last ({mergedRegionsCount})</span>
              </button>
            )}
            {mergedRegionsCount > 1 && onClearMergedRegions && (
              <button
                type="button"
                onClick={onClearMergedRegions}
                className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium cursor-pointer"
              >
                Restore All
              </button>
            )}
            {onToggleMergeItemMode && (
              <button
                type="button"
                onClick={onToggleMergeItemMode}
                className="px-2.5 py-1 rounded bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-[11px] font-semibold cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* Eyedropper / Colour Removal Active Banner */}
      {!mergeItemMode && eyedropperTarget !== null && (
        <div
          className={`border-b px-4 py-2.5 flex items-center justify-between text-xs ${
            eyedropperTarget === 'remove_color'
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {eyedropperTarget === 'remove_color' ? (
              <Eraser className="w-4 h-4 text-rose-400 animate-pulse" />
            ) : (
              <Crosshair className="w-4 h-4 animate-pulse" />
            )}
            <span className="font-medium">{getEyedropperLabel()}</span>
          </div>
          {onCancelEyedropper && (
            <button
              type="button"
              onClick={onCancelEyedropper}
              className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Main Viewport Area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6">
        {subMode === 'side_by_side' || eyedropperTarget !== null ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-5xl items-center">
            {/* Left: Original Source Image (Interactive Eyedropper / Merge Item Target) */}
            <div className="flex flex-col items-center">
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
                <span className="font-medium text-slate-200">
                  {mergeItemMode
                    ? 'Original Raster Image (Click Any Detail to Merge)'
                    : 'Original Raster Image (Click to Pick Colour)'}
                </span>
                <span className="font-mono tabular-nums">
                  {sourceImageData.width} × {sourceImageData.height} px
                </span>
              </div>
              <div className="relative rounded-lg overflow-hidden border border-white/10 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] p-2">
                <canvas
                  ref={sourceCanvasRef}
                  onClick={(e) => handleElementClick(e.clientX, e.clientY, e.currentTarget)}
                  className={`max-h-[460px] w-auto object-contain rounded ${
                    mergeItemMode
                      ? 'cursor-crosshair ring-2 ring-cyan-400'
                      : eyedropperTarget !== null
                      ? eyedropperTarget === 'remove_color'
                        ? 'cursor-crosshair ring-2 ring-rose-400'
                        : 'cursor-crosshair ring-2 ring-emerald-400'
                      : ''
                  }`}
                />
              </div>
            </div>

            {/* Right: Inkscape Vector Trace SVG Preview */}
            <div className="flex flex-col items-center">
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
                <span className="font-medium text-slate-200">
                  {mergeItemMode
                    ? 'Resulting Vector Trace (Click Any Item to Merge)'
                    : 'Resulting Vector Trace (Click a Region to Toggle Slot)'}
                </span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {totalPaths} Closed Contours · {totalNodes.toLocaleString()} Nodes
                </span>
              </div>
              <div className="relative rounded-lg overflow-hidden border border-white/10 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] p-2">
                <svg
                  viewBox={`0 0 ${traceResult.width} ${traceResult.height}`}
                  className={`max-h-[460px] w-auto ${
                    mergeItemMode
                      ? 'cursor-crosshair ring-2 ring-cyan-400 rounded'
                      : eyedropperTarget !== null
                      ? 'cursor-crosshair'
                      : ''
                  }`}
                  style={{ aspectRatio: `${traceResult.width} / ${traceResult.height}` }}
                  onClick={(e) => {
                    if (mergeItemMode || eyedropperTarget !== null) {
                      handleElementClick(e.clientX, e.clientY, e.currentTarget);
                    }
                  }}
                >
                  {traceResult.layers.map((layer) => {
                    if (!layer.enabled) return null;
                    const isDimmed =
                      highlightedSlot !== null && highlightedSlot !== layer.slotIndex;
                    const d = layer.polygons
                      .map(
                        (poly) =>
                          ringToSvgPath(poly.outer) +
                          ' ' +
                          poly.holes.map(ringToSvgPath).join(' ')
                      )
                      .join(' ');
                    return (
                      <path
                        key={layer.slotIndex}
                        d={d}
                        fill={layer.printHex}
                        fillRule="evenodd"
                        opacity={isDimmed ? 0.2 : 1}
                        stroke={showControlNodes ? '#0F172A' : 'none'}
                        strokeWidth={showControlNodes ? 0.6 : 0}
                        className={`hover:opacity-85 transition-opacity ${
                          mergeItemMode ? 'cursor-crosshair' : 'cursor-pointer'
                        }`}
                        onClick={(e) => {
                          if (mergeItemMode) {
                            // Let click bubble up to the <svg> handler to merge at exact pixel coordinate
                            return;
                          }
                          if (eyedropperTarget === null && onToggleSlotEnabled) {
                            e.stopPropagation();
                            onToggleSlotEnabled(layer.slotIndex);
                          }
                        }}
                      >
                        <title>
                          {mergeItemMode
                            ? `Click to merge this detail into its surrounding colour`
                            : `AMS Slot ${layer.slotIndex + 1} (${layer.printHex}) — Click to remove/hide this colour slot`}
                        </title>
                      </path>
                    );
                  })}
                  {showOuterSilhouette &&
                    traceResult.silhouettePolygons.map((poly, idx) => (
                      <path
                        key={`sil-${idx}`}
                        d={ringToSvgPath(poly.outer)}
                        fill="none"
                        stroke="#10B981"
                        strokeWidth={1.6}
                        strokeDasharray="4 2"
                        className="pointer-events-none"
                      />
                    ))}
                </svg>
              </div>
            </div>
          </div>
        ) : subMode === 'quantized_flat' ? (
          <div className="flex flex-col items-center">
            <div className="relative rounded-lg overflow-hidden border border-white/10 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] p-3">
              <canvas
                ref={quantizedCanvasRef}
                onClick={(e) => handleElementClick(e.clientX, e.clientY, e.currentTarget)}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                className={`max-h-[540px] w-auto object-contain transition-transform duration-150 ${
                  mergeItemMode ? 'cursor-crosshair ring-2 ring-cyan-400 rounded' : ''
                }`}
              />
            </div>
          </div>
        ) : (
          /* Full Vector Paths & Curve Node Inspector */
          <div className="flex flex-col items-center">
            <div className="relative rounded-lg overflow-hidden border border-white/10 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] p-3">
              <svg
                viewBox={`0 0 ${traceResult.width} ${traceResult.height}`}
                className={`h-[540px] w-auto transition-transform duration-150 ${
                  mergeItemMode ? 'cursor-crosshair ring-2 ring-cyan-400 rounded' : ''
                }`}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                  aspectRatio: `${traceResult.width} / ${traceResult.height}`,
                }}
                onClick={(e) => {
                  if (mergeItemMode) {
                    handleElementClick(e.clientX, e.clientY, e.currentTarget);
                  }
                }}
              >
                {traceResult.layers.map((layer) => {
                  if (!layer.enabled) return null;
                  const isDimmed =
                    highlightedSlot !== null && highlightedSlot !== layer.slotIndex;
                  const d = layer.polygons
                    .map(
                      (poly) =>
                        ringToSvgPath(poly.outer) +
                        ' ' +
                        poly.holes.map(ringToSvgPath).join(' ')
                    )
                    .join(' ');
                  return (
                    <g key={layer.slotIndex} opacity={isDimmed ? 0.18 : 1}>
                      <path
                        d={d}
                        fill={layer.printHex}
                        fillRule="evenodd"
                        stroke="#020617"
                        strokeWidth={0.75}
                        className={`hover:opacity-85 transition-opacity ${
                          mergeItemMode ? 'cursor-crosshair' : 'cursor-pointer'
                        }`}
                        onClick={() => {
                          if (mergeItemMode) return;
                          if (onToggleSlotEnabled) onToggleSlotEnabled(layer.slotIndex);
                        }}
                      >
                        <title>
                          {mergeItemMode
                            ? `Click to merge this detail into its surrounding colour`
                            : `AMS Slot ${layer.slotIndex + 1} (${layer.printHex}) — Click to remove this colour from print`}
                        </title>
                      </path>
                      {showControlNodes &&
                        layer.polygons.map((poly, pIdx) => (
                          <g key={pIdx} className="pointer-events-none">
                            {poly.outer
                              .filter((_, i) => i % 2 === 0)
                              .map((pt, i) => (
                                <circle
                                  key={i}
                                  cx={pt.x}
                                  cy={pt.y}
                                  r={1.35}
                                  fill="#F8FAFC"
                                  stroke="#0F172A"
                                  strokeWidth={0.6}
                                />
                              ))}
                          </g>
                        ))}
                    </g>
                  );
                })}
                {showOuterSilhouette &&
                  traceResult.silhouettePolygons.map((poly, idx) => (
                    <path
                      key={`sil-${idx}`}
                      d={
                        ringToSvgPath(poly.outer) +
                        ' ' +
                        poly.holes.map(ringToSvgPath).join(' ')
                      }
                      fill="none"
                      stroke="#10B981"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      className="pointer-events-none"
                    />
                  ))}
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Vector Inspector Toolbar */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-lg px-3.5 py-2 text-xs text-slate-300 font-mono tabular-nums flex items-center gap-2">
          <span>{totalPaths} Vector Loops</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>{totalNodes.toLocaleString()} Curve Vertices</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-emerald-400">
            {traceResult.layers.filter((l) => l.enabled && l.mergedIntoSlot == null).length} / {traceResult.layers.length} Colours Active
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5">
          {onToggleMergeItemMode && (
            <>
              <button
                type="button"
                onClick={onToggleMergeItemMode}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  mergeItemMode
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/60 ring-1 ring-cyan-400/40'
                    : 'text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/25'
                }`}
                title="Click any unwanted detail or island on the artwork to merge it into its surrounding colour"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>{mergeItemMode ? 'Merging Items (Click Detail)...' : 'Merge Item'}</span>
              </button>

              {mergedRegionsCount > 0 && onUndoLastMergedRegion && (
                <button
                  type="button"
                  onClick={onUndoLastMergedRegion}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 transition-colors whitespace-nowrap cursor-pointer"
                  title="Undo last merged item"
                >
                  <Undo2 className="w-3 h-3 text-cyan-300" />
                  <span>Undo ({mergedRegionsCount})</span>
                </button>
              )}

              {mergedRegionsCount > 1 && onClearMergedRegions && (
                <button
                  type="button"
                  onClick={onClearMergedRegions}
                  className="p-1 text-slate-400 hover:text-rose-300 rounded transition-colors cursor-pointer"
                  title="Restore all manually merged items"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              <div className="h-4 w-px bg-white/10 mx-0.5" />
            </>
          )}

          <button
            type="button"
            onClick={() => setShowControlNodes((v) => !v)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              showControlNodes
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Curve Nodes
          </button>
          <button
            type="button"
            onClick={() => setShowOuterSilhouette((v) => !v)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
              showOuterSilhouette
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            3D Outer Cutline
          </button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}
            className="p-1 text-slate-400 hover:text-white"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-300 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))}
            className="p-1 text-slate-400 hover:text-white"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="p-1 text-slate-400 hover:text-white"
            title="Reset Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
