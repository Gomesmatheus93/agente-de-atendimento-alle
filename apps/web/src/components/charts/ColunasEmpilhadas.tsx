import { formatarDiaCurto, formatarMoeda } from "../../lib/format.js";

export interface SerieEmpilhada {
  chave: string;
  rotulo: string;
  // Classe de fundo da cor da série (tokens validados: bg-graf-1, bg-graf-2, bg-graf-3).
  cor: string;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotulo(chave: string, agrupamento: "dia" | "mes"): string {
  return agrupamento === "mes" ? (MESES[Number(chave.slice(5, 7)) - 1] ?? chave) : formatarDiaCurto(chave);
}

function rotuloLongo(chave: string, agrupamento: "dia" | "mes"): string {
  if (agrupamento === "mes") return new Date(`${chave}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return new Date(`${chave}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

// Marcas do eixo em valores "redondos" de dinheiro.
function marcas(maior: number): number[] {
  if (maior <= 0) return [0, 1];
  const bruto = maior / 4;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= bruto)!;
  const topo = Math.ceil(maior / passo) * passo;
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => Math.round(i * passo * 100) / 100);
}

const reaisCurtos = (valor: number) =>
  valor >= 1000 ? `R$ ${(valor / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : formatarMoeda(valor).replace(/,00$/, "");

// Gasto por dia (ou mês) empilhado por fonte. Legenda sempre (mais de uma série), uma folga de 2px na cor
// da superfície entre os pedaços, eixo em reais com grade discreta, detalhe por coluna ao passar o mouse
// (ou com o teclado) e a mesma informação em tabela para leitor de tela.
export function ColunasEmpilhadas<T extends { dia: string } & Record<string, number | string>>({
  pontos,
  series,
  agrupamento,
  rotuloAcessivel,
}: {
  pontos: T[];
  series: SerieEmpilhada[];
  agrupamento: "dia" | "mes";
  rotuloAcessivel: string;
}) {
  const totalDe = (p: T) => series.reduce((s, serie) => s + Number(p[serie.chave] ?? 0), 0);
  const maior = Math.max(0, ...pontos.map(totalDe));
  const eixo = marcas(maior);
  const topo = eixo[eixo.length - 1]!;
  const passo = pontos.length <= 10 ? 1 : Math.ceil(pontos.length / 6);

  return (
    <figure className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.chave} className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${s.cor}`} />
            {s.rotulo}
          </li>
        ))}
      </ul>

      <div className="mt-1 flex gap-2" aria-hidden="true">
        <div className="relative h-52 w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
          {eixo.map((m) => (
            <span key={m} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(m / topo) * 100}%` }}>
              {reaisCurtos(m)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-52">
            {eixo.map((m) => (
              <span key={m} className={`absolute inset-x-0 h-px ${m === 0 ? "bg-baseline" : "bg-grid"}`} style={{ bottom: `${(m / topo) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {pontos.map((p) => {
                const total = totalDe(p);
                return (
                  <div key={p.dia} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none">
                    <span className="absolute inset-y-0 inset-x-px rounded-md transition-colors group-hover:bg-accent-soft group-focus-visible:bg-accent-soft group-focus-visible:ring-2 group-focus-visible:ring-accent" />
                    {total > 0 && (
                      // Empilha de baixo para cima; a folga de 2px (gap) é a cor da superfície separando os pedaços.
                      <span className="relative flex w-3/4 max-w-[22px] flex-col-reverse gap-[2px]" style={{ height: `${(total / topo) * 100}%` }}>
                        {series.map((s, i) => {
                          const valor = Number(p[s.chave] ?? 0);
                          if (valor <= 0) return null;
                          const ultimo = series.slice(i + 1).every((outra) => Number(p[outra.chave] ?? 0) <= 0);
                          return <span key={s.chave} className={`block w-full ${s.cor} ${ultimo ? "rounded-t" : ""}`} style={{ flexGrow: valor, flexBasis: 0, minHeight: 2 }} />;
                        })}
                      </span>
                    )}
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-[11px] text-surface shadow-pop group-hover:block group-focus:block">
                      <span className="mb-1 block font-semibold capitalize">{rotuloLongo(p.dia, agrupamento)}</span>
                      {series.map((s) => (
                        <span key={s.chave} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-sm ${s.cor}`} />
                            {s.rotulo}
                          </span>
                          <span className="tabular-nums">{formatarMoeda(Number(p[s.chave] ?? 0))}</span>
                        </span>
                      ))}
                      <span className="mt-1 flex justify-between gap-4 border-t border-surface/20 pt-1 font-semibold">
                        Total <span className="tabular-nums">{formatarMoeda(total)}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex">
            {pontos.map((p, i) => (
              <span key={p.dia} className="relative flex min-w-0 flex-1 justify-center text-xs text-ink-3">
                {i % passo === 0 && <span className="whitespace-nowrap">{rotulo(p.dia, agrupamento)}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>{rotuloAcessivel}</caption>
          <thead>
            <tr>
              <th scope="col">{agrupamento === "mes" ? "Mês" : "Dia"}</th>
              {series.map((s) => (
                <th key={s.chave} scope="col">
                  {s.rotulo}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map((p) => (
              <tr key={p.dia}>
                <td>{rotuloLongo(p.dia, agrupamento)}</td>
                {series.map((s) => (
                  <td key={s.chave}>{formatarMoeda(Number(p[s.chave] ?? 0))}</td>
                ))}
                <td>{formatarMoeda(totalDe(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
