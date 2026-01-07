'use client';

import { MappingTemplate } from '../types';
import { AVAILABLE_LOGOS } from '../constants';

interface EditTemplateModalProps {
  isOpen: boolean;
  template: MappingTemplate | null;
  editName: string;
  editLogo: string;
  onNameChange: (value: string) => void;
  onLogoChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}

export default function EditTemplateModal({
  isOpen,
  template,
  editName,
  editLogo,
  onNameChange,
  onLogoChange,
  onCancel,
  onConfirm,
  onDelete,
}: EditTemplateModalProps) {
  if (!isOpen || !template) return null;

  const isValid = editName.trim().length > 0;

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
          Editar Modelo
        </h3>

        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#314158',
              marginBottom: '0.375rem',
            }}
          >
            Nome do Modelo:
          </label>
          <input
            type="text"
            value={editName}
            onChange={(e) => onNameChange(e.target.value)}
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
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#314158',
              marginBottom: '0.375rem',
            }}
          >
            Logo (opcional):
          </label>
          <select
            value={editLogo}
            onChange={(e) => onLogoChange(e.target.value)}
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
            }}
          >
            <option value="">Sem logo</option>
            {AVAILABLE_LOGOS.map((logo) => (
              <option key={logo.name} value={logo.name}>
                {logo.label}
              </option>
            ))}
          </select>
        </div>

        {/* Botão Excluir */}
        <button
          onClick={onDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            width: '100%',
            padding: '0.5rem',
            marginBottom: '1rem',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.8rem',
            fontWeight: 500,
            color: '#DC2626',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#FEE2E2';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#FEF2F2';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Excluir modelo
        </button>

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
            disabled={!isValid}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: isValid ? '#3B82F6' : '#9CA3AF',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: isValid ? 'pointer' : 'not-allowed',
            }}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
