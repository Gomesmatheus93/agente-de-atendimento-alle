import { z } from "zod";

// agendada: criada para disparar numa data futura (o worker a inicia na hora); enviando/concluida: já disparou.
export const STATUS_CAMPANHA = ["agendada", "enviando", "concluida"] as const;

export const statusCampanhaSchema = z.enum(STATUS_CAMPANHA);

export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];

// Colunas do kanban de campanhas, da mais inicial à final.
export const ETAPAS_KANBAN = ["agendada", "na-fila", "enviando", "concluida", "com-falhas", "falhou"] as const;

export const etapaKanbanSchema = z.enum(ETAPAS_KANBAN);

export type EtapaKanban = (typeof ETAPAS_KANBAN)[number];

export const STATUS_ENVIO =["pendente", "enviado", "falhou"] as const;

export const statusEnvioSchema = z.enum(STATUS_ENVIO);

export type StatusEnvio = (typeof STATUS_ENVIO)[number];
