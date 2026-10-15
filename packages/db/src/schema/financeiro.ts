import { boolean, date, index, integer, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { unidades } from "./unidades.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Uso da IA pela plataforma (fora as sugestões, que já guardam os tokens em sugestoes_ia): a análise das
// conversas para o funil. É o que a tela Financeiro converte em reais.
export const usoIa = pgTable(
  "uso_ia",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    numeroId: integer("numero_id").references(() => numerosWhatsapp.id, { onDelete: "cascade" }),
    origem: varchar("origem", { length: 20 }).$type<"analise">().notNull(),
    modelo: varchar("modelo", { length: 64 }).notNull(),
    tokensEntrada: integer("tokens_entrada").notNull(),
    tokensSaida: integer("tokens_saida").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("uso_ia_numero_criado").on(tabela.numeroId, tabela.criadoEm)],
);

// Gastos que o sistema não vê sozinho (servidor, n8n, a IA do bot no n8n, mensalidades...): lançados à mão.
// "recorrente": repete todo mês, no mesmo dia, a partir da data.
export const lancamentosFinanceiros = pgTable(
  "lancamentos_financeiros",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    unidadeId: integer("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
    descricao: varchar("descricao", { length: 120 }).notNull(),
    valor: numeric("valor", { precision: 12, scale: 2 }).notNull(),
    data: date("data", { mode: "string" }).notNull(),
    recorrente: boolean("recorrente").notNull().default(false),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("lancamentos_financeiros_unidade").on(tabela.unidadeId, tabela.data)],
);
