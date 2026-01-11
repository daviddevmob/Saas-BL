'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { MappingTemplate } from './types';
import {
  deleteMappingTemplate,
  updateMappingTemplate,
} from './services';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelected: (file: File, template?: MappingTemplate) => void;
  mappingTemplates: MappingTemplate[];
  isLoadingTemplates: boolean;
  onTemplatesChange: (updatedTemplates: MappingTemplate[]) => void;
}

export default function ImportModal({
  isOpen,
  onClose,
  onFileSelected,
  mappingTemplates,
  isLoadingTemplates,
  onTemplatesChange,
}: ImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);
  
  // Estados locais para edição/exclusão (encapsulados aqui)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<MappingTemplate | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [templateToEdit, setTemplateToEdit] = useState<MappingTemplate | null>(null);
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editTemplateLogo, setEditTemplateLogo] = useState<string>('');
  
  const [pendingTemplate, setPendingTemplate] = useState<MappingTemplate | null>(null);

  if (!isOpen) return null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  // Quando seleciona arquivo para um template específico
  const handleTemplateFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingTemplate) {
      onFileSelected(file, pendingTemplate);
      setPendingTemplate(null);
    }
    if (templateFileInputRef.current) {
      templateFileInputRef.current.value = '';
    }
  };

  const startImportWithTemplate = (template: MappingTemplate) => {
    setPendingTemplate(template);
    templateFileInputRef.current?.click();
  };

  // --- Lógica de Exclusão ---
  const openDeleteModal = (template: MappingTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplateToDelete(template);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  };

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete?.id) return;
    if (deleteConfirmText !== templateToDelete.name) return;

    try {
      await deleteMappingTemplate(templateToDelete.id);
      onTemplatesChange(mappingTemplates.filter(t => t.id !== templateToDelete.id));
      setShowDeleteModal(false);
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Erro ao excluir:', err);
      alert('Erro ao excluir modelo');
    }
  };

  // --- Lógica de Edição ---
  const openEditModal = (template: MappingTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplateToEdit(template);
    setEditTemplateName(template.name);
    setEditTemplateLogo(template.logo || '');
    setShowEditModal(true);
  };

  const confirmEditTemplate = async () => {
    if (!templateToEdit?.id || !editTemplateName.trim()) return;

    try {
      await updateMappingTemplate(templateToEdit.id, editTemplateName.trim(), templateToEdit.mapping, editTemplateLogo || null);
      const updated = mappingTemplates.map(t =>
        t.id === templateToEdit.id
          ? { ...t, name: editTemplateName.trim(), logo: editTemplateLogo || undefined }
          : t
      ).sort((a, b) => a.name.localeCompare(b.name));
      
      onTemplatesChange(updated);
      setShowEditModal(false);
      setTemplateToEdit(null);
    } catch (err) {
      console.error('Erro ao editar:', err);
      alert('Erro ao editar modelo');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-8 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-slate-800 font-public-sans">
              Nova Importação
            </h2>
            <p className="text-slate-500 text-sm mt-1 font-inter">
              Selecione um arquivo CSV ou escolha um modelo salvo
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Grid Principal */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))`,
          gap: '1rem',
        }}>
          {/* Card: Importar CSV sem modelo */}
          <div
            className={`rounded-2xl border-2 border-dashed p-6 transition-all cursor-pointer flex flex-col items-center justify-center h-[240px] ${
              isDragging
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-700 mb-1 font-public-sans">Upload CSV</p>
              <p className="text-xs text-slate-500 font-inter">Sem modelo pré-definido</p>
            </div>
          </div>

          {/* Cards dos Templates */}
          {!isLoadingTemplates && mappingTemplates.map((template) => (
            <div
              key={template.id}
              className="rounded-2xl border-2 border-blue-100 bg-blue-50/30 p-6 transition-all cursor-pointer hover:border-blue-400 hover:bg-blue-50 h-[240px] flex flex-col items-center justify-center relative group"
              onClick={() => startImportWithTemplate(template)}
            >
              {/* Botões de Ação (Hover) */}
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button
                  onClick={(e) => openEditModal(template, e)}
                  className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-slate-50 text-slate-500"
                  title="Editar"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => openDeleteModal(template, e)}
                  className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-red-50 text-red-500"
                  title="Excluir"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>

              <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center border border-blue-100 mb-4 overflow-hidden shadow-sm">
                {template.logo ? (
                  <Image
                    src={`/lojas/${template.logo}`}
                    alt={template.name}
                    width={40}
                    height={40}
                    className="object-cover"
                  />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                )}
              </div>
              
              <div className="text-center w-full">
                <p className="font-semibold text-blue-900 mb-1 truncate px-2 font-public-sans">{template.name}</p>
                <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium uppercase tracking-wide">
                  Modelo Salvo
                </span>
              </div>
            </div>
          ))}

          {/* Input oculto para template */}
          <input
            ref={templateFileInputRef}
            type="file"
            accept=".csv"
            onChange={handleTemplateFileSelect}
            className="hidden"
          />
        </div>

        {/* Loading */}
        {isLoadingTemplates && (
          <div className="mt-8 text-center text-slate-500 font-inter">
            Carregando modelos...
          </div>
        )}

        {/* --- MODAL DE EXCLUSÃO (INTERNO) --- */}
        {showDeleteModal && templateToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-red-600 mb-2 font-public-sans">Excluir Modelo</h3>
              <p className="text-sm text-slate-600 mb-4 font-inter">
                Para confirmar, digite o nome do modelo:
                <br />
                <span className="font-bold text-slate-800 bg-slate-100 px-1 py-0.5 rounded text-xs mt-1 inline-block">
                  {templateToDelete.name}
                </span>
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full border rounded p-2 text-sm mb-4 font-inter"
                placeholder="Digite o nome..."
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDeleteTemplate}
                  disabled={deleteConfirmText !== templateToDelete.name}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- MODAL DE EDIÇÃO (INTERNO) --- */}
        {showEditModal && templateToEdit && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-slate-800 mb-4 font-public-sans">Editar Modelo</h3>
              
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase font-inter">Nome</label>
                <input
                  type="text"
                  value={editTemplateName}
                  onChange={(e) => setEditTemplateName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-inter"
                />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-inter"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmEditTemplate}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-inter"
                >
                  Salvar Alterações
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
