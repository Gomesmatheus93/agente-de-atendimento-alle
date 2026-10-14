import { formatarNumero, formatarPercentual } from "../../lib/format.js";

export interface FatiaMedidor {
  chave: string;
  rotulo: string;
  valor: number;
  // "listras" = textura (sem cor de categoria), usada para o que não deu certo.
  cor: "graf-1" | "graf-2" | "listras";
}

const RAIO = 80;
const ESPESSURA = 24;
const CENTRO_X = 100;
const CENTRO_Y = 96;
// 2px de folga entre as fatias, medido no arco.
const FOLGA = 2 / RAIO;

function ponto(angulo: number): [number, number] {
  return [CENTRO_X + RAIO * Math.cos(angulo), CENTRO_Y - RAIO * Math.sin(angulo)];
}

function arco(inicio: number, fim: number): string {
  const [x1, y1] = ponto(inicio);
  const [x2, y2] = ponto(fim);
  return `M ${x1} ${y1} A ${RAIO} ${RAIO} 0 0 1 ${x2} ${y2}`;
}

// Meia-lua do modelo ("Project Progress"): fatias na ordem da legenda, da esquerda para a direita; o número
// do meio é o destaque. Legenda sempre presente (3 séries) e cada fatia diz o valor ao passar o mouse.
export function MedidorFunil({ fatias, destaque, legendaDestaque }: { fatias: FatiaMedidor[]; destaque: number | null; legendaDestaque: string }) {
  const total = fatias.reduce((soma, fatia) => soma + fatia.valor, 0);
  let angulo = Math.PI;
  const arcos = fatias
    .filter((fatia) => fatia.valor > 0)
    .map((fatia) => {
      const tamanho = (fatia.valor / total) * Math.PI;
      const inicio = angulo;
      angulo -= tamanho;
      return { ...fatia, d: arco(inicio - (inicio === Math.PI ? 0 : FOLGA / 2), angulo + (angulo <= 1e-6 ? 0 : FOLGA / 2)) };
    });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 200 110" className="w-full max-w-[260px]" role="img" aria-label={`${legendaDestaque}: ${destaque === null ? "sem dados" : formatarPercentual(destaque)}`}>
        <defs>
          <pattern id="listras-medidor" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--color-surface)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-baseline)" strokeWidth="3" />
          </pattern>
        </defs>
        {/* Trilho: a meia-lua inteira, para quando ainda não há nada. */}
        <path d={arco(Math.PI, 0)} fill="none" stroke="var(--color-graf-trilho)" strokeWidth={ESPESSURA} />
        {arcos.map((fatia) => (
          <path
            key={fatia.chave}
            d={fatia.d}
            fill="none"
            stroke={fatia.cor === "listras" ? "url(#listras-medidor)" : `var(--color-${fatia.cor})`}
            strokeWidth={ESPESSURA}
          >
            <title>{`${fatia.rotulo}: ${formatarNumero(fatia.valor)} (${formatarPercentual(fatia.valor / total)})`}</title>
          </path>
        ))}
        <text x={CENTRO_X} y={CENTRO_Y - 14} textAnchor="middle" className="fill-ink font-heading" style={{ fontSize: 34, fontWeight: 700 }}>
          {destaque === null ? "—" : formatarPercentual(destaque)}
        </text>
        <text x={CENTRO_X} y={CENTRO_Y + 4} textAnchor="middle" className="fill-ink-3" style={{ fontSize: 10 }}>
          {legendaDestaque}
        </text>
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-ink-2">
        {fatias.map((fatia) => (
          <li key={fatia.chave} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full"
              style={
                fatia.cor === "listras"
                  ? { backgroundImage: "repeating-linear-gradient(135deg, var(--color-baseline) 0 2px, transparent 2px 4px)", boxShadow: "inset 0 0 0 1px var(--color-baseline)" }
                  : { backgroundColor: `var(--color-${fatia.cor})` }
              }
            />
            {fatia.rotulo} <strong className="tabular font-semibold text-ink">{formatarNumero(fatia.valor)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
