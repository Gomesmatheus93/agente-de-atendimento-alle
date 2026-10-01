import { useEffect, useState } from "react";

type TipoToast = "sucesso" | "erro";

interface ItemToast {
  id: number;
  tipo: TipoToast;
  mensagem: string;
}

const DURACAO_MS = 5000;

let proximoId = 1;
const ouvintes = new Set<(item: ItemToast) => void>();

function emitir(tipo: TipoToast, mensagem: string) {
  const item = { id: proximoId++, tipo, mensagem };
  ouvintes.forEach((ouvinte) => ouvinte(item));
}

export const toast = {
  sucesso: (mensagem: string) => emitir("sucesso", mensagem),
  erro: (mensagem: string) => emitir("erro", mensagem),
};

export function Toaster() {
  const [itens, setItens] = useState<ItemToast[]>([]);

  useEffect(() => {
    const ouvinte = (item: ItemToast) => {
      setItens((atual) => [...atual, item]);
      window.setTimeout(() => setItens((atual) => atual.filter((outro) => outro.id !== item.id)), DURACAO_MS);
    };
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6">
      {itens.map((item) => (
        <div
          key={item.id}
          role={item.tipo === "erro" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-l-4 bg-surface px-4 py-3 text-sm shadow-pop sm:w-auto ${
            item.tipo === "erro" ? "border-card-border border-l-status-falhou" : "border-card-border border-l-success"
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
              item.tipo === "erro" ? "bg-status-falhou" : "bg-success"
            }`}
          >
            {item.tipo === "erro" ? "!" : "✓"}
          </span>
          <p className="flex-1 text-ink">{item.mensagem}</p>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setItens((atual) => atual.filter((outro) => outro.id !== item.id))}
            className="text-ink-2 hover:text-ink"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
