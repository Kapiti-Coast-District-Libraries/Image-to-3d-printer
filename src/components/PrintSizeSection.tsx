import React from 'react';
import { TraceParameters, MultiColorTraceResult } from '../lib/colorQuantizer';
import { ExtrudedModelResult } from '../lib/meshExtruder';
import { Ruler } from 'lucide-react';

interface PrintSizeSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  extrudedModel: ExtrudedModelResult | null;
  traceResult?: MultiColorTraceResult | null;
}

export const PrintSizeSection: React.FC<PrintSizeSectionProps> = ({
  params,
  setParams,
  extrudedModel,
  traceResult,
}) => {
  return (
    <section className="space-y-3.5 bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Ruler className="w-4 h-4 text-teal-700" />
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            03. Print Size &amp; Thickness
          </h3>
        </div>
        {extrudedModel && (
          <span className="font-mono text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-lg">
            {extrudedModel.dimensionsMm.width.toFixed(0)} × {extrudedModel.dimensionsMm.depth.toFixed(0)} × {extrudedModel.dimensionsMm.height.toFixed(1)} mm
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Set the physical print size and layer thickness for Bambu Studio slicer export.
      </p>

      {/* 1. Target Print Width (mm) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="target-width-input" className="font-semibold text-slate-700">
            Target Print Width (X)
          </label>
          <div className="flex items-center gap-1">
            <input
              id="target-width-input"
              type="number"
              min={25}
              max={256}
              step={1}
              value={params.targetWidthMm}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                  setParams((p) => ({ ...p, targetWidthMm: Math.min(256, Math.max(20, val)) }));
                }
              }}
              className="w-16 font-mono text-xs font-bold text-teal-800 bg-white border border-slate-300 rounded-md px-1.5 py-0.5 text-right focus:outline-teal-600"
            />
            <span className="text-xs font-medium text-slate-500">mm</span>
          </div>
        </div>

        <input
          type="range"
          min={30}
          max={250}
          step={1}
          value={params.targetWidthMm}
          onChange={(e) =>
            setParams((p) => ({
              ...p,
              targetWidthMm: parseFloat(e.target.value),
            }))
          }
          className="w-full accent-blue-600 cursor-pointer"
        />

        {/* Proportional Depth or Independent Rectangle Length (Y) */}
        {params.strokeShape === 'rectangle' ? (
          <div className="space-y-1.5 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="target-depth-input" className="font-semibold text-slate-700">
                Target Print Length (Y)
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="target-depth-input"
                  type="number"
                  min={20}
                  max={256}
                  step={1}
                  value={params.rectDepthMm ?? 65}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) {
                      setParams((p) => ({ ...p, rectDepthMm: Math.min(256, Math.max(15, val)) }));
                    }
                  }}
                  className="w-16 font-mono text-xs font-bold text-teal-800 bg-white border border-slate-300 rounded-md px-1.5 py-0.5 text-right focus:outline-teal-600"
                />
                <span className="text-xs font-medium text-slate-500">mm</span>
              </div>
            </div>

            <input
              type="range"
              min={20}
              max={250}
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

            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>
                Rectangle Size:{' '}
                <strong className="text-slate-700">
                  {params.targetWidthMm.toFixed(0)} × {(params.rectDepthMm ?? 65).toFixed(0)} mm
                </strong>{' '}
                ({((params.targetWidthMm) / (params.rectDepthMm ?? 65)).toFixed(2)}:1)
              </span>
              <span>
                {params.targetWidthMm <= 180 && (params.rectDepthMm ?? 65) <= 180 ? (
                  <span className="text-teal-700 font-sans font-medium">✓ A1 Mini &amp; 256mm</span>
                ) : params.targetWidthMm <= 256 && (params.rectDepthMm ?? 65) <= 256 ? (
                  <span className="text-blue-700 font-sans font-medium">✓ Fits Bambu 256mm</span>
                ) : (
                  <span className="text-amber-600 font-sans font-medium">⚠ Near bed edge</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>
              Resulting Length (Y):{' '}
              <strong className="text-slate-700">
                {extrudedModel
                  ? `${extrudedModel.dimensionsMm.depth.toFixed(1)} mm`
                  : traceResult
                  ? `${((params.targetWidthMm * traceResult.height) / traceResult.width).toFixed(1)} mm`
                  : '—'}
              </strong>
            </span>
            <span>
              {params.targetWidthMm <= 180 && (extrudedModel?.dimensionsMm.depth ?? 0) <= 180 ? (
                <span className="text-teal-700 font-sans font-medium">✓ A1 Mini &amp; 256mm</span>
              ) : params.targetWidthMm <= 256 && (extrudedModel?.dimensionsMm.depth ?? 0) <= 256 ? (
                <span className="text-blue-700 font-sans font-medium">✓ Fits Bambu 256mm</span>
              ) : (
                <span className="text-amber-600 font-sans font-medium">⚠ Near bed edge</span>
              )}
            </span>
          </div>
        )}

        {/* Lid Artwork Logo Size readout when geometric shape */}
        {params.strokeShape !== 'contour' && traceResult?.logoDimensionsMm && (
          <div className="flex items-center justify-between text-[11px] bg-teal-50/70 border border-teal-200/80 rounded-lg px-2.5 py-1">
            <span className="text-slate-600 font-medium">Lid Artwork Logo:</span>
            <span className="font-mono font-bold text-teal-800">
              {traceResult.logoDimensionsMm.width.toFixed(1)} × {traceResult.logoDimensionsMm.height.toFixed(1)} mm ({traceResult.logoDimensionsMm.scalePercent}% scale)
            </span>
          </div>
        )}

        {/* Quick Preset Buttons */}
        <div className="grid grid-cols-5 gap-1 pt-1">
          {[
            { label: '50mm', tip: 'Keychain', val: 50 },
            { label: '80mm', tip: 'Coaster', val: 80 },
            { label: '95mm', tip: 'Default', val: 95 },
            { label: '140mm', tip: 'Desk Sign', val: 140 },
            { label: '200mm', tip: 'Large', val: 200 },
          ].map((preset) => (
            <button
              key={preset.val}
              type="button"
              onClick={() => setParams((p) => ({ ...p, targetWidthMm: preset.val }))}
              className={`py-1 px-1 rounded-lg text-[10px] font-semibold border transition-all cursor-pointer text-center truncate ${
                params.targetWidthMm === preset.val
                  ? 'bg-blue-50 text-blue-700 border-blue-300 ring-1 ring-blue-400 font-bold'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
              }`}
              title={preset.tip}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Base Plate Thickness */}
      <div className="space-y-1.5 pt-1 border-t border-slate-200">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="base-plate-input" className="font-semibold text-slate-700">
            {params.boxMode ? 'Lid Backplate Thickness' : 'Solid Backplate Thickness'}
          </label>
          <div className="flex items-center gap-1">
            <input
              id="base-plate-input"
              type="number"
              min={0.8}
              max={6.0}
              step={0.2}
              value={params.baseThicknessMm}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                  setParams((p) => ({
                    ...p,
                    baseThicknessMm: Math.min(6.0, Math.max(0.8, val)),
                  }));
                }
              }}
              className="w-16 font-mono text-xs font-bold text-teal-800 bg-white border border-slate-300 rounded-md px-1.5 py-0.5 text-right focus:outline-teal-600"
            />
            <span className="text-xs font-medium text-slate-500">mm</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: '1.2 mm', val: 1.2 },
            { label: '1.6 mm', val: 1.6 },
            { label: '2.0 mm', val: 2.0 },
            { label: '2.4 mm', val: 2.4 },
          ].map(({ label, val }) => (
            <button
              key={val}
              type="button"
              onClick={() => setParams((p) => ({ ...p, baseThicknessMm: val }))}
              className={`py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                Math.abs(params.baseThicknessMm - val) < 0.05
                  ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Card: Total Dimensions */}
      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
        <div className="flex items-center justify-between text-slate-600">
          <span>Total 3D Bounding Box:</span>
          <span className="font-mono font-bold text-slate-800">
            {extrudedModel ? (
              `${extrudedModel.dimensionsMm.width.toFixed(1)} × ${extrudedModel.dimensionsMm.depth.toFixed(1)} × ${extrudedModel.dimensionsMm.height.toFixed(2)} mm`
            ) : (
              `${params.targetWidthMm.toFixed(1)} mm wide`
            )}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Inlay Detail Depth:</span>
          <span className="font-mono font-medium text-slate-700">0.40 mm (2 layers @ 0.20mm)</span>
        </div>
        {params.boxMode && (
          <div className="flex items-center justify-between text-[11px] text-teal-800">
            <span>Hollow Box Height:</span>
            <span className="font-mono font-semibold">
              {(params.boxHeightMm ?? 28).toFixed(0)} mm
            </span>
          </div>
        )}
      </div>
    </section>
  );
};
