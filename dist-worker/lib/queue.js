"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCsvImportWorker = void 0;
exports.getCsvImportQueue = getCsvImportQueue;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const QUEUE_NAME = 'csv-import';
let connection;
let csvImportQueue;
function getRedisConnection() {
    if (!connection) {
        console.log("Inicializando nova conexão com o Redis...");
        connection = new ioredis_1.default({
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });
    }
    return connection;
}
function getCsvImportQueue() {
    if (!csvImportQueue) {
        csvImportQueue = new bullmq_1.Queue(QUEUE_NAME, { connection: getRedisConnection() });
    }
    return csvImportQueue;
}
const createCsvImportWorker = (processor) => {
    return new bullmq_1.Worker(QUEUE_NAME, processor, {
        connection: getRedisConnection(),
        concurrency: 5,
        limiter: {
            max: 60,
            duration: 60000,
        },
    });
};
exports.createCsvImportWorker = createCsvImportWorker;
