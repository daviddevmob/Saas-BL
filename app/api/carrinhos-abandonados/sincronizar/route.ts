import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const HOTMART_CONFIG = {
  clientId: process.env.HOTMART_API_CLIENT_ID || '',
  clientSecret: process.env.HOTMART_API_CLIENT_SECRET || '',
  basicAuth: process.env.HOTMART_API_CLIENT_BASIC || '',
};

// Cache do token de acesso
let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const tokenUrl = `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${HOTMART_CONFIG.clientId}&client_secret=${HOTMART_CONFIG.clientSecret}`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': HOTMART_CONFIG.basicAuth,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Falha ao autenticar com Hotmart');
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return accessToken!;
}

async function verificarCompraHotmart(email: string, produtoId: number, dataAbandono: string): Promise<boolean> {
  try {
    const token = await getAccessToken();

    // Buscar desde a data do abandono até agora
    const startDate = new Date(dataAbandono).getTime();
    const endDate = Date.now();

    const params = new URLSearchParams({
      buyer_email: email,
      product_id: produtoId.toString(),
      start_date: startDate.toString(),
      end_date: endDate.toString(),
      max_results: '10',
    });

    const salesUrl = `https://developers.hotmart.com/payments/api/v1/sales/history?${params.toString()}`;

    const response = await fetch(salesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Erro ao verificar compra Hotmart:', await response.text());
      return false;
    }

    const data = await response.json();
    const items = data.items || [];

    // Verificar se tem compra APPROVED ou COMPLETE
    const compraRealizada = items.some((item: any) => {
      const status = item.purchase?.status;
      return status === 'APPROVED' || status === 'COMPLETE';
    });

    return compraRealizada;
  } catch (error) {
    console.error('Erro ao verificar compra:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Buscar apenas carrinhos pendentes da Hotmart
    const carrinhosRef = collection(db, 'carrinhos_abandonados');
    const q = query(
      carrinhosRef,
      where('status', '==', 'pendente'),
      where('plataforma', '==', 'hotmart')
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return NextResponse.json({
        success: true,
        message: 'Nenhum carrinho pendente para sincronizar',
        total: 0,
        atualizados: 0
      });
    }

    let atualizados = 0;
    const resultados: Array<{ id: string; email: string; recuperado: boolean }> = [];

    for (const docSnapshot of snapshot.docs) {
      const carrinho = docSnapshot.data();
      const carrinhoId = docSnapshot.id;

      // Verificar se comprou na Hotmart
      const comprou = await verificarCompraHotmart(
        carrinho.email,
        carrinho.produto_id,
        carrinho.data_abandono
      );

      if (comprou) {
        // Atualizar status para recuperado
        const carrinhoRef = doc(db, 'carrinhos_abandonados', carrinhoId);
        await updateDoc(carrinhoRef, {
          status: 'recuperado',
          status_atualizado_em: new Date().toISOString()
        });
        atualizados++;
      }

      resultados.push({
        id: carrinhoId,
        email: carrinho.email,
        recuperado: comprou
      });

      // Delay para não sobrecarregar a API da Hotmart
      await new Promise(r => setTimeout(r, 300));
    }

    return NextResponse.json({
      success: true,
      message: `${atualizados} carrinho(s) atualizado(s) como recuperado(s)`,
      total: snapshot.size,
      atualizados,
      resultados
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro ao sincronizar carrinhos:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
