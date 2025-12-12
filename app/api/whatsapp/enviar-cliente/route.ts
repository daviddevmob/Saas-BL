import { NextRequest, NextResponse } from 'next/server';

// Configuração Evolution API
const EVOLUTION_CONFIG = {
  baseUrl: process.env.EVOLUTION_API_URL || '',
  apiKey: process.env.EVOLUTION_API_KEY || '',
  instanceName: process.env.EVOLUTION_INSTANCE_NAME || '',
  messageDelay: parseInt(process.env.EVOLUTION_MESSAGE_DELAY || '5000'),
};

interface MensagemCliente {
  telefone: string; // Número formatado (5511999999999)
  mensagem: string;
  clienteNome: string;
  transactionId: string;
}

interface EnviarClienteRequest {
  mensagens: MensagemCliente[];
}

// Função para enviar mensagem via Evolution API
async function enviarMensagemEvolution(telefone: string, mensagem: string): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${EVOLUTION_CONFIG.baseUrl}/message/sendText/${EVOLUTION_CONFIG.instanceName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_CONFIG.apiKey,
      },
      body: JSON.stringify({
        number: telefone,
        text: mensagem,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Evolution] Erro ao enviar para ${telefone}:`, errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log(`[Evolution] Mensagem enviada para ${telefone}:`, result);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[Evolution] Exceção ao enviar para ${telefone}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

// Função de delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    // Validar configuração
    if (!EVOLUTION_CONFIG.baseUrl || !EVOLUTION_CONFIG.apiKey || !EVOLUTION_CONFIG.instanceName) {
      return NextResponse.json(
        { error: 'Evolution API não configurada. Verifique EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME' },
        { status: 500 }
      );
    }

    const body: EnviarClienteRequest = await request.json();
    const { mensagens } = body;

    if (!mensagens || mensagens.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma mensagem para enviar' },
        { status: 400 }
      );
    }

    console.log(`[WhatsApp] Iniciando envio de ${mensagens.length} mensagem(s) com delay de ${EVOLUTION_CONFIG.messageDelay}ms`);

    const resultados: Array<{
      telefone: string;
      clienteNome: string;
      transactionId: string;
      success: boolean;
      error?: string;
    }> = [];

    // Processar mensagens com delay
    for (let i = 0; i < mensagens.length; i++) {
      const msg = mensagens[i];

      // Aplicar delay entre mensagens (exceto na primeira)
      if (i > 0) {
        console.log(`[WhatsApp] Aguardando ${EVOLUTION_CONFIG.messageDelay}ms antes da próxima mensagem...`);
        await delay(EVOLUTION_CONFIG.messageDelay);
      }

      console.log(`[WhatsApp] Enviando mensagem ${i + 1}/${mensagens.length} para ${msg.clienteNome} (${msg.telefone})`);

      const resultado = await enviarMensagemEvolution(msg.telefone, msg.mensagem);

      resultados.push({
        telefone: msg.telefone,
        clienteNome: msg.clienteNome,
        transactionId: msg.transactionId,
        success: resultado.success,
        error: resultado.error,
      });
    }

    const sucessos = resultados.filter(r => r.success).length;
    const erros = resultados.filter(r => !r.success).length;

    console.log(`[WhatsApp] Envio concluído: ${sucessos} sucesso(s), ${erros} erro(s)`);

    return NextResponse.json({
      success: true,
      total: mensagens.length,
      enviados: sucessos,
      erros: erros,
      resultados,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[WhatsApp] Erro:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
