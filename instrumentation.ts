export async function register() {
  // Só roda no servidor (não no cliente)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSyncScheduler } = await import('./lib/sync-scheduler');
    startSyncScheduler();
  }
}
