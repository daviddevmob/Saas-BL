import { NextRequest, NextResponse } from 'next/server';

// URL do webhook N8N - configure no .env
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

// Configuração ViPP para gerar URL do PDF - PRODUÇÃO
const VIPP_PRINT_CONFIG_PROD = {
  url: `${process.env.VIPP_URL || 'https://vipp.visualset.com.br/vipp/remoto'}/ImpressaoRemota.php`,
  usuario: process.env.VIPP_USUARIO || '',
  senha: process.env.VIPP_SENHA || '',
};

// Configuração ViPP para gerar URL do PDF - TESTE
const VIPP_PRINT_CONFIG_TEST = {
  url: `${process.env.VIPP_URL || 'https://vipp.visualset.com.br/vipp/remoto'}/ImpressaoRemota.php`,
  usuario: process.env.VIPP_USUARIO_TESTE || 'onbiws',
  senha: process.env.VIPP_SENHA_TESTE || '112233',
};

// Configuração Evolution API para envio de WhatsApp
const EVOLUTION_CONFIG = {
  baseUrl: process.env.EVOLUTION_API_URL || '',
  apiKey: process.env.EVOLUTION_API_KEY || '',
  instanceName: process.env.EVOLUTION_INSTANCE_NAME || '',
  messageDelay: parseInt(process.env.EVOLUTION_MESSAGE_DELAY || '5000'),
  useEvolution: process.env.WHATSAPP_USE_EVOLUTION === 'true',
};

// Configuração SwipeOne API para rastreio
const SWIPEONE_CONFIG = {
  apiUrl: 'https://api.swipeone.com',
  apiKey: process.env.SWIPE_ONE_API || '',
  workspaceId: '6940ca7e21f105674fb79e5b',
};

interface EtiquetaData {
  codigo: string;
  transactionId: string;
  produto: string;
  dataPedido?: string;
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
  // Campos para envio parcial
  envioNumero?: number;
  enviosTotal?: number;
  isEnvioParcial?: boolean;
  observacaoEnvio?: string;
  // Campos para pedidos mesclados
  isMerged?: boolean;
  mergedTransactionIds?: string[];
  produtos?: string[];
}

interface WebhookConfig {
  adminPhone: string; // Telefone do admin (obrigatório)
  clientPhoneOverride?: string; // Se preenchido, substitui o número do cliente
  sendClientNotification: boolean; // Se true, envia WhatsApp para clientes
  ordemPrioridade?: 'antigos' | 'novos'; // Ordem de prioridade dos envios
  observacaoGeral?: string; // Observação geral do lote
  useTestCredentials?: boolean; // Se true, usa credenciais de teste VIPP
}

interface WebhookRequest {
  etiquetas: EtiquetaData[]; // Etiquetas novas (cliente recebe WhatsApp)
  etiquetasAdmin?: EtiquetaData[]; // Todas etiquetas (admin recebe WhatsApp)
  config: WebhookConfig; // Configurações vindas do Firebase
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
// Variável global para armazenar se está em modo teste (setada no POST)
let currentUseTestCredentials = false;

function gerarUrlPdf(codigos: string | string[]): string {
  const VIPP_PRINT_CONFIG = currentUseTestCredentials ? VIPP_PRINT_CONFIG_TEST : VIPP_PRINT_CONFIG_PROD;
  const lista = Array.isArray(codigos) ? codigos.join(',') : codigos;
  const params = new URLSearchParams({
    Usr: VIPP_PRINT_CONFIG.usuario,
    Pwd: VIPP_PRINT_CONFIG.senha,
    Filtro: '1',
    Saida: '20',
    Lista: lista,
  });
  console.log(`[PDF] Usando credenciais de ${currentUseTestCredentials ? 'TESTE' : 'PRODUÇÃO'} para URL do PDF`);
  return `${VIPP_PRINT_CONFIG.url}?${params.toString()}`;
}

// Interface para dados processados da etiqueta (com campos extras)
interface EtiquetaProcessada {
  codigo: string;
  pdfUrl: string;
  transactionId: string;
  produto: string;
  dataPedido: string;
  clienteNome: string;
  clienteTelefone: string | null;
  clienteEmail: string;
  clienteLogradouro: string;
  clienteNumero: string;
  clienteComplemento: string;
  clienteBairro: string;
  clienteCidade: string;
  clienteUf: string;
  clienteCep: string;
  envioNumero: number;
  enviosTotal: number;
  isEnvioParcial: boolean;
  observacaoEnvio: string;
  isMerged?: boolean;
  mergedTransactionIds?: string[];
  produtos?: string[];
}

// Gera mensagem personalizada para o cliente
function gerarMensagemCliente(e: EtiquetaProcessada): string {
  // Montar endereço completo
  const enderecoParts = [
    e.clienteLogradouro,
    e.clienteNumero,
    e.clienteComplemento,
  ].filter(Boolean).join(', ');
  const enderecoCompleto = `${enderecoParts} — ${e.clienteCidade}, ${e.clienteUf} CEP ${e.clienteCep}`;

  let msg = `${e.clienteNome}, seu pedido realizado na Branding.lab foi atualizado.\n\n`;
  msg += `📦 Código de rastreio dos Correios: ${e.codigo}\n\n`;

  // Se for pedido mesclado, mostrar os IDs das transações
  if (e.isMerged && e.mergedTransactionIds && e.mergedTransactionIds.length > 1) {
    msg += `🔗 Este envio contém ${e.mergedTransactionIds.length} pedidos:\n`;
    e.mergedTransactionIds.forEach(tid => {
      msg += `• ${tid}\n`;
    });
    msg += `\n`;
  }

  // Se for envio parcial, personalizar mensagem
  if (e.isEnvioParcial && e.enviosTotal > 1) {
    if (e.envioNumero === 1) {
      // Primeiro envio de uma série
      msg += `📋 *Atenção:* Este é o envio *${e.envioNumero} de ${e.enviosTotal}*.\n`;
      msg += `Os demais itens do seu pedido serão enviados em breve.\n\n`;
    } else if (e.envioNumero < e.enviosTotal) {
      // Envio intermediário
      msg += `📋 *Atenção:* Este é o envio *${e.envioNumero} de ${e.enviosTotal}*.\n`;
      msg += `Você já recebeu ${e.envioNumero - 1} envio(s) anterior(es) e ainda há mais ${e.enviosTotal - e.envioNumero} a caminho.\n\n`;
    } else {
      // Último envio
      msg += `📋 *Atenção:* Este é o *último envio* (${e.envioNumero} de ${e.enviosTotal}).\n`;
      msg += `Os envios anteriores já foram despachados.\n\n`;
    }

    // Se tiver observação do que vai neste envio
    if (e.observacaoEnvio) {
      msg += `📝 *Neste envio:* ${e.observacaoEnvio}\n\n`;
    }
  }

  msg += `📍 Endereço de envio informado no pedido: ${enderecoCompleto}\n\n`;
  msg += `🔗 Você pode acompanhar o status pelo site oficial dos Correios: https://rastreamento.correios.com.br/`;

  return msg;
}

// Função de delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Função para enviar mensagem via Evolution API
async function enviarMensagemEvolution(telefone: string, mensagem: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove barra final da URL base se houver
    const baseUrl = EVOLUTION_CONFIG.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/message/sendText/${EVOLUTION_CONFIG.instanceName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_CONFIG.apiKey,
      },
      body: JSON.stringify({
        number: telefone,
        text: mensagem,
        linkPreview: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Evolution] Erro ao enviar para ${telefone}:`, errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log(`[Evolution] Mensagem enviada para ${telefone}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[Evolution] Exceção ao enviar para ${telefone}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

// Função para enviar WhatsApp aos clientes com delay
async function enviarWhatsAppClientes(etiquetas: Array<{
  clienteTelefone: string | null;
  clienteNome: string;
  transactionId: string;
  mensagemCliente: string;
}>): Promise<{ enviados: number; erros: number }> {
  let enviados = 0;
  let erros = 0;

  const etiquetasComTelefone = etiquetas.filter(e => e.clienteTelefone && e.clienteTelefone.trim() !== '');

  console.log(`[WhatsApp Cliente] Iniciando envio de ${etiquetasComTelefone.length} mensagem(s) com delay de ${EVOLUTION_CONFIG.messageDelay}ms`);

  for (let i = 0; i < etiquetasComTelefone.length; i++) {
    const e = etiquetasComTelefone[i];

    // Aplicar delay entre mensagens (exceto na primeira)
    if (i > 0) {
      console.log(`[WhatsApp Cliente] Aguardando ${EVOLUTION_CONFIG.messageDelay}ms...`);
      await delay(EVOLUTION_CONFIG.messageDelay);
    }

    console.log(`[WhatsApp Cliente] Enviando ${i + 1}/${etiquetasComTelefone.length} para ${e.clienteNome} (${e.clienteTelefone})`);

    const resultado = await enviarMensagemEvolution(e.clienteTelefone!, e.mensagemCliente);

    if (resultado.success) {
      enviados++;
    } else {
      erros++;
    }
  }

  console.log(`[WhatsApp Cliente] Concluído: ${enviados} enviado(s), ${erros} erro(s)`);
  return { enviados, erros };
}

// ========== SWIPEONE - Integração de Rastreio ==========

interface SwipeOneContact {
  _id: string;
  email: string;
  fullName?: string;
  phone?: { countryCode: string; number: string };
  customProperties?: {
    ultimo_rastreio?: string;
    todos_rastreios?: string;
  };
}

// Timeout para requisições SwipeOne (10 segundos)
const SWIPEONE_TIMEOUT_MS = 10000;

// Fetch com timeout para SwipeOne
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = SWIPEONE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Criar ou atualizar contato no SwipeOne com rastreio (upsert via POST)
async function upsertContatoComRastreio(dados: {
  email: string;
  nome: string;
  telefone?: string;
  codigoRastreio: string;
  todosRastreiosAnteriores?: string;
}): Promise<{ success: boolean; contact?: SwipeOneContact }> {
  try {
    // Concatenar rastreios
    const novoTodosRastreios = dados.todosRastreiosAnteriores
      ? `${dados.todosRastreiosAnteriores}, ${dados.codigoRastreio}`
      : dados.codigoRastreio;

    // Payload com campos no root level (SwipeOne aceita assim para custom properties)
    const payload: Record<string, string> = {
      email: dados.email,
      fullName: dados.nome,
      ultimo_rastreio: dados.codigoRastreio,
      todos_rastreios: novoTodosRastreios,
    };

    if (dados.telefone) {
      payload.phone = dados.telefone;
    }

    const response = await fetchWithTimeout(
      `${SWIPEONE_CONFIG.apiUrl}/api/workspaces/${SWIPEONE_CONFIG.workspaceId}/contacts`,
      {
        method: 'POST',
        headers: {
          'x-api-key': SWIPEONE_CONFIG.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SwipeOne] Erro ao upsert contato: ${response.status} - ${errorText}`);
      return { success: false };
    }

    const data = await response.json();
    const contact = data?.data?.contact;

    if (contact) {
      console.log(`[SwipeOne] Contato atualizado: ${dados.email} | ultimo=${dados.codigoRastreio} | todos=${novoTodosRastreios}`);
      return { success: true, contact };
    }

    return { success: false };
  } catch (error) {
    // Captura timeout e outros erros sem propagar
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    if (errorMsg.includes('abort')) {
      console.error(`[SwipeOne] Timeout ao upsert contato: ${dados.email}`);
    } else {
      console.error(`[SwipeOne] Erro ao upsert contato:`, errorMsg);
    }
    return { success: false };
  }
}

// Buscar contato no SwipeOne por email (para pegar todos_rastreios existente)
async function buscarContatoSwipeOne(email: string): Promise<SwipeOneContact | null> {
  try {
    // POST para buscar/criar retorna o contato existente se já existe
    const response = await fetchWithTimeout(
      `${SWIPEONE_CONFIG.apiUrl}/api/workspaces/${SWIPEONE_CONFIG.workspaceId}/contacts`,
      {
        method: 'POST',
        headers: {
          'x-api-key': SWIPEONE_CONFIG.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      }
    );

    if (!response.ok) {
      console.error(`[SwipeOne] Erro ao buscar contato: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const contact = data?.data?.contact;

    if (contact) {
      console.log(`[SwipeOne] Contato encontrado: ${email}`);
      return contact;
    }

    return null;
  } catch (error) {
    // Captura timeout e outros erros sem propagar
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    if (errorMsg.includes('abort')) {
      console.error(`[SwipeOne] Timeout ao buscar contato: ${email}`);
    } else {
      console.error(`[SwipeOne] Erro ao buscar contato:`, errorMsg);
    }
    return null;
  }
}

// Processar rastreios no SwipeOne para lista de etiquetas
async function processarRastreiosSwipeOne(etiquetas: Array<{
  clienteEmail: string;
  clienteNome: string;
  clienteTelefone: string | null;
  codigo: string;
}>): Promise<{ processados: number; erros: number }> {
  let processados = 0;
  let erros = 0;

  // Filtrar etiquetas com email válido
  const etiquetasComEmail = etiquetas.filter(e => e.clienteEmail && e.clienteEmail.includes('@'));

  if (etiquetasComEmail.length === 0) {
    console.log('[SwipeOne] Nenhuma etiqueta com email válido para processar');
    return { processados: 0, erros: 0 };
  }

  console.log(`[SwipeOne] Processando ${etiquetasComEmail.length} etiqueta(s) com email válido`);

  for (const etiqueta of etiquetasComEmail) {
    try {
      // 1. Buscar contato existente para pegar todos_rastreios anterior
      const contatoExistente = await buscarContatoSwipeOne(etiqueta.clienteEmail);
      const todosRastreiosAnteriores = contatoExistente?.customProperties?.todos_rastreios;

      // 2. Upsert com novo rastreio
      const resultado = await upsertContatoComRastreio({
        email: etiqueta.clienteEmail,
        nome: etiqueta.clienteNome,
        telefone: etiqueta.clienteTelefone || undefined,
        codigoRastreio: etiqueta.codigo,
        todosRastreiosAnteriores,
      });

      if (resultado.success) {
        processados++;
      } else {
        erros++;
      }

      // Delay para não sobrecarregar API
      await delay(500);
    } catch (error) {
      console.error(`[SwipeOne] Erro ao processar ${etiqueta.clienteEmail}:`, error);
      erros++;
    }
  }

  console.log(`[SwipeOne] Concluído: ${processados} processado(s), ${erros} erro(s)`);
  return { processados, erros };
}

// ========== FIM SWIPEONE ==========

export async function POST(request: NextRequest) {
  try {
    const body: WebhookRequest = await request.json();
    const { etiquetas, etiquetasAdmin, config } = body;

    // Setar credenciais de teste/produção para URL do PDF
    currentUseTestCredentials = config.useTestCredentials || false;
    console.log(`[VIPP] Modo: ${currentUseTestCredentials ? 'TESTE' : 'PRODUÇÃO'}`);

    console.log('\n========== WEBHOOK ETIQUETAS - RECEBIDO ==========');
    // Log específico para debug de campos UF
    const allEtiquetas = [...(etiquetas || []), ...(etiquetasAdmin || [])];
    if (allEtiquetas.length > 0) {
      console.log('[DEBUG] Campos de endereço recebidos:');
      allEtiquetas.forEach((e, i) => {
        console.log(`  [${i}] Cidade="${e.destinatario?.cidade}" | UF="${e.destinatario?.uf}" | CEP="${e.destinatario?.cep}"`);
      });
    }
    console.log('==================================================\n');

    // Validar config
    if (!config || !config.adminPhone) {
      return NextResponse.json(
        { error: 'Configuração com adminPhone é obrigatória' },
        { status: 400 }
      );
    }

    // Usar etiquetasAdmin se fornecido, senão usar etiquetas (compatibilidade)
    const todasEtiquetas = etiquetasAdmin && etiquetasAdmin.length > 0 ? etiquetasAdmin : etiquetas;
    const etiquetasNovas = etiquetas || [];

    if ((!todasEtiquetas || todasEtiquetas.length === 0) && etiquetasNovas.length === 0) {
      return NextResponse.json(
        { error: 'Array de etiquetas é obrigatório' },
        { status: 400 }
      );
    }

    // Formatar número do admin (vindo do config/Firebase)
    const adminPhoneFormatted = formatarTelefone(config.adminPhone);
    if (!adminPhoneFormatted) {
      console.error('adminPhone inválido:', config.adminPhone);
      return NextResponse.json(
        { error: 'Número do admin inválido' },
        { status: 400 }
      );
    }

    // Formatar número de override do cliente (se existir no config)
    const clientePhoneOverride = config.clientPhoneOverride ? formatarTelefone(config.clientPhoneOverride) : null;

    // Flag para enviar WhatsApp ao cliente (vindo do config/Firebase)
    const enviarWhatsappCliente = config.sendClientNotification;

    // Processar etiquetas NOVAS para envio ao cliente (WhatsApp)
    const etiquetasNovasProcessadas = etiquetasNovas.map(e => {
      let clienteTelefone: string | null = null;

      if (clientePhoneOverride) {
        clienteTelefone = clientePhoneOverride;
      } else {
        clienteTelefone = formatarTelefone(e.destinatario.telefone);
      }

      const etiquetaProcessada: EtiquetaProcessada = {
        codigo: e.codigo,
        pdfUrl: gerarUrlPdf(e.codigo),
        transactionId: e.transactionId,
        produto: e.produto,
        dataPedido: e.dataPedido || '',
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
        // Campos de envio parcial
        envioNumero: e.envioNumero || 1,
        enviosTotal: e.enviosTotal || 1,
        isEnvioParcial: e.isEnvioParcial || false,
        observacaoEnvio: e.observacaoEnvio || '',
        // Campos de merge
        isMerged: e.isMerged || false,
        mergedTransactionIds: e.mergedTransactionIds || [],
        produtos: e.produtos || [],
      };

      return {
        ...etiquetaProcessada,
        // Mensagem pronta para enviar ao cliente via WhatsApp
        mensagemCliente: gerarMensagemCliente(etiquetaProcessada),
      };
    });

    // Processar TODAS etiquetas para o admin
    const todasEtiquetasProcessadas = todasEtiquetas.map(e => ({
      codigo: e.codigo,
      pdfUrl: gerarUrlPdf(e.codigo),
      transactionId: e.transactionId,
      produto: e.produto,
      dataPedido: e.dataPedido || '',
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
      // Campos de envio parcial
      envioNumero: e.envioNumero || 1,
      enviosTotal: e.enviosTotal || 1,
      isEnvioParcial: e.isEnvioParcial || false,
      observacaoEnvio: e.observacaoEnvio || '',
      // Campos de merge
      isMerged: e.isMerged || false,
      mergedTransactionIds: e.mergedTransactionIds || [],
      produtos: e.produtos || [],
    }));

    // Filtrar etiquetas NOVAS que têm telefone válido (para envio ao cliente)
    // Verifica se não é null E não é string vazia
    const etiquetasNovasComTelefone = etiquetasNovasProcessadas.filter(e => e.clienteTelefone && e.clienteTelefone.trim() !== '');
    const etiquetasNovasSemTelefone = etiquetasNovasProcessadas.filter(e => !e.clienteTelefone || e.clienteTelefone.trim() === '');

    if (etiquetasNovasSemTelefone.length > 0) {
      console.log(`${etiquetasNovasSemTelefone.length} etiqueta(s) NOVA(s) sem telefone válido:`,
        etiquetasNovasSemTelefone.map(e => `${e.clienteNome} (${e.codigo})`));
    }

    // Gerar URL consolidada do PDF para o admin (todas as etiquetas em um único PDF)
    const pdfUrlConsolidada = gerarUrlPdf(todasEtiquetas.map(e => e.codigo));

    // Gerar mensagem formatada para o admin
    const etiquetasAntigas = todasEtiquetasProcessadas.filter(e => !e.isNova);
    const ordemTexto = config.ordemPrioridade === 'novos' ? '🆕 Mais novos primeiro' : '📅 Mais antigos primeiro';

    let mensagemAdmin = `📦 *Etiquetas Geradas*\n\n`;
    mensagemAdmin += `Total: ${todasEtiquetas.length} etiqueta(s)\n`;
    mensagemAdmin += `Prioridade: ${ordemTexto}\n`;

    // Observação geral se houver
    if (config.observacaoGeral) {
      mensagemAdmin += `\n📝 *Observação:*\n_${config.observacaoGeral}_\n`;
    }

    if (etiquetasNovas.length > 0) {
      mensagemAdmin += `\n✨ *${etiquetasNovas.length} NOVA(S):*\n`;
      todasEtiquetasProcessadas.filter(e => e.isNova).forEach(e => {
        mensagemAdmin += `\n🏷️ ${e.codigo}\n`;
        mensagemAdmin += `👤 ${e.clienteNome}\n`;
        mensagemAdmin += `📍 ${e.clienteCidade}/${e.clienteUf}\n`;
        // Mostrar data do pedido
        if (e.dataPedido) {
          mensagemAdmin += `📅 ${e.dataPedido}\n`;
        }
        mensagemAdmin += `📦 ${e.produto}\n`;
        // Mostrar info de envio parcial
        if (e.isEnvioParcial && e.enviosTotal > 1) {
          mensagemAdmin += `📋 *Envio ${e.envioNumero}/${e.enviosTotal}* (parcial)\n`;
        }
        // Mostrar observação do pedido se houver
        if (e.observacaoEnvio) {
          mensagemAdmin += `💬 _${e.observacaoEnvio}_\n`;
        }
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
        // Mostrar data do pedido
        if (e.dataPedido) {
          mensagemAdmin += `📅 ${e.dataPedido}\n`;
        }
        mensagemAdmin += `📦 ${e.produto}\n`;
        // Mostrar info de envio parcial
        if (e.isEnvioParcial && e.enviosTotal > 1) {
          mensagemAdmin += `📋 *Envio ${e.envioNumero}/${e.enviosTotal}* (parcial)\n`;
        }
        // Mostrar observação do pedido se houver
        if (e.observacaoEnvio) {
          mensagemAdmin += `💬 _${e.observacaoEnvio}_\n`;
        }
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
    // - etiquetas: NOVAS com telefone (cliente recebe WhatsApp individual) - só se sendClientNotification=true
    // - todasEtiquetas: TODAS (admin recebe resumo + PDF consolidado)

    // Se sendClientNotification=false, envia array vazio para não disparar WhatsApp aos clientes
    const etiquetasParaCliente = enviarWhatsappCliente ? etiquetasNovasComTelefone : [];

    if (!enviarWhatsappCliente && etiquetasNovasComTelefone.length > 0) {
      console.log(`⚠️ sendClientNotification=false - ${etiquetasNovasComTelefone.length} cliente(s) NÃO receberão WhatsApp`);
    }

    // Gerar nome do arquivo baseado na quantidade de etiquetas
    const dataAtual = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const fileName = todasEtiquetas.length === 1
      ? `${todasEtiquetasProcessadas[0]?.clienteNome || 'Etiqueta'} - ${dataAtual}`
      : `Etiquetas - ${dataAtual}`;

    const webhookPayload = {
      timestamp: new Date().toISOString(),
      totalNovas: etiquetasNovas.length,
      totalAdmin: todasEtiquetas.length,
      adminPhone: adminPhoneFormatted,
      // Nome do arquivo para caption e download
      fileName: fileName,
      // URL do PDF consolidado (todas etiquetas em um único arquivo) - usar no admin
      pdfUrlConsolidada: pdfUrlConsolidada,
      // Mensagem formatada para o admin
      mensagemAdmin: mensagemAdmin,
      // Etiquetas NOVAS com telefone válido (cliente recebe WhatsApp) - vazio se WHATSAPP_ENVIAR_CLIENTE=false
      etiquetas: etiquetasParaCliente,
      // TODAS as etiquetas (admin recebe)
      todasEtiquetas: todasEtiquetasProcessadas,
      // Opções de envio
      opcoes: {
        ordemPrioridade: config.ordemPrioridade || 'antigos',
        observacaoGeral: config.observacaoGeral || '',
      },
      // Resumo para mensagem consolidada do admin
      resumo: {
        quantidadeNovas: etiquetasNovas.length,
        quantidadeTotal: todasEtiquetas.length,
        codigos: todasEtiquetas.map(e => e.codigo),
        codigosNovos: etiquetasNovas.map(e => e.codigo),
        semTelefone: etiquetasNovasSemTelefone.length,
        enviarClienteDesabilitado: !enviarWhatsappCliente,
      },
    };

    console.log('\n========== PAYLOAD PARA N8N ==========');
    console.log(JSON.stringify(webhookPayload, null, 2));
    console.log('======================================\n');

    // Enviar para N8N (admin)
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

    // Enviar WhatsApp para clientes via Evolution API (se habilitado)
    let whatsappClienteResultado = { enviados: 0, erros: 0 };
    if (EVOLUTION_CONFIG.useEvolution && enviarWhatsappCliente && etiquetasParaCliente.length > 0) {
      console.log('\n========== ENVIANDO WHATSAPP CLIENTES (Evolution) ==========');
      try {
        whatsappClienteResultado = await enviarWhatsAppClientes(etiquetasParaCliente);
      } catch (evolutionError) {
        console.error('Erro ao enviar WhatsApp via Evolution:', evolutionError);
      }
      console.log('============================================================\n');
    } else if (!EVOLUTION_CONFIG.useEvolution) {
      console.log('[WhatsApp Cliente] WHATSAPP_USE_EVOLUTION=false, deixando N8N enviar');
    } else if (!enviarWhatsappCliente) {
      console.log('[WhatsApp Cliente] Notificação ao cliente desabilitada');
    }

    // Enviar rastreios para SwipeOne (apenas etiquetas NOVAS com email válido)
    let swipeOneResultado = { processados: 0, erros: 0 };
    if (SWIPEONE_CONFIG.apiKey && etiquetasNovasProcessadas.length > 0) {
      console.log('\n========== ENVIANDO RASTREIOS SWIPEONE ==========');
      try {
        swipeOneResultado = await processarRastreiosSwipeOne(etiquetasNovasProcessadas);
      } catch (swipeOneError) {
        console.error('[SwipeOne] Erro ao processar rastreios:', swipeOneError);
      }
      console.log('=================================================\n');
    } else if (!SWIPEONE_CONFIG.apiKey) {
      console.log('[SwipeOne] API Key não configurada, pulando integração');
    }

    // Cadastrar etiquetas NOVAS no Google Sheets (em paralelo, não bloqueia)
    if (etiquetasNovas.length > 0) {
      const dataGeracao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const etiquetasParaSheets = etiquetasNovasProcessadas.map(e => ({
        codigo: e.codigo,
        transactionId: e.transactionId,
        dataPedido: e.dataPedido,
        dataGeracao: dataGeracao,
        produto: e.produto,
        clienteNome: e.clienteNome,
        clienteDocumento: '', // Não temos no processado, seria necessário passar do frontend
        clienteTelefone: e.clienteTelefone || '',
        clienteEmail: e.clienteEmail,
        clienteLogradouro: e.clienteLogradouro,
        clienteNumero: e.clienteNumero,
        clienteComplemento: e.clienteComplemento,
        clienteBairro: e.clienteBairro,
        clienteCidade: e.clienteCidade,
        clienteUf: e.clienteUf,
        clienteCep: e.clienteCep,
        envioNumero: e.envioNumero,
        enviosTotal: e.enviosTotal,
        isEnvioParcial: e.isEnvioParcial,
        observacaoEnvio: e.observacaoEnvio,
        isMerged: e.isMerged,
        mergedTransactionIds: e.mergedTransactionIds,
        produtos: e.produtos,
        isTest: currentUseTestCredentials,
      }));

      // Fire and forget - não bloqueia a resposta
      fetch(`${request.nextUrl.origin}/api/google-sheets/etiquetas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: etiquetasParaSheets }),
      }).catch(err => console.error('[Google Sheets] Erro ao cadastrar:', err));

      console.log(`[Google Sheets] Enviando ${etiquetasNovas.length} etiqueta(s) para planilha...`);
    }

    return NextResponse.json({
      success: true,
      message: `Webhook disparado: ${etiquetasNovas.length} nova(s), ${todasEtiquetas.length} total para admin`,
      whatsappCliente: whatsappClienteResultado,
      swipeOne: swipeOneResultado,
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
