import React, { useState } from 'react';
import { ColorSlotConfig, DetectedImageSwatch, MultiColorTraceResult, TraceParameters } from '../lib/colorQuantizer';
import { OFFICIAL_BAMBU_FILAMENTS } from '../lib/bambuFilaments';
import { resolveArtworkBaseSlot } from '../lib/meshExtruder';
import { Combine, Eraser, PaintBucket, Palette, Pencil, RotateCcw, Undo2, X } from 'lucide-react';

/** What a click on the preview does: paint a shape with a colour slot, cut it out, or fill a gap. */
export type PaintBrush = number | 'cutout' | 'keep' | null;

interface ColorPaintSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  slotConfigs: ColorSlotConfig[];
  setSlotConfigs: React.Dispatch<React.SetStateAction<ColorSlotConfig[]>>;
  traceResult: MultiColorTraceResult | null;
  brush: PaintBrush;
  onSelectBrush: (brush: PaintBrush) => void;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
  /** Main colours detected in the source picture; tapping one leaves it out of the print */
  imageSwatches: DetectedImageSwatch[];
  isSwatchRemoved: (sw: DetectedImageSwatch) => boolean;
  onToggleSwatch: (sw: DetectedImageSwatch) => void;
  onRestoreAllSwatches: () => void;
  /** Print every shape of one colour in another colour instead (null = undo the merge) */
  onMergeSlotInto: (source: number, target: number | null) => void;
}

/**
 * The colour workflow in one place: the (up to) 4 filament colours of the print. Tap a colour to use it
 * as a brush, then click any shape in the 2D or 3D preview to paint it that colour. The pencil changes
 * the filament a colour prints with.
 */
export const ColorPaintSection: React.FC<ColorPaintSectionProps> = ({
  params,
  setParams,
  slotConfigs,
  setSlotConfigs,
  traceResult,
  brush,
  onSelectBrush,
  canUndo,
  onUndo,
  onReset,
  imageSwatches,
  isSwatchRemoved,
  onToggleSwatch,
  onRestoreAllSwatches,
  onMergeSlotInto,
}) => {
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const slots = Array.from({ length: params.numColors }, (_, i) => {
    const layer = traceResult?.layers.find((l) => l.slotIndex === i && !l.isStrokeAndBase);
    return {
      slot: i,
      hex: (layer?.printHex || slotConfigs[i]?.printHex || '#94A3B8').toUpperCase(),
      detectedHex: layer?.detectedHex || slotConfigs[i]?.detectedHex || '#94A3B8',
      used: (layer?.pixelCount ?? 0) > 0,
      mergedInto: layer?.mergedIntoSlot ?? slotConfigs[i]?.mergedIntoSlot ?? null,
    };
  });
  const slotHex = (i: number | null) => (i == null ? '#94A3B8' : slots[i]?.hex ?? '#94A3B8');

  const setSlotFilament = (slot: number, hex: string, detectedHex: string) => {
    setSlotConfigs((prev) =>
      prev.map((s, idx) =>
        idx === slot ? { ...s, printHex: hex, lockedSourceHex: s.lockedSourceHex || detectedHex } : s
      )
    );
  };

  const brushLabel =
    brush === 'cutout'
      ? 'Remove: click a shape in the preview to cut it out.'
      : brush === 'keep'
      ? 'Fill gap: click an area that was wrongly removed as background to fill it back in.'
      : typeof brush === 'number'
      ? `Painting with colour ${brush + 1}: click any shape in the preview to make it this colour.`
      : 'Tap a colour, then click any shape in the 2D or 3D preview to paint it that colour.';

  return (
    <section className="space-y-3 bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Palette className="w-4 h-4 text-teal-700" />
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">04. Colours</h3>
        </div>
        <span className="text-[10px] font-mono text-slate-500">{params.numColors} filaments</span>
      </div>

      {/* Colours detected in the picture: tap to leave one out of the print */}
      {imageSwatches.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">Colours in your picture</span>
            {imageSwatches.some(isSwatchRemoved) ? (
              <button type="button" onClick={onRestoreAllSwatches} className="text-teal-700 font-semibold hover:underline cursor-pointer">
                Restore all
              </button>
            ) : (
              <span className="text-slate-400">tap to leave one out</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {imageSwatches.map((sw, idx) => {
              const removed = isSwatchRemoved(sw);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onToggleSwatch(sw)}
                  title={`${sw.hex} (${sw.percent}% of the picture): ${removed ? 'left out, tap to put back' : 'tap to leave out of the print'}`}
                  className={`relative w-8 h-7 rounded-md border overflow-hidden cursor-pointer transition-all ${
                    removed ? 'border-rose-500 ring-2 ring-rose-500/25 opacity-70' : 'border-slate-300 hover:border-slate-500 hover:scale-105'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                >
                  {removed && (
                    <span className="absolute inset-0 flex items-center justify-center bg-slate-900/55">
                      <X className="w-4 h-4 text-rose-200 stroke-[2.5]" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The colour swatches = brushes */}
      <div className={`grid gap-2 ${params.numColors === 4 ? 'grid-cols-4' : params.numColors === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {slots.map((s) => {
          const active = brush === s.slot;
          const merged = s.mergedInto != null;
          return (
            <div key={s.slot} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  merged ? setEditingSlot(editingSlot === s.slot ? null : s.slot) : onSelectBrush(active ? null : s.slot)
                }
                title={
                  merged
                    ? `Colour ${s.slot + 1} is merged into colour ${(s.mergedInto ?? 0) + 1}. Tap to unmerge.`
                    : `Paint with colour ${s.slot + 1} (${s.hex})`
                }
                className={`relative w-full aspect-square max-h-16 rounded-xl border-2 transition-all cursor-pointer shadow-2xs flex items-end justify-start p-1 ${
                  merged
                    ? 'border-dashed border-slate-400 opacity-60'
                    : active
                    ? 'border-teal-600 ring-4 ring-teal-500/25 scale-[1.03]'
                    : 'border-slate-300 hover:border-slate-400'
                }`}
                style={{ backgroundColor: merged ? slotHex(s.mergedInto) : s.hex }}
              >
                <span className="text-[10px] font-bold font-mono px-1 rounded bg-white/85 text-slate-800">
                  {merged ? `${s.slot + 1}→${(s.mergedInto ?? 0) + 1}` : s.slot + 1}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEditingSlot(editingSlot === s.slot ? null : s.slot)}
                className={`flex items-center gap-1 text-[10px] font-semibold cursor-pointer ${
                  editingSlot === s.slot ? 'text-teal-700' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Change the filament this colour prints with, or merge it into another colour"
              >
                {merged ? <Combine className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                {merged ? 'Merged' : s.used ? 'Filament' : 'Unused'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Filament picker for the colour being edited */}
      {editingSlot !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">Colour {editingSlot + 1}</span>
            <button type="button" onClick={() => setEditingSlot(null)} className="text-slate-500 hover:text-slate-800 cursor-pointer">
              Done
            </button>
          </div>
          {/* Merge: print all of this colour's shapes in another colour (e.g. greys that should be black) */}
          {slots[editingSlot]?.mergedInto != null ? (
            <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
              <span className="text-slate-700">
                Merged into colour {(slots[editingSlot].mergedInto ?? 0) + 1}: its shapes print in that colour.
              </span>
              <button
                type="button"
                onClick={() => onMergeSlotInto(editingSlot, null)}
                className="shrink-0 font-semibold text-teal-700 hover:underline cursor-pointer"
              >
                Unmerge
              </button>
            </div>
          ) : (
            slots.some((o) => o.slot !== editingSlot && o.mergedInto == null) && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="flex items-center gap-1 text-slate-600 shrink-0">
                  <Combine className="w-3.5 h-3.5" /> Merge into
                </span>
                {slots
                  .filter((o) => o.slot !== editingSlot && o.mergedInto == null)
                  .map((o) => (
                    <button
                      key={o.slot}
                      type="button"
                      onClick={() => {
                        onMergeSlotInto(editingSlot, o.slot);
                        if (brush === editingSlot) onSelectBrush(null);
                        setEditingSlot(null);
                      }}
                      title={`Print colour ${editingSlot + 1}'s shapes in colour ${o.slot + 1} instead`}
                      className="w-7 h-7 rounded-md border border-slate-300 hover:border-slate-600 hover:scale-105 transition-transform cursor-pointer flex items-end justify-start p-0.5"
                      style={{ backgroundColor: o.hex }}
                    >
                      <span className="text-[9px] font-bold font-mono px-0.5 rounded bg-white/85 text-slate-800 leading-tight">{o.slot + 1}</span>
                    </button>
                  ))}
              </div>
            )
          )}
          {slots[editingSlot]?.mergedInto == null && (
          <div className="grid grid-cols-10 gap-1 max-h-32 overflow-y-auto pr-1">
            {OFFICIAL_BAMBU_FILAMENTS.map((f) => (
              <button
                key={`${f.code}_${f.hex}`}
                type="button"
                onClick={() => {
                  const s = slots[editingSlot];
                  setSlotFilament(editingSlot, f.hex, s.detectedHex);
                }}
                className={`w-full aspect-square rounded border transition-transform cursor-pointer hover:scale-110 ${
                  slots[editingSlot]?.hex === f.hex.toUpperCase() ? 'border-teal-600 ring-2 ring-teal-500/30' : 'border-slate-300'
                }`}
                style={{ backgroundColor: f.hex }}
                title={`${f.series} — ${f.name}`}
              />
            ))}
          </div>
          )}
        </div>
      )}

      {/* Extra brushes + history */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelectBrush(brush === 'cutout' ? null : 'cutout')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
            brush === 'cutout' ? 'bg-rose-50 text-rose-700 border-rose-300' : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900'
          }`}
          title="Click a shape to cut it out of the print"
        >
          <Eraser className="w-3.5 h-3.5" /> Remove
        </button>
        <button
          type="button"
          onClick={() => onSelectBrush(brush === 'keep' ? null : 'keep')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
            brush === 'keep' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900'
          }`}
          title="Click an area that was wrongly removed as background to fill it back in"
        >
          <PaintBucket className="w-3.5 h-3.5" /> Fill gap
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!canUndo}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:text-rose-700 disabled:opacity-40 cursor-pointer disabled:cursor-default"
          title="Undo all painting, removing and filling"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {/* Where the colours go: lid background, box body / frame, backing (always one of the 4 colours) */}
      {traceResult && (
        <div className="space-y-1.5 pt-2 border-t border-slate-200">
          {params.boxMode ? (
            <>
              <SlotRow
                label="Lid background"
                slots={slots}
                selected={resolveArtworkBaseSlot(traceResult, params)}
                onPick={(i) => setParams((p) => ({ ...p, baseSlotIndex: i, baseSlotAuto: false }))}
                chipLabel="Auto"
                chipActive={params.baseSlotAuto !== false}
                chipTitle="Use the colour that matches the picture's own background"
                onChip={() => setParams((p) => ({ ...p, baseSlotAuto: p.baseSlotAuto === false }))}
              />
              <SlotRow
                label="Box body"
                slots={slots}
                selected={params.boxColorSlot ?? resolveArtworkBaseSlot(traceResult, params)}
                onPick={(i) => setParams((p) => ({ ...p, boxColorSlot: i, boxColorFollowsLid: true }))}
                chipLabel="Same as lid"
                chipActive={params.boxColorSlot == null}
                chipTitle="Print the box in the same colour as the lid's edge"
                onChip={() => setParams((p) => ({ ...p, boxColorSlot: null, boxColorFollowsLid: true }))}
              />
            </>
          ) : params.strokeEnabled ? (
            <SlotRow
              label="Frame"
              slots={slots}
              selected={params.boxColorSlot ?? resolveArtworkBaseSlot(traceResult, params)}
              onPick={(i) => setParams((p) => ({ ...p, boxColorSlot: i, boxColorFollowsLid: true }))}
              chipLabel="Auto"
              chipActive={params.boxColorSlot == null}
              chipTitle="Use the picture's background colour for the frame"
              onChip={() => setParams((p) => ({ ...p, boxColorSlot: null, boxColorFollowsLid: true }))}
            />
          ) : (
            <SlotRow
              label="Backing"
              slots={slots}
              selected={resolveArtworkBaseSlot(traceResult, params)}
              onPick={(i) => setParams((p) => ({ ...p, baseSlotIndex: i, baseSlotAuto: false }))}
              chipLabel="Auto"
              chipActive={params.baseSlotAuto !== false}
              chipTitle="Use the colour that matches the picture's own background"
              onChip={() => setParams((p) => ({ ...p, baseSlotAuto: p.baseSlotAuto === false }))}
            />
          )}
        </div>
      )}

      <p
        className={`text-[11px] leading-snug rounded-lg px-2.5 py-1.5 ${
          brush === null ? 'text-slate-500 bg-white border border-slate-200' : 'text-teal-900 bg-teal-50 border border-teal-200'
        }`}
      >
        {brushLabel}
      </p>
    </section>
  );
};

/** One line of "this part prints in colour N": the 4 colours as small chips, plus an automatic option. */
const SlotRow: React.FC<{
  label: string;
  slots: { slot: number; hex: string }[];
  selected: number | null;
  onPick: (slot: number) => void;
  chipLabel: string;
  chipActive: boolean;
  chipTitle: string;
  onChip: () => void;
}> = ({ label, slots, selected, onPick, chipLabel, chipActive, chipTitle, onChip }) => (
  <div className="flex items-center gap-2">
    <span className="text-[11px] font-semibold text-slate-700 w-24 shrink-0">{label}</span>
    <div className="flex items-center gap-1">
      {slots.map((s) => {
        const isSel = selected === s.slot;
        return (
          <button
            key={s.slot}
            type="button"
            onClick={() => onPick(s.slot)}
            title={`${label}: colour ${s.slot + 1} (${s.hex})`}
            className={`w-6 h-6 rounded-md border-2 text-[9px] font-bold font-mono flex items-end justify-start p-px cursor-pointer transition-all ${
              isSel
                ? chipActive
                  ? 'border-teal-400/80 ring-1 ring-teal-400/30'
                  : 'border-teal-600 ring-2 ring-teal-500/30'
                : 'border-slate-300 hover:border-slate-400'
            }`}
            style={{ backgroundColor: s.hex }}
          >
            <span className="px-0.5 rounded bg-white/80 text-slate-800 leading-none">{s.slot + 1}</span>
          </button>
        );
      })}
    </div>
    <button
      type="button"
      onClick={onChip}
      title={chipTitle}
      className={`ml-auto px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer transition-colors whitespace-nowrap ${
        chipActive ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-white text-slate-500 border-slate-300 hover:text-slate-800'
      }`}
    >
      {chipActive ? `✓ ${chipLabel}` : chipLabel}
    </button>
  </div>
);
