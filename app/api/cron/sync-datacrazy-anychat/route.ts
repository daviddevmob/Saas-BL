import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, updateDoc, getDoc, collection, query, limit, getDocs, where } from 'firebase/firestore';

const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const DATACRAZY_API_URL = 'https://api.g1.datacrazy.io/api/v1';

const ANYCHAT_API_KEY = process.env.ANYCHAT_API_KEY || '';
const ANYCHAT_API_URL = 'https://api.anychat.one/public/v1';

// Firebase config doc
const WORKER_CONFIG_DOC = 'sync_datacrazy_anychat_config';

// Configurações de paginação e delays
const DATACRAZY_PAGE_SIZE = 100;
const DATACRAZY_DELAY_MS = 1000; // 60 calls/min (limite da API)
const ANYCHAT_PAGE_SIZE = 100;
const ANYCHAT_READ_DELAY_MS = 100;  // leitura rápida
const ANYCHAT_POST_DELAY_MS = 300;  // POST com delay moderado

// Timeout para jobs travados (30 minutos)
const JOB_STUCK_TIMEOUT_MS = 30 * 60 * 1000;

interface DatacrazyTag {
  id: string;
  name: string;
  color?: string;
}

interface DatacrazyLead {
  phone?: string;
  rawPhone?: string;
  name?: string;
  tags?: DatacrazyTag[];
}

interface DatacrazyTagInfo {
  name: string;
  tags: Array<{ name: string; color: string }>;
}

// Normalizar telefone: remove tudo que não é dígito e garante sem prefixo 55
function normalizePhone(phone: string): string {
  // Remove "BR", "+", espaços, parênteses, traços — só dígitos
  let digits = phone.replace(/\D/g, '');
  // Remove prefixo 55 do Brasil (fica só DDD + número)
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.substring(2);
  }
  return digits;
}

// Converter cor hex do DataCrazy para formato AnyChat ou usar default
function datacrazyColorToHex(color?: string): string {
  if (color && color.startsWith('#')) return color;
  // Cores padrão por nome
  const colorMap: Record<string, string> = {
    blue: '#3B82F6',
    green: '#22C55E',
    red: '#EF4444',
    yellow: '#EAB308',
    purple: '#A855F7',
    orange: '#F97316',
    pink: '#EC4899',
    teal: '#14B8A6',
    cyan: '#06B6D4',
    indigo: '#6366F1',
  };
  return colorMap[color || ''] || '#3B82F6';
}

// Buscar leads do DataCrazy (1 página)
async function fetchDatacrazyLeads(skip: number, take: number): Promise<{ count: number; data: DatacrazyLead[] }> {
  const url = `${DATACRAZY_API_URL}/leads?skip=${skip}&take=${take}`;
  const token = DATACRAZY_TOKEN;

  // Debug: mostra primeiros/últimos chars do token (sem expor completo)
  if (skip === 0) {
    console.log(`[SYNC-ANYCHAT] DataCrazy token: ${token.substring(0, 10)}...${token.substring(token.length - 10)} (${token.length} chars)`);
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataCrazy API ${response.status}: ${text}`);
  }

  return response.json();
}

// Buscar contatos do AnyChat (1 página)
async function fetchAnychatContacts(page: number): Promise<{ data: Array<{ guid: string; name: string; clean_phone: string; tags: unknown[] }>; page: number; limit: number; pages: number; total: number }> {
  const url = `${ANYCHAT_API_URL}/contact?page=${page}&limit=${ANYCHAT_PAGE_SIZE}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': ANYCHAT_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AnyChat API ${response.status}: ${text}`);
  }

  return response.json();
}

// Aplicar tags a um contato no AnyChat (com retry)
const MAX_RETRIES = 2;

async function applyTagsToContact(guid: string, tags: Array<{ label: string; color: string }>, contactPhone?: string): Promise<boolean> {
  const url = `${ANYCHAT_API_URL}/contact/${guid}/tags`;
  const payload = { tags };

  console.log(`[SYNC-ANYCHAT] POST tags → guid: ${guid} | phone: ${contactPhone || 'N/A'}`);
  console.log(`[SYNC-ANYCHAT]   Tags: ${JSON.stringify(tags.map(t => t.label))}`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': ANYCHAT_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[SYNC-ANYCHAT]   OK (${Array.isArray(data) ? data.length : tags.length} tags)`);
        return true;
      }

      const text = await response.text();
      console.log(`[SYNC-ANYCHAT]   ERRO ${response.status}: ${text.substring(0, 200)}`);

      // Se 504/502/503, retry
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        console.log(`[SYNC-ANYCHAT]   Retry ${attempt + 1}/${MAX_RETRIES} em 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      return false;
    } catch (err) {
      console.log(`[SYNC-ANYCHAT]   EXCEPTION: ${err instanceof Error ? err.message : 'erro'}`);
      if (attempt < MAX_RETRIES) {
        console.log(`[SYNC-ANYCHAT]   Retry ${attempt + 1}/${MAX_RETRIES} em 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return false;
    }
  }

  return false;
}

// Função auxiliar para finalizar worker
async function finalizarWorker(configRef: ReturnType<typeof doc>, success: boolean) {
  try {
    const configSnap = await getDoc(configRef);
    const workerEnabled = configSnap.exists() && configSnap.data().enabled;
    const intervalMinutes = configSnap.exists() ? (configSnap.data().intervalMinutes || 60) : 60;

    const now = new Date();
    const nextSync = workerEnabled ? new Date(now.getTime() + intervalMinutes * 60 * 1000) : null;

    const updateData: Record<string, unknown> = {
      sincronizando: false,
      proximaExecucao: nextSync?.toISOString() || null,
    };

    if (success) {
      updateData.ultimaSyncTerminada = now.toISOString();
    }

    await setDoc(configRef, updateData, { merge: true });
    console.log(`[SYNC-ANYCHAT] Worker finalizado. Próxima execução: ${nextSync?.toISOString() || 'desabilitado'}`);

    return nextSync?.toISOString() || null;
  } catch (err) {
    console.error('[SYNC-ANYCHAT] Erro ao finalizar worker:', err);
    try {
      await setDoc(configRef, { sincronizando: false }, { merge: true });
    } catch {
      // Ignora
    }
    return null;
  }
}

// POST - Habilitar/Desabilitar worker
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, enabled, intervalMinutes } = body;

    const configRef = doc(db, 'configuracoes', WORKER_CONFIG_DOC);

    if (action === 'toggle') {
      const interval = intervalMinutes ?? 60;

      await setDoc(configRef, {
        enabled: enabled ?? true,
        intervalMinutes: interval,
        proximaExecucao: enabled ? null : null,
        atualizadoEm: new Date().toISOString(),
      }, { merge: true });

      console.log(`[SYNC-ANYCHAT] Worker ${enabled ? 'HABILITADO' : 'DESABILITADO'}, intervalo: ${interval}min`);

      // Se habilitou, executa sync imediato
      if (enabled) {
        fetch(`${request.nextUrl.origin}/api/cron/sync-datacrazy-anychat?manual=true`).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        enabled,
        intervalMinutes: interval,
        proximaExecucao: null,
      });
    }

    // Ação: cancelar job em andamento (com ou sem jobId)
    if (action === 'cancel') {
      try {
        const { jobId } = body;

        if (jobId) {
          // Cancelar job específico
          const jobDocRef = doc(db, 'jobs_sincronizacao', jobId);
          await updateDoc(jobDocRef, {
            status: 'cancelado',
            mensagem: 'Cancelado pelo usuário',
            atualizadoEm: new Date().toISOString(),
          });
          console.log(`[SYNC-ANYCHAT] Job ${jobId} cancelado`);
        }

        // Cancelar jobs "processando" SOMENTE do tipo datacrazy-anychat-cron
        const activeJobQuery = query(
          collection(db, 'jobs_sincronizacao'),
          where('status', '==', 'processando'),
          limit(20)
        );
        const activeJobSnap = await getDocs(activeJobQuery);
        let cancelados = 0;

        for (const jobDoc of activeJobSnap.docs) {
          if (jobDoc.data().tipo !== 'datacrazy-anychat-cron') continue;
          await updateDoc(doc(db, 'jobs_sincronizacao', jobDoc.id), {
            status: 'cancelado',
            mensagem: 'Cancelado pelo usuário',
            atualizadoEm: new Date().toISOString(),
          });
          cancelados++;
        }

        // Resetar config do worker
        await setDoc(configRef, { sincronizando: false }, { merge: true });

        console.log(`[SYNC-ANYCHAT] Reset: ${cancelados} jobs cancelados, sincronizando=false`);
        return NextResponse.json({ success: true, message: `${cancelados} jobs cancelados, worker resetado` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao cancelar';
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: 'Ação inválida' }, { status: 400 });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

// GET - Executar sincronização
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isManual = searchParams.get('manual') === 'true';

  console.log(`[SYNC-ANYCHAT] ${isManual ? 'Sync manual' : 'Verificando worker'}...`);

  const configRef = doc(db, 'configuracoes', WORKER_CONFIG_DOC);

  try {
    const configSnap = await getDoc(configRef);
    const configData = configSnap.exists() ? configSnap.data() : null;

    // Verificar se já está sincronizando (e se não está travado)
    if (configData?.sincronizando) {
      const ultimaAtualizacao = configData.atualizadoEm ? new Date(configData.atualizadoEm).getTime() : 0;
      const agora = Date.now();

      if (agora - ultimaAtualizacao > JOB_STUCK_TIMEOUT_MS) {
        console.log('[SYNC-ANYCHAT] Worker travado detectado, resetando...');
        await setDoc(configRef, { sincronizando: false }, { merge: true });
      } else {
        console.log('[SYNC-ANYCHAT] Worker já está sincronizando');
        return NextResponse.json({
          success: false,
          message: 'Sincronização já em andamento',
        });
      }
    }

    // Se não for manual, verificar se o worker está habilitado e se chegou a hora
    if (!isManual) {
      if (!configData?.enabled) {
        return NextResponse.json({ success: false, message: 'Worker desabilitado' });
      }

      const proximaExecucao = configData?.proximaExecucao;
      if (proximaExecucao) {
        const horaProxima = new Date(proximaExecucao).getTime();
        const agora = Date.now();

        if (agora < horaProxima) {
          const minutosRestantes = Math.ceil((horaProxima - agora) / 60000);
          return NextResponse.json({
            success: false,
            message: `Próxima execução em ${minutosRestantes} minutos`,
          });
        }
      } else {
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

    if (!DATACRAZY_TOKEN || !ANYCHAT_API_KEY) {
      await finalizarWorker(configRef, false);
      return NextResponse.json({ error: 'APIs não configuradas' }, { status: 500 });
    }

    // Verificar se existe job ativo (query simples sem composite index)
    const activeJobQuery = query(
      collection(db, 'jobs_sincronizacao'),
      where('status', '==', 'processando'),
      limit(10)
    );
    const activeJobSnap = await getDocs(activeJobQuery);
    const anychatActiveJobs = activeJobSnap.docs.filter(d => d.data().tipo === 'datacrazy-anychat-cron');

    if (anychatActiveJobs.length > 0) {
      const agora = Date.now();
      let hasActiveValidJob = false;

      for (const jobDoc of anychatActiveJobs) {
        const jobData = jobDoc.data();
        const jobAtualizado = jobData.atualizadoEm ? new Date(jobData.atualizadoEm).getTime() : 0;

        if (agora - jobAtualizado > JOB_STUCK_TIMEOUT_MS) {
          try {
            await updateDoc(doc(db, 'jobs_sincronizacao', jobDoc.id), {
              status: 'erro',
              mensagem: 'Job travado - timeout excedido',
              atualizadoEm: new Date().toISOString(),
            });
          } catch {
            // Ignora
          }
        } else {
          hasActiveValidJob = true;
        }
      }

      if (hasActiveValidJob) {
        await finalizarWorker(configRef, false);
        return NextResponse.json({
          success: false,
          message: 'Já existe uma sincronização em andamento',
        });
      }
    }

    // Criar job no Firebase (1 write)
    const jobRef = doc(collection(db, 'jobs_sincronizacao'));
    const jobId = jobRef.id;
    const agora = new Date().toISOString();

    await setDoc(jobRef, {
      id: jobId,
      tipo: 'datacrazy-anychat-cron',
      status: 'processando',
      total: 0,
      processados: 0,
      matches: 0,
      tagsAplicadas: 0,
      semMatch: 0,
      erros: 0,
      automatico: !isManual,
      criadoEm: agora,
      atualizadoEm: agora,
      mensagem: 'Fase 1: Carregando leads do DataCrazy...',
      fase: 1,
    });

    // ============================================
    // FASE 1 - Construir mapa DataCrazy (phone → tags)
    // Writes economizados: só atualiza no início, meio e fim da fase
    // ============================================
    console.log('[SYNC-ANYCHAT] Fase 1: Construindo mapa DataCrazy...');

    const phoneTagsMap = new Map<string, DatacrazyTagInfo>();
    let datacrazyTotal = 0;
    let datacrazyPage = 0;
    let datacrazyTotalPages = 0;

    try {
      const firstPage = await fetchDatacrazyLeads(0, 1);
      datacrazyTotal = firstPage.count;
      datacrazyTotalPages = Math.ceil(datacrazyTotal / DATACRAZY_PAGE_SIZE);
    } catch (err) {
      console.error('[SYNC-ANYCHAT] Erro ao buscar total DataCrazy:', err);
      await updateDoc(jobRef, {
        status: 'erro',
        mensagem: 'Erro ao conectar com DataCrazy',
        atualizadoEm: new Date().toISOString(),
      });
      await finalizarWorker(configRef, false);
      return NextResponse.json({ success: false, error: 'Erro ao conectar com DataCrazy' }, { status: 500 });
    }

    // Paginar todos os leads DataCrazy (sem writes intermediários - só console.log)
    let currentSkip = 0;
    let cancelado = false;

    // Checa cancelamento a cada 50 páginas (1 read Firebase)
    const checkCancelado = async (): Promise<boolean> => {
      try {
        const jobSnap = await getDoc(jobRef);
        return jobSnap.exists() && jobSnap.data().status === 'cancelado';
      } catch {
        return false;
      }
    };

    while (currentSkip < datacrazyTotal) {
      // Checar cancelamento a cada 50 páginas
      if (datacrazyPage > 0 && datacrazyPage % 50 === 0) {
        cancelado = await checkCancelado();
        if (cancelado) {
          console.log('[SYNC-ANYCHAT] Cancelado pelo usuário na Fase 1');
          break;
        }
      }

      try {
        const response = await fetchDatacrazyLeads(currentSkip, DATACRAZY_PAGE_SIZE);
        const leads = response.data;

        if (leads.length === 0) break;

        for (const lead of leads) {
          const phone = lead.phone || lead.rawPhone;
          if (!phone || !lead.tags || lead.tags.length === 0) continue;

          const normalizedPhone = normalizePhone(phone);
          if (!normalizedPhone) continue;

          phoneTagsMap.set(normalizedPhone, {
            name: lead.name || '',
            tags: lead.tags.map(t => ({
              name: t.name,
              color: datacrazyColorToHex(t.color),
            })),
          });
        }

        datacrazyPage++;
        currentSkip += leads.length;

        if (datacrazyPage % 50 === 0) {
          console.log(`[SYNC-ANYCHAT] Fase 1: ${datacrazyPage}/${datacrazyTotalPages} páginas (${phoneTagsMap.size} com tags)`);
        }

        await new Promise(r => setTimeout(r, DATACRAZY_DELAY_MS));
      } catch (err) {
        console.error(`[SYNC-ANYCHAT] Erro na página ${datacrazyPage}:`, err);
        currentSkip += DATACRAZY_PAGE_SIZE;
        datacrazyPage++;
      }
    }

    if (cancelado) {
      await finalizarWorker(configRef, false);
      return NextResponse.json({ success: false, message: 'Cancelado pelo usuário' });
    }

    console.log(`[SYNC-ANYCHAT] Fase 1 concluída. ${phoneTagsMap.size} leads com tags no mapa.`);

    if (phoneTagsMap.size === 0) {
      await updateDoc(jobRef, {
        status: 'concluido',
        total: datacrazyTotal,
        mensagem: 'Nenhum lead com tags encontrado no DataCrazy',
        atualizadoEm: new Date().toISOString(),
      });
      const proximaExecucao = await finalizarWorker(configRef, true);
      return NextResponse.json({
        success: true,
        message: 'Nenhum lead com tags encontrado',
        jobId,
        proximaExecucao,
      });
    }

    // 1 write: Fase 1 concluída, iniciando Fase 2
    await updateDoc(jobRef, {
      fase: 2,
      total: datacrazyTotal,
      leadsComTags: phoneTagsMap.size,
      mensagem: `Fase 2: Aplicando tags... 0/${phoneTagsMap.size} leads`,
      atualizadoEm: new Date().toISOString(),
    });

    // ============================================
    // FASE 2 - Paginar AnyChat e aplicar tags
    // Writes: 1 a cada 100 páginas (~5 writes para 478 páginas)
    // ============================================
    console.log('[SYNC-ANYCHAT] Fase 2: Aplicando tags no AnyChat...');

    let anychatPage = 1;
    let anychatTotalPages = 0;
    let anychatTotal = 0;
    let matches = 0;
    let tagsAplicadas = 0;
    let semMatch = 0;
    let erros = 0;

    // Processar contatos AnyChat (pula contatos "Branding.lab" que são duplicados do perfil business)
    let skipBrandingLab = 0;
    const processAnychatPage = async (contacts: Array<{ guid: string; name: string; clean_phone: string; tags: unknown[] }>) => {
      for (const contact of contacts) {
        if (!contact.clean_phone) {
          semMatch++;
          continue;
        }

        // Pular contatos do perfil business (duplicados)
        const contactName = (contact.name || '').trim().toLowerCase();
        if (contactName === 'branding.lab' || contactName === 'brandinglab') {
          skipBrandingLab++;
          continue;
        }

        const normalizedPhone = normalizePhone(contact.clean_phone);
        const datacrazyInfo = phoneTagsMap.get(normalizedPhone);

        if (!datacrazyInfo) {
          semMatch++;
          continue;
        }

        matches++;
        console.log(`[SYNC-ANYCHAT] ── MATCH #${matches} ──`);
        console.log(`[SYNC-ANYCHAT]   AnyChat: "${contact.name}" | phone_raw: ${contact.clean_phone} | normalizado: ${normalizedPhone} | guid: ${contact.guid}`);
        console.log(`[SYNC-ANYCHAT]   DataCrazy: "${datacrazyInfo.name}" | normalizado: ${normalizedPhone} | tags: ${datacrazyInfo.tags.length}`);

        const tagsToApply = datacrazyInfo.tags.map(t => ({
          label: t.name,
          color: t.color,
        }));

        try {
          const success = await applyTagsToContact(contact.guid, tagsToApply, contact.clean_phone);
          if (success) {
            tagsAplicadas += tagsToApply.length;
          } else {
            erros++;
          }
        } catch {
          erros++;
        }

        await new Promise(r => setTimeout(r, ANYCHAT_POST_DELAY_MS));
      }
    };

    try {
      const firstAnychat = await fetchAnychatContacts(1);
      anychatTotalPages = firstAnychat.pages;
      anychatTotal = firstAnychat.total;

      await processAnychatPage(firstAnychat.data);
      anychatPage = 2;
    } catch (err) {
      console.error('[SYNC-ANYCHAT] Erro ao buscar contatos AnyChat:', err);
      await updateDoc(jobRef, {
        status: 'erro',
        mensagem: 'Erro ao conectar com AnyChat',
        atualizadoEm: new Date().toISOString(),
      });
      await finalizarWorker(configRef, false);
      return NextResponse.json({ success: false, error: 'Erro ao conectar com AnyChat' }, { status: 500 });
    }

    while (anychatPage <= anychatTotalPages) {
      // Checar cancelamento a cada 50 páginas
      if (anychatPage > 1 && anychatPage % 50 === 0) {
        cancelado = await checkCancelado();
        if (cancelado) {
          console.log(`[SYNC-ANYCHAT] Cancelado pelo usuário na Fase 2 (página ${anychatPage})`);
          break;
        }
      }

      try {
        await new Promise(r => setTimeout(r, ANYCHAT_READ_DELAY_MS));
        const response = await fetchAnychatContacts(anychatPage);
        await processAnychatPage(response.data);
      } catch (err) {
        console.error(`[SYNC-ANYCHAT] Erro na página AnyChat ${anychatPage}:`, err);
        erros++;
      }

      // Atualizar progresso a cada 100 páginas (economiza writes)
      if (anychatPage % 100 === 0) {
        try {
          await updateDoc(jobRef, {
            matches,
            tagsAplicadas,
            semMatch,
            erros,
            mensagem: `Fase 2: ${matches} matches, página ${anychatPage}/${anychatTotalPages}`,
            atualizadoEm: new Date().toISOString(),
          });
        } catch {
          // Ignora
        }
      }

      anychatPage++;
    }

    if (cancelado) {
      await finalizarWorker(configRef, false);
      return NextResponse.json({ success: false, message: 'Cancelado pelo usuário', matches, tagsAplicadas });
    }

    // ============================================
    // FASE 3 - Finalizar (1 write final)
    // ============================================
    console.log(`[SYNC-ANYCHAT] Concluído. Matches: ${matches}, Tags: ${tagsAplicadas}, Erros: ${erros}, Branding.lab pulados: ${skipBrandingLab}`);

    await updateDoc(jobRef, {
      status: 'concluido',
      fase: 3,
      total: datacrazyTotal,
      totalAnychat: anychatTotal,
      processados: datacrazyTotal,
      matches,
      tagsAplicadas,
      semMatch,
      erros,
      skipBrandingLab,
      leadsComTags: phoneTagsMap.size,
      mensagem: `Concluído! ${matches} matches, ${tagsAplicadas} tags aplicadas (${skipBrandingLab} "Branding.lab" pulados)`,
      atualizadoEm: new Date().toISOString(),
    });

    const proximaExecucao = await finalizarWorker(configRef, true);

    return NextResponse.json({
      success: true,
      jobId,
      datacrazyTotal,
      anychatTotal,
      leadsComTags: phoneTagsMap.size,
      matches,
      tagsAplicadas,
      semMatch,
      erros,
      proximaExecucao,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[SYNC-ANYCHAT] ERRO:', errorMsg);

    try {
      const activeJobQuery = query(
        collection(db, 'jobs_sincronizacao'),
        where('status', '==', 'processando'),
        limit(10)
      );
      const activeJobSnap = await getDocs(activeJobQuery);
      const anychatJob = activeJobSnap.docs.find(d => d.data().tipo === 'datacrazy-anychat-cron');
      if (anychatJob) {
        await updateDoc(doc(db, 'jobs_sincronizacao', anychatJob.id), {
          status: 'erro',
          mensagem: `Erro: ${errorMsg}`,
          atualizadoEm: new Date().toISOString(),
        });
      }
    } catch {
      // Ignora
    }

    await finalizarWorker(configRef, false);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
