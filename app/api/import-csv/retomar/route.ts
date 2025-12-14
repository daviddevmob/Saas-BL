import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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

const CANCEL_CHECK_INTERVAL = 50;
const FIREBASE_UPDATE_INTERVAL = 10;

const leadCache = new Map<string, { id: string; tags: { id: string }[] }>();
const tagCache = new Map<string, string | null>();

let apiCallsThisMinute = 0;
let lastMinuteReset = Date.now();

async function apiRequestWithRateLimit(method: string, endpoint: string, body?: unknown) {
  const now = Date.now();
  if (now - lastMinuteReset >= 60000) {
    apiCallsThisMinute = 0;
    lastMinuteReset = now;
  }

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

  const cachedLead = leadCache.get(email);
  if (cachedLead) {
    leadId = cachedLead.id;
    leadTags = cachedLead.tags;
  } else {
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

async function processarEmBackground(
  jobId: string,
  platform: string,
  stageId: string,
  columns: ColumnMap,
  rows: Record<string, string>[],
  startIndex: number = 0
) {
  const jobRef = doc(db, 'jobs_importacao', jobId);
  const totalRows = rows.length;

  leadCache.clear();
  tagCache.clear();

  let processados = startIndex;
  let sucessos = 0, erros = 0, ignorados = 0;
  let errosDetalhes: Array<{ email: string; name: string; error: string }> = [];
  let ultimaMensagem = `Retomando do registro ${startIndex}...`;
  let ultimoPercentual = 0;
  let cancelado = false;
  let ultimaVerificacaoCancelamento = startIndex;
  let ultimaAtualizacaoFirebase = startIndex;

  console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId} retomando do índice ${startIndex}/${totalRows}`);

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
        ultimoIndice: processados,
        errosDetalhes: errosDetalhes.slice(-50),
        atualizadoEm: new Date().toISOString(),
        mensagem: ultimaMensagem,
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'not-found') {
        console.log('[IMPORT-CSV-RETOMAR] Job deletado, parando');
        cancelado = true;
      }
    }
  };

  const verificarCancelamento = async (): Promise<boolean> => {
    if (processados - ultimaVerificacaoCancelamento < CANCEL_CHECK_INTERVAL) {
      return false;
    }
    ultimaVerificacaoCancelamento = processados;

    try {
      const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists() || jobSnap.data().status === 'cancelado') {
        console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId} CANCELADO no registro ${processados}`);
        return true;
      }
    } catch (err) {
      console.log(`[IMPORT-CSV-RETOMAR] Erro ao verificar cancelamento: ${err}`);
      return true;
    }
    return false;
  };

  for (let i = startIndex; i < totalRows && !cancelado; i++) {
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

    await atualizarFirebase();
    await new Promise(r => setTimeout(r, 100));
  }

  leadCache.clear();
  tagCache.clear();

  if (cancelado) {
    console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId} cancelado no registro ${processados}`);
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
    console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId} concluído com sucesso`);
  } catch (err) {
    console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId} - não foi possível atualizar status final`);
  }
}

const STAGES: Record<string, string> = {
  hubla: '74022307-988f-4a81-a3df-c14b28bd41d9',
  hotmart: '0c2bf45f-1c4b-4730-b02c-286b7c018f29',
  eduzz: '3bbc9611-aa0d-47d5-a755-a9cdcfc453ef',
  kiwify: '491a2794-7576-45d0-8d8e-d5a6855f17e2',
  woo: '2c16fbba-092d-48a8-929b-55c5b9d638cc',
};

const COLUMN_MAP: Record<string, ColumnMap> = {
  hubla: {
    email: 'Email do cliente', name: 'Nome do cliente', phone: 'Telefone do cliente',
    taxId: 'Documento do cliente', product: 'Nome do produto', transactionId: 'ID da fatura',
    total: 'Valor total', status: 'Status da fatura', statusPaid: 'Paga',
    zip: 'Endereço CEP', address: 'Endereço Rua', city: 'Endereço Cidade', state: 'Endereço Estado',
  },
  hotmart: {
    email: 'Email', name: 'Nome', phone: 'Telefone Final', taxId: 'Documento',
    product: 'Nome do Produto', transactionId: 'Transação', total: 'Preço Total',
    status: 'Status', statusPaid: 'Aprovado', zip: 'CEP', address: 'Endereço',
    addressNumber: 'Número', addressComplement: 'Complemento', neighborhood: 'Bairro',
    city: 'Cidade', state: 'Estado',
  },
  eduzz: {
    email: 'Cliente / E-mail', name: 'Cliente / Nome', phone: 'Cliente / Fones',
    taxId: 'Cliente / Documento', product: 'Produto', transactionId: 'Fatura',
    total: 'Valor da Venda', status: 'Status', statusPaid: 'Paga', zip: 'CEP',
    address: 'Endereço', addressNumber: 'Numero', addressComplement: 'Complemento',
    neighborhood: 'Bairro', city: 'Cidade', state: 'UF',
  },
  kiwify: {
    email: 'Email', name: 'Cliente', phone: 'Celular', taxId: 'CPF / CNPJ',
    product: 'Produto', transactionId: 'ID da venda', total: 'Valor líquido',
    status: 'Status', statusPaid: 'paid', zip: 'CEP', address: 'Endereço',
    addressNumber: 'Numero', addressComplement: 'Complemento', neighborhood: 'Bairro',
    city: 'Cidade', state: 'Estado',
  },
  woo: {
    email: 'Billing Email Address', name: 'Billing First Name', phone: 'Billing Phone',
    taxId: '_billing_cpf', product: 'Product Name #1', transactionId: 'Order ID',
    total: 'Order Total', status: 'Order Status', statusPaid: 'wc-completed',
    zip: 'Billing Postcode', address: 'Billing Address 1', addressComplement: 'Billing Address 2',
    city: 'Billing City', state: 'Billing State', neighborhood: '_billing_neighborhood',
  },
};

function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  return result.data;
}

// POST - Retomar job existente
export async function POST(request: NextRequest) {
  console.log('[IMPORT-CSV-RETOMAR] Iniciando retomada...');
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const jobId = formData.get('jobId') as string;

    if (!file || !jobId) {
      return NextResponse.json({ success: false, error: 'Arquivo e jobId são obrigatórios' }, { status: 400 });
    }

    // Buscar job existente
    const jobRef = doc(db, 'jobs_importacao', jobId);
    const jobSnap = await getDoc(jobRef);

    if (!jobSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Job não encontrado' }, { status: 404 });
    }

    const jobData = jobSnap.data();
    const platform = jobData.plataforma as string;
    const ultimoIndice = jobData.ultimoIndice || 0;

    console.log(`[IMPORT-CSV-RETOMAR] Job ${jobId}, plataforma: ${platform}, ultimoIndice: ${ultimoIndice}`);

    const stageId = STAGES[platform];
    const columns = COLUMN_MAP[platform];

    if (!stageId || !columns) {
      return NextResponse.json({ success: false, error: `Plataforma não suportada: ${platform}` }, { status: 400 });
    }

    // Ler e parsear CSV
    let csvContent = await file.text();
    if (csvContent.charCodeAt(0) === 0xFEFF) {
      csvContent = csvContent.slice(1);
    }

    const allRows = parseCSV(csvContent);
    const rows = allRows.filter(row => safeString(row[columns.status]) === columns.statusPaid);

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum registro válido no arquivo' }, { status: 400 });
    }

    if (ultimoIndice >= rows.length) {
      return NextResponse.json({ success: false, error: 'Job já foi concluído' }, { status: 400 });
    }

    // Atualizar status do job
    await updateDoc(jobRef, {
      status: 'processando',
      atualizadoEm: new Date().toISOString(),
      mensagem: `Retomando do registro ${ultimoIndice}...`,
    });

    // Processar em background a partir do ultimoIndice
    processarEmBackground(jobId, platform, stageId, columns, rows, ultimoIndice).catch((err) => {
      console.error('[IMPORT-CSV-RETOMAR] Erro:', err);
    });

    return NextResponse.json({
      success: true,
      jobId,
      retomandoDe: ultimoIndice,
      total: rows.length,
      restantes: rows.length - ultimoIndice,
      mensagem: `Retomando job ${jobId} do registro ${ultimoIndice}`,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[IMPORT-CSV-RETOMAR] ERRO:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
