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

// Análise de UMA conversa, logo depois que ela fica parada: é o que move o card do funil "ao vivo"
// (a rodada diária continua cobrindo o resto). Cada mensagem nova reinicia a espera, então uma conversa
// movimentada vira uma análise só, quando o cliente para de escrever — e não uma por mensagem.
export const ANALISE_CONVERSA_QUEUE_NAME = "analise-conversa";
export const ANALISE_CONVERSA_JOB_NAME = "analisar-conversa";
export const ANALISE_CONVERSA_ATRASO_MS = 2 * 60_000;

export interface AnaliseConversaJobData {
  numeroId: number;
  telefone: string;
}

export function analiseConversaJobId(numeroId: number, telefone: string): string {
  return `analise-${numeroId}-${telefone}`;
}

// Instagram: coleta diária dos números de cada conta conectada (e renovação dos tokens), e coleta sob
// demanda de uma conta (logo depois de conectar, ou "Atualizar agora").
export const INSTAGRAM_COLETA_QUEUE_NAME = "instagram-coleta";
export const INSTAGRAM_COLETA_JOB_NAME = "coletar";
export const INSTAGRAM_COLETA_SCHEDULER_ID = "instagram-coleta-diaria";

export interface InstagramColetaJobData {
  // Sem conta: todas as contas, o dia de ontem (rodada diária).
  contaId?: number;
  dias?: number;
}
