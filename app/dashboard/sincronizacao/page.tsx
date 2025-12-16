'use client';

import SincronizacaoDatacrazy from '@/components/SincronizacaoDatacrazy';

export default function SincronizacaoPage() {
  return (
    <div className="flex-1 flex flex-col gap-6 p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-800">Sincronização</h1>
      </div>

      <SincronizacaoDatacrazy />
    </div>
  );
}
