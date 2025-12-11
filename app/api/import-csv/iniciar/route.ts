import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, getDoc, collection } from 'firebase/firestore';
import Papa from 'papaparse';

const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';

function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function safeEmail(val: unknown): string | null {
  const email = safeString(val).toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) return null;
  return email;
}

async function apiRequest(method: string, endpoint: string, body?: unknown) {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${endpoint}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

interface ColumnMap {
  email: string;
  name: string;
  phone: string;
  taxId: string;
  product: string;
  transactionId: string;
  total: string;
  status: string;
  statusPaid: string;
  zip?: string;
  address?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

async function processarRegistro(
  row: Record<string, string>,
  columns: ColumnMap,
  stageId: string,
  platform: string
): Promise<{ status: 'created' | 'exists' | 'skipped'; message: string; email?: string; name?: string }> {
  const email = safeEmail(row[columns.email]);
  const name = safeString(row[columns.name]) || 'Sem nome';
  const productName = safeString(row[columns.product]);
  const transactionId = safeString(row[columns.transactionId]);

  if (!email || !transactionId) {
    return { status: 'skipped', message: 'Sem email ou transactionId', email: email || '', name };
  }

  let phone = safeString(row[columns.phone]);
  if (phone.startsWith('+')) phone = phone.substring(1);
  phone = phone.replace(/\D/g, '');

  const taxId = safeString(row[columns.taxId]).replace(/\D/g, '');

  const zipCode = safeString(row[columns.zip || '']);
  const streetAddress = safeString(row[columns.address || '']);
  const addressNumber = safeString(row[columns.addressNumber || '']);
  const addressComplement = safeString(row[columns.addressComplement || '']);
  const neighborhood = safeString(row[columns.neighborhood || '']);
  const city = safeString(row[columns.city || '']);
  const state = safeString(row[columns.state || '']);

  let fullAddress = streetAddress;
  if (addressNumber) fullAddress += `, ${addressNumber}`;
  if (addressComplement) fullAddress += ` - ${addressComplement}`;
  if (neighborhood) fullAddress += ` - ${neighborhood}`;

  const address = zipCode ? { zip: zipCode, address: fullAddress, city, state, country: 'Brasil' } : undefined;
  const saleValue = parseFloat(safeString(row[columns.total]).replace(',', '.')) || 0;

  let leadId: string | undefined;
  let leadTags: { id: string }[] = [];

  const leadSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(email)}`);

  if (!leadSearch || leadSearch.count === 0) {
    try {
      const newLead = await apiRequest('POST', '/leads', {
        name, email, phone: phone || undefined, taxId: taxId || undefined,
        address: address?.zip ? address : undefined,
        source: `CSV ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      });
      leadId = newLead?.id;
    } catch (createError) {
      const errorMsg = createError instanceof Error ? createError.message : '';
      if (errorMsg.includes('lead-with-same-contact-exists')) {
        const emailMatch = errorMsg.match(/"email":"([^"]+)"/);
        const existingEmail = emailMatch ? emailMatch[1] : null;
        if (existingEmail) {
          const existingSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(existingEmail)}`);
          if (existingSearch?.data?.[0]) {
            leadId = existingSearch.data[0].id;
            leadTags = existingSearch.data[0].tags || [];
          } else throw createError;
        } else throw createError;
      } else throw createError;
    }
  } else {
    const existingLead = leadSearch.data[0];
    leadId = existingLead.id;
    leadTags = existingLead.tags || [];

    const updateData: Record<string, unknown> = {};
    if (phone && !existingLead.phone) updateData.phone = phone;
    if (taxId && !existingLead.taxId) updateData.taxId = taxId;
    if (address?.zip && (!existingLead.address || !existingLead.address.zip)) updateData.address = address;
    if (Object.keys(updateData).length > 0) await apiRequest('PATCH', `/leads/${leadId}`, updateData);
  }

  if (productName && leadId) {
    try {
      const tagSearch = await apiRequest('GET', `/tags?search=${encodeURIComponent(productName)}`);
      if (tagSearch?.data?.[0] && !leadTags.some((t: { id: string }) => t.id === tagSearch.data[0].id)) {
        await apiRequest('PATCH', `/leads/${leadId}`, {
          tags: [...leadTags.map((t: { id: string }) => ({ id: t.id })), { id: tagSearch.data[0].id }]
        });
      }
    } catch { /* ignora */ }
  }

  if (!leadId) return { status: 'skipped', message: 'Sem leadId', email, name };

  const leadBusinesses = await apiRequest('GET', `/leads/${leadId}/businesses`);
  const existingBusiness = leadBusinesses?.data?.find((biz: { externalId?: string }) => biz.externalId === transactionId);

  if (!existingBusiness) {
    await apiRequest('POST', '/businesses', { leadId, stageId, externalId: transactionId, total: saleValue });
    return { status: 'created', message: `Negócio criado: R$ ${saleValue.toFixed(2)}`, email, name };
  }
  return { status: 'exists', message: `Business já existe`, email, name };
}

const CHUNK_SIZE = 5000; // Processar em lotes de 5000 registros

// Processar em background (fire-and-forget, atualiza Firebase)
async function processarEmBackground(
  jobId: string,
  platform: string,
  delay: number,
  stageId: string,
  columns: ColumnMap,
  rows: Record<string, string>[]
) {
  const jobRef = doc(db, 'jobs_importacao', jobId);
  const totalRows = rows.length;

  let processados = 0, sucessos = 0, erros = 0, ignorados = 0;
  let errosDetalhes: Array<{ email: string; name: string; error: string }> = [];
  let ultimaMensagem = '', ultimoPercentual = 0;
  let cancelado = false;

  const updateInterval = Math.max(10, Math.min(500, Math.floor(totalRows / 100)));
  const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

  const atualizarFirebase = async () => {
    const percentualAtual = Math.floor((processados / totalRows) * 100);
    if (percentualAtual > ultimoPercentual || processados % updateInterval === 0) {
      ultimoPercentual = percentualAtual;
      try {
        await updateDoc(jobRef, {
          processados, sucessos, erros, ignorados,
          errosDetalhes: errosDetalhes.slice(-50),
          atualizadoEm: new Date().toISOString(),
          mensagem: ultimaMensagem,
        });
      } catch (err) {
        // Documento foi deletado - parar processamento
        if ((err as { code?: string }).code === 'not-found') {
          console.log('[IMPORT-CSV] Job deletado, parando processamento');
          cancelado = true;
        }
      }
    }
  };

  // Verificar cancelamento em CADA registro
  const verificarCancelamento = async (): Promise<boolean> => {
    try {
      const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists() || jobSnap.data().status === 'cancelado') {
        console.log(`[IMPORT-CSV] Job ${jobId} CANCELADO - parando imediatamente no registro ${processados}`);
        return true;
      }
    } catch (err) {
      console.log(`[IMPORT-CSV] Erro ao verificar cancelamento, parando: ${err}`);
      return true;
    }
    return false;
  };

  for (let chunkIndex = 0; chunkIndex < totalChunks && !cancelado; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalRows);
    const chunk = rows.slice(start, end);

    for (let i = 0; i < chunk.length; i++) {
      // Verificar se foi cancelado ANTES de processar
      if (await verificarCancelamento()) {
        cancelado = true;
        break;
      }

      const row = chunk[i];
      try {
        const result = await processarRegistro(row, columns, stageId, platform);
        processados++;
        if (result.status === 'created') sucessos++;
        else if (result.status === 'skipped') ignorados++;
        ultimaMensagem = `[${processados}/${totalRows}] ${result.email || ''} - ${result.message}`;
      } catch (e) {
        erros++;
        processados++;
        const errorMsg = e instanceof Error ? e.message : 'Erro';
        const email = safeString(row[columns.email]);
        const name = safeString(row[columns.name]);
        errosDetalhes.push({ email, name, error: errorMsg });
        ultimaMensagem = `[${processados}/${totalRows}] ❌ ${email} - ${errorMsg.substring(0, 100)}`;
      }
      await atualizarFirebase();
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }

    // Liberar memória entre chunks
    chunk.length = 0;
  }

  // Se foi cancelado, não atualizar para concluído
  if (cancelado) {
    console.log(`[IMPORT-CSV] Job ${jobId} cancelado/deletado, processamento encerrado`);
    return;
  }

  try {
    await updateDoc(jobRef, {
      status: 'concluido', processados, sucessos, erros, ignorados,
      errosDetalhes: errosDetalhes.slice(-50),
      atualizadoEm: new Date().toISOString(),
      mensagem: `✅ Concluído! Criados: ${sucessos}, Existentes: ${processados - sucessos - erros - ignorados}, Erros: ${erros}, Ignorados: ${ignorados}`,
    });
    console.log(`[IMPORT-CSV] Job ${jobId} concluído com sucesso`);
  } catch (err) {
    console.log(`[IMPORT-CSV] Job ${jobId} - não foi possível atualizar status final (documento deletado)`);
  }
}

// Stage IDs por plataforma (primeiro stage "Lead" de cada pipeline)
const STAGES: Record<string, string> = {
  hubla: '74022307-988f-4a81-a3df-c14b28bd41d9',
  hotmart: '0c2bf45f-1c4b-4730-b02c-286b7c018f29',
  eduzz: '3bbc9611-aa0d-47d5-a755-a9cdcfc453ef',
  kiwify: '491a2794-7576-45d0-8d8e-d5a6855f17e2',
  woo: '2c16fbba-092d-48a8-929b-55c5b9d638cc',
};

// Mapeamento de colunas por plataforma
const COLUMN_MAP: Record<string, {
  email: string;
  name: string;
  phone: string;
  taxId: string;
  product: string;
  transactionId: string;
  total: string;
  status: string;
  statusPaid: string;
  zip?: string;
  address?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}> = {
  hubla: {
    email: 'Email do cliente',
    name: 'Nome do cliente',
    phone: 'Telefone do cliente',
    taxId: 'Documento do cliente',
    product: 'Nome do produto',
    transactionId: 'ID da fatura',
    total: 'Valor total',
    status: 'Status da fatura',
    statusPaid: 'Paga',
    zip: 'Endereço CEP',
    address: 'Endereço Rua',
    city: 'Endereço Cidade',
    state: 'Endereço Estado',
  },
  hotmart: {
    email: 'Email',
    name: 'Nome',
    phone: 'Telefone Final',
    taxId: 'Documento',
    product: 'Nome do Produto',
    transactionId: 'Transação',
    total: 'Preço Total',
    status: 'Status',
    statusPaid: 'Aprovado',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Número',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
  },
  eduzz: {
    email: 'Cliente / E-mail',
    name: 'Cliente / Nome',
    phone: 'Cliente / Fones',
    taxId: 'Cliente / Documento',
    product: 'Produto',
    transactionId: 'Fatura',
    total: 'Valor da Venda',
    status: 'Status',
    statusPaid: 'Paga',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Numero',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'UF',
  },
  kiwify: {
    email: 'Email',
    name: 'Cliente',
    phone: 'Celular',
    taxId: 'CPF / CNPJ',
    product: 'Produto',
    transactionId: 'ID da venda',
    total: 'Valor líquido',
    status: 'Status',
    statusPaid: 'paid',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Numero',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
  },
  woo: {
    email: 'Billing Email Address',
    name: 'Billing First Name',
    phone: 'Billing Phone',
    taxId: '_billing_cpf',
    product: 'Product Name #1',
    transactionId: 'Order ID',
    total: 'Order Total',
    status: 'Order Status',
    statusPaid: 'wc-completed',
    zip: 'Billing Postcode',
    address: 'Billing Address 1',
    addressComplement: 'Billing Address 2',
    city: 'Billing City',
    state: 'Billing State',
    neighborhood: '_billing_neighborhood',
  },
};

function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  console.log(`[IMPORT-CSV] PapaParse: ${result.data.length} linhas, ${result.meta.fields?.length || 0} colunas, delimitador: "${result.meta.delimiter}"`);

  if (result.errors.length > 0) {
    console.log(`[IMPORT-CSV] PapaParse warnings: ${result.errors.slice(0, 3).map(e => e.message).join(', ')}`);
  }

  return result.data;
}

// POST - Criar novo job de importação
export async function POST(request: NextRequest) {
  console.log('[IMPORT-CSV] Iniciando importação...');
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const platform = formData.get('platform') as string || 'hubla';
    const delay = parseInt(formData.get('delay') as string || '1500');
    console.log(`[IMPORT-CSV] Arquivo: ${file?.name}, Plataforma: ${platform}`);

    if (!file) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const stageId = STAGES[platform];
    const columns = COLUMN_MAP[platform];

    if (!stageId || !columns) {
      return NextResponse.json({ success: false, error: `Plataforma não suportada: ${platform}` }, { status: 400 });
    }

    // Ler e parsear CSV
    console.log('[IMPORT-CSV] Lendo arquivo...');
    let csvContent = await file.text();
    console.log(`[IMPORT-CSV] Tamanho do arquivo: ${(csvContent.length / 1024 / 1024).toFixed(2)} MB`);

    // Remover BOM se existir
    if (csvContent.charCodeAt(0) === 0xFEFF) {
      csvContent = csvContent.slice(1);
    }

    console.log('[IMPORT-CSV] Parseando CSV...');
    const allRows = parseCSV(csvContent);
    console.log(`[IMPORT-CSV] Total de linhas parseadas: ${allRows.length}`);

    // Filtrar pagas
    const rows = allRows.filter(row => {
      const status = safeString(row[columns.status]);
      return status === columns.statusPaid;
    });
    console.log(`[IMPORT-CSV] Linhas com status "${columns.statusPaid}": ${rows.length}`);

    if (rows.length === 0) {
      console.log('[IMPORT-CSV] Nenhum registro encontrado com status esperado');
      return NextResponse.json({
        success: false,
        error: `Nenhum registro com status "${columns.statusPaid}"`,
        debug: {
          totalLinhas: allRows.length,
          statusEncontrados: [...new Set(allRows.map(row => safeString(row[columns.status])))].slice(0, 10),
        }
      }, { status: 400 });
    }

    // Criar job no Firebase (apenas metadados, SEM dados do CSV)
    console.log('[IMPORT-CSV] Criando job no Firebase...');
    const jobRef = doc(collection(db, 'jobs_importacao'));
    const jobId = jobRef.id;

    const jobData = {
      id: jobId,
      tipo: 'datacrazy',
      status: 'processando',
      plataforma: platform,
      arquivo: file.name,
      total: rows.length,
      totalOriginal: allRows.length,
      processados: 0,
      sucessos: 0,
      erros: 0,
      ignorados: 0,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      mensagem: 'Iniciando processamento...',
      errosDetalhes: [],
    };

    await setDoc(jobRef, jobData);
    console.log(`[IMPORT-CSV] Job ${jobId} criado, iniciando processamento em background...`);

    // Processar diretamente (não usar fetch interno - CSV muito grande)
    processarEmBackground(jobId, platform, delay, stageId, columns, rows).catch((err) => {
      console.error('[IMPORT-CSV] Erro no processamento em background:', err);
    });

    console.log(`[IMPORT-CSV] Retornando resposta ao cliente`);
    return NextResponse.json({
      success: true,
      jobId,
      total: rows.length,
      filtrados: allRows.length - rows.length,
      mensagem: `Job ${jobId} iniciado com ${rows.length} registros`,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[IMPORT-CSV] ERRO:', errorMsg, e);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
