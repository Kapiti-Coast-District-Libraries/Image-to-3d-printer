import React from 'react';
import { SampleArtwork } from '../lib/sampleArtworks';
import { Upload, ImageIcon } from 'lucide-react';

interface SourceArtworkSectionProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  samples: SampleArtwork[];
  activeSampleId: string;
  onSelectSample: (sample: SampleArtwork) => void;
}

export const SourceArtworkSection: React.FC<SourceArtworkSectionProps> = ({
  fileInputRef,
  samples,
  activeSampleId,
  onSelectSample,
}) => {
  return (
    <section className="space-y-3 bg-slate-50/80 border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 text-teal-700" />
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
            02. Source Artwork
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-500">
          PNG · JPG · Paste
        </span>
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-4 px-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-teal-500 bg-white hover:bg-teal-50/30 transition-colors flex flex-col items-center justify-center text-center cursor-pointer shadow-2xs group"
      >
        <Upload className="w-5 h-5 text-teal-700 mb-1.5 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-semibold text-slate-800">
          Drop image or click to browse
        </span>
        <span className="text-[11px] text-slate-500 mt-0.5">
          Auto-quantizes to 4 AMS colours · Supports Ctrl+V paste
        </span>
      </button>

      {/* Quick Test Samples */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="font-medium">Or try an example logo:</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {samples.map((sample) => {
            const active = activeSampleId === sample.id;
            return (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSelectSample(sample)}
                className={`py-1.5 px-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer truncate ${
                  active
                    ? 'bg-teal-50 text-teal-800 border-teal-300 font-bold shadow-2xs'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {sample.title}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
