// Código para o Node "Process Hotmart Webhook" no n8n
// Copie e substitua o código atual

const HOTTOK = 'SSF4gejPRrOXZFefyrZzy2wm2OJwMbf4fc7e40-58f3-4845-a233-d7293b87b299';
const DATACRAZY_TOKEN = 'dc_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MzcyODRjYTc3MWNkZmY4MGJjMjc2ZiIsInRlbmFudElkIjoiNjdmN2E5ODAtODk0YS00Nzk5LThjMDMtZTYyNGY5ZWRhNTY3IiwibmFtZSI6Ik44biAtIGR2IiwiaWF0IjoxNzY1MjIyNDc2LCJleHAiOjE5MjQ5MTYzOTl9.eii1aUDplkPh1Y2Rt5W0EhTqaQ4uvr2ClV0_OBOSvDU';
const API_URL = 'https://api.g1.datacrazy.io/api/v1';

// Stage para compras aprovadas
const STAGE_APPROVED = '0c2bf45f-1c4b-4730-b02c-286b7c018f29';

const input = $input.first().json;
const body = input.body || input;

// 1. Validar Hottok
const receivedHottok = body.hottok || input.headers?.['x-hotmart-hottok'];
if (receivedHottok !== HOTTOK) {
  return [{ json: { status: 'error', reason: 'Invalid hottok', received: receivedHottok } }];
}

// 2. Extrair dados do webhook
const event = body.event || body.status;
const data = body.data || body;

// Só processar compras aprovadas/completas
if (event !== 'PURCHASE_COMPLETE' && event !== 'PURCHASE_APPROVED') {
  return [{ json: { status: 'ignored', reason: 'Not a purchase event', event } }];
}

const email = data.buyer?.email;
const name = data.buyer?.name;
let phone = data.buyer?.phone;

// --- FIX: Corrigir DDI Brasil ---
if (phone) {
  // Remover caracteres não numéricos
  phone = phone.replace(/\D/g, '');
  
  // Se tiver 10 ou 11 dígitos (DDD + Número), adicionar 55
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
}
// --------------------------------

const productName = data.product?.name;
const transactionId = data.purchase?.transaction || data.transaction;
const saleValue = data.purchase?.price?.value || data.purchase?.original_offer_price?.value || 0;

if (!email) {
  return [{ json: { status: 'error', reason: 'No email in payload', event } }];
}

try {
  // 3. Buscar/Criar Lead
  const leadData = await this.helpers.httpRequest({
    method: 'GET',
    url: `${API_URL}/leads?search=${encodeURIComponent(email)}`,
    headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
    json: true
  });
  
  let leadId;
  let leadTags = [];
  
  if (leadData.count === 0) {
    const newLead = await this.helpers.httpRequest({
      method: 'POST',
      url: `${API_URL}/leads`,
      headers: { 
        'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: { 
        name, 
        email, 
        phone: phone || undefined,
        source: 'Hotmart Webhook' 
      },
      json: true
    });
    leadId = newLead.id;
  } else {
    leadId = leadData.data[0].id;
    leadTags = leadData.data[0].tags || [];
    
    // Atualizar telefone se não existir ou se o novo for mais completo
    if (phone && (!leadData.data[0].phone || leadData.data[0].phone.length < phone.length)) {
       await this.helpers.httpRequest({
          method: 'PATCH',
          url: `${API_URL}/leads/${leadId}`,
          headers: { 
            'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: { phone },
          json: true
        });
    }
  }
  
  // 4. Buscar/Adicionar Tag do Produto
  if (productName) {
    const tagData = await this.helpers.httpRequest({
      method: 'GET',
      url: `${API_URL}/tags?search=${encodeURIComponent(productName)}`,
      headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
      json: true
    });
    
    if (tagData.data && tagData.data[0]) {
      const tagId = tagData.data[0].id;
      const hasTag = leadTags.some(t => t.id === tagId);
      
      if (!hasTag) {
        const allTagIds = [...leadTags.map(t => ({ id: t.id })), { id: tagId }];
        await this.helpers.httpRequest({
          method: 'PATCH',
          url: `${API_URL}/leads/${leadId}`,
          headers: { 
            'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: { tags: allTagIds },
          json: true
        });
      }
    }
  }
  
  // 5. Buscar businesses do lead para verificar duplicidade
  const leadBizData = await this.helpers.httpRequest({
    method: 'GET',
    url: `${API_URL}/leads/${leadId}/businesses`,
    headers: { 'Authorization': `Bearer ${DATACRAZY_TOKEN}` },
    json: true
  });
  
  const existingBiz = leadBizData?.data?.find(b => b.externalId === transactionId);
  
  if (!existingBiz) {
    // Criar novo Business
    await this.helpers.httpRequest({
      method: 'POST',
      url: `${API_URL}/businesses`,
      headers: { 
        'Authorization': `Bearer ${DATACRAZY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: {
        leadId,
        stageId: STAGE_APPROVED,
        externalId: transactionId,
        total: saleValue
      },
      json: true
    });
    return [{ json: { status: 'created', event, email, name, transactionId, value: saleValue } }];
  } else {
    return [{ json: { status: 'exists', event, email, name, transactionId, value: saleValue } }];
  }
  
} catch (e) {
  return [{ json: { status: 'error', event, email, error: e.message } }];
}
