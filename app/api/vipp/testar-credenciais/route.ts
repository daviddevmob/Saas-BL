import { NextRequest, NextResponse } from 'next/server';

const VIPP_CONFIG = {
  url: process.env.VIPP_API_URL || 'http://vpsrv.visualset.com.br/api/v1/middleware/PostarObjeto',
  usuario: process.env.VIPP_USUARIO || '',
  token: process.env.VIPP_SENHA || '',
  idPerfil: process.env.VIPP_ID_PERFIL || '',
  servicoEct: process.env.VIPP_SERVICO_ECT || '',
  nrContrato: process.env.VIPP_NR_CONTRATO || '',
  codAdministrativo: process.env.VIPP_COD_ADMINISTRATIVO || '',
  nrCartao: process.env.VIPP_NR_CARTAO || '',
};

export async function GET(request: NextRequest) {
  // Mostrar configuração atual (sem mostrar senha completa)
  const config = {
    url: VIPP_CONFIG.url,
    usuario: VIPP_CONFIG.usuario,
    senha: VIPP_CONFIG.token ? `${VIPP_CONFIG.token.substring(0, 3)}***` : '(vazio)',
    idPerfil: VIPP_CONFIG.idPerfil,
    servicoEct: VIPP_CONFIG.servicoEct || '(vazio - usa perfil)',
    nrContrato: VIPP_CONFIG.nrContrato || '(vazio)',
    codAdministrativo: VIPP_CONFIG.codAdministrativo || '(vazio)',
    nrCartao: VIPP_CONFIG.nrCartao || '(vazio)',
  };

  return NextResponse.json({
    message: 'Configuração ViPP atual',
    config,
    instrucoes: 'Use POST para testar as credenciais com uma postagem de teste',
  });
}

export async function POST(request: NextRequest) {
  try {
    // Payload de teste com dados fictícios
    const vippPayload = {
      PerfilVipp: {
        Usuario: VIPP_CONFIG.usuario,
        Token: VIPP_CONFIG.token,
        IdPerfil: VIPP_CONFIG.idPerfil,
      },
      ContratoEct: {
        NrContrato: VIPP_CONFIG.nrContrato,
        CodigoAdministrativo: VIPP_CONFIG.codAdministrativo,
        NrCartao: VIPP_CONFIG.nrCartao,
      },
      Destinatario: {
        CnpjCpf: '12345678900',
        IeRg: '',
        Nome: 'TESTE CREDENCIAIS',
        SegundaLinhaDestinatario: '',
        Endereco: 'RUA TESTE',
        Numero: '123',
        Complemento: '',
        Bairro: 'CENTRO',
        Cidade: 'FORTALEZA',
        UF: 'CE',
        Cep: '60000000',
        Telefone: '85999999999',
        Celular: '',
        Email: 'teste@teste.com',
      },
      Servico: {
        ServicoECT: VIPP_CONFIG.servicoEct,
      },
      NotasFiscais: [
        {
          DtNotaFiscal: '',
          SerieNotaFiscal: '',
          NrNotaFiscal: '',
          VlrTotalNota: '',
        },
      ],
      Volumes: [
        {
          Peso: '500',
          Altura: '5',
          Largura: '15',
          Comprimento: '20',
          ContaLote: '',
          ChaveRoteamento: '',
          CodigoBarraVolume: '',
          CodigoBarraCliente: 'TESTE-' + Date.now(),
          ObservacaoVisual: '',
          ObservacaoQuatro: '',
          ObservacaoCinco: '',
          PosicaoVolume: '1',
          Conteudo: 'Livro Teste',
          ValorDeclarado: '',
          AdicionaisVolume: '',
          VlrACobrar: '',
          Etiqueta: '',
        },
      ],
    };

    console.log('=== TESTE CREDENCIAIS VIPP ===');
    console.log('Payload:', JSON.stringify(vippPayload, null, 2));

    const response = await fetch(VIPP_CONFIG.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'UTF-8',
      },
      body: JSON.stringify(vippPayload),
    });

    const responseText = await response.text();
    console.log('Resposta:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json({
        success: false,
        error: 'Resposta inválida da ViPP',
        raw: responseText,
      }, { status: 500 });
    }

    // Verificar erros
    if (data.ListaErros && data.ListaErros.length > 0) {
      const erros = data.ListaErros.map((e: { Descricao: string }) => e.Descricao);
      return NextResponse.json({
        success: false,
        error: 'Erros da ViPP',
        erros,
        data,
        config: {
          usuario: VIPP_CONFIG.usuario,
          idPerfil: VIPP_CONFIG.idPerfil,
          servicoEct: VIPP_CONFIG.servicoEct || '(vazio)',
        },
      }, { status: 400 });
    }

    // Sucesso - etiqueta gerada (isso é um teste real, vai consumir uma etiqueta!)
    if (data.Volumes && data.Volumes[0] && data.Volumes[0].Etiqueta) {
      return NextResponse.json({
        success: true,
        message: 'CREDENCIAIS OK! Etiqueta de teste gerada.',
        etiqueta: data.Volumes[0].Etiqueta,
        aviso: 'ATENÇÃO: Uma etiqueta real foi gerada neste teste!',
        data,
      });
    }

    return NextResponse.json({
      success: false,
      message: 'Resposta inesperada da ViPP',
      data,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
