import { NextRequest, NextResponse } from 'next/server';

// Configuração Google Sheets
const GOOGLE_CONFIG = {
  spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '',
  sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || 'Etiquetas',
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

interface EtiquetaData {
  codigo: string;
  transactionId: string;
  dataPedido?: string;
  dataGeracao: string;
  produto: string;
  clienteNome: string;
  clienteDocumento?: string;
  clienteTelefone: string;
  clienteEmail: string;
  clienteLogradouro?: string;
  clienteNumero?: string;
  clienteComplemento?: string;
  clienteBairro?: string;
  clienteCidade: string;
  clienteUf: string;
  clienteCep: string;
  envioNumero?: number;
  enviosTotal?: number;
  isEnvioParcial?: boolean;
  observacaoEnvio?: string;
  isMerged?: boolean;
  mergedTransactionIds?: string[];
  produtos?: string[];
  isTest?: boolean;
}

interface GoogleSheetsRequest {
  etiquetas: EtiquetaData[];
}

// Gera JWT para autenticação com Google APIs
async function generateJWT(): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: GOOGLE_CONFIG.serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Importar chave privada e assinar
  const crypto = await import('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(GOOGLE_CONFIG.privateKey, 'base64url');

  return `${signatureInput}.${signature}`;
}

// Obtém access token do Google
async function getAccessToken(): Promise<string> {
  const jwt = await generateJWT();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro ao obter access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Adiciona linhas na planilha
async function appendToSheet(accessToken: string, values: string[][]): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_CONFIG.spreadsheetId}/values/${GOOGLE_CONFIG.sheetName}!A:U:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: values,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro ao adicionar na planilha: ${error}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Validar configuração
    if (!GOOGLE_CONFIG.spreadsheetId || !GOOGLE_CONFIG.serviceAccountEmail || !GOOGLE_CONFIG.privateKey) {
      console.log('[Google Sheets] API não configurada, ignorando...');
      return NextResponse.json({
        success: false,
        message: 'Google Sheets API não configurada',
      });
    }

    const body: GoogleSheetsRequest = await request.json();
    const { etiquetas } = body;

    if (!etiquetas || etiquetas.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Nenhuma etiqueta para cadastrar',
      });
    }

    console.log(`[Google Sheets] Cadastrando ${etiquetas.length} etiqueta(s)...`);

    // Obter access token
    const accessToken = await getAccessToken();

    // Preparar linhas para a planilha
    // Colunas: Código | Transaction | Data Pedido | Data Geração | Produto | Cliente | Documento | Telefone | Email | Endereço | Bairro | Cidade | UF | CEP | Envio | Observação | Parcial | Mesclado | Pedidos Mesclados | Link Rastreio | Modo
    const rows = etiquetas.map(e => {
      // Montar endereço completo
      const enderecoParts = [e.clienteLogradouro, e.clienteNumero, e.clienteComplemento].filter(Boolean);
      const enderecoCompleto = enderecoParts.join(', ');

      // Montar lista de produtos (se mesclado)
      const produtosLista = e.produtos && e.produtos.length > 0 ? e.produtos.join(' | ') : e.produto;

      return [
        e.codigo,
        e.transactionId,
        e.dataPedido || '',
        e.dataGeracao,
        produtosLista,
        e.clienteNome,
        e.clienteDocumento || '',
        e.clienteTelefone,
        e.clienteEmail,
        enderecoCompleto,
        e.clienteBairro || '',
        e.clienteCidade,
        e.clienteUf,
        e.clienteCep,
        e.enviosTotal && e.enviosTotal > 1 ? `${e.envioNumero}/${e.enviosTotal}` : '',
        e.observacaoEnvio || '',
        e.isEnvioParcial ? 'Sim' : '',
        e.isMerged ? 'Sim' : '',
        e.mergedTransactionIds?.join(', ') || '',
        `https://rastreamento.correios.com.br/?objeto=${e.codigo}`,
        e.isTest ? 'Teste' : 'Produção',
      ];
    });

    // Adicionar na planilha
    await appendToSheet(accessToken, rows);

    console.log(`[Google Sheets] ${etiquetas.length} etiqueta(s) cadastrada(s) com sucesso`);

    return NextResponse.json({
      success: true,
      message: `${etiquetas.length} etiqueta(s) cadastrada(s) na planilha`,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[Google Sheets] Erro:', errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
