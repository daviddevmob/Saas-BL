'use client';

export default function InicioPage() {
  // Linha 1: 3 cards
  const linha1Cards = [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ];

  // Linha 2: 5 cards
  const linha2Cards = [
    { id: 1 },
    { id: 2 },
    { id: 3 },
    { id: 4 },
    { id: 5 },
  ];

  // Linha 3: 2 cards
  const linha3Cards = [{ id: 1 }, { id: 2 }];

  return (
    <div className="flex-1 flex flex-col gap-5 p-8">
      {/* Linha 1: 3 Cards */}
      <div className="flex gap-5">
        {linha1Cards.map((card) => (
          <div
            key={card.id}
            className="rounded-3xl border border-slate-200 p-10"
            style={{
              width: '442px',
              height: '206px',
              backgroundColor: '#FFFFFF',
              borderColor: '#E2E8F0',
            }}
          />
        ))}
      </div>

      {/* Linha 2: 5 Cards */}
      <div className="flex gap-5">
        {linha2Cards.map((card) => (
          <div
            key={card.id}
            className="rounded-3xl border border-slate-200 p-5"
            style={{
              width: '325px',
              height: '182px',
              minHeight: '180px',
              backgroundColor: '#FFFFFF',
              borderColor: '#E2E8F0',
            }}
          />
        ))}
      </div>

      {/* Linha 3: 2 Cards */}
      <div className="flex gap-5">
        {linha3Cards.map((card) => (
          <div
            key={card.id}
            className="rounded-3xl border border-slate-200 p-5"
            style={{
              width: '668px',
              height: '507px',
              backgroundColor: '#FFFFFF',
              borderColor: '#E2E8F0',
            }}
          />
        ))}
      </div>
    </div>
  );
}
