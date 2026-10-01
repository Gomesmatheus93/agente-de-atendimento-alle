import type { Db } from "@atendimento-academias/db";
import { mensagensSaida } from "@atendimento-academias/db";
import { MENSAGEM_SAIDA_QUEUE_NAME, type MensagemSaidaJobData } from "@atendimento-academias/shared";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { lerMidiaLocal } from "../media/armazenamento.js";
import type { WhatsAppSendResult } from "../providers/whatsapp/WhatsAppProvider.js";
import { FabricaDeProviders, NumeroNaoConfigurado } from "../providers/whatsapp/fabrica.js";
import { getRedisConnection } from "./connection.js";

// Respostas são poucas e escritas por uma pessoa esperando: não há por que enviar em paralelo.
const CONCORRENCIA = 2;

export function createMensagemSaidaWorker(db: Db, providers: FabricaDeProviders): Worker<MensagemSaidaJobData> {
  return new Worker<MensagemSaidaJobData>(
    MENSAGEM_SAIDA_QUEUE_NAME,
    async (job) => {
      await enviarMensagem(db, providers, job.data.mensagemId);
    },
    { connection: getRedisConnection(), concurrency: CONCORRENCIA },
  );
}

async function enviarMensagem(db: Db, providers: FabricaDeProviders, mensagemId: number): Promise<void> {
  const [mensagem] = await db.select().from(mensagensSaida).where(eq(mensagensSaida.id, mensagemId));

  // Já enviada (job repetido) ou apagada: nada a fazer.
  if (!mensagem || mensagem.statusEnvio !== "pendente") return;

  let resultado: WhatsAppSendResult;
  try {
    if (!mensagem.numeroId) throw new NumeroNaoConfigurado("A mensagem não tem número de origem definido.");
    const provider = await providers.para(mensagem.numeroId);

    if (mensagem.tipo === "audio") {
      if (!mensagem.midiaUrl || !mensagem.midiaMimeType) throw new Error("Mensagem de áudio sem arquivo gravado.");
      const audio = await lerMidiaLocal(mensagem.midiaUrl);
      resultado = await provider.enviarAudio({ telefone: mensagem.telefone, audio, mimeType: mensagem.midiaMimeType });
    } else if (mensagem.tipo === "imagem") {
      if (!mensagem.midiaUrl) throw new Error("Mensagem de imagem sem arquivo gravado.");
      resultado = await provider.enviarImagem({ telefone: mensagem.telefone, midiaUrl: mensagem.midiaUrl, legenda: mensagem.texto || undefined });
    } else {
      resultado = await provider.enviarTexto({ telefone: mensagem.telefone, texto: mensagem.texto });
    }
  } catch (err) {
    resultado = { sucesso: false, erro: err instanceof Error ? err.message : String(err) };
  }

  await db
    .update(mensagensSaida)
    .set({
      statusEnvio: resultado.sucesso ? "enviado" : "falhou",
      tentativas: mensagem.tentativas + 1,
      erroDetalhe: resultado.sucesso ? null : (resultado.erro ?? "Falha desconhecida"),
      mensagemExternaId: resultado.mensagemId ?? null,
      enviadoEm: resultado.sucesso ? new Date() : null,
    })
    .where(eq(mensagensSaida.id, mensagemId));
}
