import { z } from "zod";

export const CATEGORIAS_TEMPLATE = ["marketing", "utilidade", "autenticacao", "servico"] as const;

export const categoriaTemplateSchema = z.enum(CATEGORIAS_TEMPLATE);

export type CategoriaTemplate = (typeof CATEGORIAS_TEMPLATE)[number];

export const ROTULO_CATEGORIA: Record<CategoriaTemplate, string> = {
  marketing: "Marketing",
  utilidade: "Utilidade",
  autenticacao: "Autenticação",
  servico: "Serviço",
};

// Preço em reais por mensagem entregue, por categoria de template. São valores de referência:
// ajuste para o que o seu agregador de WhatsApp cobra de fato. Cada campanha guarda o preço vigente
// no momento em que foi criada, então mudar esta tabela não altera o custo de campanhas antigas.
export const PRECO_MENSAGEM_POR_CATEGORIA: Record<CategoriaTemplate, number> = {
  marketing: 0.35,
  utilidade: 0.05,
  autenticacao: 0.05,
  servico: 0,
};

export function precoDaCategoria(categoria: CategoriaTemplate): number {
  return PRECO_MENSAGEM_POR_CATEGORIA[categoria];
}

// Arredonda em 4 casas decimais (a precisão guardada no banco) para não acumular erro de ponto flutuante.
export function calcularCusto(quantidade: number, precoUnitario: number): number {
  return Math.round(quantidade * precoUnitario * 10_000) / 10_000;
}
