import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  MapPin,
  PackageOpen,
  Send,
  Sparkles,
  User,
  Mail,
  Phone,
  FileText,
  X,
} from 'lucide-react';
import {
  CustomizerConfig,
  PICKUP_LOCATIONS,
  generateTicketReferenceId,
} from '../types';
import { submitPrintJob } from '../services/submissionService';
import {
  PrintEstimateMetrics,
  encodeImageDataToCompactDataUrl,
} from '../lib/printEstimator';

interface SendToMakerSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Omit<CustomizerConfig, 'sourceImageDataUrl'>;
  sourceImageData: ImageData | null;
  estimate: PrintEstimateMetrics;
  dimensionsMm: { width: number; depth: number; height: number } | null;
  colorSwatches: { name: string; hex: string }[];
}

export const SendToMakerSpaceModal: React.FC<SendToMakerSpaceModalProps> = ({
  isOpen,
  onClose,
  config,
  sourceImageData,
  estimate,
  dimensionsMm,
  colorSwatches,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneOrCard, setPhoneOrCard] = useState('');
  const [pickupLocation, setPickupLocation] = useState<string>(PICKUP_LOCATIONS[0]);
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedRefId, setSubmittedRefId] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setErrorMsg('Please enter your full name and email address.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const refId = generateTicketReferenceId(pickupLocation);
      const compactDataUrl =
        config.sampleId === 'custom' && sourceImageData
          ? encodeImageDataToCompactDataUrl(sourceImageData, 240)
          : null;

      const fullConfig: CustomizerConfig = {
        ...config,
        sourceImageDataUrl: compactDataUrl,
      };

      await submitPrintJob({
        refId,
        fullName: fullName.trim(),
        email: email.trim(),
        phoneOrCard: phoneOrCard.trim() || undefined,
        pickupLocation,
        notes: notes.trim() || undefined,
        config: fullConfig,
        signDescription: estimate.signDescription,
        approxTotalGrams: estimate.approxTotalGrams,
        approxMinutes: estimate.approxMinutes,
        costNzd: estimate.costNzd,
      });

      setSubmittedRefId(refId);
    } catch (err) {
      console.error('Failed to submit print job:', err);
      setErrorMsg(
        err instanceof Error
          ? `Submission failed: ${err.message}`
          : 'Could not submit your print job. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyRef = () => {
    if (!submittedRefId) return;
    navigator.clipboard.writeText(submittedRefId);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleResetAndClose = () => {
    setSubmittedRefId(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-xl overflow-hidden text-slate-900 my-auto">
        {/* Panel Header Bar */}
        <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-teal-700 text-white flex items-center justify-center shadow-xs">
              <Send className="w-3.5 h-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Send to Kāpiti Maker Space
              </h3>
              <p className="text-[11px] text-slate-500">
                Zero-file cloud queue · Deterministic Bambu .3MF reconstruction
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetAndClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submittedRefId ? (
          <div className="p-6 space-y-5">
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <span className="px-2.5 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-semibold">
                Order Queued in Maker Space
              </span>
              <h4 className="text-lg font-bold text-slate-900">
                Your 3D Print Request is Registered!
              </h4>
              <p className="text-xs text-slate-500 max-w-sm">
                Our library Maker Space team can now inspect and slice your multi-colour design on our Bambu Lab printers.
              </p>
            </div>

            {/* Ticket Reference Box */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                  Ticket Reference ID
                </span>
                <span className="font-mono text-lg font-bold text-slate-900 tracking-tight">
                  {submittedRefId}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyRef}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-xs font-medium text-slate-700 shadow-2xs transition-colors cursor-pointer"
              >
                {copiedRef ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-teal-600" />
                    <span className="text-teal-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>
            </div>

            {/* Summary Details */}
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Pickup Location</span>
                <span className="font-semibold text-slate-800">{pickupLocation}</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Design Summary</span>
                <span className="font-mono text-[11px] text-slate-700 truncate max-w-[260px]">
                  {estimate.signDescription}
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Estimated Material &amp; Time</span>
                <span className="font-mono font-medium text-slate-800">
                  {estimate.approxTotalGrams}g PLA · ~{estimate.approxMinutes} mins
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50/60">
                <span className="font-medium text-slate-700">Estimated Pickup Fee</span>
                <span className="font-mono text-sm font-bold text-teal-700">
                  ${estimate.costNzd.toFixed(2)} NZD
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition-colors cursor-pointer"
              >
                Done — Return to Workspace
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Design Telemetry Summary Strip */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {config.params.boxMode ? (
                    <PackageOpen className="w-4 h-4 text-teal-700 shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                  )}
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {estimate.signDescription}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-mono text-xs font-bold shrink-0">
                  ${estimate.costNzd.toFixed(2)} NZD
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/70 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Dimensions</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {dimensionsMm
                      ? `${Math.round(dimensionsMm.width)}×${Math.round(
                          dimensionsMm.depth
                        )}×${dimensionsMm.height.toFixed(1)}mm`
                      : `${config.params.targetWidthMm}mm`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Est. Filament</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {estimate.approxTotalGrams}g ({estimate.approxMinutes}m)
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">AMS Colours</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    {colorSwatches.map((sw, i) => (
                      <span
                        key={i}
                        className="w-3.5 h-3.5 rounded-xs border border-slate-300 shadow-2xs"
                        style={{ backgroundColor: sw.hex }}
                        title={`${sw.name} (${sw.hex})`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Aroha Williams"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Library Card # or Phone
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={phoneOrCard}
                    onChange={(e) => setPhoneOrCard(e.target.value)}
                    placeholder="e.g. D0123456 or 021..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pickup Library Branch <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                  >
                    {PICKUP_LOCATIONS.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notes for Maker Space Staff (Optional)
              </label>
              <div className="relative">
                <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Please print lid face-down on textured PEI plate if possible..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending Recipe to Queue...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Submit Print Job ({estimate.approxTotalGrams}g · ${estimate.costNzd.toFixed(2)})</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
