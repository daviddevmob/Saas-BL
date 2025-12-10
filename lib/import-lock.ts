import { db } from './firebase';
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';

export interface ImportLock {
  isLocked: boolean;
  platform: string;
  startedAt: Date;
  startedBy?: string;
  fileName?: string;
  total?: number;
  processed?: number;
  created?: number;
  exists?: number;
  errors?: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  lastUpdate?: Date;
  message?: string;
}

const LOCK_DOC = 'import-csv-lock';
const LOCK_COLLECTION = 'system';

export async function getImportLock(): Promise<ImportLock | null> {
  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
  const lockSnap = await getDoc(lockRef);

  if (lockSnap.exists()) {
    const data = lockSnap.data();
    return {
      ...data,
      startedAt: data.startedAt?.toDate() || new Date(),
      lastUpdate: data.lastUpdate?.toDate(),
    } as ImportLock;
  }

  return null;
}

export async function acquireImportLock(
  platform: string,
  fileName?: string,
  startedBy?: string
): Promise<boolean> {
  const existingLock = await getImportLock();

  // Se já tem um lock ativo e rodando, não permite
  if (existingLock && existingLock.isLocked && existingLock.status === 'running') {
    return false;
  }

  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
  await setDoc(lockRef, {
    isLocked: true,
    platform,
    startedAt: new Date(),
    startedBy,
    fileName,
    total: 0,
    processed: 0,
    created: 0,
    exists: 0,
    errors: 0,
    status: 'running',
    lastUpdate: new Date(),
    message: 'Iniciando importação...',
  });

  return true;
}

export async function updateImportProgress(data: Partial<ImportLock>): Promise<void> {
  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
  await setDoc(lockRef, {
    ...data,
    lastUpdate: new Date(),
  }, { merge: true });
}

export async function releaseImportLock(
  status: 'completed' | 'error' | 'cancelled',
  message?: string
): Promise<void> {
  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
  await setDoc(lockRef, {
    isLocked: false,
    status,
    message: message || (status === 'completed' ? 'Importação concluída' : status === 'error' ? 'Erro na importação' : 'Importação cancelada'),
    lastUpdate: new Date(),
  }, { merge: true });
}

export async function forceReleaseLock(): Promise<void> {
  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
  await deleteDoc(lockRef);
}

export function subscribeToImportLock(callback: (lock: ImportLock | null) => void): Unsubscribe {
  const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);

  return onSnapshot(lockRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      callback({
        ...data,
        startedAt: data.startedAt?.toDate() || new Date(),
        lastUpdate: data.lastUpdate?.toDate(),
      } as ImportLock);
    } else {
      callback(null);
    }
  });
}
