import { pgEnum, pgTable, primaryKey, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { unidades } from "./unidades.js";

export const ORIGENS_DESCADASTRO = ["cliente", "equipe", "meta"] as const;
export const origemDescadastroEnum = pgEnum("origem_descadastro", ORIGENS_DESCADASTRO);

// Quem pediu para não receber mais campanhas da unidade (opt-out). Campanha nenhuma dispara para esses
// telefones: protege a nota de qualidade do número na Meta e atende a LGPD. Mensagens de atendimento
// (respostas a quem escreveu) continuam permitidas.
// origem: o próprio cliente ("sair", botão "Parar promoções"), a equipe pelo painel, ou a Meta (erro 131050).
export const descadastros = pgTable(
  "descadastros",
  {
    unidadeId: integer("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    origem: origemDescadastroEnum("origem").notNull(),
    motivo: varchar("motivo", { length: 300 }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [primaryKey({ columns: [tabela.unidadeId, tabela.telefone] })],
);
