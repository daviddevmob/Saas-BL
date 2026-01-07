import { FieldDefinition, AvailableLogo, ServicoECT, ColumnMapping } from './types';

// Serviços ECT disponíveis (Correios) - códigos do contrato
export const SERVICOS_ECT: ServicoECT[] = [
  { code: '201501', name: 'IMPRESSO Normal Módico' },
  { code: '3298', name: 'PAC Prata/Ouro/Platinum' },
  { code: '3220', name: 'SEDEX Prata/Ouro/Platinum' },
];

export const DEFAULT_SERVICO_ECT = '201501';

// Campos necessários para etiquetas
export const REQUIRED_FIELDS = ['transaction', 'name', 'zip'] as const;

// Definição dos campos para mapeamento
export const FIELD_DEFINITIONS: FieldDefinition[] = [
  { key: 'transaction', label: 'Código da Transação', required: true, description: 'Identificador único do pedido' },
  { key: 'productName', label: 'Nome do Produto', required: false, description: 'Nome do produto vendido' },
  { key: 'productCode', label: 'Código do Produto', required: false, description: 'Código/SKU do produto' },
  { key: 'name', label: 'Nome do Cliente', required: true, description: 'Nome completo do destinatário' },
  { key: 'document', label: 'CPF/CNPJ', required: false, description: 'Documento do cliente' },
  { key: 'email', label: 'Email', required: false, description: 'Email do cliente' },
  { key: 'phone', label: 'Telefone', required: false, description: 'Telefone do cliente' },
  { key: 'zip', label: 'CEP', required: true, description: 'CEP do endereço de entrega' },
  { key: 'address', label: 'Logradouro', required: false, description: 'Rua/Avenida' },
  { key: 'number', label: 'Número', required: false, description: 'Número do endereço' },
  { key: 'complement', label: 'Complemento', required: false, description: 'Apartamento, bloco, etc.' },
  { key: 'neighborhood', label: 'Bairro', required: false, description: 'Bairro' },
  { key: 'city', label: 'Cidade', required: false, description: 'Cidade' },
  { key: 'state', label: 'Estado/UF', required: false, description: 'Estado (sigla)' },
  { key: 'country', label: 'País', required: false, description: 'País' },
  { key: 'saleDate', label: 'Data da Venda', required: false, description: 'Data da transação' },
  { key: 'totalPrice', label: 'Valor Total', required: false, description: 'Valor da compra' },
];

// Mapeamento padrão para Hotmart (formato 2025)
export const HOTMART_MAPPING: ColumnMapping = {
  transaction: 'Código da transação',
  status: 'Status da transação',
  productName: 'Produto',
  productCode: 'Código do produto',
  name: 'Comprador(a)',
  document: 'Documento',
  email: 'Email do(a) Comprador(a)',
  phone: 'Telefone',
  zip: 'Código postal',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'Estado / Província',
  country: 'País',
  saleDate: 'Data da transação',
  totalPrice: 'Valor de compra com impostos',
};

// Colunas do CSV Hotmart (formato atualizado 2025) - mantido para compatibilidade
export const HOTMART_COLUMNS: ColumnMapping = {
  productName: 'Produto',
  productCode: 'Código do produto',
  transaction: 'Código da transação',
  status: 'Status da transação',
  name: 'Comprador(a)',
  document: 'Documento',
  email: 'Email do(a) Comprador(a)',
  phone: 'Telefone',
  zip: 'Código postal',
  city: 'Cidade',
  state: 'Estado / Província',
  neighborhood: 'Bairro',
  country: 'País',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  saleDate: 'Data da transação',
  totalPrice: 'Valor de compra com impostos',
};

// Logos disponíveis em public/lojas
export const AVAILABLE_LOGOS: AvailableLogo[] = [
  { name: 'hotmart.jpeg', label: 'Hotmart' },
  { name: 'kiwwify.png', label: 'Kiwify' },
  { name: 'eduzz.jpg', label: 'Eduzz' },
  { name: 'hubla.jpeg', label: 'Hubla' },
  { name: 'woo.png', label: 'WooCommerce' },
];

// ID fixo do documento de configurações
export const SETTINGS_DOC_ID = 'etiquetas_config';

// Regras de detecção automática de campos
export const AUTO_DETECTION_RULES: { key: string; keywords: string[] }[] = [
  { key: 'transaction', keywords: ['transação', 'transacao', 'transaction', 'pedido', 'order', 'código da transação'] },
  { key: 'status', keywords: ['status'] },
  { key: 'productName', keywords: ['produto', 'product', 'nome do produto'] },
  { key: 'productCode', keywords: ['código do produto', 'codigo do produto', 'sku', 'product code'] },
  { key: 'name', keywords: ['nome', 'name', 'comprador', 'cliente', 'destinatário', 'destinatario'] },
  { key: 'document', keywords: ['documento', 'cpf', 'cnpj', 'document'] },
  { key: 'email', keywords: ['email', 'e-mail'] },
  { key: 'phone', keywords: ['telefone', 'phone', 'celular', 'cel', 'fone'] },
  { key: 'zip', keywords: ['cep', 'zip', 'código postal', 'codigo postal', 'postal'] },
  { key: 'address', keywords: ['endereço', 'endereco', 'address', 'logradouro', 'rua'] },
  { key: 'number', keywords: ['número', 'numero', 'number', 'nº'] },
  { key: 'complement', keywords: ['complemento', 'complement', 'apto', 'apartamento'] },
  { key: 'neighborhood', keywords: ['bairro', 'neighborhood'] },
  { key: 'city', keywords: ['cidade', 'city', 'município', 'municipio'] },
  { key: 'state', keywords: ['estado', 'state', 'uf', 'província', 'provincia'] },
  { key: 'country', keywords: ['país', 'pais', 'country'] },
  { key: 'saleDate', keywords: ['data', 'date', 'venda', 'transação', 'transacao'] },
  { key: 'totalPrice', keywords: ['valor', 'total', 'price', 'preço', 'preco'] },
];
