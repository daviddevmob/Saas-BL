'use client';

import { PhysicalSale } from '../types';

interface MergeStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUseExisting: () => void;
  onGenerateNew: () => void;
  pendingMerge: PhysicalSale[];
}

export default function MergeStatusModal({
  isOpen,
  onClose,
  onUseExisting,
  onGenerateNew,
  pendingMerge,
}: MergeStatusModalProps) {
  if (!isOpen || pendingMerge.length === 0) return null;

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
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: '0 0 0.5rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: '#1E293B',
          }}
        >
          Mesclar pedidos com status diferentes
        </h3>

        <p
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Você está mesclando pedidos onde alguns já têm etiqueta gerada e outros ainda estão pendentes.
        </p>

        {/* Lista de pedidos */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            marginBottom: '1rem',
            maxHeight: '150px',
            overflow: 'auto',
          }}
        >
          {pendingMerge.map((sale, idx) => (
            <div key={idx} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: idx < pendingMerge.length - 1 ? '0.5rem' : 0,
              fontSize: '0.8rem',
              fontFamily: 'var(--font-inter)',
            }}>
              <span style={{
                padding: '0.125rem 0.375rem',
                borderRadius: '0.25rem',
                fontSize: '0.7rem',
                fontWeight: 500,
                backgroundColor: sale.etiquetaStatus === 'generated' ? '#DCFCE7' :
                                sale.etiquetaStatus === 'partial' ? '#FEF3C7' : '#F1F5F9',
                color: sale.etiquetaStatus === 'generated' ? '#166534' :
                       sale.etiquetaStatus === 'partial' ? '#92400E' : '#64748B',
              }}>
                {sale.etiquetaStatus === 'generated' ? 'Gerado' :
                 sale.etiquetaStatus === 'partial' ? 'Parcial' : 'Pendente'}
              </span>
              <span style={{ color: '#1E293B' }}>{sale.productName}</span>
            </div>
          ))}
        </div>

        {/* Opções */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {/* Opção 1: Usar etiqueta existente */}
          <button
            onClick={onUseExisting}
            style={{
              width: '100%',
              padding: '0.875rem 1rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              textAlign: 'left',
              color: '#1E293B',
              backgroundColor: '#F0FDF4',
              border: '2px solid #22C55E',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              Usar etiqueta já gerada
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Os pedidos pendentes serão associados à etiqueta existente.
              Todos os produtos irão no mesmo envio.
            </div>
          </button>

          {/* Opção 2: Criar novo pedido pendente */}
          <button
            onClick={onGenerateNew}
            style={{
              width: '100%',
              padding: '0.875rem 1rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              textAlign: 'left',
              color: '#1E293B',
              backgroundColor: '#FFF7ED',
              border: '2px solid #F97316',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              Criar novo pedido mesclado
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
              A etiqueta existente será desconsiderada. Você poderá gerar
              uma nova etiqueta para todos os produtos juntos.
            </div>
          </button>
        </div>

        {/* Botão Cancelar */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
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
      </div>
    </div>
  );
}
