'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, limit, doc, getDoc } from 'firebase/firestore';

interface SyncJob {
  id: string;
  tipo: string;
  status: string;
  total: number;
  processados: number;
  sucessos: number;
  erros: number;
  ignorados?: number;
  emailsInvalidos?: number;
  ultimoIndice: number;
  tags?: string;
  incremental?: boolean;
  automatico?: boolean;
  criadoEm: string;
  atualizadoEm: string;
  mensagem: string;
  errosDetalhes?: Array<{ email: string; error: string }>;
}

interface WorkerConfig {
  enabled: boolean;
  sincronizando: boolean;
  intervalMinutes: number;
  proximaExecucao: string | null;
  ultimaSyncConcluida: string | null;
}

interface EmailInvalido {
  email: string;
  erro: string;
}

export default function SincronizacaoDatacrazy() {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [workerConfig, setWorkerConfig] = useState<WorkerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState<string | null>(null);
  const [showEmailsInvalidos, setShowEmailsInvalidos] = useState<string | null>(null);
  const [emailsInvalidos, setEmailsInvalidos] = useState<EmailInvalido[]>([]);
  const [countdown, setCountdown] = useState<string>('');
  const [syncDisparado, setSyncDisparado] = useState(false);

  // Listener para config do worker
  useEffect(() => {
    const configRef = doc(db, 'configuracoes', 'sync_worker_config');
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setWorkerConfig(snapshot.data() as WorkerConfig);
      } else {
        setWorkerConfig({
          enabled: false,
          sincronizando: false,
          intervalMinutes: 15,
          proximaExecucao: null,
          ultimaSyncConcluida: null,
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Reset flag quando proximaExecucao muda (novo ciclo)
  useEffect(() => {
    setSyncDisparado(false);
  }, [workerConfig?.proximaExecucao]);

  // Countdown timer + Auto-trigger quando chegar a 0
  useEffect(() => {
    if (!workerConfig?.proximaExecucao || !workerConfig.enabled) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const proxima = new Date(workerConfig.proximaExecucao!).getTime();
      const agora = Date.now();
      const diff = proxima - agora;

      if (diff <= 0) {
        // Timer chegou a 0 - disparar sync automaticamente (só uma vez)
        if (!workerConfig.sincronizando && !syncDisparado) {
          setCountdown('Iniciando...');
          setSyncDisparado(true);
          // Dispara a sincronização
          fetch('/api/cron/sync-datacrazy-swipeone')
            .then(res => res.json())
            .then(data => {
              console.log('[Worker] Sync automático disparado:', data);
            })
            .catch(err => {
              console.error('[Worker] Erro ao disparar sync:', err);
            });
        } else {
          setCountdown('Sincronizando...');
        }
        return;
      }

      const minutos = Math.floor(diff / 60000);
      const segundos = Math.floor((diff % 60000) / 1000);

      if (minutos > 0) {
        setCountdown(`${minutos}m ${segundos}s`);
      } else {
        setCountdown(`${segundos}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [workerConfig?.proximaExecucao, workerConfig?.enabled, workerConfig?.sincronizando, syncDisparado]);

  // Listener para jobs
  useEffect(() => {
    const q = query(
      collection(db, 'jobs_sincronizacao'),
      orderBy('criadoEm', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as SyncJob[];
      setJobs(jobsData);
    });

    return () => unsubscribe();
  }, []);

  // Buscar emails inválidos de um job
  const buscarEmailsInvalidos = async (jobId: string) => {
    try {
      const docRef = doc(db, 'emails_invalidos', jobId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setEmailsInvalidos(docSnap.data().emails || []);
        setShowEmailsInvalidos(jobId);
      } else {
        setEmailsInvalidos([]);
        setShowEmailsInvalidos(jobId);
      }
    } catch (err) {
      console.error('Erro ao buscar emails inválidos:', err);
    }
  };

  // Toggle worker
  const toggleWorker = async (enabled: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/cron/sync-datacrazy-swipeone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          enabled,
          intervalMinutes: workerConfig?.intervalMinutes || 15,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'Erro ao alterar worker');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  // Sync manual (independente do worker)
  const syncAgora = async () => {
    setLoading(true);
    setError(null);

    try {
      // Chama GET com ?manual=true (fire-and-forget)
      // O progresso será mostrado via Firebase onSnapshot
      fetch('/api/cron/sync-datacrazy-swipeone?manual=true')
        .then(res => res.json())
        .then(data => {
          if (!data.success && data.message !== 'Sincronização já em andamento') {
            console.log('[Sync] Resultado:', data);
          }
        })
        .catch(err => console.error('[Sync] Erro:', err));

      // Não espera - retorna imediato
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const cancelarJob = async (jobId: string) => {
    try {
      await fetch(`/api/sincronizacao/datacrazy-swipeone?jobId=${jobId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Erro ao cancelar:', err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processando':
        return 'bg-blue-100 text-blue-800';
      case 'concluido':
        return 'bg-green-100 text-green-800';
      case 'cancelado':
        return 'bg-red-100 text-red-800';
      case 'erro':
        return 'bg-red-100 text-red-800';
      case 'pausado':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR');
  };

  const hasActiveJob = jobs.some(j => j.status === 'processando');

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl">
      {/* Card do Worker */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <span className="text-2xl text-slate-400">→</span>
            <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9333EA" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Datacrazy → SwipeOne</h2>
            <p className="text-sm text-slate-500">
              Sincronização automática de leads novos
            </p>
          </div>
        </div>

        {/* Status do Worker */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${workerConfig?.enabled ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
            <div>
              <p className="font-medium text-slate-800">
                Worker Automático
              </p>
              <p className="text-sm text-slate-500">
                {workerConfig?.enabled
                  ? workerConfig?.sincronizando
                    ? 'Sincronizando...'
                    : workerConfig?.proximaExecucao
                      ? `Próxima execução em ${countdown || 'breve'}`
                      : 'Aguardando sync terminar...'
                  : 'Desabilitado'}
              </p>
            </div>
          </div>
          <button
            onClick={() => toggleWorker(!workerConfig?.enabled)}
            disabled={loading}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              workerConfig?.enabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            } disabled:opacity-50`}
          >
            {workerConfig?.enabled ? 'Desabilitar' : 'Habilitar'}
          </button>
        </div>

        {/* Botão Sync Agora */}
        <div className="flex items-center gap-3">
          <button
            onClick={syncAgora}
            disabled={loading || hasActiveJob || workerConfig?.sincronizando}
            className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${
              loading || hasActiveJob || workerConfig?.sincronizando
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {workerConfig?.sincronizando ? 'Sincronizando...' : 'Sincronizar Agora'}
          </button>
          <span className="text-sm text-slate-500">
            Executa sincronização imediata (apenas novos)
          </span>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {(hasActiveJob || workerConfig?.sincronizando) && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 flex items-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Sincronização em andamento...
          </div>
        )}
      </div>

      {/* Lista de Jobs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Histórico de Sincronizações</h2>

        {jobs.length === 0 ? (
          <p className="text-slate-500 text-center py-8">
            Nenhuma sincronização realizada ainda.
          </p>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const percentual = job.total > 0 ? Math.floor((job.processados / job.total) * 100) : 0;
              const emailsInvalidosCount = job.emailsInvalidos || 0;

              return (
                <div
                  key={job.id}
                  className="border border-slate-200 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status === 'processando' ? 'Em andamento' :
                         job.status === 'concluido' ? 'Concluído' :
                         job.status === 'cancelado' ? 'Cancelado' :
                         job.status === 'erro' ? 'Erro' :
                         job.status === 'pausado' ? 'Pausado' : job.status}
                      </span>
                      {job.automatico && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Auto
                        </span>
                      )}
                      <span className="text-sm text-slate-500">
                        {formatDate(job.criadoEm)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.status === 'processando' && (
                        <button
                          onClick={() => cancelarJob(job.id)}
                          className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de Progresso */}
                  <div className="mb-3">
                    <div className="flex justify-between text-sm text-slate-600 mb-1">
                      <span>{job.processados.toLocaleString()} / {job.total.toLocaleString()} leads</span>
                      <span>{percentual}%</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          job.status === 'concluido' ? 'bg-green-500' :
                          job.status === 'cancelado' || job.status === 'erro' ? 'bg-red-500' :
                          job.status === 'pausado' ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${percentual}%` }}
                      />
                    </div>
                  </div>

                  {/* Estatísticas */}
                  <div className="flex flex-wrap gap-4 text-sm mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      <span className="text-slate-600">Enviados: {job.sucessos.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                      <span className="text-slate-600">Erros: {job.erros}</span>
                    </div>
                    {(job.ignorados || 0) > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        <span className="text-slate-600">Sem email: {job.ignorados}</span>
                      </div>
                    )}
                    {emailsInvalidosCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                        <span className="text-slate-600">Emails inválidos: {emailsInvalidosCount}</span>
                      </div>
                    )}
                  </div>

                  {/* Mensagem */}
                  <p className="text-sm text-slate-500 truncate">{job.mensagem}</p>

                  {/* Botões de Ver Detalhes */}
                  <div className="flex gap-4 mt-3">
                    {job.errosDetalhes && job.errosDetalhes.length > 0 && (
                      <button
                        onClick={() => setShowErrors(showErrors === job.id ? null : job.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        {showErrors === job.id ? 'Ocultar erros' : `Ver ${job.errosDetalhes.length} erros`}
                      </button>
                    )}

                    {emailsInvalidosCount > 0 && (
                      <button
                        onClick={() => {
                          if (showEmailsInvalidos === job.id) {
                            setShowEmailsInvalidos(null);
                          } else {
                            buscarEmailsInvalidos(job.id);
                          }
                        }}
                        className="text-sm text-orange-600 hover:underline"
                      >
                        {showEmailsInvalidos === job.id ? 'Ocultar emails inválidos' : `Ver ${emailsInvalidosCount} emails inválidos`}
                      </button>
                    )}
                  </div>

                  {/* Lista de Erros */}
                  {showErrors === job.id && job.errosDetalhes && (
                    <div className="mt-2 max-h-40 overflow-y-auto bg-red-50 rounded-lg p-3">
                      {job.errosDetalhes.map((err, idx) => (
                        <div key={idx} className="text-xs text-red-700 mb-1">
                          <span className="font-medium">{err.email}:</span> {err.error}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Lista de Emails Inválidos */}
                  {showEmailsInvalidos === job.id && (
                    <div className="mt-2 max-h-60 overflow-y-auto bg-orange-50 rounded-lg p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-orange-800">Emails Inválidos</span>
                        <button
                          onClick={() => {
                            const text = emailsInvalidos.map(e => e.email).join('\n');
                            navigator.clipboard.writeText(text);
                          }}
                          className="text-xs px-2 py-1 bg-orange-200 text-orange-700 rounded hover:bg-orange-300"
                        >
                          Copiar todos
                        </button>
                      </div>
                      {emailsInvalidos.length > 0 ? (
                        emailsInvalidos.map((item, idx) => (
                          <div key={idx} className="text-xs text-orange-700 mb-1 font-mono">
                            {item.email}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-orange-600">Carregando...</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
        <strong>Como funciona:</strong> O worker sincroniza automaticamente apenas leads novos desde a última sincronização.
        Você pode definir o intervalo (30min a 6h) ou executar manualmente a qualquer momento.
      </div>
    </div>
  );
}
