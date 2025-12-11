import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, limit as firestoreLimit, getDocs } from 'firebase/firestore';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status'); // pendente, recuperado, enviado_swipeone
    const plataforma = searchParams.get('plataforma'); // hotmart, hubla
    const limitParam = parseInt(searchParams.get('limit') || '100');

    const carrinhosRef = collection(db, 'carrinhos_abandonados');

    // Construir query com filtros
    let constraints: any[] = [];

    if (status) {
      constraints.push(where('status', '==', status));
    }

    if (plataforma) {
      constraints.push(where('plataforma', '==', plataforma));
    }

    constraints.push(orderBy('data_abandono', 'desc'));
    constraints.push(firestoreLimit(limitParam));

    const q = query(carrinhosRef, ...constraints);
    const snapshot = await getDocs(q);

    const carrinhos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({
      success: true,
      total: carrinhos.length,
      carrinhos
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro ao listar carrinhos:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
