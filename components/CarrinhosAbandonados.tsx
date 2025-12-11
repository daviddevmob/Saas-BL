'use client';

import { useState } from 'react';
import Image from 'next/image';

interface CarrinhoAbandonado {
  id: string;
  email: string;
  telefone: string;
  nome: string;
  produto_id: number | string;
  produto_nome: string;
  plataforma: string;
  data_abandono: string;
  status: string;
  status_atualizado_em: string;
  offer_code?: string;
  hotmart_event_id?: string;
  hubla_lead_id?: string;
  selected: boolean;
}

export default function CarrinhosAbandonados() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [carrinhos, setCarrinhos] = useState<CarrinhoAbandonado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [filtroPlataforma, setFiltroPlataforma] = useState<string>('todos');

  const buscarCarrinhos = async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let url = '/api/carrinhos-abandonados/listar?limit=100';

      if (filtroStatus !== 'todos') {
        url += `&status=${filtroStatus}`;
      }
      if (filtroPlataforma !== 'todos') {
        url += `&plataforma=${filtroPlataforma}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao buscar carrinhos');
      }

      const carrinhosComSelecao = data.carrinhos.map((c: Omit<CarrinhoAbandonado, 'selected'>) => ({
        ...c,
        selected: false,
      }));

      setCarrinhos(carrinhosComSelecao);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setIsLoading(false);
    }
  };

  const sincronizarHotmart = async () => {
    setIsSyncing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/carrinhos-abandonados/sincronizar', {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao sincronizar');
      }

      setSuccessMessage(data.message);
      // Recarregar lista
      await buscarCarrinhos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleSelect = (id: string) => {
    setCarrinhos(prev =>
      prev.map(c => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  const toggleSelectAll = () => {
    const pendentes = carrinhos.filter(c => c.status === 'pendente');
    const allSelected = pendentes.every(c => c.selected);
    setCarrinhos(prev =>
      prev.map(c => (c.status === 'pendente' ? { ...c, selected: !allSelected } : c))
    );
  };

  const selectedCount = carrinhos.filter(c => c.selected).length;
  const pendentesCount = carrinhos.filter(c => c.status === 'pendente').length;
  const recuperadosCount = carrinhos.filter(c => c.status === 'recuperado').length;

  const enviarParaSwipeOne = async () => {
    const selecionados = carrinhos.filter(c => c.selected);
    if (selecionados.length === 0) return;

    setIsSending(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const contatos = selecionados.map(c => ({
        email: c.email,
        nome: c.nome,
        telefone: c.telefone,
        produto: c.produto_nome,
        transactionId: c.hotmart_event_id || c.hubla_lead_id || c.id,
      }));

      const response = await fetch('/api/swipeone/enviar-contatos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contatos,
          tags: 'carrinho-abandonado',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao enviar para SwipeOne');
      }

      setSuccessMessage(`${data.sucessos} contato(s) enviado(s) para SwipeOne!`);

      // Desmarcar os enviados
      setCarrinhos(prev => prev.map(c => ({ ...c, selected: false })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setIsSending(false);
    }
  };

  const formatarData = (dataISO: string) => {
    if (!dataISO) return '-';
    const date = new Date(dataISO);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente':
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            Pendente
          </span>
        );
      case 'recuperado':
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Recuperado
          </span>
        );
      case 'enviado_swipeone':
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            Enviado
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  const getPlataformaBadge = (plataforma: string) => {
    switch (plataforma) {
      case 'hotmart':
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
            Hotmart
          </span>
        );
      case 'hubla':
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Hubla
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {plataforma}
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2
          style={{
            fontFamily: 'var(--font-public-sans)',
            fontWeight: 600,
            fontSize: '1.25rem',
            color: '#314158',
            marginBottom: '0.5rem',
          }}
        >
          Carrinhos Abandonados
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.875rem',
            color: '#64748B',
          }}
        >
          Gerencie carrinhos abandonados de todas as plataformas
        </p>
      </div>

      {/* Filtros e Ações */}
      <div className="mb-6 p-4 rounded-xl bg-white border border-slate-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-wrap">
          {/* Filtro Status */}
          <div>
            <label
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#64748B',
              }}
            >
              Status
            </label>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="block w-full mt-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            >
              <option value="todos">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="recuperado">Recuperado</option>
              <option value="enviado_swipeone">Enviado SwipeOne</option>
            </select>
          </div>

          {/* Filtro Plataforma */}
          <div>
            <label
              style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.75rem',
                color: '#64748B',
              }}
            >
              Plataforma
            </label>
            <select
              value={filtroPlataforma}
              onChange={(e) => setFiltroPlataforma(e.target.value)}
              className="block w-full mt-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            >
              <option value="todos">Todas</option>
              <option value="hotmart">Hotmart</option>
              <option value="hubla">Hubla</option>
            </select>
          </div>

          {/* Botão Buscar */}
          <button
            onClick={buscarCarrinhos}
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg text-white transition mt-auto ${
              isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            style={{
              backgroundColor: '#3B82F6',
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
            }}
          >
            {isLoading ? 'Buscando...' : 'Buscar'}
          </button>

          {/* Botão Sincronizar */}
          <button
            onClick={sincronizarHotmart}
            disabled={isSyncing}
            className={`px-4 py-2 rounded-lg text-white transition mt-auto flex items-center gap-2 ${
              isSyncing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            style={{
              backgroundColor: '#F97316',
              fontFamily: 'var(--font-inter)',
              fontWeight: 500,
              fontSize: '0.875rem',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c-1.657 0-3-4.03-3-9s1.343-9 3-9m0 18c1.657 0 3-4.03 3-9s-1.343-9-3-9m-9 9a9 9 0 0 1 9-9" />
            </svg>
            {isSyncing ? 'Sincronizando...' : 'Sincronizar Hotmart'}
          </button>

          {/* Botão Enviar SwipeOne */}
          {selectedCount > 0 && (
            <button
              onClick={enviarParaSwipeOne}
              disabled={isSending}
              className={`px-4 py-2 rounded-lg text-white transition mt-auto flex items-center gap-2 ${
                isSending ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
              }`}
              style={{
                backgroundColor: '#8B5CF6',
                fontFamily: 'var(--font-inter)',
                fontWeight: 500,
                fontSize: '0.875rem',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              {isSending ? 'Enviando...' : `Enviar ${selectedCount} para SwipeOne`}
            </button>
          )}
        </div>
      </div>

      {/* Mensagens */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#DC2626' }}>
            {error}
          </p>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200">
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.875rem', color: '#16A34A' }}>
            {successMessage}
          </p>
        </div>
      )}

      {/* Resumo */}
      {carrinhos.length > 0 && (
        <div className="mb-4 flex gap-4">
          <span
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#64748B',
            }}
          >
            Total: <strong>{carrinhos.length}</strong>
          </span>
          <span
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#EAB308',
            }}
          >
            Pendentes: <strong>{pendentesCount}</strong>
          </span>
          <span
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.875rem',
              color: '#16A34A',
            }}
          >
            Recuperados: <strong>{recuperadosCount}</strong>
          </span>
        </div>
      )}

      {/* Tabela */}
      {carrinhos.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={pendentesCount > 0 && carrinhos.filter(c => c.status === 'pendente').every(c => c.selected)}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Cliente
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Produto
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Plataforma
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                    Data Abandono
                  </th>
                </tr>
              </thead>
              <tbody>
                {carrinhos.map((carrinho) => (
                  <tr
                    key={carrinho.id}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition ${
                      carrinho.selected ? 'bg-purple-50/50' : ''
                    } ${carrinho.status === 'recuperado' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={carrinho.selected}
                        onChange={() => toggleSelect(carrinho.id)}
                        disabled={carrinho.status !== 'pendente'}
                        className="w-4 h-4 rounded border-slate-300 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900">
                          {carrinho.nome || 'Nome não informado'}
                        </p>
                        <p className="text-xs text-slate-500">{carrinho.email}</p>
                        {carrinho.telefone && (
                          <p className="text-xs text-slate-500">{carrinho.telefone}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-900 max-w-[200px] truncate" title={carrinho.produto_nome}>
                        {carrinho.produto_nome}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {getPlataformaBadge(carrinho.plataforma)}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(carrinho.status)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-500">
                        {formatarData(carrinho.data_abandono)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!isLoading && carrinhos.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <svg className="mx-auto h-12 w-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-slate-900">Nenhum carrinho encontrado</h3>
          <p className="mt-2 text-sm text-slate-500">
            Clique em "Buscar" para carregar os carrinhos do Firebase
          </p>
        </div>
      )}
    </div>
  );
}
