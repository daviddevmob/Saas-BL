"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("../lib/firebase");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const DATACRAZY_TOKEN = process.env.DATACRAZY_API || '';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';
// --- Funções de API e Cache (adaptadas do arquivo original) ---
function safeString(val) {
    if (val === null || val === undefined)
        return '';
    return String(val).trim();
}
function safeEmail(val) {
    const email = safeString(val).toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.'))
        return null;
    return email;
}
// Cache simples na memória do worker. Será limpo se o worker reiniciar.
const leadCache = new Map();
const tagCache = new Map();
async function apiRequest(method, endpoint, body) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
            'Content-Type': 'application/json',
        },
    };
    if (body)
        options.body = JSON.stringify(body);
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
async function processarLinha(row, columns, // ColumnMap
stageId, platform) {
    var _a, _b, _c, _d;
    const email = safeEmail(row[columns.email]);
    const name = safeString(row[columns.name]) || 'Sem nome';
    const productName = safeString(row[columns.product]);
    const transactionId = safeString(row[columns.transactionId]);
    if (!email || !transactionId) {
        return { status: 'skipped', message: 'Sem email ou transactionId', email: email || '', name };
    }
    let phone = safeString(row[columns.phone]);
    if (phone.startsWith('+'))
        phone = phone.substring(1);
    phone = phone.replace(/\D/g, '');
    const taxId = safeString(row[columns.taxId]).replace(/\D/g, '');
    const zipCode = safeString(row[columns.zip || '']);
    const streetAddress = safeString(row[columns.address || '']);
    // ... (código completo de processamento da linha adaptado aqui)
    let leadId;
    let leadTags = [];
    const cachedLead = leadCache.get(email);
    if (cachedLead) {
        leadId = cachedLead.id;
        leadTags = cachedLead.tags;
    }
    else {
        const leadSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(email)}`);
        if (leadSearch && leadSearch.count > 0) {
            leadId = leadSearch.data[0].id;
            leadTags = leadSearch.data[0].tags || [];
        }
        else {
            const newLead = await apiRequest('POST', '/leads', { name, email, phone: phone || undefined, taxId: taxId || undefined });
            leadId = newLead === null || newLead === void 0 ? void 0 : newLead.id;
        }
        if (leadId)
            leadCache.set(email, { id: leadId, tags: leadTags });
    }
    if (!leadId) {
        return { status: 'skipped', message: 'Não foi possível criar ou encontrar o lead', email, name };
    }
    if (productName) {
        let tagId;
        if (tagCache.has(productName)) {
            // O get() pode retornar undefined, mas o .has() nos dá confiança.
            // O fallback para null garante a segurança do tipo.
            tagId = (_a = tagCache.get(productName)) !== null && _a !== void 0 ? _a : null;
        }
        else {
            const tagSearch = await apiRequest('GET', `/tags?search=${encodeURIComponent(productName)}`);
            const foundId = (_c = (_b = tagSearch === null || tagSearch === void 0 ? void 0 : tagSearch.data) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id; // string | undefined
            tagId = foundId || null; // string | null
            tagCache.set(productName, tagId); // OK
        }
        if (tagId && !leadTags.some(t => t.id === tagId)) {
            await apiRequest('PATCH', `/leads/${leadId}`, { tags: [...leadTags.map(t => ({ id: t.id })), { id: tagId }] });
        }
    }
    const leadBusinesses = await apiRequest('GET', `/leads/${leadId}/businesses`);
    const existingBusiness = (_d = leadBusinesses === null || leadBusinesses === void 0 ? void 0 : leadBusinesses.data) === null || _d === void 0 ? void 0 : _d.find((biz) => biz.externalId === transactionId);
    if (!existingBusiness) {
        const saleValue = parseFloat(safeString(row[columns.total]).replace(',', '.')) || 0;
        await apiRequest('POST', '/businesses', { leadId, stageId, externalId: transactionId, total: saleValue });
        return { status: 'created', message: 'Negócio criado', email, name };
    }
    return { status: 'exists', message: 'Negócio já existe', email, name };
}
// --- O Processador do Worker ---
const firestore_2 = require("firebase/firestore");
/**
 * Tenta atualizar o documento do job pai. Se o documento não existir (erro 'not-found'),
 * ele o cria com 'setDoc' e 'merge: true'. Isso lida com a condição de corrida
 * em que o worker tenta atualizar um documento que ainda não foi totalmente propagado.
 */
async function updateParentJob(parentJobRef, dataToUpdate) {
    try {
        await (0, firestore_1.updateDoc)(parentJobRef, dataToUpdate);
    }
    catch (error) {
        if (error.code === 'not-found' || (error.message && error.message.includes('NOT_FOUND'))) {
            console.warn(`Documento pai não encontrado, tentando criar com setDoc({ merge: true }). ID: ${parentJobRef.id}`);
            // Converte `increment(x)` para apenas `x` para o 'setDoc' inicial.
            const initialData = Object.assign({}, dataToUpdate);
            for (const key in initialData) {
                if (initialData[key] && typeof initialData[key] === 'object' && 'toLegacySpec' in initialData[key]) {
                    // É um objeto de incremento, pega o valor
                    try {
                        initialData[key] = initialData[key]._toLegacySpec().operands[0].integerValue;
                    }
                    catch (_a) {
                        initialData[key] = 1; // Fallback para 1
                    }
                }
            }
            await (0, firestore_2.setDoc)(parentJobRef, initialData, { merge: true });
        }
        else {
            // Se for outro erro, lança para o BullMQ lidar com a retentativa.
            throw error;
        }
    }
}
const processor = async (job) => {
    const { row, columns, stageId, platform, parentJobId } = job.data;
    const parentJobRef = (0, firestore_1.doc)(firebase_1.db, 'jobs_importacao_monitor', parentJobId);
    try {
        const result = await processarLinha(row, columns, stageId, platform);
        const fieldToIncrement = result.status === 'created' ? 'sucessos' :
            result.status === 'skipped' ? 'ignorados' :
                'existentes';
        const updateData = {
            processados: (0, firestore_1.increment)(1),
            [fieldToIncrement]: (0, firestore_1.increment)(1),
            atualizadoEm: new Date().toISOString(),
            ultimaMensagem: `[${result.status}] ${safeString(result.email) || 'N/A'} - ${result.message}`,
        };
        await updateParentJob(parentJobRef, updateData);
        return result;
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido no worker';
        console.error(`Erro ao processar job ${job.id} para ${row.email}:`, error);
        const errorData = {
            processados: (0, firestore_1.increment)(1),
            erros: (0, firestore_1.increment)(1),
            atualizadoEm: new Date().toISOString(),
            [`errosDetalhes.${job.id}`]: {
                email: safeString(row.email) || 'não informado',
                name: safeString(row.name) || 'não informado',
                error: errorMsg.substring(0, 500)
            }
        };
        await updateParentJob(parentJobRef, errorData);
        throw error;
    }
};
exports.default = processor;
