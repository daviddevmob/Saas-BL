'use client';

import { PhysicalSale } from '../types';

interface GenerationConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  // Confirmação de produção
  needsProductionConfirm: boolean;
  confirmEtiquetasText: string;
  setConfirmEtiquetasText: (value: string) => void;
  // Confirmação de cliente
  needsClientConfirm: boolean;
  confirmEnviarText: string;
  setConfirmEnviarText: (value: string) => void;
  // Opções de envio
  ordemPrioridade: 'antigos' | 'novos';
  setOrdemPrioridade: (value: 'antigos' | 'novos') => void;
  observacaoGeral: string;
  setObservacaoGeral: (value: string) => void;
  // Envios parciais
  envioObservacoes: Record<string, string>;
  setEnvioObservacoes: (value: Record<string, string>) => void;
  pendingGeneration: PhysicalSale[];
  // Status
  sendToN8n: boolean;
  clientPhoneOverride: string;
  isConfirmationValid: () => boolean;
}

export default function GenerationConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  needsProductionConfirm,
  confirmEtiquetasText,
  setConfirmEtiquetasText,
  needsClientConfirm,
  confirmEnviarText,
  setConfirmEnviarText,
  ordemPrioridade,
  setOrdemPrioridade,
  observacaoGeral,
  setObservacaoGeral,
  envioObservacoes,
  setEnvioObservacoes,
  pendingGeneration,
  sendToN8n,
  clientPhoneOverride,
  isConfirmationValid,
}: GenerationConfirmModalProps) {
  if (!isOpen) return null;

  const handleClose = () => {
    setConfirmEtiquetasText('');
    setConfirmEnviarText('');
    setEnvioObservacoes({});
    setOrdemPrioridade('antigos');
    setObservacaoGeral('');
    onClose();
  };

  const parcialSales = pendingGeneration.filter(s => s.enviosTotal > 1);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: '#DC2626',
          }}
        >
          ⚠️ Confirmação Necessária
        </h3>

        {/* Aviso de Produção */}
        {needsProductionConfirm && (
          <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#991B1B' }}>
              🏭 MODO PRODUÇÃO
            </p>
            <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#991B1B' }}>
              Etiquetas reais serão geradas nos Correios. Esta ação não pode ser desfeita.
            </p>
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                Digite <strong>&quot;etiquetas&quot;</strong> para confirmar:
              </p>
              <input
                type="text"
                value={confirmEtiquetasText}
                onChange={(e) => setConfirmEtiquetasText(e.target.value)}
                placeholder="etiquetas"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#1E293B',
                  backgroundColor: confirmEtiquetasText.toLowerCase() === 'etiquetas' ? '#D1FAE5' : '#FFF',
                  border: confirmEtiquetasText.toLowerCase() === 'etiquetas' ? '1px solid #10B981' : '1px solid #E2E8F0',
                  borderRadius: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Aviso de Notificação Cliente */}
        {needsClientConfirm && (
          <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E40AF' }}>
              📱 NOTIFICAÇÃO AO CLIENTE
            </p>
            <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#1E40AF' }}>
              Os clientes receberão mensagem no WhatsApp com o código de rastreio.
            </p>
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                Digite <strong>&quot;enviar&quot;</strong> para confirmar:
              </p>
              <input
                type="text"
                value={confirmEnviarText}
                onChange={(e) => setConfirmEnviarText(e.target.value)}
                placeholder="enviar"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.875rem',
                  color: '#1E293B',
                  backgroundColor: confirmEnviarText.toLowerCase() === 'enviar' ? '#DBEAFE' : '#FFF',
                  border: confirmEnviarText.toLowerCase() === 'enviar' ? '1px solid #3B82F6' : '1px solid #E2E8F0',
                  borderRadius: '0.5rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Opções de Envio */}
        <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#166534' }}>
            ⚙️ OPÇÕES DE ENVIO
          </p>

          {/* Ordem de prioridade */}
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
              Ordem de prioridade:
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setOrdemPrioridade('antigos')}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: ordemPrioridade === 'antigos' ? '#FFF' : '#166534',
                  backgroundColor: ordemPrioridade === 'antigos' ? '#16A34A' : '#DCFCE7',
                  border: ordemPrioridade === 'antigos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                📅 Mais antigos primeiro
              </button>
              <button
                type="button"
                onClick={() => setOrdemPrioridade('novos')}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: ordemPrioridade === 'novos' ? '#FFF' : '#166534',
                  backgroundColor: ordemPrioridade === 'novos' ? '#16A34A' : '#DCFCE7',
                  border: ordemPrioridade === 'novos' ? '1px solid #16A34A' : '1px solid #86EFAC',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                🆕 Mais novos primeiro
              </button>
            </div>
          </div>

          {/* Observação geral */}
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#166534' }}>
              Observação geral (opcional):
            </p>
            <textarea
              value={observacaoGeral}
              onChange={(e) => setObservacaoGeral(e.target.value)}
              placeholder="Ex: Lote de sexta-feira, prioridade alta..."
              rows={2}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#1E293B',
                backgroundColor: '#FFF',
                border: '1px solid #86EFAC',
                borderRadius: '0.375rem',
                boxSizing: 'border-box',
                resize: 'none',
              }}
            />
          </div>
        </div>

        {/* Seção de Envios Parciais */}
        {parcialSales.length > 0 && (
          <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#92400E' }}>
              📦 ENVIOS PARCIAIS
            </p>
            <p style={{ margin: '0.25rem 0 0.75rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
              Informe o que vai neste envio (ex: &quot;camiseta&quot;, &quot;2 unidades&quot;)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {parcialSales.map(sale => (
                <div key={sale.transaction} style={{ backgroundColor: '#FFFBEB', borderRadius: '0.375rem', padding: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#78350F', fontWeight: 500 }}>
                    {sale.name} - Envio {sale.enviosRealizados + 1}/{sale.enviosTotal}
                  </p>
                  <input
                    type="text"
                    value={envioObservacoes[sale.transaction] || ''}
                    onChange={(e) => setEnvioObservacoes({ ...envioObservacoes, [sale.transaction]: e.target.value })}
                    placeholder="O que vai neste envio?"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.75rem',
                      color: '#1E293B',
                      backgroundColor: '#FFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '0.375rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resumo */}
        <div style={{ backgroundColor: '#F8FAFC', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
            <strong>{pendingGeneration.length}</strong> etiqueta(s) serão geradas
            {sendToN8n && <span> • Webhook ativo</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleClose}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#64748B',
              backgroundColor: '#F1F5F9',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!isConfirmationValid()}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: isConfirmationValid() ? '#DC2626' : '#9CA3AF',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: isConfirmationValid() ? 'pointer' : 'not-allowed',
            }}
          >
            Confirmar Geração
          </button>
        </div>
      </div>
    </div>
  );
}
