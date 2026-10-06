import { integer, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { etapaKanbanEnum, statusCampanhaEnum } from "./enums.js";
import { templatesWhatsapp } from "./templatesWhatsapp.js";
import { numerosWhatsapp } from "./whatsapp.js";
import { unidades } from "./unidades.js";

export const campanhasDisparo = pgTable("campanhas_disparo", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  unidadeId: integer("unidade_id")
    .notNull()
    .references(() => unidades.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 255 }).notNull(),
  templateId: integer("template_id")
    .notNull()
    .references(() => templatesWhatsapp.id),
  // Número remetente. Nulo só em campanhas criadas antes de a plataforma gerenciar números.
  numeroId: integer("numero_id").references(() => numerosWhatsapp.id),
  status: statusCampanhaEnum("status").notNull().default("enviando"),
  // Quando o disparo começa (ou começou): a data agendada, ou o momento da criação nos envios imediatos.
  // É a data que vale no calendário e nos relatórios; created_at guarda só quando a campanha foi cadastrada.
  disparoEm: timestamp("disparo_em", { withTimezone: true }).notNull().defaultNow(),
  // Coluna do kanban escolhida à mão; nulo = posição automática, calculada pelo status de envio.
  etapaManual: etapaKanbanEnum("etapa_manual"),
  // Preço por mensagem (R$) vigente na criação da campanha; nulo em campanhas anteriores ao cálculo de custo.
  custoUnitario: numeric("custo_unitario", { precision: 10, scale: 4 }),
  ...timestamps(),
});
