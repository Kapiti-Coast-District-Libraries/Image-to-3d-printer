import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxExportParts,
  BoxLidStyle,
  BoxPlateLayout,
  ColorSlotConfig,
  DetectedImageSwatch,
  ExtrusionMode,
  MergeItemTargetMode,
  MergedRegionRule,
  MultiColorTraceResult,
  RemovedColorRule,
  RGB,
  StrokeProfileStyle,
  TraceParameters,
  colorDistSq,
  extractDominantImageSwatches,
  hexToRgb,
  rgbToHex,
  runMultiColorTracePipeline,
} from './lib/colorQuantizer';
import { buildExtrudedModel, ExtrudedModelResult } from './lib/meshExtruder';
import {
  Bambu3mfColorFormat,
  generateBambu3mfBlob,
  generateCleanSvgString,
} from './lib/export3mf';
import {
  findClosestBambuFilament,
  OFFICIAL_BAMBU_FILAMENTS,
} from './lib/bambuFilaments';
import { SAMPLE_ARTWORKS, SampleArtwork } from './lib/sampleArtworks';
import { Viewport3D } from './components/Viewport3D';
import {
  EyedropperTarget,
  InspectorSubMode,
  VectorInspector2D,
} from './components/VectorInspector2D';
import {
  Upload,
  Download,
  Pipette,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  FileCode2,
  Check,
  RotateCcw,
  Eraser,
  X,
  MousePointerClick,
  Undo2,
  ArrowRight,
  PackageOpen,
} from 'lucide-react';

type MainViewMode = '3d_plate' | 'vector_paths' | 'quantized_flat' | 'side_by_side';

const BAMBU_FILAMENT_SWATCHES = [
  { name: 'Charcoal Black', hex: '#141821' },
  { name: 'Jade White', hex: '#F8FAFC' },
  { name: 'Scarlet Red', hex: '#E12D39' },
  { name: 'Bambu Green', hex: '#00AE42' },
  { name: 'Sunlu Gold', hex: '#F59E0B' },
  { name: 'Mandarin Orange', hex: '#F97316' },
  { name: 'Electric Cyan', hex: '#06B6D4' },
  { name: 'Cobalt Blue', hex: '#2563EB' },
];

const MAX_TRACE_DIMENSION = 460;

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeView, setActiveView] = useState<MainViewMode>('3d_plate');
  const [projectName, setProjectName] = useState<string>('Kitsune_Emblem_4Color');
  const [activeSampleId, setActiveSampleId] = useState<string>('kitsune_emblem');
  const [sourceImageData, setSourceImageData] = useState<ImageData | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const [params, setParams] = useState<TraceParameters>({
    numColors: 4,
    bgRemovalMode: 'perimeter_flood',
    bgTolerance: 24,
    customBgColor: null,
    removedColors: [],
    mergedRegions: [],
    despeckleLevel: 1,
    minIslandPx: 18,
    smoothEpsilon: 1.15,
    cornerSimplify: 0.32,
    fieldBlurPasses: 1,
    closeColorGaps: true,
    seamOverlapMm: 0.0,
    strokeEnabled: false,
    strokeWidthMm: 2.5,
    strokeColorHex: '#F8FAFC',
    strokeFillInnerGaps: true,
    strokeProfileStyle: 'flush_top_and_base',
    boxMode: false,
    boxHeightMm: 28,
    boxLidStyle: 'flush_recessed',
    boxLidToleranceMm: 0.2,
    boxLedgeWidthMm: 1.4,
    boxPlateLayout: 'assembled',
    boxLidLiftMm: 16,
    boxExportParts: 'both',
    extrusionMode: 'backed_inlay',
    targetWidthMm: 95,
    baseThicknessMm: 2.0,
    inlayThicknessMm: 0.8,
    baseSlotIndex: 0,
  });

  const [slotConfigs, setSlotConfigs] = useState<ColorSlotConfig[]>([
    {
      id: 0,
      name: 'AMS Slot 1',
      detectedHex: '#141821',
      printHex: '#141821',
      lockedSourceHex: null,
      enabled: true,
      zHeightOffsetMm: 0,
      pixelCount: 0,
      coveragePercent: 0,
    },
    {
      id: 1,
      name: 'AMS Slot 2',
      detectedHex: '#E12D39',
      printHex: '#E12D39',
      lockedSourceHex: null,
      enabled: true,
      zHeightOffsetMm: 0,
      pixelCount: 0,
      coveragePercent: 0,
    },
    {
      id: 2,
      name: 'AMS Slot 3',
      detectedHex: '#F59E0B',
      printHex: '#F59E0B',
      lockedSourceHex: null,
      enabled: true,
      zHeightOffsetMm: 0,
      pixelCount: 0,
      coveragePercent: 0,
    },
    {
      id: 3,
      name: 'AMS Slot 4',
      detectedHex: '#F8FAFC',
      printHex: '#F8FAFC',
      lockedSourceHex: null,
      enabled: true,
      zHeightOffsetMm: 0,
      pixelCount: 0,
      coveragePercent: 0,
    },
  ]);

  const [highlightedSlot, setHighlightedSlot] = useState<number | null>(null);
  const [eyedropperTarget, setEyedropperTarget] = useState<EyedropperTarget>(null);
  const [mergeItemMode, setMergeItemMode] = useState<boolean>(false);
  const [mergeItemTargetMode, setMergeItemTargetMode] =
    useState<MergeItemTargetMode>('surrounding');
  const [flipFaceDown, setFlipFaceDown] = useState<boolean>(false);
  const [snapToOfficialBambuHex, setSnapToOfficialBambuHex] = useState<boolean>(false);
  const [bambuColorFormat, setBambuColorFormat] =
    useState<Bambu3mfColorFormat>('bambu_project');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportSuccessText, setExportSuccessText] = useState<string | null>(null);
  const [openColorPickerSlot, setOpenColorPickerSlot] = useState<number | null>(null);

  // Load initial sample artwork on mount
  const loadSampleArtwork = useCallback((sample: SampleArtwork) => {
    const offscreen = document.createElement('canvas');
    sample.renderToCanvas(offscreen);
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);

    setActiveSampleId(sample.id);
    setProjectName(sample.title.replace(/\s+/g, '_'));
    setMergeItemMode(false);
    setEyedropperTarget(null);
    setParams((prev) => ({
      ...prev,
      customBgColor: null,
      removedColors: [],
      mergedRegions: [],
      bgRemovalMode: sample.id === 'monstera_leaf' ? 'global_color' : 'perimeter_flood',
    }));
    setSlotConfigs((prev) =>
      prev.map((s) => ({
        ...s,
        lockedSourceHex: null,
        mergedIntoSlot: null,
        enabled: true,
      }))
    );
    setSourceImageData(imgData);
  }, []);

  useEffect(() => {
    loadSampleArtwork(SAMPLE_ARTWORKS[0]);
  }, [loadSampleArtwork]);

  // Process uploaded or pasted image file into properly scaled ImageData
  const handleImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const pad = 28;
        const maxInner = MAX_TRACE_DIMENSION - pad * 2;
        const scale = Math.min(1, maxInner / Math.max(img.width, img.height));
        const innerW = Math.max(32, Math.round(img.width * scale));
        const innerH = Math.max(32, Math.round(img.height * scale));
        const w = innerW + pad * 2;
        const h = innerH + pad * 2;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, pad, pad, innerW, innerH);
        // Sample top-left pixel of the drawn image; if opaque, fill outer margin with that background colour
        // so exterior flood-fill and outer stroke expansion have unclipped margin room
        const corner = ctx.getImageData(pad, pad, 1, 1).data;
        if (corner[3] >= 200) {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})`;
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, pad, pad, innerW, innerH);
        }
        const imgData = ctx.getImageData(0, 0, w, h);

        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        setProjectName(cleanName || 'Custom_Trace_4Color');
        setActiveSampleId('custom');
        setMergeItemMode(false);
        setEyedropperTarget(null);
        setParams((prev) => ({
          ...prev,
          customBgColor: null,
          removedColors: [],
          mergedRegions: [],
        }));
        setSlotConfigs((prev) =>
          prev.map((s) => ({
            ...s,
            lockedSourceHex: null,
            mergedIntoSlot: null,
            enabled: true,
          }))
        );
        setSourceImageData(imgData);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  // Support Ctrl+V / Cmd+V clipboard image paste anywhere in the app
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleImageFile]);

  // Extract dominant image swatches so user can click any swatch to remove/restore that colour
  const imageSwatches: DetectedImageSwatch[] = useMemo(() => {
    if (!sourceImageData) return [];
    return extractDominantImageSwatches(sourceImageData, 7);
  }, [sourceImageData]);

  // Run the 4-Colour Quantization + Inkscape Vector Trace Pipeline
  // Memoized strictly on 2D trace parameters so dragging 3D geometry/box sliders runs at 60 FPS
  const traceResult: MultiColorTraceResult | null = useMemo(() => {
    if (!sourceImageData) return null;
    return runMultiColorTracePipeline(sourceImageData, params, slotConfigs);
  }, [
    sourceImageData,
    slotConfigs,
    params.numColors,
    params.bgRemovalMode,
    params.bgTolerance,
    params.customBgColor,
    params.removedColors,
    params.mergedRegions,
    params.despeckleLevel,
    params.minIslandPx,
    params.smoothEpsilon,
    params.cornerSimplify,
    params.fieldBlurPasses,
    params.closeColorGaps,
    params.strokeEnabled,
    params.boxMode,
    params.strokeWidthMm,
    params.strokeColorHex,
    params.strokeFillInnerGaps,
    params.boxLedgeWidthMm,
    params.targetWidthMm,
    params.extrusionMode,
  ]);

  // Build the 3D Manifold Extruded Model from the Traced Vector Contours
  const extrudedModel: ExtrudedModelResult | null = useMemo(() => {
    if (!traceResult) return null;
    return buildExtrudedModel(traceResult, params);
  }, [traceResult, params]);

  // Add or toggle a colour in the Removed Colours list
  const addOrToggleRemovedColor = useCallback(
    (rgb: RGB, preferredScope: 'global' | 'exterior_only' = 'global') => {
      const hex = rgbToHex(rgb);
      setParams((prev) => {
        // Check if a perceptually similar colour is already in removedColors
        const existingIdx = prev.removedColors.findIndex(
          (r) => colorDistSq(r.rgb, rgb) < 6500
        );
        if (existingIdx >= 0) {
          // Remove the rule (restore the colour)
          const updated = prev.removedColors.filter((_, i) => i !== existingIdx);
          return { ...prev, removedColors: updated };
        }
        const newRule: RemovedColorRule = {
          id: `${hex}_${Date.now()}`,
          rgb,
          hex,
          tolerance: 22,
          scope: preferredScope,
          enabled: true,
        };
        return {
          ...prev,
          removedColors: [...prev.removedColors, newRule],
        };
      });
    },
    []
  );

  // Check if a swatch is currently removed (either via auto border BG or custom removedColors)
  const isSwatchRemoved = useCallback(
    (swatch: DetectedImageSwatch): boolean => {
      for (const rule of params.removedColors) {
        if (rule.enabled && colorDistSq(rule.rgb, swatch.rgb) < 6500) {
          return true;
        }
      }
      return false;
    },
    [params.removedColors]
  );

  // Handle Eyedropper Colour Pick from Original Image
  const handlePickColorFromImage = (rgb: RGB) => {
    const pickedHex = rgbToHex(rgb);
    if (eyedropperTarget === 'remove_color') {
      addOrToggleRemovedColor(rgb, 'global');
    } else if (eyedropperTarget === 'background') {
      setParams((prev) => ({
        ...prev,
        customBgColor: rgb,
        bgRemovalMode: prev.bgRemovalMode === 'none' ? 'perimeter_flood' : prev.bgRemovalMode,
      }));
    } else if (typeof eyedropperTarget === 'number') {
      const slotIdx = eyedropperTarget;
      setSlotConfigs((prev) =>
        prev.map((s, idx) =>
          idx === slotIdx
            ? {
                ...s,
                lockedSourceHex: pickedHex,
                printHex: pickedHex,
              }
            : s
        )
      );
    }
    setEyedropperTarget(null);
  };

  // Toggle whether a specific AMS Slot is included or removed from the 3D print & trace
  const handleToggleSlotEnabled = useCallback((slotIndex: number) => {
    if (slotIndex === 4) {
      setParams((p) => ({ ...p, strokeEnabled: false, boxMode: false }));
      return;
    }
    setSlotConfigs((prev) =>
      prev.map((s, idx) =>
        idx === slotIndex
          ? { ...s, enabled: !s.enabled, mergedIntoSlot: null }
          : s.mergedIntoSlot === slotIndex
          ? { ...s, mergedIntoSlot: null }
          : s
      )
    );
  }, []);

  // Merge sourceSlotIndex into targetSlotIndex (or pass null to unmerge)
  const handleMergeSlotInto = useCallback(
    (sourceSlotIndex: number, targetSlotIndex: number | null) => {
      setSlotConfigs((prev) =>
        prev.map((s, idx) => {
          if (idx === sourceSlotIndex) {
            return {
              ...s,
              enabled: true,
              mergedIntoSlot: targetSlotIndex,
            };
          }
          if (targetSlotIndex !== null && idx === targetSlotIndex) {
            return {
              ...s,
              enabled: true,
              mergedIntoSlot:
                s.mergedIntoSlot === sourceSlotIndex ? null : s.mergedIntoSlot,
            };
          }
          // If another slot was already merged into sourceSlotIndex, redirect it to targetSlotIndex
          if (targetSlotIndex !== null && s.mergedIntoSlot === sourceSlotIndex) {
            return {
              ...s,
              mergedIntoSlot: targetSlotIndex,
            };
          }
          return s;
        })
      );
    },
    []
  );

  // Unmerge all merged slots
  const handleUnmergeAllSlots = useCallback(() => {
    setSlotConfigs((prev) => prev.map((s) => ({ ...s, mergedIntoSlot: null })));
  }, []);

  // Detect the pair of active, unmerged slots with the most similar colours
  const closestMergeablePair = useMemo(() => {
    if (!traceResult) return null;
    const activeUnmerged = traceResult.layers.filter(
      (l) => l.enabled && l.mergedIntoSlot == null
    );
    if (activeUnmerged.length < 2) return null;

    let bestA = activeUnmerged[0];
    let bestB = activeUnmerged[1];
    let bestDistSq = Infinity;

    for (let i = 0; i < activeUnmerged.length; i++) {
      for (let j = i + 1; j < activeUnmerged.length; j++) {
        const a = activeUnmerged[i];
        const b = activeUnmerged[j];
        const dSq = colorDistSq(hexToRgb(a.printHex), hexToRgb(b.printHex));
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestA = a;
          bestB = b;
        }
      }
    }

    // Merge higher slot number into lower slot number by default (e.g. Slot 4 -> Slot 3)
    const target = bestA.slotIndex < bestB.slotIndex ? bestA : bestB;
    const source = bestA.slotIndex < bestB.slotIndex ? bestB : bestA;
    return { target, source, distSq: bestDistSq };
  }, [traceResult]);

  // Resolve highlightedSlot so hovering over a merged slot highlights its combined target geometry
  const effectiveHighlightedSlot = useMemo(() => {
    if (highlightedSlot === null) return null;
    const layer = traceResult?.layers.find((l) => l.slotIndex === highlightedSlot);
    if (layer && layer.mergedIntoSlot != null) {
      return layer.mergedIntoSlot;
    }
    return highlightedSlot;
  }, [highlightedSlot, traceResult]);

  // Snap all active AMS slots (and stroke if enabled) to their closest official Bambu Lab PLA filament hex
  const handleSnapAllToBambuFilaments = useCallback(() => {
    if (!traceResult) return;
    setSlotConfigs((prev) =>
      prev.map((slot) => {
        const layer = traceResult.layers.find((l) => l.slotIndex === slot.id);
        const sourceHex = layer ? layer.detectedHex : slot.detectedHex;
        const match = findClosestBambuFilament(sourceHex);
        return {
          ...slot,
          printHex: match.preset.hex,
          lockedSourceHex: slot.lockedSourceHex || sourceHex,
        };
      })
    );
    if (params.strokeEnabled || params.boxMode) {
      const strokeMatch = findClosestBambuFilament(params.strokeColorHex);
      setParams((p) => ({ ...p, strokeColorHex: strokeMatch.preset.hex }));
    }
  }, [traceResult, params.strokeEnabled, params.boxMode, params.strokeColorHex]);

  // Export Bambu Studio Ready .3MF File
  const handleExport3MF = async () => {
    if (!extrudedModel || isExporting) return;
    setIsExporting(true);
    try {
      // When Box Mode is active and exporting Both (Box + Lid), always lay out the Box and Lid
      // side-by-side flat on Z = 0 in the .3MF file so Bambu Studio slices them with zero mid-air overhangs.
      const modelForExport =
        params.boxMode &&
        traceResult &&
        (params.boxPlateLayout === 'assembled' || (params.boxLidLiftMm ?? 0) > 0) &&
        (params.boxExportParts ?? 'both') === 'both'
          ? buildExtrudedModel(traceResult, {
              ...params,
              boxPlateLayout: 'side_by_side',
              boxLidLiftMm: 0,
            })
          : extrudedModel;

      const blob = await generateBambu3mfBlob(modelForExport, {
        projectName,
        flipFaceDown,
        slotConfigs,
        snapToOfficialBambuHex,
        colorFormat: bambuColorFormat,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = params.boxMode
        ? `${projectName}_Box_And_Lid.3mf`
        : `${projectName}_Bambu_4Color.3mf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccessText(
        params.boxMode ? 'Box + Lid .3MF Exported' : '3MF Exported (Auto-Colour)'
      );
      setTimeout(() => setExportSuccessText(null), 2800);
    } finally {
      setIsExporting(false);
    }
  };

  // Export Clean Inkscape .SVG Vector File
  const handleExportSVG = () => {
    if (!traceResult) return;
    const svgContent = generateCleanSvgString(traceResult);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_Vectors.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activateEyedropper = (target: Exclude<EyedropperTarget, null>) => {
    if (eyedropperTarget === target) {
      setEyedropperTarget(null);
    } else {
      setMergeItemMode(false);
      setEyedropperTarget(target);
      if (activeView === '3d_plate') {
        setActiveView('side_by_side');
      }
    }
  };

  const handleToggleMergeItemMode = useCallback(() => {
    setMergeItemMode((prev) => {
      const next = !prev;
      if (next) {
        setEyedropperTarget(null);
      }
      return next;
    });
  }, []);

  const handleMergeItemAtPixel = useCallback(
    (pixelX: number, pixelY: number) => {
      setParams((prev) => {
        const current = prev.mergedRegions || [];
        const newRule: MergedRegionRule = {
          id: `item_${pixelX}_${pixelY}_${Date.now()}`,
          x: pixelX,
          y: pixelY,
          targetMode: mergeItemTargetMode,
        };
        return {
          ...prev,
          mergedRegions: [...current, newRule],
        };
      });
    },
    [mergeItemTargetMode]
  );

  const handleUndoLastMergedRegion = useCallback(() => {
    setParams((prev) => {
      const current = prev.mergedRegions || [];
      if (current.length === 0) return prev;
      return {
        ...prev,
        mergedRegions: current.slice(0, -1),
      };
    });
  }, []);

  const handleRemoveMergedRegionById = useCallback((id: string) => {
    setParams((prev) => ({
      ...prev,
      mergedRegions: (prev.mergedRegions || []).filter((r) => r.id !== id),
    }));
  }, []);

  const handleUpdateMergedRegionTarget = useCallback(
    (id: string, targetMode: MergeItemTargetMode) => {
      setParams((prev) => ({
        ...prev,
        mergedRegions: (prev.mergedRegions || []).map((r) =>
          r.id === id ? { ...r, targetMode } : r
        ),
      }));
    },
    []
  );

  const handleClearMergedRegions = useCallback(() => {
    setParams((prev) => ({
      ...prev,
      mergedRegions: [],
    }));
  }, []);

  const mergedRegionsCount = params.mergedRegions?.length || 0;

  return (
    <div
      className="min-h-screen h-screen flex flex-col bg-[#0B0F17] text-slate-100 overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
          handleImageFile(file);
        }
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = '';
        }}
      />

      {/* Top Bar Contract: Zone 1 (Single Brand Element) — Zone 2 (View Switcher Links) — Zone 3 (Primary Actions) */}
      <header className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-white/10 bg-[#0B0F17] z-20">
        {/* Zone 1: Brand Title */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('3d_plate');
          }}
          className="text-lg font-bold tracking-tight text-white font-[var(--font-display)] whitespace-nowrap"
        >
          PolyTrace 3MF
        </a>

        {/* Zone 2: Viewport Mode Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setEyedropperTarget(null);
              setActiveView('3d_plate');
            }}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 cursor-pointer ${
              activeView === '3d_plate'
                ? 'text-emerald-400 border-emerald-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            3D Bambu Plate
          </button>
          <button
            type="button"
            onClick={() => setActiveView('vector_paths')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 cursor-pointer ${
              activeView === 'vector_paths'
                ? 'text-emerald-400 border-emerald-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            2D Vector Contours
          </button>
          <button
            type="button"
            onClick={() => setActiveView('quantized_flat')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 cursor-pointer ${
              activeView === 'quantized_flat'
                ? 'text-emerald-400 border-emerald-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            4-Colour Flatten
          </button>
          <button
            type="button"
            onClick={() => setActiveView('side_by_side')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 cursor-pointer ${
              activeView === 'side_by_side'
                ? 'text-emerald-400 border-emerald-400'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            Original vs Trace
          </button>
        </nav>

        {/* Zone 3: Primary Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-400" />
            <span>Upload Image</span>
          </button>

          <button
            type="button"
            onClick={handleExport3MF}
            disabled={!extrudedModel || isExporting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {exportSuccessText ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>{exportSuccessText}</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>{isExporting ? 'Building .3MF...' : 'Export Bambu .3MF'}</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main 3-Column CAD Studio Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: Image Source, Choose Colours to Remove & Inkscape Vector Parameters */}
        <aside className="w-80 xl:w-[350px] shrink-0 border-r border-white/10 bg-[#0E1420] overflow-y-auto p-5 space-y-6">
          {/* Section 01: Artwork Source & Sample Presets */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-semibold text-slate-200">01. Source Artwork</h2>
              <span className="text-[11px] text-slate-400">PNG · JPG · Paste</span>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 rounded-lg border border-dashed border-slate-700 hover:border-emerald-400/60 bg-slate-900/50 hover:bg-slate-900 transition-colors flex flex-col items-center justify-center text-center cursor-pointer"
            >
              <Upload className="w-4 h-4 text-emerald-400 mb-1" />
              <span className="text-xs font-medium text-slate-200">
                Drop image or click to browse
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                Auto-flattens gradients to 4 AMS colours
              </span>
            </button>

            {/* Sample Artworks */}
            <div className="mt-3">
              <div className="text-[11px] text-slate-400 mb-1.5">
                Or test with a multi-shade sample:
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SAMPLE_ARTWORKS.map((sample) => {
                  const active = activeSampleId === sample.id;
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => loadSampleArtwork(sample)}
                      className={`px-2.5 py-2 rounded-md text-left border transition-colors cursor-pointer ${
                        active
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900/60 border-white/5 text-slate-300 hover:border-white/15 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-medium truncate">{sample.title}</div>
                      <div className="flex items-center gap-1 mt-1">
                        {sample.recommendedSlots.map((hex, i) => (
                          <span
                            key={i}
                            className="w-2.5 h-2.5 rounded-full border border-white/20"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Section 02: Choose Colour(s) to Remove from Print / Trace */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-200">
                02. Choose Colours to Remove
              </h2>
              {traceResult && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono tabular-nums">
                  <span>Auto BG</span>
                  <span
                    className="w-3 h-3 rounded border border-white/20 inline-block"
                    style={{ backgroundColor: traceResult.detectedBgHex }}
                  />
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Click any detected image colour below or sample directly from the artwork to strip
              that colour from the trace and 3D print.
            </p>

            {/* Quick-Click Detected Image Swatches to Remove/Restore */}
            {imageSwatches.length > 0 && (
              <div className="bg-slate-950/70 border border-white/10 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Detected Image Colours (Click to Remove)</span>
                  {params.removedColors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setParams((p) => ({ ...p, removedColors: [] }))}
                      className="text-emerald-400 hover:underline cursor-pointer"
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
                        className={`group relative h-8 rounded-md border transition-transform cursor-pointer flex items-center justify-center overflow-hidden ${
                          removed
                            ? 'border-rose-500 ring-1 ring-rose-500/50 scale-95 opacity-75'
                            : 'border-white/20 hover:scale-105 hover:border-white'
                        }`}
                        style={{ backgroundColor: sw.hex }}
                        title={`${sw.hex} (${sw.percent}% of image) — Click to ${
                          removed ? 'restore to print' : 'remove from print/trace'
                        }`}
                      >
                        {removed && (
                          <div className=" inset-0 bg-slate-950/60 flex items-center justify-center w-full h-full">
                            <X className="w-4 h-4 text-rose-400 stroke-[2.5]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Interactive Eyedropper Button to Pick ANY Colour on Image to Remove */}
            <button
              type="button"
              onClick={() => activateEyedropper('remove_color')}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                eyedropperTarget === 'remove_color'
                  ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                  : 'bg-slate-900 hover:bg-slate-800 border-white/10 text-slate-200'
              }`}
            >
              <Eraser className="w-3.5 h-3.5 text-rose-400" />
              <span>
                {eyedropperTarget === 'remove_color'
                  ? 'Click Any Colour on Image to Remove...'
                  : 'Pick Colour on Image to Remove'}
              </span>
            </button>

            {/* Manual Click-to-Merge Item / Detail into Surrounding Colour */}
            <div className="bg-slate-950/80 border border-cyan-500/30 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                  <MousePointerClick className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Merge Individual Item / Detail</span>
                </span>
                {mergedRegionsCount > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleUndoLastMergedRegion}
                      className="text-[10px] text-cyan-300 hover:text-white bg-cyan-500/15 hover:bg-cyan-500/25 px-1.5 py-0.5 rounded border border-cyan-500/30 cursor-pointer flex items-center gap-1"
                      title="Undo last merged item"
                    >
                      <Undo2 className="w-2.5 h-2.5" />
                      <span>Undo</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearMergedRegions}
                      className="text-[10px] text-slate-400 hover:text-rose-300 px-1.5 py-0.5 rounded cursor-pointer"
                      title="Restore all manually merged items"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 leading-snug">
                Have unwanted small details, spots, or text? Activate <strong className="text-slate-200">Merge Item</strong> and click any part on the 3D model or 2D view to absorb just that item into its surrounding colour.
              </p>

              <button
                type="button"
                onClick={handleToggleMergeItemMode}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  mergeItemMode
                    ? 'bg-cyan-400 text-slate-950 border-cyan-300 shadow-sm'
                    : 'bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-500/40 text-cyan-200'
                }`}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>
                  {mergeItemMode
                    ? 'Merge Item Active — Click Details on Model/2D'
                    : 'Merge Item (Click Detail to Absorb)'}
                </span>
              </button>

              {/* Target Mode Selector for Click-to-Merge */}
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Merge clicked item into:</span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-md border border-white/10">
                  <button
                    type="button"
                    onClick={() => setMergeItemTargetMode('surrounding')}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer truncate ${
                      mergeItemTargetMode === 'surrounding'
                        ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Automatically detects the colour surrounding the clicked item and merges into it"
                  >
                    Surrounding
                  </button>
                  <button
                    type="button"
                    onClick={() => setMergeItemTargetMode(params.baseSlotIndex)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer truncate ${
                      typeof mergeItemTargetMode === 'number'
                        ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Merge clicked item into a specific AMS colour slot"
                  >
                    {typeof mergeItemTargetMode === 'number'
                      ? `Slot ${mergeItemTargetMode + 1}`
                      : 'Specific Slot'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMergeItemTargetMode('cutout')}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer truncate ${
                      mergeItemTargetMode === 'cutout'
                        ? 'bg-rose-500/25 text-rose-200 border border-rose-400/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Cut out / erase the clicked item into background space"
                  >
                    Cutout Hole
                  </button>
                </div>

                {typeof mergeItemTargetMode === 'number' && (
                  <div className="grid grid-cols-4 gap-1 pt-1">
                    {Array.from({ length: params.numColors }).map((_, idx) => {
                      const layerHex = traceResult?.layers[idx]?.printHex || slotConfigs[idx]?.printHex || '#334155';
                      const active = mergeItemTargetMode === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setMergeItemTargetMode(idx)}
                          className={`flex items-center justify-center gap-1 py-1 rounded border text-[10px] font-mono cursor-pointer ${
                            active
                              ? 'bg-slate-800 border-cyan-400 text-white'
                              : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full border border-white/30"
                            style={{ backgroundColor: layerHex }}
                          />
                          <span>S{idx + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Active Manually Merged Items List */}
              {traceResult && traceResult.resolvedMergedRegions.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-white/10">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Merged Items ({traceResult.resolvedMergedRegions.length})</span>
                    <span>Click × to restore</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                    {traceResult.resolvedMergedRegions.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-1.5 bg-slate-900/90 border border-white/10 rounded px-2 py-1 text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-mono text-slate-400">
                            #{idx + 1}
                          </span>
                          <span
                            className="w-3 h-3 rounded-sm border border-white/25 shrink-0"
                            style={{ backgroundColor: item.sourceHex }}
                            title={`Original item colour: Slot ${item.sourceSlotIndex + 1} (${item.sourceHex})`}
                          />
                          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span
                            className="w-3 h-3 rounded-sm border border-white/25 shrink-0"
                            style={{ backgroundColor: item.targetHex }}
                            title={
                              item.resolvedTargetSlot === -1
                                ? 'Merged into Cutout / Background'
                                : `Merged into Slot ${item.resolvedTargetSlot + 1} (${item.targetHex})`
                            }
                          />
                          <span className="text-[10px] text-slate-200 truncate">
                            {item.resolvedTargetSlot === -1
                              ? 'Cutout'
                              : item.resolvedTargetSlot === 4
                              ? 'Into Stroke'
                              : `Into Slot ${item.resolvedTargetSlot + 1}`}
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
                            className="bg-slate-950 border border-white/10 rounded px-1 py-0.5 text-[10px] text-slate-300 cursor-pointer"
                            title="Change where this item merges"
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
                            className="p-0.5 text-slate-400 hover:text-white rounded cursor-pointer"
                            title="Restore this detail"
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

            {/* Active Custom Removed Colours List with Individual Tolerance & Scope */}
            {params.removedColors.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-medium text-slate-300">
                  Removed Colours ({params.removedColors.length})
                </div>
                {params.removedColors.map((rule) => (
                  <div
                    key={rule.id}
                    className="bg-slate-900/90 border border-rose-500/30 rounded-lg p-2 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded border border-white/20 shrink-0"
                          style={{ backgroundColor: rule.hex }}
                        />
                        <span className="text-xs font-mono tabular-nums text-slate-200">
                          {rule.hex}
                        </span>
                        <span className="text-[10px] text-rose-300">· Cutout</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setParams((p) => ({
                              ...p,
                              removedColors: p.removedColors.map((r) =>
                                r.id === rule.id
                                  ? {
                                      ...r,
                                      scope:
                                        r.scope === 'global' ? 'exterior_only' : 'global',
                                    }
                                  : r
                              ),
                            }))
                          }
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 cursor-pointer"
                          title="Switch between removing this colour everywhere (including inside holes) vs only from the outside border"
                        >
                          {rule.scope === 'global' ? 'Everywhere' : 'Border Only'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setParams((p) => ({
                              ...p,
                              removedColors: p.removedColors.filter((r) => r.id !== rule.id),
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                          title="Restore this colour"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">
                        Match Range
                      </span>
                      <input
                        type="range"
                        min={4}
                        max={65}
                        step={1}
                        value={rule.tolerance}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setParams((p) => ({
                            ...p,
                            removedColors: p.removedColors.map((r) =>
                              r.id === rule.id ? { ...r, tolerance: val } : r
                            ),
                          }));
                        }}
                        className="flex-1 accent-rose-400 cursor-pointer h-1"
                      />
                      <span className="text-[10px] font-mono tabular-nums text-slate-400 w-7 text-right">
                        {rule.tolerance}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Exterior Background Mode Selector */}
            <div className="pt-1 space-y-2">
              <div className="text-[11px] text-slate-400">Automatic Border Background Mode</div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-lg border border-white/5">
                <button
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, bgRemovalMode: 'perimeter_flood' }))}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                    params.bgRemovalMode === 'perimeter_flood'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Exterior Flood
                </button>
                <button
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, bgRemovalMode: 'global_color' }))}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                    params.bgRemovalMode === 'global_color'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Global + Holes
                </button>
                <button
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, bgRemovalMode: 'alpha_only' }))}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                    params.bgRemovalMode === 'alpha_only'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Alpha PNG Only
                </button>
                <button
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, bgRemovalMode: 'none' }))}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                    params.bgRemovalMode === 'none'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Keep Full Box
                </button>
              </div>

              {params.bgRemovalMode !== 'none' && params.bgRemovalMode !== 'alpha_only' && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300">Auto Border Tolerance</span>
                    <span className="font-mono tabular-nums text-slate-400">
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
                      setParams((p) => ({ ...p, bgTolerance: parseInt(e.target.value, 10) }))
                    }
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>
              )}
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Section 03: Inkscape-Style Vector Tracing Controls */}
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-200">
                03. Inkscape Vector Trace Engine
              </h2>
              <button
                type="button"
                onClick={() =>
                  setParams((p) => ({
                    ...p,
                    smoothEpsilon: 1.15,
                    cornerSimplify: 0.32,
                    despeckleLevel: 1,
                    minIslandPx: 18,
                    fieldBlurPasses: 1,
                    closeColorGaps: true,
                    seamOverlapMm: 0.0,
                  }))
                }
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                title="Reset vector smoothing defaults"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            {/* Curve Smoothing (Chaikin + Binomial) */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Curve Smoothness (Chaikin Spline)</span>
                <span className="font-mono tabular-nums text-emerald-400">
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
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Gradient Flatten / Despeckle Filter */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Shade & Gradient Flattening</span>
                <span className="font-mono tabular-nums text-slate-400">
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
                  setParams((p) => ({ ...p, despeckleLevel: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Suppress Speckles / Minimum Island Size */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Suppress Speckles (Min Island)</span>
                <span className="font-mono tabular-nums text-slate-400">
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
                  setParams((p) => ({ ...p, minIslandPx: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Corner Simplification Threshold (RDP) */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Path Simplification (RDP)</span>
                <span className="font-mono tabular-nums text-slate-400">
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
                  setParams((p) => ({ ...p, cornerSimplify: parseFloat(e.target.value) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Zero-Gap Planar Lock & Interior Seam Healer */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setParams((p) => ({ ...p, closeColorGaps: !p.closeColorGaps }))}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  params.closeColorGaps
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <span>Close All Colour Gaps (Planar Lock)</span>
                <span className="font-mono text-[11px]">
                  {params.closeColorGaps ? 'ON' : 'OFF'}
                </span>
              </button>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                Locks shared curve vertices & triple-junctions across adjacent colours and heals
                internal anti-aliased cracks for a flat face-down surface.
              </p>
            </div>
          </section>
        </aside>

        {/* CENTER VIEWPORT: Interactive 3D Build Plate or 2D Vector Inspector */}
        <main className="flex-1 relative min-w-0 h-full bg-[#0B0F17]">
          {/* Mobile View Switcher Bar */}
          <div className="flex md:hidden items-center gap-1 p-2 bg-slate-950 border-b border-white/10 overflow-x-auto">
            {(
              [
                ['3d_plate', '3D Plate'],
                ['vector_paths', '2D Vectors'],
                ['quantized_flat', 'Flattened'],
                ['side_by_side', 'Compare'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setActiveView(mode)}
                className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap ${
                  activeView === mode ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeView === '3d_plate' ? (
            <Viewport3D
              model={extrudedModel}
              highlightedSlot={effectiveHighlightedSlot}
              flipFaceDown={flipFaceDown}
              onToggleFlipFaceDown={() => setFlipFaceDown((f) => !f)}
              mergeItemMode={mergeItemMode}
              onToggleMergeItemMode={handleToggleMergeItemMode}
              onMergeItemAtPixel={handleMergeItemAtPixel}
              mergedRegionsCount={mergedRegionsCount}
              onUndoLastMergedRegion={handleUndoLastMergedRegion}
              onClearMergedRegions={handleClearMergedRegions}
              boxMode={Boolean(params.boxMode)}
              boxPlateLayout={params.boxPlateLayout || 'assembled'}
              onChangeBoxPlateLayout={(layout) =>
                setParams((p) => ({ ...p, boxPlateLayout: layout }))
              }
              boxLidLiftMm={params.boxLidLiftMm ?? 16}
              onChangeBoxLidLiftMm={(liftMm) =>
                setParams((p) => ({ ...p, boxLidLiftMm: liftMm }))
              }
            />
          ) : (
            <VectorInspector2D
              sourceImageData={sourceImageData}
              traceResult={traceResult}
              subMode={activeView as InspectorSubMode}
              highlightedSlot={effectiveHighlightedSlot}
              eyedropperTarget={eyedropperTarget}
              onPickColorFromImage={handlePickColorFromImage}
              onToggleSlotEnabled={handleToggleSlotEnabled}
              onCancelEyedropper={() => setEyedropperTarget(null)}
              mergeItemMode={mergeItemMode}
              onToggleMergeItemMode={handleToggleMergeItemMode}
              onMergeItemAtPixel={handleMergeItemAtPixel}
              mergedRegionsCount={mergedRegionsCount}
              onUndoLastMergedRegion={handleUndoLastMergedRegion}
              onClearMergedRegions={handleClearMergedRegions}
            />
          )}

          {/* Drag-and-Drop Overlay */}
          {isDraggingFile && (
            <div className="absolute inset-4 z-30 rounded-xl border-2 border-dashed border-emerald-400 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-10 h-10 text-emerald-400 mb-2 animate-bounce" />
              <p className="text-base font-semibold text-white">
                Drop image to trace into 4 Bambu AMS colours
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Gradients & shading will be flattened and extruded into 3D vectors
              </p>
            </div>
          )}
        </main>

        {/* RIGHT PANEL: Bambu AMS 4-Colour Slot Rack & 3D Extrusion Geometry */}
        <aside className="w-80 xl:w-[360px] shrink-0 border-l border-white/10 bg-[#0E1420] overflow-y-auto p-5 space-y-6">
          {/* Section 04: Bambu AMS 4-Colour Filament Slots */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-200">
                04. Bambu AMS Filament Slots
              </h2>
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-md border border-white/10">
                {([2, 3, 4] as const).map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, numColors: cnt }))}
                    className={`px-2 py-0.5 text-[11px] font-mono tabular-nums rounded transition-colors cursor-pointer ${
                      params.numColors === cnt
                        ? 'bg-emerald-400 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {cnt}C
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Combine similar slots to print as 1 unified colour, or snap to Bambu PLA.
                </p>
                <button
                  type="button"
                  onClick={handleSnapAllToBambuFilaments}
                  className="px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[11px] font-medium text-emerald-300 whitespace-nowrap transition-colors cursor-pointer shrink-0"
                  title="Snap all slots to the closest official Bambu Lab PLA Basic / Matte filament colours"
                >
                  Match Bambu PLA
                </button>
              </div>

              {/* Quick Merge Similar Pair / Unmerge All Bar */}
              {(closestMergeablePair ||
                slotConfigs.some((s) => s.mergedIntoSlot != null)) && (
                <div className="flex items-center justify-between gap-1.5 bg-slate-900/80 border border-white/10 rounded-md px-2.5 py-1.5">
                  {closestMergeablePair ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleMergeSlotInto(
                          closestMergeablePair.source.slotIndex,
                          closestMergeablePair.target.slotIndex
                        )
                      }
                      className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-300 hover:text-cyan-200 transition-colors cursor-pointer min-w-0"
                      title={`Merge Slot ${closestMergeablePair.source.slotIndex + 1} (${closestMergeablePair.source.printHex}) into Slot ${closestMergeablePair.target.slotIndex + 1} (${closestMergeablePair.target.printHex}) so both print as one unified colour`}
                    >
                      <span className="flex items-center -space-x-1 shrink-0">
                        <span
                          className="w-3 h-3 rounded-full border border-white/40"
                          style={{ backgroundColor: closestMergeablePair.target.printHex }}
                        />
                        <span
                          className="w-3 h-3 rounded-full border border-white/40"
                          style={{ backgroundColor: closestMergeablePair.source.printHex }}
                        />
                      </span>
                      <span className="truncate">
                        Merge Closest: Slot {closestMergeablePair.target.slotIndex + 1} + Slot{' '}
                        {closestMergeablePair.source.slotIndex + 1}
                      </span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400">Slots merged</span>
                  )}

                  {slotConfigs.some((s) => s.mergedIntoSlot != null) && (
                    <button
                      type="button"
                      onClick={handleUnmergeAllSlots}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 text-[10px] font-medium text-slate-300 hover:text-white whitespace-nowrap cursor-pointer shrink-0"
                      title="Separate all merged colour slots back into individual colours"
                    >
                      Unmerge All
                    </button>
                  )}
                </div>
              )}

              {/* Quick Merge Item (Click on Model/Artwork to Merge Detail into Surrounding Colour) */}
              <div className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleMergeItemMode}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    mergeItemMode
                      ? 'bg-cyan-400 text-slate-950 border-cyan-300 font-semibold'
                      : 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200'
                  }`}
                  title="Activate Merge Item mode, then click any unwanted detail or island on the 3D model or 2D artwork to merge it into its surrounding colour"
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  <span>
                    {mergeItemMode
                      ? 'Click Any Detail on Model to Merge...'
                      : 'Merge Item (Click Detail into Surrounding)'}
                  </span>
                </button>
                {mergedRegionsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleUndoLastMergedRegion}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs text-cyan-300 hover:text-white cursor-pointer shrink-0"
                    title="Undo last merged item"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span className="font-mono text-[11px]">{mergedRegionsCount}</span>
                  </button>
                )}
              </div>
            </div>

            {/* 4 AMS Slot Rows */}
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
                  bambuMatch.preset.hex.toUpperCase() === effectiveDisplayHex.toUpperCase();

                return (
                  <div
                    key={layer.slotIndex}
                    onMouseEnter={() => setHighlightedSlot(layer.slotIndex)}
                    onMouseLeave={() => setHighlightedSlot(null)}
                    className={`rounded-lg border p-2.5 transition-colors ${
                      !layer.enabled
                        ? 'bg-slate-950/50 border-rose-500/30 opacity-75'
                        : isMergedOut
                        ? 'bg-slate-900/45 border-cyan-500/30'
                        : highlightedSlot === layer.slotIndex
                        ? 'bg-slate-800/90 border-emerald-400/50'
                        : 'bg-slate-900/70 border-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {/* Filament Colour Swatch & Slot Name */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenColorPickerSlot(isSwatchOpen ? null : layer.slotIndex)
                          }
                          className="w-6 h-6 rounded-md border border-white/25 shrink-0 shadow-inner cursor-pointer relative overflow-hidden"
                          style={{ backgroundColor: layer.printHex }}
                          title="Change filament colour"
                        >
                          {!layer.enabled && (
                            <span className="inset-0 bg-slate-950/70 flex items-center justify-center w-full h-full">
                              <X className="w-3.5 h-3.5 text-rose-400" />
                            </span>
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-xs font-semibold whitespace-nowrap ${
                                layer.enabled ? 'text-slate-200' : 'text-slate-400 line-through'
                              }`}
                            >
                              {layer.slotIndex === 4
                                ? params.boxMode
                                  ? 'Hollow Box'
                                  : 'Stroke'
                                : `Slot ${layer.slotIndex + 1}`}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-slate-400">
                              {layer.printHex}
                            </span>
                            {layer.isStrokeAndBase && (
                              <span className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">
                                {params.boxMode ? '· Box Walls & Floor' : '· Stroke & Base'}
                              </span>
                            )}
                            {mergedFromList.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-medium text-cyan-300 whitespace-nowrap">
                                + Slot {mergedFromList.map((idx) => idx + 1).join(', ')}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-400 truncate">
                            {!layer.enabled ? (
                              <span className="text-rose-400">Removed from print &amp; trace</span>
                            ) : isMergedOut && mergedTargetLayer ? (
                              <span className="text-cyan-300">
                                Merged into Slot {mergedTargetLayer.slotIndex + 1} (
                                {mergedTargetLayer.printHex})
                              </span>
                            ) : (
                              <>
                                {layer.coveragePercent.toFixed(1)}% · {layer.polygons.length}{' '}
                                {layer.polygons.length === 1 ? 'region' : 'regions'}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Slot Action Controls: Eyedropper, Lock, Explicit Remove/Restore or Unmerge */}
                      <div className="flex items-center gap-1 shrink-0">
                        {isMergedOut ? (
                          <button
                            type="button"
                            onClick={() => handleMergeSlotInto(layer.slotIndex, null)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 transition-colors cursor-pointer whitespace-nowrap"
                            title="Separate this slot back into its own independent filament colour"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Unmerge</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => activateEyedropper(layer.slotIndex)}
                              className={`p-1.5 rounded transition-colors cursor-pointer ${
                                isEyedropping
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'text-slate-400 hover:text-white hover:bg-white/10'
                              }`}
                              title="Sample colour from image to lock this slot"
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
                              className={`p-1.5 rounded transition-colors cursor-pointer ${
                                isLocked
                                  ? 'text-amber-300 bg-amber-500/15'
                                  : 'text-slate-400 hover:text-white hover:bg-white/10'
                              }`}
                              title={
                                isLocked
                                  ? 'Unlock colour centroid (return to auto K-Means)'
                                  : 'Lock this colour centroid'
                              }
                            >
                              {isLocked ? (
                                <Lock className="w-3.5 h-3.5" />
                              ) : (
                                <Unlock className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleToggleSlotEnabled(layer.slotIndex)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            layer.enabled
                              ? 'bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/10'
                              : 'bg-rose-500/20 hover:bg-emerald-500/20 text-rose-300 hover:text-emerald-300 border border-rose-500/40'
                          }`}
                          title={
                            layer.enabled
                              ? 'Remove this colour from the 3D print and vector trace'
                              : 'Restore this colour to the 3D print and vector trace'
                          }
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

                    {/* Per-Slot Merge Bar & Official Bambu Filament Badge */}
                    {layer.enabled && !isMergedOut && (
                      <div className="mt-2 pt-1.5 border-t border-white/5 space-y-1.5">
                        {/* Merge into another slot row */}
                        {traceResult.layers.filter(
                          (other) =>
                            other.slotIndex !== layer.slotIndex &&
                            other.enabled &&
                            other.mergedIntoSlot == null
                        ).length > 0 && (
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">
                              Merge into:
                            </span>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {traceResult.layers
                                .filter(
                                  (other) =>
                                    other.slotIndex !== layer.slotIndex &&
                                    other.enabled &&
                                    other.mergedIntoSlot == null
                                )
                                .map((other) => (
                                  <button
                                    key={other.slotIndex}
                                    type="button"
                                    onClick={() =>
                                      handleMergeSlotInto(layer.slotIndex, other.slotIndex)
                                    }
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/90 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/40 text-[10px] font-mono text-slate-300 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap"
                                    title={`Merge Slot ${layer.slotIndex + 1} into Slot ${other.slotIndex + 1} (${other.printHex}) so both print as one unified colour`}
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full border border-white/30 shrink-0"
                                      style={{ backgroundColor: other.printHex }}
                                    />
                                    <span>Slot {other.slotIndex + 1}</span>
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Closest Official Bambu Filament Badge & 1-Click Snap */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-white/25 shrink-0"
                              style={{ backgroundColor: bambuMatch.preset.hex }}
                            />
                            <span className="text-[11px] text-slate-300 truncate">
                              Bambu {bambuMatch.preset.series}:{' '}
                              <span className="text-white font-medium">
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
                              className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/25 whitespace-nowrap cursor-pointer shrink-0"
                              title={`Snap slot to official Bambu ${bambuMatch.preset.name} (${bambuMatch.preset.hex})`}
                            >
                              Snap {bambuMatch.preset.hex}
                            </button>
                          ) : (
                            <span className="text-[10px] font-mono text-emerald-400/90 whitespace-nowrap shrink-0">
                              Exact Match
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Expandable Filament Swatch Picker */}
                    {isSwatchOpen && (
                      <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">
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
                                          lockedSourceHex: s.lockedSourceHex || layer.detectedHex,
                                        }
                                      : s
                                  )
                                );
                              }
                            }}
                            className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
                            title="Custom Hex Filament Colour"
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
                                            lockedSourceHex: s.lockedSourceHex || layer.detectedHex,
                                          }
                                        : s
                                    )
                                  );
                                }
                                setOpenColorPickerSlot(null);
                              }}
                              className="w-5 h-5 rounded border border-white/20 hover:scale-110 transition-transform cursor-pointer"
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
          </section>

          <hr className="border-white/10" />

          {/* Section 05: Logo Stroke Outline, Base & Hollow Box Mode */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-200">
                05. Stroke Outline &amp; Box Mode
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setParams((p) => {
                      const nextStroke = !p.strokeEnabled;
                      return {
                        ...p,
                        strokeEnabled: nextStroke,
                        boxMode: nextStroke ? p.boxMode : false,
                      };
                    })
                  }
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    params.strokeEnabled && !params.boxMode
                      ? 'bg-emerald-400 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white border border-white/10'
                  }`}
                >
                  {params.strokeEnabled && !params.boxMode ? 'Stroke ON' : 'Add Stroke'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setParams((p) => {
                      const nextBox = !p.boxMode;
                      return {
                        ...p,
                        boxMode: nextBox,
                        strokeEnabled: nextBox ? true : p.strokeEnabled,
                        strokeFillInnerGaps: nextBox ? true : p.strokeFillInnerGaps,
                      };
                    })
                  }
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    params.boxMode
                      ? 'bg-emerald-400 text-slate-950 shadow-sm'
                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/35'
                  }`}
                  title="Turn the Stroke Outline into a hollow 3D box and the Traced Image into a fitted lid"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                  <span>{params.boxMode ? 'Box Mode ON' : 'Box Mode'}</span>
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              {params.boxMode
                ? 'Box Mode turns the outer stroke outline into a hollow 3D container with an internal support ledge, while your multi-colour traced image becomes the fitted lid.'
                : 'Adds a smooth offset outline around your logo in your chosen colour — or enable Box Mode to turn the stroke into a hollow box with a traced image lid.'}
            </p>

            {(params.strokeEnabled || params.boxMode) && (
              <div className="bg-slate-900/80 border border-emerald-500/30 rounded-lg p-3 space-y-3">
                {/* Mode Switcher Tabs inside Stroke / Box Panel */}
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
                  <button
                    type="button"
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        strokeEnabled: true,
                        boxMode: false,
                      }))
                    }
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                      !params.boxMode
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Flat Badge + Stroke
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        strokeEnabled: true,
                        boxMode: true,
                        strokeFillInnerGaps: true,
                      }))
                    }
                    className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                      params.boxMode
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <PackageOpen className="w-3.5 h-3.5" />
                    <span>Hollow Box + Lid</span>
                  </button>
                </div>

                {/* Stroke / Box Wall Colour Picker + Quick Swatches */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-200 font-medium">
                      {params.boxMode ? 'Hollow Box & Rim Colour' : 'Stroke & Base Colour'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono tabular-nums text-slate-300">
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
                        title="Pick custom Box / Stroke colour"
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
                          className={`w-6 h-6 rounded border transition-transform cursor-pointer ${
                            active
                              ? 'border-emerald-400 ring-2 ring-emerald-400/50 scale-105'
                              : 'border-white/20 hover:scale-110'
                          }`}
                          style={{ backgroundColor: sw.hex }}
                          title={`Set Box / Stroke colour to ${sw.name}`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Stroke / Box Wall Width Slider (mm) */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300">
                      {params.boxMode
                        ? 'Box Outer Wall Thickness (Stroke)'
                        : 'Stroke Outline Width'}
                    </span>
                    <span className="font-mono tabular-nums text-emerald-400">
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
                      setParams((p) => ({ ...p, strokeWidthMm: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>

                {params.boxMode ? (
                  <>
                    {/* Hollow Box Total Z Height (mm) */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-300">Hollow Box Total Height (Z)</span>
                        <span className="font-mono tabular-nums text-emerald-400">
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
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                    </div>

                    {/* Lid Seating & Rim Style */}
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400 block">
                        Traced Image Lid Fit Style
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
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
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                              (params.boxLidStyle || 'flush_recessed') === style
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug pt-0.5">
                        {(params.boxLidStyle || 'flush_recessed') === 'flush_recessed'
                          ? 'Traced image lid drops flush into the top of the stroke box walls and rests on an internal support shelf.'
                          : params.boxLidStyle === 'raised_rim_recessed'
                          ? 'Stroke box walls rise 1.2mm higher than the lid to frame and protect the traced image lid.'
                          : 'Lid sits on top of the box walls with an inner locking plug that slots into the hollow cavity.'}
                      </p>
                    </div>

                    {/* Inner Ledge / Locking Plug Width (mm) & XY Fit Clearance */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-slate-300">
                            {params.boxLidStyle === 'cap_with_plug'
                              ? 'Plug Lip Width'
                              : 'Inner Ledge Shelf'}
                          </span>
                          <span className="font-mono tabular-nums text-emerald-400">
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
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-slate-300">Lid XY Clearance</span>
                          <span className="font-mono tabular-nums text-emerald-400">
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
                          className="w-full accent-emerald-400 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* 3D Build Plate Layout & Open/Close Lid Slider */}
                    <div className="space-y-2 pt-1 border-t border-white/10">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span>3D Viewport Layout</span>
                        <span className="text-[10px] text-emerald-400 font-mono">
                          .3MF auto-exports flat on Z=0
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
                        <button
                          type="button"
                          onClick={() =>
                            setParams((p) => ({ ...p, boxPlateLayout: 'assembled' }))
                          }
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            (params.boxPlateLayout || 'assembled') === 'assembled'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Fit Preview (Lid on Box)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setParams((p) => ({ ...p, boxPlateLayout: 'side_by_side' }))
                          }
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            params.boxPlateLayout === 'side_by_side'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Side-by-Side Plate
                        </button>
                      </div>

                      {(params.boxPlateLayout || 'assembled') === 'assembled' && (
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-slate-300">
                              Open / Close Lid Preview Lift
                            </span>
                            <span className="font-mono tabular-nums text-emerald-400">
                              {(params.boxLidLiftMm ?? 16) === 0
                                ? '0 mm (Closed)'
                                : `+${(params.boxLidLiftMm ?? 16).toFixed(0)} mm`}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={45}
                            step={1}
                            value={params.boxLidLiftMm ?? 16}
                            onChange={(e) =>
                              setParams((p) => ({
                                ...p,
                                boxLidLiftMm: parseFloat(e.target.value),
                              }))
                            }
                            className="w-full accent-emerald-400 cursor-pointer"
                          />
                        </div>
                      )}

                      {/* Parts to Include / Export */}
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-400 block">
                          Parts to Include on Plate &amp; Export
                        </span>
                        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
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
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                                (params.boxExportParts || 'both') === partOpt
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 3D Stroke Profile Style */}
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400 block">
                        Stroke 3D Surface Profile
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
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
                            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                              params.strokeProfileStyle === style
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Solid Badge Base (Close Inner Holes) Toggle */}
                    <button
                      type="button"
                      onClick={() =>
                        setParams((p) => ({
                          ...p,
                          strokeFillInnerGaps: !p.strokeFillInnerGaps,
                        }))
                      }
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded border text-xs transition-colors cursor-pointer ${
                        params.strokeFillInnerGaps
                          ? 'bg-slate-800 border-emerald-500/40 text-slate-200'
                          : 'bg-slate-950 border-white/10 text-slate-400'
                      }`}
                    >
                      <span>Solid Badge Base (Fill Inner Cutouts)</span>
                      <span className="font-mono text-[11px] text-emerald-400">
                        {params.strokeFillInnerGaps ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          <hr className="border-white/10" />

          {/* Section 06: 3D Extrusion Profile & Dimensions */}
          <section className="space-y-3.5">
            <h2 className="text-xs font-semibold text-slate-200">
              06. 3D Extrusion & Slicer Geometry
            </h2>

            {/* Extrusion Topology Mode */}
            <div className="space-y-1.5">
              <span className="text-xs text-slate-300 block">Multi-Colour Extrusion Topology</span>
              <div className="grid grid-cols-1 gap-1.5">
                {(
                  [
                    {
                      mode: 'backed_inlay' as ExtrusionMode,
                      title: 'Backed Silhouette + Surface Inlay',
                      desc: 'Base slot forms solid outer silhouette core; active colours inlay on top so islands stay joined.',
                    },
                    {
                      mode: 'full_flush' as ExtrusionMode,
                      title: 'Full-Depth Flush Extrusion',
                      desc: 'Every active colour extrudes full Z-height (0 to top). Ideal for face-down PEI plate prints.',
                    },
                    {
                      mode: 'stepped_relief' as ExtrusionMode,
                      title: 'Inkscape Stacked Relief (2.5D)',
                      desc: 'Cumulative stacked vector layers with stepped Z-heights per colour slot.',
                    },
                  ] as const
                ).map((item) => {
                  const active = params.extrusionMode === item.mode;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => setParams((p) => ({ ...p, extrusionMode: item.mode }))}
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-slate-900/60 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div
                        className={`text-xs font-semibold ${
                          active ? 'text-emerald-300' : 'text-slate-200'
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {item.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Backing Core Slot selector when in 'backed_inlay' mode */}
            {params.extrusionMode === 'backed_inlay' && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-300">Silhouette Backing Core Slot</span>
                  <span className="font-mono tabular-nums text-emerald-400">
                    Slot {params.baseSlotIndex + 1}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: params.numColors }).map((_, idx) => {
                    const active = params.baseSlotIndex === idx;
                    const layerHex = traceResult?.layers[idx]?.printHex || '#334155';
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setParams((p) => ({ ...p, baseSlotIndex: idx }))}
                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 border-emerald-400 text-white'
                            : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-white/20"
                          style={{ backgroundColor: layerHex }}
                        />
                        <span>S{idx + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Physical Print Width (mm) */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Print Width (X)</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {params.targetWidthMm.toFixed(0)} mm
                  {extrudedModel ? ` × ${extrudedModel.dimensionsMm.depth.toFixed(0)} mm` : ''}
                </span>
              </div>
              <input
                type="range"
                min={25}
                max={230}
                step={5}
                value={params.targetWidthMm}
                onChange={(e) =>
                  setParams((p) => ({ ...p, targetWidthMm: parseFloat(e.target.value) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Base Thickness (mm) */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">
                  {params.extrusionMode === 'full_flush'
                    ? 'Total Extrusion Thickness (Z)'
                    : 'Base Silhouette Thickness'}
                </span>
                <span className="font-mono tabular-nums text-slate-300">
                  {params.baseThicknessMm.toFixed(1)} mm
                </span>
              </div>
              <input
                type="range"
                min={0.6}
                max={8.0}
                step={0.2}
                value={params.baseThicknessMm}
                onChange={(e) =>
                  setParams((p) => ({ ...p, baseThicknessMm: parseFloat(e.target.value) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Inlay / Step Layer Thickness (mm) */}
            {params.extrusionMode !== 'full_flush' && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">
                    {params.extrusionMode === 'backed_inlay'
                      ? 'Colour Layer Inlay Depth'
                      : 'Z-Step Height per Colour'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-300">
                    {params.inlayThicknessMm.toFixed(1)} mm (4 layers @ 0.2mm)
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={3.0}
                  step={0.2}
                  value={params.inlayThicknessMm}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, inlayThicknessMm: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>
            )}

            {/* Seam Overlap / Kerf Dilation (mm) for Face-Down Slicer Fusion */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300">Colour Seam Overlap (Slicer Weld)</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {params.seamOverlapMm === 0
                    ? '0.00 mm (Exact Shared Edge)'
                    : `+${params.seamOverlapMm.toFixed(2)} mm`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.16}
                step={0.02}
                value={params.seamOverlapMm}
                onChange={(e) =>
                  setParams((p) => ({ ...p, seamOverlapMm: parseFloat(e.target.value) }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Bambu Studio .3MF Auto-Colour Export Settings */}
            <div className="bg-slate-900/75 border border-white/10 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">
                  Bambu Studio Colour Loader
                </span>
                <span className="text-[10px] font-mono text-emerald-400">Auto-Colour Ready</span>
              </div>

              <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-md border border-white/10">
                <button
                  type="button"
                  onClick={() => setBambuColorFormat('standard_colorgroup')}
                  className={`px-2 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    bambuColorFormat === 'standard_colorgroup'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Uses 3MF <m:colorgroup> face & vertex colours so Bambu Studio automatically parses and loads the exact colours without overwriting your printer preset"
                >
                  Auto-Parse Colours
                </button>
                <button
                  type="button"
                  onClick={() => setBambuColorFormat('bambu_project')}
                  className={`px-2 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    bambuColorFormat === 'bambu_project'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Embeds BambuStudio:3mfVersion + Metadata/project_settings.config filament_colour array + per-triangle paint_color"
                >
                  Full Project Config
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSnapToOfficialBambuHex((v) => !v)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded border text-xs transition-colors cursor-pointer ${
                  snapToOfficialBambuHex
                    ? 'bg-slate-800 border-emerald-500/40 text-slate-200'
                    : 'bg-slate-950 border-white/10 text-slate-400'
                }`}
              >
                <span>Snap Export to Official Bambu Filament Hex</span>
                <span className="font-mono text-[11px] text-emerald-400">
                  {snapToOfficialBambuHex ? 'ON' : 'EXACT HEX'}
                </span>
              </button>

              {extrudedModel && extrudedModel.parts.length > 0 && (
                <div className="pt-1 border-t border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>3MF Export Filament Colours:</span>
                    <span className="font-mono text-slate-300">
                      {extrudedModel.parts.length} AMS {extrudedModel.parts.length === 1 ? 'Slot' : 'Slots'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {extrudedModel.parts.map((part, idx) => {
                      const resolvedHex = snapToOfficialBambuHex
                        ? findClosestBambuFilament(part.colorHex).preset.hex.toUpperCase()
                        : part.colorHex.toUpperCase();
                      return (
                        <div
                          key={part.slotIndex}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950 border border-white/10 text-[10px] font-mono text-slate-200"
                          title={`Extruder ${idx + 1}: ${resolvedHex}`}
                        >
                          <span
                            className="w-3 h-3 rounded-sm border border-white/30 shrink-0"
                            style={{ backgroundColor: resolvedHex }}
                          />
                          <span>
                            E{idx + 1} {resolvedHex}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Export Buttons */}
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={handleExport3MF}
                disabled={!extrudedModel || isExporting}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isExporting
                    ? 'Packaging Multi-Colour .3MF...'
                    : 'Download Bambu Studio .3MF'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleExportSVG}
                disabled={!traceResult}
                className="w-full py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Export Clean 2D Inkscape .SVG</span>
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
