import { boolean, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { categoriaTemplateEnum } from "./enums.js";
import { contasWhatsapp } from "./whatsapp.js";
import { unidades } from "./unidades.js";

export const templatesWhatsapp = pgTable("templates_whatsapp", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  unidadeId: integer("unidade_id")
    .notNull()
    .references(() => unidades.id, { onDelete: "cascade" }),
  // Conta do WhatsApp onde o template foi aprovado: o mesmo nome pode existir em contas diferentes.
  contaId: integer("conta_id").references(() => contasWhatsapp.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 255 }).notNull(),
  // Texto do template com placeholders, ex: "Oi {{nome}}, ..."
  conteudo: text("conteudo").notNull(),
  // Define o preço por mensagem no cálculo de custo da campanha.
  categoria: categoriaTemplateEnum("categoria").notNull().default("marketing"),
  // Idioma com que o template foi aprovado na Meta. Nome + idioma é a chave do template lá.
  idioma: varchar("idioma", { length: 15 }).notNull().default("pt_BR"),
  // Templates aprovados com cabeçalho de imagem exigem a imagem em todo envio: URL pública (https), media id
  // da Meta, ou "/uploads/<arquivo>" (imagem enviada pela tela Templates; o worker sobe para a Meta ao enviar).
  cabecalhoImagemUrl: varchar("cabecalho_imagem_url", { length: 1024 }),
  // Formato do cabeçalho na Meta (TEXT, IMAGE, ...). IMAGE exige imagem em todo envio.
  cabecalhoFormato: varchar("cabecalho_formato", { length: 20 }),
  // Texto do cabeçalho quando ele é TEXT, e o rodapé: só para mostrar o template inteiro na tela.
  cabecalhoTexto: varchar("cabecalho_texto", { length: 255 }),
  rodape: varchar("rodape", { length: 255 }),
  // Id do template na Meta: é por ele que chega o aviso de aprovação/reprovação no webhook.
  metaId: varchar("meta_id", { length: 40 }),
  // Situação na Meta (APPROVED, PENDING, REJECTED, PAUSED, DISABLED...). "ativo" acompanha: só APPROVED envia.
  status: varchar("status", { length: 20 }).notNull().default("APPROVED"),
  // Motivo que a Meta deu ao reprovar ou pausar.
  motivoStatus: varchar("motivo_status", { length: 500 }),
  ativo: boolean("ativo").notNull().default(true),
  ...timestamps(),
});
