import { index, integer, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { unidades } from "./unidades.js";
import { usuarios } from "./usuarios.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Textos prontos da unidade (preços, horários, endereço...). No chat, "/" + atalho puxa o texto.
export const respostasRapidas = pgTable(
  "respostas_rapidas",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    unidadeId: integer("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
    atalho: varchar("atalho", { length: 30 }).notNull(),
    texto: text("texto").notNull(),
    ...timestamps(),
  },
  (tabela) => [unique("respostas_rapidas_atalho").on(tabela.unidadeId, tabela.atalho)],
);

// Anotação da equipe numa conversa. Nunca vai para o cliente, nem para o bot/IA (fica fora da conversa
// que a API de integração devolve).
export const notasConversa = pgTable(
  "notas_conversa",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    numeroId: integer("numero_id")
      .notNull()
      .references(() => numerosWhatsapp.id, { onDelete: "cascade" }),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    autorId: integer("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    // Guardado junto: a nota continua dizendo quem escreveu mesmo se a pessoa sair da equipe.
    autorNome: varchar("autor_nome", { length: 120 }).notNull(),
    texto: varchar("texto", { length: 2000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("notas_conversa_conversa").on(tabela.numeroId, tabela.telefone, tabela.createdAt)],
);
