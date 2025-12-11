import { NextRequest, NextResponse } from 'next/server';

const HOTMART_CONFIG = {
  clientId: process.env.HOTMART_API_CLIENT_ID || '',
  clientSecret: process.env.HOTMART_API_CLIENT_SECRET || '',
  basicAuth: process.env.HOTMART_API_CLIENT_BASIC || '',
};

// Cache do token de acesso
let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  // Cache do token
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  // Obter novo token usando Basic Auth + client_credentials na query string

  const tokenUrl = `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${HOTMART_CONFIG.clientId}&client_secret=${HOTMART_CONFIG.clientSecret}`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': HOTMART_CONFIG.basicAuth,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Erro ao obter token Hotmart:', error);
    throw new Error(`Falha ao autenticar com Hotmart: ${error}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  // Token expira em 5 minutos antes do tempo real para segurança
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return accessToken!;
}

interface HotmartSale {
  transaction: string;
  product: {
    id: number;
    name: string;
  };
  buyer: {
    name: string;
    email: string;
    phone?: string;
    document?: string;
  };
  purchase: {
    transaction: string;
    status: string;
    approved_date?: number;
    order_date: number;
    price: {
      value: number;
      currency_code: string;
    };
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dias = parseInt(searchParams.get('dias') || '7');
    const maxResults = parseInt(searchParams.get('max') || '100');
    const status = searchParams.get('status') || 'STARTED'; // Para debug: APPROVED, STARTED, etc

    if (!HOTMART_CONFIG.clientId || !HOTMART_CONFIG.basicAuth) {
      return NextResponse.json(
        { error: 'Credenciais da Hotmart não configuradas' },
        { status: 500 }
      );
    }

    // Calcular período
    const endDate = Date.now();
    const startDate = endDate - (dias * 24 * 60 * 60 * 1000);

    // Obter token de acesso
    const token = await getAccessToken();

    // Buscar vendas com status especificado (STARTED = carrinho abandonado)
    const params = new URLSearchParams({
      start_date: startDate.toString(),
      end_date: endDate.toString(),
      max_results: maxResults.toString(),
    });

    // Só adiciona filtro de status se especificado
    if (status && status !== 'ALL') {
      params.set('transaction_status', status);
    }

    const salesUrl = `https://developers.hotmart.com/payments/api/v1/sales/history?${params.toString()}`;

    const salesResponse = await fetch(salesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!salesResponse.ok) {
      const error = await salesResponse.text();
      console.error('Erro ao buscar vendas Hotmart:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar dados da Hotmart', details: error },
        { status: salesResponse.status }
      );
    }

    const salesData = await salesResponse.json();

    // Processar e formatar os dados
    const carrinhos = (salesData.items || []).map((sale: HotmartSale) => ({
      transactionId: sale.purchase?.transaction || sale.transaction,
      produto: sale.product?.name || 'Produto não identificado',
      produtoId: sale.product?.id,
      cliente: {
        nome: sale.buyer?.name || '',
        email: sale.buyer?.email || '',
        telefone: sale.buyer?.phone || '',
        documento: sale.buyer?.document || '',
      },
      valor: sale.purchase?.price?.value || 0,
      moeda: sale.purchase?.price?.currency_code || 'BRL',
      dataAbandono: sale.purchase?.order_date ? new Date(sale.purchase.order_date).toISOString() : null,
      status: sale.purchase?.status || 'STARTED',
    }));

    return NextResponse.json({
      success: true,
      periodo: {
        dias,
        inicio: new Date(startDate).toISOString(),
        fim: new Date(endDate).toISOString(),
      },
      total: carrinhos.length,
      carrinhos,
      nextPageToken: salesData.page_info?.next_page_token || null,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro API Carrinhos Abandonados:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
