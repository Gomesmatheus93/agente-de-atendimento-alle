import { date, index, integer, jsonb, pgEnum, pgTable, primaryKey, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { unidades } from "./unidades.js";

export const ORIGENS_CONTATO = ["importacao", "conversa", "manual"] as const;
export const origemContatoEnum = pgEnum("origem_contato", ORIGENS_CONTATO);

// Base de contatos de cada unidade: alunos, leads e ex-alunos importados de planilha, cadastrados à mão
// ou que chegaram escrevendo no WhatsApp. É daqui que saem os segmentos das campanhas.
// (A tabela "contatos" continua guardando só o nome do perfil do WhatsApp, por telefone.)
export const contatosUnidade = pgTable(
  "contatos_unidade",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    unidadeId: integer("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
    // Normalizado como nas campanhas (55 + DDD + número).
    telefone: varchar("telefone", { length: 20 }).notNull(),
    nome: varchar("nome", { length: 150 }),
    email: varchar("email", { length: 200 }),
    // Para a mensagem de aniversário (só dia e mês importam; o ano pode ser qualquer um).
    nascimento: date("nascimento", { mode: "string" }),
    origem: origemContatoEnum("origem").notNull(),
    ...timestamps(),
  },
  (tabela) => [unique("contatos_unidade_telefone").on(tabela.unidadeId, tabela.telefone), index("contatos_unidade_telefone_idx").on(tabela.telefone)],
);

// Etiquetas da unidade (aluno, lead, ex-aluno, plano anual...). A cor é uma das cores da paleta da tela.
export const etiquetas = pgTable(
  "etiquetas",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    unidadeId: integer("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
    nome: varchar("nome", { length: 40 }).notNull(),
    cor: varchar("cor", { length: 20 }).notNull().default("roxo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [unique("etiquetas_unidade_nome").on(tabela.unidadeId, tabela.nome)],
);

export const contatoEtiquetas = pgTable(
  "contato_etiquetas",
  {
    contatoId: integer("contato_id")
      .notNull()
      .references(() => contatosUnidade.id, { onDelete: "cascade" }),
    etiquetaId: integer("etiqueta_id")
      .notNull()
      .references(() => etiquetas.id, { onDelete: "cascade" }),
  },
  (tabela) => [primaryKey({ columns: [tabela.contatoId, tabela.etiquetaId] }), index("contato_etiquetas_etiqueta").on(tabela.etiquetaId)],
);

// Segmento salvo: um filtro da base de contatos com nome ("ex-alunos sem conversa há 30 dias"). A lista de
// quem está nele é calculada na hora, então quem entra ou sai da condição já aparece na próxima campanha.
export const segmentos = pgTable("segmentos", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  unidadeId: integer("unidade_id")
    .notNull()
    .references(() => unidades.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 80 }).notNull(),
  filtro: jsonb("filtro").$type<Record<string, unknown>>().notNull(),
  ...timestamps(),
});
