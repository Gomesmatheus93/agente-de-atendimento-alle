import type { Db } from "@atendimento-academias/db";
import {
  campanhasDisparo,
  contatos,
  conversasConfig,
  disparoDestinatarios,
  mensagensSaida,
  respostasClientes,
  sugestoesIa,
  templatesWhatsapp,
  conversaExcluidaEm,
} from "@atendimento-academias/db";
import {
  IA_SUGESTAO_QUEUE_NAME,
  JANELA_RESPOSTA_MS,
  preencherTemplate,
  type IaSugestaoJobData,
} from "@atendimento-academias/shared";
import { Worker } from "bullmq";
import { and, desc, eq, gt, max } from "drizzle-orm";
import type { AgenteAtendimento, MensagemDaConversa } from "../ia/agenteAtendimento.js";
import { getRedisConnection } from "./connection.js";

// Contexto que a IA lê: o bastante para entender a conversa sem pagar por histórico antigo.
const MAX_MENSAGENS_NO_CONTEXTO = 40;

export function createIaSugestaoWorker(db: Db, agente: AgenteAtendimento): Worker<IaSugestaoJobData> {
  return new Worker<IaSugestaoJobData>(
    IA_SUGESTAO_QUEUE_NAME,
    async (job) => {
      await sugerirResposta(db, agente, job.data.telefone, job.data.numeroId);
    },
    // Uma chamada ao modelo leva segundos; poucas em paralelo evitam estourar o limite de taxa da API.
    { connection: getRedisConnection(), concurrency: 2 },
  );
}

async function sugerirResposta(db: Db, agente: AgenteAtendimento, telefone: string, numeroId: number): Promise<void> {
  // As condições são conferidas aqui, na hora de rodar: entre enfileirar e rodar a conversa pode ter mudado.
  const [config] = await db
    .select()
    .from(conversasConfig)
    .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
  if (!config?.iaAtiva || config.precisaHumano) return;

  const [ultimaDoCliente] = await db
    .select({ id: respostasClientes.id, em: respostasClientes.recebidaEm })
    .from(respostasClientes)
    .where(and(eq(respostasClientes.telefone, telefone), eq(respostasClientes.numeroId, numeroId)))
    .orderBy(desc(respostasClientes.recebidaEm), desc(respostasClientes.id))
    .limit(1);
  if (!ultimaDoCliente) return;

  // Fora da janela de 24h o WhatsApp não aceita texto livre: uma sugestão não teria como ser enviada.
  if (Date.now() - ultimaDoCliente.em.getTime() > JANELA_RESPOSTA_MS) return;

  // Já falamos com o cliente depois da última mensagem dele — por resposta da equipe ou por um disparo.
  const [[{ ultimaSaida }], [{ ultimoDisparo }]] = await Promise.all([
    db
      .select({ ultimaSaida: max(mensagensSaida.createdAt) })
      .from(mensagensSaida)
      .where(and(eq(mensagensSaida.telefone, telefone), eq(mensagensSaida.numeroId, numeroId))),
    db
      .select({ ultimoDisparo: max(disparoDestinatarios.enviadoEm) })
      .from(disparoDestinatarios)
      .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
      .where(
        and(
          eq(disparoDestinatarios.telefone, telefone),
          eq(disparoDestinatarios.statusEnvio, "enviado"),
          eq(campanhasDisparo.numeroId, numeroId),
        ),
      ),
  ]);
  const jaFalamosDepois = [ultimaSaida, ultimoDisparo].some(
    (em) => em && new Date(em as unknown as string | Date) > ultimaDoCliente.em,
  );
  if (jaFalamosDepois) return;

  // Já existe sugestão para este ponto da conversa (job repetido, ou pedido duplo pelo painel).
  const [jaSugerida] = await db
    .select({ id: sugestoesIa.id })
    .from(sugestoesIa)
    .where(
      and(
        eq(sugestoesIa.telefone, telefone),
        eq(sugestoesIa.numeroId, numeroId),
        eq(sugestoesIa.respostaClienteId, ultimaDoCliente.id),
      ),
    )
    .limit(1);
  if (jaSugerida) return;

  const [mensagens, [contato]] = await Promise.all([
    carregarConversa(db, telefone, numeroId),
    db.select({ nomePerfil: contatos.nomePerfil }).from(contatos).where(eq(contatos.telefone, telefone)),
  ]);

  const resultado = await agente.sugerir({ telefone, nomeCliente: contato?.nomePerfil ?? null, mensagens });

  if (resultado.tipo === "sem_resposta") {
    console.warn(`[ia] sem sugestão para ${telefone}: ${resultado.motivo}`);
    return;
  }

  await db.transaction(async (tx) => {
    // Uma sugestão nova, ou a passagem para humano, torna velha qualquer sugestão ainda pendente.
    await tx
      .update(sugestoesIa)
      .set({ status: "descartada" })
      .where(and(eq(sugestoesIa.telefone, telefone), eq(sugestoesIa.numeroId, numeroId), eq(sugestoesIa.status, "pendente")));

    if (resultado.tipo === "humano") {
      await tx
        .update(conversasConfig)
        .set({ precisaHumano: true, motivoHumano: resultado.motivo.slice(0, 500) })
        .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
      return;
    }

    await tx.insert(sugestoesIa).values({
      telefone,
      numeroId,
      texto: resultado.texto,
      respostaClienteId: ultimaDoCliente.id,
      modelo: resultado.modelo,
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
    });
  });

  console.log(
    resultado.tipo === "humano"
      ? `[ia] ${telefone} passou para humano: ${resultado.motivo}`
      : `[ia] sugestão pronta para ${telefone} (${resultado.modelo}, ${resultado.tokensEntrada} tokens de entrada, ${resultado.tokensSaida} de saída)`,
  );
}

// O áudio/figurinha não tem texto gravado (tipo != "texto"); a IA não vê mídia (README), então em vez de
// uma linha em branco ela lê que algo chegou — o bastante para saber que precisa pedir humano.
function textoParaIa(tipo: string, texto: string): string {
  if (tipo === "audio") return "[cliente enviou um áudio]";
  if (tipo === "figurinha") return "[cliente enviou uma figurinha]";
  if (tipo === "imagem") return `[imagem anexada]${texto ? ` ${texto}` : ""}`;
  return texto;
}

// Junta o que o cliente escreveu, os templates que disparamos e as respostas da equipe, em ordem de horário.
// Exportada: a análise diária (analise-conversas-queue) lê a conversa do mesmo jeito, com mais mensagens.
export async function carregarConversa(
  db: Db,
  telefone: string,
  numeroId: number,
  limite = MAX_MENSAGENS_NO_CONTEXTO,
): Promise<MensagemDaConversa[]> {
  // Conversa excluída na tela: o que veio antes não entra no que a IA lê.
  const excluidaEm = await conversaExcluidaEm(db, telefone, numeroId);
  const depois = (coluna: Parameters<typeof gt>[0]) => (excluidaEm ? gt(coluna, excluidaEm) : undefined);

  const [recebidas, disparos, enviadas] = await Promise.all([
    db
      .select({ tipo: respostasClientes.tipo, texto: respostasClientes.texto, em: respostasClientes.recebidaEm })
      .from(respostasClientes)
      .where(and(eq(respostasClientes.telefone, telefone), eq(respostasClientes.numeroId, numeroId), depois(respostasClientes.recebidaEm)))
      .orderBy(desc(respostasClientes.recebidaEm))
      .limit(limite),
    db
      .select({ em: disparoDestinatarios.enviadoEm, parametros: disparoDestinatarios.parametros, conteudo: templatesWhatsapp.conteudo })
      .from(disparoDestinatarios)
      .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(
        and(
          eq(disparoDestinatarios.telefone, telefone),
          eq(disparoDestinatarios.statusEnvio, "enviado"),
          eq(campanhasDisparo.numeroId, numeroId),
          depois(disparoDestinatarios.enviadoEm),
        ),
      )
      .orderBy(desc(disparoDestinatarios.enviadoEm))
      .limit(limite),
    db
      .select({ tipo: mensagensSaida.tipo, texto: mensagensSaida.texto, em: mensagensSaida.createdAt })
      .from(mensagensSaida)
      .where(
        and(
          eq(mensagensSaida.telefone, telefone),
          eq(mensagensSaida.numeroId, numeroId),
          eq(mensagensSaida.statusEnvio, "enviado"),
          depois(mensagensSaida.createdAt),
        ),
      )
      .orderBy(desc(mensagensSaida.createdAt))
      .limit(limite),
  ]);

  const todas: MensagemDaConversa[] = [
    ...recebidas.map((linha) => ({ autor: "cliente" as const, texto: textoParaIa(linha.tipo, linha.texto), em: linha.em })),
    ...disparos.flatMap((linha) =>
      linha.em ? [{ autor: "empresa" as const, texto: preencherTemplate(linha.conteudo, linha.parametros), em: linha.em }] : [],
    ),
    ...enviadas.map((linha) => ({ autor: "empresa" as const, texto: textoParaIa(linha.tipo, linha.texto), em: linha.em })),
  ];

  return todas.sort((a, b) => a.em.getTime() - b.em.getTime()).slice(-limite);
}
