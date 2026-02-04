import { NextRequest, NextResponse } from 'next/server';

// Configuração Evolution API
const EVOLUTION_CONFIG = {
  baseUrl: process.env.EVOLUTION_API_URL || '',
  apiKey: process.env.EVOLUTION_API_KEY || '',
  instanceName: process.env.EVOLUTION_INSTANCE_NAME || '',
};

interface SendRequest {
  telefone: string; // Número com ou sem formatação
  mensagem: string;
}

// Formata e valida número de telefone brasileiro
function formatarTelefone(telefone: string): string | null {
  if (!telefone) return null;

  // Remove tudo que não é número
  let numero = telefone.replace(/\D/g, '');

  if (!numero) return null;

  // Se começa com 0, remove
  if (numero.startsWith('0')) {
    numero = numero.substring(1);
  }

  // Se não tem o 55 no início, adiciona
  if (!numero.startsWith('55')) {
    numero = '55' + numero;
  }

  // Valida se tem 12-13 dígitos (55 + DDD + 8-9 dígitos)
  if (numero.length >= 12 && numero.length <= 13) {
    return numero;
  }

  console.log(`[WhatsApp] Telefone inválido: ${telefone} -> ${numero} (${numero.length} dígitos)`);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Validar configuração
    if (!EVOLUTION_CONFIG.baseUrl || !EVOLUTION_CONFIG.apiKey || !EVOLUTION_CONFIG.instanceName) {
      return NextResponse.json(
        { error: 'Evolution API não configurada' },
        { status: 500 }
      );
    }

    const body: SendRequest = await request.json();
    const { telefone, mensagem } = body;

    if (!telefone || !mensagem) {
      return NextResponse.json(
        { error: 'Telefone e mensagem são obrigatórios' },
        { status: 400 }
      );
    }

    // Formatar telefone
    const telefoneFormatado = formatarTelefone(telefone);
    if (!telefoneFormatado) {
      return NextResponse.json(
        { error: 'Telefone inválido' },
        { status: 400 }
      );
    }

    // Enviar via Evolution API
    const baseUrl = EVOLUTION_CONFIG.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/message/sendText/${EVOLUTION_CONFIG.instanceName}`;

    console.log(`[WhatsApp] Enviando mensagem para ${telefoneFormatado}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_CONFIG.apiKey,
      },
      body: JSON.stringify({
        number: telefoneFormatado,
        text: mensagem,
        linkPreview: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WhatsApp] Erro ao enviar:`, errorText);
      return NextResponse.json(
        { error: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log(`[WhatsApp] Mensagem enviada com sucesso para ${telefoneFormatado}`);

    return NextResponse.json({
      success: true,
      telefone: telefoneFormatado,
      result,
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
