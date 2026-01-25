import { NextRequest, NextResponse } from 'next/server';

// Tipos da API dos Correios
interface CorreiosEvento {
  codigo: string;
  tipo: string;
  dtHrCriado: string;
  descricao: string;
  detalhe?: string;
  unidade?: {
    codSro?: string;
    tipo?: string;
    endereco?: {
      cep?: string;
      logradouro?: string;
      complemento?: string;
      numero?: string;
      bairro?: string;
      cidade?: string;
      uf?: string;
    };
  };
  unidadeDestino?: {
    tipo?: string;
    endereco?: {
      cidade?: string;
      uf?: string;
    };
  };
}

interface CorreiosObjeto {
  codObjeto: string;
  tipoPostal?: {
    sigla: string;
    descricao: string;
    categoria?: string;
  };
  dtPrevista?: string;
  contrato?: string;
  peso?: number;
  formato?: string;
  modalidade?: string;
  eventos?: CorreiosEvento[];
  mensagem?: string;
}

interface CorreiosResponse {
  versao: string;
  quantidade: number;
  objetos: CorreiosObjeto[];
  tipoResultado?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const codigo = searchParams.get('codigo');

  if (!codigo) {
    return NextResponse.json({ error: 'Código obrigatório' }, { status: 400 });
  }

  try {
    const apiKey = process.env.CORREIOS_API_KEY;
    const apiUrl = process.env.CORREIOS_API_URL || 'https://api.correios.com.br';

    if (!apiKey) {
      console.error('CORREIOS_API_KEY não configurada');
      return NextResponse.json({ error: 'API Key dos Correios não configurada' }, { status: 500 });
    }

    // Chamada à API de Rastreamento dos Correios
    const response = await fetch(
      `${apiUrl}/srorastro/v1/objetos/${codigo}?resultado=T`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erro na API dos Correios:', response.status, errorText);
      return NextResponse.json({
        error: `Erro ao consultar Correios: ${response.status}`,
        detalhes: errorText
      }, { status: response.status });
    }

    const data: CorreiosResponse = await response.json();

    // Verifica se encontrou o objeto
    if (!data.objetos || data.objetos.length === 0) {
      return NextResponse.json({
        codigo,
        status: 'Objeto não encontrado',
        eventos: [],
        ultimoEvento: null,
      });
    }

    const objeto = data.objetos[0];

    // Verifica se há mensagem de erro (objeto não encontrado ou sem eventos)
    if (objeto.mensagem) {
      return NextResponse.json({
        codigo,
        status: objeto.mensagem,
        eventos: [],
        ultimoEvento: null,
      });
    }

    // Converte eventos para o formato esperado pelo frontend
    const eventos = (objeto.eventos || []).map((evento) => {
      // Extrai data e hora do formato ISO
      const dtHr = evento.dtHrCriado;
      let dataFormatada = '';
      let horaFormatada = '';

      if (dtHr && dtHr.includes('T')) {
        const [datePart, timePart] = dtHr.split('T');
        const [year, month, day] = datePart.split('-');
        dataFormatada = `${day}/${month}/${year}`;
        horaFormatada = timePart.substring(0, 5);
      }

      // Monta a localização
      let local = '';
      if (evento.unidade?.endereco) {
        const { cidade, uf } = evento.unidade.endereco;
        local = `${cidade || ''} / ${uf || ''}`.trim();
      }

      // Monta subStatus com detalhes e destino
      const subStatus: string[] = [];
      if (evento.detalhe) {
        subStatus.push(evento.detalhe);
      }
      if (evento.unidadeDestino?.endereco) {
        const { cidade, uf } = evento.unidadeDestino.endereco;
        if (cidade || uf) {
          subStatus.push(`Destino: ${cidade || ''} / ${uf || ''}`);
        }
      }

      return {
        data: dataFormatada,
        hora: horaFormatada,
        status: evento.descricao,
        local,
        subStatus,
        codigo: evento.codigo,
        tipo: evento.tipo,
      };
    });

    // Ordena por data mais recente (já vem ordenado da API, mas garantimos)
    eventos.sort((a, b) => {
      const dateA = parseBrDate(a.data, a.hora);
      const dateB = parseBrDate(b.data, b.hora);
      return dateB - dateA;
    });

    const statusFinal = eventos.length > 0 ? eventos[0].status : 'Objeto não encontrado';

    return NextResponse.json({
      codigo,
      status: statusFinal,
      eventos,
      ultimoEvento: eventos[0] || null,
      // Informações adicionais do objeto
      tipoPostal: objeto.tipoPostal,
      dtPrevista: objeto.dtPrevista,
      peso: objeto.peso,
      formato: objeto.formato,
    });

  } catch (error) {
    console.error('Erro no rastreio Correios:', error);
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}

// POST para consulta em lote (múltiplos códigos)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { codigos } = body;

    if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
      return NextResponse.json({ error: 'Array de códigos obrigatório' }, { status: 400 });
    }

    // Limite de 50 códigos por consulta (limite da API dos Correios)
    if (codigos.length > 50) {
      return NextResponse.json({ error: 'Máximo de 50 códigos por consulta' }, { status: 400 });
    }

    const apiKey = process.env.CORREIOS_API_KEY;
    const apiUrl = process.env.CORREIOS_API_URL || 'https://api.correios.com.br';

    if (!apiKey) {
      return NextResponse.json({ error: 'API Key dos Correios não configurada' }, { status: 500 });
    }

    const codigosParam = codigos.join(',');
    const response = await fetch(
      `${apiUrl}/srorastro/v1/objetos?codigosObjetos=${codigosParam}&resultado=T`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erro na API dos Correios (lote):', response.status, errorText);
      return NextResponse.json({
        error: `Erro ao consultar Correios: ${response.status}`,
        detalhes: errorText
      }, { status: response.status });
    }

    const data: CorreiosResponse = await response.json();

    // Processa cada objeto retornado
    const resultados = (data.objetos || []).map((objeto) => {
      if (objeto.mensagem) {
        return {
          codigo: objeto.codObjeto,
          status: objeto.mensagem,
          eventos: [],
          ultimoEvento: null,
        };
      }

      const eventos = (objeto.eventos || []).map((evento) => {
        const dtHr = evento.dtHrCriado;
        let dataFormatada = '';
        let horaFormatada = '';

        if (dtHr && dtHr.includes('T')) {
          const [datePart, timePart] = dtHr.split('T');
          const [year, month, day] = datePart.split('-');
          dataFormatada = `${day}/${month}/${year}`;
          horaFormatada = timePart.substring(0, 5);
        }

        let local = '';
        if (evento.unidade?.endereco) {
          const { cidade, uf } = evento.unidade.endereco;
          local = `${cidade || ''} / ${uf || ''}`.trim();
        }

        const subStatus: string[] = [];
        if (evento.detalhe) {
          subStatus.push(evento.detalhe);
        }
        if (evento.unidadeDestino?.endereco) {
          const { cidade, uf } = evento.unidadeDestino.endereco;
          if (cidade || uf) {
            subStatus.push(`Destino: ${cidade || ''} / ${uf || ''}`);
          }
        }

        return {
          data: dataFormatada,
          hora: horaFormatada,
          status: evento.descricao,
          local,
          subStatus,
          codigo: evento.codigo,
          tipo: evento.tipo,
        };
      });

      eventos.sort((a, b) => {
        const dateA = parseBrDate(a.data, a.hora);
        const dateB = parseBrDate(b.data, b.hora);
        return dateB - dateA;
      });

      const statusFinal = eventos.length > 0 ? eventos[0].status : 'Objeto não encontrado';

      return {
        codigo: objeto.codObjeto,
        status: statusFinal,
        eventos,
        ultimoEvento: eventos[0] || null,
        tipoPostal: objeto.tipoPostal,
        dtPrevista: objeto.dtPrevista,
        peso: objeto.peso,
        formato: objeto.formato,
      };
    });

    return NextResponse.json({
      quantidade: data.quantidade,
      resultados,
    });

  } catch (error) {
    console.error('Erro no rastreio em lote:', error);
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}

function parseBrDate(dateStr: string, timeStr: string): number {
  if (!dateStr || !dateStr.includes('/')) return 0;
  try {
    const [d, m, y] = dateStr.split('/');
    const [h, min] = timeStr ? timeStr.split(':') : ['00', '00'];
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min)).getTime();
  } catch {
    return 0;
  }
}
