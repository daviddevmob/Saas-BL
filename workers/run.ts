// workers/run.ts
import { createCsvImportWorker } from '../lib/queue';
import processor from './csvProcessor';

console.log('Iniciando o CSV Import Worker...');

const worker = createCsvImportWorker(processor);

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} (Pai: ${job.data.parentJobId}) concluído com sucesso. Status: ${result.status}`);
});

worker.on('failed', (job, err) => {
  if (job) {
    console.error(`Job ${job.id} (Pai: ${job.data.parentJobId}) falhou após ${job.attemptsMade} tentativas com o erro: ${err.message}`);
  } else {
    console.error(`Um job falhou, mas os dados do job não estão disponíveis. Erro: ${err.message}`);
  }
});

console.log('Worker está escutando por jobs na fila "csv-import".');

const gracefulShutdown = () => {
  console.log('Recebendo sinal de desligamento, fechando o worker...');
  worker.close().then(() => {
    console.log('Worker finalizado.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
