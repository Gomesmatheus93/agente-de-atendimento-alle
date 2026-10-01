export const DISPARO_ENVIO_QUEUE_NAME = "disparo-envio";

export const DISPARO_ENVIO_JOB_NAME = "enviar-template";

export interface DisparoEnvioJobData {
  destinatarioId: number;
}

export function disparoEnvioJobId(destinatarioId: number): string {
  return `dest-${destinatarioId}`;
}

export const MENSAGEM_SAIDA_QUEUE_NAME = "mensagem-saida";

export const MENSAGEM_SAIDA_JOB_NAME = "enviar-texto";

export interface MensagemSaidaJobData {
  mensagemId: number;
}

// Inclui a tentativa: reenviar uma resposta que falhou precisa de um job novo (o id antigo ainda pode existir na fila).
export function mensagemSaidaJobId(mensagemId: number, tentativa: number): string {
  return `saida-${mensagemId}-${tentativa}`;
}

export const IA_SUGESTAO_QUEUE_NAME = "ia-sugestao";

export const IA_SUGESTAO_JOB_NAME = "sugerir-resposta";

export interface IaSugestaoJobData {
  telefone: string;
  numeroId: number;
}

// Um job por telefone: mensagens que o cliente manda em sequência caem no mesmo job (o que já está
// agendado absorve os seguintes), e a IA lê a conversa inteira só quando ele roda.
export function iaSugestaoJobId(telefone: string, numeroId: number): string {
  return `ia-${numeroId}-${telefone}`;
}

// Espera o cliente terminar de digitar antes de sugerir; quem pede pelo painel não espera.
export const IA_SUGESTAO_ATRASO_MS = 20_000;
