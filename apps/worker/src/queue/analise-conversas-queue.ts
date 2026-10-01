import { configuracoes, contatos, conversasExcluidas, duvidasIa, funilClientes, mensagensSaida, respostasClientes, type Db } from "@atendimento-academias/db";
import {
  ANALISE_CONVERSAS_JOB_NAME,
  ANALISE_CONVERSAS_QUEUE_NAME,
  ANALISE_DIARIA_SCHEDULER_ID,
  CHAVE_ANALISE_DISPONIVEL,
  CHAVE_ANALISE_STATUS,
  type AnaliseConversasJobData,
  type StatusDaAnalise,
} from "@atendimento-academias/shared";
import { Queue, Worker } from "bullmq";
import { and, count, desc, eq, isNotNull, max } from "drizzle-orm";
import type { AnalistaConversas } from "../ia/analistaConversas.js";
import { getRedisConnection } from "./connection.js";
import { carregarConversa } from "./ia-sugestao-queue.js";

// Teto por rodada, para o custo de um dia movimentado não fugir do controle: o que sobra fica para a
// próxima (a tela mostra quantas ficaram).
const MAX_CONVERSAS_POR_RODADA = 200;
const MAX_MENSAGENS_ANALISADAS = 80;
const MAX_TEMAS_DE_REFERENCIA = 80;
// Todo dia às 3h (horário de Brasília): pega o dia anterior inteiro e já está pronto de manhã.
const HORARIO_DIARIO = "0 3 * * *";

async function salvarConfiguracao(db: Db, chave: string, valor: string): Promise<void> {
  await db.insert(configuracoes).values({ chave, valor, secreto: false }).onConflictDoUpdate({ target: configuracoes.chave,  set: { valor } });
}

const salvarStatus = (db: Db, status: StatusDaAnalise) => salvarConfiguracao(db, CHAVE_ANALISE_STATUS, JSON.stringify(status));

// Conversas com mensagem do cliente e algo novo (dele ou nosso) desde a última análise, das mais recentes para as mais antigas.
async function conversasComNovidade(db: Db) {
  const [recebidas, enviadas, analisadas, exclusoes] = await Promise.all([
    db
      .select({ numeroId: respostasClientes.numeroId, telefone: respostasClientes.telefone, ultima: max(respostasClientes.recebidaEm) })
      .from(respostasClientes)
      .where(isNotNull(respostasClientes.numeroId))
      .groupBy(respostasClientes.numeroId, respostasClientes.telefone),
    db
      .select({ numeroId: mensagensSaida.numeroId, telefone: mensagensSaida.telefone, ultima: max(mensagensSaida.createdAt) })
      .from(mensagensSaida)
      .where(and(isNotNull(mensagensSaida.numeroId), eq(mensagensSaida.statusEnvio, "enviado")))
      .groupBy(mensagensSaida.numeroId, mensagensSaida.telefone),
    db
      .select({
        numeroId: funilClientes.numeroId,
        telefone: funilClientes.telefone,
        etapaOrigem: funilClientes.etapaOrigem,
        ultimaMensagemAnalisada: funilClientes.ultimaMensagemAnalisada,
      })
      .from(funilClientes),
    db.select().from(conversasExcluidas),
  ]);

  const chave = (numeroId: number, telefone: string) => `${numeroId}:${telefone}`;
  const conversas = new Map<string, { numeroId: number; telefone: string; ultima: Date }>();
  for (const linha of recebidas) {
    if (linha.numeroId === null || !linha.ultima) continue;
    conversas.set(chave(linha.numeroId, linha.telefone), { numeroId: linha.numeroId, telefone: linha.telefone, ultima: linha.ultima });
  }
  // Só conta a nossa última mensagem em conversa onde o cliente já escreveu.
  for (const linha of enviadas) {
    const conversa = linha.numeroId === null ? undefined : conversas.get(chave(linha.numeroId, linha.telefone));
    if (conversa && linha.ultima && linha.ultima > conversa.ultima) conversa.ultima = linha.ultima;
  }

  const funil = new Map(analisadas.map((linha) => [chave(linha.numeroId, linha.telefone), linha]));
  const excluidaEm = new Map(exclusoes.map((linha) => [chave(linha.numeroId, linha.telefone), linha.excluidaEm]));
  const pendentes = [...conversas.values()]
    .filter((conversa) => {
      const excluida = excluidaEm.get(chave(conversa.numeroId, conversa.telefone));
      if (excluida && conversa.ultima.getTime() <= excluida.getTime()) return false;
      const anterior = funil.get(chave(conversa.numeroId, conversa.telefone))?.ultimaMensagemAnalisada;
      return !anterior || conversa.ultima.getTime() > anterior.getTime();
    })
    .sort((a, b) => b.ultima.getTime() - a.ultima.getTime());

  return { pendentes, funil, chave };
}

async function rodarAnalise(db: Db, analista: AnalistaConversas, origem: AnaliseConversasJobData["origem"]): Promise<void> {
  const inicio = new Date().toISOString();
  await salvarStatus(db, { situacao: "rodando", origem, inicio });

  const { pendentes, funil, chave } = await conversasComNovidade(db);
  const daRodada = pendentes.slice(0, MAX_CONVERSAS_POR_RODADA);

  // Os temas mais usados vão no pedido, para a IA reaproveitar o mesmo rótulo e o ranking somar certo.
  const temas = (
    await db
      .select({ tema: duvidasIa.tema, vezes: count() })
      .from(duvidasIa)
      .groupBy(duvidasIa.tema)
      .orderBy(desc(count()))
      .limit(MAX_TEMAS_DE_REFERENCIA)
  ).map((linha) => linha.tema);

  let analisadas = 0;
  let erros = 0;
  let tokensEntrada = 0;
  let tokensSaida = 0;

  for (const conversa of daRodada) {
    try {
      const mensagens = await carregarConversa(db, conversa.telefone, conversa.numeroId, MAX_MENSAGENS_ANALISADAS);
      if (!mensagens.some((mensagem) => mensagem.autor === "cliente")) continue;

      const [contato] = await db.select({ nome: contatos.nomePerfil }).from(contatos).where(eq(contatos.telefone, conversa.telefone));
      const resultado = await analista.analisar(mensagens, contato?.nome ?? null, temas);
      if (!resultado) {
        erros += 1;
        continue;
      }
      tokensEntrada += resultado.tokensEntrada;
      tokensSaida += resultado.tokensSaida;

      // Etapa movida à mão pela equipe vale mais que a análise: a IA só atualiza o resumo.
      const manual = funil.get(chave(conversa.numeroId, conversa.telefone))?.etapaOrigem === "manual";
      const analise = {
        resumo: resultado.resumo || null,
        proximoPasso: resultado.proximoPasso || null,
        analisadoEm: new Date(),
        ultimaMensagemAnalisada: conversa.ultima,
      };
      const etapa = manual
        ? {}
        : {
            etapa: resultado.etapa,
            etapaOrigem: "ia" as const,
            motivoPerda: resultado.motivoPerda,
            motivoDetalhe: resultado.motivoPerda ? resultado.motivoDetalhe || null : null,
          };

      await db
        .insert(funilClientes)
        .values({ numeroId: conversa.numeroId, telefone: conversa.telefone, ...analise, ...etapa })
        .onConflictDoUpdate({ target: [funilClientes.numeroId, funilClientes.telefone],  set: { ...analise, ...etapa } });

      await db
        .delete(duvidasIa)
        .where(and(eq(duvidasIa.numeroId, conversa.numeroId), eq(duvidasIa.telefone, conversa.telefone)));
      if (resultado.perguntas.length > 0) {
        await db.insert(duvidasIa).values(
          resultado.perguntas.map((pergunta) => ({
            numeroId: conversa.numeroId,
            telefone: conversa.telefone,
            tema: pergunta.tema,
            pergunta: pergunta.pergunta,
            sanada: pergunta.sanada,
            perguntadaEm: mensagens[pergunta.mensagem - 1]!.em,
          })),
        );
        for (const { tema } of resultado.perguntas) if (!temas.includes(tema)) temas.push(tema);
      }
      analisadas += 1;
    } catch (erro) {
      erros += 1;
      console.error(`[analise] falha na conversa ${conversa.numeroId}/${conversa.telefone}:`, erro);
    }
  }

  await salvarStatus(db, {
    situacao: "concluida",
    origem,
    inicio,
    fim: new Date().toISOString(),
    analisadas,
    erros,
    restantes: pendentes.length - daRodada.length,
    tokensEntrada,
    tokensSaida,
  });
  console.log(`[analise] rodada ${origem}: ${analisadas} conversa(s) analisada(s), ${erros} erro(s), ${pendentes.length - daRodada.length} para a próxima`);
}

export function createAnaliseConversasWorker(db: Db, analista: AnalistaConversas): Worker<AnaliseConversasJobData> {
  // Uma rodada por vez: duas ao mesmo tempo analisariam as mesmas conversas e pagariam duas vezes.
  return new Worker<AnaliseConversasJobData>(
    ANALISE_CONVERSAS_QUEUE_NAME,
    async (job) => {
      try {
        await rodarAnalise(db, analista, job.data.origem);
      } catch (erro) {
        await salvarStatus(db, {
          situacao: "falhou",
          origem: job.data.origem,
          inicio: new Date(job.timestamp).toISOString(),
          fim: new Date().toISOString(),
          mensagemErro: erro instanceof Error ? erro.message : String(erro),
        });
        throw erro;
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );
}

// Agenda a rodada diária (idempotente: subir o worker de novo só confirma o mesmo agendamento) e
// registra se a IA está disponível, para a tela avisar quando falta a chave da Anthropic.
export async function agendarAnaliseDiaria(db: Db, disponivel: boolean): Promise<void> {
  await salvarConfiguracao(db, CHAVE_ANALISE_DISPONIVEL, disponivel ? "1" : "0");
  if (!disponivel) return;

  const fila = new Queue<AnaliseConversasJobData>(ANALISE_CONVERSAS_QUEUE_NAME, { connection: getRedisConnection() });
  await fila.upsertJobScheduler(
    ANALISE_DIARIA_SCHEDULER_ID,
    { pattern: HORARIO_DIARIO, tz: "America/Sao_Paulo" },
    {
      name: ANALISE_CONVERSAS_JOB_NAME,
      data: { origem: "agendada" },
      opts: { removeOnComplete: { age: 7 * 86_400 }, removeOnFail: { age: 7 * 86_400 } },
    },
  );
  await fila.close();
}
