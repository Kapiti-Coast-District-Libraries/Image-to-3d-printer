import React from 'react';
import {
  ColorSlotConfig,
  DetectedImageSwatch,
  MergeItemTargetMode,
  MultiColorTraceResult,
  RGB,
  TraceParameters,
} from '../lib/colorQuantizer';
import { EyedropperTarget } from './VectorInspector2D';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Eraser,
  MousePointerClick,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';

interface CleanupSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  traceResult: MultiColorTraceResult | null;
  slotConfigs: ColorSlotConfig[];
  imageSwatches: DetectedImageSwatch[];
  isSwatchRemoved: (sw: DetectedImageSwatch) => boolean;
  addOrToggleRemovedColor: (
    rgb: RGB,
    scope?: 'global' | 'exterior_only'
  ) => void;
  eyedropperTarget: EyedropperTarget;
  activateEyedropper: (target: Exclude<EyedropperTarget, null>) => void;
  mergeItemMode: boolean;
  handleToggleMergeItemMode: () => void;
  mergedRegionsCount: number;
  handleUndoLastMergedRegion: () => void;
  handleClearMergedRegions: () => void;
  mergeItemTargetMode: MergeItemTargetMode;
  setMergeItemTargetMode: (mode: MergeItemTargetMode) => void;
  handleUpdateMergedRegionTarget: (id: string, targetMode: MergeItemTargetMode) => void;
  handleRemoveMergedRegionById: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const CleanupSection: React.FC<CleanupSectionProps> = ({
  params,
  setParams,
  traceResult,
  slotConfigs,
  imageSwatches,
  isSwatchRemoved,
  addOrToggleRemovedColor,
  eyedropperTarget,
  activateEyedropper,
  mergeItemMode,
  handleToggleMergeItemMode,
  mergedRegionsCount,
  handleUndoLastMergedRegion,
  handleClearMergedRegions,
  mergeItemTargetMode,
  setMergeItemTargetMode,
  handleUpdateMergedRegionTarget,
  handleRemoveMergedRegionById,
  isExpanded,
  onToggleExpand,
}) => {
  const activeRemovedCount = params.removedColors.length + mergedRegionsCount;

  return (
    <section className="bg-slate-50/70 border border-slate-200/90 rounded-2xl overflow-hidden transition-all shadow-2xs">
      {/* Collapsible Header */}
      <div className="p-3.5 flex items-center justify-between gap-2 select-none bg-white">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-2 text-left cursor-pointer flex-1 min-w-0"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          )}
          <Sparkles className="w-3.5 h-3.5 text-teal-700 shrink-0" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide truncate">
            05. Background &amp; Cleanup
          </h3>

          {traceResult && (
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              <span
                className="w-3.5 h-3.5 rounded border border-slate-300 inline-block shadow-2xs"
                style={{ backgroundColor: traceResult.detectedBgHex }}
                title={`Detected Background: ${traceResult.detectedBgHex}`}
              />
              {activeRemovedCount > 0 ? (
                <span className="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded-full">
                  {activeRemovedCount} cleaned
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">
                  Auto
                </span>
              )}
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded cursor-pointer shrink-0"
        >
          {isExpanded ? 'Collapse' : 'Customize'}
        </button>
      </div>

      {/* Expanded Content Body */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 border-t border-slate-200/80 bg-slate-50/50">
          <p className="text-xs text-slate-500 leading-relaxed">
            Click any detected image colour below to strip it from the trace, or use{' '}
            <strong className="text-slate-700">Merge Item</strong> to absorb unwanted small details into their surrounding colour.
          </p>

          {/* Quick-Click Detected Image Swatches */}
          {imageSwatches.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-medium">
                  Detected Image Colours (Click to Remove)
                </span>
                {params.removedColors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, removedColors: [] }))}
                    className="text-blue-600 font-semibold hover:underline cursor-pointer"
                  >
                    Restore All
                  </button>
                )}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {imageSwatches.map((sw, idx) => {
                  const removed = isSwatchRemoved(sw);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => addOrToggleRemovedColor(sw.rgb, 'global')}
                      className={`group relative h-8 rounded-lg border transition-transform cursor-pointer flex items-center justify-center overflow-hidden ${
                        removed
                          ? 'border-red-500 ring-2 ring-red-500/30 scale-95 opacity-75'
                          : 'border-slate-300 hover:scale-105 hover:border-slate-500'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                      title={`${sw.hex} (${sw.percent}% of image) — Click to ${
                        removed ? 'restore to print' : 'remove from print/trace'
                      }`}
                    >
                      {removed && (
                        <div className="inset-0 bg-slate-900/60 flex items-center justify-center w-full h-full">
                          <X className="w-4 h-4 text-red-200 stroke-[2.5]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interactive Eyedropper Button */}
          <button
            type="button"
            onClick={() => activateEyedropper('remove_color')}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              eyedropperTarget === 'remove_color'
                ? 'bg-red-50 border-red-300 text-red-700 ring-2 ring-red-500/20'
                : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 shadow-2xs'
            }`}
          >
            <Eraser className="w-3.5 h-3.5 text-red-500" />
            <span>
              {eyedropperTarget === 'remove_color'
                ? 'Click Any Colour on Image to Remove...'
                : 'Pick Colour on Image to Remove'}
            </span>
          </button>

          {/* Manual Click-to-Merge Item / Detail into Surrounding Colour */}
          <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                <MousePointerClick className="w-3.5 h-3.5 text-teal-700" />
                <span>Merge Individual Item / Detail</span>
              </span>
              {mergedRegionsCount > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndoLastMergedRegion}
                    className="text-[10px] font-semibold text-teal-800 bg-white hover:bg-teal-50 px-2 py-0.5 rounded border border-teal-200 cursor-pointer flex items-center gap-1"
                    title="Undo last merged item"
                  >
                    <Undo2 className="w-2.5 h-2.5" />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearMergedRegions}
                    className="text-[10px] font-semibold text-slate-500 hover:text-red-600 px-1.5 py-0.5 rounded cursor-pointer"
                    title="Restore all manually merged items"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleToggleMergeItemMode}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                mergeItemMode
                  ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                  : 'bg-white hover:bg-teal-50 border-teal-300 text-teal-800'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>
                {mergeItemMode
                  ? 'Merge Item Active — Click Detail on 3D/2D'
                  : 'Merge Item (Click Detail to Absorb)'}
              </span>
            </button>

            {/* Target Mode Selector for Click-to-Merge */}
            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setMergeItemTargetMode('surrounding')}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer truncate ${
                  mergeItemTargetMode === 'surrounding'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Surrounding
              </button>
              <button
                type="button"
                onClick={() => setMergeItemTargetMode(params.baseSlotIndex)}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer truncate ${
                  typeof mergeItemTargetMode === 'number'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {typeof mergeItemTargetMode === 'number'
                  ? `Slot ${mergeItemTargetMode + 1}`
                  : 'Specific Slot'}
              </button>
              <button
                type="button"
                onClick={() => setMergeItemTargetMode('cutout')}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer truncate ${
                  mergeItemTargetMode === 'cutout'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Cutout Hole
              </button>
            </div>

            {typeof mergeItemTargetMode === 'number' && (
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {Array.from({ length: params.numColors }).map((_, idx) => {
                  const layerHex =
                    traceResult?.layers[idx]?.printHex ||
                    slotConfigs[idx]?.printHex ||
                    '#334155';
                  const active = mergeItemTargetMode === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setMergeItemTargetMode(idx)}
                      className={`flex items-center justify-center gap-1 py-1 rounded border text-[10px] font-mono cursor-pointer ${
                        active
                          ? 'bg-blue-50 border-blue-400 text-blue-800 font-bold'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full border border-slate-400"
                        style={{ backgroundColor: layerHex }}
                      />
                      <span>S{idx + 1}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Active Manually Merged Items List */}
            {traceResult && traceResult.resolvedMergedRegions.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-teal-200/70">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Merged Items ({traceResult.resolvedMergedRegions.length})</span>
                  <span>Click × to restore</span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                  {traceResult.resolvedMergedRegions.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-mono text-slate-400">
                          #{idx + 1}
                        </span>
                        <span
                          className="w-3 h-3 rounded-xs border border-slate-300 shrink-0"
                          style={{ backgroundColor: item.sourceHex }}
                        />
                        <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                        <span
                          className="w-3 h-3 rounded-xs border border-slate-300 shrink-0"
                          style={{ backgroundColor: item.targetHex }}
                        />
                        <span className="text-[10px] text-slate-700 font-medium truncate">
                          {item.resolvedTargetSlot === -1
                            ? 'Cutout'
                            : item.resolvedTargetSlot === 4
                            ? 'Into Box/Stroke'
                            : `Slot ${item.resolvedTargetSlot + 1}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          value={String(item.targetMode)}
                          onChange={(e) => {
                            const val = e.target.value;
                            const parsed: MergeItemTargetMode =
                              val === 'surrounding'
                                ? 'surrounding'
                                : val === 'cutout'
                                ? 'cutout'
                                : parseInt(val, 10);
                            handleUpdateMergedRegionTarget(item.id, parsed);
                          }}
                          className="bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[10px] text-slate-700 cursor-pointer"
                        >
                          <option value="surrounding">Auto Surround</option>
                          {Array.from({ length: params.numColors }).map((_, sIdx) => (
                            <option key={sIdx} value={String(sIdx)}>
                              Slot {sIdx + 1}
                            </option>
                          ))}
                          <option value="cutout">Cutout</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveMergedRegionById(item.id)}
                          className="p-0.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Exterior Background Mode Selector */}
          <div className="pt-1 space-y-2">
            <div className="text-xs font-medium text-slate-600">
              Automatic Border Background Mode
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['perimeter_flood', 'Exterior Flood'],
                  ['global_color', 'Global + Holes'],
                  ['alpha_only', 'Alpha PNG Only'],
                  ['none', 'Keep Full Box'],
                ] as const
              ).map(([mode, label]) => {
                const active = params.bgRemovalMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, bgRemovalMode: mode }))}
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                      active
                        ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {params.bgRemovalMode !== 'none' &&
              params.bgRemovalMode !== 'alpha_only' && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600">Auto Border Tolerance</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {params.bgTolerance}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={75}
                    step={1}
                    value={params.bgTolerance}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        bgTolerance: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              )}
          </div>
        </div>
      )}
    </section>
  );
};
