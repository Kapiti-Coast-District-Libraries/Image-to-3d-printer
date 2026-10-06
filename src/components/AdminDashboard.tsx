import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns,
  Download,
  ExternalLink,
  FileCode2,
  Filter,
  Loader2,
  Lock,
  LogOut,
  PackageOpen,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  CustomizerConfig,
  PICKUP_LOCATIONS,
  PrintJobStatus,
  PrintSubmission,
} from '../types';
import {
  deleteSubmission,
  subscribeToSubmissions,
  updateSubmissionStatus,
} from '../services/submissionService';
import { reconstructFromConfig } from '../lib/printEstimator';
import { generateBambu3mfBlob, generateCleanSvgString } from '../lib/export3mf';
import { findClosestBambuFilament } from '../lib/bambuFilaments';

interface AdminDashboardProps {
  onBackToWorkspace: () => void;
  onLoadIntoEditor: (config: CustomizerConfig) => void;
}

const STATUS_META: Record<
  PrintJobStatus,
  { label: string; badgeClass: string }
> = {
  queued: {
    label: 'Queued',
    badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  },
  in_slicer: {
    label: 'In Slicer',
    badgeClass: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  },
  printing: {
    label: 'Printing',
    badgeClass: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  },
  ready: {
    label: 'Ready for Pickup',
    badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'bg-red-500/10 text-red-300 border-red-500/30',
  },
};

const STORAGE_KEY = 'kapiti_staff_auth';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onBackToWorkspace,
  onLoadIntoEditor,
}) => {
  // 1. Staff Session Gate (`kapiti_staff_auth`)
  const [staffBranch, setStaffBranch] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [loginUser, setLoginUser] = useState('paraparaumu');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // 2. Real-Time Firestore Queue State
  const [submissions, setSubmissions] = useState<PrintSubmission[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 3. Filters & Table Ergonomics
  const [statusFilter, setStatusFilter] = useState<PrintJobStatus | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [compactColumns, setCompactColumns] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 4. Inspector Staff Edits & On-Demand Export State
  const [staffNotesDraft, setStaffNotesDraft] = useState('');
  const [printedByDraft, setPrintedByDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [savedNotesToast, setSavedNotesToast] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Subscribe to Firestore printSubmissions when authenticated
  useEffect(() => {
    if (!staffBranch) return;
    setIsLoadingQueue(true);
    const unsub = subscribeToSubmissions(
      (items) => {
        setSubmissions(items);
        setIsLoadingQueue(false);
        if (items.length > 0 && !selectedId) {
          setSelectedId(items[0].id || null);
        }
      },
      () => {
        setIsLoadingQueue(false);
      }
    );
    return () => unsub();
  }, [staffBranch]);

  const selectedSubmission = useMemo(
    () => submissions.find((s) => s.id === selectedId) || null,
    [submissions, selectedId]
  );

  // Sync staff notes & printedBy draft when selection changes
  useEffect(() => {
    if (!selectedSubmission) return;
    setStaffNotesDraft(selectedSubmission.staffNotes || '');
    setPrintedByDraft(selectedSubmission.printedBy || staffBranch || '');
    setConfirmDeleteId(null);
  }, [selectedSubmission?.id, staffBranch]);

  // Render live 2D quantized + vector preview inside the Inspector Drawer when selectedSubmission changes
  useEffect(() => {
    let cancelled = false;
    if (!selectedSubmission || !inspectorOpen) return;

    reconstructFromConfig(selectedSubmission.config)
      .then(({ traceResult }) => {
        if (cancelled || !previewCanvasRef.current) return;
        const canvas = previewCanvasRef.current;
        const { width, height, quantizedImageData, silhouettePolygons } = traceResult;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);
        ctx.putImageData(quantizedImageData, 0, 0);

        // Draw crisp vector silhouette overlay
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 1.6;
        for (const poly of silhouettePolygons) {
          if (poly.outer.length < 2) continue;
          ctx.beginPath();
          poly.outer.forEach((pt, idx) =>
            idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)
          );
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      })
      .catch((err) => {
        console.error('Failed to render inspector preview:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSubmission, inspectorOpen]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = loginUser.trim().toLowerCase();
    const cleanPass = loginPass.trim();
    if (
      (cleanUser === 'paraparaumu' ||
        cleanUser === 'otaki' ||
        cleanUser === 'ōtaki' ||
        cleanUser === 'waikanae') &&
      cleanPass === 'makerspace'
    ) {
      try {
        sessionStorage.setItem(STORAGE_KEY, cleanUser);
      } catch {
        // ignore storage errors
      }
      setStaffBranch(cleanUser);
      setLoginError(null);
    } else {
      setLoginError(
        'Invalid branch credentials. Use branch "paraparaumu" or "otaki" and password "makerspace".'
      );
    }
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setStaffBranch(null);
    setLoginPass('');
  };

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (branchFilter !== 'all' && item.pickupLocation !== branchFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchRef = item.refId.toLowerCase().includes(q);
        const matchName = item.fullName.toLowerCase().includes(q);
        const matchEmail = item.email.toLowerCase().includes(q);
        const matchDesc = item.signDescription.toLowerCase().includes(q);
        if (!matchRef && !matchName && !matchEmail && !matchDesc) return false;
      }
      return true;
    });
  }, [submissions, statusFilter, branchFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: submissions.length,
      queued: 0,
      in_slicer: 0,
      printing: 0,
      ready: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const s of submissions) {
      counts[s.status] = (counts[s.status] || 0) + 1;
    }
    return counts;
  }, [submissions]);

  const handleScrollTable = (dir: 'left' | 'right') => {
    if (!tableScrollRef.current) return;
    const amount = dir === 'left' ? -320 : 320;
    tableScrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  const handleStatusChange = async (submission: PrintSubmission, nextStatus: PrintJobStatus) => {
    if (!submission.id) return;
    try {
      await updateSubmissionStatus(
        submission.id,
        nextStatus,
        submission.id === selectedSubmission?.id ? staffNotesDraft : submission.staffNotes,
        submission.id === selectedSubmission?.id ? printedByDraft : submission.printedBy
      );
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleSaveStaffDetails = async () => {
    if (!selectedSubmission?.id) return;
    setIsSavingNotes(true);
    try {
      await updateSubmissionStatus(
        selectedSubmission.id,
        selectedSubmission.status,
        staffNotesDraft,
        printedByDraft
      );
      setSavedNotesToast(true);
      setTimeout(() => setSavedNotesToast(false), 2000);
    } catch (err) {
      console.error('Failed to save staff notes:', err);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await deleteSubmission(id);
      if (selectedId === id) {
        setSelectedId(null);
      }
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete submission:', err);
    }
  };

  // On-Demand 3D .3MF Generation directly from submission.config
  const handleDownload3MF = async (submission: PrintSubmission) => {
    const key = `${submission.id}_3mf`;
    setGeneratingId(key);
    try {
      const cfg = submission.config;
      const exportOverride =
        cfg.params.boxMode
          ? { boxPlateLayout: 'side_by_side' as const, boxLidLiftMm: 0 }
          : undefined;

      const { extrudedModel } = await reconstructFromConfig(cfg, exportOverride);
      const blob = await generateBambu3mfBlob(extrudedModel, {
        projectName: `${submission.refId}_${cfg.projectName}`,
        flipFaceDown: cfg.flipFaceDown ?? true,
        slotConfigs: cfg.slotConfigs,
        snapToOfficialBambuHex: cfg.snapToOfficialBambuHex,
        colorFormat: cfg.bambuColorFormat || 'bambu_project',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${submission.refId}_${cfg.projectName}.3mf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate .3MF on demand:', err);
    } finally {
      setGeneratingId(null);
    }
  };

  // On-Demand 2D .SVG Generation directly from submission.config
  const handleDownloadSVG = async (submission: PrintSubmission) => {
    const key = `${submission.id}_svg`;
    setGeneratingId(key);
    try {
      const cfg = submission.config;
      const { traceResult } = await reconstructFromConfig(cfg);
      const svgContent = generateCleanSvgString(traceResult);
      const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${submission.refId}_${cfg.projectName}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate .SVG on demand:', err);
    } finally {
      setGeneratingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // RENDER 1: Staff Session Gate (Dark Mode Login)
  // ---------------------------------------------------------------------------
  if (!staffBranch) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col">
        {/* Top Admin Header */}
        <header className="h-14 bg-[#111827] border-b border-slate-800 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-sm">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-bold text-white tracking-tight">
                Kāpiti Maker Space · Staff Mission Control
              </span>
              <span className="ml-2.5 px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px]">
                BACK-OFFICE PORTAL
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Customer Workspace</span>
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Staff Branch Authentication</h2>
                <p className="text-xs text-slate-400">
                  Sign in to access the live Bambu .3MF print queue
                </p>
              </div>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Branch Identifier
                </label>
                <select
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="paraparaumu">paraparaumu (Paraparaumu Library)</option>
                  <option value="otaki">otaki (Ōtaki Library)</option>
                  <option value="waikanae">waikanae (Waikanae Library)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Maker Space Passcode
                </label>
                <input
                  type="password"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="Enter staff password (makerspace)"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setLoginUser('paraparaumu');
                    setLoginPass('makerspace');
                  }}
                  className="text-[11px] font-mono text-blue-400 hover:text-blue-300 underline cursor-pointer"
                >
                  Auto-fill demo credentials
                </button>
                <span className="text-[11px] font-mono text-slate-500">
                  Pass: makerspace
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition-colors cursor-pointer"
              >
                Unlock Maker Space Queue
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER 2: Mission-Control Dark Mode Admin Queue + 390px Inspector Drawer
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col">
      {/* Top Mission Control Bar */}
      <header className="h-14 bg-[#111827] border-b border-slate-800 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            <Printer className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight">
                Maker Space Print Queue
              </h1>
              <span className="px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 font-mono text-[10px] uppercase">
                Branch: {staffBranch}
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 font-mono text-[10px]">
                {submissions.length} Total Jobs
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Zero-file Firestore recipe stream · On-demand client-side .3MF &amp; .SVG mesh compiler
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Customer Customizer</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/50 text-slate-400 hover:text-red-300 border border-slate-800 text-xs font-medium transition-colors cursor-pointer"
            title="Lock Staff Session"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Toolbar & Filter Strip */}
      <div className="px-5 py-3 bg-[#0b0f19] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              ['all', 'All Orders'],
              ['queued', 'Queued'],
              ['in_slicer', 'In Slicer'],
              ['printing', 'Printing'],
              ['ready', 'Ready'],
              ['completed', 'Completed'],
              ['cancelled', 'Cancelled'],
            ] as const
          ).map(([st, label]) => {
            const active = statusFilter === st;
            const count = statusCounts[st] || 0;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                    : 'bg-[#111827] text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                    active ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Controls: Search, Branch Filter, Horizontal Scroll Buttons, Compact Toggle, Inspector Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search refId, name, email..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 w-48"
            />
          </div>

          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Branches</option>
              {PICKUP_LOCATIONS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Horizontal Table Scroll Buttons */}
          <div className="flex items-center bg-[#111827] border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => handleScrollTable('left')}
              className="px-2 py-1 rounded text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              title="Scroll Table Left"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Scroll</span>
            </button>
            <div className="w-px h-3.5 bg-slate-800" />
            <button
              type="button"
              onClick={() => handleScrollTable('right')}
              className="px-2 py-1 rounded text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              title="Scroll Table Right"
            >
              <span>Scroll</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCompactColumns((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              compactColumns
                ? 'bg-blue-950/50 text-blue-300 border-blue-500/40'
                : 'bg-[#111827] text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
            title="Toggle Compact / All Columns"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>{compactColumns ? 'Compact' : 'All Columns'}</span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg bg-[#111827] border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
            title="Toggle Order Inspector Drawer"
          >
            {inspectorOpen ? (
              <>
                <PanelRightClose className="w-3.5 h-3.5 text-blue-400" />
                <span>Hide Inspector</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>Show Inspector</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Fixed Viewport Content Area (`h-[calc(100vh-140px)]`) */}
      <div className="flex-1 px-5 py-4 flex gap-4 h-[calc(100vh-140px)] min-h-[480px] overflow-hidden">
        {/* Table Wrapper Card (`bg-[#111827] border border-slate-800 rounded-2xl`) */}
        <div className="flex-1 bg-[#111827] border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
          <div
            ref={tableScrollRef}
            className="flex-1 overflow-auto relative"
          >
            {isLoadingQueue ? (
              <div className="h-full flex items-center justify-center gap-2 text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Streaming real-time print queue from Firestore...</span>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-2">
                <Printer className="w-8 h-8 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">
                  No print submissions match the current filter
                </p>
                <p className="text-xs text-slate-500 max-w-sm">
                  When customers click &ldquo;Send to Maker Space&rdquo; in the customizer, their JSON recipe will appear here in real time.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[880px]">
                <thead className="sticky top-0 z-20 bg-slate-900/95 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Reference ID</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Pickup Branch</th>
                    <th className="py-3 px-3">Design &amp; Topology</th>
                    {!compactColumns && (
                      <>
                        <th className="py-3 px-3">AMS Colours</th>
                        <th className="py-3 px-3">Weight / Time</th>
                      </>
                    )}
                    <th className="py-3 px-3">Fee (NZD)</th>
                    <th className="py-3 px-4 sticky right-0 z-20 bg-slate-900/95 border-l border-slate-800/80 text-right">
                      Quick Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {filteredSubmissions.map((item) => {
                    const isSelected = item.id === selectedId;
                    const statusInfo = STATUS_META[item.status] || STATUS_META.queued;
                    const activeSwatches = (item.config?.slotConfigs || [])
                      .slice(0, item.config?.params?.numColors || 4)
                      .filter((s) => s.enabled);

                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setSelectedId(item.id || null);
                          if (!inspectorOpen) setInspectorOpen(true);
                        }}
                        className={`transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-950/30 border-l-2 border-l-blue-500'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        {/* Ref ID + Timestamp */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono font-bold text-slate-100">
                            {item.refId}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {new Date(item.createdAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${statusInfo.badgeClass}`}
                          >
                            {statusInfo.label}
                          </span>
                        </td>

                        {/* Customer */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-200">{item.fullName}</div>
                          <div className="text-[11px] text-slate-400">{item.email}</div>
                        </td>

                        {/* Branch */}
                        <td className="py-3 px-3 whitespace-nowrap text-slate-300">
                          {item.pickupLocation}
                        </td>

                        {/* Design Summary */}
                        <td className="py-3 px-3 max-w-[240px]">
                          <div className="flex items-center gap-1.5">
                            {item.config?.params?.boxMode ? (
                              <PackageOpen className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            )}
                            <span className="font-medium text-slate-200 truncate">
                              {item.signDescription}
                            </span>
                          </div>
                          {item.notes && (
                            <div className="text-[11px] text-amber-300/90 truncate mt-0.5">
                              Note: &ldquo;{item.notes}&rdquo;
                            </div>
                          )}
                        </td>

                        {!compactColumns && (
                          <>
                            {/* AMS Swatches */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                {activeSwatches.map((s, idx) => (
                                  <span
                                    key={idx}
                                    className="w-3.5 h-3.5 rounded-xs border border-white/20"
                                    style={{ backgroundColor: s.printHex }}
                                    title={`${s.name}: ${s.printHex}`}
                                  />
                                ))}
                                {(item.config?.params?.strokeEnabled ||
                                  item.config?.params?.boxMode) && (
                                  <span
                                    className="w-3.5 h-3.5 rounded-xs border border-teal-400/60"
                                    style={{
                                      backgroundColor:
                                        item.config.params.strokeColorHex || '#F8FAFC',
                                    }}
                                    title={`Stroke / Box: ${item.config.params.strokeColorHex}`}
                                  />
                                )}
                              </div>
                            </td>

                            {/* Weight & Time */}
                            <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-300">
                              {item.approxTotalGrams}g · {item.approxMinutes}m
                            </td>
                          </>
                        )}

                        {/* Fee */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono font-bold text-emerald-400">
                          ${(item.costNzd ?? 2.0).toFixed(2)}
                        </td>

                        {/* Sticky Right Action Cell */}
                        <td
                          onClick={(e) => e.stopPropagation()}
                          className="py-2.5 px-4 whitespace-nowrap sticky right-0 z-10 bg-[#111827] border-l border-slate-800/80 text-right"
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <select
                              value={item.status}
                              onChange={(e) =>
                                handleStatusChange(item, e.target.value as PrintJobStatus)
                              }
                              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
                            >
                              {Object.entries(STATUS_META).map(([val, meta]) => (
                                <option key={val} value={val}>
                                  {meta.label}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleDownload3MF(item)}
                              disabled={generatingId === `${item.id}_3mf`}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-mono text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                              title="Reconstruct & Download Bambu Studio .3MF on demand"
                            >
                              {generatingId === `${item.id}_3mf` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                              <span>.3MF</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Collapsible Right-Hand Order Inspector Drawer (390px wide) */}
        {inspectorOpen && (
          <aside className="w-[390px] shrink-0 bg-[#111827] border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-900/95 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Order Inspector
                </h3>
                <p className="text-[11px] text-slate-400 font-mono">
                  {selectedSubmission ? selectedSubmission.refId : 'Select an order row'}
                </p>
              </div>
              {selectedSubmission && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    STATUS_META[selectedSubmission.status]?.badgeClass
                  }`}
                >
                  {STATUS_META[selectedSubmission.status]?.label}
                </span>
              )}
            </div>

            {!selectedSubmission ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
                Click any order row in the queue to inspect its 2D vector trace and generate .3MF files on demand.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Live Reconstructed 2D Preview Canvas */}
                <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 mb-2">
                    <span>LIVE RECIPE RECONSTRUCTION</span>
                    <span>
                      {selectedSubmission.config.params.boxMode
                        ? `BOX MODE (${selectedSubmission.config.params.boxLidStyle || 'cap_with_plug'})`
                        : selectedSubmission.config.params.extrusionMode.toUpperCase()}
                    </span>
                  </div>
                  <canvas
                    ref={previewCanvasRef}
                    className="max-h-44 w-auto object-contain rounded border border-slate-800/80 bg-slate-950"
                  />
                </div>

                {/* On-Demand 1-Click File Generation & Load Into Editor */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload3MF(selectedSubmission)}
                      disabled={generatingId === `${selectedSubmission.id}_3mf`}
                      className="py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      {generatingId === `${selectedSubmission.id}_3mf` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Generate .3MF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadSVG(selectedSubmission)}
                      disabled={generatingId === `${selectedSubmission.id}_svg`}
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>Export .SVG</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onLoadIntoEditor(selectedSubmission.config)}
                    className="w-full py-2 px-3 rounded-xl bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Load Recipe into 3D Customizer Editor</span>
                  </button>
                </div>

                {/* Customer & Technical Telemetry */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Customer</span>
                    <span className="font-semibold text-slate-200">
                      {selectedSubmission.fullName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Email</span>
                    <span className="font-mono text-[11px] text-blue-300">
                      {selectedSubmission.email}
                    </span>
                  </div>
                  {selectedSubmission.phoneOrCard && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Card / Phone</span>
                      <span className="font-mono text-slate-200">
                        {selectedSubmission.phoneOrCard}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pickup Branch</span>
                    <span className="text-slate-200 font-medium">
                      {selectedSubmission.pickupLocation}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800">
                    <span className="text-slate-400">Width × Base / Inlay</span>
                    <span className="font-mono text-slate-200">
                      {selectedSubmission.config.params.targetWidthMm}mm ·{' '}
                      {selectedSubmission.config.params.baseThicknessMm}mm +{' '}
                      {selectedSubmission.config.params.inlayThicknessMm}mm
                    </span>
                  </div>
                  {selectedSubmission.config.params.boxMode && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Hollow Box Height / Wall</span>
                      <span className="font-mono text-teal-300">
                        {selectedSubmission.config.params.boxHeightMm ?? 28}mm Z ·{' '}
                        {selectedSubmission.config.params.strokeWidthMm}mm wall
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Estimated Material &amp; Fee</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {selectedSubmission.approxTotalGrams}g · $
                      {(selectedSubmission.costNzd ?? 2.0).toFixed(2)} NZD
                    </span>
                  </div>
                  {selectedSubmission.notes && (
                    <div className="pt-1.5 border-t border-slate-800">
                      <span className="text-[11px] text-slate-400 block mb-0.5">
                        Customer Note:
                      </span>
                      <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded p-2">
                        {selectedSubmission.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Staff Workflow & Notes */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Workflow Status
                    </label>
                    <select
                      value={selectedSubmission.status}
                      onChange={(e) =>
                        handleStatusChange(
                          selectedSubmission,
                          e.target.value as PrintJobStatus
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#111827] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      {Object.entries(STATUS_META).map(([val, meta]) => (
                        <option key={val} value={val}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Printed / Sliced By (Staff)
                    </label>
                    <input
                      type="text"
                      value={printedByDraft}
                      onChange={(e) => setPrintedByDraft(e.target.value)}
                      placeholder="e.g. Sam (Paraparaumu)"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#111827] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Internal Staff Notes
                    </label>
                    <textarea
                      rows={2}
                      value={staffNotesDraft}
                      onChange={(e) => setStaffNotesDraft(e.target.value)}
                      placeholder="Printer slot assignment, filament batch, pickup shelf..."
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#111827] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleSaveStaffDetails}
                      disabled={isSavingNotes}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        {savedNotesToast
                          ? 'Saved!'
                          : isSavingNotes
                          ? 'Saving...'
                          : 'Save Staff Notes'}
                      </span>
                    </button>

                    {selectedSubmission.id && (
                      <>
                        {confirmDeleteId === selectedSubmission.id ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteOrder(selectedSubmission.id!)}
                            className="py-1.5 px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            Confirm Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(selectedSubmission.id!)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-700 transition-colors cursor-pointer"
                            title="Delete Order"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};
