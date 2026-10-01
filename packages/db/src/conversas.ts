import { and, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { conversasExcluidas } from "./schema/conversasConfig.js";

// Até quando a conversa foi excluída (nulo = nunca). Quem monta a conversa ignora o que veio até aqui.
export async function conversaExcluidaEm(db: Db, telefone: string, numeroId: number): Promise<Date | null> {
  const [linha] = await db
    .select({ em: conversasExcluidas.excluidaEm })
    .from(conversasExcluidas)
    .where(and(eq(conversasExcluidas.numeroId, numeroId), eq(conversasExcluidas.telefone, telefone)));
  return linha?.em ?? null;
}
