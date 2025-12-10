'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import Image from 'next/image';

interface ImportLock {
  isLocked: boolean;
  platform: string;
  fileName: string;
  startedAt: Date;
  total: number;
  processed: number;
  created: number;
  exists: number;
  errors: number;
  skipped: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  message: string;
  errorLog: Array<{ email: string; name: string; error: string }>;
}

interface ProgressEvent {
  type: 'status' | 'init' | 'progress' | 'complete' | 'error';
  message?: string;
  index?: number;
  total?: number;
  status?: string;
  email?: string;
  name?: string;
  value?: number;
  stats?: {
    created: number;
    exists: number;
    updated: number;
    errors: number;
    skipped: number;
  };
  created?: number;
  exists?: number;
  updated?: number;
  errors?: number;
  skipped?: number;
  platform?: string;
  fileName?: string;
  filtered?: number;
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

const LOCK_DOC = 'import-csv-lock';
const LOCK_COLLECTION = 'system';

interface LogEntry {
  type: string;
  message: string;
  time: Date;
}

interface CsvUploadUnifiedProps {
  userEmail?: string;
}

export default function CsvUploadUnified({ userEmail }: CsvUploadUnifiedProps) {
  const [lock, setLock] = useState<ImportLock | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(PLATFORMS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const delay = 1500; // Delay padrão entre registros (ms)
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [selectedDocPlatform, setSelectedDocPlatform] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Escutar mudanças no lock do Firebase
  useEffect(() => {
    const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
    const unsubscribe = onSnapshot(lockRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLock({
          ...data,
          startedAt: data.startedAt?.toDate() || new Date(),
          errorLog: data.errorLog || [],
        } as ImportLock);
      } else {
        setLock(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  const addLog = useCallback((type: string, message: string) => {
    setLogs(prev => [...prev.slice(-200), { type, message, time: new Date() }]);
  }, []);

  const updateFirebaseLock = async (data: Partial<ImportLock>) => {
    const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
    await setDoc(lockRef, {
      ...data,
      lastUpdate: new Date(),
    }, { merge: true });
  };

  const releaseLock = async (status: 'completed' | 'error' | 'cancelled', message?: string) => {
    await updateFirebaseLock({
      isLocked: false,
      status,
      message: message || (status === 'completed' ? 'Importação concluída' : status === 'error' ? 'Erro na importação' : 'Importação cancelada'),
    });
  };

  const forceReleaseLock = async () => {
    const lockRef = doc(db, LOCK_COLLECTION, LOCK_DOC);
    await deleteDoc(lockRef);
    setLogs([]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!lock?.isLocked) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const cancelImport = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    await releaseLock('cancelled', 'Importação cancelada pelo usuário');
    addLog('warning', 'Importação cancelada');
  };

  const startImport = async () => {
    if (!file || lock?.isLocked) return;

    // Criar lock no Firebase
    await updateFirebaseLock({
      isLocked: true,
      platform: selectedPlatform.id,
      fileName: file.name,
      startedAt: new Date(),
      total: 0,
      processed: 0,
      created: 0,
      exists: 0,
      errors: 0,
      skipped: 0,
      status: 'running',
      message: 'Iniciando importação...',
      errorLog: [],
    });

    setLogs([]);
    setShowLogs(true);
    addLog('info', `Iniciando importação: ${file.name}`);
    addLog('info', `Plataforma: ${selectedPlatform.name}`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', selectedPlatform.id);
    formData.append('delay', delay.toString());

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/import-csv', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      const errorLog: Array<{ email: string; name: string; error: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: ProgressEvent = JSON.parse(line.slice(6));

              if (event.type === 'status') {
                addLog('info', event.message || '');
                await updateFirebaseLock({ message: event.message });
              }

              if (event.type === 'init') {
                addLog('info', `Total: ${event.total} registros (${event.filtered} filtrados)`);
                await updateFirebaseLock({
                  total: event.total,
                  message: event.message,
                });
              }

              if (event.type === 'progress') {
                const stats = event.stats!;
                const statusIcon = event.status === 'created' ? '✅' :
                                   event.status === 'exists' ? '⏭️' :
                                   event.status === 'error' ? '❌' :
                                   event.status === 'lead_created' ? '👤' :
                                   event.status === 'skipped' ? '⚠️' : '•';

                addLog(event.status === 'error' ? 'error' : 'info',
                  `${statusIcon} [${event.index}/${event.total}] ${event.email || ''} - ${event.message}`);

                if (event.status === 'error') {
                  errorLog.push({
                    email: event.email || '',
                    name: event.name || '',
                    error: event.message || '',
                  });
                }

                await updateFirebaseLock({
                  processed: event.index,
                  created: stats.created,
                  exists: stats.exists,
                  errors: stats.errors,
                  skipped: stats.skipped,
                  message: `${event.index}/${event.total} - ${event.message}`,
                  errorLog: errorLog.slice(-50),
                });
              }

              if (event.type === 'complete') {
                addLog('success', `Concluído! Criados: ${event.created}, Existentes: ${event.exists}, Erros: ${event.errors}`);
                await releaseLock('completed', event.message);
                setFile(null);
              }

              if (event.type === 'error') {
                addLog('error', event.message || 'Erro desconhecido');
                await releaseLock('error', event.message);
              }

            } catch {
              // ignore parse errors
            }
          }
        }
      }

    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
      addLog('error', `Erro: ${errorMsg}`);
      await releaseLock('error', errorMsg);
    }

    abortControllerRef.current = null;
  };

  const progress = lock?.total ? Math.round((lock.processed / lock.total) * 100) : 0;
  const isRunning = lock?.isLocked && lock.status === 'running';

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Debug Toggle */}
          {logs.length > 0 && (
            <button
              onClick={() => setShowLogs(!showLogs)}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: showLogs ? '#22D3EE' : '#94A3B8',
                backgroundColor: showLogs ? 'rgba(34, 211, 238, 0.1)' : 'transparent',
                border: '1px solid',
                borderColor: showLogs ? '#22D3EE' : '#E2E8F0',
                borderRadius: '0.5rem',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {showLogs ? 'Ocultar Logs' : 'Ver Logs'}
            </button>
          )}

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
      </div>

      {/* Progress Section - Running */}
      {isRunning && (
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
                  {lock.platform.toUpperCase()} • {lock.fileName}
                </p>
              </div>
            </div>
            <button
              onClick={cancelImport}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: '#FFFFFF',
                backgroundColor: '#EF4444',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
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
              {lock.processed} / {lock.total}
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#92400E', fontWeight: 600 }}>
              {progress}%
            </span>
          </div>

          {/* Stats */}
          <div className="flex gap-4 flex-wrap">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#16A34A' }}>
              ✅ {lock.created} criados
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
              ⏭️ {lock.exists} existentes
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#DC2626' }}>
              ❌ {lock.errors} erros
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#D97706' }}>
              ⚠️ {lock.skipped} ignorados
            </span>
          </div>
        </div>
      )}

      {/* Result Section - Completed/Error/Cancelled */}
      {lock && !lock.isLocked && (
        <div
          style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            backgroundColor: lock.status === 'completed' ? '#F0FDF4' : lock.status === 'error' ? '#FEF2F2' : '#F8FAFC',
            border: `1px solid ${lock.status === 'completed' ? '#BBF7D0' : lock.status === 'error' ? '#FECACA' : '#E2E8F0'}`,
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {lock.status === 'completed' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : lock.status === 'error' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              )}
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: lock.status === 'completed' ? '#16A34A' : lock.status === 'error' ? '#DC2626' : '#64748B',
                }}
              >
                {lock.status === 'completed' ? 'Importação concluída' :
                 lock.status === 'error' ? 'Erro na importação' :
                 'Importação cancelada'}
              </span>
            </div>
            <button
              onClick={forceReleaseLock}
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
            {lock.message}
          </p>

          <div className="flex gap-4 flex-wrap">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#16A34A' }}>
              ✅ {lock.created} criados
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
              ⏭️ {lock.exists} existentes
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#DC2626' }}>
              ❌ {lock.errors} erros
            </span>
          </div>
        </div>
      )}

      {/* Form Section - Only show when not running */}
      {!isRunning && (
        <>
          {/* Platform Select */}
          <div>
            <label
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#314158',
                display: 'block',
                marginBottom: '0.75rem',
              }}
            >
              Plataforma
            </label>
            <div className="flex gap-3 flex-wrap">
              {PLATFORMS.map(platform => (
                <button
                  key={platform.id}
                  onClick={() => setSelectedPlatform(platform)}
                  disabled={lock?.isLocked}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: selectedPlatform.id === platform.id ? '#FFFFFF' : '#64748B',
                    backgroundColor: selectedPlatform.id === platform.id ? platform.color : '#F1F5F9',
                    border: selectedPlatform.id === platform.id ? 'none' : '1px solid #E2E8F0',
                    borderRadius: '0.75rem',
                    padding: '0.5rem 1rem',
                    cursor: lock?.isLocked ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    opacity: lock?.isLocked ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      flexShrink: 0,
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    <Image
                      src={platform.logo}
                      alt={platform.name}
                      width={28}
                      height={28}
                      style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                    />
                  </div>
                  {platform.name}
                </button>
              ))}
            </div>
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !lock?.isLocked && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? '#22D3EE' : file ? '#22C55E' : '#E2E8F0'}`,
              borderRadius: '1rem',
              padding: '2.5rem 2rem',
              textAlign: 'center',
              cursor: lock?.isLocked ? 'not-allowed' : 'pointer',
              backgroundColor: isDragging ? 'rgba(34, 211, 238, 0.05)' : file ? 'rgba(34, 197, 94, 0.05)' : '#F8FAFC',
              transition: 'all 0.2s ease',
              opacity: lock?.isLocked ? 0.5 : 1,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              disabled={lock?.isLocked}
            />

            {file ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <polyline points="9 15 12 18 15 15" />
                  </svg>
                </div>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '1rem',
                    color: '#16A34A',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  {file.name}
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#64748B',
                    margin: 0,
                  }}
                >
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#DC2626',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    marginTop: '0.25rem',
                  }}
                >
                  Remover arquivo
                </button>
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
                    Arraste o arquivo CSV aqui
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#94A3B8',
                      margin: 0,
                    }}
                  >
                    ou clique para selecionar
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Import Button */}
          <button
            onClick={startImport}
            disabled={!file || lock?.isLocked}
            style={{
              width: '100%',
              fontFamily: 'var(--font-inter)',
              fontSize: '1rem',
              fontWeight: 600,
              color: file && !lock?.isLocked ? '#FFFFFF' : '#94A3B8',
              backgroundColor: file && !lock?.isLocked ? selectedPlatform.color : '#E2E8F0',
              border: 'none',
              borderRadius: '0.75rem',
              padding: '1rem',
              cursor: file && !lock?.isLocked ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
          >
            {lock?.isLocked ? 'Importação em andamento...' : 'Iniciar Importação'}
          </button>
        </>
      )}

      {/* Logs Console */}
      {showLogs && logs.length > 0 && (
        <div
          style={{
            backgroundColor: '#1E293B',
            borderRadius: '0.75rem',
            padding: '1rem',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.625rem',
                color: '#94A3B8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Console
            </span>
            <button
              onClick={() => setLogs([])}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.625rem',
                color: '#64748B',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Limpar
            </button>
          </div>
          {logs.map((log, i) => (
            <div
              key={i}
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: log.type === 'error' ? '#F87171' :
                       log.type === 'success' ? '#4ADE80' :
                       log.type === 'warning' ? '#FBBF24' :
                       '#CBD5E1',
                marginBottom: '0.25rem',
                lineHeight: 1.4,
              }}
            >
              <span style={{ color: '#64748B' }}>
                {log.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {' '}{log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Error Log */}
      {lock?.errorLog && lock.errorLog.length > 0 && (
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
            Erros ({lock.errorLog.length})
          </h4>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {lock.errorLog.map((err, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  paddingBottom: '0.5rem',
                  marginBottom: '0.5rem',
                  borderBottom: i < lock.errorLog.length - 1 ? '1px solid #FECACA' : 'none',
                }}
              >
                <span style={{ color: '#DC2626', fontWeight: 500 }}>{err.email}</span>
                <span style={{ color: '#B91C1C', marginLeft: '0.5rem' }}>{err.error}</span>
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
    </div>
  );
}
