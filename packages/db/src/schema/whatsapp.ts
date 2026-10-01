import { boolean, index, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";

// Uma conta do WhatsApp Business (WABA) da Meta, com o token que dá acesso a ela.
export const contasWhatsapp = pgTable("contas_whatsapp", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  nome: varchar("nome", { length: 120 }).notNull(),
  wabaId: varchar("waba_id", { length: 40 }).notNull().unique(),
  // Cifrado com a chave mestra (packages/db/src/cripto.ts). Nunca sai da API para o navegador.
  tokenCifrado: text("token_cifrado").notNull(),
  // Últimos dígitos, só para a tela mostrar qual token está salvo.
  tokenFinal: varchar("token_final", { length: 8 }).notNull(),
  ...timestamps(),
});

// Cada número de telefone de uma conta. A plataforma descobre os números pela API da Meta;
// "ativo" é o que a equipe escolhe usar para disparar e atender.
export const numerosWhatsapp = pgTable(
  "numeros_whatsapp",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    contaId: integer("conta_id")
      .notNull()
      .references(() => contasWhatsapp.id, { onDelete: "cascade" }),
    phoneNumberId: varchar("phone_number_id", { length: 40 }).notNull().unique(),
    numeroExibicao: varchar("numero_exibicao", { length: 32 }).notNull(),
    nomeVerificado: varchar("nome_verificado", { length: 120 }),
    qualidade: varchar("qualidade", { length: 20 }),
    ativo: boolean("ativo").notNull().default(false),
    ...timestamps(),
  },
  (tabela) => [index("numeros_whatsapp_conta").on(tabela.contaId)],
);

// Configurações soltas da plataforma (token de verificação e segredo do app da Meta, por exemplo).
// Valores marcados como secretos ficam cifrados e nunca voltam para a tela.
export const configuracoes = pgTable("configuracoes", {
  chave: varchar("chave", { length: 60 }).primaryKey(),
  valor: text("valor").notNull(),
  secreto: boolean("secreto").notNull().default(false),
  ...timestamps(),
});

export const CHAVE_WEBHOOK_VERIFY_TOKEN = "whatsapp.verify_token";
export const CHAVE_WEBHOOK_APP_SECRET = "whatsapp.app_secret";

// Chave usada por sistemas externos (ex.: n8n) para chamar /integracoes/* sem sessão de usuário.
// Só o hash fica salvo (como senha de usuário); a chave em si só existe na hora em que é gerada.
export const CHAVE_INTEGRACAO_HASH = "integracao.chave_hash";
export const CHAVE_INTEGRACAO_FINAL = "integracao.chave_final";

// Quem responde quando a "IA de atendimento" está ligada numa conversa: o agente interno (Claude,
// sugestão que a equipe aprova) ou um webhook externo (n8n, responde direto). "interno" é o padrão.
export const CHAVE_MODO_AGENTE = "integracao.modo_agente";
export const MODOS_AGENTE = ["interno", "n8n"] as const;
export type ModoAgente = (typeof MODOS_AGENTE)[number];

// URL que a API chama (POST) a cada mensagem nova do cliente, quando o modo é "n8n".
export const CHAVE_N8N_WEBHOOK_URL = "integracao.n8n_webhook_url";

// Imagens que o agente (n8n) anexa às respostas, pelo nome: "planos" -> tabela de planos. O arquivo fica
// em uploads/ e o worker sobe para a Meta na hora de enviar (reaproveitando o id por alguns dias).
export const midiasAgente = pgTable("midias_agente", {
  chave: varchar("chave", { length: 40 }).primaryKey(),
  descricao: varchar("descricao", { length: 200 }),
  midiaUrl: varchar("midia_url", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  ...timestamps(),
});
