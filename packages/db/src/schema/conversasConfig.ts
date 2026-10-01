import { boolean, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Preferências de cada conversa (uma linha por telefone). A conversa em si não é uma tabela:
// ela é montada a partir das respostas, dos disparos e das mensagens de saída.
export const conversasConfig = pgTable("conversas_config", {
  telefone: varchar("telefone", { length: 20 }).primaryKey(),
  // A conversa é identificada pelo par número + telefone.
  numeroId: integer("numero_id").references(() => numerosWhatsapp.id),
  // Se a IA de atendimento pode responder esse contato sozinha. Sem linha = desligada.
  iaAtiva: boolean("ia_ativa").notNull().default(false),
  // A IA pediu atendimento humano: ela para de sugerir nessa conversa até alguém marcar como resolvido.
  precisaHumano: boolean("precisa_humano").notNull().default(false),
  motivoHumano: varchar("motivo_humano", { length: 500 }),
  ...timestamps(),
});

// "Excluir conversa" (tela Conversas): tudo o que aconteceu até excluidaEm some de Conversas, do Funil e do
// histórico que o bot e a IA leem. As linhas continuam no banco — campanhas e relatórios dependem delas, e
// o disparo é o que faz uma resposta nova do cliente ser aceita. Se ele escrever de novo, a conversa volta do zero.
export const conversasExcluidas = pgTable(
  "conversas_excluidas",
  {
    numeroId: integer("numero_id")
      .notNull()
      .references(() => numerosWhatsapp.id, { onDelete: "cascade" }),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    excluidaEm: timestamp("excluida_em", { withTimezone: true }).notNull(),
  },
  (tabela) => [primaryKey({ columns: [tabela.numeroId, tabela.telefone] })],
);
