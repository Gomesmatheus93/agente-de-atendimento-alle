import { campanhasDisparo, disparoDestinatarios, type Db } from "@atendimento-academias/db";
import {
  DISPARO_ENVIO_JOB_NAME,
  DISPARO_ENVIO_QUEUE_NAME,
  disparoEnvioJobId,
  type DisparoEnvioJobData,
} from "@atendimento-academias/shared";
import { Queue } from "bullmq";
import { and, asc, eq, lte } from "drizzle-orm";
import { getRedisConnection } from "../queue/connection.js";

const INTERVALO_MS = 15_000;
const MAX_CAMPANHAS_POR_VERIFICACAO = 20;

// O banco é a fonte da verdade: a campanha fica com status "agendada" e a data em `disparo_em`, e este laço a
// inicia quando a hora chega. Se o worker estiver parado na hora marcada, o disparo sai assim que ele voltar.
export function iniciarAgendadorDeCampanhas(db: Db): () => void {
  const fila = new Queue<DisparoEnvioJobData>(DISPARO_ENVIO_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
  });

  let verificando = false;

  async function verificar(): Promise<void> {
    if (verificando) return;
    verificando = true;
    try {
      const devidas = await db
        .select({ id: campanhasDisparo.id })
        .from(campanhasDisparo)
        .where(and(eq(campanhasDisparo.status, "agendada"), lte(campanhasDisparo.disparoEm, new Date())))
        .orderBy(asc(campanhasDisparo.disparoEm))
        .limit(MAX_CAMPANHAS_POR_VERIFICACAO);

      for (const { id } of devidas) await iniciarCampanha(db, fila, id);
    } catch (err) {
      console.error("[agendador] falha ao verificar campanhas agendadas:", err);
    } finally {
      verificando = false;
    }
  }

  const timer = setInterval(() => void verificar(), INTERVALO_MS);
  void verificar();

  return () => {
    clearInterval(timer);
    void fila.close();
  };
}

async function iniciarCampanha(db: Db, fila: Queue<DisparoEnvioJobData>, campanhaId: number): Promise<void> {
  // "Reivindica" a campanha: só quem conseguir trocar agendada -> enviando a dispara. Isso evita disparo duplo
  // (dois workers) e respeita um cancelamento que chegou um instante antes.
  const resultado = await db
    .update(campanhasDisparo)
    .set({ status: "enviando" })
    .where(and(eq(campanhasDisparo.id, campanhaId), eq(campanhasDisparo.status, "agendada")));

  if (resultado.count !== 1) return;

  const destinatarios = await db
    .select({ id: disparoDestinatarios.id })
    .from(disparoDestinatarios)
    .where(and(eq(disparoDestinatarios.campanhaId, campanhaId), eq(disparoDestinatarios.statusEnvio, "pendente")));

  try {
    await fila.addBulk(
      destinatarios.map((destinatario) => ({
        name: DISPARO_ENVIO_JOB_NAME,
        data: { destinatarioId: destinatario.id },
        opts: { jobId: disparoEnvioJobId(destinatario.id) },
      })),
    );
    console.log(`[agendador] campanha ${campanhaId} iniciada (${destinatarios.length} destinatários)`);
  } catch (err) {
    // Mesmo tratamento de campanhas.criar quando não dá para enfileirar: marca tudo como falha e encerra.
    console.error(`[agendador] não foi possível enfileirar a campanha ${campanhaId}:`, err);
    await db
      .update(disparoDestinatarios)
      .set({ statusEnvio: "falhou", erroDetalhe: "Falha ao enfileirar o envio" })
      .where(and(eq(disparoDestinatarios.campanhaId, campanhaId), eq(disparoDestinatarios.statusEnvio, "pendente")));
    await db.update(campanhasDisparo).set({ status: "concluida" }).where(eq(campanhasDisparo.id, campanhaId));
  }
}
