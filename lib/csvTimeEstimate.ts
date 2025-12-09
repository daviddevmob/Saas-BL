export interface CsvTimeEstimate {
  totalRows: number;
  paidRows: number;
  estimatedSeconds: number;
  estimatedMinutes: number;
  formattedTime: string;
}

// Mapeamento do filtro de status por plataforma
const STATUS_FILTERS: Record<string, { column: string; values: string[] }> = {
  hubla: { column: 'Status da fatura', values: ['Paga'] },
  hotmart: { column: 'Status', values: ['Completo', 'Aprovado'] },
  eduzz: { column: 'Status', values: ['Paga'] },
  kiwify: { column: 'Status', values: ['paid'] },
  woocommerce: { column: 'Order Status', values: ['wc-completed'] },
};

export type CsvPlatform = 'hubla' | 'hotmart' | 'eduzz' | 'kiwify' | 'woocommerce';

export async function estimateCsvImportTime(
  file: File,
  platform: CsvPlatform
): Promise<CsvTimeEstimate> {
  const text = await file.text();
  const lines = text.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return { totalRows: 0, paidRows: 0, estimatedSeconds: 0, estimatedMinutes: 0, formattedTime: '0s' };
  }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const filter = STATUS_FILTERS[platform];
  const statusIndex = headers.findIndex(h => h === filter.column);

  let paidRows = 0;

  // Se não encontrou a coluna de status, considera todas as linhas
  if (statusIndex === -1) {
    paidRows = lines.length - 1;
  } else {
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const status = values[statusIndex]?.trim().replace(/^"|"$/g, '') || '';

      if (filter.values.includes(status)) {
        paidRows++;
      }
    }
  }

  // ~1.5 segundos por linha
  const estimatedSeconds = Math.ceil(paidRows * 1.5);
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

  let formattedTime: string;
  if (estimatedSeconds < 60) {
    formattedTime = `${estimatedSeconds} segundos`;
  } else if (estimatedMinutes === 1) {
    formattedTime = '1 minuto';
  } else {
    formattedTime = `${estimatedMinutes} minutos`;
  }

  return {
    totalRows: lines.length - 1,
    paidRows,
    estimatedSeconds,
    estimatedMinutes,
    formattedTime,
  };
}
