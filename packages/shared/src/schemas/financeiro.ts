import { z } from "zod";
import { CATEGORIAS_TEMPLATE, PRECO_MENSAGEM_POR_CATEGORIA, type CategoriaTemplate } from "../precos.js";

// Tela Financeiro: o que a unidade gasta (mensagens de template, IA, lançamentos à mão) e o retorno.

// Preço da API da Anthropic em dólar por milhão de tokens (tabela oficial, out/2026). O modelo é achado
// pelo começo do nome; o mais específico vence (claude-opus-5-5 antes de claude-opus-5).
export const PRECO_IA_USD_POR_MILHAO: Array<{ prefixo: string; entrada: number; saida: number }> = [
  { prefixo: "claude-fable-5", entrada: 10, saida: 50 },
  { prefixo: "claude-mythos-5", entrada: 10, saida: 50 },
  { prefixo: "claude-opus-5-5", entrada: 4, saida: 20 },
  { prefixo: "claude-opus-5", entrada: 5, saida: 25 },
  { prefixo: "claude-opus-4", entrada: 5, saida: 25 },
  { prefixo: "claude-sonnet-5", entrada: 2, saida: 10 },
  { prefixo: "claude-sonnet-4", entrada: 3, saida: 15 },
  { prefixo: "claude-haiku-5", entrada: 0.1, saida: 0.5 },
  { prefixo: "claude-haiku-4", entrada: 1, saida: 5 },
];

// Modelo desconhecido: usa o preço do Opus atual (estimativa conservadora, nunca zero).
export function custoIaUsd(modelo: string, tokensEntrada: number, tokensSaida: number): number {
  const preco =
    [...PRECO_IA_USD_POR_MILHAO].sort((a, b) => b.prefixo.length - a.prefixo.length).find((p) => modelo.startsWith(p.prefixo)) ??
    PRECO_IA_USD_POR_MILHAO.find((p) => p.prefixo === "claude-opus-5-5")!;
  return (tokensEntrada * preco.entrada + tokensSaida * preco.saida) / 1_000_000;
}

const precoSchema = z.number().min(0, "Preço não pode ser negativo").max(10);

export const configFinanceiroSchema = z.object({
  // Quanto vale uma matrícula (para estimar a receita e o retorno). Nulo = não mostrar receita.
  ticketMedio: z.number().min(0).max(100_000).nullable().default(null),
  // Reais por dólar, para converter o custo da IA.
  cotacaoDolar: z.number().min(1).max(20).default(5.5),
  // Preço por mensagem de template, por categoria (o que o provedor do WhatsApp cobra da unidade).
  precos: z
    .object(Object.fromEntries(CATEGORIAS_TEMPLATE.map((c) => [c, precoSchema])) as Record<CategoriaTemplate, typeof precoSchema>)
    .default(PRECO_MENSAGEM_POR_CATEGORIA),
});
export type ConfigFinanceiro = z.infer<typeof configFinanceiroSchema>;

export const CONFIG_FINANCEIRO_PADRAO: ConfigFinanceiro = { ticketMedio: null, cotacaoDolar: 5.5, precos: { ...PRECO_MENSAGEM_POR_CATEGORIA } };

export const salvarLancamentoInputSchema = z.object({
  id: z.number().int().positive().optional(),
  descricao: z.string().trim().min(1, "Descreva o gasto").max(120),
  valor: z.number().positive("Valor maior que zero").max(1_000_000),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  recorrente: z.boolean().default(false),
});
