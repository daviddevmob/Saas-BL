import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  getDoc,
  setDoc
} from 'firebase/firestore';
import {
  MappingTemplate,
  ColumnMapping,
  EtiquetaRecord,
  ExistingLabelData,
  EtiquetasSettings,
  SavedMerge,
  OriginalSaleData
} from './types';
import { SETTINGS_DOC_ID } from './constants';
import { generateMergeId, sanitizeForFirebase } from './utils';

// ========== TEMPLATES DE MAPEAMENTO ==========

// Buscar todos os templates de mapeamento
export async function fetchMappingTemplates(): Promise<MappingTemplate[]> {
  try {
    const q = query(collection(db, 'mapping_templates'));
    const snapshot = await getDocs(q);
    const templates: MappingTemplate[] = [];
    snapshot.forEach(docSnap => {
      templates.push({
        id: docSnap.id,
        ...docSnap.data() as Omit<MappingTemplate, 'id'>
      });
    });
    // Ordenar por nome
    return templates.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('Erro ao buscar templates:', err);
    return [];
  }
}

// Salvar novo template de mapeamento
export async function saveMappingTemplate(name: string, mapping: ColumnMapping, logo?: string): Promise<string> {
  console.log('[Firebase] saveMappingTemplate chamado');
  console.log('[Firebase] name:', name);
  console.log('[Firebase] mapping keys:', Object.keys(mapping));
  console.log('[Firebase] logo:', logo);

  try {
    console.log('[Firebase] Tentando addDoc em mapping_templates...');
    const docRef = await addDoc(collection(db, 'mapping_templates'), {
      name,
      mapping,
      logo: logo || null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    console.log('[Firebase] Documento criado com ID:', docRef.id);
    return docRef.id;
  } catch (err) {
    console.error('[Firebase] ERRO ao salvar template:', err);
    throw err;
  }
}

// Atualizar template existente
export async function updateMappingTemplate(id: string, name: string, mapping: ColumnMapping, logo?: string | null): Promise<void> {
  try {
    const updateData: Record<string, unknown> = {
      name,
      mapping,
      updatedAt: Timestamp.now(),
    };
    // Se logo foi passado (mesmo que null), atualizar
    if (logo !== undefined) {
      updateData.logo = logo || null;
    }
    await updateDoc(doc(db, 'mapping_templates', id), updateData);
  } catch (err) {
    console.error('Erro ao atualizar template:', err);
    throw err;
  }
}

// Deletar template
export async function deleteMappingTemplate(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'mapping_templates', id));
  } catch (err) {
    console.error('Erro ao deletar template:', err);
    throw err;
  }
}

// ========== ETIQUETAS ==========

// Buscar etiquetas já geradas no Firebase
export async function fetchExistingLabels(transactionIds: string[]): Promise<Map<string, ExistingLabelData>> {
  const labelsMap = new Map<string, ExistingLabelData>();

  if (transactionIds.length === 0) return labelsMap;

  try {
    // Firebase tem limite de 30 itens por query "in", então dividimos em chunks
    const chunks = [];
    for (let i = 0; i < transactionIds.length; i += 30) {
      chunks.push(transactionIds.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      const q = query(
        collection(db, 'etiquetas'),
        where('transactionId', 'in', chunk)
      );
      const snapshot = await getDocs(q);
      snapshot.forEach(docSnap => {
        const data = docSnap.data() as EtiquetaRecord;
        const existing = labelsMap.get(data.transactionId);

        if (existing) {
          // Já tem etiquetas, adiciona mais uma
          existing.etiquetas.push(data.etiqueta);
          existing.enviosRealizados = existing.etiquetas.length;
          existing.ultimaEtiqueta = data.etiqueta;
          // Atualiza enviosTotal se o registro tiver essa info
          if (data.enviosTotal && data.enviosTotal > existing.enviosTotal) {
            existing.enviosTotal = data.enviosTotal;
          }
        } else {
          // Primeira etiqueta encontrada para esta transação
          // Se não tem enviosTotal no Firebase, considera 1 (etiquetas antigas)
          labelsMap.set(data.transactionId, {
            etiquetas: [data.etiqueta],
            enviosRealizados: 1,
            enviosTotal: data.enviosTotal || 1, // Compatibilidade com etiquetas antigas
            ultimaEtiqueta: data.etiqueta,
          });
        }
      });
    }
  } catch (err) {
    console.error('Erro ao buscar etiquetas existentes:', err);
  }

  return labelsMap;
}

// Salvar etiqueta no Firebase
export async function saveLabel(
  transactionId: string,
  etiqueta: string,
  destinatario: string,
  envioNumero: number,
  enviosTotal: number,
  mergedTransactionIds?: string[],
  produtos?: string[],
  observacaoEnvio?: string
): Promise<void> {
  try {
    const docData: Record<string, unknown> = {
      transactionId,
      etiqueta,
      destinatario,
      envioNumero,
      enviosTotal,
      createdAt: Timestamp.now(),
    };

    // Adicionar dados de merge se existirem
    if (mergedTransactionIds && mergedTransactionIds.length > 0) {
      docData.mergedTransactionIds = mergedTransactionIds;
    }
    if (produtos && produtos.length > 0) {
      docData.produtos = produtos;
    }
    // Adicionar observação do envio parcial se existir
    if (observacaoEnvio) {
      docData.observacaoEnvio = observacaoEnvio;
    }

    await addDoc(collection(db, 'etiquetas'), docData);
  } catch (err) {
    console.error('Erro ao salvar etiqueta:', err);
    throw err;
  }
}

// ========== CONFIGURAÇÕES ==========

// Carregar configurações do Firebase
export async function loadEtiquetasSettings(): Promise<EtiquetasSettings | null> {
  try {
    const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as EtiquetasSettings;
    }
    return null;
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
    return null;
  }
}

// Salvar configurações no Firebase
export async function saveEtiquetasSettings(settings: Omit<EtiquetasSettings, 'updatedAt'>): Promise<void> {
  try {
    const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
    await setDoc(docRef, {
      ...settings,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
  }
}

// ========== MERGES ==========

// Carregar merges salvos do Firebase
export async function loadSavedMerges(): Promise<SavedMerge[]> {
  try {
    const mergesRef = collection(db, 'etiquetas_merges');
    const snapshot = await getDocs(mergesRef);
    return snapshot.docs.map(docSnap => docSnap.data() as SavedMerge);
  } catch (err) {
    console.error('Erro ao carregar merges:', err);
    return [];
  }
}

// Salvar merge no Firebase
export async function saveMergeToFirebase(originalSales: OriginalSaleData[]): Promise<string> {
  try {
    const mergesRef = collection(db, 'etiquetas_merges');
    const transactions = originalSales.map(s => s.transaction);
    const mergeId = generateMergeId(transactions);
    // Usar mergeId como ID do documento para evitar duplicatas
    const docRef = doc(mergesRef, mergeId);
    // Sanitizar cada sale para remover campos undefined
    const sanitizedSales = originalSales.map(sale => sanitizeForFirebase(sale as unknown as Record<string, unknown>));
    await setDoc(docRef, {
      mergeId,
      originalSales: sanitizedSales,
      createdAt: Timestamp.now(),
    });
    console.log('Merge salvo no Firebase:', mergeId, transactions);
    return mergeId;
  } catch (err) {
    console.error('Erro ao salvar merge:', err);
    return '';
  }
}

// Remover merge do Firebase
export async function removeMergeFromFirebase(mergeId: string): Promise<void> {
  try {
    const mergesRef = collection(db, 'etiquetas_merges');
    const docRef = doc(mergesRef, mergeId);
    await deleteDoc(docRef);
    console.log('Merge removido do Firebase:', mergeId);
  } catch (err) {
    console.error('Erro ao remover merge:', err);
  }
}
