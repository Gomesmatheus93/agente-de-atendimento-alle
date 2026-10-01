import { index, integer, pgEnum, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { numerosWhatsapp } from "./whatsapp.js";

export const STATUS_SUGESTAO_IA = ["pendente", "enviada", "descartada"] as const;
export const statusSugestaoIaEnum = pgEnum("status_sugestao_ia", STATUS_SUGESTAO_IA);

// Resposta escrita pela IA para uma conversa. Nunca sai sozinha: fica pendente até alguém da equipe
// enviar (como está ou editada) ou descartar. Uma nova sugestão para o mesmo telefone descarta a anterior.
export const sugestoesIa = pgTable(
  "sugestoes_ia",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    telefone: varchar("telefone", { length: 20 }).notNull(),
  // Conversa a que a sugestão pertence.
    numeroId: integer("numero_id").references(() => numerosWhatsapp.id),
    texto: text("texto").notNull(),
    status: statusSugestaoIaEnum("status").notNull().default("pendente"),
    // Última mensagem do cliente que a IA considerou: evita gerar duas sugestões para o mesmo ponto da conversa.
    respostaClienteId: integer("resposta_cliente_id"),
    modelo: varchar("modelo", { length: 64 }).notNull(),
    tokensEntrada: integer("tokens_entrada").notNull().default(0),
    tokensSaida: integer("tokens_saida").notNull().default(0),
    ...timestamps(),
  },
  (tabela) => [index("sugestoes_ia_telefone_status").on(tabela.telefone, tabela.status)],
);
