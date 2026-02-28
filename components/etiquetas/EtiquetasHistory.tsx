'use client';

import { useState, useEffect, useRef } from 'react';
import { EtiquetaRecord, TrackingEvent } from './types';
import { fetchLabelsHistory, updateLabelTrackingStatus, fetchLabelByTransactionId, saveLabel, loadEtiquetasSettings, markWhatsappSent, markRetiradaNotificado } from './services';
import { formatDateBR, formatPhone } from './utils';
import { SERVICOS_ECT, DEFAULT_SERVICO_ECT } from './constants';
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

  // Estados para Modal de Reenvio
  const [showReenvioModal, setShowReenvioModal] = useState(false);
  const [reenvioServico, setReenvioServico] = useState(DEFAULT_SERVICO_ECT);
  const [isGeneratingReenvio, setIsGeneratingReenvio] = useState(false);
  const [reenvioProgress, setReenvioProgress] = useState({ current: 0, total: 0, success: 0, errors: 0 });

  // Modal de aviso (sem dados de endereço)
  const [showNoDataModal, setShowNoDataModal] = useState(false);
  const [noDataLabels, setNoDataLabels] = useState<string[]>([]);

  // Estado para Modal de Retirada (WhatsApp)
  const [showRetiradaModal, setShowRetiradaModal] = useState(false);
  const [retiradaLabel, setRetiradaLabel] = useState<EtiquetaRecord | null>(null);
  const [retiradaMensagem, setRetiradaMensagem] = useState('');
  const [isSendingRetirada, setIsSendingRetirada] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Configurações do sistema
  const [useTestCredentials, setUseTestCredentials] = useState(false);
  const [sendToN8n, setSendToN8n] = useState(true);
  const [adminPhone, setAdminPhone] = useState('5585987080090');
  const [clientPhoneOverride, setClientPhoneOverride] = useState('');

  // Carregar configurações
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await loadEtiquetasSettings();
      if (settings) {
        setUseTestCredentials(settings.useTestCredentials || false);
        setSendToN8n(settings.sendToN8n !== false);
        setAdminPhone(settings.adminPhone || '5585987080090');
        setClientPhoneOverride(settings.clientPhoneOverride || '');
      }
    };
    loadSettings();
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    loadData();
    return () => { stopSyncRef.current = true; }; // Cleanup
  }, []);

  // Verifica se o status indica que o objeto foi postado nos Correios
  const isStatusPostado = (status: string): boolean => {
    if (!status) return false;
    const s = status.toLowerCase();
    // Se tem status e NÃO está aguardando postagem, considera postado
    return s.length > 0 && !s.includes('aguardando') && !s.includes('não encontrado') && !s.includes('objeto não encontrado');
  };

  // Normaliza telefone para formato WhatsApp BR (5511999999999)
  // Retorna string limpa ou null se inválido
  const normalizarTelefoneBR = (telefone: string | undefined): string | null => {
    if (!telefone) return null;
    const digits = telefone.replace(/\D/g, '');
    if (digits.length === 0) return null;

    // 11 dígitos (DDD + 9 dígitos) → adiciona 55
    if (digits.length === 11 && digits[2] === '9') return `55${digits}`;
    // 13 dígitos já com 55 + DDD + 9 dígitos
    if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') return digits;
    // 10 dígitos (DDD + 8 dígitos fixo) → não é celular WhatsApp
    if (digits.length === 10) return null;
    // 12 dígitos (55 + DDD + 8 dígitos) → fixo, não é WhatsApp
    if (digits.length === 12 && digits.startsWith('55')) return null;

    // Qualquer outro formato → inválido para WhatsApp BR
    return null;
  };

  // Verifica se o status indica "aguardando retirada"
  const isAguardandoRetirada = (status: string): boolean => {
    return !!status && status.toLowerCase().includes('aguardando retirada');
  };

  // Conta tentativas de entrega frustradas nos eventos de rastreio
  const contarTentativasEntrega = (events: TrackingEvent[] | undefined): number => {
    if (!events) return 0;
    return events.filter(e => {
      const s = e.status.toLowerCase();
      return s.includes('não foi possível') || s.includes('tentativa de entrega') || s.includes('carteiro não atendido') || s.includes('ausente');
    }).length;
  };

  // Monta mensagem de retirada nos Correios
  const buildMensagemRetirada = (label: EtiquetaRecord): string => {
    const dest = label.destinatarioData;
    const nome = dest?.nome || label.destinatario;
    const etiqueta = label.etiqueta;
    const link = `https://rastreamento.correios.com.br/app/index.php?objeto=${etiqueta}`;

    return `🚨 ${nome}, O seu pedido exige ação imediata.\n\n` +
      `📌 O entregador não conseguiu concluir a entrega do seu pacote.\n\n` +
      `Verifique agora o status do rastreio e entre em contato com a unidade dos Correios responsável pela sua região para combinar a retirada antes que o pacote seja devolvido ao remetente.\n\n` +
      `📦 Código de rastreio: ${etiqueta}\n\n` +
      `🔗 Acompanhe o status: ${link}`;
  };

  // Envia mensagem genérica de WhatsApp para um telefone
  const enviarWhatsAppMensagem = async (telefone: string, mensagem: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone, mensagem }),
      });
      if (response.ok) {
        return { success: true };
      } else {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      return { success: false, error: errorMsg };
    }
  };

  // Função para enviar WhatsApp ao cliente via API
  const enviarWhatsAppCliente = async (label: EtiquetaRecord): Promise<{ success: boolean; error?: string }> => {
    const telefoneNormalizado = normalizarTelefoneBR(label.destinatarioData?.telefone);
    if (!telefoneNormalizado) {
      const raw = label.destinatarioData?.telefone || '(vazio)';
      return { success: false, error: `Telefone inválido: ${raw}` };
    }

    try {
      const dest = label.destinatarioData!;
      const enderecoParts = [dest.logradouro, dest.numero, dest.complemento].filter(Boolean).join(', ');
      const enderecoCompleto = `${enderecoParts} — ${dest.cidade}, ${dest.uf} CEP ${dest.cep}`;

      let mensagem = `${dest.nome}, seu pedido foi atualizado.\n\n`;
      mensagem += `📦 Código de rastreio dos Correios: ${label.etiqueta}\n\n`;
      mensagem += `📍 Endereço de envio: ${enderecoCompleto}\n\n`;
      mensagem += `🔗 Acompanhe: https://rastreamento.correios.com.br/`;

      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: telefoneNormalizado,
          mensagem,
        }),
      });

      if (response.ok) {
        console.log(`[WhatsApp] Enviado para ${dest.nome} (${telefoneNormalizado}) - ${label.etiqueta}`);
        return { success: true };
      } else {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        return { success: false, error: errorData.error || `HTTP ${response.status}` };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('[WhatsApp] Erro ao enviar:', errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  // Abrir modal de retirada para envio manual
  const openRetiradaModal = (label: EtiquetaRecord) => {
    const labelComEventos = label;
    setRetiradaLabel(labelComEventos);
    setRetiradaMensagem(buildMensagemRetirada(labelComEventos));
    setShowRetiradaModal(true);
    setCopiedField(null);
  };

  // Copiar texto para clipboard
  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // Enviar mensagem de retirada manualmente
  const handleSendRetirada = async () => {
    if (!retiradaLabel) return;
    setIsSendingRetirada(true);

    const telefone = normalizarTelefoneBR(retiradaLabel.destinatarioData?.telefone);
    if (!telefone) {
      alert('Telefone do destinatário inválido para WhatsApp.');
      setIsSendingRetirada(false);
      return;
    }

    const result = await enviarWhatsAppMensagem(telefone, retiradaMensagem);
    await markRetiradaNotificado(retiradaLabel.etiqueta, result.success, result.error);

    setLabels(prev => prev.map(l =>
      l.etiqueta === retiradaLabel.etiqueta
        ? { ...l, retiradaNotificado: result.success, retiradaErro: result.error }
        : l
    ));

    setIsSendingRetirada(false);

    if (result.success) {
      setShowRetiradaModal(false);
    } else {
      alert(`Erro ao enviar: ${result.error || 'Erro desconhecido'}`);
    }
  };

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

              // Verificar se deve enviar WhatsApp ao cliente (automático quando postado)
              const labelOriginal = batch.find(l => l.etiqueta === codigo);
              if (
                labelOriginal?.whatsappEnviado === false &&
                isStatusPostado(status)
              ) {
                const telefoneNorm = normalizarTelefoneBR(labelOriginal.destinatarioData?.telefone);
                if (!telefoneNorm) {
                  // Telefone inválido/vazio → marca como erro no Firebase e segue
                  const raw = labelOriginal.destinatarioData?.telefone || '(vazio)';
                  const erro = `Telefone inválido: ${raw}`;
                  console.warn(`[WhatsApp] ${codigo} — ${erro}, pulando envio`);
                  await markWhatsappSent(codigo, false, erro);
                  setLabels(prev => prev.map(l =>
                    l.etiqueta === codigo
                      ? { ...l, whatsappEnviado: false, whatsappErro: erro }
                      : l
                  ));
                } else {
                  console.log(`[WhatsApp] Etiqueta ${codigo} postada, enviando para ${telefoneNorm}...`);
                  const result = await enviarWhatsAppCliente(labelOriginal);
                  await markWhatsappSent(codigo, result.success, result.error);
                  setLabels(prev => prev.map(l =>
                    l.etiqueta === codigo
                      ? { ...l, whatsappEnviado: result.success, whatsappErro: result.error }
                      : l
                  ));
                }
              }

              // Verificar se deve enviar notificação de retirada (automático)
              // Só para etiquetas criadas a partir de 12/02/2026
              const DATA_CORTE_RETIRADA = new Date('2026-02-12T00:00:00');
              const labelCriadaEm = labelOriginal?.createdAt?.toDate?.();
              const isEtiquetaRecente = labelCriadaEm && labelCriadaEm >= DATA_CORTE_RETIRADA;
              if (
                labelOriginal &&
                isEtiquetaRecente &&
                !labelOriginal.retiradaNotificado &&
                isAguardandoRetirada(status)
              ) {
                const labelComEventos = { ...labelOriginal, trackingEvents: eventos, trackingStatus: status };
                const telefoneNorm = normalizarTelefoneBR(labelOriginal.destinatarioData?.telefone);
                if (!telefoneNorm) {
                  const raw = labelOriginal.destinatarioData?.telefone || '(vazio)';
                  const erro = `Telefone inválido: ${raw}`;
                  console.warn(`[Retirada] ${codigo} — ${erro}, pulando envio`);
                  await markRetiradaNotificado(codigo, false, erro);
                  setLabels(prev => prev.map(l =>
                    l.etiqueta === codigo
                      ? { ...l, retiradaNotificado: false, retiradaErro: erro }
                      : l
                  ));
                } else {
                  const mensagem = buildMensagemRetirada(labelComEventos);
                  console.log(`[Retirada] Etiqueta ${codigo} aguardando retirada, enviando para ${telefoneNorm}...`);
                  const result = await enviarWhatsAppMensagem(telefoneNorm, mensagem);
                  await markRetiradaNotificado(codigo, result.success, result.error);
                  setLabels(prev => prev.map(l =>
                    l.etiqueta === codigo
                      ? { ...l, retiradaNotificado: result.success, retiradaErro: result.error }
                      : l
                  ));
                }
              }
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

  // --- Reenvio de Etiquetas ---
  const handleOpenReenvioModal = () => {
    // Verificar se as etiquetas selecionadas têm dados do destinatário
    const selectedRecords = labels.filter(l => selectedLabels.has(l.etiqueta));
    const semDados = selectedRecords.filter(l => !l.destinatarioData);

    if (semDados.length > 0) {
      setNoDataLabels(semDados.map(l => l.etiqueta));
      setShowNoDataModal(true);
      return;
    }

    setShowReenvioModal(true);
  };

  const handleGenerateReenvio = async () => {
    const selectedRecords = labels.filter(l => selectedLabels.has(l.etiqueta) && l.destinatarioData);

    if (selectedRecords.length === 0) {
      alert('Nenhuma etiqueta válida selecionada para reenvio.');
      return;
    }

    setIsGeneratingReenvio(true);
    setReenvioProgress({ current: 0, total: selectedRecords.length, success: 0, errors: 0 });

    let successCount = 0;
    let errorCount = 0;
    const novasEtiquetas: string[] = [];
    const etiquetasParaWebhook: any[] = [];

    // 1. GERAR ETIQUETAS NA VIPP
    for (let i = 0; i < selectedRecords.length; i++) {
      const label = selectedRecords[i];
      setReenvioProgress(prev => ({ ...prev, current: i + 1 }));

      try {
        const dest = label.destinatarioData!;
        const novoTransactionId = `${label.transactionId}-REENVIO-${Date.now()}`;

        const response = await fetch('/api/vipp/postar-objeto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: novoTransactionId,
            servicoEct: reenvioServico,
            useTestCredentials,
            destinatario: {
              nome: dest.nome,
              documento: dest.documento || '',
              logradouro: dest.logradouro || '',
              numero: dest.numero || 'S/N',
              complemento: dest.complemento || '',
              bairro: dest.bairro || '',
              cidade: dest.cidade || '',
              uf: dest.uf || '',
              cep: dest.cep?.replace(/\D/g, '') || '',
              telefone: dest.telefone || '',
              email: dest.email || '',
            },
          }),
        });

        const result = await response.json();

        if (result.success && result.etiqueta) {
          // Calcular novo número de envio
          const envioNumero = (label.envioNumero || 1) + 1;
          const enviosTotal = (label.enviosTotal || 1) + 1;

          // 2. SALVAR NO FIREBASE
          await saveLabel(
            label.transactionId,
            result.etiqueta,
            dest.nome,
            envioNumero,
            enviosTotal,
            label.mergedTransactionIds,
            label.produtos,
            `Reenvio da etiqueta ${label.etiqueta}`,
            label.productName,
            reenvioServico,
            dest.cep,
            dest
          );

          novasEtiquetas.push(result.etiqueta);

          // Preparar dados para webhook
          etiquetasParaWebhook.push({
            codigo: result.etiqueta,
            transactionId: label.transactionId,
            produto: label.productName || 'Reenvio',
            dataPedido: new Date().toISOString().split('T')[0],
            destinatario: {
              nome: dest.nome,
              telefone: dest.telefone || '',
              email: dest.email || '',
              logradouro: dest.logradouro || '',
              numero: dest.numero || 'S/N',
              complemento: dest.complemento || '',
              bairro: dest.bairro || '',
              cidade: dest.cidade || '',
              uf: dest.uf || '',
              cep: dest.cep?.replace(/\D/g, '') || '',
            },
            envioNumero,
            enviosTotal,
            isEnvioParcial: true,
            observacaoEnvio: `Reenvio da etiqueta ${label.etiqueta}`,
            isReenvio: true,
            etiquetaOriginal: label.etiqueta,
          });

          successCount++;
        } else {
          console.error('Erro ao gerar reenvio:', result.error);
          errorCount++;
        }
      } catch (err) {
        console.error('Erro ao gerar reenvio:', err);
        errorCount++;
      }

      // Delay entre gerações
      if (i < selectedRecords.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setReenvioProgress(prev => ({ ...prev, success: successCount, errors: errorCount }));

    // 3. ENVIAR PARA N8N (WEBHOOK)
    if (sendToN8n && etiquetasParaWebhook.length > 0) {
      try {
        const webhookPayload = {
          etiquetas: etiquetasParaWebhook,
          etiquetasAdmin: etiquetasParaWebhook,
          config: {
            adminPhone,
            clientPhoneOverride: clientPhoneOverride || undefined,
            sendClientNotification: false,
            ordemPrioridade: 'novos',
            observacaoGeral: 'Reenvio de etiquetas',
            useTestCredentials,
            isReenvio: true,
          }
        };

        await fetch('/api/webhook/etiquetas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });
        console.log('[Reenvio] Webhook enviado com sucesso');
      } catch (e) {
        console.error('[Reenvio] Erro ao enviar webhook:', e);
      }
    }

    // 4. GERAR PDF DAS ETIQUETAS
    if (novasEtiquetas.length > 0) {
      try {
        const response = await fetch('/api/vipp/imprimir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etiquetas: novasEtiquetas }),
        });

        if (response.headers.get('content-type')?.includes('application/pdf')) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const filename = `Reenvio_Etiquetas_${dateStr}.pdf`;

          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          console.log('[Reenvio] PDF baixado com sucesso');
        } else {
          const result = await response.json();
          if (result.downloadUrl) {
            window.open(result.downloadUrl, '_blank');
          }
        }
      } catch (err) {
        console.error('[Reenvio] Erro ao gerar PDF:', err);
      }
    }

    setIsGeneratingReenvio(false);

    if (successCount > 0) {
      alert(`Reenvio concluído!\n\n✅ ${successCount} etiqueta(s) gerada(s)\n${errorCount > 0 ? `❌ ${errorCount} erro(s)` : ''}\n\n📄 PDF baixado automaticamente\n📱 Webhook enviado para n8n\n\nNovas etiquetas: ${novasEtiquetas.join(', ')}`);

      // Recarregar dados
      await loadData();
      setSelectedLabels(new Set());
    } else {
      alert('Nenhuma etiqueta foi gerada. Verifique os erros no console.');
    }

    setShowReenvioModal(false);
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
            <>
              <button
                onClick={handlePrintSelected}
                disabled={isPrinting}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50 text-sm"
              >
                {isPrinting ? 'Gerando...' : `Imprimir (${selectedLabels.size})`}
              </button>

              <button
                onClick={handleOpenReenvioModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors shadow-sm text-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 1l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                Gerar Reenvio ({selectedLabels.size})
              </button>
            </>
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
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter text-center">WhatsApp</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter text-center">Envio</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider font-inter text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && labels.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  <div className="flex justify-center items-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin"></div>
                    Carregando...
                  </div>
                </td>
              </tr>
            ) : filteredLabels.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-inter">
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
                      isAguardandoRetirada(label.trackingStatus) ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); openRetiradaModal(label); }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                            label.retiradaNotificado
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : label.retiradaErro
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          } cursor-pointer`}
                          title="Clique para notificar o cliente sobre a retirada"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          Aguard. retirada
                        </button>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          label.trackingStatus.toLowerCase().includes('entregue')
                            ? 'bg-green-100 text-green-700'
                            : label.trackingStatus.toLowerCase().includes('aguardando')
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {label.trackingStatus}
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400 text-xs">-</span>
                    )}
                  </td>
                  {/* Coluna WhatsApp - Indicador visual do status de notificação ao cliente */}
                  <td className="px-4 py-3 text-center">
                    {label.whatsappEnviado === undefined ? (
                      // Etiqueta antiga - enviado automaticamente pelo sistema antigo
                      <span
                        className="inline-flex items-center gap-1 text-slate-400"
                        title="Enviado automaticamente (etiqueta antiga)"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                      </span>
                    ) : label.whatsappEnviado === true ? (
                      // Enviado com sucesso (prioridade sobre whatsappErro residual)
                      <span
                        className="inline-flex items-center gap-1 text-green-500"
                        title={label.whatsappEnviadoEm ? `Enviado em ${formatDateBR(label.whatsappEnviadoEm.toDate().toISOString())}` : 'Enviado'}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    ) : label.whatsappErro ? (
                      // Erro ao enviar (whatsappEnviado === false + tem erro)
                      <span
                        className="inline-flex items-center gap-1 text-red-500"
                        title={`Erro: ${label.whatsappErro}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      </span>
                    ) : (
                      // Pendente - aguardando postagem (whatsappEnviado === false, sem erro)
                      <span
                        className="inline-flex items-center gap-1 text-amber-500"
                        title="Aguardando postagem para enviar"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 font-inter text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">
                        {label.envioNumero || 1}/{label.enviosTotal || 1}
                      </span>
                      {label.destinatarioData ? (
                        <span className="text-green-500" title="Pode gerar reenvio">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="text-slate-300" title="Sem dados para reenvio">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                          </svg>
                        </span>
                      )}
                    </div>
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

      {/* MODAL DE REENVIO */}
      {showReenvioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !isGeneratingReenvio && setShowReenvioModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 bg-orange-50">
              <h3 className="text-lg font-semibold text-orange-800 font-public-sans flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 1l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 23l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                Gerar Reenvio
              </h3>
              <p className="text-sm text-orange-600 mt-1">
                {selectedLabels.size} etiqueta(s) selecionada(s) para reenvio
              </p>
            </div>

            <div className="px-8 py-6">
              {/* Aviso */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-amber-800 font-medium flex items-start gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Novas etiquetas serão geradas para os mesmos destinatários. As etiquetas originais continuarão no histórico.
                </p>
              </div>

              {/* Seleção de Serviço */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Tipo de Envio
                </label>
                <select
                  value={reenvioServico}
                  onChange={(e) => setReenvioServico(e.target.value)}
                  disabled={isGeneratingReenvio}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-slate-100"
                >
                  {SERVICOS_ECT.map(servico => (
                    <option key={servico.code} value={servico.code}>
                      {servico.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Lista de etiquetas selecionadas */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Etiquetas que serão reenviadas
                </label>
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {labels.filter(l => selectedLabels.has(l.etiqueta)).map(label => (
                    <div key={label.etiqueta} className="px-4 py-2 text-sm flex justify-between items-center">
                      <div>
                        <span className="font-mono text-slate-600">{label.etiqueta}</span>
                        <span className="text-slate-400 ml-2">→</span>
                        <span className="text-slate-700 ml-2">{label.destinatario}</span>
                      </div>
                      {!label.destinatarioData && (
                        <span className="text-xs text-red-500">Sem dados</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Progresso */}
              {isGeneratingReenvio && (
                <div className="mb-6 bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
                    <span>Gerando etiquetas...</span>
                    <span>{reenvioProgress.current}/{reenvioProgress.total}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(reenvioProgress.current / reenvioProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-8 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setShowReenvioModal(false)}
                disabled={isGeneratingReenvio}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleGenerateReenvio}
                disabled={isGeneratingReenvio}
                className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isGeneratingReenvio ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Gerando...
                  </>
                ) : (
                  'Confirmar Reenvio'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AVISO - SEM DADOS DE ENDEREÇO */}
      {showNoDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNoDataModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header com ícone */}
            <div className="px-8 py-6 bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-800 font-public-sans">
                    Reenvio não disponível
                  </h3>
                  <p className="text-sm text-red-600 mt-0.5">
                    {noDataLabels.length} etiqueta{noDataLabels.length > 1 ? 's' : ''} sem dados de endereço
                  </p>
                </div>
              </div>
            </div>

            {/* Conteúdo */}
            <div className="px-8 py-6">
              <p className="text-slate-600 text-sm mb-4">
                As etiquetas abaixo foram geradas antes da atualização do sistema e não possuem os dados do destinatário salvos. Por isso, não é possível gerar reenvio automático.
              </p>

              {/* Lista de etiquetas */}
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 mb-4 max-h-32 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {noDataLabels.map(etiqueta => (
                    <span key={etiqueta} className="inline-flex items-center px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-mono text-slate-600">
                      {etiqueta}
                    </span>
                  ))}
                </div>
              </div>

              {/* Dica */}
              <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <p className="text-xs text-blue-700">
                  <strong>Dica:</strong> Para reenviar, importe novamente o CSV com os dados do cliente ou gere uma nova etiqueta manualmente pelo sistema de importação.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowNoDataModal(false)}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors text-sm"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE NOTIFICAÇÃO DE RETIRADA */}
      {showRetiradaModal && retiradaLabel && (() => {
        const dest = retiradaLabel.destinatarioData;
        const nome = dest?.nome || retiradaLabel.destinatario;
        const telefone = dest?.telefone || '';
        const telefoneNorm = normalizarTelefoneBR(telefone);
        const enderecoParts = [dest?.logradouro, dest?.numero, dest?.complemento].filter(Boolean).join(', ');
        const enderecoCompleto = dest ? `${enderecoParts} — ${dest.cidade}, ${dest.uf} CEP ${dest.cep}` : '';
        const linkCorreios = `https://rastreamento.correios.com.br/app/index.php?objeto=${retiradaLabel.etiqueta}`;
        const tentativas = contarTentativasEntrega(retiradaLabel.trackingEvents);

        const CopyButton = ({ text, field }: { text: string; field: string }) => (
          <button
            onClick={() => copyToClipboard(text, field)}
            className={`flex-shrink-0 p-1.5 rounded transition-colors ${
              copiedField === field
                ? 'bg-green-100 text-green-600'
                : 'bg-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-200'
            }`}
            title={copiedField === field ? 'Copiado!' : 'Copiar'}
          >
            {copiedField === field ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !isSendingRetirada && setShowRetiradaModal(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 bg-orange-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-orange-800 font-public-sans">
                        Notificar Retirada
                      </h3>
                      <p className="text-xs text-orange-600 font-mono mt-0.5">{retiradaLabel.etiqueta}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRetiradaModal(false)}
                    disabled={isSendingRetirada}
                    className="p-2 hover:bg-orange-100 rounded-full transition-colors text-orange-400 disabled:opacity-50"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {tentativas > 0 && (
                  <div className="mt-3 flex items-center gap-2 bg-orange-100 rounded-lg px-3 py-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A3412" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="text-xs font-medium text-orange-800">
                      {tentativas} tentativa(s) de entrega sem sucesso
                    </span>
                  </div>
                )}
                {retiradaLabel.retiradaNotificado && (
                  <div className="mt-3 flex items-center gap-2 bg-green-100 rounded-lg px-3 py-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-xs font-medium text-green-800">
                      Notificado automaticamente
                    </span>
                  </div>
                )}
              </div>

              {/* Body - scrollable */}
              <div className="overflow-y-auto flex-1 px-6 py-5">
                {/* Dados do Destinatário */}
                <div className="mb-5">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Dados do Destinatário</p>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                    {/* Nome */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-white">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-slate-400 uppercase">Nome</span>
                        <p className="text-sm text-slate-700 font-medium truncate">{nome}</p>
                      </div>
                      <CopyButton text={nome} field="nome" />
                    </div>
                    {/* Telefone */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-white">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-slate-400 uppercase">Telefone</span>
                        <p className={`text-sm font-medium truncate ${telefoneNorm ? 'text-slate-700' : 'text-red-500'}`}>
                          {telefone || '(vazio)'}
                          {!telefoneNorm && telefone && <span className="text-xs ml-1">(inválido)</span>}
                        </p>
                      </div>
                      <CopyButton text={telefone} field="telefone" />
                    </div>
                    {/* Etiqueta */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-white">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-slate-400 uppercase">Etiqueta</span>
                        <p className="text-sm text-slate-700 font-mono font-medium">{retiradaLabel.etiqueta}</p>
                      </div>
                      <CopyButton text={retiradaLabel.etiqueta} field="etiqueta" />
                    </div>
                    {/* Endereço */}
                    {enderecoCompleto && (
                      <div className="flex items-center justify-between px-3 py-2.5 bg-white">
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] text-slate-400 uppercase">Endereço</span>
                          <p className="text-sm text-slate-700 truncate">{enderecoCompleto}</p>
                        </div>
                        <CopyButton text={enderecoCompleto} field="endereco" />
                      </div>
                    )}
                    {/* Link Correios */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-white">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-slate-400 uppercase">Link Correios</span>
                        <a href={linkCorreios} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate block">
                          {linkCorreios}
                        </a>
                      </div>
                      <CopyButton text={linkCorreios} field="link" />
                    </div>
                  </div>
                </div>

                {/* Mensagem editável */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Mensagem</p>
                    <button
                      onClick={() => copyToClipboard(retiradaMensagem, 'mensagem')}
                      className={`text-xs font-medium flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                        copiedField === 'mensagem'
                          ? 'bg-green-100 text-green-600'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {copiedField === 'mensagem' ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                          Copiado!
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copiar
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    value={retiradaMensagem}
                    onChange={(e) => setRetiradaMensagem(e.target.value)}
                    rows={10}
                    className="w-full border border-slate-200 rounded-lg p-3 text-sm text-slate-700 font-inter focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500 truncate">
                  {telefoneNorm ? (
                    <span className="flex items-center gap-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      {telefoneNorm}
                    </span>
                  ) : (
                    <span className="text-red-500">Telefone inválido</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowRetiradaModal(false)}
                    disabled={isSendingRetirada}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSendRetirada}
                    disabled={isSendingRetirada || !telefoneNorm}
                    className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSendingRetirada ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 2L11 13" />
                          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                        Enviar WhatsApp
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
