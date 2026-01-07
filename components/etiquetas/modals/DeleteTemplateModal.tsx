'use client';

import { MappingTemplate } from '../types';

interface DeleteTemplateModalProps {
  isOpen: boolean;
  template: MappingTemplate | null;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteTemplateModal({
  isOpen,
  template,
  confirmText,
  onConfirmTextChange,
  onCancel,
  onConfirm,
}: DeleteTemplateModalProps) {
  if (!isOpen || !template) return null;

  const isConfirmValid = confirmText === template.name;

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
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '400px',
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
          Excluir Modelo
        </h3>
        <p
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Esta ação não pode ser desfeita. Para confirmar, digite o nome do modelo:
        </p>
        <p
          style={{
            margin: '0 0 0.75rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#314158',
            backgroundColor: '#F1F5F9',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
          }}
        >
          {template.name}
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => onConfirmTextChange(e.target.value)}
          placeholder="Digite o nome do modelo..."
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            backgroundColor: '#FFFFFF',
            color: '#1F2937',
            border: '1px solid #E2E8F0',
            borderRadius: '0.375rem',
            outline: 'none',
            marginBottom: '1rem',
            boxSizing: 'border-box',
          }}
        />
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
            disabled={!isConfirmValid}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: isConfirmValid ? '#DC2626' : '#9CA3AF',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: isConfirmValid ? 'pointer' : 'not-allowed',
            }}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
