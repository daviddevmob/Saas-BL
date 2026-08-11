export interface DestinatarioData {
  nome: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  documento: string;
}

// Mapeamento de nomes de estados brasileiros (e variações sem acento) para siglas UF
const BRAZIL_STATES: Record<string, string> = {
  'ACRE': 'AC',
  'ALAGOAS': 'AL',
  'AMAPA': 'AP',
  'AMAZONAS': 'AM',
  'BAHIA': 'BA',
  'CEARA': 'CE',
  'DISTRITO FEDERAL': 'DF',
  'ESPIRITO SANTO': 'ES',
  'GOIAS': 'GO',
  'MARANHAO': 'MA',
  'MATO GROSSO': 'MT',
  'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG',
  'PARA': 'PA',
  'PARAIBA': 'PB',
  'PARANA': 'PR',
  'PERNAMBUCO': 'PE',
  'PIAUI': 'PI',
  'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN',
  'RIO GRANDE DO SUL': 'RS',
  'RONDONIA': 'RO',
  'RORAIMA': 'RR',
  'SANTA CATARINA': 'SC',
  'SAO PAULO': 'SP',
  'SERGIPE': 'SE',
  'TOCANTINS': 'TO',
};

const VALID_UFS = new Set(Object.values(BRAZIL_STATES));

// Placeholders comuns que devem ser ignorados / tratados como vazios
const PLACEHOLDERS = new Set([
  'NULL',
  'UNDEFINED',
  'NAN',
  'N/A',
  'NA',
  'NONE',
  'NENHUM',
  'SEM COMPLEMENTO',
  'NAO TEM',
  'NAO POSSUI',
  'SEM NUMERO',
  'SEM N',
  'S/N',
  'SN',
  'S.N.',
  '-',
  '.',
  '--',
  '0',
  '00',
  '000',
]);

/**
 * Sanitiza e normaliza textos para o padrão aceito pela ViPP e Correios:
 * - Remove acentos e caracteres Unicode diacríticos (ex: "ç" -> "C", "ã" -> "A", "é" -> "E", "Monções" -> "MONCOES")
 * - Converte símbolos ordinais comuns (ex: "º", "°" -> "", "ª" -> "A", "&" -> "E")
 * - Remove caracteres especiais que quebram a impressão térmica ou ZPL dos Correios
 * - Remove espaços duplicados e pontuações órfãs
 * - Converte para MAIÚSCULAS (padrão oficial Correios)
 * - Limita o tamanho máximo se especificado
 */
export function sanitizeVippText(text?: unknown, maxLength?: number): string {
  if (text === null || text === undefined) return '';

  let sanitized = '';
  try {
    sanitized = String(text)
      // Decompõe caracteres acentuados (NFD) para isolar diacríticos
      .normalize('NFD')
      // Remove diacríticos (acentos, til, cedilha, trema, etc.)
      .replace(/[\u0300-\u036f]/g, '')
      // Trata ordinais e símbolos comuns
      .replace(/[º°˚]/g, '')
      .replace(/ª/g, 'A')
      .replace(/&/g, 'E')
      .replace(/['"`]/g, ' ')
      // Remove caracteres de controle ou caracteres especiais inválidos
      .replace(/[^a-zA-Z0-9\s,.\-\/]/g, '')
      // Substitui múltiplos espaços por um único espaço
      .replace(/\s+/g, ' ')
      .trim()
      // Converte para maiúsculas
      .toUpperCase();

    // Limpa pontuações órfãs nas extremidades (ex: "- RUA TESTE ,")
    sanitized = sanitized.replace(/^[,.\-\/\s]+|[,.\-\/\s]+$/g, '').trim();

    if (maxLength && maxLength > 0 && sanitized.length > maxLength) {
      sanitized = sanitized.slice(0, maxLength).trim();
      // Limpa pontuação deixada no final após corte
      sanitized = sanitized.replace(/^[,.\-\/\s]+|[,.\-\/\s]+$/g, '').trim();
    }
  } catch {
    return '';
  }

  return sanitized;
}

/**
 * Normaliza a sigla da UF a partir de texto (nome completo do estado, sigla com sufixo ou formato sujo)
 */
export function normalizeUF(rawUf?: unknown, fallbackFromCidade?: string): string {
  try {
    let clean = sanitizeVippText(rawUf);

    // Se veio vazio ou inválido, tenta extrair da cidade se contiver "- SP" ou "/CE"
    if ((!clean || !VALID_UFS.has(clean)) && fallbackFromCidade) {
      const cidadeClean = sanitizeVippText(fallbackFromCidade);
      const match = cidadeClean.match(/[\-\/]\s*([A-Z]{2})$/);
      if (match && VALID_UFS.has(match[1])) {
        return match[1];
      }
    }

    if (!clean) return '';

    // Se já é uma sigla válida de 2 letras
    if (VALID_UFS.has(clean)) {
      return clean;
    }

    // Se veio algo como "SP - BRASIL" ou "/SP"
    const twoLetterMatch = clean.match(/\b([A-Z]{2})\b/);
    if (twoLetterMatch && VALID_UFS.has(twoLetterMatch[1])) {
      return twoLetterMatch[1];
    }

    // Se veio o nome por extenso (ex: "SAO PAULO", "CEARA", "RIO DE JANEIRO")
    if (BRAZIL_STATES[clean]) {
      return BRAZIL_STATES[clean];
    }

    // Fallback: primeiras 2 letras se não encontrado
    return clean.slice(0, 2);
  } catch {
    return '';
  }
}

/**
 * Normaliza o nome da Cidade removendo sufixos de UF (ex: "SÃO PAULO - SP" -> "SAO PAULO")
 */
export function normalizeCidade(rawCidade?: unknown): string {
  try {
    let clean = sanitizeVippText(rawCidade, 50);
    if (!clean) return '';

    // Remove sufixo de estado se presente no final (ex: "FORTALEZA - CE", "SAO PAULO/SP", "RECIFE - PE")
    clean = clean.replace(/[\-\/]\s*[A-Z]{2}$/i, '').trim();
    clean = clean.replace(/^[,.\-\/\s]+|[,.\-\/\s]+$/g, '').trim();

    return sanitizeVippText(clean, 30);
  } catch {
    return '';
  }
}

/**
 * Normaliza o número e separa inteligentemente complementos acidentalmente digitados no campo de número
 */
export function normalizeNumeroEComplemento(
  rawNumero?: unknown,
  rawComplemento?: unknown
): { numero: string; complemento: string } {
  try {
    let cleanNum = sanitizeVippText(rawNumero);
    let cleanComp = sanitizeVippText(rawComplemento, 30);

    // Se complemento for placeholder (ex: "Nenhum", "Sem complemento", "-"), limpa
    if (PLACEHOLDERS.has(cleanComp)) {
      cleanComp = '';
    }

    // Se número for vazio ou placeholder, define como 'S/N'
    if (!cleanNum || PLACEHOLDERS.has(cleanNum)) {
      return { numero: 'S/N', complemento: cleanComp };
    }

    // Caso o usuário tenha digitado "1051 APTO 221 A" ou "123 - BL A" no campo de número:
    // Tenta extrair a parte numérica inicial e mover o resto para complemento se o número for longo (> 6 caracteres)
    if (cleanNum.length > 6) {
      const match = cleanNum.match(/^(\d{1,6})\s*[\-\/,\s]\s*(.+)$/);
      if (match) {
        const extractedNum = match[1];
        const extraText = match[2].trim();

        cleanNum = extractedNum;

        // Se complemento estiver vazio ou pequeno, combina
        if (!cleanComp) {
          cleanComp = sanitizeVippText(extraText, 30);
        } else if (!cleanComp.includes(extraText)) {
          cleanComp = sanitizeVippText(`${extraText} ${cleanComp}`, 30);
        }
      } else {
        // Se não conseguiu separar por regex, corta com segurança no limite de 6
        cleanNum = cleanNum.slice(0, 6).trim();
      }
    }

    return {
      numero: cleanNum || 'S/N',
      complemento: cleanComp,
    };
  } catch {
    return { numero: 'S/N', complemento: '' };
  }
}

/**
 * Normaliza e valida o CEP para 8 dígitos numéricos (com preenchimento de zero à esquerda se tiver 7 dígitos)
 */
export function normalizeCEP(rawCep?: unknown): string {
  try {
    if (!rawCep) return '';
    let digits = String(rawCep).replace(/\D/g, '');

    // Se tiver 7 dígitos (comum em SP onde o zero inicial é engolido em planilhas Excel/CSV)
    if (digits.length === 7) {
      digits = '0' + digits;
    }

    return digits.slice(0, 8);
  } catch {
    return '';
  }
}

/**
 * Normaliza o telefone para apenas dígitos, removendo zero à esquerda do DDD
 */
export function normalizeTelefone(rawTel?: unknown): string {
  try {
    if (!rawTel) return '';
    let digits = String(rawTel).replace(/\D/g, '');

    // Se começa com 0 e tem 11 ou 12 dígitos (ex: 011987654321), remove o zero inicial
    if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
      digits = digits.slice(1);
    }

    return digits;
  } catch {
    return '';
  }
}

/**
 * Sanitiza e valida o objeto completo do destinatário segundo os limites dos Correios/ViPP com tratamento avançado de erros
 */
export function sanitizeVippDestinatario(dest: Partial<DestinatarioData> | null | undefined): DestinatarioData {
  try {
    if (!dest || typeof dest !== 'object') {
      return {
        nome: 'DESTINATARIO',
        logradouro: '',
        numero: 'S/N',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        cep: '',
        telefone: '',
        email: '',
        documento: '',
      };
    }

    // 1. Trata número e complemento de forma combinada e inteligente
    const { numero: cleanNumero, complemento: cleanComplemento } = normalizeNumeroEComplemento(
      dest.numero,
      dest.complemento
    );

    // 2. Trata Cidade e UF com detecção cruzada
    const cleanCidade = normalizeCidade(dest.cidade);
    const cleanUf = normalizeUF(dest.uf, typeof dest.cidade === 'string' ? dest.cidade : undefined);

    // 3. Trata Bairro (evita placeholders)
    let cleanBairro = sanitizeVippText(dest.bairro, 30);
    if (PLACEHOLDERS.has(cleanBairro)) {
      cleanBairro = '';
    }

    // 4. Trata Logradouro
    const cleanLogradouro = sanitizeVippText(dest.logradouro, 50);

    // 5. Trata Nome
    const cleanNome = sanitizeVippText(dest.nome, 50) || 'DESTINATARIO';

    // 6. Trata CEP, Telefone, Documento e Email
    const cleanCep = normalizeCEP(dest.cep);
    const cleanTelefone = normalizeTelefone(dest.telefone);
    const cleanDocumento = (dest.documento ? String(dest.documento).replace(/\D/g, '') : '').slice(0, 14);
    const cleanEmail = (dest.email ? String(dest.email) : '').trim().toLowerCase().slice(0, 60);

    return {
      nome: cleanNome,
      logradouro: cleanLogradouro,
      numero: cleanNumero,
      complemento: cleanComplemento,
      bairro: cleanBairro,
      cidade: cleanCidade,
      uf: cleanUf,
      cep: cleanCep,
      telefone: cleanTelefone,
      email: cleanEmail,
      documento: cleanDocumento,
    };
  } catch (error) {
    console.error('[ViPP Sanitizer] Erro ao sanitizar destinatário:', error);
    // Retorno seguro padrão em caso de exceção crítica
    return {
      nome: sanitizeVippText(dest?.nome, 50) || 'DESTINATARIO',
      logradouro: sanitizeVippText(dest?.logradouro, 50),
      numero: 'S/N',
      complemento: '',
      bairro: sanitizeVippText(dest?.bairro, 30),
      cidade: sanitizeVippText(dest?.cidade, 30),
      uf: sanitizeVippText(dest?.uf, 2),
      cep: normalizeCEP(dest?.cep),
      telefone: normalizeTelefone(dest?.telefone),
      email: '',
      documento: '',
    };
  }
}
