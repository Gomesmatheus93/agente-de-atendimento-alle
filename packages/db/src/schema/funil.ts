import { boolean, index, integer, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { etapaFunilEnum, etapaOrigemEnum, motivoPerdaEnum } from "./enums.js";
import { numerosWhatsapp } from "./whatsapp.js";

// Situação de cada cliente no funil (tela Funil). Uma linha por conversa (número + telefone); quem
// respondeu mas ainda não tem linha aparece como "em_conversa".
export const funilClientes = pgTable(
  "funil_clientes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    numeroId: integer("numero_id")
      .notNull()
      .references(() => numerosWhatsapp.id, { onDelete: "cascade" }),
    etapa: etapaFunilEnum("etapa").notNull().default("em_conversa"),
    // "manual": alguém da equipe moveu o card, e a análise da IA não muda mais a etapa (só o resumo).
    etapaOrigem: etapaOrigemEnum("etapa_origem").notNull().default("ia"),
    motivoPerda: motivoPerdaEnum("motivo_perda"),
    motivoDetalhe: varchar("motivo_detalhe", { length: 500 }),
    // Escritos pela análise da IA.
    resumo: varchar("resumo", { length: 1000 }),
    proximoPasso: varchar("proximo_passo", { length: 300 }),
    analisadoEm: timestamp("analisado_em", { withTimezone: true }),
    // Horário da mensagem mais recente que a última análise leu: conversa sem nada depois disso não é reanalisada.
    ultimaMensagemAnalisada: timestamp("ultima_mensagem_analisada", { withTimezone: true }),
    ...timestamps(),
  },
  (tabela) => [uniqueIndex("funil_clientes_conversa").on(tabela.numeroId, tabela.telefone)],
);

// Perguntas que os clientes fizeram, extraídas pela análise da IA e agrupadas por tema: alimentam o
// ranking de dúvidas. Cada análise de uma conversa substitui as linhas anteriores dela.
export const duvidasIa = pgTable(
  "duvidas_ia",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    telefone: varchar("telefone", { length: 20 }).notNull(),
    numeroId: integer("numero_id")
      .notNull()
      .references(() => numerosWhatsapp.id, { onDelete: "cascade" }),
    // Rótulo curto e reaproveitado entre conversas (ex.: "Taxa de matrícula"), para somar no ranking.
    tema: varchar("tema", { length: 120 }).notNull(),
    // A pergunta como o cliente fez (resumida).
    pergunta: varchar("pergunta", { length: 500 }).notNull(),
    // Se a conversa trouxe a resposta. Não sanada = o que falta no script do agente.
    sanada: boolean("sanada").notNull(),
    perguntadaEm: timestamp("perguntada_em", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (tabela) => [
    index("duvidas_ia_conversa").on(tabela.numeroId, tabela.telefone),
    index("duvidas_ia_periodo").on(tabela.perguntadaEm),
  ],
);
