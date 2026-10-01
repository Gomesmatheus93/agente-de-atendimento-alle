import {
  CATEGORIAS_TEMPLATE,
  ETAPAS_FUNIL,
  ETAPAS_KANBAN,
  MOTIVOS_PERDA,
  PAPEIS_USUARIO,
  STATUS_CAMPANHA,
  STATUS_ENVIO,
  TIPO_MENSAGEM,
} from "@atendimento-academias/shared";
import { pgEnum } from "drizzle-orm/pg-core";

// No Postgres cada lista fixa de valores é um tipo do banco, criado uma vez e usado pelas colunas
// (no MySQL era um enum por coluna). Os valores vêm do pacote shared, como antes.
export const statusCampanhaEnum = pgEnum("status_campanha", STATUS_CAMPANHA);
export const etapaKanbanEnum = pgEnum("etapa_kanban", ETAPAS_KANBAN);
export const statusEnvioEnum = pgEnum("status_envio", STATUS_ENVIO);
export const tipoMensagemEnum = pgEnum("tipo_mensagem", TIPO_MENSAGEM);
export const categoriaTemplateEnum = pgEnum("categoria_template", CATEGORIAS_TEMPLATE);
export const papelUsuarioEnum = pgEnum("papel_usuario", PAPEIS_USUARIO);
export const etapaFunilEnum = pgEnum("etapa_funil", ETAPAS_FUNIL);
export const etapaOrigemEnum = pgEnum("etapa_origem", ["ia", "manual"]);
export const motivoPerdaEnum = pgEnum("motivo_perda", MOTIVOS_PERDA);
