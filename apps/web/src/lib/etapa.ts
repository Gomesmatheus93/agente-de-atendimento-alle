import { ETAPAS_KANBAN, type EtapaKanban, type StatusCampanha } from "@atendimento-academias/shared";

export const ETAPAS = ETAPAS_KANBAN;

export type Etapa = EtapaKanban;

export const INFO_ETAPA: Record<Etapa, { titulo: string; descricao: string; cor: string }> = {
  agendada: { titulo: "Agendadas", descricao: "Disparam na data marcada", cor: "bg-status-agendado" },
  "na-fila": { titulo: "Na fila", descricao: "Aguardando o primeiro envio", cor: "bg-baseline" },
  enviando: { titulo: "Enviando", descricao: "Em andamento agora", cor: "bg-status-pendente" },
  concluida: { titulo: "Concluídas", descricao: "Todos os envios com sucesso", cor: "bg-status-enviado" },
  "com-falhas": { titulo: "Concluídas com falhas", descricao: "Parte dos envios falhou", cor: "bg-orange-500" },
  falhou: { titulo: "Falharam", descricao: "Nenhum envio deu certo", cor: "bg-status-falhou" },
};

interface ProgressoEtapa {
  enviado: number;
  falhou: number;
}

/**
 * A etapa automática é derivada do status da campanha e do progresso dos destinatários.
 * Quem move o card à mão sobrepõe isso com `etapaManual` (ver `etapaExibida`).
 */
export function etapaDe(status: StatusCampanha, { enviado, falhou }: ProgressoEtapa): Etapa {
  if (status === "agendada") return "agendada";
  if (status === "enviando") return enviado + falhou === 0 ? "na-fila" : "enviando";
  if (falhou === 0) return "concluida";
  return enviado === 0 ? "falhou" : "com-falhas";
}

export function etapaExibida(campanha: { status: StatusCampanha; progresso: ProgressoEtapa; etapaManual: Etapa | null }): Etapa {
  return campanha.etapaManual ?? etapaDe(campanha.status, campanha.progresso);
}
