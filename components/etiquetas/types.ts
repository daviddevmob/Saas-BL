import { Timestamp } from 'firebase/firestore';

// Interface para mapeamento de colunas
export interface ColumnMapping {
  [fieldKey: string]: string; // fieldKey -> csvColumnName
}

// Interface para template de mapeamento salvo no Firebase
export interface MappingTemplate {
  id?: string;
  name: string;
  logo?: string; // Nome da imagem em public/lojas (ex: "hotmart.jpeg")
  mapping: ColumnMapping;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Interface para dados originais de uma venda (para restauração completa)
export interface OriginalSaleData {
  transaction: string;
  productName: string;
  productCode: string;
  totalPrice: string;
  document: string;
  saleDate: string;
  // Campos adicionais para restauração completa
  phone: string;
  country: string;
  servicoEct: string;
  // Campos de etiqueta para restauração do status
  etiquetaStatus?: 'pending' | 'generated' | 'partial' | 'error';
  etiqueta?: string;
  etiquetas?: string[];
  enviosTotal: number;
  enviosRealizados: number;
}

// Interface principal para vendas físicas
export interface PhysicalSale {
  transaction: string;
  productName: string;
  productCode: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  state: string;
  neighborhood: string;
  country: string;
  address: string;
  number: string;
  complement: string;
  saleDate: string;
  totalPrice: string;
  selected: boolean;
  servicoEct: string; // Código do serviço ECT (Correios)
  etiqueta?: string; // Última etiqueta gerada (se existir)
  etiquetas?: string[]; // Todas as etiquetas geradas para este pedido
  etiquetaStatus?: 'pending' | 'generated' | 'partial' | 'error';
  enviosTotal: number; // Quantidade total de envios planejados
  enviosRealizados: number; // Quantidade de envios já realizados
  // Campos para pedidos mesclados
  isMerged?: boolean; // Este pedido foi criado por merge
  mergedTransactions?: string[]; // Lista de transactionIds originais (se mesclado)
  mergedProductNames?: string[]; // Lista de nomes de produtos (se mesclado)
  mergedOriginalSales?: OriginalSaleData[]; // Dados completos para restauração
  mergedInto?: string; // Se este pedido foi mesclado em outro, qual é o ID
}

// Interface para dados do destinatário (para reenvio)
export interface DestinatarioData {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

// Interface para registro de etiqueta no Firebase
export interface EtiquetaRecord {
  transactionId: string;
  etiqueta: string;
  destinatario: string;
  createdAt: Timestamp;
  envioNumero?: number; // Qual envio é este (1, 2, 3...)
  enviosTotal?: number; // Total de envios planejados
  // Campos para pedidos mesclados
  mergedTransactionIds?: string[]; // Lista de transactionIds se for pedido mesclado
  produtos?: string[]; // Lista de produtos se for pedido mesclado
  // Campos opcionais extras para histórico visual
  productName?: string;
  service?: string; // Serviço ECT
  zip?: string;
  updatedAt?: Timestamp;
  // Campos de Rastreamento (Sincronização)
  trackingStatus?: string; // ex: "Entregue", "Em trânsito", "Aguardando postagem"
  trackingLastUpdate?: Timestamp; // Quando foi a última vez que checamos na API
  trackingEvents?: TrackingEvent[]; // Histórico completo
  // Dados completos do destinatário (para reenvio)
  destinatarioData?: DestinatarioData;
  // Controle de envio WhatsApp ao cliente
  // null/undefined = etiqueta antiga (já notificada automaticamente)
  // false = pendente (aguardando postagem para enviar)
  // true = enviado
  whatsappEnviado?: boolean | null;
  whatsappEnviadoEm?: Timestamp;
  whatsappErro?: string;
  // Controle de notificação de retirada nos Correios
  retiradaNotificado?: boolean;
  retiradaNotificadoEm?: Timestamp;
  retiradaErro?: string;
}

export interface TrackingEvent {
  data: string;
  hora: string;
  local: string;
  status: string;
  subStatus?: string[];
}

// Interface para dados de etiquetas existentes
export interface ExistingLabelData {
  etiquetas: string[];
  enviosRealizados: number;
  enviosTotal: number;
  ultimaEtiqueta: string;
}

// Interface para configurações de etiquetas
export interface EtiquetasSettings {
  adminPhone: string;
  clientPhoneOverride: string;
  sendToN8n: boolean;
  useTestCredentials: boolean;
  updatedAt?: Timestamp;
}

// Interface para merge salvo no Firebase
export interface SavedMerge {
  mergeId: string; // ID único e consistente do merge
  originalSales: OriginalSaleData[]; // Dados completos dos pedidos originais
  createdAt: Timestamp;
}

// Interface para definição de campo
export interface FieldDefinition {
  key: string;
  label: string;
  required: boolean;
  description: string;
}

// Interface para logo disponível
export interface AvailableLogo {
  name: string;
  label: string;
}

// Interface para serviço ECT
export interface ServicoECT {
  code: string;
  name: string;
}
