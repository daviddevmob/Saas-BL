import { NextRequest, NextResponse } from 'next/server';

const SWIPEONE_CONFIG = {
  apiKey: process.env.SWIPE_ONE_API || '',
  baseUrl: 'https://api.swipeone.com',
};

interface ContatoData {
  email: string;
  nome?: string;
  telefone?: string;
  produto?: string;
  valor?: number;
  transactionId?: string;
}

interface EnviarContatosRequest {
  contatos: ContatoData[];
  tags?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: EnviarContatosRequest = await request.json();
    const { contatos, tags = 'carrinho-abandonado,hotmart' } = body;

    if (!SWIPEONE_CONFIG.apiKey) {
      return NextResponse.json(
        { error: 'API Key do SwipeOne não configurada' },
        { status: 500 }
      );
    }

    if (!contatos || contatos.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum contato fornecido' },
        { status: 400 }
      );
    }

    const resultados: Array<{
      email: string;
      success: boolean;
      error?: string;
    }> = [];

    // Enviar cada contato para o SwipeOne
    for (const contato of contatos) {
      try {
        // Validar email
        if (!contato.email || !contato.email.includes('@')) {
          resultados.push({
            email: contato.email || 'sem email',
            success: false,
            error: 'Email inválido',
          });
          continue;
        }

        const payload = {
          email: contato.email,
          name: contato.nome || '',
          phone: contato.telefone || '',
          tags: tags,
          // Campos customizados podem ser adicionados aqui se o SwipeOne suportar
          custom_fields: {
            produto_abandonado: contato.produto || '',
            valor_carrinho: contato.valor?.toString() || '',
            hotmart_transaction: contato.transactionId || '',
          },
        };

        console.log('Enviando contato para SwipeOne:', payload.email);

        const response = await fetch(`${SWIPEONE_CONFIG.baseUrl}/zapier/contact`, {
          method: 'POST',
          headers: {
            'x-api-key': SWIPEONE_CONFIG.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          resultados.push({
            email: contato.email,
            success: true,
          });
        } else {
          const errorText = await response.text();
          resultados.push({
            email: contato.email,
            success: false,
            error: `HTTP ${response.status}: ${errorText}`,
          });
        }

        // Delay entre requisições para evitar rate limiting
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        resultados.push({
          email: contato.email,
          success: false,
          error: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }

    const sucessos = resultados.filter(r => r.success).length;
    const falhas = resultados.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `${sucessos} contato(s) enviado(s) com sucesso, ${falhas} falha(s)`,
      total: contatos.length,
      sucessos,
      falhas,
      resultados,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro API SwipeOne:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
