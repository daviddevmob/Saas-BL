'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, limit, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import Image from 'next/image';
import {
  IntegrationTemplate,
  IntegrationMapping,
  AVAILABLE_STAGES,
  REQUIRED_MAPPING_FIELDS,
  OPTIONAL_MAPPING_FIELDS,
  FIELD_LABELS,
  fetchIntegrationTemplates,
  saveIntegrationTemplate,
  updateIntegrationTemplate,
  deleteIntegrationTemplate,
  validateMapping,
  autoDetectColumns,
} from '@/lib/integrationTemplates';
import Papa from 'papaparse';

interface JobData {
  id: string;
  tipo: string;
  status: 'pendente' | 'processando' | 'concluido' | 'erro' | 'cancelado';
  plataforma: string;
  arquivo: string;
  total: number;
  totalOriginal: number;
  processados: number;
  sucessos: number;
  erros: number;
  ignorados: number;
  ultimoIndice?: number; // Para retomada em caso de travamento
  criadoEm: string;
  atualizadoEm: string;
  mensagem: string;
  errosDetalhes: Array<{ email: string; name: string; error: string }>;
}

interface Platform {
  id: string;
  name: string;
  color: string;
  iconColor: string;
  logo: string;
}

const PLATFORMS: Platform[] = [
  { id: 'hubla', name: 'Hubla', color: '#9333EA', iconColor: 'rgba(147, 51, 234, 0.1)', logo: '/lojas/hubla.jpeg' },
  { id: 'hotmart', name: 'Hotmart', color: '#F97316', iconColor: 'rgba(249, 115, 22, 0.1)', logo: '/lojas/hotmart.jpeg' },
  { id: 'eduzz', name: 'Eduzz', color: '#3B82F6', iconColor: 'rgba(59, 130, 246, 0.1)', logo: '/lojas/eduzz.jpg' },
  { id: 'kiwify', name: 'Kiwify', color: '#22C55E', iconColor: 'rgba(34, 197, 94, 0.1)', logo: '/lojas/kiwwify.png' },
  { id: 'woo', name: 'WooCommerce', color: '#7C3AED', iconColor: 'rgba(124, 58, 237, 0.1)', logo: '/lojas/woo.png' },
];

// Documentação das colunas esperadas por plataforma
const CSV_DOCS: Record<string, {
  name: string;
  color: string;
  statusValue: string;
  columns: { field: string; column: string; required: boolean }[];
}> = {
  hubla: {
    name: 'Hubla',
    color: '#9333EA',
    statusValue: 'Paga',
    columns: [
      { field: 'Email', column: 'Email do cliente', required: true },
      { field: 'Nome', column: 'Nome do cliente', required: true },
      { field: 'Telefone', column: 'Telefone do cliente', required: false },
      { field: 'CPF/CNPJ', column: 'Documento do cliente', required: false },
      { field: 'Produto', column: 'Nome do produto', required: false },
      { field: 'ID Transação', column: 'ID da fatura', required: true },
      { field: 'Valor', column: 'Valor total', required: false },
      { field: 'Status', column: 'Status da fatura', required: true },
      { field: 'CEP', column: 'Endereço CEP', required: false },
      { field: 'Endereço', column: 'Endereço Rua', required: false },
      { field: 'Cidade', column: 'Endereço Cidade', required: false },
      { field: 'Estado', column: 'Endereço Estado', required: false },
    ],
  },
  hotmart: {
    name: 'Hotmart',
    color: '#F97316',
    statusValue: 'Aprovado',
    columns: [
      { field: 'Email', column: 'Email', required: true },
      { field: 'Nome', column: 'Nome', required: true },
      { field: 'Telefone', column: 'Telefone Final', required: false },
      { field: 'CPF/CNPJ', column: 'Documento', required: false },
      { field: 'Produto', column: 'Nome do Produto', required: false },
      { field: 'ID Transação', column: 'Transação', required: true },
      { field: 'Valor', column: 'Preço Total', required: false },
      { field: 'Status', column: 'Status', required: true },
      { field: 'CEP', column: 'CEP', required: false },
      { field: 'Endereço', column: 'Endereço', required: false },
      { field: 'Número', column: 'Número', required: false },
      { field: 'Complemento', column: 'Complemento', required: false },
      { field: 'Bairro', column: 'Bairro', required: false },
      { field: 'Cidade', column: 'Cidade', required: false },
      { field: 'Estado', column: 'Estado', required: false },
    ],
  },
  eduzz: {
    name: 'Eduzz',
    color: '#3B82F6',
    statusValue: 'Paga',
    columns: [
      { field: 'Email', column: 'Cliente / E-mail', required: true },
      { field: 'Nome', column: 'Cliente / Nome', required: true },
      { field: 'Telefone', column: 'Cliente / Fones', required: false },
      { field: 'CPF/CNPJ', column: 'Cliente / Documento', required: false },
      { field: 'Produto', column: 'Produto', required: false },
      { field: 'ID Transação', column: 'Fatura', required: true },
      { field: 'Valor', column: 'Valor da Venda', required: false },
      { field: 'Status', column: 'Status', required: true },
      { field: 'CEP', column: 'CEP', required: false },
      { field: 'Endereço', column: 'Endereço', required: false },
      { field: 'Número', column: 'Numero', required: false },
      { field: 'Complemento', column: 'Complemento', required: false },
      { field: 'Bairro', column: 'Bairro', required: false },
      { field: 'Cidade', column: 'Cidade', required: false },
      { field: 'Estado', column: 'UF', required: false },
    ],
  },
  kiwify: {
    name: 'Kiwify',
    color: '#22C55E',
    statusValue: 'paid',
    columns: [
      { field: 'Email', column: 'Email', required: true },
      { field: 'Nome', column: 'Cliente', required: true },
      { field: 'Telefone', column: 'Celular', required: false },
      { field: 'CPF/CNPJ', column: 'CPF / CNPJ', required: false },
      { field: 'Produto', column: 'Produto', required: false },
      { field: 'ID Transação', column: 'ID da venda', required: true },
      { field: 'Valor', column: 'Valor líquido', required: false },
      { field: 'Status', column: 'Status', required: true },
      { field: 'CEP', column: 'CEP', required: false },
      { field: 'Endereço', column: 'Endereço', required: false },
      { field: 'Número', column: 'Numero', required: false },
      { field: 'Complemento', column: 'Complemento', required: false },
      { field: 'Bairro', column: 'Bairro', required: false },
      { field: 'Cidade', column: 'Cidade', required: false },
      { field: 'Estado', column: 'Estado', required: false },
    ],
  },
  woo: {
    name: 'WooCommerce',
    color: '#7C3AED',
    statusValue: 'wc-completed',
    columns: [
      { field: 'Email', column: 'Billing Email Address', required: true },
      { field: 'Nome', column: 'Billing First Name', required: true },
      { field: 'Telefone', column: 'Billing Phone', required: false },
      { field: 'CPF/CNPJ', column: '_billing_cpf', required: false },
      { field: 'Produto', column: 'Product Name #1', required: false },
      { field: 'ID Transação', column: 'Order ID', required: true },
      { field: 'Valor', column: 'Order Total', required: false },
      { field: 'Status', column: 'Order Status', required: true },
      { field: 'CEP', column: 'Billing Postcode', required: false },
      { field: 'Endereço', column: 'Billing Address 1', required: false },
      { field: 'Complemento', column: 'Billing Address 2', required: false },
      { field: 'Bairro', column: '_billing_neighborhood', required: false },
      { field: 'Cidade', column: 'Billing City', required: false },
      { field: 'Estado', column: 'Billing State', required: false },
    ],
  },
};

const JOBS_COLLECTION = 'jobs_importacao';

interface CsvUploadUnifiedProps {
  userEmail?: string;
}

export default function CsvUploadUnified({ userEmail }: CsvUploadUnifiedProps) {
  const [activeJob, setActiveJob] = useState<JobData | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(PLATFORMS[0]);
  const [files, setFiles] = useState<File[]>([]); // Múltiplos arquivos
  const [currentFileIndex, setCurrentFileIndex] = useState(0); // Arquivo atual na fila
  const [isDragging, setIsDragging] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [selectedDocPlatform, setSelectedDocPlatform] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [completedFiles, setCompletedFiles] = useState<string[]>([]); // Arquivos já processados
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  // Estados para templates personalizados
  const [customTemplates, setCustomTemplates] = useState<IntegrationTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [pendingTemplate, setPendingTemplate] = useState<IntegrationTemplate | null>(null);
  const [pendingFixedPlatform, setPendingFixedPlatform] = useState<Platform | null>(null);

  // Modal de mapeamento de colunas
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [mappingForm, setMappingForm] = useState<Partial<IntegrationMapping>>({});
  const [selectedStageId, setSelectedStageId] = useState(AVAILABLE_STAGES[0].id);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [pendingFileForMapping, setPendingFileForMapping] = useState<File | null>(null);

  // Modal de edição de template
  const [showEditModal, setShowEditModal] = useState(false);
  const [templateToEdit, setTemplateToEdit] = useState<IntegrationTemplate | null>(null);
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editStageId, setEditStageId] = useState('');

  // Modal de confirmação de exclusão
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Escutar jobs ativos no Firebase (tempo real)
  useEffect(() => {
    // Query simples sem orderBy para evitar necessidade de índice composto
    const jobsQuery = query(
      collection(db, JOBS_COLLECTION),
      where('status', 'in', ['pendente', 'processando'])
    );

    const unsubscribe = onSnapshot(jobsQuery, (snapshot) => {
      if (!snapshot.empty) {
        // Ordenar no cliente e pegar o mais recente
        const jobs = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id } as JobData))
          .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
        setActiveJob(jobs[0]);
      } else {
        setActiveJob(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // Escutar job específico quando ativo
  useEffect(() => {
    if (!activeJob?.id) return;

    const jobRef = doc(db, JOBS_COLLECTION, activeJob.id);
    const unsubscribe = onSnapshot(jobRef, (snap) => {
      if (snap.exists()) {
        setActiveJob({ ...snap.data(), id: snap.id } as JobData);
      }
    });

    return () => unsubscribe();
  }, [activeJob?.id]);

  const clearJob = async () => {
    if (activeJob?.id) {
      await deleteDoc(doc(db, JOBS_COLLECTION, activeJob.id));
      setActiveJob(null);
    }
  };

  const openCancelModal = () => {
    setCancelConfirmText('');
    setShowCancelModal(true);
  };

  const confirmCancelJob = async () => {
    if (cancelConfirmText !== 'CANCELAR') return;

    if (activeJob?.id && isRunning) {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, JOBS_COLLECTION, activeJob.id), {
        status: 'cancelado',
        atualizadoEm: new Date().toISOString(),
        mensagem: '⛔ Cancelado pelo usuário',
      });
    }
    setShowCancelModal(false);
    setCancelConfirmText('');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isRunning) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles]);
      setError(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []).filter(f => f.name.endsWith('.csv'));
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      setError(null);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Carregar templates personalizados do Firebase
  useEffect(() => {
    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      const templates = await fetchIntegrationTemplates();
      setCustomTemplates(templates);
      setIsLoadingTemplates(false);
    };
    loadTemplates();
  }, []);

  // Processar arquivo CSV e extrair colunas
  const extractCsvColumns = (file: File): Promise<string[]> => {
    return new Promise((resolve) => {
      Papa.parse(file, {
        preview: 1,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            resolve(results.data[0] as string[]);
          } else {
            resolve([]);
          }
        },
        error: () => resolve([]),
      });
    });
  };

  // Handler: Clicar em modelo fixo
  const handleFixedPlatformClick = (platform: Platform) => {
    setPendingFixedPlatform(platform);
    templateFileInputRef.current?.click();
  };

  // Handler: Clicar em modelo personalizado
  const handleCustomTemplateClick = (template: IntegrationTemplate) => {
    setPendingTemplate(template);
    templateFileInputRef.current?.click();
  };

  // Handler: Clicar em "Importar sem modelo"
  const handleImportWithoutModel = () => {
    setPendingFixedPlatform(null);
    setPendingTemplate(null);
    templateFileInputRef.current?.click();
  };

  // Handler: Arquivo selecionado para template/plataforma
  const handleTemplateFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resetar input
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = '';
    }

    if (pendingFixedPlatform) {
      // Modelo fixo: usar fluxo tradicional
      setSelectedPlatform(pendingFixedPlatform);
      setFiles([file]);
      setPendingFixedPlatform(null);
    } else if (pendingTemplate) {
      // Modelo personalizado: validar e processar
      const columns = await extractCsvColumns(file);
      const templateColumns = Object.values(pendingTemplate.mapping).filter(Boolean);
      const missingColumns = templateColumns.filter(col => !columns.includes(col));

      if (missingColumns.length > 0) {
        setError(`Colunas faltando no CSV: ${missingColumns.join(', ')}`);
        setPendingTemplate(null);
        return;
      }

      // Tudo ok, iniciar importação com template
      setFiles([file]);
      // Preparar para importação customizada
      setPendingFileForMapping(file);
      setMappingForm(pendingTemplate.mapping);
      setSelectedStageId(pendingTemplate.stageId);
      // Iniciar importação diretamente
      startImportWithMapping(file, pendingTemplate.mapping, pendingTemplate.stageId);
      setPendingTemplate(null);
    } else {
      // Sem modelo: abrir modal de mapeamento
      const columns = await extractCsvColumns(file);
      setCsvColumns(columns);
      const autoDetected = autoDetectColumns(columns);
      setMappingForm(autoDetected);
      setPendingFileForMapping(file);
      setShowMappingModal(true);
    }
  };

  // Iniciar importação com mapeamento customizado
  const startImportWithMapping = async (file: File, mapping: IntegrationMapping | Partial<IntegrationMapping>, stageId: string) => {
    setIsStarting(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('customMapping', JSON.stringify(mapping));
    formData.append('stageId', stageId);

    try {
      const response = await fetch('/api/import-csv/iniciar', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Erro ao iniciar importação');
      } else {
        setCompletedFiles(prev => [...prev, file.name]);
        setShowMappingModal(false);
        setPendingFileForMapping(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar importação');
    }

    setIsStarting(false);
  };

  // Handler: Confirmar mapeamento e importar
  const handleConfirmMapping = async () => {
    if (!pendingFileForMapping) return;

    const validation = validateMapping(mappingForm);
    if (!validation.valid) {
      setError(`Campos obrigatórios faltando: ${validation.missingFields.join(', ')}`);
      return;
    }

    // Salvar como template se marcado
    if (saveAsTemplate && newTemplateName.trim()) {
      setIsSavingTemplate(true);
      try {
        const templateId = await saveIntegrationTemplate(
          newTemplateName.trim(),
          mappingForm as IntegrationMapping,
          selectedStageId
        );
        const newTemplate: IntegrationTemplate = {
          id: templateId,
          name: newTemplateName.trim(),
          mapping: mappingForm as IntegrationMapping,
          stageId: selectedStageId,
        };
        setCustomTemplates(prev => [...prev, newTemplate].sort((a, b) => a.name.localeCompare(b.name)));
      } catch (e) {
        console.error('Erro ao salvar template:', e);
      }
      setIsSavingTemplate(false);
    }

    // Iniciar importação
    await startImportWithMapping(pendingFileForMapping, mappingForm, selectedStageId);

    // Limpar estados
    setSaveAsTemplate(false);
    setNewTemplateName('');
  };

  // Handler: Abrir modal de edição
  const openEditModal = (template: IntegrationTemplate) => {
    setTemplateToEdit(template);
    setEditTemplateName(template.name);
    setEditStageId(template.stageId);
    setShowEditModal(true);
  };

  // Handler: Salvar edição do template
  const handleSaveEdit = async () => {
    if (!templateToEdit?.id || !editTemplateName.trim()) return;

    try {
      await updateIntegrationTemplate(templateToEdit.id, editTemplateName.trim(), editStageId);
      setCustomTemplates(prev =>
        prev.map(t =>
          t.id === templateToEdit.id
            ? { ...t, name: editTemplateName.trim(), stageId: editStageId }
            : t
        ).sort((a, b) => a.name.localeCompare(b.name))
      );
      setShowEditModal(false);
      setTemplateToEdit(null);
    } catch (e) {
      setError('Erro ao atualizar template');
    }
  };

  // Handler: Abrir modal de exclusão
  const openDeleteModal = () => {
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  };

  // Handler: Confirmar exclusão
  const handleConfirmDelete = async () => {
    if (!templateToEdit?.id || deleteConfirmText !== templateToEdit.name) return;

    try {
      await deleteIntegrationTemplate(templateToEdit.id);
      setCustomTemplates(prev => prev.filter(t => t.id !== templateToEdit.id));
      setShowDeleteModal(false);
      setShowEditModal(false);
      setTemplateToEdit(null);
    } catch (e) {
      setError('Erro ao excluir template');
    }
  };

  // Fechar modal de mapeamento
  const closeMappingModal = () => {
    setShowMappingModal(false);
    setPendingFileForMapping(null);
    setCsvColumns([]);
    setMappingForm({});
    setSaveAsTemplate(false);
    setNewTemplateName('');
  };

  const startImport = async () => {
    if (files.length === 0 || isStarting || isRunning) return;

    const file = files[currentFileIndex];

    setIsStarting(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', selectedPlatform.id);

    try {
      const response = await fetch('/api/import-csv/iniciar', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Erro ao iniciar importação');
        if (data.debug) {
          console.log('Debug:', data.debug);
        }
      } else {
        // Marcar arquivo como iniciado
        setCompletedFiles(prev => [...prev, file.name]);
        // Job será detectado automaticamente pelo onSnapshot
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar importação');
    }

    setIsStarting(false);
  };

  const isRunning = activeJob?.status === 'processando' || activeJob?.status === 'pendente';
  const isCompleted = activeJob?.status === 'concluido';
  const isError = activeJob?.status === 'erro';
  const isCancelled = activeJob?.status === 'cancelado';
  const progress = activeJob?.total ? Math.round((activeJob.processados / activeJob.total) * 100) : 0;

  // Detectar travamento: se o tempo desde a última atualização exceder um limite dinâmico
  const [isStalled, setIsStalled] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  useEffect(() => {
    if (isRunning && activeJob?.atualizadoEm && activeJob?.total > 0) {
      const checkStalled = () => {
        const lastUpdate = new Date(activeJob.atualizadoEm).getTime();
        const now = Date.now();

        // Lógica de cálculo dinâmico
        // Base: 150ms por linha (100ms de delay + 50ms de processamento)
        // Lote: 1% do total de linhas
        // Margem: 100% de segurança (x2)
        // Mínimo: 2 minutos
        const timePerLine = 150; // ms
        const linesPerBatch = activeJob.total / 100;
        const estimatedTimePerBatch = linesPerBatch * timePerLine;
        const dynamicThreshold = estimatedTimePerBatch * 2; // Margem de 100%
        const MINIMUM_THRESHOLD = 2 * 60 * 1000; // 2 minutos

        const stalledThreshold = Math.max(dynamicThreshold, MINIMUM_THRESHOLD);
        
        // console.log(`[Watchdog] Limite dinâmico: ${(stalledThreshold / 60000).toFixed(2)} minutos`);

        setIsStalled(now - lastUpdate > stalledThreshold);
      };

      checkStalled();
      const interval = setInterval(checkStalled, 10000); // Verificar a cada 10s
      return () => clearInterval(interval);
    } else {
      setIsStalled(false);
    }
  }, [isRunning, activeJob?.atualizadoEm, activeJob?.total]);

  // Função para retomar job travado
  const resumeJob = async () => {
    if (!activeJob || files.length === 0 || isResuming) return;

    const file = files[currentFileIndex];
    if (!file) return;

    setIsResuming(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobId', activeJob.id);

    try {
      const response = await fetch('/api/import-csv/retomar', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Erro ao retomar importação');
      } else {
        setIsStalled(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao retomar importação');
    }

    setIsResuming(false);
  };

  // Avançar para próximo arquivo quando job completar
  useEffect(() => {
    if (isCompleted && files.length > 0 && currentFileIndex < files.length - 1) {
      const timer = setTimeout(() => {
        setCurrentFileIndex(prev => prev + 1);
        clearJob();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCompleted, files.length, currentFileIndex, clearJob]);

  return (
    <div
      className="rounded-3xl border border-slate-200 p-8 flex flex-col gap-6"
      style={{
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        width: '100%',
        maxWidth: '700px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 700,
              fontSize: '1.5rem',
              color: '#314158',
              margin: 0,
              marginBottom: '0.25rem',
            }}
          >
            Importar CSV
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
              margin: 0,
            }}
          >
            Sincronize vendas das suas plataformas com o Datacrazy
          </p>
        </div>

        <button
          onClick={() => setShowDocsModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#3B82F6',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Instruções de CSV
        </button>
      </div>

      {/* Progress Section - Running */}
      {isRunning && activeJob && (
        <div
          style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="animate-spin"
                style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid #FDE68A',
                  borderTopColor: '#F59E0B',
                  borderRadius: '50%',
                }}
              />
              <div>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#92400E',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  Importação em andamento
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#B45309',
                    margin: 0,
                  }}
                >
                  {activeJob.plataforma.toUpperCase()} • {activeJob.arquivo}
                </p>
              </div>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.625rem',
                color: '#64748B',
                backgroundColor: '#F1F5F9',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
              }}
            >
              ID: {activeJob.id.substring(0, 8)}
            </span>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              height: '12px',
              backgroundColor: '#FDE68A',
              borderRadius: '6px',
              overflow: 'hidden',
              marginBottom: '0.75rem',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: '#F59E0B',
                borderRadius: '6px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* Progress Info */}
          <div className="flex items-center justify-between mb-3">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#92400E' }}>
              {activeJob.processados} / {activeJob.total}
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#92400E', fontWeight: 600 }}>
              {progress}%
            </span>
          </div>

          {/* Stats */}
          <div className="flex gap-4 flex-wrap mb-3">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#16A34A' }}>
              ✅ {activeJob.sucessos} criados
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
              ⏭️ {activeJob.processados - activeJob.sucessos - activeJob.erros - activeJob.ignorados} existentes
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#DC2626' }}>
              ❌ {activeJob.erros} erros
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#D97706' }}>
              ⚠️ {activeJob.ignorados} ignorados
            </span>
          </div>

          {/* Last message */}
          <p
            style={{
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#64748B',
              backgroundColor: '#FEF3C7',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              margin: 0,
              marginBottom: '0.75rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeJob.mensagem}
          </p>

          {/* Aviso de Travamento */}
          {isStalled && (
            <div
              style={{
                backgroundColor: '#FEE2E2',
                border: '1px solid #FECACA',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                marginBottom: '0.75rem',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#DC2626' }}>
                  Processamento travado
                </span>
              </div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#7F1D1D', margin: 0, marginBottom: '0.5rem' }}>
                Sem atualização há mais de 2 minutos. O servidor pode ter reiniciado.
                {activeJob.ultimoIndice !== undefined && (
                  <> Último registro processado: <strong>{activeJob.ultimoIndice}</strong>.</>
                )}
              </p>
              <button
                onClick={resumeJob}
                disabled={isResuming || files.length === 0}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  backgroundColor: isResuming ? '#94A3B8' : '#F59E0B',
                  border: 'none',
                  borderRadius: '0.375rem',
                  padding: '0.5rem 1rem',
                  cursor: isResuming || files.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {isResuming ? 'Retomando...' : files.length === 0 ? 'Selecione o arquivo para retomar' : 'Retomar do último ponto'}
              </button>
              {files.length === 0 && (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.625rem', color: '#7F1D1D', margin: 0, marginTop: '0.25rem', textAlign: 'center' }}>
                  Arraste o mesmo arquivo CSV novamente para retomar
                </p>
              )}
            </div>
          )}

          {/* Botão Cancelar */}
          <button
            onClick={openCancelModal}
            style={{
              width: '100%',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#DC2626',
              backgroundColor: '#FEE2E2',
              border: '1px solid #FECACA',
              borderRadius: '0.5rem',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Cancelar Importação
          </button>
        </div>
      )}

      {/* Modal de Confirmação de Cancelamento */}
      {showCancelModal && (
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
          onClick={() => setShowCancelModal(false)}
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
                margin: '0 0 0.5rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#DC2626',
              }}
            >
              Cancelar Importação?
            </h3>
            <p
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
              }}
            >
              Esta ação não pode ser desfeita. Os registros já processados serão mantidos.
            </p>
            <p
              style={{
                margin: '0 0 0.75rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#1E293B',
                fontWeight: 500,
              }}
            >
              Digite <strong style={{ color: '#DC2626' }}>CANCELAR</strong> para confirmar:
            </p>
            <input
              type="text"
              value={cancelConfirmText}
              onChange={(e) => setCancelConfirmText(e.target.value.toUpperCase())}
              placeholder="CANCELAR"
              style={{
                width: '100%',
                padding: '0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#DC2626',
                border: cancelConfirmText === 'CANCELAR' ? '2px solid #DC2626' : '1px solid #E2E8F0',
                borderRadius: '0.5rem',
                marginBottom: '1rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowCancelModal(false)}
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
                Voltar
              </button>
              <button
                onClick={confirmCancelJob}
                disabled={cancelConfirmText !== 'CANCELAR'}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: cancelConfirmText === 'CANCELAR' ? '#FFF' : '#9CA3AF',
                  backgroundColor: cancelConfirmText === 'CANCELAR' ? '#DC2626' : '#E5E7EB',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: cancelConfirmText === 'CANCELAR' ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result Section - Completed/Error/Cancelled */}
      {(isCompleted || isError || isCancelled) && activeJob && (
        <div
          style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            backgroundColor: isCompleted ? '#F0FDF4' : isCancelled ? '#FEF3C7' : '#FEF2F2',
            border: `1px solid ${isCompleted ? '#BBF7D0' : isCancelled ? '#FDE68A' : '#FECACA'}`,
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isCompleted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : isCancelled ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: isCompleted ? '#16A34A' : isCancelled ? '#D97706' : '#DC2626',
                }}
              >
                {isCompleted ? 'Importação concluída' : isCancelled ? 'Importação cancelada' : 'Erro na importação'}
              </span>
            </div>
            <button
              onClick={clearJob}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#64748B',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Limpar
            </button>
          </div>

          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
              margin: 0,
              marginBottom: '0.75rem',
            }}
          >
            {activeJob.mensagem}
          </p>

          <div className="flex gap-4 flex-wrap">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#16A34A' }}>
              ✅ {activeJob.sucessos} criados
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
              ⏭️ {activeJob.processados - activeJob.sucessos - activeJob.erros - activeJob.ignorados} existentes
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#DC2626' }}>
              ❌ {activeJob.erros} erros
            </span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
          }}
        >
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {/* Form Section - Only show when not running */}
      {!isRunning && (
        <>
          {/* Input oculto para seleção de arquivo */}
          <input
            ref={templateFileInputRef}
            type="file"
            accept=".csv"
            onChange={handleTemplateFileSelect}
            style={{ display: 'none' }}
          />

          {/* Grid de Cards - Modelos de Importação */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {/* Card: Importar sem modelo */}
            <div
              onClick={handleImportWithoutModel}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '1rem',
                minHeight: '140px',
                borderRadius: '1rem',
                border: '2px dashed #E2E8F0',
                backgroundColor: '#F8FAFC',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#3B82F6';
                e.currentTarget.style.backgroundColor = '#EFF6FF';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#E2E8F0';
                e.currentTarget.style.backgroundColor = '#F8FAFC';
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: '#E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#314158',
                  textAlign: 'center',
                }}
              >
                Importar CSV
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.625rem',
                  color: '#94A3B8',
                  textAlign: 'center',
                }}
              >
                sem modelo
              </span>
            </div>

            {/* Cards dos Modelos Fixos */}
            {PLATFORMS.map(platform => (
              <div
                key={platform.id}
                onClick={() => handleFixedPlatformClick(platform)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '1rem',
                  minHeight: '140px',
                  borderRadius: '1rem',
                  border: `2px solid ${platform.color}20`,
                  backgroundColor: `${platform.color}08`,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = platform.color;
                  e.currentTarget.style.backgroundColor = `${platform.color}15`;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = `${platform.color}20`;
                  e.currentTarget.style.backgroundColor = `${platform.color}08`;
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    backgroundColor: '#FFFFFF',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  }}
                >
                  <Image
                    src={platform.logo}
                    alt={platform.name}
                    width={40}
                    height={40}
                    style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#314158',
                    textAlign: 'center',
                  }}
                >
                  {platform.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.625rem',
                    color: '#94A3B8',
                    textAlign: 'center',
                  }}
                >
                  modelo fixo
                </span>
              </div>
            ))}

            {/* Cards dos Modelos Personalizados */}
            {!isLoadingTemplates && customTemplates.map(template => {
              const stage = AVAILABLE_STAGES.find(s => s.id === template.stageId);
              return (
                <div
                  key={template.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                    minHeight: '140px',
                    borderRadius: '1rem',
                    border: '2px solid #DBEAFE',
                    backgroundColor: '#EFF6FF',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative',
                  }}
                  onClick={() => handleCustomTemplateClick(template)}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = '#3B82F6';
                    e.currentTarget.style.backgroundColor = '#DBEAFE';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = '#DBEAFE';
                    e.currentTarget.style.backgroundColor = '#EFF6FF';
                  }}
                >
                  {/* Botão editar */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(template);
                    }}
                    style={{
                      position: 'absolute',
                      top: '0.5rem',
                      right: '0.5rem',
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: 'rgba(255,255,255,0.8)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Editar modelo"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>

                  {/* Logo do stage */}
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      backgroundColor: '#FFFFFF',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {stage?.logo ? (
                      <Image
                        src={`/lojas/${stage.logo}`}
                        alt={stage.name}
                        width={40}
                        height={40}
                        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                      />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    )}
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#1E40AF',
                      textAlign: 'center',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {template.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.625rem',
                      color: '#64748B',
                      textAlign: 'center',
                    }}
                  >
                    personalizado
                  </span>
                </div>
              );
            })}

            {/* Loading Templates */}
            {isLoadingTemplates && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '1rem',
                  minHeight: '140px',
                  borderRadius: '1rem',
                  border: '2px solid #E2E8F0',
                  backgroundColor: '#F8FAFC',
                }}
              >
                <div
                  className="animate-spin"
                  style={{
                    width: '24px',
                    height: '24px',
                    border: '3px solid #E2E8F0',
                    borderTopColor: '#3B82F6',
                    borderRadius: '50%',
                  }}
                />
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.625rem', color: '#94A3B8' }}>
                  Carregando...
                </span>
              </div>
            )}
          </div>

          {/* Drop Zone - Mostrar apenas quando tem arquivos selecionados */}
          {files.length > 0 && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? '#22D3EE' : files.length > 0 ? '#22C55E' : '#E2E8F0'}`,
              borderRadius: '1rem',
              padding: '1.5rem',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: isDragging ? 'rgba(34, 211, 238, 0.05)' : files.length > 0 ? 'rgba(34, 197, 94, 0.05)' : '#F8FAFC',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {files.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#16A34A' }}>
                    {files.length} arquivo(s) selecionado(s)
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles([]);
                      setCurrentFileIndex(0);
                      setCompletedFiles([]);
                    }}
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      color: '#DC2626',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Limpar todos
                  </button>
                </div>
                <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                  {files.map((file, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.5rem',
                        backgroundColor: index === currentFileIndex ? '#F0FDF4' : '#FFFFFF',
                        borderRadius: '0.5rem',
                        marginBottom: '0.25rem',
                        border: index === currentFileIndex ? '1px solid #22C55E' : '1px solid #E2E8F0',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        {completedFiles.includes(file.name) ? (
                          <span style={{ color: '#16A34A' }}>✓</span>
                        ) : index === currentFileIndex && isRunning ? (
                          <span className="animate-spin" style={{ color: '#F59E0B' }}>⏳</span>
                        ) : (
                          <span style={{ color: '#94A3B8' }}>{index + 1}.</span>
                        )}
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#334155' }}>
                          {file.name}
                        </span>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.625rem', color: '#94A3B8' }}>
                          ({(file.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#DC2626',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0.25rem',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.5rem' }}>
                  Clique para adicionar mais arquivos
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: selectedPlatform.iconColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={selectedPlatform.color}
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '1rem',
                      color: '#314158',
                      margin: 0,
                      marginBottom: '0.25rem',
                      fontWeight: 500,
                    }}
                  >
                    Arraste os arquivos CSV aqui
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#94A3B8',
                      margin: 0,
                    }}
                  >
                    ou clique para selecionar (múltiplos)
                  </p>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Import Button - só mostrar quando tem arquivos */}
          {files.length > 0 && (
          <button
            onClick={startImport}
            disabled={files.length === 0 || isStarting}
            style={{
              width: '100%',
              fontFamily: 'var(--font-inter)',
              fontSize: '1rem',
              fontWeight: 600,
              color: files.length > 0 && !isStarting ? '#FFFFFF' : '#94A3B8',
              backgroundColor: files.length > 0 && !isStarting ? selectedPlatform.color : '#E2E8F0',
              border: 'none',
              borderRadius: '0.75rem',
              padding: '1rem',
              cursor: files.length > 0 && !isStarting ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
          >
            {isStarting ? 'Iniciando...' : files.length > 1 ? `Iniciar Importação (${files.length} arquivos)` : 'Iniciar Importação'}
          </button>
          )}
        </>
      )}

      {/* Error Log */}
      {activeJob?.errosDetalhes && activeJob.errosDetalhes.length > 0 && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '0.75rem',
            padding: '1rem',
          }}
        >
          <h4
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#DC2626',
              margin: 0,
              marginBottom: '0.75rem',
            }}
          >
            Últimos Erros ({activeJob.errosDetalhes.length})
          </h4>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {activeJob.errosDetalhes.map((err, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  paddingBottom: '0.5rem',
                  marginBottom: '0.5rem',
                  borderBottom: i < activeJob.errosDetalhes.length - 1 ? '1px solid #FECACA' : 'none',
                }}
              >
                <span style={{ color: '#DC2626', fontWeight: 500 }}>{err.email}</span>
                <span style={{ color: '#B91C1C', marginLeft: '0.5rem' }}>{err.error.substring(0, 100)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Documentação das Colunas */}
      {showDocsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem',
          }}
          onClick={() => {
            setShowDocsModal(false);
            setSelectedDocPlatform(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxWidth: '800px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do Modal */}
            <div
              style={{
                background: 'linear-gradient(to right, #1E293B, #334155)',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--font-public-sans)',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    margin: 0,
                  }}
                >
                  Formato do CSV por Plataforma
                </h2>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#CBD5E1',
                    margin: 0,
                    marginTop: '0.25rem',
                  }}
                >
                  Verifique as colunas necessárias para importação
                </p>
              </div>
              <button
                onClick={() => {
                  setShowDocsModal(false);
                  setSelectedDocPlatform(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(255, 255, 255, 0.7)',
                  padding: '0.5rem',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Tabs de Plataforma */}
            <div
              style={{
                borderBottom: '1px solid #E2E8F0',
                backgroundColor: '#F8FAFC',
                padding: '0.75rem 1.5rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {Object.entries(CSV_DOCS).map(([key, platform]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedDocPlatform(selectedDocPlatform === key ? null : key)}
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: selectedDocPlatform === key ? '#FFFFFF' : '#64748B',
                      backgroundColor: selectedDocPlatform === key ? platform.color : '#FFFFFF',
                      border: selectedDocPlatform === key ? 'none' : '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                      padding: '0.5rem 1rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      transform: selectedDocPlatform === key ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    {platform.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Conteúdo */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {!selectedDocPlatform ? (
                <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      backgroundColor: '#F1F5F9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 1rem',
                    }}
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <h3
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '1.125rem',
                      fontWeight: 500,
                      color: '#334155',
                      margin: 0,
                      marginBottom: '0.5rem',
                    }}
                  >
                    Selecione uma plataforma
                  </h3>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#64748B',
                      margin: 0,
                    }}
                  >
                    Clique em uma das plataformas acima para ver as colunas necessárias
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Info do Status */}
                  <div
                    style={{
                      backgroundColor: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: '0.75rem',
                      padding: '1rem',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div>
                      <h4
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#92400E',
                          margin: 0,
                          marginBottom: '0.25rem',
                        }}
                      >
                        Filtro de Status
                      </h4>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          color: '#B45309',
                          margin: 0,
                        }}
                      >
                        Apenas registros com status{' '}
                        <code
                          style={{
                            backgroundColor: '#FDE68A',
                            padding: '0.125rem 0.5rem',
                            borderRadius: '0.25rem',
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                          }}
                        >
                          {CSV_DOCS[selectedDocPlatform].statusValue}
                        </code>{' '}
                        serão importados.
                      </p>
                    </div>
                  </div>

                  {/* Tabela de Colunas */}
                  <div
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '0.75rem',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: CSV_DOCS[selectedDocPlatform].color,
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="9" y1="21" x2="9" y2="9" />
                      </svg>
                      <span
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#FFFFFF',
                        }}
                      >
                        Colunas do CSV - {CSV_DOCS[selectedDocPlatform].name}
                      </span>
                    </div>

                    {/* Header da tabela */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 2fr 1fr',
                        gap: '1rem',
                        padding: '0.75rem 1rem',
                        backgroundColor: '#F8FAFC',
                        borderBottom: '1px solid #E2E8F0',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>Campo</span>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>Nome da Coluna no CSV</span>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', textAlign: 'center' }}>Obrigatório</span>
                    </div>

                    {/* Linhas */}
                    {CSV_DOCS[selectedDocPlatform].columns.map((col, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 2fr 1fr',
                          gap: '1rem',
                          padding: '0.75rem 1rem',
                          borderBottom: idx < CSV_DOCS[selectedDocPlatform].columns.length - 1 ? '1px solid #F1F5F9' : 'none',
                          backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>{col.field}</span>
                        <code
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            color: '#475569',
                            backgroundColor: '#F1F5F9',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '0.25rem',
                            alignSelf: 'center',
                          }}
                        >
                          {col.column}
                        </code>
                        <span style={{ textAlign: 'center' }}>
                          {col.required ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#16A34A', fontSize: '0.875rem', fontWeight: 500 }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                              </svg>
                              Sim
                            </span>
                          ) : (
                            <span style={{ color: '#94A3B8', fontSize: '0.875rem' }}>Opcional</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Dica */}
                  <div
                    style={{
                      backgroundColor: '#EFF6FF',
                      border: '1px solid #BFDBFE',
                      borderRadius: '0.75rem',
                      padding: '1rem',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                    <div>
                      <h4
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#1E40AF',
                          margin: 0,
                          marginBottom: '0.25rem',
                        }}
                      >
                        Dica
                      </h4>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          color: '#1D4ED8',
                          margin: 0,
                        }}
                      >
                        Exporte o CSV diretamente da plataforma {CSV_DOCS[selectedDocPlatform].name} com todas as colunas disponíveis.
                        O sistema irá automaticamente identificar e utilizar as colunas necessárias.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: '1px solid #E2E8F0',
                padding: '1rem 1.5rem',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => {
                  setShowDocsModal(false);
                  setSelectedDocPlatform(null);
                }}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  backgroundColor: '#1E293B',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 1.5rem',
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Mapeamento de Colunas */}
      {showMappingModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem',
          }}
          onClick={closeMappingModal}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '1rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                background: 'linear-gradient(to right, #1E40AF, #3B82F6)',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--font-public-sans)',
                    fontSize: '1.125rem',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    margin: 0,
                  }}
                >
                  Mapeamento de Colunas
                </h2>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#DBEAFE',
                    margin: 0,
                    marginTop: '0.25rem',
                  }}
                >
                  {pendingFileForMapping?.name}
                </p>
              </div>
              <button
                onClick={closeMappingModal}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(255, 255, 255, 0.7)',
                  padding: '0.5rem',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {/* Campos Obrigatórios */}
              <h3
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#DC2626',
                  margin: 0,
                  marginBottom: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Campos Obrigatórios
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {REQUIRED_MAPPING_FIELDS.map(field => (
                  <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <label
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: '#314158',
                        minWidth: '120px',
                      }}
                    >
                      {FIELD_LABELS[field]} *
                    </label>
                    {field === 'statusFilter' ? (
                      <input
                        type="text"
                        value={mappingForm[field] || ''}
                        onChange={(e) => setMappingForm(prev => ({ ...prev, [field]: e.target.value }))}
                        placeholder="Ex: Paga, Aprovado, paid"
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          border: '1px solid #E2E8F0',
                          borderRadius: '0.5rem',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <select
                        value={mappingForm[field] || ''}
                        onChange={(e) => setMappingForm(prev => ({ ...prev, [field]: e.target.value }))}
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.875rem',
                          border: '1px solid #E2E8F0',
                          borderRadius: '0.5rem',
                          outline: 'none',
                          backgroundColor: '#FFFFFF',
                        }}
                      >
                        <option value="">Selecione...</option>
                        {csvColumns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>

              {/* Campos Opcionais */}
              <h3
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#64748B',
                  margin: 0,
                  marginBottom: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Campos Opcionais
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {OPTIONAL_MAPPING_FIELDS.map(field => (
                  <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <label
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: '#64748B',
                        minWidth: '120px',
                      }}
                    >
                      {FIELD_LABELS[field]}
                    </label>
                    <select
                      value={mappingForm[field] || ''}
                      onChange={(e) => setMappingForm(prev => ({ ...prev, [field]: e.target.value }))}
                      style={{
                        flex: 1,
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.875rem',
                        border: '1px solid #E2E8F0',
                        borderRadius: '0.5rem',
                        outline: 'none',
                        backgroundColor: '#FFFFFF',
                      }}
                    >
                      <option value="">Não mapear</option>
                      {csvColumns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Pipeline/Stage */}
              <h3
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#314158',
                  margin: 0,
                  marginBottom: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Pipeline / Stage
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                {AVAILABLE_STAGES.map(stage => (
                  <button
                    key={stage.id}
                    onClick={() => setSelectedStageId(stage.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      border: selectedStageId === stage.id ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                      backgroundColor: selectedStageId === stage.id ? '#EFF6FF' : '#FFFFFF',
                      color: selectedStageId === stage.id ? '#1E40AF' : '#64748B',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Image
                      src={`/lojas/${stage.logo}`}
                      alt={stage.name}
                      width={20}
                      height={20}
                      style={{ borderRadius: '4px', objectFit: 'cover' }}
                    />
                    {stage.name}
                  </button>
                ))}
              </div>

              {/* Salvar como modelo */}
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: '#F8FAFC',
                  borderRadius: '0.5rem',
                  border: '1px solid #E2E8F0',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#314158',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={saveAsTemplate}
                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  Salvar como modelo personalizado
                </label>
                {saveAsTemplate && (
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="Nome do modelo"
                    style={{
                      width: '100%',
                      marginTop: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      border: '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: '1px solid #E2E8F0',
                padding: '1rem 1.5rem',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
              }}
            >
              <button
                onClick={closeMappingModal}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 1.25rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmMapping}
                disabled={isStarting || isSavingTemplate}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  backgroundColor: isStarting || isSavingTemplate ? '#94A3B8' : '#3B82F6',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 1.25rem',
                  cursor: isStarting || isSavingTemplate ? 'not-allowed' : 'pointer',
                }}
              >
                {isStarting || isSavingTemplate ? 'Processando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Template */}
      {showEditModal && templateToEdit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem',
          }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '1rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                background: 'linear-gradient(to right, #1E40AF, #3B82F6)',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <h2
                style={{
                  fontFamily: 'var(--font-public-sans)',
                  fontSize: '1.125rem',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  margin: 0,
                }}
              >
                Editar Modelo
              </h2>
              <button
                onClick={() => setShowEditModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(255, 255, 255, 0.7)',
                  padding: '0.5rem',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.5rem' }}>
              {/* Nome */}
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#314158',
                    display: 'block',
                    marginBottom: '0.5rem',
                  }}
                >
                  Nome do Modelo
                </label>
                <input
                  type="text"
                  value={editTemplateName}
                  onChange={(e) => setEditTemplateName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Pipeline */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#314158',
                    display: 'block',
                    marginBottom: '0.5rem',
                  }}
                >
                  Pipeline / Stage
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {AVAILABLE_STAGES.map(stage => (
                    <button
                      key={stage.id}
                      onClick={() => setEditStageId(stage.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        border: editStageId === stage.id ? '2px solid #3B82F6' : '1px solid #E2E8F0',
                        borderRadius: '0.5rem',
                        backgroundColor: editStageId === stage.id ? '#EFF6FF' : '#FFFFFF',
                        color: editStageId === stage.id ? '#1E40AF' : '#64748B',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <Image
                        src={`/lojas/${stage.logo}`}
                        alt={stage.name}
                        width={20}
                        height={20}
                        style={{ borderRadius: '4px', objectFit: 'cover' }}
                      />
                      {stage.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mapeamento (somente leitura) */}
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: '#F8FAFC',
                  borderRadius: '0.5rem',
                  border: '1px solid #E2E8F0',
                }}
              >
                <h4
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#64748B',
                    margin: 0,
                    marginBottom: '0.75rem',
                    textTransform: 'uppercase',
                  }}
                >
                  Mapeamento de Colunas
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {Object.entries(templateToEdit.mapping).map(([key, value]) => value && (
                    <div
                      key={key}
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.75rem',
                        color: '#64748B',
                      }}
                    >
                      <span style={{ color: '#314158', fontWeight: 500 }}>{FIELD_LABELS[key as keyof typeof FIELD_LABELS]}</span>
                      {' → '}
                      <span style={{ color: '#3B82F6' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: '1px solid #E2E8F0',
                padding: '1rem 1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <button
                onClick={openDeleteModal}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#DC2626',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 1rem',
                  cursor: 'pointer',
                }}
              >
                Excluir
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#64748B',
                    backgroundColor: '#F1F5F9',
                    border: 'none',
                    borderRadius: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEdit}
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#FFFFFF',
                    backgroundColor: '#3B82F6',
                    border: 'none',
                    borderRadius: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    cursor: 'pointer',
                  }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {showDeleteModal && templateToEdit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '1rem',
          }}
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '1rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxWidth: '400px',
              width: '100%',
              padding: '1.5rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: '#DC2626',
                margin: 0,
                marginBottom: '0.5rem',
              }}
            >
              Excluir Modelo?
            </h3>
            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
                margin: 0,
                marginBottom: '1rem',
              }}
            >
              Esta ação não pode ser desfeita. Para confirmar, digite o nome do modelo:
            </p>
            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#1E40AF',
                margin: 0,
                marginBottom: '0.75rem',
              }}
            >
              {templateToEdit.name}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Digite o nome do modelo"
              style={{
                width: '100%',
                padding: '0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                border: deleteConfirmText === templateToEdit.name ? '2px solid #DC2626' : '1px solid #E2E8F0',
                borderRadius: '0.5rem',
                marginBottom: '1rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowDeleteModal(false)}
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
                onClick={handleConfirmDelete}
                disabled={deleteConfirmText !== templateToEdit.name}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: deleteConfirmText === templateToEdit.name ? '#FFFFFF' : '#9CA3AF',
                  backgroundColor: deleteConfirmText === templateToEdit.name ? '#DC2626' : '#E5E7EB',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: deleteConfirmText === templateToEdit.name ? 'pointer' : 'not-allowed',
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
