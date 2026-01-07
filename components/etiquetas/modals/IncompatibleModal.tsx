'use client';

import { MappingTemplate } from '../types';

interface IncompatibleModalProps {
  isOpen: boolean;
  template: MappingTemplate | null;
  onCancel: () => void;
  onCreateNew: () => void;
}

export default function IncompatibleModal({
  isOpen,
  template,
  onCancel,
  onCreateNew,
}: IncompatibleModalProps) {
  if (!isOpen || !template) return null;

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
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '450px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
      >
        <h3
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '1.125rem',
            fontWeight: 600,
            color: '#314158',
          }}
        >
          CSV Incompatível
        </h3>
        <p
          style={{
            margin: '0 0 0.5rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          O CSV importado não é compatível com o modelo <strong>{template.name}</strong>.
        </p>
        <p
          style={{
            margin: '0 0 1.5rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Algumas colunas esperadas não foram encontradas. Deseja criar um novo mapeamento?
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
            onClick={onCreateNew}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: '#3B82F6',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Criar Novo Mapeamento
          </button>
        </div>
      </div>
    </div>
  );
}
