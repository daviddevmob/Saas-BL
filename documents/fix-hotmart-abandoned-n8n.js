// Código para nó Code do N8N - Carrinho Abandonado Hotmart → Datacrazy
// Stage: Sincronizado via integração (ea3774ba-e515-45eb-a751-eaae2d4c1f63)

const DATACRAZY_TOKEN = 'dc_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MzcyODRjYTc3MWNkZmY4MGJjMjc2ZiIsInRlbmFudElkIjoiNjdmN2E5ODAtODk0YS00Nzk5LThjMDMtZTYyNGY5ZWRhNTY3IiwibmFtZSI6Ik44biAtIGR2IiwiaWF0IjoxNzY1MjIyNDc2LCJleHAiOjE5MjQ5MTYzOTl9.eii1aUDplkPh1Y2Rt5W0EhTqaQ4uvr2ClV0_OBOSvDU';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';
const STAGE_ID = 'ea3774ba-e515-45eb-a751-eaae2d4c1f63';

// Função auxiliar para requisições com melhor tratamento de erro
async function makeRequest(context, method, endpoint, body = null) {
  try {
    const options = {
      method,
      url: `${API_URL}${endpoint}`,
      headers: { 
        'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      json: true
    };
    if (body) options.body = body;
    return await context.helpers.httpRequest(options);
  } catch (error) {
    // Tenta extrair a mensagem de erro detalhada da resposta da API
    const apiReason = error.response?.data?.message || error.response?.data?.error || JSON.stringify(error.response?.data) || error.message;
    throw new Error(`Falha em ${method} ${endpoint}: ${apiReason}`);
  }
}

const input = $input.first().json;

// Tratamento de dados
const email = (input.email || '').toLowerCase().trim();
let telefone = (input.telefone || '').toString().replace(/\D/g, ''); 
const nome = input.nome || 'Sem nome';
const produtoId = input.produto_id;
const produtoNome = input.produto_nome || '';
const plataforma = input.plataforma || 'hotmart';
const dataAbandono = input.data_abandono;
const offerCode = input.offer_code || '';
const hotmartEventId = input.hotmart_event_id || '';

// --- FIX: Corrigir DDI Brasil (adicionar 55 se tiver 10-11 dígitos) ---
if (telefone) {
  if (telefone.length >= 10 && telefone.length <= 11) {
    telefone = '55' + telefone;
  }
}
// ----------------------------------------------------------------------

if (!email || !email.includes('@')) {
  return [{ json: { success: false, error: 'Email inválido ou não fornecido' } }];
}

const externalId = hotmartEventId || `abandono_${produtoId}_${email}_${Date.now()}`;

let leadId;
let leadCreated = false;

try {
  // 1. Buscar lead existente
  const leadSearch = await makeRequest(this, 'GET', `/leads?search=${encodeURIComponent(email)}`);

  if (!leadSearch || leadSearch.count === 0) {
    // 2. Criar novo lead
    const leadBody = {
      name: nome,
      email: email,
      source: `Carrinho Abandonado ${plataforma.charAt(0).toUpperCase() + plataforma.slice(1)}`
    };
    // Só envia telefone se existir, para evitar erro 400 com string vazia
    if (telefone) leadBody.phone = telefone;

    const newLead = await makeRequest(this, 'POST', '/leads', leadBody);
    leadId = newLead.id;
    leadCreated = true;
  } else {
    const existingLead = leadSearch.data[0];
    leadId = existingLead.id;

    // --- FIX: Atualizar telefone se o lead existir mas estiver incompleto ---
    const existingPhone = existingLead.phone;
    // Atualiza se: tem telefone novo E (o antigo não existe OU o novo é maior/mais completo que o antigo)
    if (telefone && (!existingPhone || existingPhone.length < telefone.length)) {
      await makeRequest(this, 'PATCH', `/leads/${leadId}`, { phone: telefone });
    }
    // ----------------------------------------------------------------------
  }

  // 3. Verificar duplicata de negócio (Business)
  const leadBusinesses = await makeRequest(this, 'GET', `/leads/${leadId}/businesses`);
  const existingBusiness = (leadBusinesses?.data || []).find(biz => biz.externalId === externalId);

  if (existingBusiness) {
    return [{ json: {
      success: true,
      action: 'exists',
      message: 'Carrinho abandonado já cadastrado',
      leadId,
      businessId: existingBusiness.id,
      externalId,
      phone_fixed: telefone
    }}];
  }

  // 4. Criar negócio
  const businessBody = {
    leadId,
    stageId: STAGE_ID,
    externalId: externalId,
    title: `Carrinho: ${produtoNome || 'Produto ' + produtoId}`,
    description: `Carrinho abandonado em ${dataAbandono || new Date().toISOString()}\nOffer: ${offerCode}\nProduto ID: ${produtoId}`,
    total: 0 // Valor padrão para evitar erro 400 se o campo for obrigatório
  };
  
  const business = await makeRequest(this, 'POST', '/businesses', businessBody);

  // 5. Adicionar tag do produto (Opcional, falha silenciosa)
  if (produtoNome) {
    try {
      const tagSearch = await makeRequest(this, 'GET', `/tags?search=${encodeURIComponent(produtoNome)}`);
      
      if (tagSearch?.data?.[0]) {
        const currentLead = await makeRequest(this, 'GET', `/leads/${leadId}`);
        const currentTags = currentLead.tags || [];
        
        if (!currentTags.some(t => t.id === tagSearch.data[0].id)) {
          const newTags = [...currentTags.map(t => ({ id: t.id })), { id: tagSearch.data[0].id }];
          await makeRequest(this, 'PATCH', `/leads/${leadId}`, { tags: newTags });
        }
      }
    } catch (e) {
      // Ignora erro de tag para não falhar o fluxo principal
    }
  }

  return [{ json: {
    success: true,
    action: leadCreated ? 'lead_and_business_created' : 'business_created',
    message: leadCreated ? 'Lead e negócio criados' : 'Negócio criado para lead existente',
    leadId,
    businessId: business.id,
    externalId,
    produto: produtoNome,
    email,
    phone_fixed: telefone
  }}];

} catch (e) {
  // Retorna o erro detalhado para o n8n
  return [{ json: { 
    success: false, 
    status: 'error', 
    message: e.message,
    email, 
    phone_attempted: telefone 
  }}];
}