import { z } from "zod";
import { ETAPAS_FUNIL } from "../funil.js";

// Automações da unidade (tela Automações). Guardadas como JSON nas configurações da unidade.

// De onde sai cada parâmetro do template de aniversário: o primeiro nome do cliente, ou um texto fixo.
export const origemParametroAutomacaoSchema = z.union([
  z.object({ tipo: z.literal("nome") }),
  z.object({ tipo: z.literal("fixo"), valor: z.string().trim().min(1, "Preencha o texto").max(200) }),
]);

export const configAniversarioSchema = z.object({
  ativo: z.boolean(),
  templateId: z.number().int().positive().nullable(),
  numeroId: z.number().int().positive().nullable(),
  // Hora (Brasília) em que a campanha do dia sai.
  hora: z.number().int().min(7).max(20).default(9),
  parametros: z.record(z.string(), origemParametroAutomacaoSchema).default({}),
});
export type ConfigAniversario = z.infer<typeof configAniversarioSchema>;

export const configFollowupSchema = z.object({
  ativo: z.boolean(),
  // Horas sem resposta do cliente depois da nossa última mensagem (sempre dentro da janela de 24h).
  horas: z.number().int().min(1).max(20).default(4),
  texto: z.string().trim().min(1, "Escreva a mensagem").max(1000).default("Oi {nome}! Ficou alguma dúvida? Estou por aqui para ajudar 😊"),
  // Só conversas nestas etapas do funil (sem análise ainda = "em conversa").
  etapas: z.array(z.enum(ETAPAS_FUNIL)).min(1, "Escolha ao menos uma etapa").default(["em_conversa", "interessado", "fechando"]),
});
export type ConfigFollowup = z.infer<typeof configFollowupSchema>;

export const CONFIG_ANIVERSARIO_PADRAO: ConfigAniversario = { ativo: false, templateId: null, numeroId: null, hora: 9, parametros: {} };
export const CONFIG_FOLLOWUP_PADRAO: ConfigFollowup = {
  ativo: false,
  horas: 4,
  texto: "Oi {nome}! Ficou alguma dúvida? Estou por aqui para ajudar 😊",
  etapas: ["em_conversa", "interessado", "fechando"],
};

// {nome} vira o primeiro nome; sem nome, some.
export function preencherNome(texto: string, nome: string | null | undefined): string {
  const primeiro = nome?.trim().split(/\s+/)[0] ?? "";
  return primeiro ? texto.replaceAll("{nome}", primeiro) : texto.replace(/ ?\{nome\}/g, "");
}
