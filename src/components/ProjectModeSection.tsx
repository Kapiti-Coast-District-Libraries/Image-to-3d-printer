import React from 'react';
import {
  BoxExportParts,
  BoxLidStyle,
  BoxOutlineShape,
  StrokeProfileStyle,
  TraceParameters,
  MultiColorTraceResult,
} from '../lib/colorQuantizer';
import { PackageOpen, ShieldCheck, Ruler, RotateCcw, LayoutGrid, Scaling } from 'lucide-react';

export const BAMBU_FILAMENT_SWATCHES = [
  { name: 'Charcoal Black', hex: '#141821' },
  { name: 'Jade White', hex: '#F8FAFC' },
  { name: 'Scarlet Red', hex: '#E12D39' },
  { name: 'Bambu Green', hex: '#00AE42' },
  { name: 'Sunlu Gold', hex: '#F59E0B' },
  { name: 'Mandarin Orange', hex: '#F97316' },
  { name: 'Electric Cyan', hex: '#06B6D4' },
  { name: 'Cobalt Blue', hex: '#2563EB' },
];

interface ProjectModeSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  traceResult: MultiColorTraceResult | null;
}

export const ProjectModeSection: React.FC<ProjectModeSectionProps> = ({
  params,
  setParams,
  traceResult,
}) => {
  return (
    <section className="space-y-3.5 bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
      {/* Header Bar with Mode Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {params.boxMode ? (
            <PackageOpen className="w-4 h-4 text-teal-700" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-blue-600" />
          )}
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            01. Project Mode
          </h3>
        </div>
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-colors ${
            params.boxMode
              ? 'bg-teal-50 text-teal-800 border-teal-300'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}
        >
          {params.boxMode ? '3D Hollow Box + Lid' : 'Flat Badge / Plaque'}
        </span>
      </div>

      {/* Primary Mode Switcher (Box Mode vs Image / Flat Badge Mode) */}
      <div className="grid grid-cols-2 gap-1.5 bg-slate-200/70 p-1 rounded-xl">
        <button
          type="button"
          onClick={() =>
            setParams((p) => ({
              ...p,
              boxMode: true,
              strokeEnabled: true,
              strokeFillInnerGaps: true,
            }))
          }
          className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            params.boxMode
              ? 'bg-white text-teal-800 shadow-sm border border-slate-200/80'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <PackageOpen className="w-4 h-4 text-teal-600" />
          <span>Hollow Box + Lid</span>
        </button>

        <button
          type="button"
          onClick={() =>
            setParams((p) => ({
              ...p,
              boxMode: false,
            }))
          }
          className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            !params.boxMode
              ? 'bg-white text-blue-700 shadow-sm border border-slate-200/80'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <span>Flat Badge / Plaque</span>
        </button>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        {params.boxMode
          ? 'Creates a precision 3D hollow storage box with your multi-colour traced artwork as the fitted snap lid.'
          : 'Creates a multi-colour flat sign, coaster, or plaque with a solid baseplate and flush inlaid artwork.'}
      </p>

      {/* =================================================================== */}
      {/* BOX MODE CONFIGURATION                                              */}
      {/* =================================================================== */}
      {params.boxMode ? (
        <div className="space-y-3 pt-1 border-t border-slate-200/80">
          {/* Box Outer Shape */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700 font-semibold">
                Box &amp; Lid Outer Shape
              </span>
              <span className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                {(params.strokeShape || 'contour') === 'contour'
                  ? 'Follows Logo Contour'
                  : 'Geometric Enclosure'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 bg-white p-1 rounded-xl border border-slate-200">
              {(
                [
                  ['contour', 'Contour'],
                  ['square', 'Square'],
                  ['circle', 'Circle'],
                  ['rectangle', 'Rect'],
                ] as [BoxOutlineShape, string][]
              ).map(([shapeOpt, label]) => {
                const active = (params.strokeShape || 'contour') === shapeOpt;
                return (
                  <button
                    key={shapeOpt}
                    type="button"
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        strokeShape: shapeOpt,
                        strokeFillInnerGaps:
                          shapeOpt !== 'contour' ? true : p.strokeFillInnerGaps,
                      }))
                    }
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer truncate ${
                      active
                        ? 'bg-teal-50 text-teal-800 border border-teal-300 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dedicated Rectangle Length / Depth & Aspect Ratio Control */}
          {params.strokeShape === 'rectangle' && (
            <div className="bg-white border border-teal-200/90 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5 text-teal-700" />
                  <span>Rectangle Dimensions (X × Y)</span>
                </span>
                <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                  {params.targetWidthMm.toFixed(0)} × {(params.rectDepthMm ?? 65).toFixed(0)} mm
                </span>
              </div>

              {/* Quick Proportions / Aspect Ratio Presets */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Aspect Ratio Presets</span>
                  <span className="font-mono text-slate-600">
                    {(params.targetWidthMm / (params.rectDepthMm ?? 65)).toFixed(2)} : 1
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[
                    { label: '16:9', factor: 9 / 16 },
                    { label: '3:2', factor: 2 / 3 },
                    { label: '4:3', factor: 3 / 4 },
                    { label: '2:1', factor: 1 / 2 },
                    { label: '1:2', factor: 2 / 1 },
                  ].map(({ label, factor }) => {
                    const targetVal = Math.round(params.targetWidthMm * factor);
                    const isCurrent = Math.abs((params.rectDepthMm ?? 65) - targetVal) <= 1;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            rectDepthMm: targetVal,
                          }))
                        }
                        className={`py-1 rounded text-[10px] font-semibold transition-all cursor-pointer truncate ${
                          isCurrent
                            ? 'bg-teal-700 text-white font-bold shadow-2xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const ratio =
                        traceResult && traceResult.width > 0 && traceResult.height > 0
                          ? traceResult.height / traceResult.width
                          : 0.65;
                      setParams((p) => ({
                        ...p,
                        rectDepthMm: Math.min(
                          250,
                          Math.max(20, Math.round(p.targetWidthMm * ratio))
                        ),
                      }));
                    }}
                    className="py-1 rounded text-[10px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all cursor-pointer truncate"
                    title="Fit rectangle to artwork aspect ratio"
                  >
                    Fit Logo
                  </button>
                </div>
              </div>

              {/* Rectangle Length (Y) Slider + Number Input */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-700 font-medium">
                    Rectangle Depth / Length (Y)
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={20}
                      max={250}
                      step={1}
                      value={params.rectDepthMm ?? 65}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val > 0) {
                          setParams((p) => ({
                            ...p,
                            rectDepthMm: Math.min(256, Math.max(15, val)),
                          }));
                        }
                      }}
                      className="w-14 font-mono text-[11px] font-bold text-teal-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right"
                    />
                    <span className="text-slate-500 font-medium">mm</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={20}
                  max={240}
                  step={1}
                  value={params.rectDepthMm ?? 65}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      rectDepthMm: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              {/* Swap Dimensions (Landscape <-> Portrait) */}
              <button
                type="button"
                onClick={() =>
                  setParams((p) => {
                    const curW = p.targetWidthMm;
                    const curL = p.rectDepthMm ?? 65;
                    return {
                      ...p,
                      targetWidthMm: curL,
                      rectDepthMm: curW,
                    };
                  })
                }
                className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3 text-slate-500" />
                <span>Swap Width ↔ Length (Landscape / Portrait)</span>
              </button>
            </div>
          )}

          {/* Artwork Logo Sizing on Lid (Square, Circle, Rectangle) */}
          {(params.strokeShape || 'contour') !== 'contour' && (
            <div className="bg-white border border-teal-200/90 rounded-xl p-3 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Scaling className="w-3.5 h-3.5 text-teal-700" />
                  <span className="text-xs font-bold text-slate-800">
                    Artwork Logo Size on Lid
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                    {traceResult?.logoDimensionsMm
                      ? `${traceResult.logoDimensionsMm.width.toFixed(1)} × ${traceResult.logoDimensionsMm.height.toFixed(1)} mm`
                      : `${params.logoScalePercent ?? 85}% Scale`}
                  </span>
                </div>
              </div>

              {/* Quick Size Scale Presets */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Scale Presets</span>
                  <span className="font-mono text-slate-600 font-semibold">
                    {params.logoScalePercent ?? 85}% of Lid Cavity
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: '35%', name: 'Subtle', val: 35 },
                    { label: '50%', name: 'Medium', val: 50 },
                    { label: '70%', name: 'Classy', val: 70 },
                    { label: '85%', name: 'Standard', val: 85 },
                    { label: '100%', name: 'Fit Lid', val: 100 },
                  ].map((preset) => {
                    const isCur = (params.logoScalePercent ?? 85) === preset.val;
                    return (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            logoScalePercent: preset.val,
                          }))
                        }
                        className={`py-1 px-1 rounded text-[10px] font-semibold transition-all cursor-pointer truncate ${
                          isCur
                            ? 'bg-teal-700 text-white font-bold shadow-2xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                        title={`${preset.name} (${preset.val}%)`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Slider + Numeric Stepper */}
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 font-medium">Logo Scale Ratio</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={15}
                      max={120}
                      step={1}
                      value={params.logoScalePercent ?? 85}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val > 0) {
                          setParams((p) => ({
                            ...p,
                            logoScalePercent: Math.min(130, Math.max(15, val)),
                          }));
                        }
                      }}
                      className="w-12 font-mono text-[11px] font-bold text-teal-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right"
                    />
                    <span className="text-slate-500 font-medium">%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={20}
                  max={115}
                  step={1}
                  value={params.logoScalePercent ?? 85}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      logoScalePercent: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              {/* Geometric Margin Padding & Corner Fillet Radius */}
              <div
                className={`grid ${
                  params.strokeShape === 'circle' ? 'grid-cols-1' : 'grid-cols-2'
                } gap-2 pt-2 border-t border-slate-100`}
              >
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600">Lid Border Margin</span>
                    <span className="font-mono font-semibold text-teal-700">
                      {(params.shapePaddingMm ?? 3.5).toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={14.0}
                    step={0.5}
                    value={params.shapePaddingMm ?? 3.5}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        shapePaddingMm: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                {params.strokeShape !== 'circle' && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600">Corner Fillet</span>
                      <span className="font-mono font-semibold text-teal-700">
                        {(params.shapeCornerRadiusMm ?? 4.0).toFixed(1)} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.0}
                      max={20.0}
                      step={0.5}
                      value={params.shapeCornerRadiusMm ?? 4.0}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          shapeCornerRadiusMm: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Box & Rim Color Swatches */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700 font-semibold">
                Box Body &amp; Lid Rim Colour
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono text-slate-600">
                  {params.strokeColorHex}
                </span>
                <input
                  type="color"
                  value={params.strokeColorHex}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      strokeColorHex: e.target.value.toUpperCase(),
                    }))
                  }
                  className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                />
              </div>
            </div>

            <div className="grid grid-cols-8 gap-1.5">
              {BAMBU_FILAMENT_SWATCHES.map((sw) => {
                const active = params.strokeColorHex === sw.hex;
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    onClick={() =>
                      setParams((p) => ({ ...p, strokeColorHex: sw.hex }))
                    }
                    className={`w-6 h-6 rounded-md border transition-transform cursor-pointer ${
                      active
                        ? 'border-teal-600 ring-2 ring-teal-500/30 scale-105'
                        : 'border-slate-300 hover:scale-110'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                    title={sw.name}
                  />
                );
              })}
            </div>
          </div>

          {/* Box Dimensions: Height & Wall Thickness */}
          <div className="grid grid-cols-2 gap-2.5 bg-white border border-slate-200/90 rounded-xl p-2.5">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-600">Box Height (Z)</span>
                <span className="font-mono font-semibold text-teal-700">
                  {(params.boxHeightMm ?? 28).toFixed(0)} mm
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={80}
                step={1}
                value={params.boxHeightMm ?? 28}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    boxHeightMm: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-600">Wall Thickness</span>
                <span className="font-mono font-semibold text-teal-700">
                  {params.strokeWidthMm.toFixed(1)} mm
                </span>
              </div>
              <input
                type="range"
                min={1.2}
                max={6.0}
                step={0.2}
                value={params.strokeWidthMm}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    strokeWidthMm: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Internal Box Dividers / Compartments (Prominently Placed) */}
          <div className="bg-white border border-teal-200/90 rounded-xl p-3 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <LayoutGrid className="w-4 h-4 text-teal-700" />
                <span className="text-xs font-bold text-slate-800">
                  Internal Dividing Walls &amp; Compartments
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    params.boxDividersEnabled
                      ? 'bg-teal-50 text-teal-800 border-teal-300'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {params.boxDividersEnabled
                    ? `${(params.boxDividerCols ?? 2) * (params.boxDividerRows ?? 2)} Slots (${params.boxDividerCols ?? 2}×${params.boxDividerRows ?? 2})`
                    : 'Disabled'}
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.boxDividersEnabled ?? false}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        boxDividersEnabled: e.target.checked,
                        boxDividerCols: p.boxDividerCols ?? 2,
                        boxDividerRows: p.boxDividerRows ?? 2,
                        boxDividerThicknessMm: p.boxDividerThicknessMm ?? 1.0,
                        boxDividerHeightRatio: p.boxDividerHeightRatio ?? 1.0,
                      }))
                    }
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>
            </div>

            {params.boxDividersEnabled ? (
              <div className="space-y-3 pt-1 border-t border-slate-100">
                {/* Presets */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span className="font-medium">Quick Compartment Presets</span>
                    <span className="font-mono text-teal-800 font-bold bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded text-[10px]">
                      {(params.boxDividerCols ?? 2) * (params.boxDividerRows ?? 2)} Compartments
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: '2×1 (Split)', cols: 2, rows: 1 },
                      { label: '1×2 (Split)', cols: 1, rows: 2 },
                      { label: '2×2 (4 Slots)', cols: 2, rows: 2 },
                      { label: '3×1 (3 Slots)', cols: 3, rows: 1 },
                      { label: '3×2 (6 Slots)', cols: 3, rows: 2 },
                      { label: '3×3 (9 Slots)', cols: 3, rows: 3 },
                      { label: '4×2 (8 Slots)', cols: 4, rows: 2 },
                      { label: '1×1 (Open)', cols: 1, rows: 1 },
                    ].map((preset) => {
                      const isCur =
                        (params.boxDividerCols ?? 2) === preset.cols &&
                        (params.boxDividerRows ?? 2) === preset.rows;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            setParams((p) => ({
                              ...p,
                              boxDividerCols: preset.cols,
                              boxDividerRows: preset.rows,
                            }))
                          }
                          className={`py-1 px-1 rounded text-[10px] font-semibold transition-all cursor-pointer truncate ${
                            isCur
                              ? 'bg-teal-700 text-white font-bold shadow-2xs'
                              : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Grid Columns & Rows */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600">Columns (X)</span>
                      <span className="font-mono font-bold text-teal-800">
                        {params.boxDividerCols ?? 2}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={(params.boxDividerCols ?? 2) <= 1}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxDividerCols: Math.max(1, (p.boxDividerCols ?? 2) - 1),
                          }))
                        }
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs disabled:opacity-40 cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={params.boxDividerCols ?? 2}
                        onChange={(e) =>
                          setParams((p) => ({
                            ...p,
                            boxDividerCols: parseInt(e.target.value, 10),
                          }))
                        }
                        className="w-full accent-blue-600 cursor-pointer"
                      />
                      <button
                        type="button"
                        disabled={(params.boxDividerCols ?? 2) >= 6}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxDividerCols: Math.min(6, (p.boxDividerCols ?? 2) + 1),
                          }))
                        }
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs disabled:opacity-40 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-600">Rows (Y)</span>
                      <span className="font-mono font-bold text-teal-800">
                        {params.boxDividerRows ?? 2}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={(params.boxDividerRows ?? 2) <= 1}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxDividerRows: Math.max(1, (p.boxDividerRows ?? 2) - 1),
                          }))
                        }
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs disabled:opacity-40 cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={params.boxDividerRows ?? 2}
                        onChange={(e) =>
                          setParams((p) => ({
                            ...p,
                            boxDividerRows: parseInt(e.target.value, 10),
                          }))
                        }
                        className="w-full accent-blue-600 cursor-pointer"
                      />
                      <button
                        type="button"
                        disabled={(params.boxDividerRows ?? 2) >= 6}
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxDividerRows: Math.min(6, (p.boxDividerRows ?? 2) + 1),
                          }))
                        }
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs disabled:opacity-40 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Divider Wall Thickness (Default 1.0mm) */}
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600">Divider Wall Thickness</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0.6}
                        max={3.0}
                        step={0.1}
                        value={params.boxDividerThicknessMm ?? 1.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            setParams((p) => ({
                              ...p,
                              boxDividerThicknessMm: Math.min(3.5, Math.max(0.6, val)),
                            }));
                          }
                        }}
                        className="w-12 font-mono text-[11px] font-bold text-teal-800 bg-white border border-slate-300 rounded px-1 py-0.5 text-right"
                      />
                      <span className="text-slate-500 font-medium">mm</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={2.5}
                    step={0.1}
                    value={params.boxDividerThicknessMm ?? 1.0}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        boxDividerThicknessMm: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                {/* Divider Height */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600">Divider Wall Height</span>
                    <span className="font-mono font-semibold text-teal-700">
                      {Math.round((params.boxDividerHeightRatio ?? 1.0) * 100)}%
                      {(params.boxDividerHeightRatio ?? 1.0) >= 0.98
                        ? ' (Flush with Lid Ledge)'
                        : ' (Low Profile / Easy Grab)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setParams((p) => ({ ...p, boxDividerHeightRatio: 1.0 }))
                      }
                      className={`py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                        (params.boxDividerHeightRatio ?? 1.0) >= 0.95
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Full Height (Lid Support)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setParams((p) => ({ ...p, boxDividerHeightRatio: 0.7 }))
                      }
                      className={`py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                        (params.boxDividerHeightRatio ?? 1.0) < 0.95
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      70% (Easy Pick-out)
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-slate-500 leading-snug">
                  1.0 mm internal grid walls anchoring directly into the outer box perimeter.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setParams((p) => ({
                      ...p,
                      boxDividersEnabled: true,
                      boxDividerCols: p.boxDividerCols ?? 2,
                      boxDividerRows: p.boxDividerRows ?? 2,
                      boxDividerThicknessMm: p.boxDividerThicknessMm ?? 1.0,
                      boxDividerHeightRatio: p.boxDividerHeightRatio ?? 1.0,
                    }))
                  }
                  className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 text-[11px] font-bold cursor-pointer whitespace-nowrap shrink-0 ml-2"
                >
                  + Add Dividers
                </button>
              </div>
            )}
          </div>

          {/* Lid Fit Style & Clearance */}
          <div className="space-y-2 bg-white border border-slate-200/90 rounded-xl p-2.5">
            <span className="text-xs font-semibold text-slate-700 block">
              Traced Artwork Lid Fit Style
            </span>
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
              {(
                [
                  ['flush_recessed', 'Flush + Ledge'],
                  ['raised_rim_recessed', 'Recessed Rim'],
                  ['cap_with_plug', 'Cap + Plug'],
                ] as [BoxLidStyle, string][]
              ).map(([style, label]) => (
                <button
                  key={style}
                  type="button"
                  onClick={() =>
                    setParams((p) => ({ ...p, boxLidStyle: style }))
                  }
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                    (params.boxLidStyle || 'cap_with_plug') === style
                      ? 'bg-white text-teal-800 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-600">
                    {(params.boxLidStyle || 'cap_with_plug') === 'cap_with_plug'
                      ? 'Plug Lip Width'
                      : 'Inner Ledge Shelf'}
                  </span>
                  <span className="font-mono font-semibold text-teal-700">
                    {(params.boxLedgeWidthMm ?? 1.4).toFixed(1)} mm
                  </span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={3.2}
                  step={0.2}
                  value={params.boxLedgeWidthMm ?? 1.4}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      boxLedgeWidthMm: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-600">Lid XY Tolerance</span>
                  <span className="font-mono font-semibold text-teal-700">
                    {(params.boxLidToleranceMm ?? 0.2).toFixed(2)} mm
                  </span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.4}
                  step={0.05}
                  value={params.boxLidToleranceMm ?? 0.2}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      boxLidToleranceMm: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Parts to Export */}
          <div className="space-y-1 pt-1 border-t border-slate-200/80">
            <span className="text-[11px] font-medium text-slate-600 block">
              Parts to Include on Plate &amp; Export
            </span>
            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-xl border border-slate-200">
              {(
                [
                  ['both', 'Box + Lid'],
                  ['box_only', 'Box Only'],
                  ['lid_only', 'Lid Only'],
                ] as [BoxExportParts, string][]
              ).map(([partOpt, label]) => (
                <button
                  key={partOpt}
                  type="button"
                  onClick={() =>
                    setParams((p) => ({ ...p, boxExportParts: partOpt }))
                  }
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                    (params.boxExportParts || 'both') === partOpt
                      ? 'bg-teal-50 text-teal-800 border border-teal-300 font-bold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* =================================================================== */
        /* FLAT BADGE / PLAQUE CONFIGURATION                                   */
        /* =================================================================== */
        <div className="space-y-3 pt-1 border-t border-slate-200/80">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Outer Frame / Rim Stroke
            </span>
            <button
              type="button"
              onClick={() =>
                setParams((p) => ({
                  ...p,
                  strokeEnabled: !p.strokeEnabled,
                }))
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                params.strokeEnabled
                  ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-300'
              }`}
            >
              {params.strokeEnabled ? 'Frame ON' : 'Add Frame'}
            </button>
          </div>

          {params.strokeEnabled && (
            <div className="bg-white border border-slate-200/90 rounded-xl p-3 space-y-3">
              {/* Frame Shape */}
              <div className="space-y-1">
                <span className="text-xs text-slate-600 font-medium block">
                  Frame Shape
                </span>
                <div className="grid grid-cols-4 gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  {(
                    [
                      ['contour', 'Contour'],
                      ['square', 'Square'],
                      ['circle', 'Circle'],
                      ['rectangle', 'Rect'],
                    ] as [BoxOutlineShape, string][]
                  ).map(([shapeOpt, label]) => {
                    const active = (params.strokeShape || 'contour') === shapeOpt;
                    return (
                      <button
                        key={shapeOpt}
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            strokeShape: shapeOpt,
                            strokeFillInnerGaps:
                              shapeOpt !== 'contour' ? true : p.strokeFillInnerGaps,
                          }))
                        }
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer truncate ${
                          active
                            ? 'bg-white text-blue-700 shadow-2xs font-bold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Frame Color */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-600 font-medium">
                    Frame &amp; Base Colour
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-slate-600">
                      {params.strokeColorHex}
                    </span>
                    <input
                      type="color"
                      value={params.strokeColorHex}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          strokeColorHex: e.target.value.toUpperCase(),
                        }))
                      }
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-8 gap-1.5">
                  {BAMBU_FILAMENT_SWATCHES.map((sw) => {
                    const active = params.strokeColorHex === sw.hex;
                    return (
                      <button
                        key={sw.hex}
                        type="button"
                        onClick={() =>
                          setParams((p) => ({ ...p, strokeColorHex: sw.hex }))
                        }
                        className={`w-6 h-6 rounded-md border transition-transform cursor-pointer ${
                          active
                            ? 'border-blue-600 ring-2 ring-blue-500/30 scale-105'
                            : 'border-slate-300 hover:scale-110'
                        }`}
                        style={{ backgroundColor: sw.hex }}
                        title={sw.name}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Stroke Width */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600">Frame Width</span>
                  <span className="font-mono font-semibold text-teal-700">
                    {params.strokeWidthMm.toFixed(1)} mm
                  </span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={10.0}
                  step={0.2}
                  value={params.strokeWidthMm}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      strokeWidthMm: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              {/* Stroke Profile Style */}
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-600 block">
                  3D Surface Profile
                </span>
                <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  {(
                    [
                      ['flush_top_and_base', 'Flush + Base'],
                      ['raised_rim_and_base', 'Raised Rim'],
                      ['stepped_base_only', 'Base Offset'],
                    ] as [StrokeProfileStyle, string][]
                  ).map(([style, label]) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() =>
                        setParams((p) => ({ ...p, strokeProfileStyle: style }))
                      }
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                        params.strokeProfileStyle === style
                          ? 'bg-white text-blue-700 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick Jump to Internal Dividing Walls in Box Mode */}
          <div className="p-3 rounded-xl bg-teal-50/80 border border-teal-200/90 flex items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <LayoutGrid className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="text-slate-700 text-[11px] leading-tight">
                Looking for <strong>Internal Dividing Walls</strong>? They are available in <strong>Box + Lid</strong> mode.
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                setParams((p) => ({
                  ...p,
                  boxMode: true,
                  boxDividersEnabled: true,
                  strokeEnabled: true,
                  strokeFillInnerGaps: true,
                }))
              }
              className="px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-[11px] shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Box Mode
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
