import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, getDoc, collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';

const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const DATACRAZY_API_URL = 'https://api.g1.datacrazy.io/api/v1';

const SWIPEONE_API_KEY = process.env.SWIPE_ONE_API || '';
const SWIPEONE_API_URL = 'https://api.swipeone.com';
const SWIPEONE_WORKSPACE_ID = '6940ca7e21f105674fb79e5b';

// Configuração do worker no Firebase
const WORKER_CONFIG_DOC = 'sync_worker_config';

// Configurações
const DATACRAZY_PAGE_SIZE = 100;
const SWIPEONE_DELAY_MS = 1000;
const SWIPEONE_TAG_COLORS = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'cyan', 'amber', 'indigo', 'jade'];

// Cache de tags
let tagsCache: Map<string, string> = new Map();

// Buscar tags existentes
async function fetchExistingTags(): Promise<Map<string, string>> {
  try {
    const response = await fetch(`${SWIPEONE_API_URL}/api/workspaces/${SWIPEONE_WORKSPACE_ID}/tags`, {
      method: 'GET',
      headers: { 'x-api-key': SWIPEONE_API_KEY },
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
      return tagMap;
    }
  } catch (err) {
    console.error('[CRON-SYNC] Erro ao buscar tags:', err);
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
  createdAt?: string;
}

// Buscar leads do Datacrazy
async function fetchDatacrazyLeads(skip: number, take: number, createdAfter?: string) {
  let url = `${DATACRAZY_API_URL}/leads?skip=${skip}&take=${take}`;

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

// Enviar para SwipeOne
async function sendToSwipeOne(lead: DatacrazyLead, baseTags: string): Promise<{ success: boolean; error?: string }> {
  if (!lead.email || !lead.email.includes('@')) {
    return { success: false, error: 'Email inválido' };
  }

  const baseTagsArray = baseTags.split(',').map(t => t.trim()).filter(Boolean);
  const datacrazyTags = lead.tags?.map(t => t.name) || [];
  const allTags = [...baseTagsArray, ...datacrazyTags];

  const payload: Record<string, unknown> = {
    email: lead.email,
    fullName: lead.name || '',
    phone: lead.rawPhone || lead.phone || '',
  };

  const hasAddress = lead.address?.address || lead.address?.city || lead.address?.zip;
  if (hasAddress) {
    payload.address = {
      line1: lead.address?.address || '',
      line2: lead.address?.block || '',
      city: lead.address?.city || '',
      state: lead.address?.state || '',
      country: lead.address?.country || 'Brazil',
      zipcode: lead.address?.zip || '',
    };

    const addressObj = payload.address as { line1: string; line2: string; city: string; state: string; zipcode: string };
    payload.logradouro = addressObj.line1;
    payload.complemento_logradouro = lead.address?.complement || '';
    payload.bairro = addressObj.line2;
    payload.estado__uf = addressObj.state;
    payload.cep = addressObj.zipcode.replace(/\D/g, '');
  }

  try {
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
      return { success: true };
    } else {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    // Adicionar tags
    if (contactId && allTags.length > 0) {
      const tagNamesToApply: string[] = [];

      for (let i = 0; i < allTags.length; i++) {
        const tagLabel = allTags[i];
        const tagLower = tagLabel.toLowerCase();

        if (tagsCache.has(tagLower)) {
          tagNamesToApply.push(tagsCache.get(tagLower)!);
        } else {
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
                tagsCache.set(tagLower, tagName);
                tagNamesToApply.push(tagName);
              }
            }
          } catch {
            // Ignora erro de criação de tag
          }
        }
      }

      if (tagNamesToApply.length > 0) {
        await fetch(`${SWIPEONE_API_URL}/api/contacts/${contactId}/tags`, {
          method: 'POST',
          headers: {
            'x-api-key': SWIPEONE_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tags: tagNamesToApply }),
        });
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
}

// POST - Habilitar/Desabilitar worker ou executar sync manual
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, enabled, intervalMinutes } = body;

    const configRef = doc(db, 'configuracoes', WORKER_CONFIG_DOC);

    // Ação: habilitar/desabilitar worker
    if (action === 'toggle') {
      const now = new Date();
      const interval = intervalMinutes ?? 15; // Padrão: 15 minutos

      // Não define proximaExecucao ao habilitar - só após o sync terminar
      await setDoc(configRef, {
        enabled: enabled ?? true,
        intervalMinutes: interval,
        proximaExecucao: enabled ? null : null, // Será definido quando o sync terminar
        atualizadoEm: now.toISOString(),
      }, { merge: true });

      console.log(`[WORKER] Worker ${enabled ? 'HABILITADO' : 'DESABILITADO'}, intervalo: ${interval}min`);

      // Se habilitou, executa sync imediato
      if (enabled) {
        // Dispara sync em background (não bloqueia)
        // O proximaExecucao será definido quando o sync terminar (em finalizarWorker)
        fetch(`${request.nextUrl.origin}/api/cron/sync-datacrazy-swipeone?manual=true`).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        enabled,
        intervalMinutes: interval,
        proximaExecucao: null, // Será definido após o sync
      });
    }


    return NextResponse.json({ success: false, error: 'Ação inválida' }, { status: 400 });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

// Timeout máximo para considerar um job como "travado" (30 minutos)
const JOB_STUCK_TIMEOUT_MS = 30 * 60 * 1000;

// Função auxiliar para finalizar worker de forma segura
async function finalizarWorker(configRef: ReturnType<typeof doc>, success: boolean) {
  try {
    const configSnap = await getDoc(configRef);
    const workerEnabled = configSnap.exists() && configSnap.data().enabled;
    const intervalMinutes = configSnap.exists() ? (configSnap.data().intervalMinutes || 15) : 15;

    const now = new Date();
    const nextSync = workerEnabled ? new Date(now.getTime() + intervalMinutes * 60 * 1000) : null;

    const updateData: Record<string, unknown> = {
      sincronizando: false,
      proximaExecucao: nextSync?.toISOString() || null,
    };

    // Se sucesso, salvar o horário de término (usado como referência para próxima sync)
    if (success) {
      updateData.ultimaSyncTerminada = now.toISOString();
    }

    await setDoc(configRef, updateData, { merge: true });

    console.log(`[CRON-SYNC] Worker finalizado. Próxima execução: ${nextSync?.toISOString() || 'desabilitado'}`);

    return nextSync?.toISOString() || null;
  } catch (err) {
    console.error('[CRON-SYNC] Erro ao finalizar worker:', err);
    // Tenta pelo menos marcar como não sincronizando
    try {
      await setDoc(configRef, { sincronizando: false }, { merge: true });
    } catch {
      // Ignora
    }
    return null;
  }
}

// GET - Executar sincronização incremental (chamado pelo cron/worker)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isManual = searchParams.get('manual') === 'true';

  console.log(`[CRON-SYNC] ${isManual ? 'Sync manual' : 'Verificando worker'}...`);

  const configRef = doc(db, 'configuracoes', WORKER_CONFIG_DOC);

  try {
    // Buscar configuração atual
    const configSnap = await getDoc(configRef);
    const configData = configSnap.exists() ? configSnap.data() : null;

    // Verificar se já está sincronizando (e se não está travado)
    if (configData?.sincronizando) {
      const ultimaAtualizacao = configData.atualizadoEm ? new Date(configData.atualizadoEm).getTime() : 0;
      const agora = Date.now();

      // Se está sincronizando há mais de 30 minutos, considerar como travado
      if (agora - ultimaAtualizacao > JOB_STUCK_TIMEOUT_MS) {
        console.log('[CRON-SYNC] Worker travado detectado, resetando...');
        await setDoc(configRef, { sincronizando: false }, { merge: true });
      } else {
        console.log('[CRON-SYNC] Worker já está sincronizando');
        return NextResponse.json({
          success: false,
          message: 'Sincronização já em andamento',
        });
      }
    }

    // Se não for manual, verificar se o worker está habilitado E se chegou a hora
    if (!isManual) {
      if (!configData?.enabled) {
        console.log('[CRON-SYNC] Worker desabilitado');
        return NextResponse.json({
          success: false,
          message: 'Worker desabilitado',
        });
      }

      // Verificar se chegou a hora da próxima execução
      const proximaExecucao = configData?.proximaExecucao;
      if (proximaExecucao) {
        const horaProxima = new Date(proximaExecucao).getTime();
        const agora = Date.now();

        if (agora < horaProxima) {
          // Ainda não é hora de sincronizar
          const minutosRestantes = Math.ceil((horaProxima - agora) / 60000);
          console.log(`[CRON-SYNC] Ainda não é hora. Faltam ${minutosRestantes} minutos.`);
          return NextResponse.json({
            success: false,
            message: `Próxima execução em ${minutosRestantes} minutos`,
          });
        }
      } else {
        // proximaExecucao é null - significa que acabou de habilitar e o toggle já disparou um sync
        // O scheduler NÃO deve iniciar outro - espera o sync atual terminar e definir proximaExecucao
        console.log('[CRON-SYNC] Aguardando primeiro sync terminar para definir próxima execução');
        return NextResponse.json({
          success: false,
          message: 'Aguardando sync inicial terminar',
        });
      }
    }

    // Marcar como sincronizando
    await setDoc(configRef, {
      sincronizando: true,
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });

    console.log('[CRON-SYNC] Iniciando sincronização...');

    if (!DATACRAZY_TOKEN || !SWIPEONE_API_KEY) {
      await finalizarWorker(configRef, false);
      return NextResponse.json({ error: 'APIs não configuradas' }, { status: 500 });
    }

    // Verificar se já existe um job em andamento (e limpar jobs travados)
    const activeJobQuery = query(
      collection(db, 'jobs_sincronizacao'),
      where('status', '==', 'processando'),
      limit(5)
    );
    const activeJobSnap = await getDocs(activeJobQuery);

    if (!activeJobSnap.empty) {
      // Verificar se algum job está travado (mais de 30 min sem atualização)
      const agora = Date.now();
      let hasActiveValidJob = false;

      for (const jobDoc of activeJobSnap.docs) {
        const jobData = jobDoc.data();
        const jobAtualizado = jobData.atualizadoEm ? new Date(jobData.atualizadoEm).getTime() : 0;

        if (agora - jobAtualizado > JOB_STUCK_TIMEOUT_MS) {
          // Job travado - marcar como erro
          console.log(`[CRON-SYNC] Job travado detectado: ${jobDoc.id}, marcando como erro`);
          try {
            await updateDoc(doc(db, 'jobs_sincronizacao', jobDoc.id), {
              status: 'erro',
              mensagem: 'Job travado - timeout excedido',
              atualizadoEm: new Date().toISOString(),
            });
          } catch {
            // Ignora erro ao atualizar job travado
          }
        } else {
          hasActiveValidJob = true;
        }
      }

      if (hasActiveValidJob) {
        console.log('[CRON-SYNC] Já existe uma sincronização em andamento');
        await finalizarWorker(configRef, false);
        return NextResponse.json({
          success: false,
          message: 'Já existe uma sincronização em andamento',
        });
      }
    }

    // Criar job no Firebase IMEDIATAMENTE (aparece no histórico)
    const jobRef = doc(collection(db, 'jobs_sincronizacao'));
    const jobId = jobRef.id;
    const dataAtual = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const tags = `datacrazy-sync,sync-${dataAtual},cron-auto`;
    const agora = new Date().toISOString();

    await setDoc(jobRef, {
      id: jobId,
      tipo: 'datacrazy-swipeone-cron',
      status: 'processando',
      total: 0,
      processados: 0,
      sucessos: 0,
      erros: 0,
      ultimoIndice: 0,
      tags,
      incremental: false,
      automatico: !isManual,
      criadoEm: agora,
      atualizadoEm: agora,
      mensagem: 'Buscando leads no Datacrazy...',
      errosDetalhes: [],
    });

    // Buscar data de referência para filtrar leads
    // - Primeira vez: últimos 15 minutos (agora - 15min)
    // - Próximas: desde o TÉRMINO da última sync
    let lastSyncDate: string;

    const configSnapForDate = await getDoc(configRef);
    const ultimaSyncTerminada = configSnapForDate.exists() ? configSnapForDate.data().ultimaSyncTerminada : null;

    if (ultimaSyncTerminada) {
      // Usa a data de término da última sync
      lastSyncDate = ultimaSyncTerminada;
      console.log(`[CRON-SYNC] Buscando leads desde: ${lastSyncDate}`);
    } else {
      // Primeira sync: última hora
      const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000);
      lastSyncDate = umaHoraAtras.toISOString();
      console.log(`[CRON-SYNC] Primeira sync - buscando leads da última hora: ${lastSyncDate}`);
    }

    // Buscar total de leads novos
    let totalLeads = 0;
    try {
      const countResponse = await fetchDatacrazyLeads(0, 1, lastSyncDate);
      totalLeads = countResponse.count;
    } catch (err) {
      console.error('[CRON-SYNC] Erro ao buscar leads do Datacrazy:', err);
      // Atualizar job com erro
      await updateDoc(jobRef, {
        status: 'erro',
        mensagem: 'Erro ao conectar com Datacrazy',
        atualizadoEm: new Date().toISOString(),
      });
      await finalizarWorker(configRef, false);
      return NextResponse.json({
        success: false,
        error: 'Erro ao conectar com Datacrazy',
      }, { status: 500 });
    }

    console.log(`[CRON-SYNC] Total de leads ${lastSyncDate ? 'novos' : ''}: ${totalLeads}`);

    // Atualizar job com total de leads
    await updateDoc(jobRef, {
      total: totalLeads,
      incremental: !!lastSyncDate,
      atualizadoEm: new Date().toISOString(),
      mensagem: totalLeads > 0 ? `Encontrados ${totalLeads} leads. Iniciando...` : 'Nenhum lead novo encontrado',
    });

    if (totalLeads === 0) {
      console.log('[CRON-SYNC] Nenhum lead novo para sincronizar');
      // Marcar job como concluído (sem leads)
      await updateDoc(jobRef, {
        status: 'concluido',
        mensagem: '✅ Nenhum lead novo para sincronizar',
        atualizadoEm: new Date().toISOString(),
      });
      const proximaExecucao = await finalizarWorker(configRef, true);
      return NextResponse.json({
        success: true,
        message: 'Nenhum lead novo para sincronizar',
        totalLeads: 0,
        jobId,
        proximaExecucao,
      });
    }

    // Carregar tags existentes
    tagsCache = await fetchExistingTags();

    // Processar TODOS os leads (VPS não tem limite de timeout como serverless)
    let processados = 0;
    let sucessos = 0;
    let erros = 0;
    let ignorados = 0;
    const errosDetalhes: Array<{ email: string; error: string }> = [];
    const emailsInvalidosList: Array<{ email: string; error: string }> = []; // Sem limite

    let currentSkip = 0;
    const leadsToProcess = totalLeads;

    const PROGRESS_UPDATE_INTERVAL = 10; // Atualizar Firebase a cada 10 leads
    let ultimaAtualizacao = -1; // -1 para forçar atualização no primeiro lead

    while (processados < leadsToProcess) {
      const response = await fetchDatacrazyLeads(currentSkip, DATACRAZY_PAGE_SIZE, lastSyncDate);
      const leads = response.data;

      if (leads.length === 0) break;

      for (const lead of leads) {
        if (processados >= leadsToProcess) break;

        // Ignorar leads sem email
        if (!lead.email || !lead.email.includes('@')) {
          ignorados++;
          processados++;
          continue;
        }

        const result = await sendToSwipeOne(lead, tags);

        if (result.success) {
          sucessos++;
        } else {
          erros++;

          // Separar emails inválidos (guardar todos, sem limite)
          if (result.error?.includes('must be a valid email')) {
            emailsInvalidosList.push({
              email: lead.email,
              error: result.error,
            });
          } else {
            // Outros erros - manter limite de 50
            if (errosDetalhes.length < 50) {
              errosDetalhes.push({
                email: lead.email,
                error: result.error || 'Erro desconhecido',
              });
            }
          }
        }

        processados++;

        // Atualizar progresso no Firebase a cada 10 leads (ou no primeiro)
        if (processados === 1 || processados - ultimaAtualizacao >= PROGRESS_UPDATE_INTERVAL) {
          ultimaAtualizacao = processados;
          const percentual = Math.floor((processados / totalLeads) * 100);
          try {
            await updateDoc(jobRef, {
              processados,
              sucessos,
              erros,
              ignorados,
              atualizadoEm: new Date().toISOString(),
              mensagem: `Processando... ${processados}/${totalLeads} (${percentual}%)`,
            });
          } catch {
            // Ignora erro de atualização
          }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, SWIPEONE_DELAY_MS));
      }

      currentSkip += leads.length;
    }

    // Atualizar job no Firebase
    const finalStatus = processados >= totalLeads ? 'concluido' : 'pausado';
    await updateDoc(jobRef, {
      status: finalStatus,
      processados,
      sucessos,
      erros,
      ignorados,
      ultimoIndice: processados,
      errosDetalhes,
      emailsInvalidos: emailsInvalidosList.length,
      atualizadoEm: new Date().toISOString(),
      mensagem: finalStatus === 'concluido'
        ? `✅ Concluído! Enviados: ${sucessos}, Erros: ${erros}, Ignorados: ${ignorados}`
        : `⏸️ Pausado - ${processados}/${totalLeads} processados. Continuará na próxima execução.`,
    });

    console.log(`[CRON-SYNC] Processados: ${processados}/${totalLeads}, Sucessos: ${sucessos}, Erros: ${erros}, Ignorados: ${ignorados}`);

    // Salvar emails inválidos em coleção separada (sem limite)
    if (emailsInvalidosList.length > 0) {
      try {
        const emailsInvalidosRef = doc(db, 'emails_invalidos', jobId);
        await setDoc(emailsInvalidosRef, {
          jobId,
          emails: emailsInvalidosList.map(e => ({
            email: e.email,
            erro: e.error,
          })),
          total: emailsInvalidosList.length,
          criadoEm: new Date().toISOString(),
        });
        console.log(`[CRON-SYNC] ${emailsInvalidosList.length} emails inválidos salvos`);
      } catch (err) {
        console.error('[CRON-SYNC] Erro ao salvar emails inválidos:', err);
      }
    }

    // Finalizar worker e calcular próxima execução
    const proximaExecucao = await finalizarWorker(configRef, true);

    return NextResponse.json({
      success: true,
      jobId,
      totalLeads,
      processados,
      sucessos,
      erros,
      ignorados,
      emailsInvalidos: emailsInvalidosList.length,
      status: finalStatus,
      proximaExecucao,
      message: finalStatus === 'concluido'
        ? 'Sincronização concluída'
        : `Sincronização parcial - ${processados}/${totalLeads} processados`,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[CRON-SYNC] ERRO:', errorMsg);

    // Tentar atualizar job com erro (se existir)
    try {
      const activeJobQuery = query(
        collection(db, 'jobs_sincronizacao'),
        where('status', '==', 'processando'),
        orderBy('criadoEm', 'desc'),
        limit(1)
      );
      const activeJobSnap = await getDocs(activeJobQuery);
      if (!activeJobSnap.empty) {
        await updateDoc(doc(db, 'jobs_sincronizacao', activeJobSnap.docs[0].id), {
          status: 'erro',
          mensagem: `❌ Erro: ${errorMsg}`,
          atualizadoEm: new Date().toISOString(),
        });
      }
    } catch {
      // Ignora erro ao atualizar job
    }

    // Finalizar worker em caso de erro
    await finalizarWorker(configRef, false);

    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
