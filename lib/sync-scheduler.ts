import * as cron from 'node-cron';

// Flag para evitar múltiplas instâncias do scheduler
let schedulerStarted = false;
let currentTask: ReturnType<typeof cron.schedule> | null = null;

// URL base da aplicação
const getAppUrl = () => {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
};

async function executarSync() {
  const appUrl = getAppUrl();
  console.log(`[SCHEDULER] Verificando sync em ${appUrl}...`);

  try {
    // Chamar a API de sync (a API decide se executa baseado no Firebase)
    const response = await fetch(`${appUrl}/api/cron/sync-datacrazy-swipeone`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.success) {
      if (data.totalLeads > 0) {
        console.log(`[SCHEDULER] Sync executado: ${data.processados}/${data.totalLeads} leads`);
      } else if (data.message) {
        console.log(`[SCHEDULER] ${data.message}`);
      }
    } else {
      // Mensagens normais (worker desabilitado, já sincronizando, etc)
      if (data.message) {
        console.log(`[SCHEDULER] ${data.message}`);
      }
    }

  } catch (err) {
    console.error('[SCHEDULER] Erro ao chamar API:', err instanceof Error ? err.message : err);
  }
}

export function startSyncScheduler() {
  if (schedulerStarted) {
    console.log('[SCHEDULER] Scheduler já está rodando');
    return;
  }

  schedulerStarted = true;
  console.log('[SCHEDULER] ========================================');
  console.log('[SCHEDULER] Iniciando scheduler de sincronização');
  console.log('[SCHEDULER] Intervalo: verificação a cada 1 minuto');
  console.log('[SCHEDULER] O worker controla quando realmente sincroniza');
  console.log('[SCHEDULER] ========================================');

  // Executar a cada 1 minuto
  // O controle do intervalo real (15min, 30min, etc) é feito pela API
  currentTask = cron.schedule('* * * * *', executarSync, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[SCHEDULER] Cron job agendado');

  // Executar uma vez ao iniciar (após 10 segundos para o servidor estar pronto)
  setTimeout(() => {
    console.log('[SCHEDULER] Primeira verificação...');
    executarSync();
  }, 10000);
}

export function stopSyncScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    schedulerStarted = false;
    console.log('[SCHEDULER] Scheduler parado');
  }
}
