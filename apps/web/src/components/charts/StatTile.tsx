import { Card } from "../Card.js";
import { Icone, type NomeIcone } from "../ui/Icone.js";
import { Sparkline } from "./Sparkline.js";

export interface Variacao {
  texto: string;
  direcao: "alta" | "queda" | "estavel";
  // true: subir é bom; false: subir é ruim; a cor da variação segue isso, sempre acompanhada de seta e texto.
  altaEhBoa: boolean;
}

interface StatTileProps {
  rotulo: string;
  valor: string;
  icone?: NomeIcone;
  variacao?: Variacao;
  referencia?: string;
  // Série diária para o minigráfico de tendência (opcional).
  serie?: Array<number | null>;
  serieClasse?: string;
  carregando?: boolean;
}

const SETA = { alta: "▲", queda: "▼", estavel: "•" } as const;

function classeDaVariacao({ direcao, altaEhBoa }: Variacao): string {
  if (direcao === "estavel") return "bg-slate-100 text-ink-2";
  const bom = (direcao === "alta") === altaEhBoa;
  return bom ? "bg-success-soft text-success-text" : "bg-red-50 text-red-700";
}

export function StatTile({ rotulo, valor, icone, variacao, referencia, serie, serieClasse }: StatTileProps) {
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          {icone && <Icone nome={icone} tamanho={14} className="text-ink-3" />}
          {rotulo}
        </p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p
          className={`shrink-0 font-heading font-extrabold leading-tight tracking-tight text-ink tabular-nums ${valor.length > 14 ? "text-xl" : "text-[1.9rem]"}`}
        >
          {valor}
        </p>
        {serie && <Sparkline valores={serie} className={serieClasse} />}
      </div>
      {(variacao || referencia) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          {variacao && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${classeDaVariacao(variacao)}`}>
              <span aria-hidden="true" className="text-[9px] leading-none">
                {SETA[variacao.direcao]}
              </span>
              {variacao.texto}
            </span>
          )}
          {referencia && <span>{referencia}</span>}
        </p>
      )}
    </Card>
  );
}
