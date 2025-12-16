import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, getDoc, collection } from 'firebase/firestore';

const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const DATACRAZY_API_URL = 'https://api.g1.datacrazy.io/api/v1';

const SWIPEONE_API_KEY = process.env.SWIPE_ONE_API || '';
const SWIPEONE_API_URL = 'https://api.swipeone.com';
const SWIPEONE_WORKSPACE_ID = '6940ca7e21f105674fb79e5b';

// Configurações de paginação e rate limiting
const DATACRAZY_PAGE_SIZE = 100; // Buscar 100 leads por vez
const SWIPEONE_DELAY_MS = 1000; // 1 segundo entre cada envio (evitar rate limit)
const CANCEL_CHECK_INTERVAL = 50; // Verificar cancelamento a cada 50 registros

// Cores válidas do SwipeOne para tags
const SWIPEONE_TAG_COLORS = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'cyan', 'amber', 'indigo', 'jade'];

// Cache de tags existentes no SwipeOne: Map<labelLowercase, name>
let tagsCache: Map<string, string> = new Map();

// Buscar todas as tags existentes no SwipeOne
async function fetchExistingTags(): Promise<Map<string, string>> {
  try {
    const response = await fetch(`${SWIPEONE_API_URL}/api/workspaces/${SWIPEONE_WORKSPACE_ID}/tags`, {
      method: 'GET',
      headers: {
        'x-api-key': SWIPEONE_API_KEY,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const tags = data?.data?.tags || [];
      const tagMap = new Map<string, string>();

      for (const t of tags) {
        const label = (t.label || '').toLowerCase();
        const name = t.name || '';
        if (label && name) {
          tagMap.set(label, name);
        }
      }

      console.log(`[SYNC] Carregadas ${tagMap.size} tags existentes do SwipeOne`);
      return tagMap;
    }
  } catch (err) {
    console.error('[SYNC] Erro ao buscar tags existentes:', err);
  }
  return new Map();
}

interface DatacrazyLead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  rawPhone?: string;
  taxId?: string;
  company?: string;
  source?: string;
  address?: {
    zip?: string;
    address?: string;
    block?: string;
    city?: string;
    state?: string;
    country?: string;
    complement?: string;
  };
  tags?: Array<{ id: string; name: string }>;
  metrics?: {
    purchaseCount?: number;
    totalSpent?: number;
    averageTicket?: number;
  };
  createdAt?: string;
}

interface DatacrazyResponse {
  count: number;
  data: DatacrazyLead[];
}

// Buscar leads do Datacrazy com paginação e filtro de data
async function fetchDatacrazyLeads(skip: number, take: number, createdAfter?: string): Promise<DatacrazyResponse> {
  let url = `${DATACRAZY_API_URL}/leads?skip=${skip}&take=${take}`;

  // Se tiver data, filtrar leads criados após essa data
  if (createdAfter) {
    url += `&filter[createdAtGreaterOrEqual]=${encodeURIComponent(createdAfter)}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Datacrazy API ${response.status}: ${text}`);
  }

  return response.json();
}

// Enviar contato para SwipeOne (2 etapas: criar contato + adicionar tags)
async function sendToSwipeOne(lead: DatacrazyLead, baseTags: string): Promise<{ success: boolean; error?: string }> {
  if (!lead.email || !lead.email.includes('@')) {
    return { success: false, error: 'Email inválido' };
  }

  // Combinar tags base + tags do Datacrazy (como array)
  const baseTagsArray = baseTags.split(',').map(t => t.trim()).filter(Boolean);
  const datacrazyTags = lead.tags?.map(t => t.name) || [];
  const allTags = [...baseTagsArray, ...datacrazyTags];

  // Payload para criar contato (sem tags - serão adicionadas depois)
  // Enviamos apenas fullName - SwipeOne deriva firstName/lastName automaticamente
  const payload: Record<string, unknown> = {
    email: lead.email,
    fullName: lead.name || '',
    phone: lead.rawPhone || lead.phone || '',
  };

  // Adicionar endereço apenas se tiver dados
  const hasAddress = lead.address?.address || lead.address?.city || lead.address?.zip;
  if (hasAddress) {
    // Address object padrão do SwipeOne
    payload.address = {
      line1: lead.address?.address || '',
      line2: lead.address?.block || '',
      city: lead.address?.city || '',
      state: lead.address?.state || '',
      country: lead.address?.country || 'Brazil',
      zipcode: lead.address?.zip || '',
    };

    // Campos personalizados (mesmos valores do address object)
    const addressObj = payload.address as { line1: string; line2: string; city: string; state: string; zipcode: string };
    payload.logradouro = addressObj.line1;
    payload.complemento_logradouro = lead.address?.complement || '';
    payload.bairro = addressObj.line2;
    payload.estado__uf = addressObj.state;
    payload.cep = addressObj.zipcode.replace(/\D/g, ''); // Somente números
  }

  try {
    // ETAPA 1: Criar contato
    const response = await fetch(`${SWIPEONE_API_URL}/api/workspaces/${SWIPEONE_WORKSPACE_ID}/contacts`, {
      method: 'POST',
      headers: {
        'x-api-key': SWIPEONE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let contactId: string | null = null;

    if (response.ok) {
      const data = await response.json();
      contactId = data?.data?.contact?._id;
    } else if (response.status === 409) {
      // Contato já existe - tentar buscar pelo email para pegar o ID
      // Por enquanto, apenas retornar sucesso
      return { success: true };
    } else {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    // ETAPA 2: Adicionar tags (se tiver contactId e tags)
    if (contactId && allTags.length > 0) {
      try {
        const tagNamesToApply: string[] = [];

        // Para cada tag, verificar se existe e criar se necessário
        for (let i = 0; i < allTags.length; i++) {
          const tagLabel = allTags[i];
          const tagLower = tagLabel.toLowerCase();

          // Verificar se já existe no cache
          if (tagsCache.has(tagLower)) {
            // Tag existe, usar o name do cache
            tagNamesToApply.push(tagsCache.get(tagLower)!);
          } else {
            // Tag não existe, criar primeiro
            try {
              const createTagResponse = await fetch(`${SWIPEONE_API_URL}/api/workspaces/${SWIPEONE_WORKSPACE_ID}/tags`, {
                method: 'POST',
                headers: {
                  'x-api-key': SWIPEONE_API_KEY,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  label: tagLabel,
                  color: SWIPEONE_TAG_COLORS[i % SWIPEONE_TAG_COLORS.length],
                }),
              });

              if (createTagResponse.ok) {
                const createData = await createTagResponse.json();
                const tagName = createData?.data?.tag?.name;
                if (tagName) {
                  console.log(`[SYNC] Tag criada: ${tagLabel} -> ${tagName}`);
                  tagsCache.set(tagLower, tagName);
                  tagNamesToApply.push(tagName);
                }
              } else {
                const errorText = await createTagResponse.text();
                console.log(`[SYNC] Erro ao criar tag ${tagLabel}: ${errorText}`);
              }
            } catch (createErr) {
              console.log(`[SYNC] Erro ao criar tag ${tagLabel}:`, createErr);
            }
          }
        }

        // Aplicar tags usando os names (não os labels)
        if (tagNamesToApply.length > 0) {
          console.log(`[SYNC] Aplicando ${tagNamesToApply.length} tags ao contato ${contactId}`);

          const tagsResponse = await fetch(`${SWIPEONE_API_URL}/api/contacts/${contactId}/tags`, {
            method: 'POST',
            headers: {
              'x-api-key': SWIPEONE_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tags: tagNamesToApply }),
          });

          if (!tagsResponse.ok) {
            const errorText = await tagsResponse.text();
            console.log(`[SYNC] Erro ao aplicar tags: ${errorText}`);
          }
        }
      } catch (tagErr) {
        console.log(`[SYNC] Aviso: Erro ao adicionar tags ao contato ${contactId}:`, tagErr);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
}

// Processar sincronização em background
async function processarSincronizacao(
  jobId: string,
  totalLeads: number,
  startIndex: number = 0,
  tags: string = 'datacrazy-sync',
  createdAfter?: string
) {
  const jobRef = doc(db, 'jobs_sincronizacao', jobId);

  // Carregar tags existentes do SwipeOne (evita criar duplicadas)
  tagsCache = await fetchExistingTags();
  console.log(`[SYNC] Cache de tags carregado com ${tagsCache.size} tags existentes`);

  let processados = startIndex;
  let sucessos = 0;
  let erros = 0;
  let ultimoPercentual = 0;
  let cancelado = false;
  let ultimaVerificacaoCancelamento = startIndex;
  const errosDetalhes: Array<{ email: string; error: string }> = [];

  console.log(`[SYNC] Job ${jobId} iniciando do índice ${startIndex}/${totalLeads}`);

  // Função para atualizar Firebase apenas quando percentual muda
  const atualizarFirebase = async (forcar = false, mensagem?: string) => {
    const percentualAtual = Math.floor((processados / totalLeads) * 100);

    if (!forcar && percentualAtual === ultimoPercentual) {
      return;
    }

    ultimoPercentual = percentualAtual;

    try {
      await updateDoc(jobRef, {
        processados,
        sucessos,
        erros,
        ultimoIndice: processados,
        errosDetalhes: errosDetalhes.slice(-50),
        atualizadoEm: new Date().toISOString(),
        mensagem: mensagem || `Processando... ${processados}/${totalLeads} (${percentualAtual}%)`,
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'not-found') {
        console.log('[SYNC] Job deletado, parando processamento');
        cancelado = true;
      }
    }
  };

  // Verificar cancelamento
  const verificarCancelamento = async (): Promise<boolean> => {
    if (processados - ultimaVerificacaoCancelamento < CANCEL_CHECK_INTERVAL) {
      return false;
    }
    ultimaVerificacaoCancelamento = processados;

    try {
      const jobSnap = await getDoc(jobRef);
      if (!jobSnap.exists() || jobSnap.data().status === 'cancelado') {
        console.log(`[SYNC] Job ${jobId} CANCELADO no registro ${processados}`);
        return true;
      }
    } catch {
      return true;
    }
    return false;
  };

  // Processar em lotes
  let currentSkip = startIndex;

  while (currentSkip < totalLeads && !cancelado) {
    // Verificar cancelamento
    if (await verificarCancelamento()) {
      cancelado = true;
      break;
    }

    // Buscar lote de leads do Datacrazy
    console.log(`[SYNC] Buscando leads ${currentSkip} a ${currentSkip + DATACRAZY_PAGE_SIZE}...`);

    try {
      const response = await fetchDatacrazyLeads(currentSkip, DATACRAZY_PAGE_SIZE, createdAfter);
      const leads = response.data;

      if (leads.length === 0) {
        console.log('[SYNC] Nenhum lead retornado, finalizando');
        break;
      }

      // Processar cada lead do lote
      for (const lead of leads) {
        if (cancelado) break;

        // Verificar cancelamento periodicamente
        if (await verificarCancelamento()) {
          cancelado = true;
          break;
        }

        // Enviar para SwipeOne
        const result = await sendToSwipeOne(lead, tags);

        if (result.success) {
          sucessos++;
        } else {
          erros++;
          errosDetalhes.push({
            email: lead.email || 'sem email',
            error: result.error || 'Erro desconhecido',
          });
        }

        processados++;

        // Atualizar Firebase
        await atualizarFirebase();

        // Rate limiting para SwipeOne
        await new Promise(r => setTimeout(r, SWIPEONE_DELAY_MS));
      }

      currentSkip += leads.length;

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro ao buscar leads';
      console.error(`[SYNC] Erro ao buscar leads: ${errorMsg}`);

      // Atualizar Firebase com erro e pausar
      await atualizarFirebase(true, `Erro: ${errorMsg}. Último índice: ${processados}`);

      // Aguardar antes de tentar novamente
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Finalizar
  if (cancelado) {
    console.log(`[SYNC] Job ${jobId} cancelado no registro ${processados}`);
    return;
  }

  try {
    await updateDoc(jobRef, {
      status: 'concluido',
      processados,
      sucessos,
      erros,
      ultimoIndice: processados,
      errosDetalhes: errosDetalhes.slice(-50),
      atualizadoEm: new Date().toISOString(),
      mensagem: `✅ Concluído! Enviados: ${sucessos}, Erros: ${erros}`,
    });
    console.log(`[SYNC] Job ${jobId} concluído: ${sucessos} enviados, ${erros} erros`);
  } catch {
    console.log(`[SYNC] Job ${jobId} - não foi possível atualizar status final`);
  }
}

// POST - Iniciar sincronização
export async function POST(request: NextRequest) {
  console.log('[SYNC] Iniciando sincronização Datacrazy -> SwipeOne...');

  try {
    if (!DATACRAZY_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Token Datacrazy não configurado' },
        { status: 500 }
      );
    }

    if (!SWIPEONE_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'API Key SwipeOne não configurada' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const startIndex = body.startIndex || 0;
    const incremental = body.incremental || false;
    const lastSyncDate = body.lastSyncDate || null;

    // Adicionar data de sincronização automaticamente às tags
    const dataAtual = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const tags = `datacrazy-sync,sync-${dataAtual}`;

    // Filtro de data para sincronização incremental
    const createdAfter = incremental && lastSyncDate ? lastSyncDate : undefined;

    // Primeiro, buscar total de leads no Datacrazy
    console.log(`[SYNC] Buscando total de leads... ${incremental ? '(incremental desde ' + lastSyncDate + ')' : '(completo)'}`);
    const countResponse = await fetchDatacrazyLeads(0, 1, createdAfter);
    const totalLeads = countResponse.count;

    console.log(`[SYNC] Total de leads ${incremental ? 'novos' : ''} no Datacrazy: ${totalLeads}`);

    if (totalLeads === 0) {
      return NextResponse.json({
        success: false,
        error: incremental ? 'Nenhum lead novo encontrado desde a última sincronização' : 'Nenhum lead encontrado no Datacrazy',
      }, { status: 400 });
    }

    // Criar job no Firebase
    const jobRef = doc(collection(db, 'jobs_sincronizacao'));
    const jobId = jobRef.id;

    const jobData = {
      id: jobId,
      tipo: incremental ? 'datacrazy-swipeone-incremental' : 'datacrazy-swipeone',
      status: 'processando',
      total: totalLeads,
      processados: startIndex,
      sucessos: 0,
      erros: 0,
      ultimoIndice: startIndex,
      tags,
      incremental,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      mensagem: incremental ? 'Iniciando sincronização incremental...' : 'Iniciando sincronização completa...',
      errosDetalhes: [],
    };

    await setDoc(jobRef, jobData);
    console.log(`[SYNC] Job ${jobId} criado, iniciando processamento...`);

    // Iniciar processamento em background
    processarSincronizacao(jobId, totalLeads, startIndex, tags, createdAfter).catch((err) => {
      console.error('[SYNC] Erro no processamento:', err);
    });

    // Calcular estimativa de tempo
    const estimativaSegundos = Math.ceil((totalLeads - startIndex) * (SWIPEONE_DELAY_MS / 1000));
    const estimativaMinutos = Math.ceil(estimativaSegundos / 60);
    const estimativaHoras = Math.floor(estimativaMinutos / 60);
    const minutosRestantes = estimativaMinutos % 60;

    let estimativaTexto = '';
    if (estimativaHoras > 0) {
      estimativaTexto = `~${estimativaHoras}h ${minutosRestantes}min`;
    } else {
      estimativaTexto = `~${estimativaMinutos} min`;
    }

    return NextResponse.json({
      success: true,
      jobId,
      total: totalLeads,
      startIndex,
      estimativa: estimativaTexto,
      mensagem: `Sincronização iniciada! ${totalLeads.toLocaleString()} leads serão enviados para o SwipeOne.`,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[SYNC] ERRO:', errorMsg, e);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

// GET - Verificar status do job
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'jobId é obrigatório' }, { status: 400 });
  }

  try {
    const jobRef = doc(db, 'jobs_sincronizacao', jobId);
    const jobSnap = await getDoc(jobRef);

    if (!jobSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Job não encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job: jobSnap.data(),
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

// DELETE - Cancelar job
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'jobId é obrigatório' }, { status: 400 });
  }

  try {
    const jobRef = doc(db, 'jobs_sincronizacao', jobId);
    await updateDoc(jobRef, {
      status: 'cancelado',
      atualizadoEm: new Date().toISOString(),
      mensagem: 'Cancelado pelo usuário',
    });

    return NextResponse.json({
      success: true,
      mensagem: 'Sincronização cancelada',
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
