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
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [estimate, setEstimate] = useState<CsvTimeEstimate | null>(null);
  const [importLock, setImportLock] = useState<ImportLockStatus>({ locked: false });
  const [lockTimeDisplay, setLockTimeDisplay] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const platform = id as CsvPlatform;

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

  const isLocked = importLock.locked;
  const isDisabled = disabled || isLocked;

  const handleFileSelected = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      alert('Por favor, selecione um arquivo CSV.');
      return;
    }

    setSelectedFile(file);
    setFileName(file.name);

    // Calculate estimate
    const est = await estimateCsvImportTime(file, platform);
    setEstimate(est);
    setShowConfirmDialog(true);
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile || !estimate) return;

    setShowConfirmDialog(false);
    setIsUploading(true);

    try {
      // Lock imports globally
      await lockImport({
        lockedBy: userEmail || 'unknown',
        platform: id,
        estimatedSeconds: estimate.estimatedSeconds,
        message: `Importação ${title} em andamento`,
      });

      const formData = new FormData();
      formData.append('file', selectedFile);

      // Fire and forget
      fetch(webhookUrl, {
        method: 'POST',
        body: formData,
      }).catch(() => {});

      setShowSuccessDialog(true);
      onSuccess?.({ fileName: selectedFile.name, estimate });
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Erro desconhecido'));
    } finally {
      setIsUploading(false);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDisabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (isDisabled) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const closeSuccessDialog = () => {
    setShowSuccessDialog(false);
    setFileName('');
    setSelectedFile(null);
    setEstimate(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div
        className="rounded-3xl border border-slate-200 p-6 flex flex-col gap-4"
        style={{
          backgroundColor: '#FFFFFF',
          borderColor: '#E2E8F0',
          maxWidth: '500px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
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

        {/* Global Lock Display */}
        {isLocked && (
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

        {/* Drop Zone */}
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
      </div>

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

      {/* Success Dialog */}
      {showSuccessDialog && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={closeSuccessDialog}
        >
          <div
            className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Success Icon */}
            <div
              className="mx-auto mb-4 flex items-center justify-center"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
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
              }}
            >
              Importação iniciada!
            </h3>

            <p
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                color: '#64748B',
                margin: 0,
                marginBottom: '0.5rem',
              }}
            >
              O arquivo <strong>{fileName}</strong> está sendo processado.
            </p>

            {estimate && (
              <p
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: '#94A3B8',
                  margin: 0,
                  marginBottom: '1.5rem',
                }}
              >
                Tempo estimado: {estimate.formattedTime}
              </p>
            )}

            <button
              onClick={closeSuccessDialog}
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#FFFFFF',
                backgroundColor: '#22D3EE',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.75rem 2rem',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
