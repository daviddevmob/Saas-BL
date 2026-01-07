'use client';

import { PhysicalSale } from '../types';
import { DEFAULT_SERVICO_ECT, SERVICOS_ECT } from '../constants';

interface ServiceConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedServicoEct: string;
  pendingGeneration: PhysicalSale[];
  ordemPrioridade: 'antigos' | 'novos';
  setOrdemPrioridade: (value: 'antigos' | 'novos') => void;
  observacaoGeral: string;
  setObservacaoGeral: (value: string) => void;
  envioObservacoes: Record<string, string>;
  setEnvioObservacoes: (value: Record<string, string>) => void;
}

function getServicoName(code: string): string {
  const servico = SERVICOS_ECT.find(s => s.code === code);
  return servico ? servico.name : code;
}

export default function ServiceConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  selectedServicoEct,
  pendingGeneration,
  ordemPrioridade,
  setOrdemPrioridade,
  observacaoGeral,
  setObservacaoGeral,
  envioObservacoes,
  setEnvioObservacoes,
}: ServiceConfirmModalProps) {
  if (!isOpen) return null;

  const handleClose = () => {
    setEnvioObservacoes({});
    setOrdemPrioridade('antigos');
    setObservacaoGeral('');
    onClose();
  };

  const isDefaultService = selectedServicoEct === DEFAULT_SERVICO_ECT;

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
        zIndex: 9999,
        padding: '1rem',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '550px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: isDefaultService ? '#F97316' : '#DC2626',
          }}
        >
          {isDefaultService
            ? 'Confirmar Geração de Etiquetas'
            : '⚠️ Atenção: Serviço Diferente!'
          }
        </h3>

        <div
          style={{
            backgroundColor: isDefaultService ? '#FFF7ED' : '#FEF2F2',
            border: `1px solid ${isDefaultService ? '#FDBA74' : '#FECACA'}`,
            borderRadius: '0.5rem',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <p
            style={{
              margin: '0 0 0.5rem 0',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Serviço selecionado:
          </p>
          <p
            style={{
              margin: '0 0 1rem 0',
              fontFamily: 'var(--font-inter)',
              fontSize: '1rem',
              fontWeight: 600,
              color: isDefaultService ? '#F97316' : '#DC2626',
            }}
          >
            {getServicoName(selectedServicoEct)}
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#314158',
            }}
          >
            <strong>{pendingGeneration.length}</strong> etiqueta{pendingGeneration.length !== 1 ? 's' : ''} será{pendingGeneration.length !== 1 ? 'ão' : ''} gerada{pendingGeneration.length !== 1 ? 's' : ''}.
          </p>
        </div>

        {!isDefaultService && (
          <p
            style={{
              margin: '0 0 1rem 0',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#DC2626',
              fontWeight: 500,
            }}
          >
            Você está gerando etiquetas com um serviço diferente do padrão (IMPRESSO Normal Módico). Confirma?
          </p>
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

        {/* Observações por Pedido */}
        <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#92400E' }}>
            📝 OBSERVAÇÕES POR PEDIDO
          </p>
          <p style={{ margin: '0.25rem 0 0.75rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
            Informe o que vai em cada pedido (aparece na mensagem do admin)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
            {pendingGeneration.map(sale => (
              <div key={sale.transaction} style={{ backgroundColor: '#FFFBEB', borderRadius: '0.375rem', padding: '0.5rem' }}>
                <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#78350F', fontWeight: 500 }}>
                  {sale.name}
                  {sale.enviosTotal > 1 && (
                    <span style={{ marginLeft: '0.5rem', color: '#B45309' }}>
                      (Envio {sale.enviosRealizados + 1}/{sale.enviosTotal})
                    </span>
                  )}
                </p>
                <input
                  type="text"
                  value={envioObservacoes[sale.transaction] || ''}
                  onChange={(e) => setEnvioObservacoes({ ...envioObservacoes, [sale.transaction]: e.target.value })}
                  placeholder={sale.enviosTotal > 1 ? "O que vai neste envio?" : "Observação (opcional)"}
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
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: isDefaultService ? '#F97316' : '#DC2626',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Confirmar e Gerar
          </button>
        </div>
      </div>
    </div>
  );
}
