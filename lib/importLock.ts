import { db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

export interface ImportLockStatus {
  locked: boolean;
  lockedBy?: string;
  lockedAt?: Date;
  platform?: string;
  estimatedUnlock?: Date;
  message?: string;
}

const LOCK_DOC_PATH = 'configs/import_lock';

/**
 * Verifica se o sistema de importação está travado
 */
export async function checkImportLock(): Promise<ImportLockStatus> {
  try {
    const lockDoc = await getDoc(doc(db, LOCK_DOC_PATH));

    if (!lockDoc.exists()) {
      return { locked: false };
    }

    const data = lockDoc.data();

    // Se tem estimatedUnlock e já passou, considera desbloqueado
    if (data.estimatedUnlock) {
      const unlockTime = data.estimatedUnlock.toDate ? data.estimatedUnlock.toDate() : new Date(data.estimatedUnlock);
      if (new Date() > unlockTime) {
        // Auto-desbloqueia
        await unlockImport();
        return { locked: false };
      }
    }

    return {
      locked: data.locked || false,
      lockedBy: data.lockedBy,
      lockedAt: data.lockedAt?.toDate ? data.lockedAt.toDate() : undefined,
      platform: data.platform,
      estimatedUnlock: data.estimatedUnlock?.toDate ? data.estimatedUnlock.toDate() : undefined,
      message: data.message,
    };
  } catch (error) {
    console.error('Error checking import lock:', error);
    return { locked: false };
  }
}

/**
 * Trava o sistema de importação
 */
export async function lockImport(params: {
  lockedBy: string;
  platform: string;
  estimatedSeconds: number;
  message?: string;
}): Promise<boolean> {
  try {
    const now = new Date();
    const estimatedUnlock = new Date(now.getTime() + params.estimatedSeconds * 1000);

    await setDoc(doc(db, LOCK_DOC_PATH), {
      locked: true,
      lockedBy: params.lockedBy,
      lockedAt: now,
      platform: params.platform,
      estimatedUnlock: estimatedUnlock,
      message: params.message || `Importação ${params.platform} em andamento`,
    });

    return true;
  } catch (error) {
    console.error('Error locking import:', error);
    return false;
  }
}

/**
 * Destrava o sistema de importação
 */
export async function unlockImport(): Promise<boolean> {
  try {
    await setDoc(doc(db, LOCK_DOC_PATH), {
      locked: false,
      lockedBy: null,
      lockedAt: null,
      platform: null,
      estimatedUnlock: null,
      message: null,
    });

    return true;
  } catch (error) {
    console.error('Error unlocking import:', error);
    return false;
  }
}

/**
 * Listener em tempo real para o status de travamento
 */
export function subscribeToImportLock(
  callback: (status: ImportLockStatus) => void
): () => void {
  return onSnapshot(doc(db, LOCK_DOC_PATH), (snapshot) => {
    if (!snapshot.exists()) {
      callback({ locked: false });
      return;
    }

    const data = snapshot.data();

    // Se tem estimatedUnlock e já passou, considera desbloqueado
    if (data.estimatedUnlock) {
      const unlockTime = data.estimatedUnlock.toDate ? data.estimatedUnlock.toDate() : new Date(data.estimatedUnlock);
      if (new Date() > unlockTime) {
        callback({ locked: false });
        return;
      }
    }

    callback({
      locked: data.locked || false,
      lockedBy: data.lockedBy,
      lockedAt: data.lockedAt?.toDate ? data.lockedAt.toDate() : undefined,
      platform: data.platform,
      estimatedUnlock: data.estimatedUnlock?.toDate ? data.estimatedUnlock.toDate() : undefined,
      message: data.message,
    });
  });
}

/**
 * Formata o tempo restante para desbloqueio
 */
export function formatTimeRemaining(estimatedUnlock: Date): string {
  const now = new Date();
  const diff = estimatedUnlock.getTime() - now.getTime();

  if (diff <= 0) return 'Liberando...';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
