import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

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
): Promise<{ status: 'created' | 'exists' | 'error' | 'skipped'; message: string; email?: string; name?: string }> {
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

  // Montar endereço completo
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

  const address = zipCode ? {
    zip: zipCode,
    address: fullAddress,
    city: city,
    state: state,
    country: 'Brasil',
  } : undefined;

  const saleValue = parseFloat(safeString(row[columns.total]).replace(',', '.')) || 0;

  // BUSCAR/CRIAR LEAD
  let leadId: string | undefined;
  let leadTags: { id: string }[] = [];

  const leadSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(email)}`);

  if (!leadSearch || leadSearch.count === 0) {
    try {
      const newLead = await apiRequest('POST', '/leads', {
        name,
        email,
        phone: phone || undefined,
        taxId: taxId || undefined,
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
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      } else {
        throw createError;
      }
    }
  } else {
    const existingLead = leadSearch.data[0];
    leadId = existingLead.id;
    leadTags = existingLead.tags || [];

    const updateData: Record<string, unknown> = {};
    if (phone && !existingLead.phone) updateData.phone = phone;
    if (taxId && !existingLead.taxId) updateData.taxId = taxId;
    if (address?.zip && (!existingLead.address || !existingLead.address.zip)) {
      updateData.address = address;
    }

    if (Object.keys(updateData).length > 0) {
      await apiRequest('PATCH', `/leads/${leadId}`, updateData);
    }
  }

  // TAG DO PRODUTO
  if (productName && leadId) {
    try {
      const tagSearch = await apiRequest('GET', `/tags?search=${encodeURIComponent(productName)}`);
      if (tagSearch?.data?.[0] && !leadTags.some((t: { id: string }) => t.id === tagSearch.data[0].id)) {
        await apiRequest('PATCH', `/leads/${leadId}`, {
          tags: [...leadTags.map((t: { id: string }) => ({ id: t.id })), { id: tagSearch.data[0].id }]
        });
      }
    } catch {
      // ignora erro de tag
    }
  }

  // CRIAR BUSINESS
  if (!leadId) {
    return { status: 'skipped', message: 'Sem leadId - não foi possível vincular', email, name };
  }

  const leadBusinesses = await apiRequest('GET', `/leads/${leadId}/businesses`);
  const existingBusiness = leadBusinesses?.data?.find((biz: { externalId?: string }) =>
    biz.externalId === transactionId
  );

  if (!existingBusiness) {
    await apiRequest('POST', '/businesses', {
      leadId,
      stageId,
      externalId: transactionId,
      total: saleValue,
    });
    return { status: 'created', message: `Negócio criado: R$ ${saleValue.toFixed(2)}`, email, name };
  } else {
    return { status: 'exists', message: `Business já existe (${transactionId.substring(0, 8)}...)`, email, name };
  }
}

// POST - Processar job (recebe dados via POST, não do Firebase)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, platform, delay, stageId, columns, rows } = body;

    if (!jobId || !rows || !Array.isArray(rows)) {
      return NextResponse.json({ success: false, error: 'Dados inválidos' }, { status: 400 });
    }

    const jobRef = doc(db, 'jobs_importacao', jobId);

    let processados = 0;
    let sucessos = 0;
    let erros = 0;
    let ignorados = 0;
    let errosDetalhes: Array<{ email: string; name: string; error: string }> = [];
    let ultimaMensagem = '';
    let ultimoPercentual = 0;

    // Calcular intervalo de atualização (1% do total, mínimo 10, máximo 500)
    const updateInterval = Math.max(10, Math.min(500, Math.floor(rows.length / 100)));

    // Função para atualizar Firebase
    const atualizarFirebase = async (forcado = false) => {
      const percentualAtual = Math.floor((processados / rows.length) * 100);

      // Só atualiza se mudou pelo menos 1% ou se for forçado
      if (forcado || percentualAtual > ultimoPercentual || processados % updateInterval === 0) {
        ultimoPercentual = percentualAtual;
        await updateDoc(jobRef, {
          processados,
          sucessos,
          erros,
          ignorados,
          errosDetalhes: errosDetalhes.slice(-50),
          atualizadoEm: new Date().toISOString(),
          mensagem: ultimaMensagem,
        });
      }
    };

    // Processar cada registro
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const result = await processarRegistro(row, columns, stageId, platform);

        processados++;

        if (result.status === 'created') {
          sucessos++;
        } else if (result.status === 'skipped') {
          ignorados++;
        }

        ultimaMensagem = `[${processados}/${rows.length}] ${result.email || ''} - ${result.message}`;

      } catch (e) {
        erros++;
        processados++;

        const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
        const email = safeString(row[columns.email]);
        const name = safeString(row[columns.name]);

        errosDetalhes.push({ email, name, error: errorMsg });
        ultimaMensagem = `[${processados}/${rows.length}] ❌ ${email} - ${errorMsg.substring(0, 100)}`;
      }

      // Atualizar Firebase a cada 1% ou intervalo definido
      await atualizarFirebase();

      // Delay entre registros
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Atualização final forçada + marcar como concluído
    await updateDoc(jobRef, {
      status: 'concluido',
      processados,
      sucessos,
      erros,
      ignorados,
      errosDetalhes: errosDetalhes.slice(-50),
      atualizadoEm: new Date().toISOString(),
      mensagem: `✅ Concluído! Criados: ${sucessos}, Existentes: ${processados - sucessos - erros - ignorados}, Erros: ${erros}, Ignorados: ${ignorados}`,
    });

    return NextResponse.json({
      success: true,
      status: 'concluido',
      processados,
      sucessos,
      erros,
      ignorados,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('Erro no processamento:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
