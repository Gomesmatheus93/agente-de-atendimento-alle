import { boolean, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { unidades } from "./unidades.js";
import { papelUsuarioEnum } from "./enums.js";

export const usuarios = pgTable("usuarios", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  nome: varchar("nome", { length: 120 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // scrypt: "scrypt$<salt em hex>$<derivado em hex>". Nunca guarda a senha.
  senhaHash: varchar("senha_hash", { length: 255 }).notNull(),
  // superadmin: dono da plataforma (sem unidade). admin: dono da unidade. membro: funcionário.
  papel: papelUsuarioEnum("papel").notNull().default("membro"),
  // Nulo só para o superadmin; todo o resto pertence a uma unidade e só enxerga os dados dela.
  unidadeId: integer("unidade_id").references(() => unidades.id, { onDelete: "cascade" }),
  ativo: boolean("ativo").notNull().default(true),
  // Check-in: disponível entra na fila de atendimento humano da unidade.
  disponivel: boolean("disponivel").notNull().default(false),
  disponivelDesde: timestamp("disponivel_desde", { withTimezone: true }),
  // Quando recebeu o último cliente da fila: quem está há mais tempo sem receber é o próximo.
  ultimaAtribuicaoEm: timestamp("ultima_atribuicao_em", { withTimezone: true }),
  ...timestamps(),
}, (tabela) => [index("usuarios_unidade").on(tabela.unidadeId)]);

// Sessão do painel. O token vai num cookie httpOnly; apagar a linha desliga o acesso na hora.
export const sessoes = pgTable(
  "sessoes",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    // Unidade que o superadmin escolheu ver nesta sessão (os demais usam a própria unidade).
    unidadeId: integer("unidade_id").references(() => unidades.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("sessoes_usuario").on(tabela.usuarioId)],
);
