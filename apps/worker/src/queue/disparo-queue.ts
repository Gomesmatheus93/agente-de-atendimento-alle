import type { Db } from "@atendimento-academias/db";
import { campanhasDisparo, disparoDestinatarios, templatesWhatsapp } from "@atendimento-academias/db";
import { DISPARO_ENVIO_QUEUE_NAME, type DisparoEnvioJobData } from "@atendimento-academias/shared";
import { Worker } from "bullmq";
import { and, count, eq } from "drizzle-orm";
import type { WhatsAppSendResult } from "../providers/whatsapp/WhatsAppProvider.js";
import { FabricaDeProviders, NumeroNaoConfigurado } from "../providers/whatsapp/fabrica.js";
import { getRedisConnection } from "./connection.js";

const CONCORRENCIA = 5;

export function createDisparoWorker(db: Db, providers: FabricaDeProviders): Worker<DisparoEnvioJobData> {
  return new Worker<DisparoEnvioJobData>(
    DISPARO_ENVIO_QUEUE_NAME,
    async (job) => {
      await processarDestinatario(db, providers, job.data.destinatarioId);
    },
    { connection: getRedisConnection(), concurrency: CONCORRENCIA },
  );
}

async function processarDestinatario(db: Db, providers: FabricaDeProviders, destinatarioId: number): Promise<void> {
  const [linha] = await db
    .select({
      destinatario: disparoDestinatarios,
      numeroId: campanhasDisparo.numeroId,
      templateNome: templatesWhatsapp.nome,
      templateIdioma: templatesWhatsapp.idioma,
      templateCabecalhoImagemUrl: templatesWhatsapp.cabecalhoImagemUrl,
    })
    .from(disparoDestinatarios)
    .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
    .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
    .where(eq(disparoDestinatarios.id, destinatarioId));

  if (!linha || linha.destinatario.statusEnvio !== "pendente") return;

  const { destinatario, numeroId, templateNome, templateIdioma, templateCabecalhoImagemUrl } = linha;

  let resultado: WhatsAppSendResult;
  try {
    if (!numeroId) throw new NumeroNaoConfigurado("A campanha não tem número de envio definido.");
    const provider = await providers.para(numeroId);
    resultado = await provider.enviarTemplate({
      telefone: destinatario.telefone,
      template: { nome: templateNome, idioma: templateIdioma, cabecalhoImagemUrl: templateCabecalhoImagemUrl },
      parametros: destinatario.parametros,
    });
  } catch (err) {
    resultado = { sucesso: false, erro: err instanceof Error ? err.message : String(err) };
  }

  await db
    .update(disparoDestinatarios)
    .set({
      statusEnvio: resultado.sucesso ? "enviado" : "falhou",
      tentativas: destinatario.tentativas + 1,
      erroDetalhe: resultado.sucesso ? null : (resultado.erro ?? "Falha desconhecida"),
      enviadoEm: resultado.sucesso ? new Date() : null,
      // Os avisos de entregue/lida chegam pelo webhook com esse id.
      mensagemExternaId: resultado.mensagemId ?? null,
    })
    .where(eq(disparoDestinatarios.id, destinatarioId));

  await concluirCampanhaSeTerminou(db, destinatario.campanhaId);
}

async function concluirCampanhaSeTerminou(db: Db, campanhaId: number): Promise<void> {
  const [{ pendentes }] = await db
    .select({ pendentes: count() })
    .from(disparoDestinatarios)
    .where(and(eq(disparoDestinatarios.campanhaId, campanhaId), eq(disparoDestinatarios.statusEnvio, "pendente")));

  if (pendentes === 0) {
    await db.update(campanhasDisparo).set({ status: "concluida" }).where(eq(campanhasDisparo.id, campanhaId));
  }
}
