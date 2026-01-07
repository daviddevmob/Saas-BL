'use client';

import { PhysicalSale } from '../types';

interface MergeWarningModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pendingMerge: PhysicalSale[];
}

export default function MergeWarningModal({
  isOpen,
  onCancel,
  onConfirm,
  pendingMerge,
}: MergeWarningModalProps) {
  if (!isOpen) return null;

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
      onClick={onCancel}
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
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: '#DC2626',
          }}
        >
          ⚠️ Atenção: Emails Diferentes!
        </h3>

        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '0.5rem',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <p
            style={{
              margin: '0 0 0.75rem 0',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#314158',
            }}
          >
            Você está tentando mesclar pedidos de <strong>clientes com emails diferentes</strong>:
          </p>
          <ul
            style={{
              margin: '0',
              paddingLeft: '1.25rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.8rem',
              color: '#64748B',
            }}
          >
            {pendingMerge.map((sale, idx) => (
              <li key={idx} style={{ marginBottom: '0.25rem' }}>
                <strong>{sale.name}</strong> - {sale.email}
                <br />
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{sale.productName}</span>
              </li>
            ))}
          </ul>
        </div>

        <p
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#DC2626',
            fontWeight: 500,
          }}
        >
          Deseja continuar mesmo assim?
        </p>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onCancel}
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
              backgroundColor: '#DC2626',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Mesclar Mesmo Assim
          </button>
        </div>
      </div>
    </div>
  );
}
