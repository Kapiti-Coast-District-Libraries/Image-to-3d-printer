import React from 'react';
import {
  ColorSlotConfig,
  MultiColorTraceResult,
  TraceParameters,
} from '../lib/colorQuantizer';
import { findClosestBambuFilament, OFFICIAL_BAMBU_FILAMENTS } from '../lib/bambuFilaments';
import { EyedropperTarget } from './VectorInspector2D';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Pipette,
  RotateCcw,
  Unlock,
  X,
  Palette,
} from 'lucide-react';

interface FilamentColorsSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  slotConfigs: ColorSlotConfig[];
  setSlotConfigs: React.Dispatch<React.SetStateAction<ColorSlotConfig[]>>;
  traceResult: MultiColorTraceResult | null;
  highlightedSlot: number | null;
  setHighlightedSlot: (slot: number | null) => void;
  openColorPickerSlot: number | null;
  setOpenColorPickerSlot: (slot: number | null) => void;
  eyedropperTarget: EyedropperTarget;
  activateEyedropper: (slotIndex: number) => void;
  handleToggleSlotEnabled: (slotIndex: number) => void;
  handleMergeSlotInto: (sourceSlotIndex: number, targetSlotIndex: number | null) => void;
  handleUnmergeAllSlots: () => void;
  handleSnapAllToBambuFilaments: () => void;
  closestMergeablePair: { target: any; source: any; distSq: number } | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const FilamentColorsSection: React.FC<FilamentColorsSectionProps> = ({
  params,
  setParams,
  slotConfigs,
  setSlotConfigs,
  traceResult,
  highlightedSlot,
  setHighlightedSlot,
  openColorPickerSlot,
  setOpenColorPickerSlot,
  eyedropperTarget,
  activateEyedropper,
  handleToggleSlotEnabled,
  handleMergeSlotInto,
  handleUnmergeAllSlots,
  handleSnapAllToBambuFilaments,
  closestMergeablePair,
  isExpanded,
  onToggleExpand,
}) => {
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
          <Palette className="w-3.5 h-3.5 text-teal-700 shrink-0" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide truncate">
            04. AMS Filament Colours
          </h3>
          {/* Swatch chips summary preview */}
          {traceResult && (
            <div className="flex items-center -space-x-1 shrink-0 ml-1">
              {traceResult.layers
                .filter((l) => l.enabled && l.mergedIntoSlot == null)
                .map((l) => (
                  <span
                    key={l.slotIndex}
                    className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-2xs"
                    style={{ backgroundColor: l.printHex }}
                    title={`Slot ${l.slotIndex + 1}: ${l.printHex}`}
                  />
                ))}
            </div>
          )}
        </button>

        {/* Quick controls right */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            {([2, 3, 4] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setParams((p) => ({ ...p, numColors: cnt }))}
                className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded transition-colors cursor-pointer ${
                  params.numColors === cnt
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title={`Limit to ${cnt} AMS filaments`}
              >
                {cnt}C
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleExpand}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded cursor-pointer"
          >
            {isExpanded ? 'Collapse' : 'Customize'}
          </button>
        </div>
      </div>

      {/* Expanded Content Body */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 border-t border-slate-200/80 bg-slate-50/50">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Combine similar slots, snap to official Bambu PLA filaments, or assign custom colors.
            </p>
            <button
              type="button"
              onClick={handleSnapAllToBambuFilaments}
              className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-200 text-[11px] font-semibold text-teal-800 whitespace-nowrap transition-colors cursor-pointer shrink-0"
            >
              Match Bambu PLA
            </button>
          </div>

          {/* Quick Merge Similar Pair Bar */}
          {(closestMergeablePair ||
            slotConfigs.some((s) => s.mergedIntoSlot != null)) && (
            <div className="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-2xs">
              {closestMergeablePair ? (
                <button
                  type="button"
                  onClick={() =>
                    handleMergeSlotInto(
                      closestMergeablePair.source.slotIndex,
                      closestMergeablePair.target.slotIndex
                    )
                  }
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 hover:text-blue-800 cursor-pointer min-w-0"
                >
                  <span className="flex items-center -space-x-1 shrink-0">
                    <span
                      className="w-3 h-3 rounded-full border border-slate-400"
                      style={{
                        backgroundColor: closestMergeablePair.target.printHex,
                      }}
                    />
                    <span
                      className="w-3 h-3 rounded-full border border-slate-400"
                      style={{
                        backgroundColor: closestMergeablePair.source.printHex,
                      }}
                    />
                  </span>
                  <span className="truncate">
                    Merge Closest: Slot {closestMergeablePair.target.slotIndex + 1} +
                    Slot {closestMergeablePair.source.slotIndex + 1}
                  </span>
                </button>
              ) : (
                <span className="text-[11px] text-slate-500">Slots merged</span>
              )}

              {slotConfigs.some((s) => s.mergedIntoSlot != null) && (
                <button
                  type="button"
                  onClick={handleUnmergeAllSlots}
                  className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 border border-slate-300 text-[10px] font-semibold text-slate-700 cursor-pointer shrink-0"
                >
                  Unmerge All
                </button>
              )}
            </div>
          )}

          {/* AMS Slot Rows */}
          <div className="space-y-2">
            {traceResult?.layers.map((layer) => {
              const slotCfg = slotConfigs[layer.slotIndex];
              const isLocked = Boolean(slotCfg?.lockedSourceHex);
              const isEyedropping = eyedropperTarget === layer.slotIndex;
              const isSwatchOpen = openColorPickerSlot === layer.slotIndex;
              const isMergedOut = layer.mergedIntoSlot != null;
              const mergedTargetLayer =
                isMergedOut && traceResult
                  ? traceResult.layers.find((l) => l.slotIndex === layer.mergedIntoSlot)
                  : null;
              const mergedFromList = layer.mergedFromSlots || [];
              const effectiveDisplayHex = mergedTargetLayer
                ? mergedTargetLayer.printHex
                : layer.printHex;
              const bambuMatch = findClosestBambuFilament(effectiveDisplayHex);
              const isExactBambuHex =
                bambuMatch.preset.hex.toUpperCase() ===
                effectiveDisplayHex.toUpperCase();

              return (
                <div
                  key={layer.slotIndex}
                  onMouseEnter={() => setHighlightedSlot(layer.slotIndex)}
                  onMouseLeave={() => setHighlightedSlot(null)}
                  className={`rounded-xl border p-2.5 transition-all ${
                    !layer.enabled
                      ? 'bg-red-50/40 border-red-200 opacity-75'
                      : isMergedOut
                      ? 'bg-slate-50 border-blue-200'
                      : highlightedSlot === layer.slotIndex
                      ? 'bg-blue-50/50 border-blue-400 shadow-2xs'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenColorPickerSlot(
                            isSwatchOpen ? null : layer.slotIndex
                          )
                        }
                        className="w-6 h-6 rounded-lg border border-slate-300 shrink-0 shadow-2xs cursor-pointer relative overflow-hidden"
                        style={{ backgroundColor: layer.printHex }}
                        title="Change filament colour"
                      >
                        {!layer.enabled && (
                          <span className="inset-0 bg-slate-900/60 flex items-center justify-center w-full h-full">
                            <X className="w-3.5 h-3.5 text-red-200" />
                          </span>
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-xs font-bold whitespace-nowrap ${
                              layer.enabled
                                ? 'text-slate-800'
                                : 'text-slate-400 line-through'
                            }`}
                          >
                            {layer.slotIndex === 4
                              ? params.boxMode
                                ? 'Hollow Box'
                                : 'Stroke'
                              : `Slot ${layer.slotIndex + 1}`}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {layer.printHex}
                          </span>
                          {layer.isStrokeAndBase && (
                            <span className="px-1.5 py-0.2 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-semibold">
                              {params.boxMode
                                ? 'Box Walls & Floor'
                                : 'Stroke & Base'}
                            </span>
                          )}
                          {mergedFromList.length > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-700">
                              + Slot {mergedFromList.map((idx) => idx + 1).join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {!layer.enabled ? (
                            <span className="text-red-600">Removed from print</span>
                          ) : isMergedOut && mergedTargetLayer ? (
                            <span className="text-blue-700">
                              Merged into Slot {mergedTargetLayer.slotIndex + 1}
                            </span>
                          ) : (
                            <>
                              {layer.coveragePercent.toFixed(1)}% ·{' '}
                              {layer.polygons.length}{' '}
                              {layer.polygons.length === 1 ? 'region' : 'regions'}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isMergedOut ? (
                        <button
                          type="button"
                          onClick={() => handleMergeSlotInto(layer.slotIndex, null)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Unmerge</span>
                        </button>
                      ) : (
                        <>
                          {layer.slotIndex !== 4 && (
                            <>
                              <button
                                type="button"
                                onClick={() => activateEyedropper(layer.slotIndex)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isEyedropping
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                }`}
                                title="Sample colour from image"
                              >
                                <Pipette className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setSlotConfigs((prev) =>
                                    prev.map((s, idx) =>
                                      idx === layer.slotIndex
                                        ? {
                                            ...s,
                                            lockedSourceHex: s.lockedSourceHex
                                              ? null
                                              : layer.detectedHex,
                                            printHex: layer.printHex,
                                          }
                                        : s
                                    )
                                  )
                                }
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isLocked
                                    ? 'text-amber-600 bg-amber-50'
                                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                }`}
                                title={isLocked ? 'Unlock colour' : 'Lock colour'}
                              >
                                {isLocked ? (
                                  <Lock className="w-3.5 h-3.5" />
                                ) : (
                                  <Unlock className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleToggleSlotEnabled(layer.slotIndex)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                          layer.enabled
                            ? 'bg-slate-50 hover:bg-red-50 text-slate-600 hover:text-red-600 border-slate-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        {layer.enabled ? (
                          <>
                            <EyeOff className="w-3 h-3" />
                            <span>Remove</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3" />
                            <span>Restore</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Per-Slot Merge & Bambu Match */}
                  {layer.enabled && !isMergedOut && (
                    <div className="mt-2 pt-1.5 border-t border-slate-100 space-y-1.5">
                      {layer.slotIndex !== 4 &&
                        traceResult.layers.filter(
                          (other) =>
                            other.slotIndex !== layer.slotIndex &&
                            other.slotIndex !== 4 &&
                            other.enabled &&
                            other.mergedIntoSlot == null
                        ).length > 0 && (
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] text-slate-400">
                              Merge into:
                            </span>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {traceResult.layers
                                .filter(
                                  (other) =>
                                    other.slotIndex !== layer.slotIndex &&
                                    other.slotIndex !== 4 &&
                                    other.enabled &&
                                    other.mergedIntoSlot == null
                                )
                                .map((other) => (
                                  <button
                                    key={other.slotIndex}
                                    type="button"
                                    onClick={() =>
                                      handleMergeSlotInto(
                                        layer.slotIndex,
                                        other.slotIndex
                                      )
                                    }
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-[10px] font-mono text-slate-600 hover:text-blue-700 cursor-pointer"
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full border border-slate-400"
                                      style={{ backgroundColor: other.printHex }}
                                    />
                                    <span>Slot {other.slotIndex + 1}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-slate-300 shrink-0"
                            style={{ backgroundColor: bambuMatch.preset.hex }}
                          />
                          <span className="text-[11px] text-slate-500 truncate">
                            Bambu {bambuMatch.preset.series}:{' '}
                            <span className="text-slate-800 font-semibold">
                              {bambuMatch.preset.name}
                            </span>
                          </span>
                        </div>
                        {!isExactBambuHex ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (layer.isStrokeAndBase && layer.slotIndex === 4) {
                                setParams((p) => ({
                                  ...p,
                                  strokeColorHex: bambuMatch.preset.hex,
                                }));
                              } else {
                                setSlotConfigs((prev) =>
                                  prev.map((s, idx) =>
                                    idx === layer.slotIndex
                                      ? {
                                          ...s,
                                          printHex: bambuMatch.preset.hex,
                                          lockedSourceHex:
                                            s.lockedSourceHex || layer.detectedHex,
                                        }
                                      : s
                                  )
                                );
                              }
                            }}
                            className="text-[10px] font-mono font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-1.5 py-0.5 rounded border border-teal-200 cursor-pointer shrink-0"
                          >
                            Snap {bambuMatch.preset.hex}
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono text-teal-700 font-semibold shrink-0">
                            Exact Match
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expandable Swatch Picker */}
                  {isSwatchOpen && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-slate-600">
                          Official Bambu PLA Basic &amp; Matte
                        </span>
                        <input
                          type="color"
                          value={layer.printHex}
                          onChange={(e) => {
                            const newHex = e.target.value.toUpperCase();
                            if (layer.isStrokeAndBase && layer.slotIndex === 4) {
                              setParams((p) => ({ ...p, strokeColorHex: newHex }));
                            } else {
                              setSlotConfigs((prev) =>
                                prev.map((s, idx) =>
                                  idx === layer.slotIndex
                                    ? {
                                        ...s,
                                        printHex: newHex,
                                        lockedSourceHex:
                                          s.lockedSourceHex || layer.detectedHex,
                                      }
                                    : s
                                )
                              );
                            }
                          }}
                          className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
                        />
                      </div>
                      <div className="grid grid-cols-9 gap-1 max-h-28 overflow-y-auto pr-1">
                        {OFFICIAL_BAMBU_FILAMENTS.map((sw) => (
                          <button
                            key={`${sw.code}_${sw.hex}`}
                            type="button"
                            onClick={() => {
                              if (layer.isStrokeAndBase && layer.slotIndex === 4) {
                                setParams((p) => ({ ...p, strokeColorHex: sw.hex }));
                              } else {
                                setSlotConfigs((prev) =>
                                  prev.map((s, idx) =>
                                    idx === layer.slotIndex
                                      ? {
                                          ...s,
                                          printHex: sw.hex,
                                          lockedSourceHex:
                                            s.lockedSourceHex || layer.detectedHex,
                                        }
                                      : s
                                  )
                                );
                              }
                              setOpenColorPickerSlot(null);
                            }}
                            className="w-5 h-5 rounded border border-slate-300 hover:scale-110 transition-transform cursor-pointer"
                            style={{ backgroundColor: sw.hex }}
                            title={`${sw.series} — ${sw.name} (${sw.hex})`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
