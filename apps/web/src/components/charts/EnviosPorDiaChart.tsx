import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatarDiaCurto, formatarDiaLongo, formatarNumero } from "../../lib/format.js";
import { Card } from "../Card.js";
import { Button } from "../ui/Button.js";
import { useLargura } from "./useLargura.js";

export interface PontoDia {
  dia: string;
  enviado: number;
  falhou: number;
  pendente: number;
}

const SERIES = [
  { chave: "enviado", rotulo: "Enviado", cor: "var(--color-status-enviado)" },
  { chave: "falhou", rotulo: "Falhou", cor: "var(--color-status-falhou)" },
  { chave: "pendente", rotulo: "Pendente", cor: "var(--color-status-pendente)" },
] as const;

const ALTURA = 280;
const MARGEM = { topo: 24, direita: 8, base: 30, esquerda: 44 };
const LARGURA_MAX_BARRA = 24;
const VAO = 2;
const RAIO = 4;
const LARGURA_MIN_ROTULO = 48;

function total(ponto: PontoDia): number {
  return ponto.enviado + ponto.falhou + ponto.pendente;
}

function escalaEixo(maximo: number): { topo: number; ticks: number[] } {
  const bruto = Math.max(maximo, 4) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitude;
  const passo = (normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10) * magnitude;
  const topo = Math.max(Math.ceil(maximo / passo) * passo, passo * 2);

  const ticks: number[] = [];
  for (let valor = 0; valor <= topo; valor += passo) ticks.push(valor);
  return { topo, ticks };
}

function caminhoTopoArredondado(x: number, y: number, largura: number, altura: number): string {
  const r = Math.min(RAIO, altura, largura / 2);
  return `M${x},${y + altura} V${y + r} Q${x},${y} ${x + r},${y} H${x + largura - r} Q${x + largura},${y} ${x + largura},${y + r} V${y + altura} Z`;
}

export function EnviosPorDiaChart({ serie }: { serie: PontoDia[] }) {
  const [modo, setModo] = useState<"grafico" | "tabela">("grafico");
  const [ativo, setAtivo] = useState<number | null>(null);
  const { ref, largura } = useLargura<HTMLDivElement>();

  const totalGeral = useMemo(() => serie.reduce((soma, ponto) => soma + total(ponto), 0), [serie]);
  const maiorTotal = useMemo(() => Math.max(0, ...serie.map(total)), [serie]);
  const { topo: topoEixo, ticks } = useMemo(() => escalaEixo(maiorTotal), [maiorTotal]);
  const indiceDoMaior = maiorTotal > 0 ? serie.findIndex((ponto) => total(ponto) === maiorTotal) : -1;

  const areaLargura = Math.max(largura - MARGEM.esquerda - MARGEM.direita, 0);
  const areaAltura = ALTURA - MARGEM.topo - MARGEM.base;
  const faixa = serie.length > 0 ? areaLargura / serie.length : 0;
  const yBase = MARGEM.topo + areaAltura;
  const escala = areaAltura / topoEixo;
  const passoRotulo = Math.max(1, Math.ceil(LARGURA_MIN_ROTULO / Math.max(faixa, 1)));

  function indiceDoPonteiro(evento: PointerEvent<SVGRectElement>): number {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const indice = Math.floor((evento.clientX - caixa.left) / faixa);
    return Math.min(serie.length - 1, Math.max(0, indice));
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    const ultimo = serie.length - 1;
    const atual = ativo ?? ultimo;
    const proximo: Record<string, number> = {
      ArrowLeft: Math.max(0, atual - 1),
      ArrowRight: Math.min(ultimo, atual + 1),
      Home: 0,
      End: ultimo,
    };

    if (evento.key === "Escape") return setAtivo(null);
    if (evento.key in proximo) {
      evento.preventDefault();
      setAtivo(proximo[evento.key]!);
    }
  }

  const pontoAtivo = ativo !== null ? serie[ativo] : undefined;
  const xAtivo = ativo !== null ? MARGEM.esquerda + (ativo + 0.5) * faixa : 0;
  const deslocamentoTooltip =
    xAtivo < 110 ? "translateX(-12px)" : xAtivo > largura - 110 ? "translateX(calc(-100% + 12px))" : "translateX(-50%)";

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-bold">Envios por dia</h3>
          <p className="text-xs text-ink-3">
            <strong className="tabular-nums text-ink-2">{formatarNumero(totalGeral)}</strong> mensagens no período
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {modo === "grafico" && (
            <ul className="flex items-center gap-4 text-xs text-ink-2">
              {SERIES.map((item) => (
                <li key={item.chave} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.cor }} />
                  {item.rotulo}
                </li>
              ))}
            </ul>
          )}
          <Button variante="secundario" className="px-3 py-1 text-xs" onClick={() => setModo(modo === "grafico" ? "tabela" : "grafico")}>
            {modo === "grafico" ? "Ver como tabela" : "Ver gráfico"}
          </Button>
        </div>
      </div>

      {modo === "tabela" ? (
        <div className="max-h-[280px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-card-border text-xs text-ink-2">
                <th className="pb-2 font-medium">Dia</th>
                <th className="pb-2 text-right font-medium">Enviado</th>
                <th className="pb-2 text-right font-medium">Falhou</th>
                <th className="pb-2 text-right font-medium">Pendente</th>
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {serie.map((ponto) => (
                <tr key={ponto.dia} className="border-b border-card-border last:border-0">
                  <td className="py-1.5">{formatarDiaLongo(ponto.dia)}</td>
                  <td className="py-1.5 text-right">{formatarNumero(ponto.enviado)}</td>
                  <td className="py-1.5 text-right">{formatarNumero(ponto.falhou)}</td>
                  <td className="py-1.5 text-right">{formatarNumero(ponto.pendente)}</td>
                  <td className="py-1.5 text-right font-medium">{formatarNumero(total(ponto))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative"
          style={{ height: ALTURA }}
          tabIndex={0}
          role="group"
          aria-label="Gráfico de envios por dia. Use as setas para percorrer os dias."
          onKeyDown={aoTeclar}
          onFocus={() => setAtivo((atual) => atual ?? serie.length - 1)}
          onBlur={() => setAtivo(null)}
        >
          {totalGeral === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-2">
              Nenhum envio no período selecionado.
            </p>
          )}

          {largura > 0 && (
            <svg width={largura} height={ALTURA} aria-hidden="true" className="block">
              {ticks.map((valor) => {
                const y = yBase - valor * escala;
                return (
                  <g key={valor}>
                    <line
                      x1={MARGEM.esquerda}
                      x2={largura - MARGEM.direita}
                      y1={y}
                      y2={y}
                      stroke={valor === 0 ? "var(--color-baseline)" : "var(--color-grid)"}
                      strokeWidth={1}
                    />
                    <text x={MARGEM.esquerda - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="tabular-nums">
                      {formatarNumero(valor)}
                    </text>
                  </g>
                );
              })}

              {ativo !== null && (
                <rect x={MARGEM.esquerda + ativo * faixa} y={MARGEM.topo} width={faixa} height={areaAltura} fill="var(--color-ink)" fillOpacity={0.06} />
              )}

              {serie.map((ponto, indice) => {
                const larguraBarra = Math.min(LARGURA_MAX_BARRA, Math.max(4, faixa - 6));
                const x = MARGEM.esquerda + indice * faixa + (faixa - larguraBarra) / 2;
                const segmentos = SERIES.map((item) => ({ ...item, valor: ponto[item.chave] })).filter((item) => item.valor > 0);
                let acumulado = 0;

                return (
                  <g key={ponto.dia}>
                    {segmentos.map((segmento, posicao) => {
                      const yFundo = yBase - acumulado * escala;
                      const yTopo = yBase - (acumulado + segmento.valor) * escala;
                      acumulado += segmento.valor;
                      const altura = Math.max(1, yFundo - yTopo - (posicao > 0 ? VAO : 0));
                      const ehTopo = posicao === segmentos.length - 1;

                      return ehTopo ? (
                        <path key={segmento.chave} d={caminhoTopoArredondado(x, yTopo, larguraBarra, altura)} fill={segmento.cor} />
                      ) : (
                        <rect key={segmento.chave} x={x} y={yTopo} width={larguraBarra} height={altura} fill={segmento.cor} />
                      );
                    })}

                    {indice === indiceDoMaior && (
                      <text
                        x={x + larguraBarra / 2}
                        y={yBase - total(ponto) * escala - 6}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--color-ink-2)"
                        className="tabular-nums"
                      >
                        {formatarNumero(total(ponto))}
                      </text>
                    )}

                    {(serie.length - 1 - indice) % passoRotulo === 0 && (
                      <text x={MARGEM.esquerda + (indice + 0.5) * faixa} y={ALTURA - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                        {formatarDiaCurto(ponto.dia)}
                      </text>
                    )}
                  </g>
                );
              })}

              <rect
                x={MARGEM.esquerda}
                y={MARGEM.topo}
                width={areaLargura}
                height={areaAltura}
                fill="transparent"
                onPointerMove={(evento) => setAtivo(indiceDoPonteiro(evento))}
                onPointerDown={(evento) => setAtivo(indiceDoPonteiro(evento))}
                onPointerLeave={() => setAtivo(null)}
              />
            </svg>
          )}

          {pontoAtivo && (
            <div
              className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-card-border bg-surface px-3 py-2 text-xs shadow-pop"
              style={{ left: xAtivo, top: 4, transform: deslocamentoTooltip }}
            >
              <p className="mb-1 font-medium text-ink-2">{formatarDiaLongo(pontoAtivo.dia)}</p>
              <ul className="flex flex-col gap-1">
                {SERIES.map((item) => (
                  <li key={item.chave} className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.cor }} />
                    <span className="text-ink-2">{item.rotulo}</span>
                    <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{formatarNumero(pontoAtivo[item.chave])}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex justify-between border-t border-card-border pt-1.5 text-ink-2">
                Total <span className="font-semibold tabular-nums text-ink">{formatarNumero(total(pontoAtivo))}</span>
              </p>
            </div>
          )}

          <p className="sr-only" aria-live="polite">
            {pontoAtivo
              ? `${formatarDiaLongo(pontoAtivo.dia)}: ${pontoAtivo.enviado} enviados, ${pontoAtivo.falhou} falhas, ${pontoAtivo.pendente} pendentes.`
              : ""}
          </p>
        </div>
      )}
    </Card>
  );
}
