'use client';

interface NewUploadConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function NewUploadConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: NewUploadConfirmModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onClose();
    onConfirm();
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
          maxWidth: '400px',
          width: '90%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            fontFamily: 'var(--font-public-sans)',
            fontWeight: 600,
            fontSize: '1.125rem',
            color: '#1E293B',
            margin: '0 0 0.75rem 0',
          }}
        >
          Novo Upload
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
            margin: '0 0 1.5rem 0',
          }}
        >
          Deseja importar um novo CSV? Os dados atuais serão substituídos.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
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
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
              color: '#FFF',
              backgroundColor: '#F97316',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
