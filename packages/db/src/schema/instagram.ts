import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { statusEnvioEnum } from "./enums.js";
import { timestamps } from "./columns.js";
import { unidades } from "./unidades.js";

// Conta profissional do Instagram de cada unidade, conectada pelo botão "Conectar Instagram" (login do
// Instagram). Uma por unidade, e a mesma conta não pode estar em duas unidades.
export const contasInstagram = pgTable("contas_instagram", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  unidadeId: integer("unidade_id")
    .notNull()
    .unique()
    .references(() => unidades.id, { onDelete: "cascade" }),
  igUserId: varchar("ig_user_id", { length: 40 }).notNull().unique(),
  username: varchar("username", { length: 100 }).notNull(),
  nome: varchar("nome", { length: 150 }),
  fotoUrl: varchar("foto_url", { length: 1000 }),
  // Token de longa duração (60 dias), cifrado; o worker renova antes de vencer.
  tokenCifrado: text("token_cifrado").notNull(),
  tokenExpiraEm: timestamp("token_expira_em", { withTimezone: true }),
  ultimaColetaEm: timestamp("ultima_coleta_em", { withTimezone: true }),
  // Último problema ao falar com a Meta (token revogado, permissão retirada...): a tela mostra.
  erroColeta: varchar("erro_coleta", { length: 500 }),
  // Quando a conta foi inscrita para mandar as DMs ao nosso webhook (subscribed_apps). Nulo = DMs desligadas.
  dmsAtivadasEm: timestamp("dms_ativadas_em", { withTimezone: true }),
  ...timestamps(),
});

// Conversa por DM com uma pessoa (IGSID: o id dela para esta conta, que a Meta manda no webhook).
export const conversasInstagram = pgTable(
  "conversas_instagram",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    contaId: integer("conta_id")
      .notNull()
      .references(() => contasInstagram.id, { onDelete: "cascade" }),
    igsid: varchar("igsid", { length: 40 }).notNull(),
    username: varchar("username", { length: 100 }),
    nome: varchar("nome", { length: 150 }),
    ultimaMensagemEm: timestamp("ultima_mensagem_em", { withTimezone: true }).notNull().defaultNow(),
    // Abre a janela de 24h para responder (regra da Meta, como no WhatsApp).
    ultimaDoClienteEm: timestamp("ultima_do_cliente_em", { withTimezone: true }),
    naoLidas: integer("nao_lidas").notNull().default(0),
    // Bot (n8n) respondendo esta conversa; e o pedido de uma pessoa, que para o bot até alguém encerrar.
    iaAtiva: boolean("ia_ativa").notNull().default(true),
    precisaHumano: boolean("precisa_humano").notNull().default(false),
    motivoHumano: varchar("motivo_humano", { length: 300 }),
    ...timestamps(),
  },
  (tabela) => [unique("conversas_instagram_pessoa").on(tabela.contaId, tabela.igsid), index("conversas_instagram_ultima").on(tabela.contaId, tabela.ultimaMensagemEm)],
);

// Mensagens das DMs. origem: cliente; equipe (pelo painel); bot (n8n); app (alguém respondeu direto no
// app do Instagram — chega como "eco" no webhook).
export const mensagensInstagram = pgTable(
  "mensagens_instagram",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    conversaId: integer("conversa_id")
      .notNull()
      .references(() => conversasInstagram.id, { onDelete: "cascade" }),
    origem: varchar("origem", { length: 10 }).$type<"cliente" | "equipe" | "bot" | "app">().notNull(),
    texto: text("texto").notNull().default(""),
    // Foto guardada no armazenamento ("/uploads/..."); outros anexos ficam só descritos no texto.
    midiaUrl: varchar("midia_url", { length: 500 }),
    // Id da mensagem na Meta: evita gravar duas vezes (webhook repetido, eco do que nós enviamos).
    mid: varchar("mid", { length: 200 }).unique(),
    statusEnvio: statusEnvioEnum("status_envio"),
    erroDetalhe: varchar("erro_detalhe", { length: 500 }),
    autorNome: varchar("autor_nome", { length: 120 }),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("mensagens_instagram_conversa").on(tabela.conversaId, tabela.criadaEm)],
);

// "Foto" diária dos números da conta. A Meta só devolve parte do histórico (seguidores, por exemplo, só
// dos últimos 30 dias), então o worker guarda um dia por linha para dar para comparar meses.
// metricas: reach, views, profile_views, accounts_engaged, total_interactions, website_clicks... (o que a
// Meta entregar para a conta; métrica que ela recusa simplesmente não entra).
export const instagramMetricasDiarias = pgTable(
  "instagram_metricas_diarias",
  {
    contaId: integer("conta_id")
      .notNull()
      .references(() => contasInstagram.id, { onDelete: "cascade" }),
    dia: date("dia", { mode: "string" }).notNull(),
    seguidores: integer("seguidores"),
    metricas: jsonb("metricas").$type<Record<string, number>>().notNull().default({}),
    ...timestamps(),
  },
  (tabela) => [primaryKey({ columns: [tabela.contaId, tabela.dia] })],
);
