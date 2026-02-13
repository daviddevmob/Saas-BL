'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';

// Imports dos arquivos refatorados
import {
  PhysicalSale,
  ColumnMapping,
  MappingTemplate,
  OriginalSaleData,
} from './etiquetas/types';

import {
  SERVICOS_ECT,
  DEFAULT_SERVICO_ECT,
  REQUIRED_FIELDS,
  FIELD_DEFINITIONS,
  AVAILABLE_LOGOS,
} from './etiquetas/constants';

import {
  isPhysicalProduct,
  parseDate,
  parseCSV,
  autoDetectMapping,
  generateMergeId,
  sanitizeForFirebase,
} from './etiquetas/utils';

import {
  fetchMappingTemplates,
  saveMappingTemplate,
  deleteMappingTemplate,
  updateMappingTemplate,
  fetchExistingLabels,
  saveLabel,
  loadEtiquetasSettings,
  saveEtiquetasSettings,
  loadSavedMerges,
  saveMergeToFirebase,
  removeMergeFromFirebase,
} from './etiquetas/services';

import {
  ConfigModal,
  NewUploadConfirmModal,
  GenerationConfirmModal,
  ServiceConfirmModal,
  MergeWarningModal,
  MergeStatusModal,
  MergeDetailsModal,
  SaveAndProcessModal,
  IncompatibleModal,
  ColumnMappingModal,
} from './etiquetas/modals';

import EtiquetasHistory from './etiquetas/EtiquetasHistory';
import ImportModal from './etiquetas/ImportModal';

export default function EtiquetasUpload() {
  // Estados de UI/Fluxo
  const [showImportModal, setShowImportModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Estados de Dados
  const [physicalSales, setPhysicalSales] = useState<PhysicalSale[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, success: 0, errors: 0 });
  
  // Estados de Filtro/Busca
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'generated' | 'merge'>('all');
  const [searchText, setSearchText] = useState('');
  
  // Estados de Configuração de Envio
  const [selectedServicoEct, setSelectedServicoEct] = useState(DEFAULT_SERVICO_ECT);
  const [showServiceConfirmModal, setShowServiceConfirmModal] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<PhysicalSale[]>([]);
  
  // Estados de Merge
  const [showMergeWarningModal, setShowMergeWarningModal] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PhysicalSale[]>([]);
  const [mergeDetailsSale, setMergeDetailsSale] = useState<PhysicalSale | null>(null);
  const [showMergeStatusModal, setShowMergeStatusModal] = useState(false);
  
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
  
  // Modais extras
  const [showIncompatibleModal, setShowIncompatibleModal] = useState(false);
  const [showSaveAndProcessModal, setShowSaveAndProcessModal] = useState(false);

  // Estados para configurações gerais
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [sendToN8n, setSendToN8n] = useState(true);
  const [useTestCredentials, setUseTestCredentials] = useState(false);
  const [adminPhone, setAdminPhone] = useState('5585987080090');
  const [clientPhoneOverride, setClientPhoneOverride] = useState('');
  const [showGenerationConfirmModal, setShowGenerationConfirmModal] = useState(false);
  const [confirmEtiquetasText, setConfirmEtiquetasText] = useState('');
  const [confirmEnviarText, setConfirmEnviarText] = useState('');
  const [envioObservacoes, setEnvioObservacoes] = useState<Record<string, string>>({});
  const [ordemPrioridade, setOrdemPrioridade] = useState<'antigos' | 'novos'>('antigos');
  const [observacaoGeral, setObservacaoGeral] = useState('');

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
        setUseTestCredentials(settings.useTestCredentials || false);
      }
    };
    loadSettings();
  }, []);

  // Validar telefone brasileiro
  const isValidPhone = (phone: string): boolean => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 13 && cleaned.startsWith('55');
  };

  // Salvar configurações no Firebase
  const handleSaveSettings = async () => {
    if (!isValidPhone(adminPhone)) {
      alert('Telefone do admin inválido! Deve ter 13 dígitos e começar com 55.\nExemplo: 5585987080090');
      return;
    }
    await saveEtiquetasSettings({
      adminPhone,
      clientPhoneOverride,
      sendToN8n,
      useTestCredentials,
    });
  };

  const needsProductionConfirm = !useTestCredentials;
  const needsClientConfirm = false;

  // Carregar mapeamento salvo do localStorage
  useEffect(() => {
    const savedMapping = localStorage.getItem('etiquetas_column_mapping');
    if (savedMapping) {
      try {
        setColumnMapping(JSON.parse(savedMapping));
      } catch { } // Ignorar erro de parse
    }
  }, []);

  // Desmarcar todas ao mudar filtro ou busca
  const handleFilterChange = (newFilter: 'all' | 'pending' | 'partial' | 'generated' | 'merge') => {
    setStatusFilter(newFilter);
    setPhysicalSales(prev => prev.map(s => ({ ...s, selected: false })));
  };

  const normalizeText = (text: string) => {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  };

  const hasSearchText = searchText.trim().length > 0;

  const getMergeKey = (sale: PhysicalSale) => {
    const normalizeStr = (s: string) => s.toLowerCase().trim();
    return `${normalizeStr(sale.email)}|${normalizeStr(sale.name)}|${normalizeStr(sale.address)}|${normalizeStr(sale.number || '')}|${normalizeStr(sale.zip || '')}`;
  };

  const mergeCandidateKeys = useMemo(() => {
    const visibleSales = physicalSales.filter(s => !s.mergedInto);
    const eligibleSales = visibleSales.filter(s =>
      !s.isMerged && (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial')
    );
    const keyCount: Record<string, number> = {};
    eligibleSales.forEach(sale => {
      const key = getMergeKey(sale);
      keyCount[key] = (keyCount[key] || 0) + 1;
    });
    return new Set(Object.entries(keyCount).filter(([, count]) => count > 1).map(([key]) => key));
  }, [physicalSales]);

  const mergeFilterCount = useMemo(() => {
    const visibleSales = physicalSales.filter(s => !s.mergedInto);
    const mergedItems = visibleSales.filter(s => s.isMerged);
    const candidateItems = visibleSales.filter(s =>
      !s.isMerged &&
      (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial') &&
      mergeCandidateKeys.has(getMergeKey(s))
    );
    return mergedItems.length + candidateItems.length;
  }, [physicalSales, mergeCandidateKeys]);

  const filteredSales = useMemo(() => {
    let result = physicalSales.filter(sale => {
      if (sale.mergedInto) return false;

      let passesStatusFilter = true;
      if (statusFilter === 'pending') passesStatusFilter = sale.etiquetaStatus === 'pending';
      if (statusFilter === 'partial') passesStatusFilter = sale.etiquetaStatus === 'partial';
      if (statusFilter === 'generated') passesStatusFilter = sale.etiquetaStatus === 'generated';
      if (statusFilter === 'merge') {
        const isMergedItem = sale.isMerged;
        const isCandidate = !sale.isMerged &&
          (sale.etiquetaStatus === 'pending' || sale.etiquetaStatus === 'generated' || sale.etiquetaStatus === 'partial') &&
          mergeCandidateKeys.has(getMergeKey(sale));
        passesStatusFilter = isMergedItem || isCandidate;
      }

      if (!passesStatusFilter) return false;

      if (hasSearchText) {
        const searchNormalized = normalizeText(searchText);
        const fieldsToSearch = [
          sale.name, sale.email, sale.phone, sale.transaction, sale.productName,
          sale.city, sale.state, sale.neighborhood, sale.address, sale.zip, sale.etiqueta || '',
        ];
        return fieldsToSearch.some(field => normalizeText(field).includes(searchNormalized));
      }

      return true;
    });

    if (statusFilter === 'merge') {
      result.sort((a, b) => {
        if (a.isMerged && !b.isMerged) return -1;
        if (!a.isMerged && b.isMerged) return 1;
        if (a.isMerged && b.isMerged) return parseDate(b.saleDate) - parseDate(a.saleDate);
        const keyA = getMergeKey(a);
        const keyB = getMergeKey(b);
        if (keyA !== keyB) return keyA.localeCompare(keyB);
        return parseDate(b.saleDate) - parseDate(a.saleDate);
      });
    } else {
      result.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
    }

    return result;
  }, [physicalSales, statusFilter, hasSearchText, searchText, mergeCandidateKeys]);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setFileName(file.name);

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

      let detectedMapping = autoDetectMapping(columns);
      const savedMapping = localStorage.getItem('etiquetas_column_mapping');
      if (savedMapping) {
        try {
          const parsed = JSON.parse(savedMapping);
          const savedMappingValid = Object.values(parsed).every(
            (col) => columns.includes(col as string) || col === ''
          );
          if (savedMappingValid) {
            detectedMapping = { ...detectedMapping, ...parsed };
          }
        } catch { } // Ignorar erro de parse
      }

      setColumnMapping(detectedMapping);
      setIsProcessing(false);
      
      setTimeout(() => {
        setShowColumnMappingModal(true);
      }, 100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Erro ao processar o arquivo CSV: ${errorMessage}`);
      setIsProcessing(false);
    }
  };

  const processCSVWithMapping = async (rows: Record<string, string>[], mapping: ColumnMapping) => {
    setIsProcessing(true);
    setShowColumnMappingModal(false);

    try {
      localStorage.setItem('etiquetas_column_mapping', JSON.stringify(mapping));

      const filtered = rows
        .filter(row => {
          const productName = row[mapping.productName] || '';
          const status = row[mapping.status] || '';
          const isPhysical = isPhysicalProduct(productName);
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

      const transactionIds = filtered.map(s => s.transaction);
      const existingLabels = await fetchExistingLabels(transactionIds);

      const withLabels = filtered.map(sale => {
        const existingData = existingLabels.get(sale.transaction);
        if (existingData) {
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
        return {
          ...sale,
          enviosTotal: 1,
          enviosRealizados: 0,
        };
      });

      const savedMerges = await loadSavedMerges();
      let finalSales: PhysicalSale[] = [...withLabels];

      for (const merge of savedMerges) {
        const originalTransactions = merge.originalSales.map(s => s.transaction);
        const presentTransactions = originalTransactions.filter(
          transId => finalSales.some(s => s.transaction === transId)
        );

        if (presentTransactions.length > 0) {
          const salesToMerge = finalSales.filter(s =>
            originalTransactions.includes(s.transaction)
          );

          if (salesToMerge.length > 0) {
            const baseSale = salesToMerge[0];
            const mergedId = merge.mergeId;
            const allProducts = merge.originalSales.map(s => s.productName);
            const allProductCodes = merge.originalSales.map(s => s.productCode);

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

            finalSales = [
              ...finalSales.filter(s => !originalTransactions.includes(s.transaction)),
              mergedSale,
            ];
          }
        }
      }

      setPhysicalSales(finalSales);
    } catch (err) {
      console.error('[CSV] ERRO em processCSVWithMapping:', err);
      setError('Erro ao processar o arquivo CSV');
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmColumnMapping = () => {
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

  const updateMapping = (fieldKey: string, csvColumn: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [fieldKey]: csvColumn,
    }));
  };

  const clearSavedMapping = () => {
    localStorage.removeItem('etiquetas_column_mapping');
    setColumnMapping(autoDetectMapping(csvColumns));
  };

  const handleFileWithTemplate = async (file: File, template: MappingTemplate) => {
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

      const templateMapping = template.mapping;
      const allFieldsValid = FIELD_DEFINITIONS.every(field => {
        const csvColumn = templateMapping[field.key];
        return csvColumn && columns.includes(csvColumn);
      });

      if (allFieldsValid) {
        setColumnMapping(templateMapping);
        setIsProcessing(false);
        processCSVWithMapping(rows, templateMapping);
      } else {
        const detected = autoDetectMapping(columns);
        const merged = { ...detected };
        for (const [key, value] of Object.entries(templateMapping)) {
          if (columns.includes(value)) {
            merged[key] = value;
          }
        }
        setColumnMapping(merged);
        setIsProcessing(false);
        setShowIncompatibleModal(true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Erro ao processar o arquivo CSV: ${errorMessage}`);
      setIsProcessing(false);
    }
  };

  const allFieldsMapped = FIELD_DEFINITIONS.filter(f => f.required).every(
    field => columnMapping[field.key] && csvColumns.includes(columnMapping[field.key])
  );

  const handleSaveTemplate = () => {
    if (!newTemplateName.trim()) {
      setError('Digite um nome para o modelo');
      return;
    }
    if (!allFieldsMapped) {
      const unmapped = FIELD_DEFINITIONS.filter(
        field => field.required && (!columnMapping[field.key] || !csvColumns.includes(columnMapping[field.key]))
      );
      setError(`Campos obrigatórios não mapeados: ${unmapped.map(f => f.label).join(', ')}`);
      return;
    }
    setShowSaveAndProcessModal(true);
  };

  const confirmSaveAndProcess = async () => {
    setIsSavingTemplate(true);
    try {
      const id = await saveMappingTemplate(newTemplateName.trim(), columnMapping, newTemplateLogo || undefined);
      setMappingTemplates(prev => [...prev, {
        id,
        name: newTemplateName.trim(),
        logo: newTemplateLogo || undefined,
        mapping: columnMapping,
      }].sort((a, b) => a.name.localeCompare(b.name)));

      setNewTemplateName('');
      setNewTemplateLogo('');
      setShowSaveTemplateModal(false);
      setShowSaveAndProcessModal(false);
      setShowColumnMappingModal(false);

      processCSVWithMapping(csvData, columnMapping);
    } catch (err) {
      setError('Erro ao salvar modelo');
      console.error(err);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const cancelSaveAndProcess = () => {
    setShowSaveAndProcessModal(false);
  };

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

  const toggleSelectAll = () => {
    const filteredIds = new Set(filteredSales.map(s => s.transaction));
    const allFilteredSelected = filteredSales.length > 0 && filteredSales.every(s => s.selected);
    setPhysicalSales(physicalSales.map(s =>
      filteredIds.has(s.transaction) ? { ...s, selected: !allFilteredSelected } : s
    ));
  };

  const toggleSelect = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, selected: !s.selected } : s
    ));
  };

  const updateEnviosTotal = (transaction: string, newTotal: number) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, enviosTotal: newTotal } : s
    ));
  };

  const incrementEnviosTotal = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, enviosTotal: s.enviosTotal + 1 } : s
    ));
  };

  const handleMergePedidos = () => {
    const selectedItems = physicalSales.filter(s => s.selected && !s.mergedInto && !s.isMerged);
    const selectedMerged = physicalSales.filter(s => s.selected && s.isMerged);
    
    if (selectedMerged.length > 0) {
      alert('Não é possível mesclar pedidos que já foram mesclados.\n\nDesfaça a mesclagem primeiro se quiser reorganizar os pedidos.');
      return;
    }

    if (selectedItems.length < 2) return;

    const normalizeStr = (s: string) => s.toLowerCase().trim();
    const normalizeAddress = (sale: PhysicalSale) =>
      `${normalizeStr(sale.address)}|${normalizeStr(sale.number || '')}|${normalizeStr(sale.zip || '')}`;

    const emails = [...new Set(selectedItems.map(s => normalizeStr(s.email)))];
    const names = [...new Set(selectedItems.map(s => normalizeStr(s.name)))];
    const addresses = [...new Set(selectedItems.map(s => normalizeAddress(s)))];

    const sameEmail = emails.length === 1;
    const sameName = names.length === 1;
    const sameAddress = addresses.length === 1;

    if (!sameEmail || !sameName || !sameAddress) {
      const errors: string[] = [];
      if (!sameEmail) errors.push('E-mails diferentes');
      if (!sameName) errors.push('Nomes diferentes');
      if (!sameAddress) errors.push('Endereços diferentes');
      alert(`Não é possível mesclar estes pedidos:\n\n${errors.join('\n')}\n\nPara mesclar, os pedidos devem ter o mesmo e-mail, nome e endereço.`);
      return;
    }

    const hasGenerated = selectedItems.some(s => s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial');
    const hasPending = selectedItems.some(s => s.etiquetaStatus === 'pending');

    if (hasGenerated && hasPending) {
      setPendingMerge(selectedItems);
      setShowMergeStatusModal(true);
      return;
    }

    executeMerge(selectedItems, hasGenerated ? 'use_existing' : 'generate_new');
  };

  const executeMerge = async (pedidosToMerge: PhysicalSale[], statusChoice: 'use_existing' | 'generate_new' = 'generate_new') => {
    if (pedidosToMerge.length < 2) return;

    const baseSale = pedidosToMerge[0];
    const getFirstNonEmpty = (values: (string | undefined)[]): string => values.find(v => v && v.trim() !== '') || '';

    const combinedPhone = getFirstNonEmpty(pedidosToMerge.map(s => s.phone));
    const combinedDocument = getFirstNonEmpty(pedidosToMerge.map(s => s.document));
    const combinedComplement = getFirstNonEmpty(pedidosToMerge.map(s => s.complement));

    const mostRecentDate = pedidosToMerge.reduce((latest, sale) => {
      const saleTime = parseDate(sale.saleDate);
      const latestTime = parseDate(latest);
      return saleTime > latestTime ? sale.saleDate : latest;
    }, pedidosToMerge[0].saleDate);

    const originalSalesData: OriginalSaleData[] = pedidosToMerge.map(s => ({
      transaction: s.transaction,
      productName: s.productName,
      productCode: s.productCode,
      totalPrice: s.totalPrice,
      document: s.document,
      saleDate: s.saleDate,
      phone: s.phone,
      country: s.country,
      servicoEct: s.servicoEct,
      etiquetaStatus: s.etiquetaStatus,
      etiqueta: s.etiqueta,
      etiquetas: s.etiquetas,
      enviosTotal: s.enviosTotal,
      enviosRealizados: s.enviosRealizados,
    }));

    const allTransactions = pedidosToMerge.map(s => s.transaction);
    const allProducts = pedidosToMerge.map(s => s.productName);
    const allProductCodes = pedidosToMerge.map(s => s.productCode);

    const mergedId = await saveMergeToFirebase(originalSalesData);
    if (!mergedId) return;

    let mergedStatus: 'pending' | 'generated' | 'partial' = 'pending';
    let mergedEtiqueta: string | undefined;
    let mergedEtiquetas: string[] | undefined;
    let mergedEnviosRealizados = 0;

    if (statusChoice === 'use_existing') {
      const generatedItem = pedidosToMerge.find(s => s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial');
      if (generatedItem) {
        mergedStatus = generatedItem.etiquetaStatus as 'generated' | 'partial';
        mergedEtiqueta = generatedItem.etiqueta;
        mergedEtiquetas = generatedItem.etiquetas;
        mergedEnviosRealizados = generatedItem.enviosRealizados;
      }
    }

    const mergedSale: PhysicalSale = {
      ...baseSale,
      transaction: mergedId,
      productName: allProducts.join('\n'),
      productCode: allProductCodes.join(','),
      phone: combinedPhone,
      document: combinedDocument,
      complement: combinedComplement,
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

    setPhysicalSales(prev => {
      const withoutOriginals = prev.filter(s => !allTransactions.includes(s.transaction));
      const newList = [...withoutOriginals, mergedSale];
      return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
    });

    setShowMergeWarningModal(false);
    setShowMergeStatusModal(false);
    setPendingMerge([]);
  };

  const confirmMerge = () => {
    executeMerge(pendingMerge);
  };

  const cancelMerge = () => {
    setShowMergeWarningModal(false);
    setPendingMerge([]);
  };

  const unmergePedido = async (mergedId: string) => {
    const mergedSale = physicalSales.find(s => s.transaction === mergedId);
    if (!mergedSale) return;

    await removeMergeFromFirebase(mergedId);

    setPhysicalSales(prev => {
      const merged = prev.find(s => s.transaction === mergedId);
      if (!merged) return prev.filter(s => s.transaction !== mergedId);

      if (merged.mergedOriginalSales && merged.mergedOriginalSales.length > 0) {
        const originalSales: PhysicalSale[] = merged.mergedOriginalSales.map(original => ({
          ...merged,
          transaction: original.transaction,
          productName: original.productName,
          productCode: original.productCode,
          totalPrice: original.totalPrice,
          document: original.document,
          saleDate: original.saleDate,
          phone: original.phone || merged.phone,
          country: original.country || merged.country,
          servicoEct: original.servicoEct || merged.servicoEct,
          etiquetaStatus: original.etiquetaStatus || 'pending',
          etiqueta: original.etiqueta,
          etiquetas: original.etiquetas,
          enviosTotal: original.enviosTotal ?? 1,
          enviosRealizados: original.enviosRealizados ?? 0,
          isMerged: false,
          mergedTransactions: undefined,
          mergedProductNames: undefined,
          mergedOriginalSales: undefined,
          selected: false,
        }));
        const newList = [...prev.filter(s => s.transaction !== mergedId), ...originalSales];
        return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
      }

      if (merged.mergedTransactions && merged.mergedProductNames) {
        const originalSales: PhysicalSale[] = merged.mergedTransactions.map((transId, index) => ({
          ...merged,
          transaction: transId,
          productName: merged.mergedProductNames?.[index] || merged.productName,
          productCode: merged.productCode.split(',')[index] || merged.productCode,
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
        return newList.sort((a, b) => parseDate(b.saleDate) - parseDate(a.saleDate));
      }

      return prev.filter(s => s.transaction !== mergedId);
    });
  };

  const getServicoName = (code: string) => {
    return SERVICOS_ECT.find(s => s.code === code)?.name || code;
  };

  const selectedCount = physicalSales.filter(s =>
    s.selected && !s.mergedInto && (
      s.etiquetaStatus === 'pending' ||
      (s.etiquetaStatus === 'partial' && s.enviosRealizados < s.enviosTotal)
    )
  ).length;
  const alreadyGeneratedCount = physicalSales.filter(s => s.etiquetaStatus === 'generated' && !s.mergedInto).length;
  const selectedGeneratedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && !s.mergedInto).length;
  const partialCount = physicalSales.filter(s => s.etiquetaStatus === 'partial' && !s.mergedInto).length;
  const selectedForMerge = physicalSales.filter(s =>
    s.selected && !s.mergedInto && !s.isMerged &&
    (s.etiquetaStatus === 'pending' || s.etiquetaStatus === 'generated' || s.etiquetaStatus === 'partial')
  ).length;

  const handleExportTrackingCSV = () => {
    const selectedSales = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);
    if (selectedSales.length === 0) return;

    const header = 'Código da compra,Data da compra,Produto,Responsável pela entrega,Código de rastreio,Status de envio,Link de rastreio';
    const rows: string[] = [];

    selectedSales.forEach(sale => {
      const codigoRastreio = sale.etiqueta || '';
      const statusEnvio = 'Enviado';
      const linkRastreio = 'https://rastreamento.correios.com.br';
      const responsavel = 'Envio Próprio';
      const dataCompra = sale.saleDate.split(' ')[0];

      if (sale.isMerged && sale.mergedTransactions && sale.mergedTransactions.length > 0) {
        sale.mergedTransactions.forEach((transactionId, idx) => {
          const originalSale = physicalSales.find(s => s.transaction === transactionId);
          const produtoNome = sale.mergedProductNames?.[idx] || sale.productName;
          const produto = `"${produtoNome.replace(/"/g, '""')}"`;
          const data = originalSale?.saleDate.split(' ')[0] || dataCompra;
          rows.push(`${transactionId},${data},${produto},${responsavel},${codigoRastreio},${statusEnvio},${linkRastreio}`);
        });
      } else {
        const produto = `"${sale.productName.replace(/"/g, '""')}"`;
        rows.push(`${sale.transaction},${dataCompra},${produto},${responsavel},${codigoRastreio},${statusEnvio},${linkRastreio}`);
      }
    });

    const csvContent = [header, ...rows].join('\n');
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
    // (Mantido, mas agora pode usar a função reutilizável se quiser)
    // ...
  };

  const executeGeneration = async (
    toGenerate: PhysicalSale[],
    observacoes: Record<string, string> = {},
    ordem: 'antigos' | 'novos' = 'antigos',
    obsGeral: string = ''
  ) => {
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);
    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    const etiquetasNovas: any[] = [];
    const todasEtiquetasParaPdf: string[] = alreadyGenerated.map(s => s.etiqueta as string);
    const etiquetasJaGeradas = alreadyGenerated.map(sale => ({
      codigo: sale.etiqueta || '',
      transactionId: sale.transaction,
      produto: sale.productName,
      dataPedido: sale.saleDate,
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
      envioNumero: sale.enviosRealizados || 1,
      enviosTotal: sale.enviosTotal || 1,
      isEnvioParcial: (sale.enviosTotal || 1) > 1,
      observacaoEnvio: observacoes[sale.transaction] || '',
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
          const response = await fetch('/api/vipp/postar-objeto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionId: sale.transaction,
              servicoEct: selectedServicoEct,
              useTestCredentials,
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
            const envioNumero = sale.enviosRealizados + 1;
            const novoEnviosRealizados = envioNumero;
            const novoStatus = novoEnviosRealizados >= sale.enviosTotal ? 'generated' : 'partial';

            await saveLabel(
              sale.transaction,
              result.etiqueta,
              sale.name,
              envioNumero,
              sale.enviosTotal,
              sale.mergedTransactions,
              sale.mergedProductNames,
              observacoes[sale.transaction],
              sale.productName,
              selectedServicoEct,
              sale.zip,
              // Dados completos do destinatário para permitir reenvio futuro
              {
                nome: sale.name,
                documento: sale.document,
                email: sale.email,
                telefone: sale.phone,
                logradouro: sale.address,
                numero: sale.number || 'S/N',
                complemento: sale.complement,
                bairro: sale.neighborhood,
                cidade: sale.city,
                uf: sale.state,
                cep: sale.zip?.replace(/\D/g, '') || '',
              }
            );

            etiquetasNovas.push({
              codigo: result.etiqueta,
              transactionId: sale.transaction,
              produto: sale.productName,
              dataPedido: sale.saleDate,
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
              envioNumero: novoEnviosRealizados,
              enviosTotal: sale.enviosTotal,
              isEnvioParcial: sale.enviosTotal > 1,
              observacaoEnvio: observacoes[sale.transaction] || '',
              ...(sale.isMerged && {
                isMerged: true,
                mergedTransactionIds: sale.mergedTransactions,
                produtos: sale.mergedProductNames,
              }),
            });

            todasEtiquetasParaPdf.push(result.etiqueta);

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
            s.transaction === sale.transaction ? { ...s, etiquetaStatus: 'error' } : s
          ));
          errorCount++;
        }
        setGenerationProgress(prev => ({ ...prev, success: successCount, errors: errorCount }));
        if (i < toGenerate.length - 1) await new Promise(r => setTimeout(r, 1000));
      }
      setIsGenerating(false);
    }

    setPhysicalSales(prev => prev.map(s => s.etiquetaStatus === 'generated' ? { ...s, selected: false } : s));

    // Webhook (Simplificado para o exemplo, mas mantendo a lógica de envio)
    if (sendToN8n && (etiquetasNovas.length > 0 || etiquetasJaGeradas.length > 0)) {
        try {
            const webhookPayload = {
                etiquetas: etiquetasNovas,
                etiquetasAdmin: [...etiquetasNovas, ...etiquetasJaGeradas], // Simplified combination
                config: {
                    adminPhone,
                    clientPhoneOverride: clientPhoneOverride || undefined,
                    sendClientNotification: false,
                    ordemPrioridade: ordem,
                    observacaoGeral: obsGeral || undefined,
                    useTestCredentials,
                }
            };
            fetch('/api/webhook/etiquetas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookPayload),
            }).catch(e => console.error('Webhook error', e));
        } catch (e) { console.error(e); }
    }

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
          
          // Nome do arquivo personalizado
          let filename = `etiquetas-${Date.now()}.pdf`;
          
          if (todasEtiquetasParaPdf.length === 1) {
            // Tenta encontrar os detalhes da etiqueta para nomear melhor
            const etiqueta = todasEtiquetasParaPdf[0];
            
            // Busca na lista de toGenerate (recém gerada)
            let sale = toGenerate.find(s => s.transaction && (!s.etiqueta || s.etiqueta === etiqueta)); 
            
            // Se não achou (já era gerada), busca em alreadyGenerated
            if (!sale) {
                sale = alreadyGenerated.find(s => s.etiqueta === etiqueta);
            }
            
            // Se ainda não achou, pode estar no physicalSales geral que acabou de ser atualizado
            if (!sale) {
                sale = physicalSales.find(s => s.etiqueta === etiqueta);
            }

            if (sale) {
                const safeName = sale.name.replace(/[^a-zA-Z0-9]/g, '_');
                filename = `${sale.transaction}_${etiqueta}_${safeName}.pdf`;
            }
          } else {
             filename = `Lote_Etiquetas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
          }

          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
            const res = await response.json();
            if (res.downloadUrl) window.open(res.downloadUrl, '_blank');
        }
      } catch (err) {
        alert(`Etiquetas geradas. Erro ao baixar PDF: ${err}`);
      }
    }
  };

  const handleGenerateLabels = () => {
    const toGenerate = physicalSales.filter(s =>
      s.selected && (s.etiquetaStatus === 'pending' || (s.etiquetaStatus === 'partial' && s.enviosRealizados < s.enviosTotal))
    );
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    if (toGenerate.length === 0) {
      executeGeneration([], envioObservacoes, ordemPrioridade, observacaoGeral);
      return;
    }

    setPendingGeneration(toGenerate);
    setShowServiceConfirmModal(true);
  };

  const confirmGeneration = () => {
    setShowServiceConfirmModal(false);
    if (needsProductionConfirm || needsClientConfirm) {
      setConfirmEtiquetasText('');
      setConfirmEnviarText('');
      setShowGenerationConfirmModal(true);
    } else {
      executeGeneration(pendingGeneration, envioObservacoes, ordemPrioridade, observacaoGeral);
      setPendingGeneration([]);
      setEnvioObservacoes({});
      setOrdemPrioridade('antigos');
      setObservacaoGeral('');
    }
  };

  const isConfirmationValid = () => {
    const etiquetasOk = !needsProductionConfirm || confirmEtiquetasText.toLowerCase() === 'etiquetas';
    const enviarOk = !needsClientConfirm || confirmEnviarText.toLowerCase() === 'enviar';
    return etiquetasOk && enviarOk;
  };

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

  const handleFileFromModal = (file: File, template?: MappingTemplate) => {
    setShowImportModal(false);
    if (template) {
      handleFileWithTemplate(file, template);
    } else {
      handleFile(file);
    }
  };

  // --- RENDERIZAÇÃO ---

  // Modo Padrão: Histórico (se não tiver vendas carregadas e não estiver no meio do mapeamento)
  if (physicalSales.length === 0 && !showColumnMappingModal) {
    return (
      <div className="w-full max-w-6xl mx-auto">
        <EtiquetasHistory onImportClick={() => setShowImportModal(true)} />

        <ImportModal 
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onFileSelected={handleFileFromModal}
          mappingTemplates={mappingTemplates}
          isLoadingTemplates={isLoadingTemplates}
          onTemplatesChange={setMappingTemplates}
        />

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#DC2626' }}>
              {error}
            </p>
          </div>
        )}

        <ConfigModal
          isOpen={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          useTestCredentials={useTestCredentials}
          setUseTestCredentials={setUseTestCredentials}
          sendToN8n={sendToN8n}
          setSendToN8n={setSendToN8n}
          adminPhone={adminPhone}
          setAdminPhone={setAdminPhone}
          clientPhoneOverride={clientPhoneOverride}
          setClientPhoneOverride={setClientPhoneOverride}
          selectedServicoEct={selectedServicoEct}
          setSelectedServicoEct={setSelectedServicoEct}
          onSave={handleSaveSettings}
        />
      </div>
    );
  }

  // Modo Área de Trabalho (quando tem vendas carregadas)
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={resetUpload}
            className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 mb-2 font-medium transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Voltar ao Histórico
          </button>
          <h2 className="text-xl font-semibold text-slate-800 font-public-sans">
            Área de Trabalho ({filteredSales.length} pedidos)
          </h2>
          <p className="text-sm text-slate-500 font-inter">
            {fileName ? `Arquivo: ${fileName}` : 'Gerencie seus pedidos importados'}
          </p>
        </div>

        <button
          onClick={() => setShowConfigModal(true)}
          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          title="Configurações"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-700 font-inter">{error}</p>
        </div>
      )}

      {/* Barra de Filtros e Ações */}
      <div className="mb-6 flex flex-wrap gap-4 items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {[ 
            { id: 'all', label: 'Todos' },
            { id: 'pending', label: 'Pendente' },
            { id: 'partial', label: 'Parcial', count: partialCount },
            { id: 'generated', label: 'Gerado' },
            { id: 'merge', label: 'Mesclar', count: mergeFilterCount }
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => handleFilterChange(filter.id as any)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${statusFilter === filter.id ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}
            >
              {filter.label}
              {filter.count !== undefined && filter.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusFilter === filter.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                  {filter.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 ml-auto flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <div className="relative group w-full sm:w-64">
            <input
              type="text"
              className="block w-full pl-3 pr-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
              placeholder="Buscar..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          {statusFilter === 'merge' && (
            <button
              onClick={handleMergePedidos}
              disabled={selectedForMerge < 2}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${selectedForMerge >= 2 ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
            >
              Mesclar ({selectedForMerge})
            </button>
          )}

          {statusFilter !== 'merge' && (
            <button
              onClick={handleGenerateLabels}
              disabled={selectedCount === 0 && selectedGeneratedCount === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${selectedCount > 0 || selectedGeneratedCount > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
            >
              {isGenerating ? 'Gerando...' : (selectedGeneratedCount > 0 && selectedCount === 0 ? `Imprimir (${selectedGeneratedCount})` : `Gerar (${selectedCount})`)}
            </button>
          )}
          
          {statusFilter !== 'merge' && (
            <button
              onClick={handleExportTrackingCSV}
              disabled={selectedGeneratedCount === 0}
              className={`p-2 rounded-lg transition-colors border ${selectedGeneratedCount > 0 ? 'bg-white text-green-600 border-green-200 hover:bg-green-50' : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'}`}
              title="Exportar CSV"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tabela de Vendas */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredSales.length > 0 && filteredSales.every(s => s.selected)}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Endereço</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Envios</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-inter">
                    Nenhum pedido encontrado.
                  </td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr 
                    key={sale.transaction} 
                    className={`hover:bg-slate-50 transition-colors ${sale.selected ? 'bg-blue-50/30' : ''} ${sale.isMerged ? 'bg-purple-50/20' : ''}`}
                    onClick={() => toggleSelect(sale.transaction)}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={sale.selected}
                        onChange={() => toggleSelect(sale.transaction)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-inter whitespace-nowrap">
                      {parseDate(sale.saleDate) ? new Date(parseDate(sale.saleDate)).toLocaleDateString('pt-BR') : sale.saleDate}
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{sale.transaction}</div>
                      {sale.isMerged && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 mt-1">Mesclado</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 font-inter">
                      <div className="font-medium">{sale.name}</div>
                      <div className="text-xs text-slate-500">{sale.email}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-inter max-w-[200px]" title={sale.productName}>
                      <div className="truncate">{sale.productName.split('\n')[0]}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-inter max-w-[200px]">
                      <div className="truncate">{sale.address}, {sale.number}</div>
                      <div className="text-xs text-slate-500">{sale.city}/{sale.state}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {sale.etiquetaStatus === 'generated' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Gerada</span>
                      ) : sale.etiquetaStatus === 'partial' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Parcial</span>
                      ) : sale.etiquetaStatus === 'error' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Erro</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Pendente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-sm font-medium text-slate-700">{sale.enviosRealizados || 0}/{sale.enviosTotal || 1}</span>
                        {sale.etiquetaStatus === 'pending' || (sale.etiquetaStatus === 'partial' && sale.enviosRealizados < sale.enviosTotal) ? (
                          <div className="flex items-center">
                            <button onClick={() => updateEnviosTotal(sale.transaction, Math.max(1, sale.enviosTotal - 1))} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded">-</button>
                            <button onClick={() => updateEnviosTotal(sale.transaction, (sale.enviosTotal || 1) + 1)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded">+</button>
                          </div>
                        ) : (
                          <button onClick={() => incrementEnviosTotal(sale.transaction)} className="w-5 h-5 opacity-0 hover:opacity-100 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded">+</button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {sale.isMerged ? (
                         <button onClick={() => confirm('Desfazer mesclagem?') && unmergePedido(sale.transaction)} className="text-purple-600 hover:text-purple-800 text-xs font-medium">Desfazer</button>
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modais de Ação */}
      <ConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        useTestCredentials={useTestCredentials}
        setUseTestCredentials={setUseTestCredentials}
        sendToN8n={sendToN8n}
        setSendToN8n={setSendToN8n}
        adminPhone={adminPhone}
        setAdminPhone={setAdminPhone}
        clientPhoneOverride={clientPhoneOverride}
        setClientPhoneOverride={setClientPhoneOverride}
        selectedServicoEct={selectedServicoEct}
        setSelectedServicoEct={setSelectedServicoEct}
        onSave={handleSaveSettings}
      />

      <ColumnMappingModal
        isOpen={showColumnMappingModal}
        csvColumns={csvColumns}
        columnMapping={columnMapping}
        onUpdateMapping={updateMapping}
        onClearMapping={clearSavedMapping}
        onCancel={() => { setShowColumnMappingModal(false); resetUpload(); }}
        onConfirm={confirmColumnMapping}
        // Save template state
        showSaveTemplateModal={showSaveTemplateModal}
        setShowSaveTemplateModal={setShowSaveTemplateModal}
        newTemplateName={newTemplateName}
        setNewTemplateName={setNewTemplateName}
        newTemplateLogo={newTemplateLogo}
        setNewTemplateLogo={setNewTemplateLogo}
        isSavingTemplate={isSavingTemplate}
        allFieldsMapped={allFieldsMapped}
        onSaveTemplate={handleSaveTemplate}
      />

      <SaveAndProcessModal
        isOpen={showSaveAndProcessModal}
        onCancel={cancelSaveAndProcess}
        onConfirm={confirmSaveAndProcess}
        templateName={newTemplateName}
        isSaving={isSavingTemplate}
      />

      <GenerationConfirmModal
        isOpen={showGenerationConfirmModal}
        onClose={() => setShowGenerationConfirmModal(false)}
        onConfirm={handleConfirmGeneration}
        needsProductionConfirm={needsProductionConfirm}
        needsClientConfirm={needsClientConfirm}
        confirmEtiquetasText={confirmEtiquetasText}
        setConfirmEtiquetasText={setConfirmEtiquetasText}
        confirmEnviarText={confirmEnviarText}
        setConfirmEnviarText={setConfirmEnviarText}
        ordemPrioridade={ordemPrioridade}
        setOrdemPrioridade={setOrdemPrioridade}
        observacaoGeral={observacaoGeral}
        setObservacaoGeral={setObservacaoGeral}
        envioObservacoes={envioObservacoes}
        setEnvioObservacoes={setEnvioObservacoes}
        pendingGeneration={pendingGeneration}
        sendToN8n={sendToN8n}
        clientPhoneOverride={clientPhoneOverride}
        isConfirmationValid={isConfirmationValid}
      />

      <ServiceConfirmModal
        isOpen={showServiceConfirmModal}
        onClose={() => setShowServiceConfirmModal(false)}
        onConfirm={confirmGeneration}
        selectedServicoEct={selectedServicoEct}
        pendingGeneration={pendingGeneration}
        ordemPrioridade={ordemPrioridade}
        setOrdemPrioridade={setOrdemPrioridade}
        observacaoGeral={observacaoGeral}
        setObservacaoGeral={setObservacaoGeral}
        envioObservacoes={envioObservacoes}
        setEnvioObservacoes={setEnvioObservacoes}
      />

      <MergeWarningModal
        isOpen={showMergeWarningModal}
        onCancel={cancelMerge}
        onConfirm={confirmMerge}
        pendingMerge={pendingMerge}
      />

      <MergeStatusModal
        isOpen={showMergeStatusModal}
        onClose={() => { setShowMergeStatusModal(false); setPendingMerge([]); }}
        onUseExisting={() => executeMerge(pendingMerge, 'use_existing')}
        onGenerateNew={() => executeMerge(pendingMerge, 'generate_new')}
        pendingMerge={pendingMerge}
      />

      <IncompatibleModal
        isOpen={showIncompatibleModal}
        template={selectedTemplate}
        onCancel={handleIncompatibleCancel}
        onCreateNew={handleIncompatibleCreateNew}
      />
    </div>
  );
}
