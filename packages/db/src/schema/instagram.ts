import { date, integer, jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { unidades } from "./unidades.js";

// Conta profissional do Instagram de cada unidade, conectada pelo botão "Conectar Instagram" (login do
// Instagram). Uma por unidade, e a mesma conta não pode estar em duas unidades.
export const contasInstagram = pgTable("contas_instagram", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  unidadeId: integer("unidade_id")
    .notNull()
    .unique()
    .references(() => unidades.id, { onDelete: "cascade" }),
  igUserId: varchar("ig_user_id", { length: 40 }).notNull().unique(),
  username: varchar("username", { length: 100 }).notNull(),
  nome: varchar("nome", { length: 150 }),
  fotoUrl: varchar("foto_url", { length: 1000 }),
  // Token de longa duração (60 dias), cifrado; o worker renova antes de vencer.
  tokenCifrado: text("token_cifrado").notNull(),
  tokenExpiraEm: timestamp("token_expira_em", { withTimezone: true }),
  ultimaColetaEm: timestamp("ultima_coleta_em", { withTimezone: true }),
  // Último problema ao falar com a Meta (token revogado, permissão retirada...): a tela mostra.
  erroColeta: varchar("erro_coleta", { length: 500 }),
  ...timestamps(),
});

// "Foto" diária dos números da conta. A Meta só devolve parte do histórico (seguidores, por exemplo, só
// dos últimos 30 dias), então o worker guarda um dia por linha para dar para comparar meses.
// metricas: reach, views, profile_views, accounts_engaged, total_interactions, website_clicks... (o que a
// Meta entregar para a conta; métrica que ela recusa simplesmente não entra).
export const instagramMetricasDiarias = pgTable(
  "instagram_metricas_diarias",
  {
    contaId: integer("conta_id")
      .notNull()
      .references(() => contasInstagram.id, { onDelete: "cascade" }),
    dia: date("dia", { mode: "string" }).notNull(),
    seguidores: integer("seguidores"),
    metricas: jsonb("metricas").$type<Record<string, number>>().notNull().default({}),
    ...timestamps(),
  },
  (tabela) => [primaryKey({ columns: [tabela.contaId, tabela.dia] })],
);
