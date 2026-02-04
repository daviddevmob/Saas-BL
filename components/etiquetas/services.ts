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
  setDoc,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData
} from 'firebase/firestore';
import {
  MappingTemplate,
  ColumnMapping,
  EtiquetaRecord,
  ExistingLabelData,
  EtiquetasSettings,
  SavedMerge,
  OriginalSaleData,
  TrackingEvent
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

// Buscar histórico de etiquetas (paginado)
export async function fetchLabelsHistory(
  pageSize: number = 100,
  lastDoc: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<{ labels: EtiquetaRecord[], lastVisible: QueryDocumentSnapshot<DocumentData> | null }> {
  try {
    let q = query(
      collection(db, 'etiquetas'),
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );

    if (lastDoc) {
      q = query(
        collection(db, 'etiquetas'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(pageSize)
      );
    }

    const snapshot = await getDocs(q);
    const labels: EtiquetaRecord[] = [];
    
    snapshot.forEach(docSnap => {
      // Adiciona o ID do documento aos dados retornados se necessário, mas EtiquetaRecord não exige
      labels.push(docSnap.data() as EtiquetaRecord);
    });

    return {
      labels,
      lastVisible: snapshot.docs[snapshot.docs.length - 1] || null
    };
  } catch (err) {
    console.error('Erro ao buscar histórico de etiquetas:', err);
    return { labels: [], lastVisible: null };
  }
}

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

// Interface para dados completos do destinatário (para reenvio)
interface DestinatarioCompleto {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
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
  observacaoEnvio?: string,
  // Novos campos opcionais
  productName?: string,
  service?: string,
  zip?: string,
  // Dados completos do destinatário (para permitir reenvio)
  destinatarioData?: DestinatarioCompleto,
  // Controle de WhatsApp ao cliente
  // Se true, marca whatsappEnviado: false (aguardando postagem)
  // Se false/undefined, não adiciona o campo (etiqueta não precisa notificar cliente)
  notificarCliente?: boolean
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

    // Adicionar campos extras de forma segura (try-catch interno ou verificações simples)
    if (productName) docData.productName = productName;
    if (service) docData.service = service;
    if (zip) docData.zip = zip;

    // Salvar dados completos do destinatário para permitir reenvio futuro
    if (destinatarioData) {
      docData.destinatarioData = destinatarioData;
    }

    // Controle de WhatsApp ao cliente:
    // Se notificarCliente=true, marca como pendente (será enviado após postagem)
    if (notificarCliente) {
      docData.whatsappEnviado = false;
    }

    await addDoc(collection(db, 'etiquetas'), docData);
  } catch (err) {
    console.error('Erro ao salvar etiqueta:', err);
    // Não relançar erro para não quebrar fluxo principal, mas logar
  }
}

// Marcar WhatsApp como enviado (ou com erro)
export async function markWhatsappSent(
  etiqueta: string,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    const q = query(collection(db, 'etiquetas'), where('etiqueta', '==', etiqueta));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref;
      const updateData: Record<string, unknown> = {
        whatsappEnviado: success,
        whatsappEnviadoEm: Timestamp.now(),
      };
      if (error) {
        updateData.whatsappErro = error;
      }
      await updateDoc(docRef, updateData);
    }
  } catch (err) {
    console.error('Erro ao marcar WhatsApp como enviado:', err);
  }
}

// Atualizar status de rastreio da etiqueta
export async function updateLabelTrackingStatus(
  docId: string, // ID do documento no Firebase (não o transactionId)
  status: string,
  events: TrackingEvent[] = []
): Promise<void> {
  try {
    // Como labels não tem ID no tipo EtiquetaRecord original, precisamos garantir que quem chama tenha o ID do doc.
    // No fetchLabelsHistory vamos garantir que o ID venha junto ou fazer update por query.
    // Para simplificar e ser robusto: Update via query pelo 'etiqueta' (código de rastreio é único)
    
    const q = query(collection(db, 'etiquetas'), where('etiqueta', '==', docId));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref;
      await updateDoc(docRef, {
        trackingStatus: status,
        trackingLastUpdate: Timestamp.now(),
        trackingEvents: events
      });
    }
  } catch (err) {
    console.error('Erro ao atualizar rastreio:', err);
  }
}

// Buscar etiqueta pelo Transaction ID (para busca avulsa)
export async function fetchLabelByTransactionId(transactionId: string): Promise<EtiquetaRecord | null> {
  try {
    const q = query(collection(db, 'etiquetas'), where('transactionId', '==', transactionId));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data() as EtiquetaRecord;
    }
    return null;
  } catch (err) {
    console.error('Erro ao buscar etiqueta por transação:', err);
    return null;
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