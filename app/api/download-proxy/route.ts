import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, filename } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL é obrigatória' }, { status: 400 });
    }

    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json({ error: 'Falha ao baixar arquivo remoto' }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'application/pdf';
    const buffer = await response.arrayBuffer();

    // Sanitizar o nome do arquivo para garantir que seja válido
    const safeFilename = (filename || 'download.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error('Erro no proxy de download:', error);
    return NextResponse.json({ error: 'Erro interno no proxy' }, { status: 500 });
  }
}
