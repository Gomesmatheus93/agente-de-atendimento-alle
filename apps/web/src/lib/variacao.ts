import type { Variacao } from "../components/charts/StatTile.js";

export function variacaoPercentual(atual: number, anterior: number, altaEhBoa: boolean): Variacao {
  if (anterior === 0) {
    return atual === 0
      ? { texto: "sem variação", direcao: "estavel", altaEhBoa }
      : { texto: "sem base de comparação", direcao: "estavel", altaEhBoa };
  }
  const pct = ((atual - anterior) / anterior) * 100;
  if (Math.abs(pct) < 0.5) return { texto: "sem variação", direcao: "estavel", altaEhBoa };
  const numero = Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return { texto: `${pct > 0 ? "+" : "−"}${numero}%`, direcao: pct > 0 ? "alta" : "queda", altaEhBoa };
}

// Diferença entre duas taxas (frações), em pontos percentuais.
export function variacaoEmPontos(atual: number | null, anterior: number | null): Variacao | undefined {
  if (atual === null || anterior === null) return undefined;
  const pontos = (atual - anterior) * 100;
  if (Math.abs(pontos) < 0.05) return { texto: "sem variação", direcao: "estavel", altaEhBoa: true };
  const numero = Math.abs(pontos).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return { texto: `${pontos > 0 ? "+" : "−"}${numero} p.p.`, direcao: pontos > 0 ? "alta" : "queda", altaEhBoa: true };
}
