import { useId } from "react";

interface SparklineProps {
  // null = dia sem dado (ex.: taxa num dia sem envios); é ignorado em vez de virar um mergulho até zero.
  valores: Array<number | null>;
  // Classe de cor do texto (a linha e o degradê usam currentColor).
  className?: string;
}

// Minigráfico de tendência para os cards de indicador. É decorativo: o número ao lado já diz o valor.
// Dias iniciais sem nenhuma atividade só alongam a linha reta; corta-os, mantendo ao menos uma semana.
const MIN_PONTOS_APOS_CORTE = 7;

function prepararSerie(valores: Array<number | null>): number[] {
  const preenchidos = valores.filter((valor): valor is number => valor !== null);
  const primeiroComDado = preenchidos.findIndex((valor) => valor !== 0);
  if (primeiroComDado <= 0) return preenchidos;
  return preenchidos.slice(Math.min(primeiroComDado, Math.max(0, preenchidos.length - MIN_PONTOS_APOS_CORTE)));
}

export function Sparkline({ valores: valoresBrutos, className = "text-accent-text" }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  const valores = prepararSerie(valoresBrutos);
  if (valores.length < 2) return null;

  const largura = 100;
  const altura = 32;
  const margem = 3;
  const minimo = Math.min(...valores);
  const amplitude = Math.max(...valores) - minimo || 1;

  const pontos = valores.map((valor, indice) => {
    const x = (indice / (valores.length - 1)) * largura;
    const y = altura - margem - ((valor - minimo) / amplitude) * (altura - margem * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linha = `M${pontos.join(" L")}`;

  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true" className={`h-9 w-24 min-w-8 shrink ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${linha} L${largura},${altura} L0,${altura} Z`} fill={`url(#${id})`} />
      <path d={linha} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
