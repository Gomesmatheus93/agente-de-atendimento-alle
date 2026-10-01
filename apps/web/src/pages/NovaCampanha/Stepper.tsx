import { Icone } from "../../components/ui/Icone.js";

export interface PassoInfo {
  id: string;
  rotulo: string;
}

export function Stepper({ passos, atual }: { passos: PassoInfo[]; atual: number }) {
  return (
    <ol className="mb-6 flex items-center gap-3" aria-label="Etapas da campanha">
      {passos.map((passo, indice) => {
        const concluido = indice < atual;
        const corrente = indice === atual;

        return (
          <li key={passo.id} aria-current={corrente ? "step" : undefined} className="flex flex-1 items-center gap-3 last:flex-none">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                corrente
                  ? "bg-accent text-accent-contrast shadow-sm ring-4 ring-accent/15"
                  : concluido
                    ? "bg-accent text-accent-contrast"
                    : "border border-card-border bg-surface text-ink-3"
              }`}
            >
              {concluido ? <Icone nome="check" tamanho={14} /> : <span aria-hidden="true">{indice + 1}</span>}
              <span className="sr-only">{concluido ? "Concluída: " : corrente ? "Etapa atual: " : "Pendente: "}</span>
            </span>
            <span className={`text-sm ${corrente ? "font-semibold text-ink" : "hidden font-medium text-ink-2 sm:inline"}`}>
              {passo.rotulo}
            </span>
            {indice < passos.length - 1 && (
              <span aria-hidden="true" className={`h-0.5 flex-1 rounded-full ${concluido ? "bg-accent" : "bg-card-border"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
