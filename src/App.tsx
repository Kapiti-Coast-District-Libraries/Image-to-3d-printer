import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxExportParts,
  BoxLidStyle,
  BoxOutlineShape,
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
import { buildExtrudedModel, ExtrudedModelResult, ManifoldMeshPart } from './lib/meshExtruder';
import {
  Bambu3mfColorFormat,
  generateBambu3mfBlob,
  generateCleanSvgString,
} from './lib/export3mf';
import {
  exportAllPartsToStlZip,
  exportPartToSTL,
  exportTwoPartSignStlZip,
  downloadBlob,
} from './lib/exportStl';
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
import { SendToMakerSpaceModal } from './components/SendToMakerSpaceModal';
import { AdminDashboard } from './components/AdminDashboard';
import { CustomizerConfig } from './types';
import { computePrintEstimate, loadConfigImageData } from './lib/printEstimator';
import { subscribeToSubmissions } from './services/submissionService';
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
  Send,
  ShieldCheck,
  Layers,
  Sliders,
} from 'lucide-react';

type MainViewMode = '3d_plate' | 'vector_paths' | 'quantized_flat' | 'side_by_side';
type ControlsTab = 'all' | 'trace' | 'colors_box' | 'extrusion';

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
  const [controlsTab, setControlsTab] = useState<ControlsTab>('all');
  const [projectName, setProjectName] = useState<string>('Kitsune_Emblem_4Color');
  const [activeSampleId, setActiveSampleId] = useState<string>('kitsune_emblem');
  const [sourceImageData, setSourceImageData] = useState<ImageData | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Dual-Theme Mode & Maker Space Queue State
  const [showAdminPortal, setShowAdminPortal] = useState<boolean>(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState<boolean>(false);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [loadedFromAdminRef, setLoadedFromAdminRef] = useState<string | null>(null);

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
    strokeShape: 'contour',
    shapePaddingMm: 3.5,
    shapeCornerRadiusMm: 4.0,
    strokeWidthMm: 2.5,
    strokeColorHex: '#F8FAFC',
    strokeFillInnerGaps: true,
    strokeProfileStyle: 'flush_top_and_base',
    boxMode: false,
    boxHeightMm: 28,
    boxLidStyle: 'cap_with_plug',
    boxLidToleranceMm: 0.2,
    boxLedgeWidthMm: 1.4,
    boxPlateLayout: 'assembled',
    boxLidLiftMm: 16,
    boxExportParts: 'both',
    extrusionMode: 'backed_inlay',
    targetWidthMm: 95,
    baseThicknessMm: 3.0,
    inlayThicknessMm: 0.4,
    baseSlotIndex: 0,
    flipFaceDown: true,
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
  const [flipFaceDown, setFlipFaceDown] = useState<boolean>(true);
  const [snapToOfficialBambuHex, setSnapToOfficialBambuHex] = useState<boolean>(false);
  const [bambuColorFormat, setBambuColorFormat] =
    useState<Bambu3mfColorFormat>('bambu_project');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportSuccessText, setExportSuccessText] = useState<string | null>(null);
  const [openColorPickerSlot, setOpenColorPickerSlot] = useState<number | null>(null);
  const [showStlModal, setShowStlModal] = useState<boolean>(false);

  // Subscribe to queued order count badge
  useEffect(() => {
    const unsub = subscribeToSubmissions((items) => {
      const qCount = items.filter(
        (i) => i.status === 'queued' || i.status === 'in_slicer' || i.status === 'printing'
      ).length;
      setQueuedCount(qCount);
    });
    return () => unsub();
  }, []);

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
    setLoadedFromAdminRef(null);
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

  // Handler when Staff clicks "Load into Editor" inside AdminDashboard
  const handleLoadConfigFromAdmin = useCallback(async (cfg: CustomizerConfig) => {
    try {
      const imgData = await loadConfigImageData(cfg, MAX_TRACE_DIMENSION);
      setSourceImageData(imgData);
      setProjectName(cfg.projectName || 'Restored_Order');
      setActiveSampleId(cfg.sampleId || 'custom');
      setParams(cfg.params);
      setSlotConfigs(cfg.slotConfigs);
      setFlipFaceDown(Boolean(cfg.flipFaceDown));
      setBambuColorFormat(cfg.bambuColorFormat || 'bambu_project');
      setSnapToOfficialBambuHex(Boolean(cfg.snapToOfficialBambuHex));
      setShowAdminPortal(false);
      setActiveView('3d_plate');
      setLoadedFromAdminRef(cfg.projectName);
    } catch (err) {
      console.error('Failed to load submission config into editor:', err);
    }
  }, []);

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
        setLoadedFromAdminRef(null);
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
      if (showAdminPortal || isSubmitModalOpen) return;
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
  }, [handleImageFile, showAdminPortal, isSubmitModalOpen]);

  // Extract dominant image swatches
  const imageSwatches: DetectedImageSwatch[] = useMemo(() => {
    if (!sourceImageData) return [];
    return extractDominantImageSwatches(sourceImageData, 7);
  }, [sourceImageData]);

  // Run the 4-Colour Quantization + Inkscape Vector Trace Pipeline
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

  // Compute real-time filament weight, time & NZD cost estimate
  const printEstimate = useMemo(
    () => computePrintEstimate(extrudedModel, params, projectName),
    [extrudedModel, params, projectName]
  );

  // Add or toggle a colour in the Removed Colours list
  const addOrToggleRemovedColor = useCallback(
    (rgb: RGB, preferredScope: 'global' | 'exterior_only' = 'global') => {
      const hex = rgbToHex(rgb);
      setParams((prev) => {
        const existingIdx = prev.removedColors.findIndex(
          (r) => colorDistSq(r.rgb, rgb) < 6500
        );
        if (existingIdx >= 0) {
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

  const handleUnmergeAllSlots = useCallback(() => {
    setSlotConfigs((prev) => prev.map((s) => ({ ...s, mergedIntoSlot: null })));
  }, []);

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

    const target = bestA.slotIndex < bestB.slotIndex ? bestA : bestB;
    const source = bestA.slotIndex < bestB.slotIndex ? bestB : bestA;
    return { target, source, distSq: bestDistSq };
  }, [traceResult]);

  const effectiveHighlightedSlot = useMemo(() => {
    if (highlightedSlot === null) return null;
    const layer = traceResult?.layers.find((l) => l.slotIndex === highlightedSlot);
    if (layer && layer.mergedIntoSlot != null) {
      return layer.mergedIntoSlot;
    }
    return highlightedSlot;
  }, [highlightedSlot, traceResult]);

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
      const modelForExport =
        params.boxMode &&
        traceResult &&
        (params.boxPlateLayout === 'assembled' || (params.boxLidLiftMm ?? 0) > 0) &&
        (params.boxExportParts ?? 'both') === 'both'
          ? buildExtrudedModel(traceResult, {
              ...params,
              flipFaceDown,
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
        params.boxMode
          ? 'Box + Lid .3MF Exported'
          : flipFaceDown
          ? '3MF Exported (2 Layers @ 0.4mm)'
          : '3MF Exported (Auto-Colour)'
      );
      setTimeout(() => setExportSuccessText(null), 2800);
    } finally {
      setIsExporting(false);
    }
  };

  // Export All Parts as Binary STLs (.ZIP)
  const handleExportAllStlsZip = async () => {
    if (!extrudedModel || isExporting) return;
    setIsExporting(true);
    try {
      const modelForExport =
        params.boxMode &&
        traceResult &&
        (params.boxPlateLayout === 'assembled' || (params.boxLidLiftMm ?? 0) > 0) &&
        (params.boxExportParts ?? 'both') === 'both'
          ? buildExtrudedModel(traceResult, {
              ...params,
              flipFaceDown,
              boxPlateLayout: 'side_by_side',
              boxLidLiftMm: 0,
            })
          : extrudedModel;

      const blob = await exportAllPartsToStlZip(modelForExport, projectName, flipFaceDown);
      downloadBlob(blob, `${projectName}_All_Parts_STL.zip`);
      setExportSuccessText('Binary STLs (.ZIP) Exported (0.4mm Inlays)');
      setTimeout(() => setExportSuccessText(null), 3200);
      setShowStlModal(false);
    } finally {
      setIsExporting(false);
    }
  };

  // Export 2-Part Sign STLs: Base.stl + Inlays_0.4mm_2Layers.stl
  const handleExportTwoPartSignStl = async () => {
    if (!extrudedModel || isExporting) return;
    setIsExporting(true);
    try {
      const modelForExport =
        params.boxMode &&
        traceResult &&
        (params.boxPlateLayout === 'assembled' || (params.boxLidLiftMm ?? 0) > 0) &&
        (params.boxExportParts ?? 'both') === 'both'
          ? buildExtrudedModel(traceResult, {
              ...params,
              flipFaceDown,
              boxPlateLayout: 'side_by_side',
              boxLidLiftMm: 0,
            })
          : extrudedModel;

      const activeBase = params.strokeEnabled ? 4 : params.baseSlotIndex;
      const blob = await exportTwoPartSignStlZip(
        modelForExport,
        projectName,
        activeBase,
        flipFaceDown
      );
      downloadBlob(blob, `${projectName}_2Part_Sign_Base_And_Inlays_0.4mm.zip`);
      setExportSuccessText('2-Part Sign STL (0.4mm Inlays) Exported');
      setTimeout(() => setExportSuccessText(null), 3200);
      setShowStlModal(false);
    } finally {
      setIsExporting(false);
    }
  };

  // Export individual part STL
  const handleExportSinglePartStl = (part: ManifoldMeshPart) => {
    const blob = exportPartToSTL(
      part,
      flipFaceDown,
      extrudedModel?.dimensionsMm.height ?? 3.0
    );
    downloadBlob(blob, `${projectName}_${part.name}.stl`);
    setExportSuccessText(`Exported ${part.name}.stl`);
    setTimeout(() => setExportSuccessText(null), 2500);
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

  const activeSwatchesForModal = useMemo(() => {
    if (!traceResult) return [];
    return traceResult.layers
      .filter((l) => l.enabled && l.mergedIntoSlot == null)
      .map((l) => ({
        name:
          l.slotIndex === 4
            ? params.boxMode
              ? 'Hollow Box'
              : 'Stroke'
            : `Slot ${l.slotIndex + 1}`,
        hex: l.printHex,
      }));
  }, [traceResult, params.boxMode]);

  // ---------------------------------------------------------------------------
  // STAFF ADMIN PORTAL (DARK MODE MISSION CONTROL)
  // ---------------------------------------------------------------------------
  if (showAdminPortal) {
    return (
      <AdminDashboard
        onBackToWorkspace={() => setShowAdminPortal(false)}
        onLoadIntoEditor={handleLoadConfigFromAdmin}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // PUBLIC CUSTOMER WORKSPACE (LIGHT MODE ENGINEERING WORKSPACE)
  // ---------------------------------------------------------------------------
  return (
    <div
      className="min-h-screen bg-slate-50/60 text-slate-900 flex flex-col"
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

      {/* Send to Maker Space Modal */}
      <SendToMakerSpaceModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        config={{
          projectName,
          sampleId: activeSampleId,
          params,
          slotConfigs,
          flipFaceDown,
          bambuColorFormat,
          snapToOfficialBambuHex,
        }}
        sourceImageData={sourceImageData}
        estimate={printEstimate}
        dimensionsMm={extrudedModel ? extrudedModel.dimensionsMm : null}
        colorSwatches={activeSwatchesForModal}
      />

      {/* Top Engineering Header Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand Logo + Kāpiti Teal Badge */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              PT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-slate-900 font-[var(--font-sign)]">
                  PolyTrace 3MF
                </span>
                <span className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-semibold">
                  Kāpiti Maker Space
                </span>
                {loadedFromAdminRef && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-mono text-[10px] font-semibold">
                    Editing: {loadedFromAdminRef}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                4-Colour Vector Tracer, Hollow Box Generator &amp; Bambu Lab .3MF Studio
              </p>
            </div>
          </div>

          {/* Right Header Actions: Telemetry Pill, Upload, Send to Maker Space, Staff Admin */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200/90 font-mono text-xs text-slate-700">
              <span>{printEstimate.approxTotalGrams}g PLA</span>
              <span className="text-slate-300">·</span>
              <span>~{printEstimate.approxMinutes}m</span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-teal-700">
                ${printEstimate.costNzd.toFixed(2)} NZD
              </span>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-teal-700" />
              <span>Upload Image</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send to Maker Space</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAdminPortal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-100 text-xs font-semibold transition-colors cursor-pointer"
              title="Open Dark Mode Staff Mission Control Portal"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>Staff Admin</span>
              {queuedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30 font-mono text-[10px]">
                  {queuedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main 12-Column Responsive Customer Workspace Grid */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* =====================================================================
            LEFT COLUMN (lg:col-span-5): Parameter & Geometry Controls Card
        ===================================================================== */}
        <aside className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden flex flex-col lg:max-h-[calc(100vh-108px)]">
          {/* Panel Header Bar */}
          <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-teal-700" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Parameter &amp; Geometry Controls
                </h2>
              </div>
              <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-mono text-[10px] font-semibold">
                {params.boxMode ? 'Hollow Box + Lid' : 'Multi-Colour Plaque'}
              </span>
            </div>

            {/* Quick Section Filter Tabs */}
            <div className="grid grid-cols-4 gap-1 bg-slate-200/70 p-1 rounded-xl">
              {(
                [
                  ['all', 'All Steps'],
                  ['trace', '1–3 Trace'],
                  ['colors_box', '4–5 Box/AMS'],
                  ['extrusion', '6 Extrude'],
                ] as [ControlsTab, string][]
              ).map(([tab, label]) => {
                const active = controlsTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setControlsTab(tab)}
                    className={`py-1 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer truncate ${
                      active
                        ? 'bg-white text-blue-700 shadow-2xs border border-slate-200/80'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Controls Body */}
          <div className="p-5 space-y-6 overflow-y-auto flex-1">
            {(controlsTab === 'all' || controlsTab === 'trace') && (
              <>
                {/* Section 01: Artwork Source & Sample Presets */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800">
                      01. Source Artwork &amp; Presets
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500">
                      PNG · JPG · Paste
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3.5 px-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/30 transition-colors flex flex-col items-center justify-center text-center cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-blue-600 mb-1" />
                    <span className="text-xs font-semibold text-slate-800">
                      Drop image or click to browse
                    </span>
                    <span className="text-xs text-slate-500 mt-0.5">
                      Auto-flattens gradients to 4 AMS colours
                    </span>
                  </button>

                  <div>
                    <div className="text-xs text-slate-500 mb-1.5">
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
                            className={`px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                              active
                                ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                                : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <div className="text-xs font-semibold truncate">
                              {sample.title}
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              {sample.recommendedSlots.map((hex, i) => (
                                <span
                                  key={i}
                                  className="w-2.5 h-2.5 rounded-full border border-slate-300"
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

                <hr className="border-slate-200" />

                {/* Section 02: Choose Colour(s) to Remove & Click-to-Merge Item */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800">
                      02. Background &amp; Region Cleanup
                    </h3>
                    {traceResult && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                        <span>Auto BG</span>
                        <span
                          className="w-3.5 h-3.5 rounded border border-slate-300 inline-block"
                          style={{ backgroundColor: traceResult.detectedBgHex }}
                        />
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Click any detected image colour below to strip it from the trace, or use{' '}
                    <strong className="text-slate-700">Merge Item</strong> to absorb unwanted small details into their surrounding colour.
                  </p>

                  {/* Quick-Click Detected Image Swatches */}
                  {imageSwatches.length > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
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
                        : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
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
                </section>

                <hr className="border-slate-200" />

                {/* Section 03: Inkscape-Style Vector Tracing Controls */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800">
                      03. Inkscape Vector Trace Engine
                    </h3>
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
                      className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>

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
                </section>
              </>
            )}

            {controlsTab === 'all' && <hr className="border-slate-200" />}

            {(controlsTab === 'all' || controlsTab === 'colors_box') && (
              <>
                {/* Section 04: Bambu AMS 4-Colour Filament Slots */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800">
                      04. Bambu AMS Filament Slots
                    </h3>
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                      {([2, 3, 4] as const).map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setParams((p) => ({ ...p, numColors: cnt }))}
                          className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md transition-colors cursor-pointer ${
                            params.numColors === cnt
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {cnt}C
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Combine similar slots or snap to official Bambu PLA.
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
                    <div className="flex items-center justify-between gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
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
                </section>

                <hr className="border-slate-200" />

                {/* Section 05: Stroke Outline & Hollow Box Mode */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-slate-800">
                      05. Stroke Outline &amp; Box Mode
                    </h3>
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
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          params.strokeEnabled && !params.boxMode
                            ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                            : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-300'
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
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          params.boxMode
                            ? 'bg-teal-700 text-white border-teal-800 shadow-xs'
                            : 'bg-teal-50 hover:bg-teal-100 text-teal-800 border-teal-200'
                        }`}
                      >
                        <PackageOpen className="w-3.5 h-3.5" />
                        <span>{params.boxMode ? 'Box Mode ON' : 'Box Mode'}</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    {params.boxMode
                      ? 'Box Mode creates a hollow 3D container (Contour, Square, Circle, or Rectangle) while your multi-colour traced logo becomes the fitted lid.'
                      : 'Add an outline or geometric frame around your artwork — or enable Box Mode for a hollow box (Contour, Square, Circle, or Rectangle) with a traced lid.'}
                  </p>

                  {!params.strokeEnabled && !params.boxMode && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxMode: true,
                            strokeEnabled: true,
                            strokeShape: 'contour',
                            strokeFillInnerGaps: true,
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-[11px] font-semibold text-slate-700 hover:text-teal-800 transition-all cursor-pointer"
                      >
                        Contour Box
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxMode: true,
                            strokeEnabled: true,
                            strokeShape: 'square',
                            strokeFillInnerGaps: true,
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-[11px] font-semibold text-slate-700 hover:text-teal-800 transition-all cursor-pointer"
                      >
                        Square Box
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setParams((p) => ({
                            ...p,
                            boxMode: true,
                            strokeEnabled: true,
                            strokeShape: 'circle',
                            strokeFillInnerGaps: true,
                          }))
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-[11px] font-semibold text-slate-700 hover:text-teal-800 transition-all cursor-pointer"
                      >
                        Circle Box
                      </button>
                    </div>
                  )}

                  {(params.strokeEnabled || params.boxMode) && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                      <div className="grid grid-cols-2 gap-1 bg-slate-200/70 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() =>
                            setParams((p) => ({
                              ...p,
                              strokeEnabled: true,
                              boxMode: false,
                            }))
                          }
                          className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            !params.boxMode
                              ? 'bg-white text-blue-700 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Flat Badge + Frame
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
                          className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            params.boxMode
                              ? 'bg-white text-teal-800 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <PackageOpen className="w-3.5 h-3.5" />
                          <span>Hollow Box + Lid</span>
                        </button>
                      </div>

                      {/* Box / Frame Shape Profile (Contour / Square / Circle / Rectangle) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-700 font-semibold">
                            {params.boxMode
                              ? 'Box & Lid Outer Shape'
                              : 'Outer Frame / Base Shape'}
                          </span>
                          <span className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                            {(params.strokeShape || 'contour') === 'contour'
                              ? 'Follows Logo'
                              : 'For Odd-Shaped Logos'}
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
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {(params.strokeShape || 'contour') !== 'contour' && (
                          <p className="text-[11px] text-slate-500 leading-snug">
                            Encloses odd-shaped or multi-piece logos inside a clean{' '}
                            <span className="font-semibold text-slate-700">
                              {params.strokeShape === 'square'
                                ? '1:1 Square'
                                : params.strokeShape === 'circle'
                                ? 'Circular'
                                : 'Fitted Rectangular'}
                            </span>{' '}
                            {params.boxMode
                              ? 'hollow box and flush multi-colour inlay lid.'
                              : 'plaque frame.'}
                          </p>
                        )}
                      </div>

                      {/* Geometric Padding & Corner Fillet Sliders when Square / Circle / Rectangle is active */}
                      {(params.strokeShape || 'contour') !== 'contour' && (
                        <div
                          className={`grid ${
                            params.strokeShape === 'circle' ? 'grid-cols-1' : 'grid-cols-2'
                          } gap-2.5 bg-white border border-slate-200/90 rounded-xl p-2.5`}
                        >
                          <div>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="text-slate-600">Logo Margin Padding</span>
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
                                <span className="text-slate-600">Corner Fillet Radius</span>
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
                      )}

                      {/* Stroke / Box Colour Swatches */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-700 font-semibold">
                            {params.boxMode
                              ? 'Hollow Box & Rim Colour'
                              : 'Stroke & Base Colour'}
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

                      {/* Wall / Stroke Width */}
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-600">
                            {params.boxMode
                              ? 'Box Outer Wall Thickness (Stroke)'
                              : 'Stroke Outline Width'}
                          </span>
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

                      {params.boxMode ? (
                        <>
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-slate-600">
                                Hollow Box Total Height (Z)
                              </span>
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

                          {/* Lid Fit Style */}
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-slate-600 block">
                              Traced Image Lid Fit Style
                            </span>
                            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-xl border border-slate-200">
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
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
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
                                <span className="text-slate-600">Lid XY Clearance</span>
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

                          {/* Parts to Export */}
                          <div className="space-y-1 pt-1 border-t border-slate-200">
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
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-1">
                            <span className="text-xs font-medium text-slate-600 block">
                              Stroke 3D Surface Profile
                            </span>
                            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-xl border border-slate-200">
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
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}

            {controlsTab === 'all' && <hr className="border-slate-200" />}

            {(controlsTab === 'all' || controlsTab === 'extrusion') && (
              /* Section 06: 3D Extrusion Profile & Dimensions */
              <section className="space-y-3.5">
                <h3 className="text-xs font-bold text-slate-800">
                  06. 3D Extrusion &amp; Slicer Geometry
                </h3>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-600 block">
                    Multi-Colour Extrusion Topology
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {(
                      [
                        {
                          mode: 'backed_inlay' as ExtrusionMode,
                          title: 'Backed Silhouette + Surface Inlay',
                          desc: 'Base slot forms solid outer silhouette core; active colours inlay on top.',
                        },
                        {
                          mode: 'full_flush' as ExtrusionMode,
                          title: 'Full-Depth Flush Extrusion',
                          desc: 'Every active colour extrudes full Z-height (0 to top).',
                        },
                        {
                          mode: 'stepped_relief' as ExtrusionMode,
                          title: 'Inkscape Stacked Relief (2.5D)',
                          desc: 'Cumulative stacked vector layers with stepped Z-heights.',
                        },
                      ] as const
                    ).map((item) => {
                      const active = params.extrusionMode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() =>
                            setParams((p) => ({ ...p, extrusionMode: item.mode }))
                          }
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <div className="text-xs font-bold">{item.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            {item.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Physical Print Width (mm) */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600">Print Width (X)</span>
                    <span className="font-mono font-semibold text-teal-700">
                      {params.targetWidthMm.toFixed(0)} mm
                      {extrudedModel
                        ? ` × ${extrudedModel.dimensionsMm.depth.toFixed(0)} mm`
                        : ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={25}
                    max={230}
                    step={5}
                    value={params.targetWidthMm}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        targetWidthMm: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                {/* Base Thickness (mm) */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600">
                      {params.extrusionMode === 'full_flush'
                        ? 'Total Extrusion Thickness (Z)'
                        : 'Base Silhouette Thickness'}
                    </span>
                    <span className="font-mono font-semibold text-slate-800">
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
                      setParams((p) => ({
                        ...p,
                        baseThicknessMm: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                {/* Inlay / Step Layer Thickness (mm) */}
                {params.extrusionMode !== 'full_flush' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">
                        {params.extrusionMode === 'backed_inlay'
                          ? 'Non-Base Colour Inlay Depth'
                          : 'Z-Step Height per Colour'}
                      </span>
                      <span className="font-mono font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                        {params.inlayThicknessMm.toFixed(2)} mm (
                        {Math.round(params.inlayThicknessMm / 0.2)}{' '}
                        {Math.round(params.inlayThicknessMm / 0.2) === 1
                          ? 'layer'
                          : 'layers'}{' '}
                        @ 0.20mm)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setParams((p) => ({ ...p, inlayThicknessMm: 0.4 }))}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                          Math.abs(params.inlayThicknessMm - 0.4) < 0.05
                            ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        0.4mm (2 Layers · Bambu Standard)
                      </button>
                      <button
                        type="button"
                        onClick={() => setParams((p) => ({ ...p, inlayThicknessMm: 0.6 }))}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                          Math.abs(params.inlayThicknessMm - 0.6) < 0.05
                            ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        0.6mm (3 Layers)
                      </button>
                      <button
                        type="button"
                        onClick={() => setParams((p) => ({ ...p, inlayThicknessMm: 0.8 }))}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                          Math.abs(params.inlayThicknessMm - 0.8) < 0.05
                            ? 'bg-blue-600 text-white border-blue-700 shadow-2xs'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        0.8mm (4 Layers)
                      </button>
                    </div>

                    <input
                      type="range"
                      min={0.2}
                      max={3.0}
                      step={0.2}
                      value={params.inlayThicknessMm}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          inlayThicknessMm: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />

                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      At <span className="font-semibold text-slate-700">0.40mm</span>, non-base colours
                      export at exactly 2 layers on the build plate. The remaining{' '}
                      <span className="font-semibold text-slate-700">
                        {(params.baseThicknessMm - params.inlayThicknessMm).toFixed(1)}mm
                      </span>{' '}
                      prints 100% in the base filament with zero filament changes.
                    </p>

                    {/* Print Bed Orientation Toggle */}
                    <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700 block">
                          Export Print Bed Alignment
                        </span>
                        <span className="text-[10px] text-teal-600 font-semibold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                          Preview: Always Facing Up
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFlipFaceDown(true);
                            setParams((p) => ({ ...p, flipFaceDown: true }));
                          }}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            flipFaceDown
                              ? 'bg-teal-50 border-teal-300 ring-2 ring-teal-500/20 text-teal-900 shadow-2xs'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="text-[11px] font-bold flex items-center justify-between">
                            <span>Face-Down (PEI Bed)</span>
                            {flipFaceDown && <span className="text-[10px] text-teal-600 font-bold">✓ Active</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                            Preview faces UP; exports flipped on build plate (strictly 2 layers @ 0.4mm).
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFlipFaceDown(false);
                            setParams((p) => ({ ...p, flipFaceDown: false }));
                          }}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            !flipFaceDown
                              ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20 text-blue-900 shadow-2xs'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="text-[11px] font-bold flex items-center justify-between">
                            <span>Face-Up (Embossed)</span>
                            {!flipFaceDown && <span className="text-[10px] text-blue-600 font-bold">✓ Active</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                            Both preview and export face up; inlays sit on top surface of base plate.
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>

        {/* =====================================================================
            RIGHT COLUMN (lg:col-span-7): Live 2D/3D Stage + Submission & Export Card
        ===================================================================== */}
        <div className="lg:col-span-7 space-y-6">
          {/* TOP CARD: Live Interactive 2D/3D Stage */}
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
            {/* Panel Header Bar */}
            <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-teal-700" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Interactive 3D Build Plate &amp; Vector Inspector
                </span>
              </div>

              {/* View Mode Switcher Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    ['3d_plate', '3D Bambu Plate'],
                    ['vector_paths', '2D Vector Contours'],
                    ['quantized_flat', '4-Colour Flatten'],
                    ['side_by_side', 'Original vs Trace'],
                  ] as [MainViewMode, string][]
                ).map(([mode, label]) => {
                  const active = activeView === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        if (mode === '3d_plate') setEyedropperTarget(null);
                        setActiveView(mode);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        active
                          ? 'bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-500/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Interactive Stage Canvas */}
            <div className="h-[480px] sm:h-[530px] relative bg-[#0B0F17]">
              {activeView === '3d_plate' ? (
                <Viewport3D
                  model={extrudedModel}
                  highlightedSlot={effectiveHighlightedSlot}
                  flipFaceDown={flipFaceDown}
                  onToggleFlipFaceDown={() => {
                    setFlipFaceDown((f) => {
                      const next = !f;
                      setParams((p) => ({ ...p, flipFaceDown: next }));
                      return next;
                    });
                  }}
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

              {isDraggingFile && (
                <div className="absolute inset-4 z-30 rounded-xl border-2 border-dashed border-blue-400 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
                  <Upload className="w-10 h-10 text-blue-400 mb-2 animate-bounce" />
                  <p className="text-base font-semibold text-white">
                    Drop image to trace into 4 Bambu AMS colours
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM CARD: Submission & Export Card (ExportPanel) */}
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
            {/* Panel Header Bar */}
            <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Maker Space Submission &amp; Bambu .3MF Export
                </h3>
                <p className="text-xs text-slate-500">
                  Submit directly to the Kāpiti Library print queue or download ready-to-slice files
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-md bg-teal-50 text-teal-800 border border-teal-200 font-mono text-xs font-bold">
                Est. ${printEstimate.costNzd.toFixed(2)} NZD
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* 4-Column Technical Spec Telemetry Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                    Dimensions
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 mt-0.5 block">
                    {extrudedModel
                      ? `${Math.round(extrudedModel.dimensionsMm.width)}×${Math.round(
                          extrudedModel.dimensionsMm.depth
                        )}×${extrudedModel.dimensionsMm.height.toFixed(1)}mm`
                      : `${params.targetWidthMm}mm`}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                    Filament Weight
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 mt-0.5 block">
                    ~{printEstimate.approxTotalGrams}g PLA
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                    Est. Print Time
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-800 mt-0.5 block">
                    ~{printEstimate.approxMinutes} mins
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-teal-50/60 border border-teal-200">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-700 block">
                    Maker Space Fee
                  </span>
                  <span className="font-mono text-xs font-bold text-teal-800 mt-0.5 block">
                    ${printEstimate.costNzd.toFixed(2)} NZD
                  </span>
                </div>
              </div>

              {/* Bambu Studio Colour Loader Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-700">
                    Bambu .3MF Colour Format:
                  </span>
                  <div className="flex items-center bg-white p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setBambuColorFormat('standard_colorgroup')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                        bambuColorFormat === 'standard_colorgroup'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Auto-Parse Colours
                    </button>
                    <button
                      type="button"
                      onClick={() => setBambuColorFormat('bambu_project')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                        bambuColorFormat === 'bambu_project'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Full Project Config
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSnapToOfficialBambuHex((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    snapToOfficialBambuHex
                      ? 'bg-teal-50 border-teal-200 text-teal-800'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  Snap to Bambu Hex: {snapToOfficialBambuHex ? 'ON' : 'EXACT HEX'}
                </button>
              </div>

              {/* Primary Action Buttons: Send to Maker Space + Bambu .3MF + Binary STLs + .SVG */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setIsSubmitModalOpen(true)}
                  className="sm:col-span-4 py-3 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Send to Maker Space</span>
                </button>

                <button
                  type="button"
                  onClick={handleExport3MF}
                  disabled={!extrudedModel || isExporting}
                  className="sm:col-span-3 py-3 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {exportSuccessText ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span className="truncate">{exportSuccessText}</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Bambu .3MF</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowStlModal(true)}
                  disabled={!extrudedModel || isExporting}
                  className="sm:col-span-3 py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Binary STLs (.ZIP)</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportSVG}
                  disabled={!traceResult}
                  className="sm:col-span-2 py-3 px-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>.SVG</span>
                </button>
              </div>

              {/* STL Export Modal Dialog */}
              {showStlModal && extrudedModel && (
                <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-xl border border-slate-200">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          Export Binary STLs (Bambu Studio Ready)
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Kāpiti Libraries NZ binary STL format with 0.4mm inlays (exactly 2 layers @ 0.2mm)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowStlModal(false)}
                        className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {/* Option 1: 2-Part Sign STL (Base + 0.4mm Inlays) */}
                      <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-teal-950">
                            1. 2-Part Sign STLs (.ZIP) — Recommended for Signs
                          </span>
                          <span className="text-[10px] font-mono text-teal-800 bg-teal-100/80 px-2 py-0.5 rounded font-semibold">
                            2 STLs
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Packages <span className="font-semibold text-slate-800">Base.stl</span> and{' '}
                          <span className="font-semibold text-slate-800">Inlays_0.4mm_2Layers.stl</span>{' '}
                          (all non-base artwork merged into one strictly 0.4mm part). Drag both into Bambu Studio
                          as a multi-part object.
                        </p>
                        <button
                          type="button"
                          onClick={handleExportTwoPartSignStl}
                          disabled={isExporting}
                          className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download 2-Part Sign STLs (.ZIP)</span>
                        </button>
                      </div>

                      {/* Option 2: All Parts STL (Separate file for every AMS color) */}
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">
                            2. All Colours Separated (.ZIP)
                          </span>
                          <span className="text-[10px] font-mono text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded font-semibold">
                            {extrudedModel.parts.length} STLs
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Exports an individual binary STL for every colour slot. Drop all STLs together into Bambu
                          Studio and assign each to your AMS slots.
                        </p>
                        <button
                          type="button"
                          onClick={handleExportAllStlsZip}
                          disabled={isExporting}
                          className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Download All Part STLs (.ZIP)</span>
                        </button>
                      </div>

                      {/* Individual Part Downloads */}
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                          Download Single STL by Part:
                        </span>
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                          {extrudedModel.parts.map((p, idx) => {
                            const isBase =
                              p.slotIndex === (params.strokeEnabled ? 4 : params.baseSlotIndex);
                            const thickness = (p.zMax - p.zMin).toFixed(2);
                            return (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-4 h-4 rounded border border-slate-300"
                                    style={{ backgroundColor: p.colorHex }}
                                  />
                                  <span className="font-semibold text-slate-800">{p.name}</span>
                                  <span
                                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                                      isBase
                                        ? 'bg-slate-200 text-slate-700'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold'
                                    }`}
                                  >
                                    {isBase ? `Base (${thickness}mm)` : `${thickness}mm (2 Layers)`}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleExportSinglePartStl(p)}
                                  className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Download className="w-3 h-3 text-slate-500" />
                                  <span>.STL</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
