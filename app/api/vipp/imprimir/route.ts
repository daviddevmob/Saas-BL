import { NextRequest, NextResponse } from 'next/server';

const VIPP_PRINT_CONFIG = {
  url: `${process.env.VIPP_URL || 'https://vipp.visualset.com.br/vipp/remoto'}/ImpressaoRemota.php`,
  usuario: process.env.VIPP_USUARIO || '',
  senha: process.env.VIPP_SENHA || '',
};

interface ImprimirRequest {
  etiquetas: string[]; // Array de códigos de etiqueta (ex: ['SQ000288321BR', 'SQ000288335BR'])
  formato?: 'pdf' | 'zpl'; // Formato de saída (default: pdf)
}

export async function POST(request: NextRequest) {
  try {
    const body: ImprimirRequest = await request.json();
    const { etiquetas, formato = 'pdf' } = body;

    if (!etiquetas || etiquetas.length === 0) {
      return NextResponse.json(
        { error: 'Array de etiquetas é obrigatório' },
        { status: 400 }
      );
    }

    // Montar parâmetros para ViPP
    // Saida: 20 = Etiqueta Correios 10x15 (PDF), 21 = Etiqueta Vipp 10x15 (PDF)
    // Filtro: 1 = Registro ECT (código da etiqueta dos Correios), 2 = Etiqueta ViPP
    const params = new URLSearchParams({
      Usr: VIPP_PRINT_CONFIG.usuario,
      Pwd: VIPP_PRINT_CONFIG.senha,
      Filtro: '1', // Filtrar por Registro ECT (código da etiqueta)
      Saida: formato === 'zpl' ? '10' : '20', // 20 = Etiqueta Correios 10x15 (PDF)
      Lista: etiquetas.join(','),
    });

    const printUrl = `${VIPP_PRINT_CONFIG.url}?${params.toString()}`;

    // Chamar ViPP API de impressão
    const response = await fetch(printUrl, {
      method: 'GET',
    });

    // Verificar códigos de erro específicos da ViPP
    const statusCode = response.status;
    if (statusCode === 215) {
      return NextResponse.json(
        { error: 'Etiquetas não encontradas no sistema ViPP. Aguarde alguns minutos e tente novamente.', etiquetas },
        { status: 404 }
      );
    }
    if (statusCode === 210) {
      return NextResponse.json(
        { error: 'Usuário ou senha inválidos' },
        { status: 401 }
      );
    }
    if (!response.ok && statusCode !== 200) {
      return NextResponse.json(
        { error: `Erro ao gerar PDF: ${statusCode}` },
        { status: statusCode }
      );
    }

    const contentType = response.headers.get('content-type');

    // Se retornou PDF, fazer proxy do arquivo
    if (contentType?.includes('application/pdf')) {
      const pdfBuffer = await response.arrayBuffer();

      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="etiquetas-${Date.now()}.pdf"`,
        },
      });
    }

    // Se não é PDF, provavelmente é erro em texto/html
    const responseText = await response.text();

    // Verificar se é erro
    if (responseText.includes('erro') || responseText.includes('Erro') || responseText.includes('ERROR')) {
      return NextResponse.json(
        { error: 'Erro da ViPP', message: responseText },
        { status: 400 }
      );
    }

    // Retornar a URL direta para download (fallback)
    return NextResponse.json({
      success: true,
      downloadUrl: printUrl,
      etiquetas,
      message: 'Use a URL para baixar o PDF diretamente',
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// GET para gerar link de download direto
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const etiquetas = searchParams.get('etiquetas');

  if (!etiquetas) {
    return NextResponse.json(
      { error: 'Parâmetro etiquetas é obrigatório (separados por vírgula)' },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    Usr: VIPP_PRINT_CONFIG.usuario,
    Pwd: VIPP_PRINT_CONFIG.senha,
    Filtro: '1', // Registro ECT
    Saida: '20', // Etiqueta Correios 10x15 (PDF)
    Lista: etiquetas,
  });

  const printUrl = `${VIPP_PRINT_CONFIG.url}?${params.toString()}`;

  // Redirecionar para URL de download
  return NextResponse.redirect(printUrl);
}
