// Código para nó Code do N8N - Carrinho Abandonado Hotmart → Datacrazy
// Stage: Sincronizado via integração (ea3774ba-e515-45eb-a751-eaae2d4c1f63)

const DATACRAZY_TOKEN = 'dc_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MzcyODRjYTc3MWNkZmY4MGJjMjc2ZiIsInRlbmFudElkIjoiNjdmN2E5ODAtODk0YS00Nzk5LThjMDMtZTYyNGY5ZWRhNTY3IiwibmFtZSI6Ik44biAtIGR2IiwiaWF0IjoxNzY1MjIyNDc2LCJleHAiOjE5MjQ5MTYzOTl9.eii1aUDplkPh1Y2Rt5W0EhTqaQ4uvr2ClV0_OBOSvDU';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';
const STAGE_ID = 'ea3774ba-e515-45eb-a751-eaae2d4c1f63';

const input = $input.first().json;

const email = (input.email || '').toLowerCase().trim();
let telefone = (input.telefone || '').toString().replace(/\D/g, ''); // Alterado para let
const nome = input.nome || 'Sem nome';
const produtoId = input.produto_id;
const produtoNome = input.produto_nome || '';
const plataforma = input.plataforma || 'hotmart';
const dataAbandono = input.data_abandono;
const offerCode = input.offer_code || '';
const hotmartEventId = input.hotmart_event_id || '';

// --- FIX: Corrigir DDI Brasil ---
if (telefone) {
  // Se tiver 10 ou 11 dígitos (DDD + Número), adicionar 55
  if (telefone.length >= 10 && telefone.length <= 11) {
    telefone = '55' + telefone;
  }
}
// --------------------------------

if (!email || !email.includes('@')) {
  return [{ json: { success: false, error: 'Email inválido ou não fornecido' } }];
}

const externalId = hotmartEventId || `abandono_${produtoId}_${email}_${Date.now()}`;

let leadId;
let leadCreated = false;

// 1. Buscar lead existente
const leadSearch = await this.helpers.httpRequest({
  method: 'GET',
  url: `${API_URL}/leads?search=${encodeURIComponent(email)}`,
  headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
  json: true,
});

if (!leadSearch || leadSearch.count === 0) {
  // 2. Criar novo lead
  const newLead = await this.helpers.httpRequest({
    method: 'POST',
    url: `${API_URL}/leads`,
    headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}`, 'Content-Type': 'application/json' },
    body: {
      name: nome,
      email: email,
      phone: telefone || undefined,
      source: `Carrinho Abandonado ${plataforma.charAt(0).toUpperCase() + plataforma.slice(1)}`,
    },
    json: true,
  });
  leadId = newLead.id;
  leadCreated = true;
} else {
  const existingLead = leadSearch.data[0];
  leadId = existingLead.id;

  // --- FIX: Atualizar telefone se o lead existir mas estiver sem telefone ou com telefone incompleto ---
  const existingPhone = existingLead.phone;
  if (telefone && (!existingPhone || existingPhone.length < telefone.length)) {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `${API_URL}/leads/${leadId}`,
      headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}`, 'Content-Type': 'application/json' },
      body: { phone: telefone },
      json: true,
    });
  }
  // ----------------------------------------------------------------------------------------------------
}

// 3. Verificar duplicata de negócio (Business)
const leadBusinesses = await this.helpers.httpRequest({
  method: 'GET',
  url: `${API_URL}/leads/${leadId}/businesses`,
  headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
  json: true,
});

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
const business = await this.helpers.httpRequest({
  method: 'POST',
  url: `${API_URL}/businesses`,
  headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}`, 'Content-Type': 'application/json' },
  body: {
    leadId,
    stageId: STAGE_ID,
    externalId: externalId,
    title: `Carrinho: ${produtoNome || 'Produto ' + produtoId}`,
    description: `Carrinho abandonado em ${dataAbandono || new Date().toISOString()}\nOffer: ${offerCode}\nProduto ID: ${produtoId}`,
  },
  json: true,
});

// 5. Adicionar tag do produto
if (produtoNome) {
  try {
    const tagSearch = await this.helpers.httpRequest({
      method: 'GET',
      url: `${API_URL}/tags?search=${encodeURIComponent(produtoNome)}`,
      headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
      json: true,
    });
    if (tagSearch?.data?.[0]) {
      const currentLead = await this.helpers.httpRequest({
        method: 'GET',
        url: `${API_URL}/leads/${leadId}`,
        headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
        json: true,
      });
      const currentTags = currentLead.tags || [];
      if (!currentTags.some(t => t.id === tagSearch.data[0].id)) {
        await this.helpers.httpRequest({
          method: 'PATCH',
          url: `${API_URL}/leads/${leadId}`,
          headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}`, 'Content-Type': 'application/json' },
          body: { tags: [...currentTags.map(t => ({ id: t.id })), { id: tagSearch.data[0].id }] },
          json: true,
        });
      }
    }
  } catch (e) {
    // Ignora erro de tag
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
