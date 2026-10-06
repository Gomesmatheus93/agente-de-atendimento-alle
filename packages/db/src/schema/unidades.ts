import { boolean, integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";

// Cada unidade (academia) é um painel separado: números, conversas, campanhas, templates, configurações e
// equipe próprios. Nada de uma aparece na outra; só o superadmin enxerga todas.
export const unidades = pgTable("unidades", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  nome: varchar("nome", { length: 120 }).notNull(),
  // Unidade desativada: a equipe dela não entra e as mensagens dos números dela são ignoradas.
  ativo: boolean("ativo").notNull().default(true),
  ...timestamps(),
});
