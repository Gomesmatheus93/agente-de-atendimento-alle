import { index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { statusEnvioEnum, tipoMensagemEnum } from "./enums.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Respostas livres que a equipe escreve para um cliente, pela tela de Conversas.
// (Os disparos de template continuam em disparo_destinatarios.)
export const mensagensSaida = pgTable(
  "mensagens_saida",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    telefone: varchar("telefone", { length: 20 }).notNull(),
  // Número por onde a resposta sai: precisa ser o mesmo que o cliente usou.
  numeroId: integer("numero_id").references(() => numerosWhatsapp.id),
    // "audio": a equipe não escreve nada, texto fica "". A equipe não manda figurinha, só recebe.
    tipo: tipoMensagemEnum("tipo").notNull().default("texto"),
    texto: text("texto").notNull(),
    // Preenchidos quando tipo = "audio": caminho servido pela API (ex.: /uploads/<arquivo>) e o mime type gravado.
    midiaUrl: varchar("midia_url", { length: 500 }),
    midiaMimeType: varchar("midia_mime_type", { length: 100 }),
    statusEnvio: statusEnvioEnum("status_envio").notNull().default("pendente"),
    tentativas: integer("tentativas").notNull().default(0),
    erroDetalhe: text("erro_detalhe"),
    // Id da mensagem no provedor de WhatsApp, quando ele devolve um.
    mensagemExternaId: varchar("mensagem_externa_id", { length: 191 }),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    // Confirmações que a Meta manda pelo webhook (os "checks" do WhatsApp): chegou no aparelho / o cliente
    // abriu. Lida fica vazia se o cliente desligou a confirmação de leitura no WhatsApp dele.
    entregueEm: timestamp("entregue_em", { withTimezone: true }),
    lidaEm: timestamp("lida_em", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => ({
    telefoneIdx: index("mensagens_saida_telefone_idx").on(table.telefone, table.createdAt),
    mensagemExternaIdx: index("mensagens_saida_mensagem_externa_idx").on(table.mensagemExternaId),
  }),
);
