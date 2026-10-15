import type { Db } from "@atendimento-academias/db";
import { CONFIG_FINANCEIRO_PADRAO, configFinanceiroSchema, type ConfigFinanceiro } from "@atendimento-academias/shared";
import { lerValor, salvarValor } from "../config/plataforma.js";

// Configuração financeira da unidade (ticket médio, cotação do dólar, preço por categoria de template).
export const CHAVE_CONFIG_FINANCEIRO = "financeiro.config";

export async function lerConfigFinanceiro(db: Db, unidadeId: number): Promise<ConfigFinanceiro> {
  const bruto = await lerValor(db, unidadeId, CHAVE_CONFIG_FINANCEIRO);
  if (!bruto) return CONFIG_FINANCEIRO_PADRAO;
  const lido = configFinanceiroSchema.safeParse(JSON.parse(bruto));
  return lido.success ? lido.data : CONFIG_FINANCEIRO_PADRAO;
}

export async function salvarConfigFinanceiro(db: Db, unidadeId: number, config: ConfigFinanceiro): Promise<void> {
  await salvarValor(db, unidadeId, CHAVE_CONFIG_FINANCEIRO, JSON.stringify(config));
}
