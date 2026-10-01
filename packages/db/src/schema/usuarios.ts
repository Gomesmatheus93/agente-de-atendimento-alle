import { boolean, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { papelUsuarioEnum } from "./enums.js";

export const usuarios = pgTable("usuarios", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  nome: varchar("nome", { length: 120 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // scrypt: "scrypt$<salt em hex>$<derivado em hex>". Nunca guarda a senha.
  senhaHash: varchar("senha_hash", { length: 255 }).notNull(),
  // admin também gerencia usuários; membro usa o resto do painel. O primeiro acesso cria um admin.
  papel: papelUsuarioEnum("papel").notNull().default("membro"),
  ativo: boolean("ativo").notNull().default(true),
  ...timestamps(),
});

// Sessão do painel. O token vai num cookie httpOnly; apagar a linha desliga o acesso na hora.
export const sessoes = pgTable(
  "sessoes",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("sessoes_usuario").on(tabela.usuarioId)],
);
