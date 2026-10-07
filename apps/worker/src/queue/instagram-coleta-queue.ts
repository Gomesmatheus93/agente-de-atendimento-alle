import { coletarInstagram, contasInstagram, renovarTokensInstagram, type Db } from "@atendimento-academias/db";
import {
  INSTAGRAM_COLETA_JOB_NAME,
  INSTAGRAM_COLETA_QUEUE_NAME,
  INSTAGRAM_COLETA_SCHEDULER_ID,
  type InstagramColetaJobData,
} from "@atendimento-academias/shared";
import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./connection.js";

// Todo dia às 4h (Brasília): o dia anterior já fechou nos números da Meta.
const HORARIO_DIARIO = "0 4 * * *";

async function coletar(db: Db, dados: InstagramColetaJobData): Promise<void> {
  if (dados.contaId) {
    const resultado = await coletarInstagram(db, dados.contaId, dados.dias ?? 1);
    console.log(`[instagram] conta ${dados.contaId}: ${resultado.dias} dia(s), ${resultado.metricas} métrica(s) gravadas`);
    return;
  }

  // Rodada diária: renova o acesso que está para vencer e grava o dia de ontem de cada conta. Uma conta
  // com problema (acesso revogado) não impede as outras; o erro fica na conta para a tela mostrar.
  const renovados = await renovarTokensInstagram(db);
  const contas = await db.select({ id: contasInstagram.id, username: contasInstagram.username }).from(contasInstagram);
  let falhas = 0;
  for (const conta of contas) {
    try {
      await coletarInstagram(db, conta.id, 1);
    } catch (erro) {
      falhas += 1;
      console.error(`[instagram] falha na coleta de @${conta.username}:`, erro);
    }
  }
  console.log(`[instagram] rodada diária: ${contas.length - falhas} conta(s) coletada(s), ${falhas} com falha, ${renovados} acesso(s) renovado(s)`);
}

export function createInstagramColetaWorker(db: Db): Worker<InstagramColetaJobData> {
  return new Worker<InstagramColetaJobData>(INSTAGRAM_COLETA_QUEUE_NAME, async (job) => coletar(db, job.data), {
    connection: getRedisConnection(),
    // Uma coleta por vez: cada conta tem um limite de chamadas por hora na Meta.
    concurrency: 1,
  });
}

export async function agendarColetaInstagram(): Promise<void> {
  const fila = new Queue<InstagramColetaJobData>(INSTAGRAM_COLETA_QUEUE_NAME, { connection: getRedisConnection() });
  await fila.upsertJobScheduler(
    INSTAGRAM_COLETA_SCHEDULER_ID,
    { pattern: HORARIO_DIARIO, tz: "America/Sao_Paulo" },
    { name: INSTAGRAM_COLETA_JOB_NAME, data: {}, opts: { removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 7 * 86_400 } } },
  );
  await fila.close();
}
