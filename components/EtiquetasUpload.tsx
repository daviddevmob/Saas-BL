'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Papa from 'papaparse';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, Timestamp, deleteDoc, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';

// Serviços ECT disponíveis (Correios) - códigos do contrato
const SERVICOS_ECT = [
  { code: '201501', name: 'IMPRESSO Normal Módico' },
  { code: '3298', name: 'PAC Prata/Ouro/Platinum' },
  { code: '3220', name: 'SEDEX Prata/Ouro/Platinum' },
];

const DEFAULT_SERVICO_ECT = '201501';

// Função para verificar se é produto físico (contém "físico", "fisico" ou "kit" no nome)
function isPhysicalProduct(productName: string): boolean {
  const name = productName.toLowerCase();
  // Verifica "físico" (com acento), "fisico" (sem acento) ou "kit"
  return name.includes('físico') || name.includes('fisico') || name.includes('kit');
}

// Campos necessários para etiquetas
const REQUIRED_FIELDS = ['transaction', 'name', 'zip'] as const;

// Definição dos campos para mapeamento
const FIELD_DEFINITIONS: { key: string; label: string; required: boolean; description: string }[] = [
  { key: 'transaction', label: 'Código da Transação', required: true, description: 'Identificador único do pedido' },
  { key: 'productName', label: 'Nome do Produto', required: false, description: 'Nome do produto vendido' },
  { key: 'productCode', label: 'Código do Produto', required: false, description: 'Código/SKU do produto' },
  { key: 'name', label: 'Nome do Cliente', required: true, description: 'Nome completo do destinatário' },
  { key: 'document', label: 'CPF/CNPJ', required: false, description: 'Documento do cliente' },
  { key: 'email', label: 'Email', required: false, description: 'Email do cliente' },
  { key: 'phone', label: 'Telefone', required: false, description: 'Telefone do cliente' },
  { key: 'zip', label: 'CEP', required: true, description: 'CEP do endereço de entrega' },
  { key: 'address', label: 'Logradouro', required: false, description: 'Rua/Avenida' },
  { key: 'number', label: 'Número', required: false, description: 'Número do endereço' },
  { key: 'complement', label: 'Complemento', required: false, description: 'Apartamento, bloco, etc.' },
  { key: 'neighborhood', label: 'Bairro', required: false, description: 'Bairro' },
  { key: 'city', label: 'Cidade', required: false, description: 'Cidade' },
  { key: 'state', label: 'Estado/UF', required: false, description: 'Estado (sigla)' },
  { key: 'country', label: 'País', required: false, description: 'País' },
  { key: 'saleDate', label: 'Data da Venda', required: false, description: 'Data da transação' },
  { key: 'totalPrice', label: 'Valor Total', required: false, description: 'Valor da compra' },
];

// Mapeamento padrão para Hotmart (formato 2025)
const HOTMART_MAPPING: Record<string, string> = {
  transaction: 'Código da transação',
  status: 'Status da transação',
  productName: 'Produto',
  productCode: 'Código do produto',
  name: 'Comprador(a)',
  document: 'Documento',
  email: 'Email do(a) Comprador(a)',
  phone: 'Telefone',
  zip: 'Código postal',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'Estado / Província',
  country: 'País',
  saleDate: 'Data da transação',
  totalPrice: 'Valor de compra com impostos',
};

// Interface para mapeamento de colunas
interface ColumnMapping {
  [fieldKey: string]: string; // fieldKey -> csvColumnName
}

// Interface para template de mapeamento salvo no Firebase
interface MappingTemplate {
  id?: string;
  name: string;
  logo?: string; // Nome da imagem em public/lojas (ex: "hotmart.jpeg")
  mapping: ColumnMapping;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Logos disponíveis em public/lojas
const AVAILABLE_LOGOS = [
  { name: 'hotmart.jpeg', label: 'Hotmart' },
  { name: 'kiwwify.png', label: 'Kiwify' },
  { name: 'eduzz.jpg', label: 'Eduzz' },
  { name: 'hubla.jpeg', label: 'Hubla' },
  { name: 'woo.png', label: 'WooCommerce' },
];

// Funções CRUD para templates de mapeamento no Firebase
async function fetchMappingTemplates(): Promise<MappingTemplate[]> {
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

// Função para parsear data em qualquer formato (BR ou ISO)
function parseDate(dateStr: string): number {
  if (!dateStr) return 0;

  // Tentar formato ISO primeiro (YYYY-MM-DD ou com T)
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  // Tentar formato brasileiro DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
  const brMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (brMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = brMatch;
    date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return 0;
}

async function saveMappingTemplate(name: string, mapping: ColumnMapping, logo?: string): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'mapping_templates'), {
      name,
      mapping,
      logo: logo || null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return docRef.id;
  } catch (err) {
    console.error('Erro ao salvar template:', err);
    throw err;
  }
}

async function updateMappingTemplate(id: string, name: string, mapping: ColumnMapping): Promise<void> {
  try {
    await updateDoc(doc(db, 'mapping_templates', id), {
      name,
      mapping,
      updatedAt: Timestamp.now(),
    });
  } catch (err) {
    console.error('Erro ao atualizar template:', err);
    throw err;
  }
}

async function deleteMappingTemplate(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'mapping_templates', id));
  } catch (err) {
    console.error('Erro ao deletar template:', err);
    throw err;
  }
}

// Função para tentar detectar mapeamento automaticamente
function autoDetectMapping(csvColumns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const columnsLower = csvColumns.map(c => c.toLowerCase().trim());

  // Tentar detectar cada campo baseado em palavras-chave
  const detectionRules: { key: string; keywords: string[] }[] = [
    { key: 'transaction', keywords: ['transação', 'transacao', 'transaction', 'pedido', 'order', 'código da transação'] },
    { key: 'status', keywords: ['status'] },
    { key: 'productName', keywords: ['produto', 'product', 'nome do produto'] },
    { key: 'productCode', keywords: ['código do produto', 'codigo do produto', 'sku', 'product code'] },
    { key: 'name', keywords: ['comprador', 'cliente', 'nome', 'name', 'buyer', 'destinatário'] },
    { key: 'document', keywords: ['documento', 'cpf', 'cnpj', 'document'] },
    { key: 'email', keywords: ['email', 'e-mail'] },
    { key: 'phone', keywords: ['telefone', 'phone', 'celular', 'tel'] },
    { key: 'zip', keywords: ['cep', 'código postal', 'codigo postal', 'zip', 'postal'] },
    { key: 'address', keywords: ['endereço', 'endereco', 'logradouro', 'rua', 'address', 'street'] },
    { key: 'number', keywords: ['número', 'numero', 'nº', 'number'] },
    { key: 'complement', keywords: ['complemento', 'complement', 'apto', 'apartamento'] },
    { key: 'neighborhood', keywords: ['bairro', 'neighborhood'] },
    { key: 'city', keywords: ['cidade', 'city'] },
    { key: 'state', keywords: ['estado', 'uf', 'state', 'província', 'provincia'] },
    { key: 'country', keywords: ['país', 'pais', 'country'] },
    { key: 'saleDate', keywords: ['data', 'date', 'data da transação', 'data da venda'] },
    { key: 'totalPrice', keywords: ['valor', 'price', 'total', 'preço', 'preco'] },
  ];

  for (const rule of detectionRules) {
    for (let i = 0; i < columnsLower.length; i++) {
      const col = columnsLower[i];
      if (rule.keywords.some(kw => col.includes(kw))) {
        // Verificar se não é um falso positivo (ex: "email do comprador" não deve mapear para "name")
        if (!mapping[rule.key]) {
          mapping[rule.key] = csvColumns[i];
          break;
        }
      }
    }
  }

  return mapping;
}

// Colunas do CSV Hotmart (formato atualizado 2025) - mantido para compatibilidade
const HOTMART_COLUMNS = {
  productName: 'Produto',
  productCode: 'Código do produto',
  transaction: 'Código da transação',
  status: 'Status da transação',
  name: 'Comprador(a)',
  document: 'Documento',
  email: 'Email do(a) Comprador(a)',
  phone: 'Telefone',
  zip: 'Código postal',
  city: 'Cidade',
  state: 'Estado / Província',
  neighborhood: 'Bairro',
  country: 'País',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  saleDate: 'Data da transação',
  totalPrice: 'Valor de compra com impostos',
};


interface PhysicalSale {
  transaction: string;
  productName: string;
  productCode: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  state: string;
  neighborhood: string;
  country: string;
  address: string;
  number: string;
  complement: string;
  saleDate: string;
  totalPrice: string;
  selected: boolean;
  servicoEct: string; // Código do serviço ECT (Correios)
  etiqueta?: string; // Última etiqueta gerada (se existir)
  etiquetas?: string[]; // Todas as etiquetas geradas para este pedido
  etiquetaStatus?: 'pending' | 'generated' | 'partial' | 'error';
  enviosTotal: number; // Quantidade total de envios planejados
  enviosRealizados: number; // Quantidade de envios já realizados
  // Campos para pedidos mesclados
  isMerged?: boolean; // Este pedido foi criado por merge
  mergedTransactions?: string[]; // Lista de transactionIds originais (se mesclado)
  mergedProductNames?: string[]; // Lista de nomes de produtos (se mesclado)
  mergedOriginalSales?: OriginalSaleData[]; // Dados completos para restauração
  mergedInto?: string; // Se este pedido foi mesclado em outro, qual é o ID
}

interface EtiquetaRecord {
  transactionId: string;
  etiqueta: string;
  destinatario: string;
  createdAt: Timestamp;
  envioNumero?: number; // Qual envio é este (1, 2, 3...)
  enviosTotal?: number; // Total de envios planejados
  // Campos para pedidos mesclados
  mergedTransactionIds?: string[]; // Lista de transactionIds se for pedido mesclado
  produtos?: string[]; // Lista de produtos se for pedido mesclado
}

function parseCSV(text: string): Record<string, string>[] {
  // Usar PapaParse para parsing robusto de CSVs grandes
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  console.log(`[CSV] PapaParse: ${result.data.length} linhas, ${result.meta.fields?.length || 0} colunas, delimitador: "${result.meta.delimiter}"`);

  if (result.errors.length > 0) {
    console.warn('[CSV] PapaParse warnings:', result.errors.slice(0, 5));
  }

  return result.data;
}

// Interface para dados de etiquetas existentes
interface ExistingLabelData {
  etiquetas: string[];
  enviosRealizados: number;
  enviosTotal: number;
  ultimaEtiqueta: string;
}

// Buscar etiquetas já geradas no Firebase
async function fetchExistingLabels(transactionIds: string[]): Promise<Map<string, ExistingLabelData>> {
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
      snapshot.forEach(doc => {
        const data = doc.data() as EtiquetaRecord;
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
async function saveLabel(
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

// Interface para configurações de etiquetas
interface EtiquetasSettings {
  adminPhone: string;
  clientPhoneOverride: string;
  sendToN8n: boolean;
  sendClientNotification: boolean;
  useTestCredentials: boolean;
  updatedAt?: Timestamp;
}

// ID fixo do documento de configurações
const SETTINGS_DOC_ID = 'etiquetas_config';

// Interface para dados originais de uma venda (para restauração completa)
interface OriginalSaleData {
  transaction: string;
  productName: string;
  productCode: string;
  totalPrice: string;
  document: string;
  saleDate: string;
  // Campos adicionais para restauração completa
  phone: string;
  country: string;
  servicoEct: string;
  // Campos de etiqueta para restauração do status
  etiquetaStatus?: 'pending' | 'generated' | 'partial' | 'error';
  etiqueta?: string;
  etiquetas?: string[];
  enviosTotal: number;
  enviosRealizados: number;
}

// Interface para merge salvo no Firebase
interface SavedMerge {
  mergeId: string; // ID único e consistente do merge
  originalSales: OriginalSaleData[]; // Dados completos dos pedidos originais
  createdAt: Timestamp;
}

// Gerar ID consistente para merge baseado nos IDs das transações
function generateMergeId(transactions: string[]): string {
  // Usar hash simples dos IDs ordenados para evitar problemas com underscores
  const sorted = [...transactions].sort();
  return `MERGED_${sorted.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).join('-')}`;
}

// Carregar merges salvos do Firebase
async function loadSavedMerges(): Promise<SavedMerge[]> {
  try {
    const mergesRef = collection(db, 'etiquetas_merges');
    const snapshot = await getDocs(mergesRef);
    return snapshot.docs.map(doc => doc.data() as SavedMerge);
  } catch (err) {
    console.error('Erro ao carregar merges:', err);
    return [];
  }
}

// Limpar campos undefined para o Firebase (não aceita undefined)
function sanitizeForFirebase<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// Salvar merge no Firebase
async function saveMergeToFirebase(originalSales: OriginalSaleData[]): Promise<string> {
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
async function removeMergeFromFirebase(mergeId: string): Promise<void> {
  try {
    const mergesRef = collection(db, 'etiquetas_merges');
    const docRef = doc(mergesRef, mergeId);
    await deleteDoc(docRef);
    console.log('Merge removido do Firebase:', mergeId);
  } catch (err) {
    console.error('Erro ao remover merge:', err);
  }
}

// Carregar configurações do Firebase
async function loadEtiquetasSettings(): Promise<EtiquetasSettings | null> {
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
async function saveEtiquetasSettings(settings: Omit<EtiquetasSettings, 'updatedAt'>): Promise<void> {
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

export default function EtiquetasUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [physicalSales, setPhysicalSales] = useState<PhysicalSale[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, success: 0, errors: 0 });
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'generated' | 'merge'>('all');
  const [selectedServicoEct, setSelectedServicoEct] = useState(DEFAULT_SERVICO_ECT);
  const [showServiceConfirmModal, setShowServiceConfirmModal] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<PhysicalSale[]>([]);
  const [searchText, setSearchText] = useState('');
  const [showMergeWarningModal, setShowMergeWarningModal] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PhysicalSale[]>([]);
  const [mergeDetailsSale, setMergeDetailsSale] = useState<PhysicalSale | null>(null);
  // Modal para merge com status misto (gerado + pendente)
  const [showMergeStatusModal, setShowMergeStatusModal] = useState(false);
  const [mergeStatusChoice, setMergeStatusChoice] = useState<'use_existing' | 'generate_new' | null>(null);
  // Estados para mapeamento de colunas CSV
  const [showColumnMappingModal, setShowColumnMappingModal] = useState(false);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estados para templates de mapeamento
  const [mappingTemplates, setMappingTemplates] = useState<MappingTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MappingTemplate | null>(null);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateLogo, setNewTemplateLogo] = useState<string>('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  // Estados para modais de template
  const [showDeleteTemplateModal, setShowDeleteTemplateModal] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<MappingTemplate | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showIncompatibleModal, setShowIncompatibleModal] = useState(false);
  const [showEditTemplateModal, setShowEditTemplateModal] = useState(false);
  const [templateToEdit, setTemplateToEdit] = useState<MappingTemplate | null>(null);
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editTemplateLogo, setEditTemplateLogo] = useState<string>('');
  const [showSaveAndProcessModal, setShowSaveAndProcessModal] = useState(false);

  // Estados para configurações de envio
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [sendToN8n, setSendToN8n] = useState(true); // Enviar dados para n8n/webhook
  const [sendClientNotification, setSendClientNotification] = useState(false); // Notificar cliente via WhatsApp
  const [useTestCredentials, setUseTestCredentials] = useState(false); // Usar credenciais de teste VIPP
  const [adminPhone, setAdminPhone] = useState('5585987080090'); // Telefone admin para notificações
  const [clientPhoneOverride, setClientPhoneOverride] = useState(''); // Telefone para testar notificação cliente
  const [showGenerationConfirmModal, setShowGenerationConfirmModal] = useState(false); // Modal de confirmação geração
  const [confirmEtiquetasText, setConfirmEtiquetasText] = useState(''); // Texto de confirmação "etiquetas" (produção)
  const [confirmEnviarText, setConfirmEnviarText] = useState(''); // Texto de confirmação "enviar" (cliente)
  const [envioObservacoes, setEnvioObservacoes] = useState<Record<string, string>>({}); // Observações para envios parciais (key = transactionId)
  const [ordemPrioridade, setOrdemPrioridade] = useState<'antigos' | 'novos'>('antigos'); // Ordem de prioridade: antigos primeiro ou novos primeiro
  const [observacaoGeral, setObservacaoGeral] = useState(''); // Observação geral para mensagem do admin
  const [showNewUploadConfirm, setShowNewUploadConfirm] = useState(false); // Modal de confirmação novo upload

  // Carregar templates do Firebase ao montar
  useEffect(() => {
    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      const templates = await fetchMappingTemplates();
      setMappingTemplates(templates);
      setIsLoadingTemplates(false);
    };
    loadTemplates();
  }, []);

  // Carregar configurações do Firebase ao montar
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await loadEtiquetasSettings();
      if (settings) {
        setAdminPhone(settings.adminPhone || '5585987080090');
        setClientPhoneOverride(settings.clientPhoneOverride || '');
        setSendToN8n(settings.sendToN8n !== false); // default true
        setSendClientNotification(settings.sendClientNotification || false);
        setUseTestCredentials(settings.useTestCredentials || false);
      }
    };
    loadSettings();
  }, []);

  // Validar telefone brasileiro (13 dígitos, começa com 55)
  const isValidPhone = (phone: string): boolean => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 13 && cleaned.startsWith('55');
  };

  // Salvar configurações no Firebase quando mudarem
  const handleSaveSettings = async () => {
    // Validar telefone admin antes de salvar
    if (!isValidPhone(adminPhone)) {
      alert('Telefone do admin inválido! Deve ter 13 dígitos e começar com 55.\nExemplo: 5585987080090');
      return;
    }
    await saveEtiquetasSettings({
      adminPhone,
      clientPhoneOverride,
      sendToN8n,
      sendClientNotification,
      useTestCredentials,
    });
  };

  // Verificar se precisa confirmar produção (não é teste)
  const needsProductionConfirm = !useTestCredentials;

  // Verificar se precisa confirmar envio ao cliente (notificação ativa + sem telefone de teste)
  const needsClientConfirm = sendClientNotification && sendToN8n && !clientPhoneOverride;

  // Carregar mapeamento salvo do localStorage (fallback)
  useEffect(() => {
    const savedMapping = localStorage.getItem('etiquetas_column_mapping');
    if (savedMapping) {
      try {
        setColumnMapping(JSON.parse(savedMapping));
      } catch {
        // Ignorar erro de parse
      }
    }
  }, []);

  // Desmarcar todas ao mudar filtro ou busca
  const handleFilterChange = (newFilter: 'all' | 'pending' | 'partial' | 'generated' | 'merge') => {
    setStatusFilter(newFilter);
    setPhysicalSales(prev => prev.map(s => ({ ...s, selected: false })));
  };

  // Função para remover acentos e normalizar texto
  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  // Verificar se busca tem texto válido (não só espaços)
  const hasSearchText = searchText.trim().length > 0;

  // Função para criar chave única de agrupamento (email + nome + endereço)
  const getMergeKey = (sale: PhysicalSale) => {
    const normalizeStr = (s: string) => s.toLowerCase().trim();
    return `${normalizeStr(sale.email)}|${normalizeStr(sale.name)}|${normalizeStr(sale.address)}|${normalizeStr(sale.number || '')}|${normalizeStr(sale.zip || '')}`;
  };

  // Identificar candidatos a merge: itens com mesmo email+nome+endereço (pendentes ou gerados)
  const mergeCandidateKeys = useMemo(() => {
    const visibleSales = physicalSales.filter(s => !s.mergedInto);
    // Considerar pendentes E gerados como possíveis candidatos a merge
    const eligibleSales = visibleSales.filter(s =>
      !s.isMerged && (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial')
    );
    const keyCount: Record<string, number> = {};

    eligibleSales.forEach(sale => {
      const key = getMergeKey(sale);
      keyCount[key] = (keyCount[key] || 0) + 1;
    });

    // Retorna apenas chaves que aparecem mais de uma vez (candidatos a merge)
    return new Set(Object.entries(keyCount).filter(([, count]) => count > 1).map(([key]) => key));
  }, [physicalSales]);

  // Contar itens para o filtro de merge
  const mergeFilterCount = useMemo(() => {
    const visibleSales = physicalSales.filter(s => !s.mergedInto);
    const mergedItems = visibleSales.filter(s => s.isMerged);
    // Considerar pendentes E gerados como candidatos
    const candidateItems = visibleSales.filter(s =>
      !s.isMerged &&
      (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial') &&
      mergeCandidateKeys.has(getMergeKey(s))
    );
    return mergedItems.length + candidateItems.length;
  }, [physicalSales, mergeCandidateKeys]);

  // Filtrar vendas pelo status e busca
  const filteredSales = useMemo(() => {
    let result = physicalSales.filter(sale => {
      // Ocultar pedidos que foram mesclados em outro
      if (sale.mergedInto) return false;

      // Primeiro filtrar por status
      let passesStatusFilter = true;
      if (statusFilter === 'pending') {
        // Pendentes: status pending OU itens mesclados com status pending
        passesStatusFilter = sale.etiquetaStatus === 'pending';
      }
      if (statusFilter === 'partial') {
        // Parciais: status partial OU itens mesclados com status partial
        passesStatusFilter = sale.etiquetaStatus === 'partial';
      }
      if (statusFilter === 'generated') {
        // Gerados: status generated OU itens mesclados com status generated
        passesStatusFilter = sale.etiquetaStatus === 'generated';
      }
      if (statusFilter === 'merge') {
        // Mesclar: APENAS itens mesclados E candidatos a merge (não duplica nos outros filtros)
        const isMergedItem = sale.isMerged;
        const isCandidate = !sale.isMerged &&
          (sale.etiquetaStatus === 'pending' || sale.etiquetaStatus === 'generated' || sale.etiquetaStatus === 'partial') &&
          mergeCandidateKeys.has(getMergeKey(sale));
        passesStatusFilter = isMergedItem || isCandidate;
      }

      if (!passesStatusFilter) return false;

      // Se tem texto de busca, filtrar por ele
      if (hasSearchText) {
        const searchNormalized = normalizeText(searchText);
        const fieldsToSearch = [
          sale.name,
          sale.email,
          sale.phone,
          sale.transaction,
          sale.productName,
          sale.city,
          sale.state,
          sale.neighborhood,
          sale.address,
          sale.zip,
          sale.etiqueta || '',
        ];
        return fieldsToSearch.some(field =>
          normalizeText(field).includes(searchNormalized)
        );
      }

      return true;
    });

    // Ordenar resultados (sempre ordena por data, mais recente primeiro)
    if (statusFilter === 'merge') {
      // Para o filtro de merge: mesclados primeiro (por data), depois candidatos agrupados
      result.sort((a, b) => {
        // Mesclados primeiro
        if (a.isMerged && !b.isMerged) return -1;
        if (!a.isMerged && b.isMerged) return 1;

        // Entre mesclados, ordenar por data (mais recente primeiro)
        if (a.isMerged && b.isMerged) {
          return parseDate(b.saleDate) - parseDate(a.saleDate);
        }

        // Entre candidatos, agrupar por chave de merge
        const keyA = getMergeKey(a);
        const keyB = getMergeKey(b);
        if (keyA !== keyB) return keyA.localeCompare(keyB);

        // Dentro do mesmo grupo, ordenar por data
        return parseDate(b.saleDate) - parseDate(a.saleDate);
      });
    } else {
      // Para outros filtros: ordenar por data (mais recente primeiro)
      result.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
    }

    return result;
  }, [physicalSales, statusFilter, hasSearchText, searchText, mergeCandidateKeys]);

  const handleFile = async (file: File) => {
    console.log('[CSV] Iniciando processamento do arquivo:', file.name);

    if (!file.name.endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setFileName(file.name);

    try {
      console.log('[CSV] Lendo conteúdo do arquivo...');
      const text = await file.text();
      console.log('[CSV] Arquivo lido, tamanho:', text.length, 'caracteres');

      console.log('[CSV] Parseando CSV...');
      const rows = parseCSV(text);
      console.log('[CSV] CSV parseado, linhas:', rows.length);
      setTotalRows(rows.length);

      if (rows.length === 0) {
        console.log('[CSV] ERRO: Arquivo vazio ou inválido');
        setError('Arquivo CSV vazio ou inválido');
        setIsProcessing(false);
        return;
      }

      // Detectar colunas do CSV
      const columns = Object.keys(rows[0]);
      console.log('[CSV] Colunas detectadas:', columns.length, columns);
      setCsvColumns(columns);
      setCsvData(rows);

      // Tentar auto-detectar mapeamento
      console.log('[CSV] Auto-detectando mapeamento...');
      let detectedMapping = autoDetectMapping(columns);
      console.log('[CSV] Mapeamento detectado:', detectedMapping);

      // Se já tem mapeamento salvo, usar ele como base
      const savedMapping = localStorage.getItem('etiquetas_column_mapping');
      if (savedMapping) {
        console.log('[CSV] Mapeamento salvo encontrado no localStorage');
        try {
          const parsed = JSON.parse(savedMapping);
          // Verificar se o mapeamento salvo é válido para este CSV
          const savedMappingValid = Object.values(parsed).every(
            (col) => columns.includes(col as string) || col === ''
          );
          if (savedMappingValid) {
            detectedMapping = { ...detectedMapping, ...parsed };
            console.log('[CSV] Mapeamento salvo aplicado');
          } else {
            console.log('[CSV] Mapeamento salvo inválido para este CSV');
          }
        } catch (parseErr) {
          console.log('[CSV] Erro ao parsear mapeamento salvo:', parseErr);
        }
      }

      setColumnMapping(detectedMapping);

      // Sempre mostrar modal para usuário revisar/ajustar mapeamento
      console.log('[CSV] Abrindo modal de mapeamento...');
      console.log('[CSV] csvColumns:', columns.length);
      console.log('[CSV] csvData:', rows.length);
      console.log('[CSV] columnMapping:', Object.keys(detectedMapping).length);

      // Setar estados de forma sequencial para garantir
      setIsProcessing(false);

      // Pequeno delay para garantir que os estados anteriores foram aplicados
      setTimeout(() => {
        console.log('[CSV] Setando showColumnMappingModal = true');
        setShowColumnMappingModal(true);
      }, 100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[CSV] ERRO ao processar arquivo:', errorMessage, err);
      setError(`Erro ao processar o arquivo CSV: ${errorMessage}`);
      setIsProcessing(false);
    }
  };

  // Processar CSV com o mapeamento configurado
  const processCSVWithMapping = async (rows: Record<string, string>[], mapping: ColumnMapping) => {
    setIsProcessing(true);
    setShowColumnMappingModal(false);

    try {
      // Salvar mapeamento no localStorage
      localStorage.setItem('etiquetas_column_mapping', JSON.stringify(mapping));

      // Filtrar vendas de produtos físicos com status Aprovado ou Completo
      const filtered = rows
        .filter(row => {
          const productName = row[mapping.productName] || '';
          const status = row[mapping.status] || '';

          // Verificar se é produto físico (contém "físico" ou "fisico" no nome)
          const isPhysical = isPhysicalProduct(productName);

          // Verificar status (se mapeado)
          // Se não tem coluna de status mapeada, aceita todos
          const hasStatusColumn = mapping.status && row[mapping.status];
          const isValidStatus = !hasStatusColumn ||
            status.toLowerCase().includes('aprovado') ||
            status.toLowerCase().includes('completo') ||
            status.toLowerCase().includes('approved') ||
            status.toLowerCase().includes('complete');

          return isPhysical && isValidStatus;
        })
        .map(row => ({
          transaction: row[mapping.transaction] || '',
          productName: row[mapping.productName] || '',
          productCode: row[mapping.productCode] || '',
          name: row[mapping.name] || '',
          document: row[mapping.document] || '',
          email: row[mapping.email] || '',
          phone: row[mapping.phone] || '',
          zip: row[mapping.zip] || '',
          city: row[mapping.city] || '',
          state: (() => {
            const stateValue = row[mapping.state] || '';
            if (!stateValue) {
              console.warn(`[CSV DEBUG] Estado vazio para ${row[mapping.name]}. Coluna mapeada: "${mapping.state}"`);
            }
            return stateValue;
          })(),
          neighborhood: row[mapping.neighborhood] || '',
          country: row[mapping.country] || '',
          address: row[mapping.address] || '',
          number: row[mapping.number] || '',
          complement: row[mapping.complement] || '',
          saleDate: row[mapping.saleDate] || '',
          totalPrice: row[mapping.totalPrice] || '',
          selected: false,
          servicoEct: DEFAULT_SERVICO_ECT,
          etiquetaStatus: 'pending' as const,
        }));

      // Buscar etiquetas já geradas
      const transactionIds = filtered.map(s => s.transaction);
      const existingLabels = await fetchExistingLabels(transactionIds);

      // Marcar as que já têm etiqueta e calcular status de envios
      const withLabels = filtered.map(sale => {
        const existingData = existingLabels.get(sale.transaction);
        if (existingData) {
          // Determinar status baseado em enviosRealizados vs enviosTotal
          let status: 'generated' | 'partial' = 'generated';
          if (existingData.enviosRealizados < existingData.enviosTotal) {
            status = 'partial';
          }
          return {
            ...sale,
            selected: false,
            etiqueta: existingData.ultimaEtiqueta,
            etiquetas: existingData.etiquetas,
            etiquetaStatus: status,
            enviosTotal: existingData.enviosTotal,
            enviosRealizados: existingData.enviosRealizados,
          };
        }
        // Pedido sem etiqueta ainda - padrão 1 envio
        return {
          ...sale,
          enviosTotal: 1,
          enviosRealizados: 0,
        };
      });

      // Auto-merge: Carregar merges salvos do Firebase e aplicar
      const savedMerges = await loadSavedMerges();
      let finalSales: PhysicalSale[] = [...withLabels];

      for (const merge of savedMerges) {
        // Extrair transações originais do merge salvo
        const originalTransactions = merge.originalSales.map(s => s.transaction);

        // Encontrar quais transações do merge estão presentes nos dados atuais
        const presentTransactions = originalTransactions.filter(
          transId => finalSales.some(s => s.transaction === transId)
        );

        if (presentTransactions.length > 0) {
          // Pelo menos uma transação do merge está presente - aplicar merge
          const salesToMerge = finalSales.filter(s =>
            originalTransactions.includes(s.transaction)
          );

          if (salesToMerge.length > 0) {
            // Usar o primeiro pedido encontrado como base
            const baseSale = salesToMerge[0];

            // Usar o mergeId consistente do Firebase
            const mergedId = merge.mergeId;

            // Usar dados do Firebase para produtos (garante consistência mesmo se parcial)
            const allProducts = merge.originalSales.map(s => s.productName);
            const allProductCodes = merge.originalSales.map(s => s.productCode);

            // Criar pedido mesclado com dados completos do Firebase
            const mergedSale: PhysicalSale = {
              ...baseSale,
              transaction: mergedId,
              productName: allProducts.join('\n'),
              productCode: allProductCodes.join(','),
              selected: false,
              isMerged: true,
              mergedTransactions: originalTransactions,
              mergedProductNames: allProducts,
              mergedOriginalSales: merge.originalSales,
              enviosTotal: baseSale.enviosTotal || 1,
              enviosRealizados: baseSale.enviosRealizados || 0,
              etiquetaStatus: baseSale.etiquetaStatus || 'pending',
            };

            // Remover os originais e adicionar o mesclado
            finalSales = [
              ...finalSales.filter(s => !originalTransactions.includes(s.transaction)),
              mergedSale,
            ];

            console.log('Auto-merge aplicado:', originalTransactions, '→', mergedId);
          }
        }
      }

      setPhysicalSales(finalSales);
    } catch (err) {
      setError('Erro ao processar o arquivo CSV');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Confirmar mapeamento e processar
  const confirmColumnMapping = () => {
    // Verificar campos obrigatórios
    const missingFields = REQUIRED_FIELDS.filter(
      field => !columnMapping[field] || !csvColumns.includes(columnMapping[field])
    );

    if (missingFields.length > 0) {
      const labels = missingFields.map(
        f => FIELD_DEFINITIONS.find(d => d.key === f)?.label || f
      ).join(', ');
      setError(`Campos obrigatórios não mapeados: ${labels}`);
      return;
    }

    processCSVWithMapping(csvData, columnMapping);
  };

  // Atualizar mapeamento de uma coluna
  const updateMapping = (fieldKey: string, csvColumn: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [fieldKey]: csvColumn,
    }));
  };

  // Limpar mapeamento salvo
  const clearSavedMapping = () => {
    localStorage.removeItem('etiquetas_column_mapping');
    setColumnMapping(autoDetectMapping(csvColumns));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (file) {
      console.log('[CSV] handleFileSelect chamado com:', file.name);
      handleFile(file);
    }
  };

  // Importar arquivo usando um template específico
  const handleFileWithTemplate = async (file: File, template: MappingTemplate) => {
    console.log('[CSV] Importando com template:', template.name);

    if (!file.name.endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setFileName(file.name);
    setSelectedTemplate(template);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      setTotalRows(rows.length);

      if (rows.length === 0) {
        setError('Arquivo CSV vazio ou inválido');
        setIsProcessing(false);
        return;
      }

      const columns = Object.keys(rows[0]);
      setCsvColumns(columns);
      setCsvData(rows);

      // Verificar se TODOS os campos do template estão mapeados para colunas existentes no CSV
      const templateMapping = template.mapping;
      const allFieldsValid = FIELD_DEFINITIONS.every(field => {
        const csvColumn = templateMapping[field.key];
        return csvColumn && columns.includes(csvColumn);
      });

      if (allFieldsValid) {
        // Template válido - processar direto sem modal
        console.log('[CSV] Template válido, processando direto...');
        setColumnMapping(templateMapping);
        setIsProcessing(false);
        processCSVWithMapping(rows, templateMapping);
      } else {
        // Template inválido - mostrar modal de incompatibilidade
        console.log('[CSV] Template inválido para este CSV, mostrando modal...');
        // Tentar auto-detectar e mesclar com template
        const detected = autoDetectMapping(columns);
        const merged = { ...detected };
        // Aplicar mapeamentos do template que ainda existem
        for (const [key, value] of Object.entries(templateMapping)) {
          if (columns.includes(value)) {
            merged[key] = value;
          }
        }
        setColumnMapping(merged);
        setIsProcessing(false);
        // Mostrar modal perguntando se quer criar novo mapeamento
        setShowIncompatibleModal(true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Erro ao processar o arquivo CSV: ${errorMessage}`);
      setIsProcessing(false);
    }
  };

  // Verificar se todos os campos estão mapeados
  const allFieldsMapped = FIELD_DEFINITIONS.every(
    field => columnMapping[field.key] && csvColumns.includes(columnMapping[field.key])
  );

  // Abrir modal de confirmação para salvar e processar
  const handleSaveTemplate = () => {
    if (!newTemplateName.trim()) {
      setError('Digite um nome para o modelo');
      return;
    }

    // Verificar se todos os campos estão mapeados
    if (!allFieldsMapped) {
      setError('Todos os campos devem estar mapeados para salvar o modelo');
      return;
    }

    // Mostrar modal de confirmação
    setShowSaveAndProcessModal(true);
  };

  // Salvar modelo e processar CSV
  const confirmSaveAndProcess = async () => {
    setIsSavingTemplate(true);
    try {
      const id = await saveMappingTemplate(newTemplateName.trim(), columnMapping, newTemplateLogo || undefined);
      // Adicionar à lista local
      setMappingTemplates(prev => [...prev, {
        id,
        name: newTemplateName.trim(),
        logo: newTemplateLogo || undefined,
        mapping: columnMapping,
      }].sort((a, b) => a.name.localeCompare(b.name)));

      // Fechar modais
      setNewTemplateName('');
      setNewTemplateLogo('');
      setShowSaveTemplateModal(false);
      setShowSaveAndProcessModal(false);
      setShowColumnMappingModal(false);

      // Processar o CSV
      processCSVWithMapping(csvData, columnMapping);
    } catch (err) {
      setError('Erro ao salvar modelo');
      console.error(err);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Cancelar salvar e processar
  const cancelSaveAndProcess = () => {
    setShowSaveAndProcessModal(false);
  };

  // Abrir modal de confirmação de exclusão
  const openDeleteModal = (template: MappingTemplate) => {
    setTemplateToDelete(template);
    setDeleteConfirmText('');
    setShowDeleteTemplateModal(true);
  };

  // Confirmar exclusão do template
  const confirmDeleteTemplate = async () => {
    if (!templateToDelete?.id) return;
    if (deleteConfirmText !== templateToDelete.name) return;

    try {
      await deleteMappingTemplate(templateToDelete.id);
      setMappingTemplates(prev => prev.filter(t => t.id !== templateToDelete.id));
      setShowDeleteTemplateModal(false);
      setTemplateToDelete(null);
      setDeleteConfirmText('');
    } catch (err) {
      setError('Erro ao excluir modelo');
      console.error(err);
    }
  };

  // Abrir modal de edição
  const openEditModal = (template: MappingTemplate) => {
    setTemplateToEdit(template);
    setEditTemplateName(template.name);
    setEditTemplateLogo(template.logo || '');
    setShowEditTemplateModal(true);
  };

  // Confirmar edição do template
  const confirmEditTemplate = async () => {
    if (!templateToEdit?.id || !editTemplateName.trim()) return;

    try {
      await updateMappingTemplate(templateToEdit.id, editTemplateName.trim(), templateToEdit.mapping);
      // Atualizar também a logo no Firebase (precisamos de uma função separada ou atualizar a existente)
      await updateDoc(doc(db, 'mapping_templates', templateToEdit.id), {
        name: editTemplateName.trim(),
        logo: editTemplateLogo || null,
        updatedAt: Timestamp.now(),
      });
      // Atualizar lista local
      setMappingTemplates(prev => prev.map(t =>
        t.id === templateToEdit.id
          ? { ...t, name: editTemplateName.trim(), logo: editTemplateLogo || undefined }
          : t
      ).sort((a, b) => a.name.localeCompare(b.name)));
      setShowEditTemplateModal(false);
      setTemplateToEdit(null);
    } catch (err) {
      setError('Erro ao editar modelo');
      console.error(err);
    }
  };

  // Ações do modal de incompatibilidade
  const handleIncompatibleCreateNew = () => {
    setShowIncompatibleModal(false);
    setShowColumnMappingModal(true);
  };

  const handleIncompatibleCancel = () => {
    setShowIncompatibleModal(false);
    setCsvData([]);
    setCsvColumns([]);
    setFileName(null);
    setSelectedTemplate(null);
  };

  // Ref para input de arquivo com template
  const templateFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingTemplate, setPendingTemplate] = useState<MappingTemplate | null>(null);

  // Quando seleciona arquivo via input de template
  const handleTemplateFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingTemplate) {
      handleFileWithTemplate(file, pendingTemplate);
      setPendingTemplate(null);
    }
    // Limpar input
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = '';
    }
  };

  // Iniciar importação com template
  const startImportWithTemplate = (template: MappingTemplate) => {
    setPendingTemplate(template);
    templateFileInputRef.current?.click();
  };

  const toggleSelectAll = () => {
    // IDs das vendas filtradas atualmente
    const filteredIds = new Set(filteredSales.map(s => s.transaction));
    // Verificar se todas as filtradas estão selecionadas
    const allFilteredSelected = filteredSales.length > 0 && filteredSales.every(s => s.selected);
    // Marcar/desmarcar apenas as filtradas
    setPhysicalSales(physicalSales.map(s =>
      filteredIds.has(s.transaction) ? { ...s, selected: !allFilteredSelected } : s
    ));
  };

  const toggleSelect = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, selected: !s.selected } : s
    ));
  };

  // Atualizar quantidade de envios planejados para um pedido
  const updateEnviosTotal = (transaction: string, newTotal: number) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, enviosTotal: newTotal } : s
    ));
  };

  // Incrementar enviosTotal para pedidos parciais (permitir mais envios)
  const incrementEnviosTotal = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, enviosTotal: s.enviosTotal + 1 } : s
    ));
  };

  // Verificar e iniciar merge de pedidos selecionados
  const handleMergePedidos = () => {
    // Pegar todos os pedidos selecionados que NÃO são já mesclados
    const selectedItems = physicalSales.filter(s =>
      s.selected && !s.mergedInto && !s.isMerged
    );

    // Verificar se há itens já mesclados selecionados
    const selectedMerged = physicalSales.filter(s => s.selected && s.isMerged);
    if (selectedMerged.length > 0) {
      alert('Não é possível mesclar pedidos que já foram mesclados.\n\nDesfaça a mesclagem primeiro se quiser reorganizar os pedidos.');
      return;
    }

    if (selectedItems.length < 2) return;

    // Validar: mesmo email, nome E endereço para poder mesclar
    const normalizeStr = (s: string) => s.toLowerCase().trim();
    const normalizeAddress = (sale: PhysicalSale) =>
      `${normalizeStr(sale.address)}|${normalizeStr(sale.number || '')}|${normalizeStr(sale.zip || '')}`;

    const emails = [...new Set(selectedItems.map(s => normalizeStr(s.email)))];
    const names = [...new Set(selectedItems.map(s => normalizeStr(s.name)))];
    const addresses = [...new Set(selectedItems.map(s => normalizeAddress(s)))];

    // Verificar todas as condições
    const sameEmail = emails.length === 1;
    const sameName = names.length === 1;
    const sameAddress = addresses.length === 1;

    if (!sameEmail || !sameName || !sameAddress) {
      // Dados diferentes - mostrar erro com detalhes
      const errors: string[] = [];
      if (!sameEmail) errors.push('E-mails diferentes');
      if (!sameName) errors.push('Nomes diferentes');
      if (!sameAddress) errors.push('Endereços diferentes');

      alert(`Não é possível mesclar estes pedidos:\n\n${errors.join('\n')}\n\nPara mesclar, os pedidos devem ter o mesmo e-mail, nome e endereço.`);
      return;
    }

    // Verificar se há mistura de status (gerado + pendente)
    const hasGenerated = selectedItems.some(s => s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial');
    const hasPending = selectedItems.some(s => s.etiquetaStatus === 'pending');

    if (hasGenerated && hasPending) {
      // Status misto - perguntar ao usuário o que fazer
      setPendingMerge(selectedItems);
      setShowMergeStatusModal(true);
      return;
    }

    // Status uniforme - pode mesclar direto
    executeMerge(selectedItems, hasGenerated ? 'use_existing' : 'generate_new');
  };

  // Executar o merge de pedidos
  const executeMerge = async (pedidosToMerge: PhysicalSale[], statusChoice: 'use_existing' | 'generate_new' = 'generate_new') => {
    if (pedidosToMerge.length < 2) return;

    // Usar o primeiro pedido como base para dados do destinatário
    const baseSale = pedidosToMerge[0];

    // Função helper para pegar o primeiro valor não-vazio de uma lista
    const getFirstNonEmpty = (values: (string | undefined)[]): string => {
      return values.find(v => v && v.trim() !== '') || '';
    };

    // Combinar dados: pegar o melhor (primeiro não-vazio) de cada campo
    const combinedPhone = getFirstNonEmpty(pedidosToMerge.map(s => s.phone));
    const combinedDocument = getFirstNonEmpty(pedidosToMerge.map(s => s.document));
    const combinedComplement = getFirstNonEmpty(pedidosToMerge.map(s => s.complement));

    // Usar a data mais recente entre os pedidos mesclados
    const mostRecentDate = pedidosToMerge.reduce((latest, sale) => {
      const saleTime = parseDate(sale.saleDate);
      const latestTime = parseDate(latest);
      return saleTime > latestTime ? sale.saleDate : latest;
    }, pedidosToMerge[0].saleDate);

    // Extrair dados originais completos para restauração futura (incluindo status de etiqueta)
    const originalSalesData: OriginalSaleData[] = pedidosToMerge.map(s => ({
      transaction: s.transaction,
      productName: s.productName,
      productCode: s.productCode,
      totalPrice: s.totalPrice,
      document: s.document,
      saleDate: s.saleDate,
      // Campos adicionais para restauração completa
      phone: s.phone,
      country: s.country,
      servicoEct: s.servicoEct,
      // Campos de etiqueta para restauração do status original
      etiquetaStatus: s.etiquetaStatus,
      etiqueta: s.etiqueta,
      etiquetas: s.etiquetas,
      enviosTotal: s.enviosTotal,
      enviosRealizados: s.enviosRealizados,
    }));

    // Combinar informações
    const allTransactions = pedidosToMerge.map(s => s.transaction);
    const allProducts = pedidosToMerge.map(s => s.productName);
    const allProductCodes = pedidosToMerge.map(s => s.productCode);

    // Salvar merge no Firebase para auto-merge futuro (retorna o ID consistente)
    const mergedId = await saveMergeToFirebase(originalSalesData);
    if (!mergedId) {
      console.error('Erro ao salvar merge no Firebase');
      return;
    }

    // Determinar status e etiqueta do merge baseado na escolha do usuário
    let mergedStatus: 'pending' | 'generated' | 'partial' = 'pending';
    let mergedEtiqueta: string | undefined;
    let mergedEtiquetas: string[] | undefined;
    let mergedEnviosRealizados = 0;

    if (statusChoice === 'use_existing') {
      // Usar etiqueta existente: pegar do primeiro item gerado
      const generatedItem = pedidosToMerge.find(s => s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial');
      if (generatedItem) {
        mergedStatus = generatedItem.etiquetaStatus as 'generated' | 'partial';
        mergedEtiqueta = generatedItem.etiqueta;
        mergedEtiquetas = generatedItem.etiquetas;
        mergedEnviosRealizados = generatedItem.enviosRealizados;
      }
    }
    // Se 'generate_new', mantém status 'pending' (valores padrão)

    // Criar novo pedido mesclado com dados combinados (melhor info de cada campo)
    const mergedSale: PhysicalSale = {
      ...baseSale,
      transaction: mergedId,
      productName: allProducts.join('\n'), // Produtos separados por quebra de linha
      productCode: allProductCodes.join(','),
      // Usar dados combinados (primeiro não-vazio encontrado)
      phone: combinedPhone,
      document: combinedDocument,
      complement: combinedComplement,
      // Usar a data mais recente para ordenação correta
      saleDate: mostRecentDate,
      selected: false,
      isMerged: true,
      mergedTransactions: allTransactions,
      mergedProductNames: allProducts,
      mergedOriginalSales: originalSalesData,
      enviosTotal: 1,
      enviosRealizados: mergedEnviosRealizados,
      etiquetaStatus: mergedStatus,
      etiqueta: mergedEtiqueta,
      etiquetas: mergedEtiquetas,
    };

    // Atualizar lista: remover originais e adicionar o mesclado
    setPhysicalSales(prev => {
      // Filtrar os originais (removê-los da lista)
      const withoutOriginals = prev.filter(s => !allTransactions.includes(s.transaction));
      const newList = [...withoutOriginals, mergedSale];
      // Ordenar por data (mais recente primeiro)
      return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
    });

    // Limpar estados do modal
    setShowMergeWarningModal(false);
    setShowMergeStatusModal(false);
    setPendingMerge([]);
  };

  // Confirmar merge mesmo com emails diferentes
  const confirmMerge = () => {
    executeMerge(pendingMerge);
  };

  // Cancelar merge
  const cancelMerge = () => {
    setShowMergeWarningModal(false);
    setPendingMerge([]);
  };

  // Desfazer merge de um pedido
  const unmergePedido = async (mergedId: string) => {
    // Encontrar o pedido mesclado
    const mergedSale = physicalSales.find(s => s.transaction === mergedId);
    if (!mergedSale) return;

    // Remover do Firebase usando o mergeId
    await removeMergeFromFirebase(mergedId);

    setPhysicalSales(prev => {
      const merged = prev.find(s => s.transaction === mergedId);
      if (!merged) {
        return prev.filter(s => s.transaction !== mergedId);
      }

      // Usar dados originais completos se disponíveis
      if (merged.mergedOriginalSales && merged.mergedOriginalSales.length > 0) {
        const originalSales: PhysicalSale[] = merged.mergedOriginalSales.map(original => ({
          ...merged,
          transaction: original.transaction,
          productName: original.productName,
          productCode: original.productCode,
          totalPrice: original.totalPrice,
          document: original.document,
          saleDate: original.saleDate,
          // Campos adicionais restaurados
          phone: original.phone || merged.phone,
          country: original.country || merged.country,
          servicoEct: original.servicoEct || merged.servicoEct,
          // Restaurar status original de etiqueta (se disponível)
          etiquetaStatus: original.etiquetaStatus || 'pending',
          etiqueta: original.etiqueta,
          etiquetas: original.etiquetas,
          enviosTotal: original.enviosTotal ?? 1,
          enviosRealizados: original.enviosRealizados ?? 0,
          // Limpar campos de merge
          isMerged: false,
          mergedTransactions: undefined,
          mergedProductNames: undefined,
          mergedOriginalSales: undefined,
          selected: false,
        }));
        const newList = [...prev.filter(s => s.transaction !== mergedId), ...originalSales];
        // Ordenar por data (mais recente primeiro)
        return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
      }

      // Fallback: usar dados parciais se não tiver originalSales
      if (merged.mergedTransactions && merged.mergedProductNames) {
        const originalSales: PhysicalSale[] = merged.mergedTransactions.map((transId, index) => ({
          ...merged,
          transaction: transId,
          productName: merged.mergedProductNames?.[index] || merged.productName,
          productCode: merged.productCode.split(',')[index] || merged.productCode,
          // Fallback: status pendente quando não tem dados originais
          etiquetaStatus: 'pending' as const,
          etiqueta: undefined,
          etiquetas: undefined,
          enviosTotal: 1,
          enviosRealizados: 0,
          isMerged: false,
          mergedTransactions: undefined,
          mergedProductNames: undefined,
          mergedOriginalSales: undefined,
          selected: false,
        }));
        const newList = [...prev.filter(s => s.transaction !== mergedId), ...originalSales];
        // Ordenar por data (mais recente primeiro)
        return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
      }

      return prev.filter(s => s.transaction !== mergedId);
    });
  };

  // Obter nome do serviço pelo código
  const getServicoName = (code: string) => {
    return SERVICOS_ECT.find(s => s.code === code)?.name || code;
  };

  // Conta selecionados que podem receber novas etiquetas (pendentes ou parciais com envios faltando)
  const selectedCount = physicalSales.filter(s =>
    s.selected && !s.mergedInto && (
      s.etiquetaStatus === 'pending' ||
      (s.etiquetaStatus === 'partial' && s.enviosRealizados < s.enviosTotal)
    )
  ).length;
  const alreadyGeneratedCount = physicalSales.filter(s => s.etiquetaStatus === 'generated' && !s.mergedInto).length;
  const selectedGeneratedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && !s.mergedInto).length;
  const partialCount = physicalSales.filter(s => s.etiquetaStatus === 'partial' && !s.mergedInto).length;
  // Conta selecionados que podem ser mesclados (pendentes, gerados ou parciais - não já mesclados)
  const selectedForMerge = physicalSales.filter(s =>
    s.selected &&
    !s.mergedInto &&
    !s.isMerged &&
    (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial')
  ).length;

  // Exportar CSV para importação de rastreio na Hotmart
  const handleExportTrackingCSV = () => {
    const selectedSales = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (selectedSales.length === 0) return;

    // Header do CSV conforme modelo Hotmart
    const header = 'Código da compra,Data da compra,Produto,Responsável pela entrega,Código de rastreio,Status de envio,Link de rastreio';

    // Gerar linhas - para pedidos mesclados, gera uma linha para cada transação original
    const rows: string[] = [];

    selectedSales.forEach(sale => {
      const codigoRastreio = sale.etiqueta || '';
      const statusEnvio = 'Enviado';
      const linkRastreio = 'https://rastreamento.correios.com.br';
      const responsavel = 'Envio Próprio';
      const dataCompra = sale.saleDate.split(' ')[0];

      if (sale.isMerged && sale.mergedTransactions && sale.mergedTransactions.length > 0) {
        // Pedido mesclado: gera uma linha para cada transação original
        // Buscar os dados originais de cada transação
        sale.mergedTransactions.forEach((transactionId, idx) => {
          // Buscar o pedido original para pegar data e produto corretos
          const originalSale = physicalSales.find(s => s.transaction === transactionId);
          const produtoNome = sale.mergedProductNames?.[idx] || sale.productName;
          const produto = `"${produtoNome.replace(/"/g, '""')}"`;
          const data = originalSale?.saleDate.split(' ')[0] || dataCompra;

          rows.push(`${transactionId},${data},${produto},${responsavel},${codigoRastreio},${statusEnvio},${linkRastreio}`);
        });
      } else {
        // Pedido normal: gera uma linha
        const produto = `"${sale.productName.replace(/"/g, '""')}"`;
        rows.push(`${sale.transaction},${dataCompra},${produto},${responsavel},${codigoRastreio},${statusEnvio},${linkRastreio}`);
      }
    });

    const csvContent = [header, ...rows].join('\n');

    // Download do arquivo
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rastreio_hotmart_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintLabels = async () => {
    const selectedSales = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);
    const selectedLabels = selectedSales.map(s => s.etiqueta as string);

    if (selectedLabels.length === 0) return;

    // 1. WEBHOOK - Notificar admin (somente se N8N ativado)
    // etiquetas: [] = nenhuma nova, cliente NÃO recebe
    // etiquetasAdmin: todas selecionadas, admin recebe
    if (sendToN8n) {
      try {
        const etiquetasParaWebhook = selectedSales.map(sale => ({
          codigo: sale.etiqueta || '',
          transactionId: sale.transaction,
          produto: sale.productName,
          dataPedido: sale.saleDate, // Data do pedido
          destinatario: {
            nome: sale.name,
            telefone: sale.phone,
            email: sale.email,
            logradouro: sale.address,
            numero: sale.number || 'S/N',
            complemento: sale.complement || '',
            bairro: sale.neighborhood,
            cidade: sale.city,
            uf: sale.state,
            cep: sale.zip?.replace(/\D/g, '') || '',
          },
          // Info de envio parcial
          envioNumero: sale.enviosRealizados || 1,
          enviosTotal: sale.enviosTotal || 1,
          isEnvioParcial: (sale.enviosTotal || 1) > 1,
          observacaoEnvio: '',
          // Info de merge
          ...(sale.isMerged && {
            isMerged: true,
            mergedTransactionIds: sale.mergedTransactions || [],
            produtos: sale.mergedProductNames || [],
          }),
        }));

        const webhookPayload = {
          etiquetas: [], // VAZIO = cliente NÃO recebe (já foram geradas antes)
          etiquetasAdmin: etiquetasParaWebhook, // Admin recebe
          config: {
            adminPhone: adminPhone,
            clientPhoneOverride: clientPhoneOverride || undefined,
            sendClientNotification: false, // Já geradas não notificam cliente
          },
        };

        console.log('========== WEBHOOK IMPRIMIR ==========');
        console.log('- N8N ativado: true');
        console.log('- Etiquetas já geradas (admin recebe):', etiquetasParaWebhook.length);
        console.log('- Cliente NÃO recebe (etiquetas já foram geradas antes)');
        // Debug: mostrar UF de cada etiqueta
        etiquetasParaWebhook.forEach((e, i) => {
          console.log(`[DEBUG] Item ${i}: state="${selectedSales[i]?.state}", uf="${e.destinatario.uf}", cidade="${e.destinatario.cidade}"`);
        });
        console.log('======================================');

        await fetch('/api/webhook/etiquetas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });
      } catch (webhookErr) {
        console.error('Erro ao disparar webhook:', webhookErr);
      }
    }

    // 2. IMPRIMIR - Baixar PDF localmente (sempre funciona)
    try {
      const response = await fetch('/api/vipp/imprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: selectedLabels }),
      });

      if (response.headers.get('content-type')?.includes('application/pdf')) {
        // Download direto do PDF
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `etiquetas-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const result = await response.json();
        if (result.downloadUrl) {
          // Abrir URL direta em nova aba
          window.open(result.downloadUrl, '_blank');
        } else if (result.error) {
          alert(`Erro ao imprimir: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Erro ao imprimir etiquetas:', err);
      alert('Erro ao baixar PDF das etiquetas');
    }
  };

  // Função que realmente executa a geração (chamada após confirmação)
  const executeGeneration = async (
    toGenerate: PhysicalSale[],
    observacoes: Record<string, string> = {},
    ordem: 'antigos' | 'novos' = 'antigos',
    obsGeral: string = ''
  ) => {
    // Etiquetas já geradas que estão selecionadas (para incluir no PDF)
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Etiquetas recém-geradas (para webhook do cliente)
    const etiquetasNovas: Array<{
      codigo: string;
      transactionId: string;
      produto: string;
      dataPedido?: string;
      destinatario: { nome: string; telefone: string; email: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
      envioNumero?: number;
      enviosTotal?: number;
      isEnvioParcial?: boolean;
      observacaoEnvio?: string;
      isMerged?: boolean;
      mergedTransactionIds?: string[];
      produtos?: string[];
    }> = [];

    // Todas as etiquetas para o PDF (novas + já geradas selecionadas)
    const todasEtiquetasParaPdf: string[] = alreadyGenerated.map(s => s.etiqueta as string);

    // Etiquetas já geradas (para webhook do admin, sem enviar para cliente)
    const etiquetasJaGeradas = alreadyGenerated.map(sale => ({
      codigo: sale.etiqueta || '',
      transactionId: sale.transaction,
      produto: sale.productName,
      dataPedido: sale.saleDate, // Data do pedido
      destinatario: {
        nome: sale.name,
        telefone: sale.phone,
        email: sale.email,
        logradouro: sale.address,
        numero: sale.number || 'S/N',
        complemento: sale.complement || '',
        bairro: sale.neighborhood,
        cidade: sale.city,
        uf: sale.state,
        cep: sale.zip?.replace(/\D/g, '') || '',
      },
      // Info de envio parcial
      envioNumero: sale.enviosRealizados || 1,
      enviosTotal: sale.enviosTotal || 1,
      isEnvioParcial: (sale.enviosTotal || 1) > 1,
      // Observação do pedido (já geradas usam observação salva ou vazio)
      observacaoEnvio: observacoes[sale.transaction] || '',
      // Info de merge
      ...(sale.isMerged && {
        isMerged: true,
        mergedTransactionIds: sale.mergedTransactions || [],
        produtos: sale.mergedProductNames || [],
      }),
    }));

    if (toGenerate.length > 0) {
      setIsGenerating(true);
      setGenerationProgress({ current: 0, total: toGenerate.length, success: 0, errors: 0 });

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < toGenerate.length; i++) {
        const sale = toGenerate[i];

        setGenerationProgress(prev => ({ ...prev, current: i + 1 }));

        try {
          // Chamar API do ViPP
          const response = await fetch('/api/vipp/postar-objeto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionId: sale.transaction,
              servicoEct: selectedServicoEct, // Código do serviço ECT selecionado globalmente
              useTestCredentials, // Flag para usar credenciais de teste
              destinatario: {
                nome: sale.name,
                documento: sale.document,
                logradouro: sale.address,
                numero: sale.number || 'S/N',
                complemento: sale.complement,
                bairro: sale.neighborhood,
                cidade: sale.city,
                uf: sale.state,
                cep: sale.zip.replace(/\D/g, ''),
                telefone: sale.phone,
                email: sale.email,
              },
            }),
          });

          const result = await response.json();

          if (result.success && result.etiqueta) {
            // Calcular número do envio (próximo após os realizados)
            const envioNumero = sale.enviosRealizados + 1;
            const novoEnviosRealizados = envioNumero;
            // Determinar novo status: completo se realizados == total, parcial se ainda faltam
            const novoStatus = novoEnviosRealizados >= sale.enviosTotal ? 'generated' : 'partial';

            // Salvar no Firebase com info de envios (incluindo dados de merge se existirem)
            await saveLabel(
              sale.transaction,
              result.etiqueta,
              sale.name,
              envioNumero,
              sale.enviosTotal,
              sale.mergedTransactions, // transactionIds originais se for mesclado
              sale.mergedProductNames, // nomes dos produtos se for mesclado
              observacoes[sale.transaction] // observação do envio parcial
            );

            // Guardar para o webhook (cliente vai receber)
            etiquetasNovas.push({
              codigo: result.etiqueta,
              transactionId: sale.transaction,
              produto: sale.productName,
              dataPedido: sale.saleDate, // Data do pedido
              destinatario: {
                nome: sale.name,
                telefone: sale.phone,
                email: sale.email,
                logradouro: sale.address,
                numero: sale.number || 'S/N',
                complemento: sale.complement || '',
                bairro: sale.neighborhood,
                cidade: sale.city,
                uf: sale.state,
                cep: sale.zip?.replace(/\D/g, '') || '',
              },
              // Info de envio parcial
              envioNumero: novoEnviosRealizados,
              enviosTotal: sale.enviosTotal,
              isEnvioParcial: sale.enviosTotal > 1,
              // Observação do pedido (sempre envia, mesmo vazio)
              observacaoEnvio: observacoes[sale.transaction] || '',
              // Adicionar info de merge para o webhook
              ...(sale.isMerged && {
                isMerged: true,
                mergedTransactionIds: sale.mergedTransactions,
                produtos: sale.mergedProductNames,
              }),
            });

            // Adicionar ao PDF
            todasEtiquetasParaPdf.push(result.etiqueta);

            // Atualizar estado local com novo enviosRealizados e status
            setPhysicalSales(prev => prev.map(s =>
              s.transaction === sale.transaction
                ? {
                    ...s,
                    etiqueta: result.etiqueta,
                    etiquetas: [...(s.etiquetas || []), result.etiqueta],
                    etiquetaStatus: novoStatus as 'generated' | 'partial',
                    enviosRealizados: novoEnviosRealizados,
                    selected: false,
                  }
                : s
            ));

            successCount++;
          } else {
            throw new Error(result.error || 'Erro desconhecido');
          }
        } catch (err) {
          console.error(`Erro ao gerar etiqueta para ${sale.transaction}:`, err);

          setPhysicalSales(prev => prev.map(s =>
            s.transaction === sale.transaction
              ? { ...s, etiquetaStatus: 'error' }
              : s
          ));

          errorCount++;
        }

        setGenerationProgress(prev => ({ ...prev, success: successCount, errors: errorCount }));

        // Delay entre requisições para não sobrecarregar a API
        if (i < toGenerate.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      setIsGenerating(false);
    }

    // Desmarcar as já geradas que foram incluídas
    setPhysicalSales(prev => prev.map(s =>
      s.etiquetaStatus === 'generated' ? { ...s, selected: false } : s
    ));

    // 1. WEBHOOK - Disparar somente se N8N estiver ativado
    // Admin recebe TODAS, Cliente recebe apenas as NOVAS
    const todasParaAdmin = [...etiquetasNovas, ...etiquetasJaGeradas];

    if (sendToN8n && todasParaAdmin.length > 0) {
      try {
        // Cliente real só recebe se: VIPP teste OFF + notificação ON + cliente teste VAZIO
        const enviarParaClienteReal = !useTestCredentials && sendClientNotification && !clientPhoneOverride;

        const webhookPayload = {
          etiquetas: etiquetasNovas, // Cliente recebe só as novas
          etiquetasAdmin: todasParaAdmin, // Admin recebe todas
          config: {
            adminPhone: adminPhone,
            clientPhoneOverride: clientPhoneOverride || undefined,
            // Só envia para cliente real se todas as condições forem atendidas
            sendClientNotification: enviarParaClienteReal || (sendClientNotification && !!clientPhoneOverride),
            // Opções de envio
            ordemPrioridade: ordem,
            observacaoGeral: obsGeral || undefined,
            // Flag de teste para URL do PDF
            useTestCredentials: useTestCredentials,
          },
        };

        console.log('========== WEBHOOK ETIQUETAS ==========');
        console.log('Enviando para /api/webhook/etiquetas:');
        console.log('- N8N ativado:', sendToN8n);
        console.log('- VIPP teste:', useTestCredentials);
        console.log('- Notificação cliente:', sendClientNotification);
        console.log('- Cliente teste:', clientPhoneOverride || '(vazio - cliente real)');
        console.log('- Enviar para cliente real:', enviarParaClienteReal);
        console.log('- Etiquetas novas (cliente vai receber):', etiquetasNovas.length);
        console.log('- Etiquetas total (admin vai receber):', todasParaAdmin.length);
        console.log(JSON.stringify(webhookPayload, null, 2));
        console.log('=======================================');

        const webhookResponse = await fetch('/api/webhook/etiquetas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });

        const webhookResult = await webhookResponse.json();
        console.log('Resposta do webhook:', webhookResult);
      } catch (webhookErr) {
        console.error('Erro ao disparar webhook N8N:', webhookErr);
      }
    } else if (!sendToN8n) {
      console.log('========== WEBHOOK DESATIVADO ==========');
      console.log('N8N está desativado, webhook não será disparado');
      console.log('========================================');
    }

    // 2. IMPRIMIR - Baixar PDF local após webhook
    if (todasEtiquetasParaPdf.length > 0) {
      try {
        const response = await fetch('/api/vipp/imprimir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etiquetas: todasEtiquetasParaPdf }),
        });

        if (response.headers.get('content-type')?.includes('application/pdf')) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `etiquetas-${Date.now()}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          const result = await response.json();
          if (result.downloadUrl) {
            window.open(result.downloadUrl, '_blank');
          }
        }
      } catch (err) {
        console.error('Erro ao baixar PDF:', err);
        alert(`Etiquetas geradas: ${todasEtiquetasParaPdf.join(', ')}\n\nUse o botão "Imprimir" para baixar o PDF.`);
      }
    }
  };

  // Função chamada pelo botão - mostra confirmação se necessário
  const handleGenerateLabels = () => {
    // Pode gerar se: pendente OU parcial com envios ainda pendentes
    const toGenerate = physicalSales.filter(s =>
      s.selected && (
        s.etiquetaStatus === 'pending' ||
        (s.etiquetaStatus === 'partial' && s.enviosRealizados < s.enviosTotal)
      )
    );
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Se só tem etiquetas já geradas, executa direto (só vai reimprimir)
    if (toGenerate.length === 0) {
      executeGeneration([], envioObservacoes, ordemPrioridade, observacaoGeral);
      return;
    }

    // Mostra modal de confirmação para novas etiquetas
    setPendingGeneration(toGenerate);
    setShowServiceConfirmModal(true);
  };

  // Confirmar geração após modal
  const confirmGeneration = () => {
    setShowServiceConfirmModal(false);

    // Se precisa confirmar produção OU confirmar envio ao cliente, mostra modal
    if (needsProductionConfirm || needsClientConfirm) {
      setConfirmEtiquetasText('');
      setConfirmEnviarText('');
      setShowGenerationConfirmModal(true);
      // pendingGeneration já está setado, será usado quando confirmar
    } else {
      executeGeneration(pendingGeneration, envioObservacoes, ordemPrioridade, observacaoGeral);
      setPendingGeneration([]);
      setEnvioObservacoes({});
      setOrdemPrioridade('antigos');
      setObservacaoGeral('');
    }
  };

  // Verificar se confirmação é válida
  const isConfirmationValid = () => {
    const etiquetasOk = !needsProductionConfirm || confirmEtiquetasText.toLowerCase() === 'etiquetas';
    const enviarOk = !needsClientConfirm || confirmEnviarText.toLowerCase() === 'enviar';
    return etiquetasOk && enviarOk;
  };

  // Executar após confirmação do modal unificado
  const handleConfirmGeneration = () => {
    if (isConfirmationValid()) {
      setShowGenerationConfirmModal(false);
      setConfirmEtiquetasText('');
      setConfirmEnviarText('');
      executeGeneration(pendingGeneration, envioObservacoes, ordemPrioridade, observacaoGeral);
      setPendingGeneration([]);
      setEnvioObservacoes({});
      setOrdemPrioridade('antigos');
      setObservacaoGeral('');
    }
  };

  const resetUpload = () => {
    setPhysicalSales([]);
    setFileName(null);
    setTotalRows(0);
    setError(null);
    setGenerationProgress({ current: 0, total: 0, success: 0, errors: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Estado inicial - Upload (mas não se o modal de mapeamento estiver aberto)
  if (physicalSales.length === 0 && !showColumnMappingModal) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-6">
          <h2
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 600,
              fontSize: '1.25rem',
              color: '#314158',
              marginBottom: '0.5rem',
            }}
          >
            Gerar Etiquetas de Envio
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Importe seu CSV de vendas para gerar etiquetas dos produtos físicos
          </p>
        </div>

        {/* Upload Area */}
        <div
          className={`rounded-2xl border-2 border-dashed p-8 transition-all cursor-pointer ${
            isDragging
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-4">
            {/* Ícone CSV genérico */}
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 13H16" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 17H16" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#64748B' }}>
                  Processando CSV...
                </p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 600,
                      fontSize: '1rem',
                      color: '#314158',
                    }}
                  >
                    Arraste seu arquivo CSV aqui
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#64748B',
                      marginTop: '0.25rem',
                    }}
                  >
                    ou clique para selecionar
                  </p>
                </div>

                <button
                  className="px-4 py-2 rounded-lg text-white transition"
                  style={{
                    backgroundColor: '#3B82F6',
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                  }}
                >
                  Selecionar Arquivo
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#DC2626' }}>
              {error}
            </p>
          </div>
        )}

        {/* Templates Salvos */}
        {!isLoadingTemplates && mappingTemplates.length > 0 && (
          <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200">
            <h3
              style={{
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#314158',
                marginBottom: '0.75rem',
              }}
            >
              📋 Importar com Modelo Salvo
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#64748B',
                marginBottom: '0.75rem',
              }}
            >
              Clique em um modelo para importar o CSV usando o mapeamento salvo
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {mappingTemplates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  {/* Botão do Modelo */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startImportWithTemplate(template);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 1rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      color: '#1E40AF',
                      backgroundColor: '#DBEAFE',
                      border: '1px solid #93C5FD',
                      borderRadius: '0.5rem 0.5rem 0 0',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = '#BFDBFE';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = '#DBEAFE';
                    }}
                  >
                    {template.logo && (
                      <Image
                        src={`/lojas/${template.logo}`}
                        alt={template.name}
                        width={20}
                        height={20}
                        className="rounded-sm object-cover"
                      />
                    )}
                    {template.name}
                  </button>
                  {/* Botão Editar */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(template);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.25rem',
                      padding: '0.25rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.65rem',
                      color: '#64748B',
                      backgroundColor: '#F1F5F9',
                      border: '1px solid #E2E8F0',
                      borderTop: 'none',
                      borderRadius: '0 0 0.5rem 0.5rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = '#E2E8F0';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = '#F1F5F9';
                    }}
                    title="Editar modelo"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Editar
                  </button>
                </div>
              ))}
            </div>
            {/* Input oculto para seleção de arquivo com template */}
            <input
              ref={templateFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleTemplateFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Loading Templates */}
        {isLoadingTemplates && (
          <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: '#64748B' }}>
                Carregando modelos salvos...
              </span>
            </div>
          </div>
        )}

        {/* Modal de Confirmação de Exclusão */}
        {showDeleteTemplateModal && templateToDelete && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
            }}
            onClick={() => {
              setShowDeleteTemplateModal(false);
              setTemplateToDelete(null);
              setDeleteConfirmText('');
            }}
          >
            <div
              style={{
                backgroundColor: '#FFF',
                borderRadius: '1rem',
                padding: '1.5rem',
                maxWidth: '400px',
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#DC2626',
                }}
              >
                Excluir Modelo
              </h3>
              <p
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                Esta ação não pode ser desfeita. Para confirmar, digite o nome do modelo:
              </p>
              <p
                style={{
                  margin: '0 0 0.75rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#314158',
                  backgroundColor: '#F1F5F9',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.375rem',
                }}
              >
                {templateToDelete.name}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Digite o nome do modelo..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  backgroundColor: '#FFFFFF',
                  color: '#1F2937',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.375rem',
                  outline: 'none',
                  marginBottom: '1rem',
                }}
              />
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => {
                    setShowDeleteTemplateModal(false);
                    setTemplateToDelete(null);
                    setDeleteConfirmText('');
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#64748B',
                    backgroundColor: '#F1F5F9',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDeleteTemplate}
                  disabled={deleteConfirmText !== templateToDelete.name}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#FFF',
                    backgroundColor: deleteConfirmText !== templateToDelete.name ? '#9CA3AF' : '#DC2626',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: deleteConfirmText !== templateToDelete.name ? 'not-allowed' : 'pointer',
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Edição de Template */}
        {showEditTemplateModal && templateToEdit && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
            }}
            onClick={() => {
              setShowEditTemplateModal(false);
              setTemplateToEdit(null);
            }}
          >
            <div
              style={{
                backgroundColor: '#FFF',
                borderRadius: '1rem',
                padding: '1.5rem',
                maxWidth: '450px',
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#314158',
                }}
              >
                Editar Modelo
              </h3>

              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#314158',
                    marginBottom: '0.375rem',
                  }}
                >
                  Nome do Modelo:
                </label>
                <input
                  type="text"
                  value={editTemplateName}
                  onChange={(e) => setEditTemplateName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                    color: '#1F2937',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.375rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#314158',
                    marginBottom: '0.375rem',
                  }}
                >
                  Logo (opcional):
                </label>
                <select
                  value={editTemplateLogo}
                  onChange={(e) => setEditTemplateLogo(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                    color: '#1F2937',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.375rem',
                    outline: 'none',
                  }}
                >
                  <option value="">Sem logo</option>
                  {AVAILABLE_LOGOS.map((logo) => (
                    <option key={logo.name} value={logo.name}>
                      {logo.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botão Excluir */}
              <button
                onClick={() => {
                  setShowEditTemplateModal(false);
                  if (templateToEdit) openDeleteModal(templateToEdit);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: '0.5rem',
                  marginBottom: '1rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  color: '#DC2626',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#FEE2E2';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#FEF2F2';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Excluir modelo
              </button>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => {
                    setShowEditTemplateModal(false);
                    setTemplateToEdit(null);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#64748B',
                    backgroundColor: '#F1F5F9',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmEditTemplate}
                  disabled={!editTemplateName.trim()}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#FFF',
                    backgroundColor: !editTemplateName.trim() ? '#9CA3AF' : '#3B82F6',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: !editTemplateName.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de CSV Incompatível */}
        {showIncompatibleModal && selectedTemplate && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
            }}
            onClick={handleIncompatibleCancel}
          >
            <div
              style={{
                backgroundColor: '#FFF',
                borderRadius: '1rem',
                padding: '1.5rem',
                maxWidth: '450px',
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#314158',
                }}
              >
                CSV Incompatível
              </h3>
              <p
                style={{
                  margin: '0 0 0.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                O CSV importado não é compatível com o modelo <strong>{selectedTemplate.name}</strong>.
              </p>
              <p
                style={{
                  margin: '0 0 1.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                Algumas colunas esperadas não foram encontradas. Deseja criar um novo mapeamento?
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={handleIncompatibleCancel}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#64748B',
                    backgroundColor: '#F1F5F9',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleIncompatibleCreateNew}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#FFF',
                    backgroundColor: '#3B82F6',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Criar Novo Mapeamento
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Confirmação Salvar e Processar */}
        {showSaveAndProcessModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10001,
            }}
            onClick={cancelSaveAndProcess}
          >
            <div
              style={{
                backgroundColor: '#FFF',
                borderRadius: '1rem',
                padding: '1.5rem',
                maxWidth: '400px',
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#16A34A',
                }}
              >
                Salvar e Processar
              </h3>
              <p
                style={{
                  margin: '0 0 0.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                O modelo <strong>{newTemplateName}</strong> será salvo e o CSV será processado.
              </p>
              <p
                style={{
                  margin: '0 0 1.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                Deseja continuar?
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={cancelSaveAndProcess}
                  disabled={isSavingTemplate}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#64748B',
                    backgroundColor: '#F1F5F9',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: isSavingTemplate ? 'not-allowed' : 'pointer',
                    opacity: isSavingTemplate ? 0.5 : 1,
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmSaveAndProcess}
                  disabled={isSavingTemplate}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#FFF',
                    backgroundColor: isSavingTemplate ? '#9CA3AF' : '#16A34A',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: isSavingTemplate ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSavingTemplate ? 'Salvando...' : 'Salvar e Processar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Estado com vendas carregadas - Tabela
  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header - Novo Upload + Config */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewUploadConfirm(true)}
            disabled={isGenerating}
            className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 transition disabled:opacity-50"
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.75rem',
              color: '#64748B',
            }}
          >
            Novo Upload
          </button>
          <button
            onClick={() => setShowConfigModal(true)}
            className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 transition"
            title="Configurações"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* Indicadores de configuração ativa */}
          {useTestCredentials && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
              TESTE
            </span>
          )}
          {!sendToN8n && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
              N8N OFF
            </span>
          )}
        </div>
        <p
          style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.75rem',
            color: '#64748B',
          }}
        >
          {fileName} • {physicalSales.length} vendas físicas de {totalRows} total
          {alreadyGeneratedCount > 0 && (
            <span className="ml-2 text-green-600">
              ({alreadyGeneratedCount} já gerada{alreadyGeneratedCount !== 1 ? 's' : ''})
            </span>
          )}
        </p>
      </div>

      {/* Filtros à esquerda + Botões à direita */}
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Filtros - Esquerda */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Campo de Busca */}
          <div className="relative">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar..."
              className="pl-8 pr-2 py-1 rounded-md border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              style={{
                fontFamily: 'var(--font-inter)',
                width: '140px',
                color: '#1E293B',
              }}
            />
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>

          {/* Filtro de Status */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-md p-0.5">
            <button
              onClick={() => handleFilterChange('all')}
              disabled={hasSearchText}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                statusFilter === 'all' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Todas ({physicalSales.filter(s => !s.mergedInto).length})
            </button>
            <button
              onClick={() => handleFilterChange('pending')}
              disabled={hasSearchText}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                statusFilter === 'pending' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Pendentes ({physicalSales.filter(s => !s.mergedInto && s.etiquetaStatus === 'pending').length})
            </button>
            <button
              onClick={() => handleFilterChange('partial')}
              disabled={hasSearchText}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                statusFilter === 'partial' && !hasSearchText
                  ? 'bg-white text-yellow-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Parciais ({physicalSales.filter(s => !s.mergedInto && s.etiquetaStatus === 'partial').length})
            </button>
            <button
              onClick={() => handleFilterChange('generated')}
              disabled={hasSearchText}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                statusFilter === 'generated' && !hasSearchText
                  ? 'bg-white text-green-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Completas ({physicalSales.filter(s => !s.mergedInto && s.etiquetaStatus === 'generated').length})
            </button>
            <button
              onClick={() => handleFilterChange('merge')}
              disabled={hasSearchText}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                statusFilter === 'merge' && !hasSearchText
                  ? 'bg-white text-purple-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Mesclar ({mergeFilterCount})
            </button>
            {hasSearchText && (
              <span
                className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700"
                style={{ fontFamily: 'var(--font-inter)' }}
              >
                Busca ({filteredSales.length})
              </span>
            )}
          </div>
        </div>

        {/* Botões de Ação - Direita */}
        <div className="flex items-center gap-2">
          {/* Botões para etiquetas já geradas (quando só tem já geradas selecionadas, sem pendentes) */}
          {selectedGeneratedCount > 0 && selectedCount === 0 && (
            <>
              <button
                onClick={handlePrintLabels}
                disabled={isGenerating}
                className="px-2.5 py-1 rounded-md text-white transition hover:opacity-90 flex items-center gap-1.5 text-xs"
                style={{
                  backgroundColor: '#22C55E',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Imprimir ({selectedGeneratedCount})
              </button>
              <button
                onClick={handleExportTrackingCSV}
                className="px-2.5 py-1 rounded-md text-white transition hover:opacity-90 flex items-center gap-1.5 text-xs"
                style={{
                  backgroundColor: '#3B82F6',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exportar CSV
              </button>
            </>
          )}
          {/* Dropdown de serviço + Botão gerar (quando tem pendentes) */}
          {selectedCount > 0 && (
            <>
              <div className="flex items-center gap-1">
                <label
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.625rem',
                    color: '#64748B',
                    fontWeight: 500,
                  }}
                >
                  Serviço:
                </label>
                <select
                  value={selectedServicoEct}
                  onChange={(e) => setSelectedServicoEct(e.target.value)}
                  disabled={isGenerating}
                  className="px-2 py-1 rounded-md border border-slate-300 text-xs bg-white disabled:opacity-50 text-slate-900"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    color: '#0f172a',
                    fontWeight: 600,
                    WebkitTextFillColor: '#0f172a',
                  }}
                >
                  {SERVICOS_ECT.map(servico => (
                    <option key={servico.code} value={servico.code}>
                      {servico.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Botão Mesclar - aparece quando 2+ itens selecionados (pendentes/gerados) */}
              {selectedForMerge >= 2 && (
                <button
                  onClick={handleMergePedidos}
                  disabled={isGenerating}
                  className="px-2.5 py-1 rounded-md text-white transition hover:opacity-90 flex items-center gap-1.5 text-xs"
                  style={{
                    backgroundColor: '#8B5CF6',
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 500,
                  }}
                  title="Mesclar pedidos selecionados em um único envio"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 6h13" />
                    <path d="M8 12h13" />
                    <path d="M8 18h13" />
                    <path d="M3 6h.01" />
                    <path d="M3 12h.01" />
                    <path d="M3 18h.01" />
                  </svg>
                  Mesclar ({selectedForMerge})
                </button>
              )}
              <button
                onClick={handleGenerateLabels}
                disabled={isGenerating}
                className={`px-2.5 py-1 rounded-md text-white transition text-xs ${
                  isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
                style={{
                  backgroundColor: '#F97316',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                }}
              >
                {isGenerating
                  ? `Gerando ${generationProgress.current}/${generationProgress.total}...`
                  : selectedGeneratedCount > 0
                    ? `Gerar (${selectedCount}) + PDF (${selectedGeneratedCount})`
                    : `Gerar (${selectedCount})`
                }
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isGenerating && (
        <div className="mb-4 p-4 rounded-xl bg-orange-50 border border-orange-200">
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#314158' }}>
              Gerando etiquetas...
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#64748B' }}>
              {generationProgress.success} sucesso, {generationProgress.errors} erros
            </span>
          </div>
          <div className="w-full h-2 bg-orange-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={physicalSales.length > 0 && physicalSales.every(s => s.selected)}
                    onChange={toggleSelectAll}
                    disabled={isGenerating}
                    className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Status
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Mesclado
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Envios
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Cliente
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Produto
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Endereço
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Data
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => (
                <tr
                  key={sale.transaction}
                  className={`border-b transition ${
                    sale.isMerged
                      ? 'border-purple-200 bg-purple-50/70 hover:bg-purple-100/70'
                      : sale.etiquetaStatus === 'generated'
                        ? 'border-slate-100 bg-green-50/50 hover:bg-green-50'
                        : sale.etiquetaStatus === 'partial'
                          ? 'border-slate-100 bg-yellow-50/50 hover:bg-yellow-50'
                          : sale.etiquetaStatus === 'error'
                            ? 'border-slate-100 bg-red-50/50 hover:bg-red-50'
                            : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={sale.selected}
                      onChange={() => toggleSelect(sale.transaction)}
                      disabled={isGenerating}
                      className={`w-4 h-4 rounded disabled:opacity-50 ${
                        sale.isMerged
                          ? 'border-purple-400 text-purple-600 focus:ring-purple-500'
                          : 'border-slate-300 text-orange-500 focus:ring-orange-500'
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {sale.etiquetaStatus === 'generated' ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Completo {sale.enviosRealizados}/{sale.enviosTotal}
                        </span>
                        <span className="text-xs text-green-600 font-mono" title={sale.etiquetas?.join(', ') || sale.etiqueta}>
                          {sale.etiqueta}
                        </span>
                      </div>
                    ) : sale.etiquetaStatus === 'partial' ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                          Parcial {sale.enviosRealizados}/{sale.enviosTotal}
                        </span>
                        <span className="text-xs text-yellow-600 font-mono" title={sale.etiquetas?.join(', ') || sale.etiqueta}>
                          {sale.etiqueta}
                        </span>
                      </div>
                    ) : sale.etiquetaStatus === 'error' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Erro
                      </span>
                    ) : sale.isMerged ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-200 text-purple-700">
                        Pendente
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        Pendente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* Coluna Mesclado */}
                    {sale.isMerged && sale.mergedTransactions ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMergeDetailsSale(sale)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 transition shadow-sm"
                          title="Ver detalhes do merge"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M16 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
                            <path d="M12 12h8a2 2 0 002-2V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v8z" />
                          </svg>
                          {sale.mergedTransactions.length} pedidos
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* Coluna de Envios - dropdown para pendentes, botão +1 para parciais, texto para completos */}
                    {sale.etiquetaStatus === 'pending' ? (
                      <select
                        value={sale.enviosTotal}
                        onChange={(e) => updateEnviosTotal(sale.transaction, parseInt(e.target.value))}
                        disabled={isGenerating}
                        className="px-2 py-1 rounded-md border border-slate-300 text-sm bg-white focus:ring-orange-500 focus:border-orange-500 disabled:opacity-50 text-slate-900"
                        style={{ fontFamily: 'var(--font-inter)', color: '#0f172a', fontWeight: 500 }}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                      </select>
                    ) : sale.etiquetaStatus === 'partial' ? (
                      <button
                        onClick={() => incrementEnviosTotal(sale.transaction)}
                        disabled={isGenerating}
                        className="px-2 py-1 rounded-md text-xs font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition disabled:opacity-50"
                        style={{ fontFamily: 'var(--font-inter)' }}
                        title="Adicionar mais um envio"
                      >
                        +1 envio
                      </button>
                    ) : (
                      <span
                        className="text-xs text-slate-500"
                        style={{ fontFamily: 'var(--font-inter)' }}
                      >
                        {sale.enviosRealizados}/{sale.enviosTotal}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontWeight: 500,
                          fontSize: '0.875rem',
                          color: '#314158',
                        }}
                      >
                        {sale.name}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        {sale.email}
                      </p>
                      {sale.phone && (
                        <a
                          href={`https://wa.me/${sale.phone.replace(/\D/g, '').replace(/^0+/, '').replace(/^(?!55)/, '55')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: 'var(--font-inter)',
                            fontSize: '0.75rem',
                            color: '#25D366',
                            textDecoration: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Abrir WhatsApp"
                        >
                          <span>📱</span> {sale.phone}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {/* Coluna Produto - mostra com quebra de linha se mesclado */}
                    {sale.isMerged && sale.mergedProductNames ? (
                      <div style={{ maxWidth: '200px' }}>
                        {sale.mergedProductNames.map((product, idx) => (
                          <p
                            key={idx}
                            style={{
                              fontFamily: 'var(--font-inter)',
                              fontSize: '0.8125rem',
                              color: '#314158',
                              margin: idx > 0 ? '0.25rem 0 0 0' : 0,
                            }}
                            className="truncate"
                            title={product}
                          >
                            {product}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.8125rem',
                          color: '#314158',
                          maxWidth: '200px',
                        }}
                        className="truncate"
                        title={sale.productName}
                      >
                        {sale.productName}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div style={{ maxWidth: '250px' }}>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.8125rem',
                          color: '#314158',
                        }}
                        className="truncate"
                        title={`${sale.address}, ${sale.number}${sale.complement ? ` - ${sale.complement}` : ''}`}
                      >
                        {sale.address}, {sale.number}
                        {sale.complement && ` - ${sale.complement}`}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        {sale.neighborhood} - {sale.city}/{sale.state}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        CEP: {sale.zip}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8125rem',
                        color: '#314158',
                      }}
                    >
                      {sale.saleDate.split(' ')[0]}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredSales.length === 0 && physicalSales.length > 0 && (
        <div className="mt-8 text-center py-12">
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '1rem',
              color: '#64748B',
            }}
          >
            {statusFilter === 'pending'
              ? 'Nenhuma etiqueta pendente'
              : statusFilter === 'partial'
                ? 'Nenhum envio parcial'
                : statusFilter === 'generated'
                  ? 'Nenhum envio completo ainda'
                  : statusFilter === 'merge'
                    ? 'Nenhum item mesclado ou candidato a mesclar'
                    : 'Nenhuma venda de produto físico encontrada no CSV'
            }
          </p>
        </div>
      )}

      {/* Modal de Confirmação de Serviço */}
      {showServiceConfirmModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => {
            setShowServiceConfirmModal(false);
            setEnvioObservacoes({});
            setOrdemPrioridade('antigos');
            setObservacaoGeral('');
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '550px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
              }}
            >
              {selectedServicoEct === DEFAULT_SERVICO_ECT
                ? 'Confirmar Geração de Etiquetas'
                : '⚠️ Atenção: Serviço Diferente!'
              }
            </h3>

            <div
              style={{
                backgroundColor: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#FFF7ED' : '#FEF2F2',
                border: `1px solid ${selectedServicoEct === DEFAULT_SERVICO_ECT ? '#FDBA74' : '#FECACA'}`,
                borderRadius: '0.5rem',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <p
                style={{
                  margin: '0 0 0.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                Serviço selecionado:
              </p>
              <p
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
                }}
              >
                {getServicoName(selectedServicoEct)}
              </p>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#314158',
                }}
              >
                <strong>{pendingGeneration.length}</strong> etiqueta{pendingGeneration.length !== 1 ? 's' : ''} será{pendingGeneration.length !== 1 ? 'ão' : ''} gerada{pendingGeneration.length !== 1 ? 's' : ''}.
              </p>
            </div>

            {selectedServicoEct !== DEFAULT_SERVICO_ECT && (
              <p
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#DC2626',
                  fontWeight: 500,
                }}
              >
                Você está gerando etiquetas com um serviço diferente do padrão (IMPRESSO Normal Módico). Confirma?
              </p>
            )}

            {/* Opções de Envio */}
            <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#166534' }}>
                ⚙️ OPÇÕES DE ENVIO
              </p>

              {/* Ordem de prioridade */}
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
                  Ordem de prioridade:
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setOrdemPrioridade('antigos')}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: ordemPrioridade === 'antigos' ? '#FFF' : '#166534',
                      backgroundColor: ordemPrioridade === 'antigos' ? '#16A34A' : '#DCFCE7',
                      border: ordemPrioridade === 'antigos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                    }}
                  >
                    📅 Mais antigos primeiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdemPrioridade('novos')}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: ordemPrioridade === 'novos' ? '#FFF' : '#166534',
                      backgroundColor: ordemPrioridade === 'novos' ? '#16A34A' : '#DCFCE7',
                      border: ordemPrioridade === 'novos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                    }}
                  >
                    🆕 Mais novos primeiro
                  </button>
                </div>
              </div>

              {/* Observação geral */}
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
                  Observação geral (opcional):
                </p>
                <textarea
                  value={observacaoGeral}
                  onChange={(e) => setObservacaoGeral(e.target.value)}
                  placeholder="Ex: Lote de sexta-feira, prioridade alta..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#1E293B',
                    backgroundColor: '#FFF',
                    border: '1px solid #86EFAC',
                    borderRadius: '0.375rem',
                    boxSizing: 'border-box',
                    resize: 'none',
                  }}
                />
              </div>
            </div>

            {/* Observações por Pedido */}
            <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#92400E' }}>
                📝 OBSERVAÇÕES POR PEDIDO
              </p>
              <p style={{ margin: '0.25rem 0 0.75rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
                Informe o que vai em cada pedido (aparece na mensagem do admin)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {pendingGeneration.map(sale => (
                  <div key={sale.transaction} style={{ backgroundColor: '#FFFBEB', borderRadius: '0.375rem', padding: '0.5rem' }}>
                    <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#78350F', fontWeight: 500 }}>
                      {sale.name}
                      {sale.enviosTotal > 1 && (
                        <span style={{ marginLeft: '0.5rem', color: '#B45309' }}>
                          (Envio {sale.enviosRealizados + 1}/{sale.enviosTotal})
                        </span>
                      )}
                    </p>
                    <input
                      type="text"
                      value={envioObservacoes[sale.transaction] || ''}
                      onChange={(e) => setEnvioObservacoes(prev => ({ ...prev, [sale.transaction]: e.target.value }))}
                      placeholder={sale.enviosTotal > 1 ? "O que vai neste envio?" : "Observação (opcional)"}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.75rem',
                        color: '#1E293B',
                        backgroundColor: '#FFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '0.375rem',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowServiceConfirmModal(false);
                  setEnvioObservacoes({});
                  setOrdemPrioridade('antigos');
                  setObservacaoGeral('');
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmGeneration}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Confirmar e Gerar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Aviso de Emails Diferentes ao Mesclar */}
      {showMergeWarningModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={cancelMerge}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#DC2626',
              }}
            >
              ⚠️ Atenção: Emails Diferentes!
            </h3>

            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '0.5rem',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <p
                style={{
                  margin: '0 0 0.75rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#314158',
                }}
              >
                Você está tentando mesclar pedidos de <strong>clientes com emails diferentes</strong>:
              </p>
              <ul
                style={{
                  margin: '0',
                  paddingLeft: '1.25rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  color: '#64748B',
                }}
              >
                {pendingMerge.map((sale, idx) => (
                  <li key={idx} style={{ marginBottom: '0.25rem' }}>
                    <strong>{sale.name}</strong> - {sale.email}
                    <br />
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{sale.productName}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#DC2626',
                fontWeight: 500,
              }}
            >
              Deseja continuar mesmo assim?
            </p>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={cancelMerge}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmMerge}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: '#DC2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Mesclar Mesmo Assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Status Misto ao Mesclar (gerado + pendente) */}
      {showMergeStatusModal && pendingMerge.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => {
            setShowMergeStatusModal(false);
            setPendingMerge([]);
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 0.5rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#1E293B',
              }}
            >
              Mesclar pedidos com status diferentes
            </h3>

            <p
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              Você está mesclando pedidos onde alguns já têm etiqueta gerada e outros ainda estão pendentes.
            </p>

            {/* Lista de pedidos */}
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                marginBottom: '1rem',
                maxHeight: '150px',
                overflow: 'auto',
              }}
            >
              {pendingMerge.map((sale, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: idx < pendingMerge.length - 1 ? '0.5rem' : 0,
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-inter)',
                }}>
                  <span style={{
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    backgroundColor: sale.etiquetaStatus === 'generated' ? '#DCFCE7' :
                                    sale.etiquetaStatus === 'partial' ? '#FEF3C7' : '#F1F5F9',
                    color: sale.etiquetaStatus === 'generated' ? '#166534' :
                           sale.etiquetaStatus === 'partial' ? '#92400E' : '#64748B',
                  }}>
                    {sale.etiquetaStatus === 'generated' ? 'Gerado' :
                     sale.etiquetaStatus === 'partial' ? 'Parcial' : 'Pendente'}
                  </span>
                  <span style={{ color: '#1E293B' }}>{sale.productName}</span>
                </div>
              ))}
            </div>

            {/* Opções */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              {/* Opção 1: Usar etiqueta existente */}
              <button
                onClick={() => {
                  setShowMergeStatusModal(false);
                  executeMerge(pendingMerge, 'use_existing');
                  setPendingMerge([]);
                }}
                style={{
                  width: '100%',
                  padding: '0.875rem 1rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  color: '#1E293B',
                  backgroundColor: '#F0FDF4',
                  border: '2px solid #22C55E',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  Usar etiqueta já gerada
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  Os pedidos pendentes serão associados à etiqueta existente.
                  Todos os produtos irão no mesmo envio.
                </div>
              </button>

              {/* Opção 2: Criar novo pedido pendente */}
              <button
                onClick={() => {
                  setShowMergeStatusModal(false);
                  executeMerge(pendingMerge, 'generate_new');
                  setPendingMerge([]);
                }}
                style={{
                  width: '100%',
                  padding: '0.875rem 1rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  color: '#1E293B',
                  backgroundColor: '#FFF7ED',
                  border: '2px solid #F97316',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  Criar novo pedido mesclado
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  A etiqueta existente será desconsiderada. Você poderá gerar
                  uma nova etiqueta para todos os produtos juntos.
                </div>
              </button>
            </div>

            {/* Botão Cancelar */}
            <button
              onClick={() => {
                setShowMergeStatusModal(false);
                setPendingMerge([]);
              }}
              style={{
                width: '100%',
                padding: '0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#64748B',
                backgroundColor: '#F1F5F9',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Merge */}
      {mergeDetailsSale && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setMergeDetailsSale(null)}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#9333EA',
                  color: 'white',
                  borderRadius: '0.5rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
                    <path d="M12 12h8a2 2 0 002-2V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v8z" />
                  </svg>
                  {mergeDetailsSale.mergedTransactions?.length || 0} Pedidos Mesclados
                </span>
              </div>
              <button
                onClick={() => setMergeDetailsSale(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  color: '#64748B',
                  cursor: 'pointer',
                  padding: '0.25rem',
                }}
              >
                ×
              </button>
            </div>

            {/* Destinatário Info */}
            <div style={{
              backgroundColor: '#F5F3FF',
              border: '1px solid #DDD6FE',
              borderRadius: '0.75rem',
              padding: '1rem',
              marginBottom: '1rem',
            }}>
              <h4 style={{
                margin: '0 0 0.75rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#7C3AED',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Destinatário
              </h4>
              <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.9375rem', fontWeight: 600, color: '#1E1B4B' }}>
                {mergeDetailsSale.name}
              </p>
              <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
                {mergeDetailsSale.email}
              </p>
              {mergeDetailsSale.phone && (
                <p style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
                  {mergeDetailsSale.phone}
                </p>
              )}
              <p style={{ margin: '0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
                {mergeDetailsSale.address}, {mergeDetailsSale.number}
                {mergeDetailsSale.complement && ` - ${mergeDetailsSale.complement}`}
                <br />
                {mergeDetailsSale.neighborhood} - {mergeDetailsSale.city}/{mergeDetailsSale.state} - CEP: {mergeDetailsSale.zip}
              </p>
            </div>

            {/* Pedidos Originais */}
            <h4 style={{
              margin: '0 0 0.75rem 0',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#7C3AED',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Pedidos Originais
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {mergeDetailsSale.mergedOriginalSales?.map((original, idx) => (
                <div
                  key={original.transaction}
                  style={{
                    backgroundColor: '#FAFAFA',
                    border: '1px solid #E5E7EB',
                    borderRadius: '0.75rem',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#9333EA',
                      color: 'white',
                      borderRadius: '0.375rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}>
                      Pedido #{idx + 1}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      color: '#6B7280',
                      backgroundColor: '#F3F4F6',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                    }}>
                      {original.transaction}
                    </span>
                  </div>
                  <p style={{
                    margin: '0 0 0.25rem 0',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#1F2937',
                  }}>
                    {original.productName}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                      <strong>Valor:</strong> {original.totalPrice}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                      <strong>Data:</strong> {original.saleDate?.split(' ')[0] || '-'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                      <strong>Documento:</strong> {original.document || '-'}
                    </span>
                  </div>
                </div>
              )) || mergeDetailsSale.mergedTransactions?.map((id, idx) => (
                <div
                  key={id}
                  style={{
                    backgroundColor: '#FAFAFA',
                    border: '1px solid #E5E7EB',
                    borderRadius: '0.75rem',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#9333EA',
                      color: 'white',
                      borderRadius: '0.375rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}>
                      #{idx + 1}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: '#374151' }}>
                      {id}
                    </span>
                  </div>
                  <p style={{ margin: '0.5rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#1F2937' }}>
                    {mergeDetailsSale.mergedProductNames?.[idx] || '-'}
                  </p>
                </div>
              ))}
            </div>

            {/* Botões */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  unmergePedido(mergeDetailsSale.transaction);
                  setMergeDetailsSale(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#DC2626',
                  backgroundColor: '#FEE2E2',
                  border: '1px solid #FECACA',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Desfazer Mesclagem
              </button>
              <button
                onClick={() => setMergeDetailsSale(null)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: '#9333EA',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Mapeamento de Colunas CSV */}
      {showColumnMappingModal && console.log('[CSV] RENDERIZANDO MODAL') as unknown as boolean}
      {showColumnMappingModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '700px',
              width: '95%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#314158',
                }}
              >
                Mapear Colunas do CSV
              </h3>
              <button
                onClick={clearSavedMapping}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                Resetar Mapeamento
              </button>
            </div>

            <p
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              Selecione qual coluna do seu CSV corresponde a cada campo.
              <br />
              <span style={{ color: '#DC2626' }}>* Campos obrigatórios</span>
            </p>

            {/* Preview das colunas detectadas */}
            <div
              style={{
                backgroundColor: '#F8FAFC',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                marginBottom: '1rem',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-inter)',
                color: '#64748B',
              }}
            >
              <strong>Colunas detectadas ({csvColumns.length}):</strong>{' '}
              {csvColumns.slice(0, 10).join(', ')}
              {csvColumns.length > 10 && ` ... e mais ${csvColumns.length - 10}`}
            </div>

            {/* Lista de campos para mapear */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '0.75rem',
                }}
              >
                {FIELD_DEFINITIONS.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      padding: '0.75rem',
                      backgroundColor: field.required ? '#FEF3C7' : '#F8FAFC',
                      borderRadius: '0.5rem',
                      border: `1px solid ${field.required ? '#FCD34D' : '#E2E8F0'}`,
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#314158',
                        marginBottom: '0.25rem',
                      }}
                    >
                      {field.label}
                      {field.required && <span style={{ color: '#DC2626' }}> *</span>}
                    </label>
                    <select
                      value={columnMapping[field.key] || ''}
                      onChange={(e) => updateMapping(field.key, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8rem',
                        borderRadius: '0.375rem',
                        border: '1px solid #E2E8F0',
                        backgroundColor: '#FFF',
                        color: '#314158',
                      }}
                    >
                      <option value="">-- Não mapear --</option>
                      {[...csvColumns].sort((a, b) => a.localeCompare(b)).map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                    <p
                      style={{
                        margin: '0.25rem 0 0 0',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.65rem',
                        color: '#94A3B8',
                      }}
                    >
                      {field.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Salvar como Modelo */}
            {showSaveTemplateModal ? (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '1rem',
                  backgroundColor: '#F0FDF4',
                  borderRadius: '0.5rem',
                  border: '1px solid #86EFAC',
                }}
              >
                {/* Aviso se nem todos os campos estão mapeados */}
                {!allFieldsMapped && (
                  <div
                    style={{
                      marginBottom: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      backgroundColor: '#FEF3C7',
                      borderRadius: '0.375rem',
                      border: '1px solid #FCD34D',
                    }}
                  >
                    <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
                      ⚠️ Mapeie todos os campos para poder salvar o modelo
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
                  {/* Nome do modelo */}
                  <div style={{ flex: 1 }}>
                    <label
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#166534',
                        marginBottom: '0.375rem',
                      }}
                    >
                      Nome do Modelo:
                    </label>
                    <input
                      type="text"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="Ex: Hotmart, Kiwify..."
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.875rem',
                        backgroundColor: '#FFFFFF',
                        color: '#1F2937',
                        border: '1px solid #16A34A',
                        borderRadius: '0.375rem',
                        outline: 'none',
                      }}
                    />
                  </div>

                  {/* Logo (opcional) */}
                  <div style={{ width: '180px' }}>
                    <label
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#166534',
                        marginBottom: '0.375rem',
                      }}
                    >
                      Logo (opcional):
                    </label>
                    <select
                      value={newTemplateLogo}
                      onChange={(e) => setNewTemplateLogo(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.875rem',
                        backgroundColor: '#FFFFFF',
                        color: '#1F2937',
                        border: '1px solid #16A34A',
                        borderRadius: '0.375rem',
                        outline: 'none',
                      }}
                    >
                      <option value="">Sem logo</option>
                      {AVAILABLE_LOGOS.map((logo) => (
                        <option key={logo.name} value={logo.name}>
                          {logo.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={handleSaveTemplate}
                    disabled={isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped}
                    style={{
                      padding: '0.5rem 1rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      color: '#FFF',
                      backgroundColor: isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped ? '#9CA3AF' : '#16A34A',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSavingTemplate ? 'Salvando...' : 'Salvar Modelo'}
                  </button>
                  <button
                    onClick={() => {
                      setShowSaveTemplateModal(false);
                      setNewTemplateName('');
                      setNewTemplateLogo('');
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.8rem',
                      color: '#64748B',
                      backgroundColor: '#F1F5F9',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                <button
                  onClick={() => setShowSaveTemplateModal(true)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    color: '#166534',
                    backgroundColor: '#DCFCE7',
                    border: '1px solid #86EFAC',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                  }}
                >
                  💾 Salvar como Modelo
                </button>
                <span
                  style={{
                    marginLeft: '0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#64748B',
                  }}
                >
                  Salve este mapeamento para usar em futuras importações
                </span>
              </div>
            )}

            {/* Botões */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowColumnMappingModal(false);
                  setCsvData([]);
                  setCsvColumns([]);
                  setFileName(null);
                  setShowSaveTemplateModal(false);
                  setNewTemplateName('');
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmColumnMapping}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: '#F97316',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Confirmar e Processar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {showDeleteTemplateModal && templateToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => {
            setShowDeleteTemplateModal(false);
            setTemplateToDelete(null);
            setDeleteConfirmText('');
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#DC2626',
              }}
            >
              Excluir Modelo
            </h3>
            <p
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              Esta ação não pode ser desfeita. Para confirmar, digite o nome do modelo:
            </p>
            <p
              style={{
                margin: '0 0 0.75rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#314158',
                backgroundColor: '#F1F5F9',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.375rem',
              }}
            >
              {templateToDelete.name}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Digite o nome do modelo..."
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                backgroundColor: '#FFFFFF',
                color: '#1F2937',
                border: '1px solid #E2E8F0',
                borderRadius: '0.375rem',
                outline: 'none',
                marginBottom: '1rem',
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowDeleteTemplateModal(false);
                  setTemplateToDelete(null);
                  setDeleteConfirmText('');
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteTemplate}
                disabled={deleteConfirmText !== templateToDelete.name}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: deleteConfirmText !== templateToDelete.name ? '#9CA3AF' : '#DC2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: deleteConfirmText !== templateToDelete.name ? 'not-allowed' : 'pointer',
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de CSV Incompatível */}
      {showIncompatibleModal && selectedTemplate && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '450px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#314158',
              }}
            >
              CSV Incompatível
            </h3>
            <p
              style={{
                margin: '0 0 0.5rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              O CSV importado não é compatível com o modelo <strong>{selectedTemplate.name}</strong>.
            </p>
            <p
              style={{
                margin: '0 0 1.5rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              Algumas colunas esperadas não foram encontradas. Deseja criar um novo mapeamento?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleIncompatibleCancel}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleIncompatibleCreateNew}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: '#3B82F6',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Criar Novo Mapeamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Template */}
      {showEditTemplateModal && templateToEdit && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '450px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#314158',
              }}
            >
              Editar Modelo
            </h3>

            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#314158',
                  marginBottom: '0.375rem',
                }}
              >
                Nome do Modelo:
              </label>
              <input
                type="text"
                value={editTemplateName}
                onChange={(e) => setEditTemplateName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  backgroundColor: '#FFFFFF',
                  color: '#1F2937',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.375rem',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#314158',
                  marginBottom: '0.375rem',
                }}
              >
                Logo (opcional):
              </label>
              <select
                value={editTemplateLogo}
                onChange={(e) => setEditTemplateLogo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  backgroundColor: '#FFFFFF',
                  color: '#1F2937',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.375rem',
                  outline: 'none',
                }}
              >
                <option value="">Sem logo</option>
                {AVAILABLE_LOGOS.map((logo) => (
                  <option key={logo.name} value={logo.name}>
                    {logo.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Botão Excluir */}
            <button
              onClick={() => {
                setShowEditTemplateModal(false);
                if (templateToEdit) openDeleteModal(templateToEdit);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                width: '100%',
                padding: '0.5rem',
                marginBottom: '1rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.8rem',
                fontWeight: 500,
                color: '#DC2626',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#FEE2E2';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#FEF2F2';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Excluir modelo
            </button>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowEditTemplateModal(false);
                  setTemplateToEdit(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmEditTemplate}
                disabled={!editTemplateName.trim()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: !editTemplateName.trim() ? '#9CA3AF' : '#3B82F6',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: !editTemplateName.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configurações */}
      {showConfigModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowConfigModal(false)}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: '#1E293B',
                }}
              >
                ⚙️ Configurações
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Toggle: Modo Teste VIPP */}
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: useTestCredentials ? '#FEF3C7' : '#F8FAFC', borderRadius: '0.75rem', border: useTestCredentials ? '1px solid #FCD34D' : '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E293B' }}>
                    🧪 Modo Teste (VIPP)
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                    Usa credenciais de homologação para gerar etiquetas de teste
                  </p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={useTestCredentials}
                    onChange={(e) => setUseTestCredentials(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: useTestCredentials ? '#F59E0B' : '#CBD5E1',
                    borderRadius: '24px',
                    transition: '0.3s',
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: '18px',
                      width: '18px',
                      left: useTestCredentials ? '27px' : '3px',
                      bottom: '3px',
                      backgroundColor: '#FFF',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }} />
                  </span>
                </label>
              </div>
            </div>

            {/* Toggle: Enviar para N8N */}
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: sendToN8n ? '#F0FDF4' : '#FEF2F2', borderRadius: '0.75rem', border: sendToN8n ? '1px solid #86EFAC' : '1px solid #FECACA' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E293B' }}>
                    📤 Enviar para N8N/Webhook
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                    Dispara webhook após gerar etiquetas (admin sempre recebe)
                  </p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={sendToN8n}
                    onChange={(e) => setSendToN8n(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: sendToN8n ? '#22C55E' : '#EF4444',
                    borderRadius: '24px',
                    transition: '0.3s',
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: '18px',
                      width: '18px',
                      left: sendToN8n ? '27px' : '3px',
                      bottom: '3px',
                      backgroundColor: '#FFF',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }} />
                  </span>
                </label>
              </div>
            </div>

            {/* Toggle: Notificar Cliente */}
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: sendClientNotification ? '#EFF6FF' : '#F8FAFC', borderRadius: '0.75rem', border: sendClientNotification ? '1px solid #93C5FD' : '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E293B' }}>
                    📱 Notificar Cliente (WhatsApp)
                  </p>
                  <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                    Envia código de rastreio para o cliente via Evolution
                  </p>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={sendClientNotification}
                    onChange={(e) => setSendClientNotification(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: sendClientNotification ? '#3B82F6' : '#CBD5E1',
                    borderRadius: '24px',
                    transition: '0.3s',
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: '18px',
                      width: '18px',
                      left: sendClientNotification ? '27px' : '3px',
                      bottom: '3px',
                      backgroundColor: '#FFF',
                      borderRadius: '50%',
                      transition: '0.3s',
                    }} />
                  </span>
                </label>
              </div>
            </div>

            {/* Campos de telefone */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.375rem' }}>
                📞 Telefone Admin (notificações)
              </label>
              <input
                type="text"
                value={adminPhone}
                onChange={(e) => setAdminPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="5585999999999"
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#1E293B',
                  backgroundColor: '#FFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.375rem' }}>
                🧪 Telefone Teste Cliente (substitui telefone real)
              </label>
              <input
                type="text"
                value={clientPhoneOverride}
                onChange={(e) => setClientPhoneOverride(e.target.value.replace(/\D/g, ''))}
                placeholder="Vazio = usa telefone do CSV"
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#1E293B',
                  backgroundColor: '#FFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.625rem', color: '#94A3B8' }}>
                Se preenchido, todas as notificações de cliente vão para este número (para testes)
              </p>
            </div>

            {/* Botão fechar */}
            <button
              onClick={() => {
                handleSaveSettings();
                setShowConfigModal(false);
              }}
              style={{
                width: '100%',
                padding: '0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#FFF',
                backgroundColor: '#3B82F6',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              Salvar e Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmação Unificado (Produção + Cliente) */}
      {showGenerationConfirmModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => {
            setShowGenerationConfirmModal(false);
            setConfirmEtiquetasText('');
            setConfirmEnviarText('');
            setEnvioObservacoes({});
            setOrdemPrioridade('antigos');
            setObservacaoGeral('');
          }}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#DC2626',
              }}
            >
              ⚠️ Confirmação Necessária
            </h3>

            {/* Aviso de Produção */}
            {needsProductionConfirm && (
              <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#991B1B' }}>
                  🏭 MODO PRODUÇÃO
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#991B1B' }}>
                  Etiquetas reais serão geradas nos Correios. Esta ação não pode ser desfeita.
                </p>
                <div style={{ marginTop: '0.75rem' }}>
                  <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                    Digite <strong>&quot;etiquetas&quot;</strong> para confirmar:
                  </p>
                  <input
                    type="text"
                    value={confirmEtiquetasText}
                    onChange={(e) => setConfirmEtiquetasText(e.target.value)}
                    placeholder="etiquetas"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#1E293B',
                      backgroundColor: confirmEtiquetasText.toLowerCase() === 'etiquetas' ? '#D1FAE5' : '#FFF',
                      border: confirmEtiquetasText.toLowerCase() === 'etiquetas' ? '1px solid #10B981' : '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Aviso de Notificação Cliente */}
            {needsClientConfirm && (
              <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E40AF' }}>
                  📱 NOTIFICAÇÃO AO CLIENTE
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#1E40AF' }}>
                  Os clientes receberão mensagem no WhatsApp com o código de rastreio.
                </p>
                <div style={{ marginTop: '0.75rem' }}>
                  <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                    Digite <strong>&quot;enviar&quot;</strong> para confirmar:
                  </p>
                  <input
                    type="text"
                    value={confirmEnviarText}
                    onChange={(e) => setConfirmEnviarText(e.target.value)}
                    placeholder="enviar"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#1E293B',
                      backgroundColor: confirmEnviarText.toLowerCase() === 'enviar' ? '#DBEAFE' : '#FFF',
                      border: confirmEnviarText.toLowerCase() === 'enviar' ? '1px solid #3B82F6' : '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Opções de Envio */}
            <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#166534' }}>
                ⚙️ OPÇÕES DE ENVIO
              </p>

              {/* Ordem de prioridade */}
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
                  Ordem de prioridade:
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setOrdemPrioridade('antigos')}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: ordemPrioridade === 'antigos' ? '#FFF' : '#166534',
                      backgroundColor: ordemPrioridade === 'antigos' ? '#16A34A' : '#DCFCE7',
                      border: ordemPrioridade === 'antigos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                    }}
                  >
                    📅 Mais antigos primeiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdemPrioridade('novos')}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: ordemPrioridade === 'novos' ? '#FFF' : '#166534',
                      backgroundColor: ordemPrioridade === 'novos' ? '#16A34A' : '#DCFCE7',
                      border: ordemPrioridade === 'novos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                    }}
                  >
                    🆕 Mais novos primeiro
                  </button>
                </div>
              </div>

              {/* Observação geral */}
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
                  Observação geral (opcional):
                </p>
                <textarea
                  value={observacaoGeral}
                  onChange={(e) => setObservacaoGeral(e.target.value)}
                  placeholder="Ex: Lote de sexta-feira, prioridade alta..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#1E293B',
                    backgroundColor: '#FFF',
                    border: '1px solid #86EFAC',
                    borderRadius: '0.375rem',
                    boxSizing: 'border-box',
                    resize: 'none',
                  }}
                />
              </div>
            </div>

            {/* Seção de Envios Parciais */}
            {pendingGeneration.filter(s => s.enviosTotal > 1).length > 0 && (
              <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#92400E' }}>
                  📦 ENVIOS PARCIAIS
                </p>
                <p style={{ margin: '0.25rem 0 0.75rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
                  Informe o que vai neste envio (ex: &quot;camiseta&quot;, &quot;2 unidades&quot;)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {pendingGeneration.filter(s => s.enviosTotal > 1).map(sale => (
                    <div key={sale.transaction} style={{ backgroundColor: '#FFFBEB', borderRadius: '0.375rem', padding: '0.5rem' }}>
                      <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#78350F', fontWeight: 500 }}>
                        {sale.name} - Envio {sale.enviosRealizados + 1}/{sale.enviosTotal}
                      </p>
                      <input
                        type="text"
                        value={envioObservacoes[sale.transaction] || ''}
                        onChange={(e) => setEnvioObservacoes(prev => ({ ...prev, [sale.transaction]: e.target.value }))}
                        placeholder="O que vai neste envio?"
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.75rem',
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#1E293B',
                          backgroundColor: '#FFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '0.375rem',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resumo */}
            <div style={{ backgroundColor: '#F8FAFC', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                <strong>{pendingGeneration.length}</strong> etiqueta(s) serão geradas
                {sendToN8n && <span> • Webhook ativo</span>}
                {sendClientNotification && clientPhoneOverride && <span> • Teste: {clientPhoneOverride}</span>}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowGenerationConfirmModal(false);
                  setConfirmEtiquetasText('');
                  setConfirmEnviarText('');
                  setEnvioObservacoes({});
                  setOrdemPrioridade('antigos');
                  setObservacaoGeral('');
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmGeneration}
                disabled={!isConfirmationValid()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: isConfirmationValid() ? '#DC2626' : '#9CA3AF',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: isConfirmationValid() ? 'pointer' : 'not-allowed',
                }}
              >
                Confirmar Geração
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação - Novo Upload */}
      {showNewUploadConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowNewUploadConfirm(false)}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '1.125rem',
                color: '#1E293B',
                margin: '0 0 0.75rem 0',
              }}
            >
              Novo Upload
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
                margin: '0 0 1.5rem 0',
              }}
            >
              Deseja importar um novo CSV? Os dados atuais serão substituídos.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowNewUploadConfirm(false)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowNewUploadConfirm(false);
                  resetUpload();
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  color: '#FFF',
                  backgroundColor: '#F97316',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
