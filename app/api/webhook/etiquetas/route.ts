import { NextRequest, NextResponse } from 'next/server';

// URL do webhook N8N - configure no .env
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const ADMIN_PHONE = process.env.N8N_WHATSAPP_ADMIN || '';
const CLIENTE_PHONE_OVERRIDE = process.env.N8N_WHATSAPP_CLIENTE || ''; // Se preenchido, substitui o número do cliente
const ENVIAR_WHATSAPP_CLIENTE = process.env.WHATSAPP_ENVIAR_CLIENTE === 'true'; // Se false, não envia WhatsApp para clientes

// Configuração ViPP para gerar URL do PDF
const VIPP_PRINT_CONFIG = {
  url: `${process.env.VIPP_URL || 'https://vipp.visualset.com.br/vipp/remoto'}/ImpressaoRemota.php`,
  usuario: process.env.VIPP_USUARIO || '',
  senha: process.env.VIPP_SENHA || '',
};

interface EtiquetaData {
  codigo: string;
  transactionId: string;
  produto: string;
  destinatario: {
    nome: string;
    telefone: string;
    email: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  // Campos para pedidos mesclados
  isMerged?: boolean;
  mergedTransactionIds?: string[];
  produtos?: string[];
}

interface WebhookRequest {
  etiquetas: EtiquetaData[]; // Etiquetas novas (cliente recebe WhatsApp)
  etiquetasAdmin?: EtiquetaData[]; // Todas etiquetas (admin recebe WhatsApp)
}

// Formata e valida número de telefone brasileiro
// Deve ter 13 dígitos: 55 + DDD (2) + número (9)
function formatarTelefone(telefone: string): string | null {
  if (!telefone) return null;

  // Remove tudo que não é número
  let numero = telefone.replace(/\D/g, '');

  // Se não tem nada, retorna null
  if (!numero) return null;

  // Se começa com 0, remove
  if (numero.startsWith('0')) {
    numero = numero.substring(1);
  }

  // Se não tem o 55 no início, adiciona
  if (!numero.startsWith('55')) {
    numero = '55' + numero;
  }

  // Valida se tem 13 dígitos (55 + DDD + 9 dígitos)
  // ou 12 dígitos (55 + DDD + 8 dígitos - números antigos)
  if (numero.length === 12 || numero.length === 13) {
    return numero;
  }

  // Se tem 11 dígitos (DDD + 9 dígitos), adiciona 55
  if (numero.length === 11) {
    return '55' + numero.substring(2); // Remove o 55 duplicado se houver
  }

  console.log(`Telefone inválido: ${telefone} -> ${numero} (${numero.length} dígitos)`);
  return null;
}

// Gera URL direta para download do PDF da ViPP (uma ou várias etiquetas)
function gerarUrlPdf(codigos: string | string[]): string {
  const lista = Array.isArray(codigos) ? codigos.join(',') : codigos;
  const params = new URLSearchParams({
    Usr: VIPP_PRINT_CONFIG.usuario,
    Pwd: VIPP_PRINT_CONFIG.senha,
    Filtro: '1',
    Saida: '20',
    Lista: lista,
  });
  return `${VIPP_PRINT_CONFIG.url}?${params.toString()}`;
}

export async function POST(request: NextRequest) {
  try {
    const body: WebhookRequest = await request.json();
    const { etiquetas, etiquetasAdmin } = body;

    console.log('\n========== WEBHOOK ETIQUETAS - RECEBIDO ==========');
    console.log('Body recebido:', JSON.stringify(body, null, 2));
    console.log('==================================================\n');

    // Usar etiquetasAdmin se fornecido, senão usar etiquetas (compatibilidade)
    const todasEtiquetas = etiquetasAdmin && etiquetasAdmin.length > 0 ? etiquetasAdmin : etiquetas;
    const etiquetasNovas = etiquetas || [];

    if ((!todasEtiquetas || todasEtiquetas.length === 0) && etiquetasNovas.length === 0) {
      return NextResponse.json(
        { error: 'Array de etiquetas é obrigatório' },
        { status: 400 }
      );
    }

    // Formatar número do admin
    const adminPhoneFormatted = formatarTelefone(ADMIN_PHONE);
    if (!adminPhoneFormatted) {
      console.error('N8N_WHATSAPP_ADMIN não configurado ou inválido:', ADMIN_PHONE);
      return NextResponse.json(
        { error: 'Número do admin não configurado' },
        { status: 500 }
      );
    }

    // Formatar número de override do cliente (se existir)
    const clientePhoneOverride = CLIENTE_PHONE_OVERRIDE ? formatarTelefone(CLIENTE_PHONE_OVERRIDE) : null;

    // Processar etiquetas NOVAS para envio ao cliente (WhatsApp)
    const etiquetasNovasProcessadas = etiquetasNovas.map(e => {
      let clienteTelefone: string | null = null;

      if (clientePhoneOverride) {
        clienteTelefone = clientePhoneOverride;
      } else {
        clienteTelefone = formatarTelefone(e.destinatario.telefone);
      }

      return {
        codigo: e.codigo,
        pdfUrl: gerarUrlPdf(e.codigo),
        transactionId: e.transactionId,
        produto: e.produto,
        clienteNome: e.destinatario.nome,
        clienteTelefone: clienteTelefone,
        clienteEmail: e.destinatario.email,
        clienteLogradouro: e.destinatario.logradouro,
        clienteNumero: e.destinatario.numero,
        clienteComplemento: e.destinatario.complemento,
        clienteBairro: e.destinatario.bairro,
        clienteCidade: e.destinatario.cidade,
        clienteUf: e.destinatario.uf,
        clienteCep: e.destinatario.cep,
      };
    });

    // Processar TODAS etiquetas para o admin
    const todasEtiquetasProcessadas = todasEtiquetas.map(e => ({
      codigo: e.codigo,
      pdfUrl: gerarUrlPdf(e.codigo),
      transactionId: e.transactionId,
      produto: e.produto,
      clienteNome: e.destinatario.nome,
      clienteEmail: e.destinatario.email,
      clienteLogradouro: e.destinatario.logradouro,
      clienteNumero: e.destinatario.numero,
      clienteComplemento: e.destinatario.complemento,
      clienteBairro: e.destinatario.bairro,
      clienteCidade: e.destinatario.cidade,
      clienteUf: e.destinatario.uf,
      clienteCep: e.destinatario.cep,
      isNova: etiquetasNovas.some(n => n.codigo === e.codigo),
      // Campos de merge
      isMerged: e.isMerged || false,
      mergedTransactionIds: e.mergedTransactionIds || [],
      produtos: e.produtos || [],
    }));

    // Filtrar etiquetas NOVAS que têm telefone válido (para envio ao cliente)
    const etiquetasNovasComTelefone = etiquetasNovasProcessadas.filter(e => e.clienteTelefone !== null);
    const etiquetasNovasSemTelefone = etiquetasNovasProcessadas.filter(e => e.clienteTelefone === null);

    if (etiquetasNovasSemTelefone.length > 0) {
      console.log(`${etiquetasNovasSemTelefone.length} etiqueta(s) NOVA(s) sem telefone válido:`,
        etiquetasNovasSemTelefone.map(e => `${e.clienteNome} (${e.codigo})`));
    }

    // Gerar URL consolidada do PDF para o admin (todas as etiquetas em um único PDF)
    const pdfUrlConsolidada = gerarUrlPdf(todasEtiquetas.map(e => e.codigo));

    // Gerar mensagem formatada para o admin
    const etiquetasAntigas = todasEtiquetasProcessadas.filter(e => !e.isNova);

    let mensagemAdmin = `📦 *Etiquetas Geradas*\n\n`;
    mensagemAdmin += `Total: ${todasEtiquetas.length} etiqueta(s)\n`;

    if (etiquetasNovas.length > 0) {
      mensagemAdmin += `\n✨ *${etiquetasNovas.length} NOVA(S):*\n`;
      todasEtiquetasProcessadas.filter(e => e.isNova).forEach(e => {
        mensagemAdmin += `\n🏷️ ${e.codigo}\n`;
        mensagemAdmin += `👤 ${e.clienteNome}\n`;
        mensagemAdmin += `📍 ${e.clienteCidade}/${e.clienteUf}\n`;
        mensagemAdmin += `📦 ${e.produto}\n`;
        // Adicionar info de merge se aplicável
        if (e.isMerged && e.mergedTransactionIds && e.mergedTransactionIds.length > 1) {
          mensagemAdmin += `🔗 *MESCLADO (${e.mergedTransactionIds.length} pedidos):*\n`;
          e.mergedTransactionIds.forEach((tid: string) => {
            mensagemAdmin += `   • ${tid}\n`;
          });
        }
      });
    }

    if (etiquetasAntigas.length > 0) {
      mensagemAdmin += `\n📋 *${etiquetasAntigas.length} JÁ GERADA(S):*\n`;
      etiquetasAntigas.forEach(e => {
        mensagemAdmin += `\n🏷️ ${e.codigo}\n`;
        mensagemAdmin += `👤 ${e.clienteNome}\n`;
        mensagemAdmin += `📍 ${e.clienteCidade}/${e.clienteUf}\n`;
        mensagemAdmin += `📦 ${e.produto}\n`;
        // Adicionar info de merge se aplicável
        if (e.isMerged && e.mergedTransactionIds && e.mergedTransactionIds.length > 1) {
          mensagemAdmin += `🔗 *MESCLADO (${e.mergedTransactionIds.length} pedidos):*\n`;
          e.mergedTransactionIds.forEach((tid: string) => {
            mensagemAdmin += `   • ${tid}\n`;
          });
        }
      });
    }

    // Preparar dados para o N8N
    // - etiquetas: NOVAS com telefone (cliente recebe WhatsApp individual) - só se WHATSAPP_ENVIAR_CLIENTE=true
    // - todasEtiquetas: TODAS (admin recebe resumo + PDF consolidado)

    // Se WHATSAPP_ENVIAR_CLIENTE=false, envia array vazio para não disparar WhatsApp aos clientes
    const etiquetasParaCliente = ENVIAR_WHATSAPP_CLIENTE ? etiquetasNovasComTelefone : [];

    if (!ENVIAR_WHATSAPP_CLIENTE && etiquetasNovasComTelefone.length > 0) {
      console.log(`⚠️ WHATSAPP_ENVIAR_CLIENTE=false - ${etiquetasNovasComTelefone.length} cliente(s) NÃO receberão WhatsApp`);
    }

    const webhookPayload = {
      timestamp: new Date().toISOString(),
      totalNovas: etiquetasNovas.length,
      totalAdmin: todasEtiquetas.length,
      adminPhone: adminPhoneFormatted,
      // URL do PDF consolidado (todas etiquetas em um único arquivo) - usar no admin
      pdfUrlConsolidada: pdfUrlConsolidada,
      // Mensagem formatada para o admin
      mensagemAdmin: mensagemAdmin,
      // Etiquetas NOVAS com telefone válido (cliente recebe WhatsApp) - vazio se WHATSAPP_ENVIAR_CLIENTE=false
      etiquetas: etiquetasParaCliente,
      // TODAS as etiquetas (admin recebe)
      todasEtiquetas: todasEtiquetasProcessadas,
      // Resumo para mensagem consolidada do admin
      resumo: {
        quantidadeNovas: etiquetasNovas.length,
        quantidadeTotal: todasEtiquetas.length,
        codigos: todasEtiquetas.map(e => e.codigo),
        codigosNovos: etiquetasNovas.map(e => e.codigo),
        semTelefone: etiquetasNovasSemTelefone.length,
        enviarClienteDesabilitado: !ENVIAR_WHATSAPP_CLIENTE,
      },
    };

    console.log('\n========== PAYLOAD PARA N8N ==========');
    console.log(JSON.stringify(webhookPayload, null, 2));
    console.log('======================================\n');

    // Enviar para N8N
    if (N8N_WEBHOOK_URL) {
      console.log('Enviando para N8N:', N8N_WEBHOOK_URL);
      try {
        const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });

        const n8nResult = await n8nResponse.text();
        console.log('Resposta N8N:', n8nResponse.status, n8nResult);

        if (!n8nResponse.ok) {
          console.error('N8N webhook error:', n8nResult);
        }
      } catch (webhookError) {
        console.error('Erro ao enviar webhook N8N:', webhookError);
      }
    } else {
      console.log('N8N_WEBHOOK_URL não configurado!');
    }

    return NextResponse.json({
      success: true,
      message: `Webhook disparado: ${etiquetasNovas.length} nova(s), ${todasEtiquetas.length} total para admin`,
      payload: webhookPayload,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Webhook Error:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
