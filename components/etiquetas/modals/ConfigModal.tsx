'use client';

import { SERVICOS_ECT } from '../constants';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  useTestCredentials: boolean;
  setUseTestCredentials: (value: boolean) => void;
  sendToN8n: boolean;
  setSendToN8n: (value: boolean) => void;
  adminPhone: string;
  setAdminPhone: (value: string) => void;
  clientPhoneOverride: string;
  setClientPhoneOverride: (value: string) => void;
  selectedServicoEct: string;
  setSelectedServicoEct: (value: string) => void;
  onSave: () => void;
}

export default function ConfigModal({
  isOpen,
  onClose,
  useTestCredentials,
  setUseTestCredentials,
  sendToN8n,
  setSendToN8n,
  adminPhone,
  setAdminPhone,
  clientPhoneOverride,
  setClientPhoneOverride,
  selectedServicoEct,
  setSelectedServicoEct,
  onSave,
}: ConfigModalProps) {
  if (!isOpen) return null;

  const handleSaveAndClose = () => {
    onSave();
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
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-inter)',
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#1E293B',
            }}
          >
            ⚙️ Configurações
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Seleção de Serviço ECT */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.375rem' }}>
            📦 Serviço de Envio Padrão
          </label>
          <select
            value={selectedServicoEct}
            onChange={(e) => setSelectedServicoEct(e.target.value)}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#1E293B',
              backgroundColor: '#FFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              boxSizing: 'border-box',
            }}
          >
            {SERVICOS_ECT.map((servico) => (
              <option key={servico.code} value={servico.code}>
                {servico.name}
              </option>
            ))}
          </select>
        </div>

        {/* Toggle: Modo Teste VIPP */}
        <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: useTestCredentials ? '#FEF3C7' : '#F8FAFC', borderRadius: '0.75rem', border: useTestCredentials ? '1px solid #FCD34D' : '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E293B' }}>
                🧪 Modo Teste (VIPP)
              </p>
              <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                Usa credenciais de homologação para gerar etiquetas de teste
              </p>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
              <input
                type="checkbox"
                checked={useTestCredentials}
                onChange={(e) => setUseTestCredentials(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: 'absolute',
                cursor: 'pointer',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: useTestCredentials ? '#F59E0B' : '#CBD5E1',
                borderRadius: '24px',
                transition: '0.3s',
              }}>
                <span style={{
                  position: 'absolute',
                  content: '""',
                  height: '18px',
                  width: '18px',
                  left: useTestCredentials ? '27px' : '3px',
                  bottom: '3px',
                  backgroundColor: '#FFF',
                  borderRadius: '50%',
                  transition: '0.3s',
                }} />
              </span>
            </label>
          </div>
        </div>

        {/* Toggle: Enviar para N8N */}
        <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: sendToN8n ? '#F0FDF4' : '#FEF2F2', borderRadius: '0.75rem', border: sendToN8n ? '1px solid #86EFAC' : '1px solid #FECACA' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontFamily: 'var(--font-inter)', fontSize: '0.875rem', fontWeight: 600, color: '#1E293B' }}>
                📤 Enviar para N8N/Webhook
              </p>
              <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: '#64748B' }}>
                Dispara webhook após gerar etiquetas (admin sempre recebe)
              </p>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '24px' }}>
              <input
                type="checkbox"
                checked={sendToN8n}
                onChange={(e) => setSendToN8n(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: 'absolute',
                cursor: 'pointer',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: sendToN8n ? '#22C55E' : '#EF4444',
                borderRadius: '24px',
                transition: '0.3s',
              }}>
                <span style={{
                  position: 'absolute',
                  content: '""',
                  height: '18px',
                  width: '18px',
                  left: sendToN8n ? '27px' : '3px',
                  bottom: '3px',
                  backgroundColor: '#FFF',
                  borderRadius: '50%',
                  transition: '0.3s',
                }} />
              </span>
            </label>
          </div>
        </div>

        {/* Campos de telefone */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.375rem' }}>
            📞 Telefone Admin (notificações)
          </label>
          <input
            type="text"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="5585999999999"
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#1E293B',
              backgroundColor: '#FFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.375rem' }}>
            🧪 Telefone Teste Cliente (substitui telefone real)
          </label>
          <input
            type="text"
            value={clientPhoneOverride}
            onChange={(e) => setClientPhoneOverride(e.target.value.replace(/\D/g, ''))}
            placeholder="Vazio = usa telefone do CSV"
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#1E293B',
              backgroundColor: '#FFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ margin: '0.25rem 0 0 0', fontFamily: 'var(--font-inter)', fontSize: '0.625rem', color: '#94A3B8' }}>
            Se preenchido, todas as notificações de cliente vão para este número (para testes)
          </p>
        </div>

        {/* Botão fechar */}
        <button
          onClick={handleSaveAndClose}
          style={{
            width: '100%',
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
          Salvar e Fechar
        </button>
      </div>
    </div>
  );
}
