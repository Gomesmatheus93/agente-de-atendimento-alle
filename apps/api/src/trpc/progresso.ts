import { disparoDestinatarios, respostasClientes, type Db } from "@atendimento-academias/db";
import type { StatusEnvio } from "@atendimento-academias/shared";
import { count, countDistinct, inArray } from "drizzle-orm";

export type ProgressoPorStatus = Record<StatusEnvio, number> & { total: number };

export function progressoVazio(): ProgressoPorStatus {
  return { pendente: 0, enviado: 0, falhou: 0, total: 0 };
}

export async function carregarProgresso(db: Db, campanhaIds: number[]): Promise<Map<number, ProgressoPorStatus>> {
  const progressoPorCampanha = new Map<number, ProgressoPorStatus>();
  if (campanhaIds.length === 0) return progressoPorCampanha;

  const linhas = await db
    .select({
      campanhaId: disparoDestinatarios.campanhaId,
      statusEnvio: disparoDestinatarios.statusEnvio,
      total: count(),
    })
    .from(disparoDestinatarios)
    .where(inArray(disparoDestinatarios.campanhaId, campanhaIds))
    .groupBy(disparoDestinatarios.campanhaId, disparoDestinatarios.statusEnvio);

  for (const linha of linhas) {
    const atual = progressoPorCampanha.get(linha.campanhaId) ?? progressoVazio();
    atual[linha.statusEnvio] = linha.total;
    atual.total += linha.total;
    progressoPorCampanha.set(linha.campanhaId, atual);
  }

  return progressoPorCampanha;
}

// Quantas pessoas responderam a cada campanha (quem manda várias mensagens conta uma vez).
export async function carregarRespondentes(db: Db, campanhaIds: number[]): Promise<Map<number, number>> {
  const respondentesPorCampanha = new Map<number, number>();
  if (campanhaIds.length === 0) return respondentesPorCampanha;

  const linhas = await db
    .select({
      campanhaId: respostasClientes.campanhaId,
      total: countDistinct(respostasClientes.destinatarioId),
    })
    .from(respostasClientes)
    .where(inArray(respostasClientes.campanhaId, campanhaIds))
    .groupBy(respostasClientes.campanhaId);

  for (const linha of linhas) {
    if (linha.campanhaId !== null) respondentesPorCampanha.set(linha.campanhaId, linha.total);
  }

  return respondentesPorCampanha;
}

// O banco devolve decimal como texto; nulo significa campanha criada antes do cálculo de custo.
export function precoUnitarioDe(custoUnitario: string | null): number | null {
  return custoUnitario === null ? null : Number(custoUnitario);
}

export function taxa(parte: number, total: number): number | null {
  return total > 0 ? parte / total : null;
}
