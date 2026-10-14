import { index, integer, pgEnum, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { unidades } from "./unidades.js";

export const NIVEIS_SAUDE = ["ok", "atencao", "falha"] as const;
export type NivelSaude = (typeof NIVEIS_SAUDE)[number];
export const nivelSaudeEnum = pgEnum("nivel_saude", NIVEIS_SAUDE);

// Resultado da última verificação de cada peça do sistema (token da Meta, número, n8n, fila, EVO...). A API
// verifica a cada poucos minutos e a tela "Saúde do sistema" e o aviso do topo leem daqui.
// unidade_id nulo = peça da plataforma inteira (worker, Redis, armazenamento), vista por todas as unidades.
// desde: quando a peça entrou no nível atual — "falhando há 2 horas".
export const verificacoesSaude = pgTable(
  "verificacoes_saude",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    unidadeId: integer("unidade_id").references(() => unidades.id, { onDelete: "cascade" }),
    chave: varchar("chave", { length: 80 }).notNull(),
    nivel: nivelSaudeEnum("nivel").notNull(),
    titulo: varchar("titulo", { length: 120 }).notNull(),
    mensagem: text("mensagem").notNull(),
    // O que fazer para resolver, e a tela do painel onde se resolve (hash, ex.: "#/configuracoes").
    acao: text("acao"),
    link: varchar("link", { length: 120 }),
    desde: timestamp("desde", { withTimezone: true }).notNull().defaultNow(),
    verificadoEm: timestamp("verificado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [unique("verificacoes_saude_unidade_chave").on(tabela.unidadeId, tabela.chave).nullsNotDistinct(), index("verificacoes_saude_unidade").on(tabela.unidadeId)],
);
