import {
  ANALISE_CONVERSA_ATRASO_MS,
  ANALISE_CONVERSA_JOB_NAME,
  ANALISE_CONVERSA_QUEUE_NAME,
  type AnaliseConversaJobData,
  analiseConversaJobId,
  ANALISE_CONVERSAS_JOB_NAME,
  ANALISE_CONVERSAS_QUEUE_NAME,
  type AnaliseConversasJobData,
  DISPARO_ENVIO_QUEUE_NAME,
  IA_SUGESTAO_JOB_NAME,
  IA_SUGESTAO_QUEUE_NAME,
  iaSugestaoJobId,
  MENSAGEM_SAIDA_QUEUE_NAME,
  type DisparoEnvioJobData,
  type IaSugestaoJobData,
  type MensagemSaidaJobData,
} from "@atendimento-academias/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

// Produtor falha rápido com Redis fora do ar (quem enfileira precisa reportar o erro);
// maxRetriesPerRequest: null é exigência só do Worker.
function criarFila<T>(nome: string): Queue<T> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL não configurada");
  }
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
  return new Queue<T>(nome, {
    connection,
    defaultJobOptions: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
  });
}

let disparoQueue: Queue<DisparoEnvioJobData> | undefined;
let mensagemSaidaQueue: Queue<MensagemSaidaJobData> | undefined;

export function getDisparoQueue(): Queue<DisparoEnvioJobData> {
  disparoQueue ??= criarFila<DisparoEnvioJobData>(DISPARO_ENVIO_QUEUE_NAME);
  return disparoQueue;
}

export function getMensagemSaidaQueue(): Queue<MensagemSaidaJobData> {
  mensagemSaidaQueue ??= criarFila<MensagemSaidaJobData>(MENSAGEM_SAIDA_QUEUE_NAME);
  return mensagemSaidaQueue;
}

let iaSugestaoQueue: Queue<IaSugestaoJobData> | undefined;

function getIaSugestaoQueue(): Queue<IaSugestaoJobData> {
  iaSugestaoQueue ??= criarFila<IaSugestaoJobData>(IA_SUGESTAO_QUEUE_NAME);
  return iaSugestaoQueue;
}

// Pede ao worker uma sugestão de resposta para a conversa. O id fixo por telefone faz mensagens em
// sequência caírem num job só; por isso o job é apagado ao terminar (senão o id bloquearia o próximo).
export async function pedirSugestaoIa(telefone: string, numeroId: number, atrasoMs = 0): Promise<void> {
  await getIaSugestaoQueue().add(
    IA_SUGESTAO_JOB_NAME,
    { telefone, numeroId },
    {
      jobId: iaSugestaoJobId(telefone, numeroId),
      delay: atrasoMs,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
    },
  );
}

let analiseQueue: Queue<AnaliseConversasJobData> | undefined;

// "Analisar agora" na tela Funil. Id fixo enquanto a rodada existe na fila: cliques repetidos não
// empilham rodadas (cada uma custa chamadas à IA).
export async function pedirAnaliseDeConversas(): Promise<void> {
  analiseQueue ??= criarFila<AnaliseConversasJobData>(ANALISE_CONVERSAS_QUEUE_NAME);
  await analiseQueue.add(ANALISE_CONVERSAS_JOB_NAME, { origem: "manual" }, { jobId: "analise-manual", removeOnComplete: true, removeOnFail: true });
}

let analiseConversaQueue: Queue<AnaliseConversaJobData> | undefined;

// Funil ao vivo: pede a análise desta conversa para daqui a pouco. Pedidos repetidos enquanto ela ainda
// espera só empurram o horário (debounce do BullMQ), então a IA lê a conversa uma vez, quando ela acalma.
// Nunca derruba quem chamou: sem Redis, o card espera a rodada diária.
export function pedirAnaliseDaConversa(numeroId: number, telefone: string): void {
  analiseConversaQueue ??= criarFila<AnaliseConversaJobData>(ANALISE_CONVERSA_QUEUE_NAME);
  const id = analiseConversaJobId(numeroId, telefone);
  analiseConversaQueue
    .add(
      ANALISE_CONVERSA_JOB_NAME,
      { numeroId, telefone },
      {
        delay: ANALISE_CONVERSA_ATRASO_MS,
        deduplication: { id, ttl: ANALISE_CONVERSA_ATRASO_MS, extend: true, replace: true },
        removeOnComplete: true,
        removeOnFail: true,
      },
    )
    .catch((erro) => console.error(`[funil] não foi possível pedir a análise de ${telefone}:`, erro));
}
