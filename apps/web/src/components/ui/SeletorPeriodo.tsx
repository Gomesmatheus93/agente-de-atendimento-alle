import { PERIODOS_DASHBOARD, type PeriodoDashboard } from "@atendimento-academias/shared";

interface SeletorPeriodoProps {
  dias: PeriodoDashboard;
  onChange: (dias: PeriodoDashboard) => void;
}

export function SeletorPeriodo({ dias, onChange }: SeletorPeriodoProps) {
  return (
    <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-ink-3">Período</span>
      <div className="inline-flex rounded-lg bg-slate-200/60 p-0.5">
        {PERIODOS_DASHBOARD.map((periodo) => (
          <button
            key={periodo}
            type="button"
            aria-pressed={periodo === dias}
            onClick={() => onChange(periodo)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              periodo === dias ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
            }`}
          >
            {periodo} dias
          </button>
        ))}
      </div>
    </div>
  );
}
