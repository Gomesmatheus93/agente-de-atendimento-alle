import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { statusEnvioEnum } from "./enums.js";
import { campanhasDisparo } from "./campanhasDisparo.js";

export const disparoDestinatarios = pgTable(
  "disparo_destinatarios",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    campanhaId: integer("campanha_id")
      .notNull()
      .references(() => campanhasDisparo.id),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    // Valores dos placeholders do template ({{nome}} -> "Maria"), copiados para cada destinatário.
    parametros: jsonb("parametros").$type<Record<string, string>>().notNull(),
    statusEnvio: statusEnvioEnum("status_envio").notNull().default("pendente"),
    tentativas: integer("tentativas").notNull().default(0),
    erroDetalhe: text("erro_detalhe"),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    // Id da mensagem na Meta (wamid): é por ele que chegam pelo webhook os avisos de entregue e lida.
    mensagemExternaId: varchar("mensagem_externa_id", { length: 191 }),
    entregueEm: timestamp("entregue_em", { withTimezone: true }),
    lidaEm: timestamp("lida_em", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => ({
    campanhaTelefoneUnique: uniqueIndex("disparo_destinatarios_campanha_telefone_unique").on(
      table.campanhaId,
      table.telefone,
    ),
    mensagemExternaIdx: index("disparo_destinatarios_mensagem_externa_idx").on(table.mensagemExternaId),
  }),
);
