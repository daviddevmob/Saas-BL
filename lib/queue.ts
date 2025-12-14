import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const QUEUE_NAME = 'csv-import';

let connection: IORedis | undefined;
let csvImportQueue: Queue | undefined;

function getRedisConnection() {
  if (!connection) {
    console.log("Inicializando nova conexão com o Redis...");
    connection = new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export function getCsvImportQueue() {
  if (!csvImportQueue) {
    csvImportQueue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return csvImportQueue;
}

export const createCsvImportWorker = (processor: (job: any) => Promise<any>) => {
  return new Worker(QUEUE_NAME, processor, {
    connection: getRedisConnection(),
    concurrency: 5,
    limiter: {
      max: 60,
      duration: 60000,
    },
  });
};
