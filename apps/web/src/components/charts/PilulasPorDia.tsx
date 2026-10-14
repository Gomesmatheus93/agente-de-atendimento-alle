import { formatarDiaCurto, formatarNumero } from "../../lib/format.js";

export interface PontoPilula {
  dia: string;
  enviado: number;
  falhou: number;
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

// Envios por dia em "pílulas", como no modelo: cada coluna tem um trilho listrado (o espaço do dia) e a
// pílula roxa sobe do fundo na altura do que foi enviado. Uma série só, então o título nomeia e não há
// legenda; o dia de pico ganha a etiqueta com o número, e cada coluna mostra o detalhe ao passar o mouse.
export function PilulasPorDia({ serie, agrupamento }: { serie: PontoPilula[]; agrupamento: "dia" | "mes" }) {
  const maior = Math.max(...serie.map((ponto) => ponto.enviado), 0);
  const pico = maior > 0 ? serie.findIndex((ponto) => ponto.enviado === maior) : -1;
  const poucos = serie.length <= 7;
  // Muitos dias: mostra só alguns rótulos para não encavalar.
  const passo = serie.length <= 10 ? 1 : Math.ceil(serie.length / 8);

  return (
    <div className="flex flex-col gap-2" role="img" aria-label={`Mensagens enviadas por ${agrupamento === "mes" ? "mês" : "dia"}`}>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2.5">
        {serie.map((ponto, indice) => {
          const altura = maior > 0 ? Math.max(ponto.enviado > 0 ? 14 : 0, (ponto.enviado / maior) * 100) : 0;
          const ehPico = indice === pico;
          return (
            <div key={ponto.dia} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none">
              {/* Trilho listrado: o "espaço" do dia, visível mesmo sem envio. */}
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, var(--color-graf-trilho) 0 5px, transparent 5px 9px)",
                }}
              />
              {altura > 0 && (
                <span
                  className={`relative block w-full rounded-full transition-[filter] group-hover:brightness-110 ${ehPico ? "bg-accent" : "bg-graf-1/75"}`}
                  style={{ height: `${altura}%` }}
                />
              )}
              {ehPico && (
                <span className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-card-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink shadow-card" style={{ bottom: `calc(${altura}% + 6px)` }}>
                  {formatarNumero(ponto.enviado)}
                </span>
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11px] text-surface shadow-pop group-hover:block group-focus:block">
                <span className="block font-semibold capitalize">{rotuloLongo(ponto.dia, agrupamento)}</span>
                {formatarNumero(ponto.enviado)} enviadas{ponto.falhou > 0 ? ` · ${formatarNumero(ponto.falhou)} falhas` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 sm:gap-2.5">
        {serie.map((ponto, indice) => (
          <span key={ponto.dia} className="min-w-0 flex-1 truncate text-center text-xs text-ink-3">
            {indice % passo === 0 ? rotulo(ponto.dia, agrupamento, poucos) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
