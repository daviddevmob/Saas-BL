import * as Papa from 'papaparse';
import { ColumnMapping } from './types';
import { AUTO_DETECTION_RULES } from './constants';

// Função para verificar se é produto físico (contém "físico", "fisico" ou "kit" no nome)
export function isPhysicalProduct(productName: string): boolean {
  const name = productName.toLowerCase();
  // Verifica "físico" (com acento), "fisico" (sem acento) ou "kit"
  return name.includes('físico') || name.includes('fisico') || name.includes('kit');
}

// Função para parsear data em qualquer formato (BR ou ISO)
export function parseDate(dateStr: string): number {
  if (!dateStr) return 0;

  // Tentar formato ISO primeiro (YYYY-MM-DD ou com T)
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  // Tentar formato brasileiro DD/MM/YYYY ou DD/MM/YYYY HH:mm:ss
  const brMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (brMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = brMatch;
    date = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return 0;
}

// Função para parsing de CSV usando PapaParse
export function parseCSV(text: string): Record<string, string>[] {
  // Usar PapaParse para parsing robusto de CSVs grandes
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  console.log(`[CSV] PapaParse: ${result.data.length} linhas, ${result.meta.fields?.length || 0} colunas, delimitador: "${result.meta.delimiter}"`);

  if (result.errors.length > 0) {
    console.warn('[CSV] PapaParse warnings:', result.errors.slice(0, 5));
  }

  return result.data;
}

// Função para tentar detectar mapeamento automaticamente
export function autoDetectMapping(csvColumns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const columnsLower = csvColumns.map(c => c.toLowerCase().trim());

  for (const rule of AUTO_DETECTION_RULES) {
    for (let i = 0; i < columnsLower.length; i++) {
      const col = columnsLower[i];
      if (rule.keywords.some(kw => col.includes(kw))) {
        // Verificar se não é um falso positivo (ex: "email do comprador" não deve mapear para "name")
        if (!mapping[rule.key]) {
          mapping[rule.key] = csvColumns[i];
          break;
        }
      }
    }
  }

  return mapping;
}

// Gerar ID consistente para merge baseado nos IDs das transações
export function generateMergeId(transactions: string[]): string {
  // Usar hash simples dos IDs ordenados para evitar problemas com underscores
  const sorted = [...transactions].sort();
  return `MERGED_${sorted.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).join('-')}`;
}

// Limpar campos undefined para o Firebase (não aceita undefined)
export function sanitizeForFirebase<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// Formatar telefone para exibição
export function formatPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

// Formatar CEP para exibição
export function formatCEP(cep: string): string {
  if (!cep) return '';
  const cleaned = cep.replace(/\D/g, '');
  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  }
  return cep;
}

// Formatar data BR
export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '';

  // Se já está no formato DD/MM/YYYY, retorna como está
  if (/^\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
    return dateStr;
  }

  // Tenta converter de ISO
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('pt-BR');
  }

  return dateStr;
}

// Re-exportar sanitizadores e normalizadores ViPP / Correios
export {
  sanitizeVippText,
  sanitizeVippDestinatario,
  normalizeUF,
  normalizeCidade,
  normalizeNumeroEComplemento,
  normalizeCEP,
  normalizeTelefone,
} from '@/lib/vippSanitizer';

