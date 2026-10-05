import { PERIODOS_VISAO, ROTULO_PERIODO_VISAO, type PeriodoVisao } from "@atendimento-academias/shared";
import { useState } from "react";

export interface PeriodoEscolhido {
  periodo: PeriodoVisao;
  // Só em "personalizado": dias no formato YYYY-MM-DD.
  inicio?: string;
  fim?: string;
}

// Hoje no fuso da operação, no formato do <input type="date">.
function hojeLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function SeletorPeriodoVisao({ valor, onChange }: { valor: PeriodoEscolhido; onChange: (valor: PeriodoEscolhido) => void }) {
  const hoje = hojeLocal();
  const [abrirDatas, setAbrirDatas] = useState(valor.periodo === "personalizado");
  const [inicio, setInicio] = useState(valor.inicio ?? "");
  const [fim, setFim] = useState(valor.fim ?? hoje);
  const datasValidas = Boolean(inicio && fim && inicio <= fim);

  return (
    <div className="flex flex-col items-end gap-2">
      <div role="group" aria-label="Período" className="inline-flex flex-wrap rounded-xl bg-slate-200/60 p-1">
        {PERIODOS_VISAO.map((periodo) => {
          const ativo = periodo === "personalizado" ? valor.periodo === "personalizado" || abrirDatas : valor.periodo === periodo && !abrirDatas;
          return (
            <button
              key={periodo}
              type="button"
              aria-pressed={ativo}
              onClick={() => {
                if (periodo === "personalizado") {
                  setAbrirDatas(true);
                  return;
                }
                setAbrirDatas(false);
                onChange({ periodo });
              }}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                ativo
                  ? `bg-surface shadow-sm ${periodo === "personalizado" ? "text-accent-text" : "text-ink"}`
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {ROTULO_PERIODO_VISAO[periodo]}
            </button>
          );
        })}
      </div>

      {abrirDatas && (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            if (datasValidas) onChange({ periodo: "personalizado", inicio, fim });
          }}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-card-border bg-surface px-3 py-2"
        >
          <label className="flex flex-col gap-0.5 text-xs font-medium text-ink-2">
            De
            <input type="date" value={inicio} max={fim || hoje} onChange={(evento) => setInicio(evento.target.value)} className="rounded-md px-2 py-1 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium text-ink-2">
            Até
            <input type="date" value={fim} min={inicio || undefined} max={hoje} onChange={(evento) => setFim(evento.target.value)} className="rounded-md px-2 py-1 text-sm text-ink" />
          </label>
          <button
            type="submit"
            disabled={!datasValidas}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:bg-accent/40"
          >
            Aplicar
          </button>
        </form>
      )}
    </div>
  );
}
