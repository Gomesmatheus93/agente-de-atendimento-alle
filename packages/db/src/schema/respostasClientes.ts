import { index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { tipoMensagemEnum } from "./enums.js";
import { numerosWhatsapp } from "./whatsapp.js";
import { campanhasDisparo } from "./campanhasDisparo.js";
import { disparoDestinatarios } from "./disparoDestinatarios.js";

// Mensagens que os clientes mandam de volta pelo WhatsApp. Alimentam a taxa de retorno das campanhas
// e o ranking de dúvidas.
export const respostasClientes = pgTable(
  "respostas_clientes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    // Id da mensagem no WhatsApp (wamid): garante que o mesmo webhook reenviado não duplique a resposta.
    mensagemExternaId: varchar("mensagem_externa_id", { length: 191 }),
    telefone: varchar("telefone", { length: 20 }).notNull(),
  // Número da operação que recebeu a mensagem: a conversa pertence a ele.
  numeroId: integer("numero_id").references(() => numerosWhatsapp.id),
    // Preenchidos quando a resposta pôde ser ligada a um disparo recente para esse telefone.
    campanhaId: integer("campanha_id").references(() => campanhasDisparo.id),
    destinatarioId: integer("destinatario_id").references(() => disparoDestinatarios.id),
    // "audio"/"figurinha": mídia baixada da Meta na hora do webhook; texto fica "" nesses casos.
    tipo: tipoMensagemEnum("tipo").notNull().default("texto"),
    texto: text("texto").notNull(),
    midiaUrl: varchar("midia_url", { length: 500 }),
    midiaMimeType: varchar("midia_mime_type", { length: 100 }),
    recebidaEm: timestamp("recebida_em", { withTimezone: true }).notNull(),
    // Quando alguém abriu a conversa no painel; nulo = ainda não lida.
    lidaEm: timestamp("lida_em", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => ({
    mensagemExternaUnique: uniqueIndex("respostas_clientes_mensagem_externa_unique").on(table.mensagemExternaId),
    campanhaIdx: index("respostas_clientes_campanha_idx").on(table.campanhaId),
    telefoneIdx: index("respostas_clientes_telefone_idx").on(table.telefone, table.recebidaEm),
    recebidaEmIdx: index("respostas_clientes_recebida_em_idx").on(table.recebidaEm),
  }),
);
