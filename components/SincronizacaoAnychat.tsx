'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, limit, doc } from 'firebase/firestore';

interface SyncJob {
  id: string;
  tipo: string;
  status: string;
  total: number;
  processados: number;
  matches: number;
  tagsAplicadas: number;
  semMatch: number;
  erros: number;
  totalAnychat?: number;
  leadsComTags?: number;
  fase?: number;
  automatico?: boolean;
  criadoEm: string;
  atualizadoEm: string;
  mensagem: string;
}

interface WorkerConfig {
  enabled: boolean;
  sincronizando: boolean;
  intervalMinutes: number;
  proximaExecucao: string | null;
  ultimaSyncTerminada: string | null;
}

export default function SincronizacaoAnychat() {
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [workerConfig, setWorkerConfig] = useState<WorkerConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [syncDisparado, setSyncDisparado] = useState(false);

  // Listener para config do worker
  useEffect(() => {
    const configRef = doc(db, 'configuracoes', 'sync_datacrazy_anychat_config');
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setWorkerConfig(snapshot.data() as WorkerConfig);
      } else {
        setWorkerConfig({
          enabled: false,
          sincronizando: false,
          intervalMinutes: 60,
          proximaExecucao: null,
          ultimaSyncTerminada: null,
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // Reset flag quando proximaExecucao muda
  useEffect(() => {
    setSyncDisparado(false);
  }, [workerConfig?.proximaExecucao]);

  // Countdown timer + Auto-trigger
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
        if (!workerConfig.sincronizando && !syncDisparado) {
          setCountdown('Iniciando...');
          setSyncDisparado(true);
          fetch('/api/cron/sync-datacrazy-anychat')
            .then(res => res.json())
            .then(data => console.log('[SyncAnychat] Auto disparado:', data))
            .catch(err => console.error('[SyncAnychat] Erro auto:', err));
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

  // Listener para jobs (filtra client-side para evitar composite index)
  useEffect(() => {
    const q = query(
      collection(db, 'jobs_sincronizacao'),
      orderBy('criadoEm', 'desc'),
      limit(30)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as SyncJob))
        .filter(j => j.tipo === 'datacrazy-anychat-cron')
        .slice(0, 10);
      setJobs(jobsData);
    });

    return () => unsubscribe();
  }, []);

  // Toggle worker
  const toggleWorker = async (enabled: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/cron/sync-datacrazy-anychat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          enabled,
          intervalMinutes: workerConfig?.intervalMinutes || 60,
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

  // Sync manual
  const syncAgora = async () => {
    setLoading(true);
    setError(null);

    try {
      fetch('/api/cron/sync-datacrazy-anychat?manual=true')
        .then(res => res.json())
        .then(data => {
          if (!data.success && data.message !== 'Sincronização já em andamento') {
            console.log('[SyncAnychat] Resultado:', data);
          }
        })
        .catch(err => console.error('[SyncAnychat] Erro:', err));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  // Cancelar job
  const cancelarJob = async (jobId: string) => {
    try {
      await fetch('/api/cron/sync-datacrazy-anychat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', jobId }),
      });
    } catch (err) {
      console.error('Erro ao cancelar:', err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processando': return 'bg-blue-100 text-blue-800';
      case 'concluido': return 'bg-green-100 text-green-800';
      case 'cancelado': return 'bg-yellow-100 text-yellow-800';
      case 'erro': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getFaseLabel = (fase?: number) => {
    switch (fase) {
      case 1: return 'Carregando DataCrazy';
      case 2: return 'Aplicando tags AnyChat';
      case 3: return 'Finalizado';
      default: return '';
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
            <span className="text-2xl text-slate-400">&rarr;</span>
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">DataCrazy &rarr; AnyChat (Tags)</h2>
            <p className="text-sm text-slate-500">
              Sincroniza tags dos leads DataCrazy para contatos AnyChat
            </p>
          </div>
        </div>

        {/* Status do Worker */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${workerConfig?.enabled ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
            <div>
              <p className="font-medium text-slate-800">Worker Automático</p>
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

        {/* Botões Sync Agora / Cancelar */}
        <div className="flex items-center gap-3">
          {hasActiveJob || workerConfig?.sincronizando ? (
            <button
              onClick={() => cancelarJob('')}
              className="px-5 py-2.5 rounded-lg font-medium transition-colors bg-red-600 text-white hover:bg-red-700"
            >
              Cancelar Sync
            </button>
          ) : (
            <button
              onClick={syncAgora}
              disabled={loading}
              className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${
                loading
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Sincronizar Agora
            </button>
          )}
          <span className="text-sm text-slate-500">
            {hasActiveJob || workerConfig?.sincronizando ? 'Sincronização em andamento' : 'Sincroniza todas as tags (full sync)'}
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
              const isProcessando = job.status === 'processando';
              const percentual = job.total > 0
                ? Math.floor(
                    job.fase === 1
                      ? (job.processados / job.total) * 50
                      : 50 + ((job.matches + job.semMatch) / (job.totalAnychat || 1)) * 50
                  )
                : 0;

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
                         job.status === 'erro' ? 'Erro' : job.status}
                      </span>
                      {isProcessando && job.fase && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                          {getFaseLabel(job.fase)}
                        </span>
                      )}
                      {job.automatico && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Auto
                        </span>
                      )}
                      <span className="text-sm text-slate-500">
                        {formatDate(job.criadoEm)}
                      </span>
                    </div>
                    {isProcessando && (
                      <button
                        onClick={() => cancelarJob(job.id)}
                        className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {/* Barra de Progresso */}
                  {isProcessando && (
                    <div className="mb-3">
                      <div className="flex justify-between text-sm text-slate-600 mb-1">
                        <span>{job.mensagem}</span>
                        <span>{Math.min(percentual, 100)}%</span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${Math.min(percentual, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Estatísticas */}
                  <div className="flex flex-wrap gap-4 text-sm mb-2">
                    {job.total > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        <span className="text-slate-600">DataCrazy: {job.total.toLocaleString()}</span>
                      </div>
                    )}
                    {(job.leadsComTags || 0) > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                        <span className="text-slate-600">Com tags: {(job.leadsComTags || 0).toLocaleString()}</span>
                      </div>
                    )}
                    {(job.totalAnychat || 0) > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-slate-600">AnyChat: {(job.totalAnychat || 0).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span className="text-slate-600">Matches: {job.matches}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                      <span className="text-slate-600">Tags aplicadas: {job.tagsAplicadas}</span>
                    </div>
                    {job.erros > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        <span className="text-slate-600">Erros: {job.erros}</span>
                      </div>
                    )}
                  </div>

                  {/* Mensagem */}
                  {!isProcessando && (
                    <p className="text-sm text-slate-500 truncate">{job.mensagem}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
        <strong>Como funciona:</strong> O sync carrega todos os leads do DataCrazy que possuem tags,
        depois percorre os contatos do AnyChat comparando por telefone. Quando encontra um match,
        aplica as tags no contato do AnyChat. Tags duplicadas não são criadas (o AnyChat detecta por label).
      </div>
    </div>
  );
}
