import { boolean, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Preferências de cada conversa — o par número da operação + telefone do cliente. A conversa em si não é
// uma tabela: ela é montada a partir das respostas, dos disparos e das mensagens de saída.
export const conversasConfig = pgTable(
  "conversas_config",
  {
    telefone: varchar("telefone", { length: 20 }).notNull(),
    numeroId: integer("numero_id")
      .notNull()
      .references(() => numerosWhatsapp.id),
    // A IA liga sozinha quando o cliente escreve (webhook). Sem linha = ainda não escreveu.
    iaAtiva: boolean("ia_ativa").notNull().default(false),
    // Alguém da equipe desligou a IA nesta conversa: ela não religa sozinha até alguém religar à mão.
    iaDesligadaManual: boolean("ia_desligada_manual").notNull().default(false),
    // O cliente pediu uma pessoa ou o bot não soube responder: o bot pausa até "Encerrar atendimento".
    precisaHumano: boolean("precisa_humano").notNull().default(false),
    motivoHumano: varchar("motivo_humano", { length: 500 }),
    // Quando passou a precisar de humano: ordena os avisos do painel e identifica um pedido novo.
    humanoPedidoEm: timestamp("humano_pedido_em", { withTimezone: true }),
    ...timestamps(),
  },
  (tabela) => [primaryKey({ columns: [tabela.numeroId, tabela.telefone] })],
);

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
