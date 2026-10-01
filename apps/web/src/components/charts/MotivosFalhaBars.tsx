import { formatarNumero } from "../../lib/format.js";
import { Card } from "../Card.js";

interface MotivoFalha {
  motivo: string;
  total: number;
}

// Deixa folga à direita para o valor ficar na ponta da barra sem cortar.
const LARGURA_MAX_PCT = 82;

export function MotivosFalhaBars({ motivos }: { motivos: MotivoFalha[] }) {
  const maximo = Math.max(1, ...motivos.map((item) => item.total));
  const totalFalhas = motivos.reduce((soma, item) => soma + item.total, 0);

  return (
    <Card className="flex h-full flex-col">
      <h3 className="mb-4 font-heading text-sm font-semibold">Motivos de falha</h3>

      {motivos.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-center text-sm text-ink-2">
          Nenhuma falha no período.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {motivos.map((item) => (
            <li
              key={item.motivo}
              title={`${item.motivo}: ${formatarNumero(item.total)} (${Math.round((item.total / totalFalhas) * 100)}% das falhas)`}
            >
              <p className="mb-1 text-xs text-ink-2">{item.motivo}</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 rounded-r-[4px] bg-status-falhou"
                  style={{ width: `${Math.max(2, (item.total / maximo) * LARGURA_MAX_PCT)}%` }}
                />
                <span className="text-xs font-semibold tabular-nums text-ink">{formatarNumero(item.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
