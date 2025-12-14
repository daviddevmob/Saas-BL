// workers/csvProcessor.ts
import { Job } from 'bullmq';
import { doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';
import dotenv from 'dotenv';

dotenv.config();

const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';

// --- Funções de API e Cache (adaptadas do arquivo original) ---

function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function safeEmail(val: unknown): string | null {
  const email = safeString(val).toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) return null;
  return email;
}

// Cache simples na memória do worker. Será limpo se o worker reiniciar.
const leadCache = new Map<string, { id: string; tags: { id: string }[] }>();
const tagCache = new Map<string, string | null>();

async function apiRequest(method: string, endpoint: string, body?: unknown) {
      const options: RequestInit = {
          method,
          headers: {
          'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
          'Content-Type': 'application/json',
          },
      };  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${endpoint}`, options);
  if (!response.ok) {
    const text = await response.text();
    // Lança um erro para que o BullMQ possa tentar novamente o job
    throw new Error(`API Error ${response.status}: ${text}`);
  }
  return response.json();
}

// A lógica de rate limiting agora é gerenciada pelo BullMQ no `lib/queue.ts`
// por isso usamos a função apiRequest diretamente.

async function processarLinha(
  row: Record<string, string>,
  columns: any, // ColumnMap
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
  // ... (código completo de processamento da linha adaptado aqui)

  let leadId: string | undefined;
  let leadTags: { id: string }[] = [];

  const cachedLead = leadCache.get(email);
  if (cachedLead) {
    leadId = cachedLead.id;
    leadTags = cachedLead.tags;
  } else {
    const leadSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(email)}`);
    if (leadSearch && leadSearch.count > 0) {
      leadId = leadSearch.data[0].id;
      leadTags = leadSearch.data[0].tags || [];
    } else {
      const newLead = await apiRequest('POST', '/leads', { name, email, phone: phone || undefined, taxId: taxId || undefined });
      leadId = newLead?.id;
    }
    if (leadId) leadCache.set(email, { id: leadId, tags: leadTags });
  }

  if (!leadId) {
    return { status: 'skipped', message: 'Não foi possível criar ou encontrar o lead', email, name };
  }

  if (productName) {
        let tagId: string | null;

        if (tagCache.has(productName)) {
          // O get() pode retornar undefined, mas o .has() nos dá confiança.
          // O fallback para null garante a segurança do tipo.
          tagId = tagCache.get(productName) ?? null;
        } else {
          const tagSearch = await apiRequest('GET', `/tags?search=${encodeURIComponent(productName)}`);
          const foundId = tagSearch?.data?.[0]?.id; // string | undefined
          tagId = foundId || null; // string | null
          tagCache.set(productName, tagId); // OK
        }
    if (tagId && !leadTags.some(t => t.id === tagId)) {
      await apiRequest('PATCH', `/leads/${leadId}`, { tags: [...leadTags.map(t => ({ id: t.id })), { id: tagId }] });
    }
  }

  const leadBusinesses = await apiRequest('GET', `/leads/${leadId}/businesses`);
  const existingBusiness = leadBusinesses?.data?.find((biz: { externalId?: string }) => biz.externalId === transactionId);

  if (!existingBusiness) {
    const saleValue = parseFloat(safeString(row[columns.total]).replace(',', '.')) || 0;
    await apiRequest('POST', '/businesses', { leadId, stageId, externalId: transactionId, total: saleValue });
    return { status: 'created', message: 'Negócio criado', email, name };
  }

  return { status: 'exists', message: 'Negócio já existe', email, name };
}


// --- O Processador do Worker ---

const processor = async (job: Job) => {
  const { row, columns, stageId, platform, parentJobId } = job.data;
  const parentJobRef = doc(db, 'jobs_importacao_monitor', parentJobId);

  try {
    const result = await processarLinha(row, columns, stageId, platform);
    
    // Incrementa o contador de sucesso, erro ou ignorado
    const fieldToIncrement = 
      result.status === 'created' ? 'sucessos' :
      result.status === 'skipped' ? 'ignorados' :
      'existentes'; // 'exists' conta como 'existentes'

    await updateDoc(parentJobRef, {
      processados: increment(1),
      [fieldToIncrement]: increment(1),
      atualizadoEm: new Date().toISOString(),
      ultimaMensagem: `[${result.status}] ${safeString(result.email) || 'N/A'} - ${result.message}`,
    });

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido no worker';
    console.error(`Erro ao processar job ${job.id} para ${row.email}:`, error);

    // Salva o erro no job pai para visibilidade
    await updateDoc(parentJobRef, {
      processados: increment(1),
      erros: increment(1),
      atualizadoEm: new Date().toISOString(),
      // Usar notação de ponto para atualizar um campo dentro de um mapa
      [`errosDetalhes.${job.id}`]: {
        email: safeString(row.email) || 'não informado',
        name: safeString(row.name) || 'não informado',
        error: errorMsg.substring(0, 500)
      }
    });

    // Lança o erro novamente para que o BullMQ possa registrar a falha e tentar novamente se configurado
    throw error;
  }
};

export default processor;
