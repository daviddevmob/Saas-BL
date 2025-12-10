import { NextRequest, NextResponse } from 'next/server';

const VIPP_CONFIG = {
  url: 'http://vpsrv.visualset.com.br/api/v1/middleware/PostarObjeto',
  // Credenciais de produção
  usuario: 'onbiws',
  token: '112233',
  idPerfil: '9363',
};

interface DestinatarioData {
  nome: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  documento: string;
}

interface PostarObjetoRequest {
  transactionId: string;
  destinatario: DestinatarioData;
}

export async function POST(request: NextRequest) {
  try {
    const body: PostarObjetoRequest = await request.json();
    const { transactionId, destinatario } = body;

    if (!transactionId || !destinatario) {
      return NextResponse.json(
        { error: 'transactionId e destinatario são obrigatórios' },
        { status: 400 }
      );
    }

    // Montar payload para ViPP conforme documentação REST/JSON
    const vippPayload = {
      PerfilVipp: {
        Usuario: VIPP_CONFIG.usuario,
        Token: VIPP_CONFIG.token,
        IdPerfil: VIPP_CONFIG.idPerfil,
      },
      ContratoEct: {
        NrContrato: '',
        CodigoAdministrativo: '',
        NrCartao: '',
      },
      Destinatario: {
        CnpjCpf: destinatario.documento?.replace(/\D/g, '') || '',
        IeRg: '',
        Nome: destinatario.nome,
        SegundaLinhaDestinatario: '',
        Endereco: destinatario.logradouro,
        Numero: destinatario.numero || 'S/N',
        Complemento: destinatario.complemento || '',
        Bairro: destinatario.bairro || '',
        Cidade: destinatario.cidade,
        UF: destinatario.uf,
        Cep: destinatario.cep?.replace(/\D/g, '') || '',
        Telefone: destinatario.telefone?.replace(/\D/g, '') || '',
        Celular: '',
        Email: destinatario.email || '',
      },
      Servico: {
        ServicoECT: '', // Deixar vazio para usar o perfil
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
          Peso: '500', // gramas
          Altura: '5',
          Largura: '15',
          Comprimento: '20',
          ContaLote: '',
          ChaveRoteamento: '',
          CodigoBarraVolume: '',
          CodigoBarraCliente: transactionId,
          ObservacaoVisual: '',
          ObservacaoQuatro: '',
          ObservacaoCinco: '',
          PosicaoVolume: '1',
          Conteudo: 'Livro',
          ValorDeclarado: '',
          AdicionaisVolume: '',
          VlrACobrar: '',
          Etiqueta: '',
        },
      ],
    };

    console.log('ViPP Request:', JSON.stringify(vippPayload, null, 2));

    // Chamar ViPP API
    const response = await fetch(VIPP_CONFIG.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'UTF-8',
      },
      body: JSON.stringify(vippPayload),
    });

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: 'Resposta inválida da ViPP', raw: responseText },
        { status: 500 }
      );
    }

    console.log('ViPP Response:', JSON.stringify(data, null, 2));

    // Verificar se houve erros
    if (data.ListaErros && data.ListaErros.length > 0) {
      const erros = data.ListaErros.map((e: { Descricao: string }) => e.Descricao).join(', ');
      return NextResponse.json(
        { error: erros, data },
        { status: 400 }
      );
    }

    // Verificar status da postagem
    if (data.StatusPostagem === 'Invalida') {
      return NextResponse.json(
        { error: 'Postagem inválida', data },
        { status: 400 }
      );
    }

    // Extrair código da etiqueta do Volumes[0].Etiqueta
    let etiqueta = null;

    if (data.Volumes && data.Volumes[0] && data.Volumes[0].Etiqueta) {
      etiqueta = data.Volumes[0].Etiqueta;
    }

    if (!etiqueta) {
      return NextResponse.json(
        { error: 'Etiqueta não retornada pela ViPP', data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      etiqueta,
      transactionId,
      data,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('ViPP Error:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
