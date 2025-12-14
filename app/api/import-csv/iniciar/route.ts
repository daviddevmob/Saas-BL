import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, collection } from 'firebase/firestore';
import { getCsvImportQueue } from '@/lib/queue';
import Papa from 'papaparse';
import { Readable } from 'stream';

// Definições de STAGES e COLUMN_MAP permanecem as mesmas...
const STAGES: Record<string, string> = {
  hubla: '74022307-988f-4a81-a3df-c14b28bd41d9',
  hotmart: '0c2bf45f-1c4b-4730-b02c-286b7c018f29',
  eduzz: '3bbc9611-aa0d-47d5-a755-a9cdcfc453ef',
  kiwify: '491a2794-7576-45d0-8d8e-d5a6855f17e2',
  woo: '2c16fbba-092d-48a8-929b-55c5b9d638cc',
};

const COLUMN_MAP: Record<string, any> = {
  hubla: { email: 'Email do cliente', name: 'Nome do cliente', phone: 'Telefone do cliente', taxId: 'Documento do cliente', product: 'Nome do produto', transactionId: 'ID da fatura', total: 'Valor total', status: 'Status da fatura', statusPaid: 'Paga' },
  hotmart: { email: 'Email', name: 'Nome', phone: 'Telefone Final', taxId: 'Documento', product: 'Nome do Produto', transactionId: 'Transação', total: 'Preço Total', status: 'Status', statusPaid: 'Aprovado' },
  eduzz: { email: 'Cliente / E-mail', name: 'Cliente / Nome', phone: 'Cliente / Fones', taxId: 'Cliente / Documento', product: 'Produto', transactionId: 'Fatura', total: 'Valor da Venda', status: 'Status', statusPaid: 'Paga' },
  kiwify: { email: 'Email', name: 'Cliente', phone: 'Celular', taxId: 'CPF / CNPJ', product: 'Produto', transactionId: 'ID da venda', total: 'Valor líquido', status: 'Status', statusPaid: 'paid' },
  woo: { email: 'Billing Email Address', name: 'Billing First Name', phone: 'Billing Phone', taxId: '_billing_cpf', product: 'Product Name #1', transactionId: 'Order ID', total: 'Order Total', status: 'Order Status', statusPaid: 'wc-completed' },
};

function safeString(val: unknown): string {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

interface CustomMapping {
  email: string;
  name: string;
  phone?: string;
  taxId?: string;
  product?: string;
  transactionId: string;
  total?: string;
  status: string;
  statusFilter: string;
}

function convertCustomMapping(custom: CustomMapping): any {
  return {
    email: custom.email, name: custom.name, phone: custom.phone || '', taxId: custom.taxId || '', product: custom.product || '', transactionId: custom.transactionId, total: custom.total || '', status: custom.status, statusPaid: custom.statusFilter,
  };
}


// POST - Criar e enfileirar jobs de importação
export async function POST(request: NextRequest) {
  console.log('[API /iniciar] Recebida nova requisição de importação.');
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const platform = formData.get('platform') as string || '';
    const customMappingStr = formData.get('customMapping') as string || '';
    const customStageId = formData.get('stageId') as string || '';

    if (!file) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    let stageId: string;
    let columns: any;
    let platformName: string;
    let statusPaidValue: string;

    if (customMappingStr && customStageId) {
      const customMapping = JSON.parse(customMappingStr) as CustomMapping;
      columns = convertCustomMapping(customMapping);
      stageId = customStageId;
      platformName = 'custom';
      statusPaidValue = columns.statusPaid;
    } else if (platform) {
      stageId = STAGES[platform];
      columns = COLUMN_MAP[platform];
      platformName = platform;
      statusPaidValue = columns.statusPaid;
      if (!stageId || !columns) {
        return NextResponse.json({ success: false, error: `Plataforma não suportada: ${platform}` }, { status: 400 });
      }
    } else {
      return NextResponse.json({ success: false, error: 'Plataforma ou mapeamento customizado é obrigatório' }, { status: 400 });
    }

    // Criar um "job pai" para monitoramento no Firestore
    const parentJobRef = doc(collection(db, 'jobs_importacao_monitor'));
    const parentJobId = parentJobRef.id;

    const allRows: any[] = [];
    const fileStream = Readable.from(Buffer.from(await file.arrayBuffer()));

    await new Promise<void>((resolve, reject) => {
      Papa.parse(fileStream, {
        header: true,
        skipEmptyLines: true,
        worker: false, // O streaming no Node.js requer que o worker seja desabilitado
        step: (results) => {
          const row = results.data as any;
          // Filtra a linha aqui mesmo, no stream
          const status = safeString(row[columns.status]);
          if (status === statusPaidValue) {
            allRows.push(row);
          }
        },
        complete: () => {
          console.log(`[API /iniciar] Leitura do stream do CSV concluída. Total de linhas filtradas: ${allRows.length}`);
          resolve();
        },
        error: (error) => {
          console.error('[API /iniciar] Erro no stream do PapaParse:', error);
          reject(error);
        },
      });
    });

    const totalLinhasFiltradas = allRows.length;
    if (totalLinhasFiltradas === 0) {
      return NextResponse.json({ success: false, error: `Nenhum registro com status "${statusPaidValue}" encontrado.` }, { status: 400 });
    }

    // Inicializa o job de monitoramento
    await setDoc(parentJobRef, {
      id: parentJobId,
      status: 'enfileirando',
      plataforma: platformName,
      arquivo: file.name,
      total: totalLinhasFiltradas,
      processados: 0,
      sucessos: 0,
      erros: 0,
      existentes: 0,
      ignorados: 0,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    });

    // Adiciona todas as linhas filtradas à fila do BullMQ como jobs individuais
    const jobs = allRows.map(row => ({
      name: 'import-csv-row',
      data: {
        row,
        columns,
        stageId,
        platform: platformName,
        parentJobId,
      },
      opts: {
        attempts: 3, // Tenta re-executar até 3 vezes em caso de falha
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true, // Remove o job do Redis após a conclusão
        removeOnFail: true, // Remove o job do Redis após todas as tentativas falharem
      },
    }));

    const queue = getCsvImportQueue();
    await queue.addBulk(jobs);

    // Atualiza o status do job pai para "processando" após enfileirar tudo
    await setDoc(parentJobRef, { status: 'processando', atualizadoEm: new Date().toISOString() }, { merge: true });

    console.log(`[API /iniciar] ${totalLinhasFiltradas} jobs enfileirados. Job pai: ${parentJobId}`);

    return NextResponse.json({
      success: true,
      jobId: parentJobId, // Retorna o ID do job pai para o front-end
      total: totalLinhasFiltradas,
      mensagem: `${totalLinhasFiltradas} registros foram enfileirados para processamento.`,
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido na API /iniciar';
    console.error('[API /iniciar] ERRO FATAL:', errorMsg, e);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
