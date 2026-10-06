import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { numerosWhatsapp } from "./schema/whatsapp.js";

// Conversas, mensagens, funil e dúvidas não guardam a unidade: pertencem ao número, e o número à unidade.
// Este filtro é o que separa uma unidade da outra em toda consulta por número.
export function doNumeroDaUnidade(colunaNumeroId: PgColumn, unidadeId: number): SQL {
  return sql`${colunaNumeroId} in (select ${numerosWhatsapp.id} from ${numerosWhatsapp} where ${numerosWhatsapp.unidadeId} = ${unidadeId})`;
}
