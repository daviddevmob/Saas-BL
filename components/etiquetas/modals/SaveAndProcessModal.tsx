'use client';

interface SaveAndProcessModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  templateName: string;
  isSaving: boolean;
}

export default function SaveAndProcessModal({
  isOpen,
  onCancel,
  onConfirm,
  templateName,
  isSaving,
}: SaveAndProcessModalProps) {
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
        zIndex: 10001,
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
            color: '#16A34A',
          }}
        >
          Salvar e Processar
        </h3>
        <p
          style={{
            margin: '0 0 0.5rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          O modelo <strong>{templateName}</strong> será salvo e o CSV será processado.
        </p>
        <p
          style={{
            margin: '0 0 1.5rem 0',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Deseja continuar?
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onCancel}
            disabled={isSaving}
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
              cursor: isSaving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#FFF',
              backgroundColor: isSaving ? '#9CA3AF' : '#16A34A',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: isSaving ? 'not-allowed' : 'pointer',
            }}
          >
            {isSaving ? 'Salvando...' : 'Salvar e Processar'}
          </button>
        </div>
      </div>
    </div>
  );
}
