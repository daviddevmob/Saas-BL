'use client';

import { PhysicalSale } from '../types';

interface MergeDetailsModalProps {
  sale: PhysicalSale | null;
  onClose: () => void;
  onUnmerge: (transaction: string) => void;
}

export default function MergeDetailsModal({
  sale,
  onClose,
  onUnmerge,
}: MergeDetailsModalProps) {
  if (!sale) return null;

  const handleUnmerge = () => {
    onUnmerge(sale.transaction);
    onClose();
  };

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
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#9333EA',
              color: 'white',
              borderRadius: '0.5rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 16v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
                <path d="M12 12h8a2 2 0 002-2V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v8z" />
              </svg>
              {sale.mergedTransactions?.length || 0} Pedidos Mesclados
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: '#64748B',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ×
          </button>
        </div>

        {/* Destinatário Info */}
        <div style={{
          backgroundColor: '#F5F3FF',
          border: '1px solid #DDD6FE',
          borderRadius: '0.75rem',
          padding: '1rem',
          marginBottom: '1rem',
        }}>
          <h4 style={{
            margin: '0 0 0.75rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#7C3AED',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Destinatário
          </h4>
          <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.9375rem', fontWeight: 600, color: '#1E1B4B' }}>
            {sale.name}
          </p>
          <p style={{ margin: '0 0 0.25rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
            {sale.email}
          </p>
          {sale.phone && (
            <p style={{ margin: '0 0 0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
              {sale.phone}
            </p>
          )}
          <p style={{ margin: '0', fontFamily: 'var(--font-inter)', fontSize: '0.8125rem', color: '#6B7280' }}>
            {sale.address}, {sale.number}
            {sale.complement && ` - ${sale.complement}`}
            <br />
            {sale.neighborhood} - {sale.city}/{sale.state} - CEP: {sale.zip}
          </p>
        </div>

        {/* Pedidos Originais */}
        <h4 style={{
          margin: '0 0 0.75rem 0',
          fontFamily: 'var(--font-inter)',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#7C3AED',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Pedidos Originais
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {sale.mergedOriginalSales?.map((original, idx) => (
            <div
              key={original.transaction}
              style={{
                backgroundColor: '#FAFAFA',
                border: '1px solid #E5E7EB',
                borderRadius: '0.75rem',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#9333EA',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}>
                  Pedido #{idx + 1}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: '#6B7280',
                  backgroundColor: '#F3F4F6',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                }}>
                  {original.transaction}
                </span>
              </div>
              <p style={{
                margin: '0 0 0.25rem 0',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#1F2937',
              }}>
                {original.productName}
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                  <strong>Valor:</strong> {original.totalPrice}
                </span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                  <strong>Data:</strong> {original.saleDate?.split(' ')[0] || '-'}
                </span>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#6B7280' }}>
                  <strong>Documento:</strong> {original.document || '-'}
                </span>
              </div>
            </div>
          )) || sale.mergedTransactions?.map((id, idx) => (
            <div
              key={id}
              style={{
                backgroundColor: '#FAFAFA',
                border: '1px solid #E5E7EB',
                borderRadius: '0.75rem',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#9333EA',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}>
                  #{idx + 1}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: '#374151' }}>
                  {id}
                </span>
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#1F2937' }}>
                {sale.mergedProductNames?.[idx] || '-'}
              </p>
            </div>
          ))}
        </div>

        {/* Botões */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleUnmerge}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#DC2626',
              backgroundColor: '#FEE2E2',
              border: '1px solid #FECACA',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Desfazer Mesclagem
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: '#9333EA',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
