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
import { ProjectModeSection } from './components/ProjectModeSection';
import { SourceArtworkSection } from './components/SourceArtworkSection';
import { PrintSizeSection } from './components/PrintSizeSection';
import { FilamentColorsSection } from './components/FilamentColorsSection';
import { CleanupSection } from './components/CleanupSection';
import { VectorTraceSection } from './components/VectorTraceSection';
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
  Ruler,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
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
    strokeEnabled: true,
    strokeShape: 'rectangle',
    shapePaddingMm: 3.5,
    shapeCornerRadiusMm: 4.0,
    rectDepthMm: 65,
    logoScalePercent: 85,
    strokeWidthMm: 2.5,
    strokeColorHex: '#F8FAFC',
    strokeFillInnerGaps: true,
    strokeProfileStyle: 'flush_top_and_base',
    boxMode: true,
    boxHeightMm: 28,
    boxLidStyle: 'cap_with_plug',
    boxLidToleranceMm: 0.2,
    boxLedgeWidthMm: 1.4,
    boxPlateLayout: 'assembled',
    boxLidLiftMm: 16,
    boxExportParts: 'both',
    boxDividersEnabled: true,
    boxDividerCols: 2,
    boxDividerRows: 2,
    boxDividerThicknessMm: 1.0,
    boxDividerHeightRatio: 1.0,
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
  const [showStlModal, setShowStlModal] = useState<boolean>(false);
  const [openColorPickerSlot, setOpenColorPickerSlot] = useState<number | null>(null);
  const [isColorsExpanded, setIsColorsExpanded] = useState<boolean>(false);
  const [isCleanupExpanded, setIsCleanupExpanded] = useState<boolean>(false);
  const [isVectorTraceExpanded, setIsVectorTraceExpanded] = useState<boolean>(false);

  // Auto-expand advanced sections if an interactive tool is activated
  useEffect(() => {
    if (openColorPickerSlot !== null) {
      setIsColorsExpanded(true);
    }
  }, [openColorPickerSlot]);

  useEffect(() => {
    if (mergeItemMode || eyedropperTarget === 'remove_color') {
      setIsCleanupExpanded(true);
    }
  }, [mergeItemMode, eyedropperTarget]);

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
    params.seamOverlapMm,
    params.strokeEnabled,
    params.strokeShape,
    params.rectDepthMm,
    params.logoScalePercent,
    params.shapePaddingMm,
    params.shapeCornerRadiusMm,
    params.strokeWidthMm,
    params.strokeColorHex,
    params.strokeFillInnerGaps,
    params.strokeProfileStyle,
    params.boxMode,
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

      const activeSlotConfigs = slotConfigs.map((cfg) => {
        const layer = traceResult?.layers.find((l) => l.slotIndex === cfg.id);
        if (layer) {
          return {
            ...cfg,
            printHex: layer.printHex,
            detectedHex: layer.detectedHex,
            enabled: layer.enabled,
            mergedIntoSlot: layer.mergedIntoSlot,
          };
        }
        return cfg;
      });

      const blob = await generateBambu3mfBlob(modelForExport, {
        projectName,
        flipFaceDown,
        slotConfigs: activeSlotConfigs,
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
          <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 shrink-0">
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
          </div>

          {/* Scrollable Controls Body */}
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* 01. Project Mode: 3D Box + Lid vs Flat Badge */}
            <ProjectModeSection
              params={params}
              setParams={setParams}
              traceResult={traceResult}
            />

            {/* 02. Source Artwork */}
            <SourceArtworkSection
              fileInputRef={fileInputRef}
              samples={SAMPLE_ARTWORKS}
              activeSampleId={activeSampleId}
              onSelectSample={loadSampleArtwork}
            />

            {/* 03. Print Size & Thickness */}
            <PrintSizeSection
              params={params}
              setParams={setParams}
              extrudedModel={extrudedModel}
              traceResult={traceResult}
            />

            {/* 04. Bambu AMS Filament Colours (Collapsible) */}
            <FilamentColorsSection
              params={params}
              setParams={setParams}
              slotConfigs={slotConfigs}
              setSlotConfigs={setSlotConfigs}
              traceResult={traceResult}
              highlightedSlot={highlightedSlot}
              setHighlightedSlot={setHighlightedSlot}
              openColorPickerSlot={openColorPickerSlot}
              setOpenColorPickerSlot={setOpenColorPickerSlot}
              eyedropperTarget={eyedropperTarget}
              activateEyedropper={activateEyedropper}
              handleToggleSlotEnabled={handleToggleSlotEnabled}
              handleMergeSlotInto={handleMergeSlotInto}
              handleUnmergeAllSlots={handleUnmergeAllSlots}
              handleSnapAllToBambuFilaments={handleSnapAllToBambuFilaments}
              closestMergeablePair={closestMergeablePair}
              isExpanded={isColorsExpanded}
              onToggleExpand={() => setIsColorsExpanded((v) => !v)}
            />

            {/* 05. Background & Region Cleanup (Collapsible) */}
            <CleanupSection
              params={params}
              setParams={setParams}
              traceResult={traceResult}
              slotConfigs={slotConfigs}
              imageSwatches={imageSwatches}
              isSwatchRemoved={isSwatchRemoved}
              addOrToggleRemovedColor={addOrToggleRemovedColor}
              eyedropperTarget={eyedropperTarget}
              activateEyedropper={activateEyedropper}
              mergeItemMode={mergeItemMode}
              handleToggleMergeItemMode={handleToggleMergeItemMode}
              mergedRegionsCount={mergedRegionsCount}
              handleUndoLastMergedRegion={handleUndoLastMergedRegion}
              handleClearMergedRegions={handleClearMergedRegions}
              mergeItemTargetMode={mergeItemTargetMode}
              setMergeItemTargetMode={setMergeItemTargetMode}
              handleUpdateMergedRegionTarget={handleUpdateMergedRegionTarget}
              handleRemoveMergedRegionById={handleRemoveMergedRegionById}
              isExpanded={isCleanupExpanded}
              onToggleExpand={() => setIsCleanupExpanded((v) => !v)}
            />

            {/* 06. Vector Smoothing Engine (Collapsible) */}
            <VectorTraceSection
              params={params}
              setParams={setParams}
              isExpanded={isVectorTraceExpanded}
              onToggleExpand={() => setIsVectorTraceExpanded((v) => !v)}
            />
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
                  boxDividersEnabled={params.boxDividersEnabled ?? false}
                  boxDividerCols={params.boxDividerCols ?? 2}
                  boxDividerRows={params.boxDividerRows ?? 2}
                  onToggleBoxDividers={() =>
                    setParams((p) => ({
                      ...p,
                      boxDividersEnabled: !p.boxDividersEnabled,
                    }))
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



              {/* AMS 1..4 Mapping Guarantee Banner */}
              <div className="flex items-center gap-2 text-[11px] text-teal-900 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-xl">
                <Check className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span>
                  <strong>Bambu Studio Ready:</strong> Automatically mapped strictly to the first 4 colors (Slots 1–4). Just export, import into Bambu Studio, and print immediately without adding extra filaments or recoloring.
                </span>
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
