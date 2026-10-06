import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { PrintSubmission, PrintJobStatus } from '../types';

const COLLECTION_NAME = 'printSubmissions';

// Strips undefined values recursively because Firestore rejects undefined
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) return null as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore) as unknown as T;
  if (typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as unknown as T;
  }
  return obj;
}

// 1. Called by Customer "Send to Maker Space" modal
export async function submitPrintJob(
  data: Omit<PrintSubmission, 'id' | 'createdAt' | 'status'>
): Promise<string> {
  const rawPayload = {
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'queued' as PrintJobStatus,
  };
  const payload = sanitizeForFirestore(rawPayload);
  const docRef = await addDoc(collection(db, COLLECTION_NAME), payload);
  return docRef.id;
}

// 2. Called by Admin Dashboard useEffect() for instant live updates
export function subscribeToSubmissions(
  callback: (items: PrintSubmission[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: PrintSubmission[] = [];
      snapshot.forEach((docSnap) => {
        items.push({
          id: docSnap.id,
          ...(docSnap.data() as Omit<PrintSubmission, 'id'>),
        });
      });
      callback(items);
    },
    (error) => {
      console.error('Firestore subscription error:', error);
      if (onError) onError(error);
    }
  );
}

// 3. Called by Admin when changing status or saving staff notes
export async function updateSubmissionStatus(
  id: string,
  status: PrintJobStatus,
  staffNotes?: string,
  printedBy?: string
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const updateData: Record<string, unknown> = { status, updatedAt: Date.now() };
  if (staffNotes !== undefined) updateData.staffNotes = staffNotes;
  if (printedBy !== undefined) updateData.printedBy = printedBy;
  await updateDoc(docRef, sanitizeForFirestore(updateData));
}

// 4. Called by Admin to remove a cancelled/test submission
export async function deleteSubmission(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
}
