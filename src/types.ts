import { ColorSlotConfig, TraceParameters } from './lib/colorQuantizer';
import { Bambu3mfColorFormat } from './lib/export3mf';

export type PrintJobStatus =
  | 'queued'
  | 'in_slicer'
  | 'printing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export interface CustomizerConfig {
  projectName: string;
  sampleId: string;
  sourceImageDataUrl?: string | null;
  params: TraceParameters;
  slotConfigs: ColorSlotConfig[];
  flipFaceDown: boolean;
  bambuColorFormat: Bambu3mfColorFormat;
  snapToOfficialBambuHex: boolean;
}

export interface PrintSubmission {
  id?: string;
  refId: string; // e.g. "NZS-PAR-4829"
  createdAt: number; // Date.now()
  updatedAt?: number;
  status: PrintJobStatus;

  // Requester details
  fullName: string;
  email: string;
  phoneOrCard?: string;
  pickupLocation: string;
  notes?: string;

  // The complete JSON recipe of what the user designed
  config: CustomizerConfig;

  // Pre-computed summary metrics for fast table sorting/display
  signDescription: string;
  approxTotalGrams: number;
  approxMinutes: number;
  costNzd: number;

  // Staff / Admin tracking
  staffNotes?: string;
  printedBy?: string;
}

export const PICKUP_LOCATIONS = [
  'Paraparaumu Library',
  'Ōtaki Library',
  'Waikanae Library',
] as const;

export function generateTicketReferenceId(pickupLocation: string): string {
  const locUpper = pickupLocation.toUpperCase();
  let branchCode = 'PAR';
  if (locUpper.includes('OTAKI') || locUpper.includes('ŌTAKI')) {
    branchCode = 'OTA';
  } else if (locUpper.includes('WAIKANAE')) {
    branchCode = 'WAI';
  }
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `NZS-${branchCode}-${randomDigits}`;
}
