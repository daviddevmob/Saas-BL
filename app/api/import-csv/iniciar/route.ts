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

const CANCEL_CHECK_INTERVAL = 50; // Verificar cancelamento a cada 50 registros
const FIREBASE_UPDATE_INTERVAL = 10; // Atualizar Firebase a cada 10 registros (para salvar progresso)

// Limite do Datacrazy: 60 chamadas/minuto por rota
// Com cache, a maioria dos registros usa 2-3 chamadas
// O rate limiting automático aguarda quando chega perto do limite

// Cache para leads e tags (evita buscas repetidas)
const leadCache = new Map<string, { id: string; tags: { id: string }[] }>();
const tagCache = new Map<string, string | null>();

// Contador de chamadas para rate limiting
let apiCallsThisMinute = 0;
let lastMinuteReset = Date.now();

async function apiRequestWithRateLimit(method: string, endpoint: string, body?: unknown) {
  // Reset contador a cada minuto
  const now = Date.now();
  if (now - lastMinuteReset >= 60000) {
    apiCallsThisMinute = 0;
    lastMinuteReset = now;
  }

  // Se chegou perto do limite, aguardar
  if (apiCallsThisMinute >= 55) {
    const waitTime = 60000 - (now - lastMinuteReset) + 1000;
    console.log(`[RATE-LIMIT] Aguardando ${waitTime}ms para reset do limite`);
    await new Promise(r => setTimeout(r, waitTime));
    apiCallsThisMinute = 0;
    lastMinuteReset = Date.now();
  }

  apiCallsThisMinute++;
  return apiRequest(method, endpoint, body);
}

// Processar registro com cache e rate limiting
async function processarRegistroComCache(
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

  // Verificar cache primeiro
  const cachedLead = leadCache.get(email);
  if (cachedLead) {
    leadId = cachedLead.id;
    leadTags = cachedLead.tags;
  } else {
    // Buscar no Datacrazy com rate limiting
    const leadSearch = await apiRequestWithRateLimit('GET', `/leads?search=${encodeURIComponent(email)}`);

    if (!leadSearch || leadSearch.count === 0) {
      try {
        const newLead = await apiRequestWithRateLimit('POST', '/leads', {
          name, email, phone: phone || undefined, taxId: taxId || undefined,
          address: address?.zip ? address : undefined,
          source: `CSV ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
        });
        leadId = newLead?.id;
        leadTags = [];
        if (leadId) leadCache.set(email, { id: leadId, tags: [] });
      } catch (createError) {
        const errorMsg = createError instanceof Error ? createError.message : '';
        if (errorMsg.includes('lead-with-same-contact-exists')) {
          const emailMatch = errorMsg.match(/"email":"([^"]+)"/);
          const existingEmail = emailMatch ? emailMatch[1] : null;
          if (existingEmail) {
            const existingSearch = await apiRequestWithRateLimit('GET', `/leads?search=${encodeURIComponent(existingEmail)}`);
            if (existingSearch?.data?.[0]) {
              leadId = existingSearch.data[0].id;
              leadTags = existingSearch.data[0].tags || [];
              if (email && leadId) leadCache.set(email, { id: leadId, tags: leadTags });
            } else throw createError;
          } else throw createError;
        } else throw createError;
      }
    } else {
      const existingLead = leadSearch.data[0];
      leadId = existingLead.id;
      leadTags = existingLead.tags || [];
      if (email && leadId) leadCache.set(email, { id: leadId, tags: leadTags });

      const updateData: Record<string, unknown> = {};
      if (phone && !existingLead.phone) updateData.phone = phone;
      if (taxId && !existingLead.taxId) updateData.taxId = taxId;
      if (address?.zip && (!existingLead.address || !existingLead.address.zip)) updateData.address = address;
      if (Object.keys(updateData).length > 0) await apiRequestWithRateLimit('PATCH', `/leads/${leadId}`, updateData);
    }
  }

  // Tag com cache
  if (productName && leadId) {
    try {
      let tagId: string | null = null;

      if (tagCache.has(productName)) {
        tagId = tagCache.get(productName) || null;
      } else {
        const tagSearch = await apiRequestWithRateLimit('GET', `/tags?search=${encodeURIComponent(productName)}`);
        tagId = tagSearch?.data?.[0]?.id || null;
        tagCache.set(productName, tagId);
      }

      if (tagId && !leadTags.some((t: { id: string }) => t.id === tagId)) {
        await apiRequestWithRateLimit('PATCH', `/leads/${leadId}`, {
          tags: [...leadTags.map((t: { id: string }) => ({ id: t.id })), { id: tagId }]
        });
      }
    } catch { /* ignora */ }
  }

  if (!leadId) return { status: 'skipped', message: 'Sem leadId', email, name };

  const leadBusinesses = await apiRequestWithRateLimit('GET', `/leads/${leadId}/businesses`);
  const existingBusiness = leadBusinesses?.data?.find((biz: { externalId?: string }) => biz.externalId === transactionId);

  if (!existingBusiness) {
    await apiRequestWithRateLimit('POST', '/businesses', { leadId, stageId, externalId: transactionId, total: saleValue });
    return { status: 'created', message: `Negócio criado: R$ ${saleValue.toFixed(2)}`, email, name };
  }
  return { status: 'exists', message: `Business já existe`, email, name };
}

// Processar em background (fire-and-forget, atualiza Firebase)
// Suporta retomada: começa do índice salvo em 'ultimoIndice'
async function processarEmBackground(
  jobId: string,
  platform: string,
  stageId: string,
  columns: ColumnMap,
  rows: Record<string, string>[],
  startIndex: number = 0 // Índice para retomar
) {
  const jobRef = doc(db, 'jobs_importacao', jobId);
  const totalRows = rows.length;

  // Limpar caches no início
  leadCache.clear();
  tagCache.clear();

  // Recuperar estado anterior se retomando
  let processados = startIndex;
  let sucessos = 0, erros = 0, ignorados = 0;
  let errosDetalhes: Array<{ email: string; name: string; error: string }> = [];
  let ultimaMensagem = startIndex > 0 ? `Retomando do registro ${startIndex}...` : '';
  let ultimoPercentual = 0;
  let cancelado = false;
  let ultimaVerificacaoCancelamento = startIndex;
  let ultimaAtualizacaoFirebase = startIndex;

  console.log(`[IMPORT-CSV] Job ${jobId} iniciando do índice ${startIndex}/${totalRows}`);

  // Atualizar Firebase apenas quando o percentual mudar (para notificar o usuário)
  const atualizarFirebase = async (forcar = false) => {
    const percentualAtual = Math.floor((processados / totalRows) * 100);

    // Só atualiza se o percentual mudou ou se for forçado
    if (!forcar && percentualAtual === ultimoPercentual) {
      return;
    }

    ultimaAtualizacaoFirebase = processados;
    ultimoPercentual = percentualAtual;

    try {
      await updateDoc(jobRef, {
        processados,
        sucessos,
        erros,
        ignorados,
        ultimoIndice: processados, // IMPORTANTE: salvar índice para retomada
        errosDetalhes: errosDetalhes.slice(-50),
        atualizadoEm: new Date().toISOString(),
        mensagem: ultimaMensagem,
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'not-found') {
        console.log('[IMPORT-CSV] Job deletado, parando processamento');
        cancelado = true;
      }
    }
  };

  // Verificar cancelamento com throttling
  const verificarCancelamento = async (): Promise<boolean> => {
    if (processados - ultimaVerificacaoCancelamento < CANCEL_CHECK_INTERVAL) {
      return false;
    }
    ultimaVerificacaoCancelamento = processados;

    try {
      const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists() || jobSnap.data().status === 'cancelado') {
        console.log(`[IMPORT-CSV] Job ${jobId} CANCELADO no registro ${processados}`);
        return true;
      }
    } catch (err) {
      console.log(`[IMPORT-CSV] Erro ao verificar cancelamento: ${err}`);
      return true;
    }
    return false;
  };

  // Processar a partir do índice de retomada
  for (let i = startIndex; i < totalRows && !cancelado; i++) {
    // Verificar cancelamento
    if (await verificarCancelamento()) {
      cancelado = true;
      break;
    }

    const row = rows[i];
    try {
      const result = await processarRegistroComCache(row, columns, stageId, platform);
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

    // Atualizar Firebase (salva progresso para retomada)
    await atualizarFirebase();

    // Rate limiting já é gerenciado por apiRequestWithRateLimit
    // Delay mínimo entre registros para evitar sobrecarga
    await new Promise(r => setTimeout(r, 100));
  }

  // Limpar caches
  leadCache.clear();
  tagCache.clear();

  if (cancelado) {
    console.log(`[IMPORT-CSV] Job ${jobId} cancelado/deletado no registro ${processados}`);
    return;
  }

  try {
    await updateDoc(jobRef, {
      status: 'concluido',
      processados,
      sucessos,
      erros,
      ignorados,
      ultimoIndice: totalRows,
      errosDetalhes: errosDetalhes.slice(-50),
      atualizadoEm: new Date().toISOString(),
      mensagem: `✅ Concluído! Criados: ${sucessos}, Existentes: ${processados - sucessos - erros - ignorados}, Erros: ${erros}, Ignorados: ${ignorados}`,
    });
    console.log(`[IMPORT-CSV] Job ${jobId} concluído com sucesso`);
  } catch (err) {
    console.log(`[IMPORT-CSV] Job ${jobId} - não foi possível atualizar status final`);
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

// Interface para mapeamento customizado (vindo do frontend)
interface CustomMapping {
  email: string;
  name: string;
  phone?: string;
  taxId?: string;
  product?: string;
  transactionId: string;
  total?: string;
  status: string;
  statusFilter: string;
  zip?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

// Converter mapeamento customizado para o formato interno
function convertCustomMapping(custom: CustomMapping): ColumnMap {
  return {
    email: custom.email,
    name: custom.name,
    phone: custom.phone || '',
    taxId: custom.taxId || '',
    product: custom.product || '',
    transactionId: custom.transactionId,
    total: custom.total || '',
    status: custom.status,
    statusPaid: custom.statusFilter,
    zip: custom.zip,
    address: custom.address,
    addressNumber: custom.number,
    addressComplement: custom.complement,
    neighborhood: custom.neighborhood,
    city: custom.city,
    state: custom.state,
  };
}

// POST - Criar novo job de importação
export async function POST(request: NextRequest) {
  console.log('[IMPORT-CSV] Iniciando importação...');
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const platform = formData.get('platform') as string || '';
    const customMappingStr = formData.get('customMapping') as string || '';
    const customStageId = formData.get('stageId') as string || '';

    console.log(`[IMPORT-CSV] Arquivo: ${file?.name}, Plataforma: ${platform}, CustomMapping: ${!!customMappingStr}, CustomStageId: ${customStageId}`);

    if (!file) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    let stageId: string;
    let columns: ColumnMap;
    let platformName: string;

    // Verificar se é mapeamento customizado ou por plataforma
    if (customMappingStr && customStageId) {
      // Mapeamento customizado
      try {
        const customMapping = JSON.parse(customMappingStr) as CustomMapping;
        columns = convertCustomMapping(customMapping);
        stageId = customStageId;
        platformName = 'custom';
        console.log(`[IMPORT-CSV] Usando mapeamento customizado com stageId: ${stageId}`);
      } catch (e) {
        return NextResponse.json({ success: false, error: 'Mapeamento customizado inválido' }, { status: 400 });
      }
    } else if (platform) {
      // Mapeamento por plataforma
      stageId = STAGES[platform];
      columns = COLUMN_MAP[platform];
      platformName = platform;

      if (!stageId || !columns) {
        return NextResponse.json({ success: false, error: `Plataforma não suportada: ${platform}` }, { status: 400 });
      }
    } else {
      return NextResponse.json({ success: false, error: 'Plataforma ou mapeamento customizado é obrigatório' }, { status: 400 });
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
      plataforma: platformName,
      arquivo: file.name,
      total: rows.length,
      totalOriginal: allRows.length,
      processados: 0,
      sucessos: 0,
      erros: 0,
      ignorados: 0,
      ultimoIndice: 0, // Para retomada em caso de travamento
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      mensagem: 'Iniciando processamento...',
      errosDetalhes: [],
    };

    await setDoc(jobRef, jobData);
    console.log(`[IMPORT-CSV] Job ${jobId} criado, iniciando processamento em background...`);

    // Processar diretamente com rate limiting automático
    processarEmBackground(jobId, platformName, stageId, columns, rows, 0).catch((err) => {
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
