'use client';

import { useState, useRef, useEffect } from 'react';
import { estimateCsvImportTime, CsvTimeEstimate, CsvPlatform } from '@/lib/csvTimeEstimate';
import { subscribeToImportLock, lockImport, ImportLockStatus, formatTimeRemaining } from '@/lib/importLock';

interface CsvUploadProps {
  id: string;
  title: string;
  description: string;
  webhookUrl: string;
  disabled?: boolean;
  userEmail?: string;
  onSuccess?: (result: unknown) => void;
  onError?: (error: Error) => void;
}

interface DebugLog {
  timestamp: Date;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export default function CsvUpload({
  id,
  title,
  description,
  webhookUrl,
  disabled = false,
  userEmail,
  onSuccess,
  onError
}: CsvUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [estimate, setEstimate] = useState<CsvTimeEstimate | null>(null);
  const [importLock, setImportLock] = useState<ImportLockStatus>({ locked: false });
  const [lockTimeDisplay, setLockTimeDisplay] = useState('');

  // Progress & Debug states
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);

  const platform = id as CsvPlatform;

  // Auto-scroll debug logs
  useEffect(() => {
    if (debugEndRef.current && showDebug) {
      debugEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [debugLogs, showDebug]);

  const addLog = (type: DebugLog['type'], message: string) => {
    setDebugLogs(prev => [...prev, { timestamp: new Date(), type, message }]);
  };

  // Subscribe to import lock status
  useEffect(() => {
    const unsubscribe = subscribeToImportLock((status) => {
      setImportLock(status);
    });
    return () => unsubscribe();
  }, []);

  // Update lock time display every second
  useEffect(() => {
    if (!importLock.locked || !importLock.estimatedUnlock) return;

    const updateTime = () => {
      if (importLock.estimatedUnlock) {
        setLockTimeDisplay(formatTimeRemaining(importLock.estimatedUnlock));
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [importLock.locked, importLock.estimatedUnlock]);

  // Simulate progress based on estimate
  useEffect(() => {
    if (!isProcessing || !estimate) return;

    const totalSeconds = estimate.estimatedSeconds;
    const intervalMs = 1000;
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += 1;
      const newProgress = Math.min((elapsed / totalSeconds) * 100, 99);
      setProgress(newProgress);

      // Update progress message
      const remaining = Math.max(totalSeconds - elapsed, 0);
      if (remaining > 60) {
        setProgressMessage(`${Math.ceil(remaining / 60)} minutos restantes`);
      } else {
        setProgressMessage(`${remaining} segundos restantes`);
      }

      // Add periodic log
      if (elapsed % 10 === 0) {
        addLog('info', `Processando... ${Math.floor(newProgress)}% concluído`);
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isProcessing, estimate]);

  const isLocked = importLock.locked;
  const isDisabled = disabled || isLocked;

  const handleFileSelected = async (file: File) => {
    setError(null);
    setDebugLogs([]);

    if (!file.name.endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV.');
      addLog('error', 'Arquivo inválido: não é um CSV');
      return;
    }

    addLog('info', `Arquivo selecionado: ${file.name}`);
    addLog('info', `Tamanho: ${(file.size / 1024).toFixed(2)} KB`);

    setSelectedFile(file);
    setFileName(file.name);

    // Calculate estimate
    addLog('info', 'Analisando arquivo...');
    const est = await estimateCsvImportTime(file, platform);
    setEstimate(est);

    addLog('success', `Análise concluída: ${est.totalRows} linhas totais`);
    addLog('info', `Vendas válidas encontradas: ${est.paidRows}`);
    addLog('info', `Tempo estimado: ${est.formattedTime}`);

    setShowConfirmDialog(true);
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile || !estimate) return;

    setShowConfirmDialog(false);
    setIsUploading(true);
    setIsProcessing(true);
    setProgress(0);
    setError(null);

    addLog('info', 'Iniciando upload...');

    try {
      // Lock imports globally
      addLog('info', 'Travando sistema de importações...');
      await lockImport({
        lockedBy: userEmail || 'unknown',
        platform: id,
        estimatedSeconds: estimate.estimatedSeconds,
        message: `Importação ${title} em andamento`,
      });
      addLog('success', 'Sistema travado com sucesso');

      const formData = new FormData();
      formData.append('file', selectedFile);

      addLog('info', `Enviando arquivo para ${webhookUrl}...`);

      // Send request
      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
      });

      addLog('info', `Resposta recebida: HTTP ${response.status}`);

      if (response.ok) {
        addLog('success', 'Upload enviado com sucesso!');
        addLog('info', 'O processamento continua em background no servidor.');
        setProgress(100);
        setProgressMessage('Concluído!');
        onSuccess?.({ fileName: selectedFile.name, estimate });
      } else {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      addLog('error', `Erro: ${errorMessage}`);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsUploading(false);
      // Keep isProcessing true so progress bar stays visible
    }
  };

  const handleCancelUpload = () => {
    setShowConfirmDialog(false);
    setSelectedFile(null);
    setEstimate(null);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleReset = () => {
    setIsProcessing(false);
    setProgress(0);
    setProgressMessage('');
    setFileName('');
    setSelectedFile(null);
    setEstimate(null);
    setError(null);
    setDebugLogs([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDisabled && !isProcessing) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (isDisabled || isProcessing) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const getLogColor = (type: DebugLog['type']) => {
    switch (type) {
      case 'success': return '#22C55E';
      case 'error': return '#EF4444';
      case 'warning': return '#EAB308';
      default: return '#64748B';
    }
  };

  const getLogIcon = (type: DebugLog['type']) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'warning': return '⚠';
      default: return '→';
    }
  };

  return (
    <div
      className="rounded-3xl border border-slate-200 p-6 flex flex-col gap-4"
      style={{
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3
              style={{
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '1.125rem',
                color: '#314158',
                margin: 0,
              }}
            >
              {title}
            </h3>
            {disabled && (
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.625rem',
                  fontWeight: 500,
                  color: '#94A3B8',
                  backgroundColor: '#F1F5F9',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                }}
              >
                Em breve
              </span>
            )}
          </div>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
              margin: 0,
            }}
          >
            {description}
          </p>
        </div>

        {/* Debug Toggle */}
        {debugLogs.length > 0 && (
          <button
            onClick={() => setShowDebug(!showDebug)}
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: showDebug ? '#22D3EE' : '#94A3B8',
              backgroundColor: showDebug ? 'rgba(34, 211, 238, 0.1)' : 'transparent',
              border: '1px solid',
              borderColor: showDebug ? '#22D3EE' : '#E2E8F0',
              borderRadius: '0.5rem',
              padding: '0.25rem 0.75rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {showDebug ? 'Ocultar Debug' : 'Ver Debug'}
          </button>
        )}
      </div>

      {/* Global Lock Display */}
      {isLocked && !isProcessing && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #EF4444',
          }}
        >
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#DC2626',
                  margin: 0,
                  fontWeight: 500,
                }}
              >
                Importação em andamento
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: '#DC2626',
                  margin: 0,
                  opacity: 0.8,
                }}
              >
                {importLock.message} • Liberação em {lockTimeDisplay}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #EF4444',
          }}
        >
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <div className="flex-1">
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#DC2626',
                  margin: 0,
                  fontWeight: 500,
                }}
              >
                Erro na importação
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: '#DC2626',
                  margin: 0,
                  opacity: 0.8,
                }}
              >
                {error}
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {isProcessing && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.75rem',
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          {/* File Info */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22D3EE" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#314158',
                  fontWeight: 500,
                }}
              >
                {fileName}
              </span>
            </div>
            {progress >= 100 && (
              <button
                onClick={handleReset}
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
                Nova importação
              </button>
            )}
          </div>

          {/* Progress Bar */}
          <div
            style={{
              height: '8px',
              backgroundColor: '#E2E8F0',
              borderRadius: '4px',
              overflow: 'hidden',
              marginBottom: '0.5rem',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: progress >= 100 ? '#22C55E' : '#22D3EE',
                borderRadius: '4px',
                transition: 'width 0.3s ease, background-color 0.3s ease',
              }}
            />
          </div>

          {/* Progress Info */}
          <div className="flex items-center justify-between">
            <span
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: progress >= 100 ? '#22C55E' : '#64748B',
                fontWeight: 500,
              }}
            >
              {progress >= 100 ? '✓ Enviado com sucesso!' : progressMessage}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#94A3B8',
              }}
            >
              {Math.floor(progress)}%
            </span>
          </div>

          {/* Estimate Info */}
          {estimate && (
            <div
              style={{
                marginTop: '0.75rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #E2E8F0',
              }}
            >
              <div className="flex items-center gap-4">
                <span
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#64748B',
                  }}
                >
                  📊 {estimate.paidRows} vendas
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#64748B',
                  }}
                >
                  ⏱️ {estimate.formattedTime}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Debug Console */}
      {showDebug && debugLogs.length > 0 && (
        <div
          style={{
            backgroundColor: '#1E293B',
            borderRadius: '0.75rem',
            padding: '0.75rem',
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.625rem',
                color: '#94A3B8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Console Debug
            </span>
            <button
              onClick={() => setDebugLogs([])}
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
          {debugLogs.map((log, index) => (
            <div
              key={index}
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: getLogColor(log.type),
                marginBottom: '0.25rem',
                display: 'flex',
                gap: '0.5rem',
              }}
            >
              <span style={{ color: '#64748B' }}>
                {log.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span>{getLogIcon(log.type)}</span>
              <span>{log.message}</span>
            </div>
          ))}
          <div ref={debugEndRef} />
        </div>
      )}

      {/* Drop Zone - only show when not processing */}
      {!isProcessing && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isDisabled && !isUploading && fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? '#22D3EE' : '#E2E8F0'}`,
            borderRadius: '1rem',
            padding: '2rem',
            textAlign: 'center',
            cursor: isDisabled ? 'not-allowed' : isUploading ? 'wait' : 'pointer',
            backgroundColor: isDragging ? 'rgba(34, 211, 238, 0.05)' : '#F8FAFC',
            transition: 'all 0.2s ease',
            opacity: isDisabled ? 0.5 : isUploading ? 0.6 : 1,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            disabled={isDisabled || isUploading}
          />

          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div
                className="animate-spin"
                style={{
                  width: '40px',
                  height: '40px',
                  border: '3px solid #E2E8F0',
                  borderTopColor: '#22D3EE',
                  borderRadius: '50%',
                }}
              />
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#314158',
                  margin: 0,
                }}
              >
                Enviando...
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94A3B8"
                strokeWidth="1.5"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: isDisabled ? '#94A3B8' : '#314158',
                    margin: 0,
                    marginBottom: '0.25rem',
                  }}
                >
                  {disabled ? 'Integração indisponível' : isLocked ? 'Aguarde a importação atual' : 'Arraste o arquivo CSV aqui'}
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#94A3B8',
                    margin: 0,
                  }}
                >
                  {disabled ? 'Em desenvolvimento' : 'ou clique para selecionar'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && estimate && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={handleCancelUpload}
        >
          <div
            className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Warning Icon */}
            <div
              className="mx-auto mb-4 flex items-center justify-center"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h3
              style={{
                fontFamily: 'var(--font-public-sans)',
                fontWeight: 600,
                fontSize: '1.25rem',
                color: '#314158',
                margin: 0,
                marginBottom: '0.5rem',
                textAlign: 'center',
              }}
            >
              Confirmar importação
            </h3>

            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
                margin: 0,
                marginBottom: '1rem',
                textAlign: 'center',
              }}
            >
              Arquivo: <strong>{fileName}</strong>
            </p>

            {/* Estimate Info */}
            <div
              style={{
                backgroundColor: '#FEF3C7',
                borderRadius: '0.75rem',
                padding: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <p
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#D97706',
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  {estimate.paidRows} vendas encontradas
                </p>
              </div>
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#92400E',
                  margin: 0,
                }}
              >
                Tempo estimado: <strong>{estimate.formattedTime}</strong>
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: '#92400E',
                  margin: 0,
                  marginTop: '0.5rem',
                  opacity: 0.8,
                }}
              >
                Durante este período, nenhuma outra importação poderá ser realizada.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleCancelUpload}
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmUpload}
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  backgroundColor: '#22D3EE',
                  border: 'none',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
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
