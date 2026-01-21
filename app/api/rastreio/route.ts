import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const codigo = searchParams.get('codigo');

  if (!codigo) {
    return NextResponse.json({ error: 'Código obrigatório' }, { status: 400 });
  }

  try {
    const usuario = process.env.VIPP_USUARIO || '';
    const token = process.env.VIPP_SENHA || '';
    const idPerfil = process.env.VIPP_ID_PERFIL || '';

    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:vis="http://www.visualset.inf.br/">
   <soapenv:Header/>
   <soapenv:Body>
      <vis:ListarRastreioObjeto>
         <vis:ListarRastreio>
            <vis:PerfilVipp>
               <vis:Usuario>${usuario}</vis:Usuario>
               <vis:Token>${token}</vis:Token>
               <vis:IdPerfil>${idPerfil}</vis:IdPerfil>
            </vis:PerfilVipp>
            <vis:NrEtiquetaPostagem>${codigo}</vis:NrEtiquetaPostagem>
         </vis:ListarRastreio>
      </vis:ListarRastreioObjeto>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await fetch('http://vpsrv.visualset.com.br/PostagemVipp.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://www.visualset.inf.br/ListarRastreioObjeto'
      },
      body: xmlBody
    });

    const xmlResponse = await response.text();
    const eventos = [];
    
    const regexDescricao = /<(?:\w+:)?DescricaoStatusEvento>(.*?)<\/(?:\w+:)?DescricaoStatusEvento>/;
    const regexDataFull = /<(?:\w+:)?DtEventoCompleta>(.*?)<\/(?:\w+:)?DtEventoCompleta>/;
    const regexCidade = /<(?:\w+:)?CidadeEvento>(.*?)<\/(?:\w+:)?CidadeEvento>/;
    const regexUF = /<(?:\w+:)?UFEvento>(.*?)<\/(?:\w+:)?UFEvento>/;

    const partes = xmlResponse.split(/<(?:\w+:)?EventoRastreio>/);
    
    for (const parte of partes) {
        const descricaoMatch = regexDescricao.exec(parte);
        const dataMatch = regexDataFull.exec(parte);
        const cidadeMatch = regexCidade.exec(parte);
        const ufMatch = regexUF.exec(parte);

        if (descricaoMatch && dataMatch) {
            const fullDate = dataMatch[1];
            let dataFormatada = fullDate;
            let horaFormatada = '';

            try {
                if (fullDate.includes('T')) {
                    const [d, t] = fullDate.split('T');
                    const [y, m, day] = d.split('-');
                    dataFormatada = `${day}/${m}/${y}`;
                    horaFormatada = t.substring(0, 5);
                }
            } catch (e) {}

            eventos.push({
                data: dataFormatada,
                hora: horaFormatada,
                status: descricaoMatch[1],
                local: `${cidadeMatch ? cidadeMatch[1] : ''} / ${ufMatch ? ufMatch[1] : ''}`,
                subStatus: []
            });
        }
    }

    const eventosUnicos = eventos.filter((v, i, a) => a.findIndex(t => (t.data === v.data && t.hora === v.hora && t.status === v.status)) === i);

    eventosUnicos.sort((a, b) => {
        const dateA = parseBrDate(a.data, a.hora);
        const dateB = parseBrDate(b.data, b.hora);
        return dateB - dateA;
    });

    const statusFinal = eventosUnicos.length > 0 ? eventosUnicos[0].status : 'Objeto não encontrado';

    return NextResponse.json({ 
        codigo, 
        status: statusFinal,
        eventos: eventosUnicos, 
        ultimoEvento: eventosUnicos[0] || null,
        // Envia o XML bruto apenas para debug se necessário (o front filtrará por localhost)
        debug_xml: xmlResponse 
    });

  } catch (error) {
    console.error('Erro no rastreio ViPP:', error);
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}

function parseBrDate(dateStr: string, timeStr: string) {
    if (!dateStr || !dateStr.includes('/')) return 0;
    try {
        const [d, m, y] = dateStr.split('/');
        const [h, min] = timeStr ? timeStr.split(':') : ['00', '00'];
        return new Date(parseInt(y), parseInt(m)-1, parseInt(d), parseInt(h), parseInt(min)).getTime();
    } catch (e) {
        return 0;
    }
}
