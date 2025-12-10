'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

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
  type: 'status' | 'init' | 'progress' | 'complete' | 'error' | 'debug';
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
  // Debug fields
  statusColumn?: string;
  uniqueStatuses?: string[];
  csvHeaders?: string[];
  sampleRow?: Record<string, string>;
}

const PLATFORMS = [
  { id: 'hubla', name: 'Hubla', color: 'bg-purple-500' },
  { id: 'hotmart', name: 'Hotmart', color: 'bg-orange-500' },
  { id: 'eduzz', name: 'Eduzz', color: 'bg-blue-500' },
  { id: 'kiwify', name: 'Kiwify', color: 'bg-green-500' },
];

const LOCK_DOC = 'import-csv-lock';
const LOCK_COLLECTION = 'system';

export default function ImportCSVPage() {
  const [lock, setLock] = useState<ImportLock | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState('hubla');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [delay, setDelay] = useState(1500);
  const [logs, setLogs] = useState<Array<{ type: string; message: string; time: Date }>>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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
    setIsDragging(true);
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
      platform: selectedPlatform,
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
    addLog('info', `Iniciando importação: ${file.name}`);
    addLog('info', `Plataforma: ${selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)}`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', selectedPlatform);
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

              if (event.type === 'debug') {
                addLog('warning', `⚠️ ${event.message}`);
                addLog('info', `Coluna de status esperada: "${event.statusColumn}"`);
                addLog('info', `Status encontrados no CSV: ${event.uniqueStatuses?.join(', ') || 'nenhum'}`);
                addLog('info', `Colunas do CSV: ${event.csvHeaders?.join(', ') || 'nenhuma'}`);
                if (event.sampleRow) {
                  addLog('info', `Exemplo de linha: ${JSON.stringify(event.sampleRow).substring(0, 500)}`);
                }
              }

            } catch {
              // ignore parse errors
            }
          }
        }
      }

    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Cancelado pelo usuário
        return;
      }
      const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
      addLog('error', `Erro: ${errorMsg}`);
      await releaseLock('error', errorMsg);
    }

    abortControllerRef.current = null;
  };

  const progress = lock?.total ? Math.round((lock.processed / lock.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">Importar CSV → Datacrazy</h1>

        {/* Status do Lock */}
        {lock?.isLocked && lock.status === 'running' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-yellow-500 border-t-transparent rounded-full" />
                <span className="font-medium text-yellow-800">Importação em andamento</span>
              </div>
              <button
                onClick={cancelImport}
                className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
              >
                Cancelar
              </button>
            </div>
            <p className="text-sm text-yellow-700 mb-2">
              {lock.platform.toUpperCase()} - {lock.fileName}
            </p>
            <div className="w-full bg-yellow-200 rounded-full h-3 mb-2">
              <div
                className="bg-yellow-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-yellow-700">
              <span>{lock.processed} / {lock.total}</span>
              <span>{progress}%</span>
            </div>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-green-600">✅ {lock.created} criados</span>
              <span className="text-slate-600">⏭️ {lock.exists} existentes</span>
              <span className="text-red-600">❌ {lock.errors} erros</span>
              <span className="text-yellow-600">⚠️ {lock.skipped} ignorados</span>
            </div>
          </div>
        )}

        {/* Resultado anterior */}
        {lock && !lock.isLocked && (
          <div className={`border rounded-lg p-4 mb-6 ${
            lock.status === 'completed' ? 'bg-green-50 border-green-200' :
            lock.status === 'error' ? 'bg-red-50 border-red-200' :
            'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`font-medium ${
                lock.status === 'completed' ? 'text-green-800' :
                lock.status === 'error' ? 'text-red-800' :
                'text-slate-800'
              }`}>
                {lock.status === 'completed' ? 'Importação concluída' :
                 lock.status === 'error' ? 'Erro na importação' :
                 'Importação cancelada'}
              </span>
              <button
                onClick={forceReleaseLock}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Limpar
              </button>
            </div>
            <p className="text-sm mb-2">{lock.message}</p>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">✅ {lock.created} criados</span>
              <span className="text-slate-600">⏭️ {lock.exists} existentes</span>
              <span className="text-red-600">❌ {lock.errors} erros</span>
            </div>
          </div>
        )}

        {/* Formulário de Upload */}
        {(!lock?.isLocked || lock.status !== 'running') && (
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            {/* Seleção de Plataforma */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Plataforma
              </label>
              <div className="flex gap-2">
                {PLATFORMS.map(platform => (
                  <button
                    key={platform.id}
                    onClick={() => setSelectedPlatform(platform.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedPlatform === platform.id
                        ? `${platform.color} text-white`
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {platform.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Delay */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Delay entre registros: {delay}ms
              </label>
              <input
                type="range"
                min="500"
                max="3000"
                step="100"
                value={delay}
                onChange={(e) => setDelay(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>500ms (rápido)</span>
                <span>3000ms (seguro)</span>
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : file
                    ? 'border-green-500 bg-green-50'
                    : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              {file ? (
                <div>
                  <p className="text-green-700 font-medium">{file.name}</p>
                  <p className="text-sm text-slate-500 mt-1">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    onClick={() => setFile(null)}
                    className="mt-2 text-sm text-red-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-slate-600 mb-2">
                    Arraste um arquivo CSV aqui ou
                  </p>
                  <label className="cursor-pointer text-blue-500 hover:text-blue-700 font-medium">
                    clique para selecionar
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Botão Importar */}
            <button
              onClick={startImport}
              disabled={!file || lock?.isLocked}
              className={`mt-6 w-full py-3 rounded-lg font-medium transition-all ${
                file && !lock?.isLocked
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {lock?.isLocked ? 'Importação em andamento...' : 'Iniciar Importação'}
            </button>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div className="bg-slate-900 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`py-0.5 ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'success' ? 'text-green-400' :
                  log.type === 'warning' ? 'text-yellow-400' :
                  'text-slate-300'
                }`}
              >
                <span className="text-slate-500">
                  {log.time.toLocaleTimeString()}
                </span>
                {' '}{log.message}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {/* Error Log */}
        {lock?.errorLog && lock.errorLog.length > 0 && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="font-medium text-red-800 mb-2">Erros ({lock.errorLog.length})</h3>
            <div className="max-h-48 overflow-y-auto text-sm">
              {lock.errorLog.map((err, i) => (
                <div key={i} className="py-1 border-b border-red-100 last:border-0">
                  <span className="text-red-700">{err.email}</span>
                  <span className="text-red-500 ml-2">{err.error}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
