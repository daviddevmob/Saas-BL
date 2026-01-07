'use client';

import { ColumnMapping } from '../types';
import { FIELD_DEFINITIONS, AVAILABLE_LOGOS } from '../constants';

interface ColumnMappingModalProps {
  isOpen: boolean;
  csvColumns: string[];
  columnMapping: ColumnMapping;
  onUpdateMapping: (field: string, value: string) => void;
  onClearMapping: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  // Save template
  showSaveTemplateModal: boolean;
  setShowSaveTemplateModal: (value: boolean) => void;
  newTemplateName: string;
  setNewTemplateName: (value: string) => void;
  newTemplateLogo: string;
  setNewTemplateLogo: (value: string) => void;
  isSavingTemplate: boolean;
  allFieldsMapped: boolean;
  onSaveTemplate: () => void;
}

export default function ColumnMappingModal({
  isOpen,
  csvColumns,
  columnMapping,
  onUpdateMapping,
  onClearMapping,
  onCancel,
  onConfirm,
  showSaveTemplateModal,
  setShowSaveTemplateModal,
  newTemplateName,
  setNewTemplateName,
  newTemplateLogo,
  setNewTemplateLogo,
  isSavingTemplate,
  allFieldsMapped,
  onSaveTemplate,
}: ColumnMappingModalProps) {
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
    >
      <div
        style={{
          backgroundColor: '#FFF',
          borderRadius: '1rem',
          padding: '1.5rem',
          maxWidth: '700px',
          width: '95%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-inter)',
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#314158',
            }}
          >
            Mapear Colunas do CSV
          </h3>
          <button
            onClick={onClearMapping}
            style={{
              padding: '0.5rem 0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.75rem',
              color: '#64748B',
              backgroundColor: '#F1F5F9',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            Resetar Mapeamento
          </button>
        </div>

        <p
          style={{
            margin: '0 0 1rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Selecione qual coluna do seu CSV corresponde a cada campo.
          <br />
          <span style={{ color: '#DC2626' }}>* Campos obrigatórios</span>
        </p>

        {/* Preview das colunas detectadas */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            marginBottom: '1rem',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-inter)',
            color: '#64748B',
          }}
        >
          <strong>Colunas detectadas ({csvColumns.length}):</strong>{' '}
          {csvColumns.slice(0, 10).join(', ')}
          {csvColumns.length > 10 && ` ... e mais ${csvColumns.length - 10}`}
        </div>

        {/* Lista de campos para mapear */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginBottom: '1rem',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.75rem',
            }}
          >
            {FIELD_DEFINITIONS.map((field) => (
              <div
                key={field.key}
                style={{
                  padding: '0.75rem',
                  backgroundColor: field.required ? '#FEF3C7' : '#F8FAFC',
                  borderRadius: '0.5rem',
                  border: `1px solid ${field.required ? '#FCD34D' : '#E2E8F0'}`,
                }}
              >
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#314158',
                    marginBottom: '0.25rem',
                  }}
                >
                  {field.label}
                  {field.required && <span style={{ color: '#DC2626' }}> *</span>}
                </label>
                <select
                  value={columnMapping[field.key] || ''}
                  onChange={(e) => onUpdateMapping(field.key, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    borderRadius: '0.375rem',
                    border: '1px solid #E2E8F0',
                    backgroundColor: '#FFF',
                    color: '#314158',
                  }}
                >
                  <option value="">-- Não mapear --</option>
                  {[...csvColumns].sort((a, b) => a.localeCompare(b)).map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <p
                  style={{
                    margin: '0.25rem 0 0 0',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.65rem',
                    color: '#94A3B8',
                  }}
                >
                  {field.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Salvar como Modelo */}
        {showSaveTemplateModal ? (
          <div
            style={{
              marginBottom: '1rem',
              padding: '1rem',
              backgroundColor: '#F0FDF4',
              borderRadius: '0.5rem',
              border: '1px solid #86EFAC',
            }}
          >
            {/* Aviso se nem todos os campos estão mapeados */}
            {!allFieldsMapped && (
              <div
                style={{
                  marginBottom: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#FEF3C7',
                  borderRadius: '0.375rem',
                  border: '1px solid #FCD34D',
                }}
              >
                <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#92400E' }}>
                  Mapeie todos os campos para poder salvar o modelo
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
              {/* Nome do modelo */}
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#166534',
                    marginBottom: '0.375rem',
                  }}
                >
                  Nome do Modelo:
                </label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Ex: Hotmart, Kiwify..."
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                    color: '#1F2937',
                    border: '1px solid #16A34A',
                    borderRadius: '0.375rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Logo (opcional) */}
              <div style={{ width: '180px' }}>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#166534',
                    marginBottom: '0.375rem',
                  }}
                >
                  Logo (opcional):
                </label>
                <select
                  value={newTemplateLogo}
                  onChange={(e) => setNewTemplateLogo(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.875rem',
                    backgroundColor: '#FFFFFF',
                    color: '#1F2937',
                    border: '1px solid #16A34A',
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
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={onSaveTemplate}
                disabled={isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped}
                style={{
                  padding: '0.5rem 1rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  color: '#FFF',
                  backgroundColor: isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped ? '#9CA3AF' : '#16A34A',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: isSavingTemplate || !newTemplateName.trim() || !allFieldsMapped ? 'not-allowed' : 'pointer',
                }}
              >
                {isSavingTemplate ? 'Salvando...' : 'Salvar Modelo'}
              </button>
              <button
                onClick={() => {
                  setShowSaveTemplateModal(false);
                  setNewTemplateName('');
                  setNewTemplateLogo('');
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.8rem',
                  color: '#64748B',
                  backgroundColor: '#F1F5F9',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => setShowSaveTemplateModal(true)}
              style={{
                padding: '0.5rem 1rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.8rem',
                fontWeight: 500,
                color: '#166534',
                backgroundColor: '#DCFCE7',
                border: '1px solid #86EFAC',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Salvar como Modelo
            </button>
            <span
              style={{
                marginLeft: '0.75rem',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#64748B',
              }}
            >
              Salve este mapeamento para usar em futuras importações
            </span>
          </div>
        )}

        {/* Botões */}
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
              backgroundColor: '#F97316',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Confirmar e Processar
          </button>
        </div>
      </div>
    </div>
  );
}
