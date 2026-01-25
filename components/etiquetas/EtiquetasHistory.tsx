'use client';

import { useState, useEffect, useRef } from 'react';
import { EtiquetaRecord, TrackingEvent } from './types';
import { fetchLabelsHistory, updateLabelTrackingStatus, fetchLabelByTransactionId } from './services';
import { formatDateBR, formatPhone } from './utils';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

interface EtiquetasHistoryProps {
  onImportClick: () => void;
}

export default function EtiquetasHistory({ onImportClick }: EtiquetasHistoryProps) {
  const [labels, setLabels] = useState<EtiquetaRecord[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  
  // Estados para Sincronização
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [currentSyncLabel, setCurrentSyncLabel] = useState<string | null>(null);
  const stopSyncRef = useRef(false);
  const [syncClickCount, setSyncClickCount] = useState(0);
  const [showSyncWarning, setShowSyncWarning] = useState(false);

  // Estado para Modal de Detalhes
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedLabelDetails, setSelectedLabelDetails] = useState<EtiquetaRecord | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Estado para Modal de Busca Avulsa
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchAvulsoCode, setSearchAvulsoCode] = useState('');
  const [isSearchingAvulso, setIsSearchingAvulso] = useState(false);
  const [searchTab, setSearchTab] = useState<'tracking' | 'order'>('tracking'); // 'tracking' ou 'order'

  // Filtro de status
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_transit' | 'delivered'>('all');

  // Carregar dados iniciais
  useEffect(() => {
    loadData();
    return () => { stopSyncRef.current = true; }; // Cleanup
  }, []);

  const loadData = async (loadMore = false) => {
    if (!loadMore) setLoading(true);
    
    const docToStart = loadMore ? lastDoc : null;
    const { labels: newLabels, lastVisible } = await fetchLabelsHistory(100, docToStart);
    
    if (loadMore) {
      setLabels(prev => [...prev, ...newLabels]);
    } else {
      setLabels(newLabels);
    }
    
    setLastDoc(lastVisible);
    setHasMore(!!lastVisible && newLabels.length === 100);
    setLoading(false);
  };

  const handleSearch = (term: string) => setSearchTerm(term);

  const filteredLabels = labels.filter(label => {
    // Filtro de busca por texto
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch = (
        label.transactionId.toLowerCase().includes(search) ||
        label.destinatario.toLowerCase().includes(search) ||
        label.etiqueta.toLowerCase().includes(search) ||
        (label.productName && label.productName.toLowerCase().includes(search))
      );
      if (!matchesSearch) return false;
    }

    // Filtro de status
    if (statusFilter !== 'all') {
      const status = (label.trackingStatus || '').toLowerCase();

      if (statusFilter === 'delivered') {
        // Entregues
        return status.includes('entregue');
      } else if (statusFilter === 'in_transit') {
        // Em trânsito (tem status mas não está entregue)
        return status && !status.includes('entregue') && !status.includes('aguardando');
      } else if (statusFilter === 'pending') {
        // Pendentes (sem status ou aguardando postagem)
        return !status || status.includes('aguardando');
      }
    }

    return true;
  });

  const toggleSelectAll = () => {
    if (selectedLabels.size === filteredLabels.length && filteredLabels.length > 0) {
      setSelectedLabels(new Set());
    } else {
      setSelectedLabels(new Set(filteredLabels.map(l => l.etiqueta)));
    }
  };

  const toggleSelect = (etiqueta: string) => {
    const newSelected = new Set(selectedLabels);
    if (newSelected.has(etiqueta)) {
      newSelected.delete(etiqueta);
    } else {
      newSelected.add(etiqueta);
    }
    setSelectedLabels(newSelected);
  };

  const handlePrint = async (labelsToPrint: EtiquetaRecord[]) => {
    if (isPrinting || labelsToPrint.length === 0) return;
    setIsPrinting(true);
    
    try {
      const etiquetasCodigos = labelsToPrint.map(l => l.etiqueta);
      const response = await fetch('/api/vipp/imprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: etiquetasCodigos }),
      });

      if (response.headers.get('content-type')?.includes('application/pdf')) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        let filename = `etiquetas-${Date.now()}.pdf`;
        if (labelsToPrint.length === 1) {
          const label = labelsToPrint[0];
          const safeName = label.destinatario.replace(/[^a-zA-Z0-9]/g, '_');
          filename = `${label.transactionId}_${label.etiqueta}_${safeName}.pdf`;
        } else {
          const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          filename = `Lote_Etiquetas_${dateStr}.pdf`;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const result = await response.json();
        if (result.downloadUrl) {
          try {
            let filename = `etiquetas-${Date.now()}.pdf`;
            if (labelsToPrint.length === 1) {
              const label = labelsToPrint[0];
              const safeName = label.destinatario.replace(/[^a-zA-Z0-9]/g, '_');
              filename = `${label.transactionId}_${label.etiqueta}_${safeName}.pdf`;
            } else {
              const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
              filename = `Lote_Etiquetas_${dateStr}.pdf`;
            }

            const proxyResponse = await fetch('/api/download-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: result.downloadUrl, filename }),
            });

            if (proxyResponse.ok) {
              const blob = await proxyResponse.blob();
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              document.body.removeChild(a);
            } else {
              window.open(result.downloadUrl, '_blank');
            }
          } catch (e) {
            window.open(result.downloadUrl, '_blank');
          }
        } else {
          alert('Erro ao gerar PDF');
        }
      }
    } catch (err) {
      console.error('Erro ao imprimir:', err);
      alert('Erro ao tentar imprimir etiqueta');
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrintSelected = () => {
    const selectedRecords = labels.filter(l => selectedLabels.has(l.etiqueta));
    handlePrint(selectedRecords);
  };

  // --- Sincronização de Rastreio (em lote) ---
  const handleSyncTracking = async () => {
    // Se já está sincronizando, conta os cliques e mostra aviso
    if (isSyncing) {
      const newCount = syncClickCount + 1;
      setSyncClickCount(newCount);

      if (newCount >= 2) {
        setShowSyncWarning(true);
        // Esconde o aviso após 3 segundos
        setTimeout(() => setShowSyncWarning(false), 3000);
      }

      // Só para se clicar 3 vezes ou mais
      if (newCount >= 3) {
        stopSyncRef.current = true;
        setIsSyncing(false);
        setSyncClickCount(0);
        setShowSyncWarning(false);
      }
      return;
    }

    // Reset do contador ao iniciar nova sincronização
    setSyncClickCount(0);

    const labelsToSync = filteredLabels.filter(l =>
      !l.trackingStatus ||
      !l.trackingStatus.toLowerCase().includes('entregue')
    );

    if (labelsToSync.length === 0) {
      alert('Todas as etiquetas visíveis já foram entregues ou atualizadas.');
      return;
    }

    setIsSyncing(true);
    stopSyncRef.current = false;
    setSyncProgress({ current: 0, total: labelsToSync.length });

    // Dividir em lotes de 50 (limite da API dos Correios)
    const BATCH_SIZE = 50;
    const batches: EtiquetaRecord[][] = [];
    for (let i = 0; i < labelsToSync.length; i += BATCH_SIZE) {
      batches.push(labelsToSync.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (stopSyncRef.current) break;

      const batch = batches[batchIndex];
      const codigos = batch.map(l => l.etiqueta);

      setCurrentSyncLabel(`Lote ${batchIndex + 1}/${batches.length} (${codigos.length} códigos)`);

      try {
        const res = await fetch('/api/rastreio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigos })
        });
        const data = await res.json();

        if (data.resultados && Array.isArray(data.resultados)) {
          // Atualizar cada etiqueta com o resultado
          for (const resultado of data.resultados) {
            if (stopSyncRef.current) break;

            const eventos = resultado.eventos || [];
            const status = resultado.status;
            const codigo = resultado.codigo;

            if (status) {
              // Atualizar estado local
              setLabels(prev => prev.map(l =>
                l.etiqueta === codigo
                  ? { ...l, trackingStatus: status, trackingEvents: eventos }
                  : l
              ));
              // Salvar no Firebase
              await updateLabelTrackingStatus(codigo, status, eventos);
            }

            processedCount++;
            setSyncProgress(prev => ({ ...prev, current: processedCount }));
          }
        }
      } catch (err) {
        console.error('Erro ao sync rastreio em lote:', err);
      }

      // Delay entre lotes para evitar rate limiting
      if (batchIndex < batches.length - 1 && !stopSyncRef.current) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setIsSyncing(false);
    setCurrentSyncLabel(null);
  };

  const openDetails = async (label: EtiquetaRecord) => {
    setSelectedLabelDetails(label);
    setShowDetailsModal(true);
    setIsLoadingDetails(true);

    try {
      const res = await fetch(`/api/rastreio?codigo=${label.etiqueta}`);
      const data = await res.json();

      if (data.status) {
        const eventos = data.eventos || [];
        const updatedLabel = { ...label, trackingStatus: data.status, trackingEvents: eventos };

        // Atualiza o modal
        setSelectedLabelDetails(updatedLabel);

        // Atualiza a lista
        setLabels(prev => prev.map(l =>
          l.etiqueta === label.etiqueta
            ? { ...l, trackingStatus: data.status, trackingEvents: eventos }
            : l
        ));

        // Salva no Firebase
        await updateLabelTrackingStatus(label.etiqueta, data.status, eventos);
      }
    } catch (err) {
      console.error('Erro ao buscar detalhes:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // --- Busca Avulsa ---
  const handleSearchAvulso = async () => {
    if (!searchAvulsoCode.trim()) return;
    console.log('[Busca Avulsa] Iniciando...');
    setIsSearchingAvulso(true);

    try {
      let codeToTrack = searchAvulsoCode.trim();
      let labelRecord: EtiquetaRecord | null = null;

      console.log(`[Busca Avulsa] Buscando por: "${codeToTrack}", na aba: "${searchTab}"`);

      if (searchTab === 'order') {
        console.log('[Busca Avulsa] Buscando no Firebase pelo ID do pedido...');
        labelRecord = await fetchLabelByTransactionId(codeToTrack);
        if (labelRecord) {
          codeToTrack = labelRecord.etiqueta;
          console.log(`[Busca Avulsa] Etiqueta encontrada: ${codeToTrack}`);
        } else {
          alert('Pedido não encontrado na base de dados.');
          setIsSearchingAvulso(false);
          console.log('[Busca Avulsa] Pedido não encontrado no Firebase. Interrompido.');
          return;
        }
      } else {
        labelRecord = labels.find(l => l.etiqueta === codeToTrack) || null;
        console.log('[Busca Avulsa] Buscando na lista local. Encontrado:', !!labelRecord);
      }

      console.log(`[Busca Avulsa] Chamando API de rastreio para: ${codeToTrack}`);
      const res = await fetch(`/api/rastreio?codigo=${codeToTrack}`);
      const data = await res.json();
      console.log('[Busca Avulsa] Resposta da API:', data);

      // Exibir XML bruto no console apenas se estiver em localhost
      if (window.location.hostname === 'localhost' && data.debug_xml) {
        console.log('[DEBUG VIPP XML RAW]:');
        console.log(data.debug_xml);
      }

      if (res.ok && data.eventos && data.eventos.length > 0) {
        const eventos = data.eventos;
        
        if (labelRecord) {
          setLabels(prev => prev.map(l => 
            l.etiqueta === codeToTrack 
              ? { ...l, trackingStatus: data.status, trackingEvents: eventos } 
              : l
          ));
          await updateLabelTrackingStatus(codeToTrack, data.status, eventos);
          
          openDetails({
            ...labelRecord,
            trackingStatus: data.status,
            trackingEvents: eventos
          });
        } else {
          openDetails({
            transactionId: 'Avulso',
            etiqueta: codeToTrack,
            destinatario: 'Cliente Externo',
            createdAt: null as any,
            trackingStatus: data.status,
            trackingEvents: eventos
          });
        }
        setShowSearchModal(false);
        setSearchAvulsoCode('');
      } else {
        const msg = data.status || data.error || 'Rastreio não encontrado ou sem informações no ViPP.';
        alert(`Retorno da API: ${msg}`);
      }

    } catch (err) {
      console.error('Erro na busca avulsa:', err);
      alert('Erro ao buscar informações.');
    } finally {
      console.log('[Busca Avulsa] Finalizado.');
      setIsSearchingAvulso(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 font-public-sans">
            Histórico de Etiquetas
          </h2>
          <p className="text-sm text-slate-500 font-inter mt-1">
            Gerencie e acompanhe suas entregas
          </p>
        </div>
        
        <div className="flex gap-2">
          {/* Botão Rastrear Avulso */}
          <button
            onClick={() => setShowSearchModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition-colors shadow-sm text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Rastrear
          </button>

          {/* Botão Sincronizar */}
          <div className="relative">
            <button
              onClick={handleSyncTracking}
              className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg font-medium transition-colors shadow-sm text-sm ${
                isSyncing
                  ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {isSyncing ? (
                <>
                  <div className="w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  Parar ({syncProgress.current}/{syncProgress.total})
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
                  </svg>
                  Sincronizar Status
                </>
              )}
            </button>

            {/* Aviso de sincronização em andamento */}
            {showSyncWarning && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Aguarde a sincronização terminar
                </div>
              </div>
            )}
          </div>

          {selectedLabels.size > 0 && (
            <button
              onClick={handlePrintSelected}
              disabled={isPrinting}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50 text-sm"
            >
              {isPrinting ? 'Gerando...' : `Imprimir (${selectedLabels.size})`}
            </button>
          )}
          
          <button
            onClick={onImportClick}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Importar
          </button>
        </div>
      </div>

      {/* Barra de Busca e Filtros */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Filtrar histórico..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 pl-4 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-inter"
        />

        {/* Filtros de Status */}
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
              statusFilter === 'pending'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Pendentes
          </button>
          <button
            onClick={() => setStatusFilter('in_transit')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
              statusFilter === 'in_transit'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Em trânsito
          </button>
          <button
            onClick={() => setStatusFilter('delivered')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-l border-slate-300 ${
              statusFilter === 'delivered'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Entregues
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={filteredLabels.length > 0 && selectedLabels.size === filteredLabels.length}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter">Data</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter">Etiqueta</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter">Destinatário</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter">Status Entrega</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter text-center">Envio</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && labels.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  <div className="flex justify-center items-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin"></div>
                    Carregando...
                  </div>
                </td>
              </tr>
            ) : filteredLabels.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-inter">
                  Nenhuma etiqueta encontrada.
                </td>
              </tr>
            ) : (
              filteredLabels.map((label) => (
                <tr 
                  key={label.etiqueta} 
                  className={`hover:bg-slate-50 transition-colors ${selectedLabels.has(label.etiqueta) ? 'bg-blue-50/30' : ''}`}
                >
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(label.etiqueta)}
                      onChange={() => toggleSelect(label.etiqueta)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 font-inter whitespace-nowrap">
                    {label.createdAt ? formatDateBR(label.createdAt.toDate().toISOString()) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-700 font-mono">
                    <div className="flex flex-col">
                      <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => openDetails(label)}>
                        {label.etiqueta}
                      </span>
                      <span className="text-[10px] text-slate-400 font-inter">{label.transactionId}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 font-inter">
                    <div className="font-medium text-slate-700">{label.destinatario}</div>
                    <div className="text-xs text-slate-400 truncate max-w-[150px]">{label.productName || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-inter">
                    {currentSyncLabel === label.etiqueta ? (
                      <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                        Atualizando...
                      </span>
                    ) : label.trackingStatus ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        label.trackingStatus.toLowerCase().includes('entregue')
                          ? 'bg-green-100 text-green-700'
                          : label.trackingStatus.toLowerCase().includes('aguardando')
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {label.trackingStatus}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 font-inter text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">
                      {label.envioNumero || 1}/{label.enviosTotal || 1}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openDetails(label)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded transition-colors"
                        title="Ver detalhes"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      
                      <button
                        onClick={() => handlePrint([label])}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
                      >
                        Imprimir
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && !searchTerm && (
        <div className="mt-4 text-center">
          <button
            onClick={() => loadData(true)}
            disabled={loading}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Carregando...' : 'Carregar mais antigas'}
          </button>
        </div>
      )}

      {/* MODAL DE BUSCA AVULSA (COM ABAS) */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowSearchModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex border-b border-slate-200">
              <button
                className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
                  searchTab === 'tracking' 
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' 
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => { setSearchTab('tracking'); setSearchAvulsoCode(''); }}
              >
                Rastreio Correios
              </button>
              <button
                className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
                  searchTab === 'order' 
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' 
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => { setSearchTab('order'); setSearchAvulsoCode(''); }}
              >
                Código do Pedido
              </button>
            </div>

            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-2 font-public-sans">
                {searchTab === 'tracking' ? 'Buscar por Rastreio' : 'Buscar por Pedido'}
              </h3>
              <p className="text-sm text-slate-600 mb-4 font-inter">
                {searchTab === 'tracking' 
                  ? 'Digite o código de rastreio (ex: AA123456789BR) para ver o status.' 
                  : 'Digite o ID do pedido (ex: HP123456) para encontrar a etiqueta.'}
              </p>
              <input
                type="text"
                value={searchAvulsoCode}
                onChange={(e) => setSearchAvulsoCode(e.target.value)}
                placeholder={searchTab === 'tracking' ? 'AA123456789BR' : 'HP123456'}
                className="w-full border border-slate-300 rounded-lg p-3 text-slate-700 mb-4 focus:ring-2 focus:ring-blue-500 outline-none font-inter uppercase"
                onKeyDown={(e) => e.key === 'Enter' && handleSearchAvulso()}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowSearchModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium text-sm transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSearchAvulso}
                  disabled={isSearchingAvulso || !searchAvulsoCode.trim()}
                  className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSearchingAvulso ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES DE RASTREIO */}
      {showDetailsModal && selectedLabelDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDetailsModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-800 font-public-sans">Rastreamento</h3>
                  {isLoadingDetails && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                      <div className="w-2 h-2 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Atualizando...
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 font-mono font-medium mt-1">{selectedLabelDetails.etiqueta}</p>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {isLoadingDetails && (!selectedLabelDetails.trackingEvents || selectedLabelDetails.trackingEvents.length === 0) ? (
                <div className="px-8 py-16 text-center text-slate-500">
                  <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-sm">Buscando informações de rastreio...</p>
                </div>
              ) : !selectedLabelDetails.trackingEvents || selectedLabelDetails.trackingEvents.length === 0 ? (
                <div className="px-8 py-16 text-center text-slate-500">
                  <p className="mb-2">Nenhuma movimentação registrada.</p>
                  <p className="text-xs">O objeto pode ainda não ter sido postado.</p>
                </div>
              ) : (
                <div className="relative pl-12 pr-8 py-8">
                  {/* Linha vertical */}
                  <div className="absolute left-8 top-8 bottom-8 w-0.5 bg-slate-200"></div>

                  {selectedLabelDetails.trackingEvents.map((event, index) => (
                    <div key={`${event.data}-${event.hora}-${index}`} className="relative mb-8 last:mb-0">
                      {/* Bolinha */}
                      <div className={`absolute -left-[22px] mt-1.5 w-3 h-3 rounded-full border-2 ${
                        index === 0
                          ? event.status.toLowerCase().includes('entregue')
                            ? 'bg-green-500 border-green-100'
                            : 'bg-blue-500 border-blue-100'
                          : 'bg-slate-300 border-white'
                      } z-10 box-content`}></div>

                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1">
                          {event.data} às {event.hora} {event.local && `• ${event.local}`}
                        </p>
                        <p className={`text-sm font-medium ${index === 0 ? 'text-slate-800' : 'text-slate-600'}`}>
                          {event.status}
                        </p>
                        {event.subStatus && event.subStatus.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {event.subStatus.map((sub, i) => (
                              <p key={i} className="text-xs text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-100 inline-block">
                                {sub}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-8 py-5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <a
                href={`https://rastreamento.correios.com.br/app/index.php?objeto=${selectedLabelDetails.etiqueta}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium hover:underline flex items-center gap-1.5"
              >
                Ver no site dos Correios
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
