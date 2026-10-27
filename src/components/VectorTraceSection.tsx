import React from 'react';
import { TraceParameters } from '../lib/colorQuantizer';
import { ChevronDown, ChevronRight, RotateCcw, Sliders } from 'lucide-react';

interface VectorTraceSectionProps {
  params: TraceParameters;
  setParams: React.Dispatch<React.SetStateAction<TraceParameters>>;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const VectorTraceSection: React.FC<VectorTraceSectionProps> = ({
  params,
  setParams,
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
          <Sliders className="w-3.5 h-3.5 text-teal-700 shrink-0" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide truncate">
            06. Vector Smoothing Engine
          </h3>
          <span className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.2 rounded-full hidden sm:inline">
            ε {params.smoothEpsilon.toFixed(2)}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setParams((p) => ({
                ...p,
                smoothEpsilon: 1.15,
                cornerSimplify: 0.32,
                despeckleLevel: 1,
                minIslandPx: 18,
                fieldBlurPasses: 1,
                closeColorGaps: true,
                seamOverlapMm: 0.0,
              }));
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-1 cursor-pointer"
            title="Reset to recommended defaults"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded cursor-pointer"
          >
            {isExpanded ? 'Collapse' : 'Tune'}
          </button>
        </div>
      </div>

      {/* Expanded Content Body */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 border-t border-slate-200/80 bg-slate-50/50">
          <p className="text-xs text-slate-500 leading-relaxed">
            Inkscape-style Potrace / Chaikin spline smoothing and corner simplification algorithms.
          </p>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Curve Smoothness (Chaikin Spline)</span>
              <span className="font-mono font-semibold text-teal-700">
                {params.smoothEpsilon.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2.4}
              step={0.05}
              value={params.smoothEpsilon}
              onChange={(e) =>
                setParams((p) => ({ ...p, smoothEpsilon: parseFloat(e.target.value) }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Shade &amp; Gradient Flattening</span>
              <span className="font-mono font-semibold text-slate-700">
                {params.despeckleLevel === 0
                  ? 'Off'
                  : `Level ${params.despeckleLevel}`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={params.despeckleLevel}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  despeckleLevel: parseInt(e.target.value, 10),
                }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Suppress Speckles (Min Island)</span>
              <span className="font-mono font-semibold text-slate-700">
                {params.minIslandPx} px²
              </span>
            </div>
            <input
              type="range"
              min={4}
              max={80}
              step={2}
              value={params.minIslandPx}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  minIslandPx: parseInt(e.target.value, 10),
                }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Path Simplification (RDP)</span>
              <span className="font-mono font-semibold text-slate-700">
                {params.cornerSimplify.toFixed(2)} px
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1.2}
              step={0.05}
              value={params.cornerSimplify}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  cornerSimplify: parseFloat(e.target.value),
                }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>
        </div>
      )}
    </section>
  );
};
