import { NextRequest, NextResponse } from 'next/server';

const DATACRAZY_TOKEN = 'dc_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MzcyODRjYTc3MWNkZmY4MGJjMjc2ZiIsInRlbmFudElkIjoiNjdmN2E5ODAtODk0YS00Nzk5LThjMDMtZTYyNGY5ZWRhNTY3IiwibmFtZSI6Ik44biAtIGR2IiwiaWF0IjoxNzY1MjIyNDc2LCJleHAiOjE5MjQ5MTYzOTl9.eii1aUDplkPh1Y2Rt5W0EhTqaQ4uvr2ClV0_OBOSvDU';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';

// Stage IDs por plataforma (primeiro stage "Lead" de cada pipeline)
const STAGES: Record<string, string> = {
  hubla: '74022307-988f-4a81-a3df-c14b28bd41d9',
  hotmart: '0c2bf45f-1c4b-4730-b02c-286b7c018f29',
  eduzz: '3bbc9611-aa0d-47d5-a755-a9cdcfc453ef',
  kiwify: '491a2794-7576-45d0-8d8e-d5a6855f17e2',
  woo: '2c16fbba-092d-48a8-929b-55c5b9d638cc',
};

// Mapeamento de colunas por plataforma
const COLUMN_MAP: Record<string, {
  email: string;
  name: string;
  phone: string;
  taxId: string;
  product: string;
  transactionId: string;
  total: string;
  status: string;
  statusPaid: string;
  zip?: string;
  address?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}> = {
  hubla: {
    email: 'Email do cliente',
    name: 'Nome do cliente',
    phone: 'Telefone do cliente',
    taxId: 'Documento do cliente',
    product: 'Nome do produto',
    transactionId: 'ID da fatura',
    total: 'Valor total',
    status: 'Status da fatura',
    statusPaid: 'Paga',
    zip: 'Endereço CEP',
    address: 'Endereço Rua',
    city: 'Endereço Cidade',
    state: 'Endereço Estado',
  },
  hotmart: {
    email: 'Email',
    name: 'Nome',
    phone: 'Telefone Final',
    taxId: 'Documento',
    product: 'Nome do Produto',
    transactionId: 'Transação',
    total: 'Preço Total',
    status: 'Status',
    statusPaid: 'Aprovado',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Número',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
  },
  eduzz: {
    email: 'Cliente / E-mail',
    name: 'Cliente / Nome',
    phone: 'Cliente / Fones',
    taxId: 'Cliente / Documento',
    product: 'Produto',
    transactionId: 'Fatura',
    total: 'Valor da Venda',
    status: 'Status',
    statusPaid: 'Paga',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Numero',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'UF',
  },
  kiwify: {
    email: 'Email',
    name: 'Cliente',
    phone: 'Celular',
    taxId: 'CPF / CNPJ',
    product: 'Produto',
    transactionId: 'ID da venda',
    total: 'Valor líquido',
    status: 'Status',
    statusPaid: 'paid',
    zip: 'CEP',
    address: 'Endereço',
    addressNumber: 'Numero',
    addressComplement: 'Complemento',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado',
  },
  woo: {
    email: 'Billing Email Address',
    name: 'Billing First Name',
    phone: 'Billing Phone',
    taxId: '_billing_cpf',
    product: 'Product Name #1',
    transactionId: 'Order ID',
    total: 'Order Total',
    status: 'Order Status',
    statusPaid: 'wc-completed',
    zip: 'Billing Postcode',
    address: 'Billing Address 1',
    addressComplement: 'Billing Address 2',
    city: 'Billing City',
    state: 'Billing State',
    neighborhood: '_billing_neighborhood',
  },
};

function parseCSV(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let pos = 0;
  const len = text.length;
  let headers: string[] = [];

  function parseField(): string {
    let field = '';
    while (pos < len && (text[pos] === ' ' || text[pos] === '\t')) pos++;

    if (pos < len && text[pos] === '"') {
      pos++;
      while (pos < len) {
        if (text[pos] === '"') {
          if (pos + 1 < len && text[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          field += text[pos];
          pos++;
        }
      }
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') pos++;
    } else {
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
        field += text[pos];
        pos++;
      }
    }
    return field.trim();
  }

  function parseLine(): string[] {
    const fields: string[] = [];
    while (pos < len) {
      fields.push(parseField());
      if (pos >= len || text[pos] === '\n' || text[pos] === '\r') break;
      if (text[pos] === ',') pos++;
    }
    while (pos < len && (text[pos] === '\n' || text[pos] === '\r')) pos++;
    return fields;
  }

  if (pos < len) headers = parseLine();
  if (headers.length === 0) return [];

  while (pos < len) {
    const fields = parseLine();
    if (fields.length === 0 || (fields.length === 1 && fields[0] === '')) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = fields[i] !== undefined ? fields[i] : '';
    }
    rows.push(row);
  }
  return rows;
}

function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function safeEmail(val: unknown): string | null {
  const email = safeString(val).toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) return null;
  return email;
}

async function apiRequest(method: string, endpoint: string, body?: unknown) {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${endpoint}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

// GET - Verificar se tem importação em andamento (via query param)
export async function GET() {
  return NextResponse.json({
    message: 'Use POST para importar CSV',
    platforms: Object.keys(STAGES)
  });
}

// POST - Processar CSV com Server-Sent Events
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const platform = formData.get('platform') as string || 'hubla';
        const delayMs = parseInt(formData.get('delay') as string || '1500');

        if (!file) {
          send({ type: 'error', message: 'Nenhum arquivo enviado' });
          controller.close();
          return;
        }

        const stageId = STAGES[platform];
        const columns = COLUMN_MAP[platform];

        if (!stageId || !columns) {
          send({ type: 'error', message: `Plataforma não suportada: ${platform}` });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Lendo CSV...' });

        const csvContent = await file.text();
        const allRows = parseCSV(csvContent);

        send({ type: 'status', message: `CSV lido: ${allRows.length} linhas` });

        // Filtrar pagas
        const rows = allRows.filter(row => {
          const status = safeString(row[columns.status]);
          return status === columns.statusPaid;
        });

        send({
          type: 'init',
          total: rows.length,
          filtered: allRows.length - rows.length,
          platform,
          fileName: file.name,
          message: `${rows.length} ${columns.statusPaid} de ${allRows.length} total`
        });

        if (rows.length === 0) {
          // Debug: mostrar status únicos e colunas encontradas
          const uniqueStatuses = [...new Set(allRows.map(row => safeString(row[columns.status])))];
          const csvHeaders = allRows.length > 0 ? Object.keys(allRows[0]) : [];
          send({
            type: 'debug',
            message: `Nenhum registro com status "${columns.statusPaid}"`,
            statusColumn: columns.status,
            uniqueStatuses: uniqueStatuses.slice(0, 10),
            csvHeaders: csvHeaders.slice(0, 20),
            sampleRow: allRows[0] || {}
          });
          send({ type: 'complete', created: 0, exists: 0, updated: 0, errors: 0, skipped: 0 });
          controller.close();
          return;
        }

        let created = 0, exists = 0, updated = 0, errors = 0, skipped = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];

          try {
            const email = safeEmail(row[columns.email]);
            const name = safeString(row[columns.name]) || 'Sem nome';
            const productName = safeString(row[columns.product]);
            const transactionId = safeString(row[columns.transactionId]);

            if (!email || !transactionId) {
              skipped++;
              send({
                type: 'progress',
                index: i + 1,
                total: rows.length,
                status: 'skipped',
                message: `Sem email ou transactionId`,
                stats: { created, exists, updated, errors, skipped }
              });
              continue;
            }

            let phone = safeString(row[columns.phone]);
            if (phone.startsWith('+')) phone = phone.substring(1);
            phone = phone.replace(/\D/g, '');

            const taxId = safeString(row[columns.taxId]).replace(/\D/g, '');

            // Montar endereço completo
            const zipCode = safeString(row[columns.zip || '']);
            const streetAddress = safeString(row[columns.address || '']);
            const addressNumber = safeString(row[columns.addressNumber || '']);
            const addressComplement = safeString(row[columns.addressComplement || '']);
            const neighborhood = safeString(row[columns.neighborhood || '']);
            const city = safeString(row[columns.city || '']);
            const state = safeString(row[columns.state || '']);

            // Formatar endereço completo para o DataCrazy
            let fullAddress = streetAddress;
            if (addressNumber) fullAddress += `, ${addressNumber}`;
            if (addressComplement) fullAddress += ` - ${addressComplement}`;
            if (neighborhood) fullAddress += ` - ${neighborhood}`;

            const address = zipCode ? {
              zip: zipCode,
              address: fullAddress,
              city: city,
              state: state,
              country: 'Brasil',
            } : undefined;

            const saleValue = parseFloat(safeString(row[columns.total]).replace(',', '.')) || 0;

            // BUSCAR/CRIAR LEAD
            let leadId: string | undefined;
            let leadTags: { id: string }[] = [];

            const leadSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(email)}`);

            if (!leadSearch || leadSearch.count === 0) {
              try {
                const newLead = await apiRequest('POST', '/leads', {
                  name,
                  email,
                  phone: phone || undefined,
                  taxId: taxId || undefined,
                  address: address?.zip ? address : undefined,
                  source: `CSV ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
                });
                leadId = newLead?.id;

                send({
                  type: 'progress',
                  index: i + 1,
                  total: rows.length,
                  status: 'lead_created',
                  email,
                  name,
                  message: `Lead criado: ${name}`,
                  stats: { created, exists, updated, errors, skipped }
                });
              } catch (createError) {
                // Se der erro de contato duplicado, buscar pelo email existente na mensagem de erro
                const errorMsg = createError instanceof Error ? createError.message : '';
                if (errorMsg.includes('lead-with-same-contact-exists')) {
                  // Extrair o email do lead existente da mensagem de erro
                  const emailMatch = errorMsg.match(/"email":"([^"]+)"/);
                  const existingEmail = emailMatch ? emailMatch[1] : null;

                  if (existingEmail) {
                    // Buscar pelo email do lead existente
                    const existingSearch = await apiRequest('GET', `/leads?search=${encodeURIComponent(existingEmail)}`);
                    if (existingSearch?.data?.[0]) {
                      leadId = existingSearch.data[0].id;
                      leadTags = existingSearch.data[0].tags || [];
                      // Não enviar mensagem aqui, deixar o fluxo continuar para criar o business
                    } else {
                      throw createError;
                    }
                  } else {
                    throw createError;
                  }
                } else {
                  throw createError;
                }
              }
            } else {
              const existingLead = leadSearch.data[0];
              leadId = existingLead.id;
              leadTags = existingLead.tags || [];

              const updateData: Record<string, unknown> = {};
              if (phone && !existingLead.phone) updateData.phone = phone;
              if (taxId && !existingLead.taxId) updateData.taxId = taxId;
              if (address?.zip && (!existingLead.address || !existingLead.address.zip)) {
                updateData.address = address;
              }

              if (Object.keys(updateData).length > 0) {
                await apiRequest('PATCH', `/leads/${leadId}`, updateData);
                updated++;
              }
            }

            // TAG DO PRODUTO
            if (productName && leadId) {
              try {
                const tagSearch = await apiRequest('GET', `/tags?search=${encodeURIComponent(productName)}`);
                if (tagSearch?.data?.[0] && !leadTags.some((t: { id: string }) => t.id === tagSearch.data[0].id)) {
                  await apiRequest('PATCH', `/leads/${leadId}`, {
                    tags: [...leadTags.map((t: { id: string }) => ({ id: t.id })), { id: tagSearch.data[0].id }]
                  });
                }
              } catch {
                // ignora erro de tag
              }
            }

            // CRIAR BUSINESS
            if (!leadId) {
              skipped++;
              send({
                type: 'progress',
                index: i + 1,
                total: rows.length,
                status: 'skipped',
                email,
                name,
                message: `Sem leadId - não foi possível vincular`,
                stats: { created, exists, updated, errors, skipped }
              });
              await new Promise(r => setTimeout(r, delayMs));
              continue;
            }

            // Buscar os negócios do lead e verificar se já existe um com o mesmo externalId
            const leadBusinesses = await apiRequest('GET', `/leads/${leadId}/businesses`);

            // Verificar se existe negócio com mesmo externalId (mesma transação)
            const existingBusiness = leadBusinesses?.data?.find((biz: { externalId?: string }) =>
              biz.externalId === transactionId
            );

            if (!existingBusiness) {
              await apiRequest('POST', '/businesses', {
                leadId,
                stageId,
                externalId: transactionId,
                total: saleValue,
              });
              created++;

              send({
                type: 'progress',
                index: i + 1,
                total: rows.length,
                status: 'created',
                email,
                name,
                value: saleValue,
                message: `Negócio criado: R$ ${saleValue.toFixed(2)}`,
                stats: { created, exists, updated, errors, skipped }
              });
            } else {
              exists++;

              send({
                type: 'progress',
                index: i + 1,
                total: rows.length,
                status: 'exists',
                email,
                name,
                message: `Business já existe (${transactionId.substring(0, 8)}...)`,
                stats: { created, exists, updated, errors, skipped }
              });
            }

            // Delay entre itens
            await new Promise(r => setTimeout(r, delayMs));

          } catch (e) {
            errors++;
            const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';

            send({
              type: 'progress',
              index: i + 1,
              total: rows.length,
              status: 'error',
              email: safeString(row[columns.email]),
              name: safeString(row[columns.name]),
              message: errorMsg,
              stats: { created, exists, updated, errors, skipped }
            });

            await new Promise(r => setTimeout(r, delayMs));
          }
        }

        send({
          type: 'complete',
          created,
          exists,
          updated,
          errors,
          skipped,
          total: rows.length,
          message: `Importação concluída! Criados: ${created}, Existentes: ${exists}, Erros: ${errors}`
        });

      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Erro desconhecido';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
