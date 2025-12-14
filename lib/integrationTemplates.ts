import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';

// Interface para o mapeamento de colunas
export interface IntegrationMapping {
  email: string;        // Coluna do CSV para email (obrigatório)
  name: string;         // Coluna do CSV para nome (obrigatório)
  phone?: string;       // Coluna do CSV para telefone
  taxId?: string;       // Coluna do CSV para CPF/CNPJ
  product?: string;     // Coluna do CSV para produto
  transactionId: string; // Coluna do CSV para ID transação (obrigatório)
  total?: string;       // Coluna do CSV para valor
  status: string;       // Coluna do CSV para status (obrigatório)
  statusFilter: string; // Valor do status a filtrar (ex: "Paga", "Aprovado")
  // Endereço
  zip?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

// Interface para template de integração
export interface IntegrationTemplate {
  id?: string;
  name: string;
  mapping: IntegrationMapping;
  stageId: string;      // Stage ID no Datacrazy (obrigatório)
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Stages disponíveis para escolha (com logo)
export const AVAILABLE_STAGES = [
  { id: '74022307-988f-4a81-a3df-c14b28bd41d9', name: 'Hubla', logo: 'hubla.jpeg' },
  { id: '0c2bf45f-1c4b-4730-b02c-286b7c018f29', name: 'Hotmart', logo: 'hotmart.jpeg' },
  { id: '3bbc9611-aa0d-47d5-a755-a9cdcfc453ef', name: 'Eduzz', logo: 'eduzz.jpg' },
  { id: '491a2794-7576-45d0-8d8e-d5a6855f17e2', name: 'Kiwify', logo: 'kiwwify.png' },
  { id: '2c16fbba-092d-48a8-929b-55c5b9d638cc', name: 'WooCommerce', logo: 'woo.png' },
];

// Campos obrigatórios para validação
export const REQUIRED_MAPPING_FIELDS: (keyof IntegrationMapping)[] = [
  'email',
  'name',
  'transactionId',
  'status',
  'statusFilter',
];

// Campos opcionais
export const OPTIONAL_MAPPING_FIELDS: (keyof IntegrationMapping)[] = [
  'phone',
  'taxId',
  'product',
  'total',
  'zip',
  'address',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
];

// Labels para os campos
export const FIELD_LABELS: Record<keyof IntegrationMapping, string> = {
  email: 'Email',
  name: 'Nome',
  phone: 'Telefone',
  taxId: 'CPF/CNPJ',
  product: 'Produto',
  transactionId: 'ID Transação',
  total: 'Valor Total',
  status: 'Status',
  statusFilter: 'Filtrar Status (valor)',
  zip: 'CEP',
  address: 'Rua',
  number: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'Estado',
};

const COLLECTION_NAME = 'integration_templates';

// Buscar todos os templates
export async function fetchIntegrationTemplates(): Promise<IntegrationTemplate[]> {
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('name', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as IntegrationTemplate[];
  } catch (error) {
    console.error('Erro ao buscar templates de integração:', error);
    return [];
  }
}

// Salvar novo template
export async function saveIntegrationTemplate(
  name: string,
  mapping: IntegrationMapping,
  stageId: string
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
      name,
      mapping,
      stageId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return docRef.id;
  } catch (error) {
    console.error('Erro ao salvar template de integração:', error);
    throw error;
  }
}

// Atualizar template existente
export async function updateIntegrationTemplate(
  id: string,
  name: string,
  stageId: string
): Promise<void> {
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
      name,
      stageId,
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Erro ao atualizar template de integração:', error);
    throw error;
  }
}

// Excluir template
export async function deleteIntegrationTemplate(id: string): Promise<void> {
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Erro ao excluir template de integração:', error);
    throw error;
  }
}

// Validar se o mapeamento tem todos os campos obrigatórios
export function validateMapping(mapping: Partial<IntegrationMapping>): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  for (const field of REQUIRED_MAPPING_FIELDS) {
    if (!mapping[field] || mapping[field].trim() === '') {
      missingFields.push(FIELD_LABELS[field]);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

// Auto-detectar colunas baseado em nomes similares
export function autoDetectColumns(
  csvColumns: string[]
): Partial<IntegrationMapping> {
  const detected: Partial<IntegrationMapping> = {};
  const lowerColumns = csvColumns.map((c) => c.toLowerCase().trim());

  // Mapeamento de palavras-chave para campos
  const keywordMap: Record<keyof IntegrationMapping, string[]> = {
    email: ['email', 'e-mail', 'e_mail', 'mail'],
    name: ['nome', 'name', 'cliente', 'customer', 'nome do cliente', 'nome completo'],
    phone: ['telefone', 'phone', 'fone', 'celular', 'mobile', 'tel'],
    taxId: ['cpf', 'cnpj', 'documento', 'document', 'cpf/cnpj', 'tax'],
    product: ['produto', 'product', 'nome do produto', 'item'],
    transactionId: ['transação', 'transacao', 'transaction', 'id', 'fatura', 'invoice', 'pedido', 'order'],
    total: ['total', 'valor', 'value', 'price', 'preço', 'preco', 'amount'],
    status: ['status', 'situação', 'situacao', 'state'],
    statusFilter: [],
    zip: ['cep', 'zip', 'codigo postal', 'postal'],
    address: ['rua', 'endereço', 'endereco', 'address', 'logradouro', 'street'],
    number: ['número', 'numero', 'number', 'nº', 'num'],
    complement: ['complemento', 'complement', 'comp'],
    neighborhood: ['bairro', 'neighborhood', 'district'],
    city: ['cidade', 'city', 'municipio', 'município'],
    state: ['estado', 'state', 'uf'],
  };

  for (const [field, keywords] of Object.entries(keywordMap) as [keyof IntegrationMapping, string[]][]) {
    if (keywords.length === 0) continue;

    for (let i = 0; i < lowerColumns.length; i++) {
      const col = lowerColumns[i];
      for (const keyword of keywords) {
        if (col.includes(keyword)) {
          detected[field] = csvColumns[i];
          break;
        }
      }
      if (detected[field]) break;
    }
  }

  return detected;
}
