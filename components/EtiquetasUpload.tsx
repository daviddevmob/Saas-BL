'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';

// Serviços ECT disponíveis (Correios) - códigos do contrato
const SERVICOS_ECT = [
  { code: '201501', name: 'IMPRESSO Normal Módico' },
  { code: '3298', name: 'PAC Prata/Ouro/Platinum' },
  { code: '3220', name: 'SEDEX Prata/Ouro/Platinum' },
];

const DEFAULT_SERVICO_ECT = '201501';

// Função para verificar se é produto físico (contém "físico", "fisico" ou "kit" no nome)
function isPhysicalProduct(productName: string): boolean {
  const name = productName.toLowerCase();
  // Verifica "físico" (com acento), "fisico" (sem acento) ou "kit"
  return name.includes('físico') || name.includes('fisico') || name.includes('kit');
}

// Colunas do CSV Hotmart (formato atualizado 2025)
const HOTMART_COLUMNS = {
  productName: 'Produto',
  productCode: 'Código do produto',
  transaction: 'Código da transação',
  status: 'Status da transação',
  name: 'Comprador(a)',
  document: 'Documento',
  email: 'Email do(a) Comprador(a)',
  phone: 'Telefone',
  zip: 'Código postal',
  city: 'Cidade',
  state: 'Estado / Província',
  neighborhood: 'Bairro',
  country: 'País',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  saleDate: 'Data da transação',
  totalPrice: 'Valor de compra com impostos',
};


interface PhysicalSale {
  transaction: string;
  productName: string;
  productCode: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  state: string;
  neighborhood: string;
  country: string;
  address: string;
  number: string;
  complement: string;
  saleDate: string;
  totalPrice: string;
  selected: boolean;
  servicoEct: string; // Código do serviço ECT (Correios)
  etiqueta?: string; // Etiqueta já gerada (se existir)
  etiquetaStatus?: 'pending' | 'generated' | 'error';
}

interface EtiquetaRecord {
  transactionId: string;
  etiqueta: string;
  destinatario: string;
  createdAt: Timestamp;
}

function parseCSV(text: string): Record<string, string>[] {
  // Remover BOM (Byte Order Mark) se existir
  const cleanText = text.replace(/^\uFEFF/, '');

  const rows: Record<string, string>[] = [];
  let pos = 0;
  const len = cleanText.length;
  let headers: string[] = [];

  // Detectar separador automaticamente (vírgula ou ponto e vírgula)
  const firstLine = cleanText.split(/[\r\n]/)[0];
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const separator = semicolonCount > commaCount ? ';' : ',';

  function parseField(): string {
    let field = '';
    while (pos < len && (cleanText[pos] === ' ' || cleanText[pos] === '\t')) pos++;

    if (pos < len && cleanText[pos] === '"') {
      pos++;
      while (pos < len) {
        if (cleanText[pos] === '"') {
          if (pos + 1 < len && cleanText[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          field += cleanText[pos];
          pos++;
        }
      }
      while (pos < len && cleanText[pos] !== separator && cleanText[pos] !== '\n' && cleanText[pos] !== '\r') pos++;
    } else {
      while (pos < len && cleanText[pos] !== separator && cleanText[pos] !== '\n' && cleanText[pos] !== '\r') {
        field += cleanText[pos];
        pos++;
      }
    }
    return field.trim();
  }

  function parseLine(): string[] {
    const fields: string[] = [];
    while (pos < len) {
      fields.push(parseField());
      if (pos >= len || cleanText[pos] === '\n' || cleanText[pos] === '\r') break;
      if (cleanText[pos] === separator) pos++;
    }
    while (pos < len && (cleanText[pos] === '\n' || cleanText[pos] === '\r')) pos++;
    return fields;
  }

  if (pos < len) headers = parseLine();
  if (headers.length === 0) return [];

  while (pos < len) {
    const fields = parseLine();
    if (fields.length === 0 || (fields.length === 1 && fields[0] === '')) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = fields[i] !== undefined ? fields[i] : '';
    }
    rows.push(row);
  }
  return rows;
}

// Buscar etiquetas já geradas no Firebase
async function fetchExistingLabels(transactionIds: string[]): Promise<Map<string, string>> {
  const labelsMap = new Map<string, string>();

  if (transactionIds.length === 0) return labelsMap;

  try {
    // Firebase tem limite de 30 itens por query "in", então dividimos em chunks
    const chunks = [];
    for (let i = 0; i < transactionIds.length; i += 30) {
      chunks.push(transactionIds.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      const q = query(
        collection(db, 'etiquetas'),
        where('transactionId', 'in', chunk)
      );
      const snapshot = await getDocs(q);
      snapshot.forEach(doc => {
        const data = doc.data() as EtiquetaRecord;
        labelsMap.set(data.transactionId, data.etiqueta);
      });
    }
  } catch (err) {
    console.error('Erro ao buscar etiquetas existentes:', err);
  }

  return labelsMap;
}

// Salvar etiqueta no Firebase
async function saveLabel(transactionId: string, etiqueta: string, destinatario: string): Promise<void> {
  try {
    await addDoc(collection(db, 'etiquetas'), {
      transactionId,
      etiqueta,
      destinatario,
      createdAt: Timestamp.now(),
    });
  } catch (err) {
    console.error('Erro ao salvar etiqueta:', err);
    throw err;
  }
}

export default function EtiquetasUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [physicalSales, setPhysicalSales] = useState<PhysicalSale[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, success: 0, errors: 0 });
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'generated'>('all');
  const [selectedServicoEct, setSelectedServicoEct] = useState(DEFAULT_SERVICO_ECT);
  const [showServiceConfirmModal, setShowServiceConfirmModal] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<PhysicalSale[]>([]);
  const [searchText, setSearchText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Desmarcar todas ao mudar filtro ou busca
  const handleFilterChange = (newFilter: 'all' | 'pending' | 'generated') => {
    setStatusFilter(newFilter);
    setPhysicalSales(prev => prev.map(s => ({ ...s, selected: false })));
  };

  // Função para remover acentos e normalizar texto
  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  // Verificar se busca tem texto válido (não só espaços)
  const hasSearchText = searchText.trim().length > 0;

  // Filtrar vendas pelo status e busca
  const filteredSales = physicalSales.filter(sale => {
    // Primeiro filtrar por status
    let passesStatusFilter = true;
    if (statusFilter === 'pending') passesStatusFilter = sale.etiquetaStatus !== 'generated';
    if (statusFilter === 'generated') passesStatusFilter = sale.etiquetaStatus === 'generated';

    if (!passesStatusFilter) return false;

    // Se tem texto de busca, filtrar por ele
    if (hasSearchText) {
      const searchNormalized = normalizeText(searchText);
      const fieldsToSearch = [
        sale.name,
        sale.email,
        sale.phone,
        sale.transaction,
        sale.productName,
        sale.city,
        sale.state,
        sale.neighborhood,
        sale.address,
        sale.zip,
        sale.etiqueta || '',
      ];
      return fieldsToSearch.some(field =>
        normalizeText(field).includes(searchNormalized)
      );
    }

    return true;
  });

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

      // Filtrar vendas de produtos físicos com status Aprovado ou Completo
      const filtered = rows
        .filter(row => {
          const productName = row[HOTMART_COLUMNS.productName] || '';
          const status = row[HOTMART_COLUMNS.status] || '';

          // Verificar se é produto físico (contém "físico" ou "fisico" no nome)
          const isPhysical = isPhysicalProduct(productName);

          // Verificar status
          const isValidStatus = status === 'Aprovado' || status === 'Completo';

          return isPhysical && isValidStatus;
        })
        .map(row => ({
          transaction: row[HOTMART_COLUMNS.transaction] || '',
          productName: row[HOTMART_COLUMNS.productName] || '',
          productCode: row[HOTMART_COLUMNS.productCode] || '',
          name: row[HOTMART_COLUMNS.name] || '',
          document: row[HOTMART_COLUMNS.document] || '',
          email: row[HOTMART_COLUMNS.email] || '',
          phone: row[HOTMART_COLUMNS.phone] || '',
          zip: row[HOTMART_COLUMNS.zip] || '',
          city: row[HOTMART_COLUMNS.city] || '',
          state: row[HOTMART_COLUMNS.state] || '',
          neighborhood: row[HOTMART_COLUMNS.neighborhood] || '',
          country: row[HOTMART_COLUMNS.country] || '',
          address: row[HOTMART_COLUMNS.address] || '',
          number: row[HOTMART_COLUMNS.number] || '',
          complement: row[HOTMART_COLUMNS.complement] || '',
          saleDate: row[HOTMART_COLUMNS.saleDate] || '',
          totalPrice: row[HOTMART_COLUMNS.totalPrice] || '',
          selected: false,
          servicoEct: DEFAULT_SERVICO_ECT,
          etiquetaStatus: 'pending' as const,
        }));

      // Buscar etiquetas já geradas
      const transactionIds = filtered.map(s => s.transaction);
      const existingLabels = await fetchExistingLabels(transactionIds);

      // Marcar as que já têm etiqueta
      const withLabels = filtered.map(sale => {
        const existingLabel = existingLabels.get(sale.transaction);
        if (existingLabel) {
          return {
            ...sale,
            selected: false,
            etiqueta: existingLabel,
            etiquetaStatus: 'generated' as const,
          };
        }
        return sale;
      });

      setPhysicalSales(withLabels);
    } catch (err) {
      setError('Erro ao processar o arquivo CSV');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const toggleSelectAll = () => {
    // IDs das vendas filtradas atualmente
    const filteredIds = new Set(filteredSales.map(s => s.transaction));
    // Verificar se todas as filtradas estão selecionadas
    const allFilteredSelected = filteredSales.length > 0 && filteredSales.every(s => s.selected);
    // Marcar/desmarcar apenas as filtradas
    setPhysicalSales(physicalSales.map(s =>
      filteredIds.has(s.transaction) ? { ...s, selected: !allFilteredSelected } : s
    ));
  };

  const toggleSelect = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, selected: !s.selected } : s
    ));
  };

  // Obter nome do serviço pelo código
  const getServicoName = (code: string) => {
    return SERVICOS_ECT.find(s => s.code === code)?.name || code;
  };

  const selectedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus !== 'generated').length;
  const alreadyGeneratedCount = physicalSales.filter(s => s.etiquetaStatus === 'generated').length;
  const selectedGeneratedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated').length;

  // Exportar CSV para importação de rastreio na Hotmart
  const handleExportTrackingCSV = () => {
    const selectedSales = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (selectedSales.length === 0) return;

    // Header do CSV conforme modelo Hotmart
    const header = 'Código da compra,Data da compra,Produto,Responsável pela entrega,Código de rastreio,Status de envio,Link de rastreio';

    // Gerar linhas
    const rows = selectedSales.map(sale => {
      const codigoCompra = sale.transaction;
      const dataCompra = sale.saleDate.split(' ')[0]; // Só a data, sem hora
      const produto = `"${sale.productName.replace(/"/g, '""')}"`;
      const responsavel = 'Envio Próprio';
      const codigoRastreio = sale.etiqueta || '';
      const statusEnvio = 'Enviado';
      const linkRastreio = 'https://rastreamento.correios.com.br'; // Link fixo sem código

      return `${codigoCompra},${dataCompra},${produto},${responsavel},${codigoRastreio},${statusEnvio},${linkRastreio}`;
    });

    const csvContent = [header, ...rows].join('\n');

    // Download do arquivo
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
    const selectedSales = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);
    const selectedLabels = selectedSales.map(s => s.etiqueta as string);

    if (selectedLabels.length === 0) return;

    // 1. WEBHOOK - Disparar para admin receber notificação (mesmo só imprimindo)
    try {
      const etiquetasParaWebhook = selectedSales.map(sale => ({
        codigo: sale.etiqueta || '',
        transactionId: sale.transaction,
        produto: sale.productName,
        destinatario: {
          nome: sale.name,
          telefone: sale.phone,
          email: sale.email,
          cidade: sale.city,
          uf: sale.state,
        },
      }));

      const webhookPayload = {
        etiquetas: [], // Nenhuma nova - cliente não recebe
        etiquetasAdmin: etiquetasParaWebhook, // Admin recebe todas as selecionadas
      };

      console.log('========== WEBHOOK IMPRIMIR (só já geradas) ==========');
      console.log('Enviando para /api/webhook/etiquetas:');
      console.log('- Etiquetas para admin:', etiquetasParaWebhook.length);
      console.log(JSON.stringify(webhookPayload, null, 2));
      console.log('======================================================');

      await fetch('/api/webhook/etiquetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      });
    } catch (webhookErr) {
      console.error('Erro ao disparar webhook:', webhookErr);
    }

    // 2. IMPRIMIR - Baixar PDF
    try {
      const response = await fetch('/api/vipp/imprimir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: selectedLabels }),
      });

      if (response.headers.get('content-type')?.includes('application/pdf')) {
        // Download direto do PDF
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `etiquetas-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const result = await response.json();
        if (result.downloadUrl) {
          // Abrir URL direta em nova aba
          window.open(result.downloadUrl, '_blank');
        } else if (result.error) {
          alert(`Erro ao imprimir: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Erro ao imprimir etiquetas:', err);
      alert('Erro ao baixar PDF das etiquetas');
    }
  };

  // Função que realmente executa a geração (chamada após confirmação)
  const executeGeneration = async (toGenerate: PhysicalSale[]) => {
    // Etiquetas já geradas que estão selecionadas (para incluir no PDF)
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Etiquetas recém-geradas (para webhook do cliente)
    const etiquetasNovas: Array<{
      codigo: string;
      transactionId: string;
      produto: string;
      destinatario: { nome: string; telefone: string; email: string; cidade: string; uf: string };
    }> = [];

    // Todas as etiquetas para o PDF (novas + já geradas selecionadas)
    const todasEtiquetasParaPdf: string[] = alreadyGenerated.map(s => s.etiqueta as string);

    // Etiquetas já geradas (para webhook do admin, sem enviar para cliente)
    const etiquetasJaGeradas: Array<{
      codigo: string;
      transactionId: string;
      produto: string;
      destinatario: { nome: string; telefone: string; email: string; cidade: string; uf: string };
    }> = alreadyGenerated.map(sale => ({
      codigo: sale.etiqueta || '',
      transactionId: sale.transaction,
      produto: sale.productName,
      destinatario: {
        nome: sale.name,
        telefone: sale.phone,
        email: sale.email,
        cidade: sale.city,
        uf: sale.state,
      },
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
          // Chamar API do ViPP
          const response = await fetch('/api/vipp/postar-objeto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionId: sale.transaction,
              servicoEct: selectedServicoEct, // Código do serviço ECT selecionado globalmente
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
            // Salvar no Firebase
            await saveLabel(sale.transaction, result.etiqueta, sale.name);

            // Guardar para o webhook (cliente vai receber)
            etiquetasNovas.push({
              codigo: result.etiqueta,
              transactionId: sale.transaction,
              produto: sale.productName,
              destinatario: {
                nome: sale.name,
                telefone: sale.phone,
                email: sale.email,
                cidade: sale.city,
                uf: sale.state,
              },
            });

            // Adicionar ao PDF
            todasEtiquetasParaPdf.push(result.etiqueta);

            // Atualizar estado local
            setPhysicalSales(prev => prev.map(s =>
              s.transaction === sale.transaction
                ? { ...s, etiqueta: result.etiqueta, etiquetaStatus: 'generated', selected: false }
                : s
            ));

            successCount++;
          } else {
            throw new Error(result.error || 'Erro desconhecido');
          }
        } catch (err) {
          console.error(`Erro ao gerar etiqueta para ${sale.transaction}:`, err);

          setPhysicalSales(prev => prev.map(s =>
            s.transaction === sale.transaction
              ? { ...s, etiquetaStatus: 'error' }
              : s
          ));

          errorCount++;
        }

        setGenerationProgress(prev => ({ ...prev, success: successCount, errors: errorCount }));

        // Delay entre requisições para não sobrecarregar a API
        if (i < toGenerate.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      setIsGenerating(false);
    }

    // Desmarcar as já geradas que foram incluídas
    setPhysicalSales(prev => prev.map(s =>
      s.etiquetaStatus === 'generated' ? { ...s, selected: false } : s
    ));

    // 1. WEBHOOK - Disparar imediatamente após gerar
    // Admin recebe TODAS, Cliente recebe apenas as NOVAS
    const todasParaAdmin = [...etiquetasNovas, ...etiquetasJaGeradas];

    if (todasParaAdmin.length > 0) {
      try {
        const webhookPayload = {
          etiquetas: etiquetasNovas, // Cliente recebe só as novas
          etiquetasAdmin: todasParaAdmin, // Admin recebe todas
        };

        console.log('========== WEBHOOK ETIQUETAS ==========');
        console.log('Enviando para /api/webhook/etiquetas:');
        console.log('- Etiquetas novas (cliente vai receber):', etiquetasNovas.length);
        console.log('- Etiquetas total (admin vai receber):', todasParaAdmin.length);
        console.log(JSON.stringify(webhookPayload, null, 2));
        console.log('=======================================');

        const webhookResponse = await fetch('/api/webhook/etiquetas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });

        const webhookResult = await webhookResponse.json();
        console.log('Resposta do webhook:', webhookResult);
      } catch (webhookErr) {
        console.error('Erro ao disparar webhook N8N:', webhookErr);
      }
    }

    // 2. IMPRIMIR - Baixar PDF local após webhook
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
          a.download = `etiquetas-${Date.now()}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          const result = await response.json();
          if (result.downloadUrl) {
            window.open(result.downloadUrl, '_blank');
          }
        }
      } catch (err) {
        console.error('Erro ao baixar PDF:', err);
        alert(`Etiquetas geradas: ${todasEtiquetasParaPdf.join(', ')}\n\nUse o botão "Imprimir" para baixar o PDF.`);
      }
    }
  };

  // Função chamada pelo botão - mostra confirmação se necessário
  const handleGenerateLabels = () => {
    const toGenerate = physicalSales.filter(s => s.selected && s.etiquetaStatus !== 'generated');
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Se só tem etiquetas já geradas, executa direto (só vai reimprimir)
    if (toGenerate.length === 0) {
      executeGeneration([]);
      return;
    }

    // Mostra modal de confirmação para novas etiquetas
    setPendingGeneration(toGenerate);
    setShowServiceConfirmModal(true);
  };

  // Confirmar geração após modal
  const confirmGeneration = () => {
    setShowServiceConfirmModal(false);
    executeGeneration(pendingGeneration);
    setPendingGeneration([]);
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

  // Estado inicial - Upload
  if (physicalSales.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-6">
          <h2
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 600,
              fontSize: '1.25rem',
              color: '#314158',
              marginBottom: '0.5rem',
            }}
          >
            Gerar Etiquetas de Envio
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Importe o CSV da Hotmart para gerar etiquetas dos produtos físicos
          </p>
        </div>

        {/* Upload Area */}
        <div
          className={`rounded-2xl border-2 border-dashed p-8 transition-all cursor-pointer ${
            isDragging
              ? 'border-orange-400 bg-orange-50'
              : 'border-slate-300 hover:border-orange-400 hover:bg-orange-50/50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-4">
            {/* Hotmart Logo */}
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center overflow-hidden">
              <Image
                src="/lojas/hotmart.jpeg"
                alt="Hotmart"
                width={48}
                height={48}
                className="object-cover"
              />
            </div>

            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#64748B' }}>
                  Processando CSV...
                </p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p
                    style={{
                      fontFamily: 'var(--font-public-sans)',
                      fontWeight: 600,
                      fontSize: '1rem',
                      color: '#314158',
                    }}
                  >
                    Arraste o CSV da Hotmart aqui
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.875rem',
                      color: '#64748B',
                      marginTop: '0.25rem',
                    }}
                  >
                    ou clique para selecionar
                  </p>
                </div>

                <button
                  className="px-4 py-2 rounded-lg text-white transition"
                  style={{
                    backgroundColor: '#F97316',
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                  }}
                >
                  Selecionar Arquivo
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#DC2626' }}>
              {error}
            </p>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <h3
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 600,
              fontSize: '0.875rem',
              color: '#314158',
              marginBottom: '0.5rem',
            }}
          >
            Produtos Físicos
          </h3>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.8125rem',
              color: '#64748B',
            }}
          >
            Todos os produtos que contenham <strong>"Físico"</strong> ou <strong>"Kit"</strong> no nome serão detectados automaticamente.
          </p>
        </div>
      </div>
    );
  }

  // Estado com vendas carregadas - Tabela
  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-public-sans)',
              fontWeight: 600,
              fontSize: '1.25rem',
              color: '#314158',
              marginBottom: '0.25rem',
            }}
          >
            Vendas de Produtos Físicos
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            {fileName} • {physicalSales.length} vendas físicas de {totalRows} total
            {alreadyGeneratedCount > 0 && (
              <span className="ml-2 text-green-600">
                ({alreadyGeneratedCount} já gerada{alreadyGeneratedCount !== 1 ? 's' : ''})
              </span>
            )}
          </p>
        </div>

        {/* Filtros e Botões */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Campo de Busca */}
          <div className="relative">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar..."
              className="pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              style={{
                fontFamily: 'var(--font-inter)',
                width: '180px',
                color: '#1E293B',
              }}
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>

          {/* Filtro de Status */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => handleFilterChange('all')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'all' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Todas ({physicalSales.length})
            </button>
            <button
              onClick={() => handleFilterChange('pending')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'pending' && !hasSearchText
                  ? 'bg-white text-slate-900 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Pendentes ({physicalSales.filter(s => s.etiquetaStatus !== 'generated').length})
            </button>
            <button
              onClick={() => handleFilterChange('generated')}
              disabled={hasSearchText}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'generated' && !hasSearchText
                  ? 'bg-white text-green-700 shadow-sm'
                  : hasSearchText
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Geradas ({alreadyGeneratedCount})
            </button>
            {hasSearchText && (
              <span
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-orange-100 text-orange-700"
                style={{ fontFamily: 'var(--font-inter)' }}
              >
                Busca ({filteredSales.length})
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
          <button
            onClick={resetUpload}
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition disabled:opacity-50"
            style={{
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Novo Upload
          </button>
          {/* Botões para etiquetas já geradas (quando só tem já geradas selecionadas, sem pendentes) */}
          {selectedGeneratedCount > 0 && selectedCount === 0 && (
            <>
              <button
                onClick={handlePrintLabels}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg text-white transition hover:opacity-90 flex items-center gap-2"
                style={{
                  backgroundColor: '#22C55E',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Imprimir {selectedGeneratedCount} PDF{selectedGeneratedCount !== 1 ? 's' : ''}
              </button>
              <button
                onClick={handleExportTrackingCSV}
                className="px-4 py-2 rounded-lg text-white transition hover:opacity-90 flex items-center gap-2"
                style={{
                  backgroundColor: '#3B82F6',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exportar CSV Rastreio
              </button>
            </>
          )}
          {/* Dropdown de serviço + Botão gerar (quando tem pendentes) */}
          {selectedCount > 0 && (
            <>
              <div className="flex items-center gap-2">
                <label
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    color: '#64748B',
                    fontWeight: 500,
                  }}
                >
                  Serviço:
                </label>
                <select
                  value={selectedServicoEct}
                  onChange={(e) => setSelectedServicoEct(e.target.value)}
                  disabled={isGenerating}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white disabled:opacity-50"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    color: '#314158',
                  }}
                >
                  {SERVICOS_ECT.map(servico => (
                    <option key={servico.code} value={servico.code}>
                      {servico.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleGenerateLabels}
                disabled={isGenerating}
                className={`px-4 py-2 rounded-lg text-white transition ${
                  isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                }`}
                style={{
                  backgroundColor: '#F97316',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                {isGenerating
                  ? `Gerando ${generationProgress.current}/${generationProgress.total}...`
                  : selectedGeneratedCount > 0
                    ? `Gerar ${selectedCount} + incluir ${selectedGeneratedCount} no PDF`
                    : `Gerar ${selectedCount} Etiqueta${selectedCount !== 1 ? 's' : ''}`
                }
              </button>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Progress Bar */}
      {isGenerating && (
        <div className="mb-4 p-4 rounded-xl bg-orange-50 border border-orange-200">
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#314158' }}>
              Gerando etiquetas...
            </span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#64748B' }}>
              {generationProgress.success} sucesso, {generationProgress.errors} erros
            </span>
          </div>
          <div className="w-full h-2 bg-orange-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={physicalSales.length > 0 && physicalSales.every(s => s.selected)}
                    onChange={toggleSelectAll}
                    disabled={isGenerating}
                    className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Status
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Cliente
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Produto
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Endereço
                </th>
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontFamily: 'var(--font-inter)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#64748B',
                    textTransform: 'uppercase',
                  }}
                >
                  Data
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => (
                <tr
                  key={sale.transaction}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition ${
                    sale.etiquetaStatus === 'generated' ? 'bg-green-50/50' : ''
                  } ${sale.etiquetaStatus === 'error' ? 'bg-red-50/50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={sale.selected}
                      onChange={() => toggleSelect(sale.transaction)}
                      disabled={isGenerating}
                      className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {sale.etiquetaStatus === 'generated' ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Gerada
                        </span>
                        <span
                          className="text-xs text-green-600 font-mono"
                          title={sale.etiqueta}
                        >
                          {sale.etiqueta}
                        </span>
                      </div>
                    ) : sale.etiquetaStatus === 'error' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Erro
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        Pendente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontWeight: 500,
                          fontSize: '0.875rem',
                          color: '#314158',
                        }}
                      >
                        {sale.name}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        {sale.email}
                      </p>
                      {sale.phone && (
                        <p
                          style={{
                            fontFamily: 'var(--font-inter)',
                            fontSize: '0.75rem',
                            color: '#64748B',
                          }}
                        >
                          {sale.phone}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8125rem',
                        color: '#314158',
                        maxWidth: '200px',
                      }}
                      className="truncate"
                      title={sale.productName}
                    >
                      {sale.productName}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div style={{ maxWidth: '250px' }}>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.8125rem',
                          color: '#314158',
                        }}
                        className="truncate"
                        title={`${sale.address}, ${sale.number}${sale.complement ? ` - ${sale.complement}` : ''}`}
                      >
                        {sale.address}, {sale.number}
                        {sale.complement && ` - ${sale.complement}`}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        {sale.neighborhood} - {sale.city}/{sale.state}
                      </p>
                      <p
                        style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.75rem',
                          color: '#64748B',
                        }}
                      >
                        CEP: {sale.zip}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      style={{
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.8125rem',
                        color: '#314158',
                      }}
                    >
                      {sale.saleDate.split(' ')[0]}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredSales.length === 0 && physicalSales.length > 0 && (
        <div className="mt-8 text-center py-12">
          <p
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '1rem',
              color: '#64748B',
            }}
          >
            {statusFilter === 'pending'
              ? 'Nenhuma etiqueta pendente'
              : statusFilter === 'generated'
                ? 'Nenhuma etiqueta gerada ainda'
                : 'Nenhuma venda de produto físico encontrada no CSV'
            }
          </p>
        </div>
      )}

      {/* Modal de Confirmação de Serviço */}
      {showServiceConfirmModal && (
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
          onClick={() => setShowServiceConfirmModal(false)}
        >
          <div
            style={{
              backgroundColor: '#FFF',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '450px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: '0 0 1rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '1.125rem',
                fontWeight: 600,
                color: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
              }}
            >
              {selectedServicoEct === DEFAULT_SERVICO_ECT
                ? 'Confirmar Geração de Etiquetas'
                : '⚠️ Atenção: Serviço Diferente!'
              }
            </h3>

            <div
              style={{
                backgroundColor: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#FFF7ED' : '#FEF2F2',
                border: `1px solid ${selectedServicoEct === DEFAULT_SERVICO_ECT ? '#FDBA74' : '#FECACA'}`,
                borderRadius: '0.5rem',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <p
                style={{
                  margin: '0 0 0.5rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#64748B',
                }}
              >
                Serviço selecionado:
              </p>
              <p
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
                }}
              >
                {getServicoName(selectedServicoEct)}
              </p>
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#314158',
                }}
              >
                <strong>{pendingGeneration.length}</strong> etiqueta{pendingGeneration.length !== 1 ? 's' : ''} será{pendingGeneration.length !== 1 ? 'ão' : ''} gerada{pendingGeneration.length !== 1 ? 's' : ''}.
              </p>
            </div>

            {selectedServicoEct !== DEFAULT_SERVICO_ECT && (
              <p
                style={{
                  margin: '0 0 1rem 0',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#DC2626',
                  fontWeight: 500,
                }}
              >
                Você está gerando etiquetas com um serviço diferente do padrão (IMPRESSO Normal Módico). Confirma?
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowServiceConfirmModal(false)}
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
                onClick={confirmGeneration}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: selectedServicoEct === DEFAULT_SERVICO_ECT ? '#F97316' : '#DC2626',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                Confirmar e Gerar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
