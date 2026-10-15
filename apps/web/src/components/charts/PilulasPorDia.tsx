import { formatarDiaCurto, formatarNumero } from "../../lib/format.js";

export interface PontoPilula {
  dia: string;
  valor: number;
}

const DIAS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotulo(chave: string, agrupamento: "dia" | "mes", poucos: boolean): string {
  if (agrupamento === "mes") return MESES[Number(chave.slice(5, 7)) - 1] ?? chave;
  return poucos ? DIAS_DA_SEMANA[new Date(`${chave}T12:00:00`).getDay()]! : formatarDiaCurto(chave);
}

function rotuloLongo(chave: string, agrupamento: "dia" | "mes"): string {
  if (agrupamento === "mes") return new Date(`${chave}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return new Date(`${chave}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

// Marcas do eixo em números inteiros "redondos" (contagens: nunca 0,5 matrícula).
function marcasDoEixo(maior: number): number[] {
  if (maior <= 0) return [0, 1];
  const alvo = Math.max(1, Math.ceil(maior / 4));
  const ordem = 10 ** Math.floor(Math.log10(alvo));
  const passo = [1, 2, 5, 10].map((m) => m * ordem).find((p) => p >= alvo)!;
  const topo = Math.ceil(maior / passo) * passo;
  return Array.from({ length: topo / passo + 1 }, (_, i) => i * passo);
}

// Contagem por dia (ou mês), uma série só: colunas finas que crescem de uma linha de base, eixo com valores
// inteiros e grade discreta. Os dados costumam ser esparsos (poucas matrículas por dia), então cada coluna
// com valor ganha o número no topo; com muitas colunas, só o pico. Cada dia mostra o detalhe ao passar o
// mouse (ou com o teclado), e uma tabela escondida leva os mesmos números para leitores de tela.
export function PilulasPorDia({
  serie,
  agrupamento,
  descrever,
  rotuloAcessivel,
}: {
  serie: PontoPilula[];
  agrupamento: "dia" | "mes";
  // Texto do valor no detalhe ("3 matrículas").
  descrever: (valor: number) => string;
  rotuloAcessivel: string;
}) {
  const maior = Math.max(...serie.map((ponto) => ponto.valor), 0);
  const marcas = marcasDoEixo(maior);
  const topo = marcas[marcas.length - 1]!;
  const total = serie.reduce((soma, ponto) => soma + ponto.valor, 0);
  const comValor = serie.filter((ponto) => ponto.valor > 0);
  const pico = maior > 0 ? serie.find((ponto) => ponto.valor === maior)! : null;
  const rotularTodas = comValor.length <= 10;
  const poucos = serie.length <= 7;
  // Muitos dias: mostra só alguns rótulos para não encavalar.
  const passo = serie.length <= 10 ? 1 : Math.ceil(serie.length / 6);
  const unidade = agrupamento === "mes" ? "mês" : "dia";

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <span>
          <strong className="font-semibold text-ink">{formatarNumero(total)}</strong> no período
        </span>
        {pico && (
          <span>
            Melhor {unidade}: <strong className="font-semibold text-ink">{rotulo(pico.dia, agrupamento, false)}</strong> ({descrever(pico.valor)})
          </span>
        )}
        {comValor.length > 0 && (
          <span>
            {formatarNumero(comValor.length)} {comValor.length === 1 ? unidade : agrupamento === "mes" ? "meses" : "dias"} com matrícula
          </span>
        )}
      </figcaption>

      <div className="mt-2 flex gap-2" aria-hidden="true">
        {/* Eixo de valores: só os números; as linhas atravessam o gráfico. */}
        <div className="relative h-44 w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
          {marcas.map((marca) => (
            <span key={marca} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(marca / topo) * 100}%` }}>
              {formatarNumero(marca)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-44">
            {marcas.map((marca) => (
              <span
                key={marca}
                className={`absolute inset-x-0 h-px ${marca === 0 ? "bg-baseline" : "bg-grid"}`}
                style={{ bottom: `${(marca / topo) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end">
              {serie.map((ponto) => {
                const altura = (ponto.valor / topo) * 100;
                const rotular = ponto.valor > 0 && (rotularTodas || ponto === pico);
                return (
                  <div key={ponto.dia} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none">
                    {/* Faixa de foco/hover: o dia inteiro é o alvo, não só a coluna. */}
                    <span className="absolute inset-y-0 inset-x-px rounded-md transition-colors group-hover:bg-accent-soft group-focus-visible:bg-accent-soft group-focus-visible:ring-2 group-focus-visible:ring-accent" />
                    {rotular && (
                      // Fora do fluxo: a coluna ocupa exatamente a altura do valor; o número fica logo acima dela.
                      <span className="absolute text-[11px] font-semibold leading-none tabular-nums text-ink-2" style={{ bottom: `calc(${altura}% + 5px)` }}>
                        {formatarNumero(ponto.valor)}
                      </span>
                    )}
                    {ponto.valor > 0 && (
                      <span className="relative block w-3/4 max-w-[22px] rounded-t bg-graf-1" style={{ height: `${altura}%`, minHeight: 4 }} />
                    )}
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11px] text-surface shadow-pop group-hover:block group-focus:block">
                      <span className="block font-semibold capitalize">{rotuloLongo(ponto.dia, agrupamento)}</span>
                      {ponto.valor > 0 ? descrever(ponto.valor) : `Nenhuma ${descrever(1).replace(/^\S+\s/, "")}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex">
            {serie.map((ponto, indice) => (
              // A data pode ser mais larga que a coluna: transborda para as vizinhas, que ficam sem rótulo.
              <span key={ponto.dia} className="relative flex min-w-0 flex-1 justify-center text-xs text-ink-3">
                {indice % passo === 0 && <span className="whitespace-nowrap">{rotulo(ponto.dia, agrupamento, poucos)}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Os mesmos números em tabela, para quem usa leitor de tela. */}
      <div className="sr-only">
      <table>
        <caption>{rotuloAcessivel}</caption>
        <thead>
          <tr>
            <th scope="col">{agrupamento === "mes" ? "Mês" : "Dia"}</th>
            <th scope="col">Matrículas</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((ponto) => (
            <tr key={ponto.dia}>
              <td>{rotuloLongo(ponto.dia, agrupamento)}</td>
              <td>{formatarNumero(ponto.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
