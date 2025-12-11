'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Papa from 'papaparse';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, Timestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';

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
  produtos?: string[]
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

    await addDoc(collection(db, 'etiquetas'), docData);
  } catch (err) {
    console.error('Erro ao salvar etiqueta:', err);
    throw err;
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'generated'>('all');
  const [selectedServicoEct, setSelectedServicoEct] = useState(DEFAULT_SERVICO_ECT);
  const [showServiceConfirmModal, setShowServiceConfirmModal] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<PhysicalSale[]>([]);
  const [searchText, setSearchText] = useState('');
  const [showMergeWarningModal, setShowMergeWarningModal] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PhysicalSale[]>([]);
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
  const handleFilterChange = (newFilter: 'all' | 'pending' | 'partial' | 'generated') => {
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

  // Filtrar vendas pelo status e busca
  const filteredSales = physicalSales.filter(sale => {
    // Ocultar pedidos que foram mesclados em outro
    if (sale.mergedInto) return false;

    // Primeiro filtrar por status
    let passesStatusFilter = true;
    if (statusFilter === 'pending') passesStatusFilter = sale.etiquetaStatus === 'pending';
    if (statusFilter === 'partial') passesStatusFilter = sale.etiquetaStatus === 'partial';
    if (statusFilter === 'generated') passesStatusFilter = sale.etiquetaStatus === 'generated';

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
          state: row[mapping.state] || '',
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

      setPhysicalSales(withLabels);
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
    // Pegar apenas pedidos pendentes selecionados (não permite mesclar já gerados)
    const selectedPending = physicalSales.filter(s =>
      s.selected && s.etiquetaStatus === 'pending' && !s.mergedInto
    );

    if (selectedPending.length < 2) return;

    // Verificar se todos os emails são iguais
    const emails = [...new Set(selectedPending.map(s => s.email.toLowerCase().trim()))];

    if (emails.length > 1) {
      // Emails diferentes - mostrar aviso
      setPendingMerge(selectedPending);
      setShowMergeWarningModal(true);
    } else {
      // Emails iguais - mesclar direto
      executeMerge(selectedPending);
    }
  };

  // Executar o merge de pedidos
  const executeMerge = (pedidosToMerge: PhysicalSale[]) => {
    if (pedidosToMerge.length < 2) return;

    // Usar o primeiro pedido como base para dados do destinatário
    const baseSale = pedidosToMerge[0];

    // Criar ID único para o pedido mesclado
    const mergedId = `MERGED_${Date.now()}`;

    // Combinar informações
    const allTransactions = pedidosToMerge.map(s => s.transaction);
    const allProducts = pedidosToMerge.map(s => s.productName);
    const allProductCodes = pedidosToMerge.map(s => s.productCode);

    // Criar novo pedido mesclado
    const mergedSale: PhysicalSale = {
      ...baseSale,
      transaction: mergedId,
      productName: allProducts.join(' + '),
      productCode: allProductCodes.join(','),
      selected: false,
      isMerged: true,
      mergedTransactions: allTransactions,
      mergedProductNames: allProducts,
      enviosTotal: 1,
      enviosRealizados: 0,
      etiquetaStatus: 'pending',
    };

    // Atualizar lista: marcar originais como mesclados e adicionar o novo
    setPhysicalSales(prev => {
      const updated = prev.map(s => {
        if (allTransactions.includes(s.transaction)) {
          return { ...s, mergedInto: mergedId, selected: false };
        }
        return s;
      });
      return [...updated, mergedSale];
    });

    // Limpar estados do modal
    setShowMergeWarningModal(false);
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
  const unmergePedido = (mergedId: string) => {
    setPhysicalSales(prev => {
      // Restaurar pedidos originais
      const updated = prev.map(s => {
        if (s.mergedInto === mergedId) {
          return { ...s, mergedInto: undefined, selected: false };
        }
        return s;
      });
      // Remover o pedido mesclado
      return updated.filter(s => s.transaction !== mergedId);
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
  // Conta pendentes selecionados que podem ser mesclados (não pode mesclar já gerados ou parciais)
  const selectedPendingForMerge = physicalSales.filter(s =>
    s.selected && s.etiquetaStatus === 'pending' && !s.mergedInto
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

    // 1. WEBHOOK - Disparar para admin receber notificação (mesmo só imprimindo)
    try {
      const etiquetasParaWebhook = selectedSales.map(sale => ({
        codigo: sale.etiqueta || '',
        transactionId: sale.transaction,
        produto: sale.productName,
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
      }));

      const webhookPayload = {
        etiquetas: [], // Nenhuma nova - cliente não recebe
        etiquetasAdmin: etiquetasParaWebhook, // Admin recebe todas as selecionadas
      };

      console.log('========== WEBHOOK IMPRIMIR (só já geradas) ==========');
      console.log('Enviando para /api/webhook/etiquetas:');
      console.log('- Etiquetas para admin:', etiquetasParaWebhook.length);
      console.log(JSON.stringify(webhookPayload, null, 2));
      console.log('======================================================');

      await fetch('/api/webhook/etiquetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      });
    } catch (webhookErr) {
      console.error('Erro ao disparar webhook:', webhookErr);
    }

    // 2. IMPRIMIR - Baixar PDF
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
  const executeGeneration = async (toGenerate: PhysicalSale[]) => {
    // Etiquetas já geradas que estão selecionadas (para incluir no PDF)
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Etiquetas recém-geradas (para webhook do cliente)
    const etiquetasNovas: Array<{
      codigo: string;
      transactionId: string;
      produto: string;
      destinatario: { nome: string; telefone: string; email: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
    }> = [];

    // Todas as etiquetas para o PDF (novas + já geradas selecionadas)
    const todasEtiquetasParaPdf: string[] = alreadyGenerated.map(s => s.etiqueta as string);

    // Etiquetas já geradas (para webhook do admin, sem enviar para cliente)
    const etiquetasJaGeradas: Array<{
      codigo: string;
      transactionId: string;
      produto: string;
      destinatario: { nome: string; telefone: string; email: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string };
    }> = alreadyGenerated.map(sale => ({
      codigo: sale.etiqueta || '',
      transactionId: sale.transaction,
      produto: sale.productName,
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
              sale.mergedProductNames  // nomes dos produtos se for mesclado
            );

            // Guardar para o webhook (cliente vai receber)
            etiquetasNovas.push({
              codigo: result.etiqueta,
              transactionId: sale.transaction,
              produto: sale.productName,
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

    // 1. WEBHOOK - Disparar imediatamente após gerar
    // Admin recebe TODAS, Cliente recebe apenas as NOVAS
    const todasParaAdmin = [...etiquetasNovas, ...etiquetasJaGeradas];

    if (todasParaAdmin.length > 0) {
      try {
        const webhookPayload = {
          etiquetas: etiquetasNovas, // Cliente recebe só as novas
          etiquetasAdmin: todasParaAdmin, // Admin recebe todas
        };

        console.log('========== WEBHOOK ETIQUETAS ==========');
        console.log('Enviando para /api/webhook/etiquetas:');
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
      executeGeneration([]);
      return;
    }

    // Mostra modal de confirmação para novas etiquetas
    setPendingGeneration(toGenerate);
    setShowServiceConfirmModal(true);
  };

  // Confirmar geração após modal
  const confirmGeneration = () => {
    setShowServiceConfirmModal(false);
    executeGeneration(pendingGeneration);
    setPendingGeneration([]);
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
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 600,
              fontSize: '1.25rem',
              color: '#314158',
              marginBottom: '0.25rem',
            }}
          >
            Vendas de Produtos Físicos
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
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

        {/* Filtros e Botões */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Campo de Busca */}
          <div className="relative">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar..."
              className="pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              style={{
                fontFamily: 'var(--font-inter)',
                width: '180px',
                color: '#1E293B',
              }}
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              width="16"
              height="16"
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
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => handleFilterChange('all')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'all' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Todas ({physicalSales.length})
            </button>
            <button
              onClick={() => handleFilterChange('pending')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'pending' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Pendentes ({physicalSales.filter(s => s.etiquetaStatus === 'pending').length})
            </button>
            <button
              onClick={() => handleFilterChange('partial')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'partial' && !hasSearchText
                  ? 'bg-white text-yellow-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Parciais ({physicalSales.filter(s => s.etiquetaStatus === 'partial').length})
            </button>
            <button
              onClick={() => handleFilterChange('generated')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'generated' && !hasSearchText
                  ? 'bg-white text-green-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Completas ({physicalSales.filter(s => s.etiquetaStatus === 'generated').length})
            </button>
            {hasSearchText && (
              <span
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-orange-100 text-orange-700"
                style={{ fontFamily: 'var(--font-inter)' }}
              >
                Busca ({filteredSales.length})
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
          <button
            onClick={resetUpload}
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition disabled:opacity-50"
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Novo Upload
          </button>
          {/* Botões para etiquetas já geradas (quando só tem já geradas selecionadas, sem pendentes) */}
          {selectedGeneratedCount > 0 && selectedCount === 0 && (
            <>
              <button
                onClick={handlePrintLabels}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg text-white transition hover:opacity-90 flex items-center gap-2"
                style={{
                  backgroundColor: '#22C55E',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Imprimir {selectedGeneratedCount} PDF{selectedGeneratedCount !== 1 ? 's' : ''}
              </button>
              <button
                onClick={handleExportTrackingCSV}
                className="px-4 py-2 rounded-lg text-white transition hover:opacity-90 flex items-center gap-2"
                style={{
                  backgroundColor: '#3B82F6',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exportar CSV Rastreio
              </button>
            </>
          )}
          {/* Dropdown de serviço + Botão gerar (quando tem pendentes) */}
          {selectedCount > 0 && (
            <>
              <div className="flex items-center gap-2">
                <label
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
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
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white disabled:opacity-50"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#314158',
                  }}
                >
                  {SERVICOS_ECT.map(servico => (
                    <option key={servico.code} value={servico.code}>
                      {servico.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Botão Mesclar - aparece quando 2+ pendentes selecionados */}
              {selectedPendingForMerge >= 2 && (
                <button
                  onClick={handleMergePedidos}
                  disabled={isGenerating}
                  className="px-4 py-2 rounded-lg text-white transition hover:opacity-90 flex items-center gap-2"
                  style={{
                    backgroundColor: '#8B5CF6',
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                  }}
                  title="Mesclar pedidos selecionados em um único envio"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 6h13" />
                    <path d="M8 12h13" />
                    <path d="M8 18h13" />
                    <path d="M3 6h.01" />
                    <path d="M3 12h.01" />
                    <path d="M3 18h.01" />
                  </svg>
                  Mesclar {selectedPendingForMerge}
                </button>
              )}
              <button
                onClick={handleGenerateLabels}
                disabled={isGenerating}
                className={`px-4 py-2 rounded-lg text-white transition ${
                  isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
                style={{
                  backgroundColor: '#F97316',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                {isGenerating
                  ? `Gerando ${generationProgress.current}/${generationProgress.total}...`
                  : selectedGeneratedCount > 0
                    ? `Gerar ${selectedCount} + incluir ${selectedGeneratedCount} no PDF`
                    : `Gerar ${selectedCount} Etiqueta${selectedCount !== 1 ? 's' : ''}`
                }
              </button>
            </>
          )}
        </div>
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
                  className={`border-b border-slate-100 hover:bg-slate-50 transition ${
                    sale.etiquetaStatus === 'generated' ? 'bg-green-50/50' : ''
                  } ${sale.etiquetaStatus === 'partial' ? 'bg-yellow-50/50' : ''
                  } ${sale.isMerged ? 'bg-purple-50/50' : ''
                  } ${sale.etiquetaStatus === 'error' ? 'bg-red-50/50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={sale.selected}
                      onChange={() => toggleSelect(sale.transaction)}
                      disabled={isGenerating}
                      className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {/* Badge de Mesclado */}
                    {sale.isMerged && (
                      <div className="flex items-center gap-1 mb-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          Mesclado ({sale.mergedTransactions?.length || 0})
                        </span>
                        <button
                          onClick={() => unmergePedido(sale.transaction)}
                          className="text-purple-500 hover:text-purple-700 text-xs"
                          title="Desfazer mesclagem"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    {sale.etiquetaStatus === 'generated' ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Completo {sale.enviosRealizados}/{sale.enviosTotal}
                        </span>
                        <span
                          className="text-xs text-green-600 font-mono"
                          title={sale.etiquetas?.join(', ') || sale.etiqueta}
                        >
                          {sale.etiqueta}
                        </span>
                      </div>
                    ) : sale.etiquetaStatus === 'partial' ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                          Parcial {sale.enviosRealizados}/{sale.enviosTotal}
                        </span>
                        <span
                          className="text-xs text-yellow-600 font-mono"
                          title={sale.etiquetas?.join(', ') || sale.etiqueta}
                        >
                          {sale.etiqueta}
                        </span>
                      </div>
                    ) : sale.etiquetaStatus === 'error' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Erro
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        Pendente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* Coluna de Envios - dropdown para pendentes, botão +1 para parciais, texto para completos */}
                    {sale.etiquetaStatus === 'pending' ? (
                      <select
                        value={sale.enviosTotal}
                        onChange={(e) => updateEnviosTotal(sale.transaction, parseInt(e.target.value))}
                        disabled={isGenerating}
                        className="px-2 py-1 rounded-md border border-slate-300 text-sm bg-white focus:ring-orange-500 focus:border-orange-500 disabled:opacity-50"
                        style={{ fontFamily: 'var(--font-inter)' }}
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
                        <p
                          style={{
                            fontFamily: 'var(--font-inter)',
                            fontSize: '0.75rem',
                            color: '#64748B',
                          }}
                        >
                          {sale.phone}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
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
          }}
          onClick={() => setShowServiceConfirmModal(false)}
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

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowServiceConfirmModal(false)}
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
    </div>
  );
}
