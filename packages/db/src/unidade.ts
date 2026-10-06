import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "./client.js";
import { numerosWhatsapp } from "./schema/whatsapp.js";

// Conversas, mensagens, funil e dúvidas não guardam a unidade: pertencem ao número, e o número à unidade.
// Este filtro é o que separa uma unidade da outra em toda consulta por número.
export function doNumeroDaUnidade(colunaNumeroId: PgColumn, unidadeId: number): SQL {
  return sql`${colunaNumeroId} in (select ${numerosWhatsapp.id} from ${numerosWhatsapp} where ${numerosWhatsapp.unidadeId} = ${unidadeId})`;
}

export async function unidadeDoNumero(db: Db, numeroId: number): Promise<number | null> {
  const [linha] = await db.select({ unidadeId: numerosWhatsapp.unidadeId }).from(numerosWhatsapp).where(eq(numerosWhatsapp.id, numeroId));
  return linha?.unidadeId ?? null;
}
