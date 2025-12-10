'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';

// Produtos físicos da Hotmart (IDs conhecidos)
const PHYSICAL_PRODUCTS = [
  { id: '6201179', name: 'Livro 365 Dias de Branding - Físico + Digital' },
  { id: '6201719', name: 'Livro 100 Maneiras de Humanizar Sem Aparecer - Físico + Digital' },
  { id: '6189914', name: 'Livro 365 Dias de Atendimento - Físico + Digital' },
  { id: '6725257', name: 'Kit BookTudo - 365BR + 365AT + 100M' },
];

// Colunas do CSV Hotmart
const HOTMART_COLUMNS = {
  productName: 'Nome do Produto',
  productCode: 'Código do Produto',
  transaction: 'Transação',
  status: 'Status',
  name: 'Nome',
  document: 'Documento',
  email: 'Email',
  phone: 'Telefone Final',
  zip: 'CEP',
  city: 'Cidade',
  state: 'Estado',
  neighborhood: 'Bairro',
  country: 'País',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  saleDate: 'Data de Venda',
  totalPrice: 'Preço Total',
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
  const rows: Record<string, string>[] = [];
  let pos = 0;
  const len = text.length;
  let headers: string[] = [];

  function parseField(): string {
    let field = '';
    while (pos < len && (text[pos] === ' ' || text[pos] === '\t')) pos++;

    if (pos < len && text[pos] === '"') {
      pos++;
      while (pos < len) {
        if (text[pos] === '"') {
          if (pos + 1 < len && text[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          field += text[pos];
          pos++;
        }
      }
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') pos++;
    } else {
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
        field += text[pos];
        pos++;
      }
    }
    return field.trim();
  }

  function parseLine(): string[] {
    const fields: string[] = [];
    while (pos < len) {
      fields.push(parseField());
      if (pos >= len || text[pos] === '\n' || text[pos] === '\r') break;
      if (text[pos] === ',') pos++;
    }
    while (pos < len && (text[pos] === '\n' || text[pos] === '\r')) pos++;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filtrar vendas pelo status
  const filteredSales = physicalSales.filter(sale => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return sale.etiquetaStatus !== 'generated';
    if (statusFilter === 'generated') return sale.etiquetaStatus === 'generated';
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
      const physicalProductNames = PHYSICAL_PRODUCTS.map(p => p.name.toLowerCase());

      const filtered = rows
        .filter(row => {
          const productName = (row[HOTMART_COLUMNS.productName] || '').toLowerCase();
          const status = row[HOTMART_COLUMNS.status] || '';

          // Verificar se é produto físico
          const isPhysical = physicalProductNames.some(name =>
            productName.includes('físico') ||
            productName.includes('kit booktudo') ||
            productName === name
          );

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
          selected: true,
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
    const allSelected = physicalSales.every(s => s.selected);
    setPhysicalSales(physicalSales.map(s => ({ ...s, selected: !allSelected })));
  };

  const toggleSelect = (transaction: string) => {
    setPhysicalSales(physicalSales.map(s =>
      s.transaction === transaction ? { ...s, selected: !s.selected } : s
    ));
  };

  const selectedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus !== 'generated').length;
  const alreadyGeneratedCount = physicalSales.filter(s => s.etiquetaStatus === 'generated').length;
  const selectedGeneratedCount = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated').length;

  const handlePrintLabels = async () => {
    const selectedLabels = physicalSales
      .filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta)
      .map(s => s.etiqueta as string);

    if (selectedLabels.length === 0) return;

    try {
      // Chamar API de impressão
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

  const handleGenerateLabels = async () => {
    // Etiquetas que precisam ser geradas (pendentes selecionadas)
    const toGenerate = physicalSales.filter(s => s.selected && s.etiquetaStatus !== 'generated');
    // Etiquetas já geradas que estão selecionadas (para incluir no PDF)
    const alreadyGenerated = physicalSales.filter(s => s.selected && s.etiquetaStatus === 'generated' && s.etiqueta);

    if (toGenerate.length === 0 && alreadyGenerated.length === 0) return;

    // Começar com as etiquetas já geradas que foram selecionadas
    const allLabelsForPdf: string[] = alreadyGenerated.map(s => s.etiqueta as string);

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

            // Adicionar à lista para PDF
            allLabelsForPdf.push(result.etiqueta);

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

    // Baixar PDF automaticamente se houver etiquetas
    if (allLabelsForPdf.length > 0) {
      try {
        const response = await fetch('/api/vipp/imprimir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etiquetas: allLabelsForPdf }),
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
        alert(`Etiquetas: ${allLabelsForPdf.join(', ')}\n\nUse o botão "Imprimir" para baixar o PDF.`);
      }
    }
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
            Produtos Físicos Suportados
          </h3>
          <ul className="space-y-1">
            {PHYSICAL_PRODUCTS.map(product => (
              <li
                key={product.id}
                style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8125rem',
                  color: '#64748B',
                }}
              >
                • {product.name}
              </li>
            ))}
          </ul>
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
          {/* Filtro de Status */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Todas ({physicalSales.length})
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'pending'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Pendentes ({physicalSales.filter(s => s.etiquetaStatus !== 'generated').length})
            </button>
            <button
              onClick={() => setStatusFilter('generated')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                statusFilter === 'generated'
                  ? 'bg-white text-green-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              style={{ fontFamily: 'var(--font-inter)' }}
            >
              Geradas ({alreadyGeneratedCount})
            </button>
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
          {/* Botão só imprimir (quando só tem já geradas selecionadas, sem pendentes) */}
          {selectedGeneratedCount > 0 && selectedCount === 0 && (
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
          )}
          {/* Botão gerar (quando tem pendentes, pode incluir já geradas para o PDF) */}
          {selectedCount > 0 && (
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
    </div>
  );
}
