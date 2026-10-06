import {
  campanhasDisparo,
  contatos,
  conversasConfig,
  disparoDestinatarios,
  mensagensSaida,
  respostasClientes,
  sugestoesIa,
  templatesWhatsapp,
  type Db,
  conversaExcluidaEm,
  conversasExcluidas,
  duvidasIa,
  funilClientes,
  assumirAtendimento,
  distribuirFilaDoNumero,
  numerosWhatsapp,
  usuarios,
} from "@atendimento-academias/db";
import {
  JANELA_RESPOSTA_MS,
  MENSAGEM_SAIDA_JOB_NAME,
  mensagemSaidaJobId,
  preencherTemplate,
  type StatusEnvio,
  type TipoMensagem,
  LIMITE_LEGENDA_IMAGEM,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull, lte, max, sql, type SQL } from "drizzle-orm";
import { getMensagemSaidaQueue } from "../queue.js";

const MAX_RESPOSTAS_NA_CONVERSA = 300;
const MAX_ENVIOS_NA_CONVERSA = 100;
const MAX_SAIDAS_NA_CONVERSA = 200;

export interface MensagemDaConversa {
  id: string;
  direcao: "recebida" | "enviada";
  origem: "cliente" | "disparo" | "resposta";
  tipo: TipoMensagem;
  texto: string;
  midiaUrl: string | null;
  em: string;
  campanhaId: number | null;
  campanhaNome: string | null;
  status: StatusEnvio | null;
  erro: string | null;
  respostaId: number | null;
}

// Toda rota que recebe um número (tela ou integração) passa por aqui: número de outra unidade é tratado
// como inexistente, para uma unidade não ler nem responder conversa da outra.
export async function garantirNumeroDaUnidade(db: Db, numeroId: number, unidadeId: number): Promise<void> {
  const [numero] = await db
    .select({ id: numerosWhatsapp.id })
    .from(numerosWhatsapp)
    .where(and(eq(numerosWhatsapp.id, numeroId), eq(numerosWhatsapp.unidadeId, unidadeId)));
  if (!numero) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
}

export async function ultimaMensagemDoCliente(db: Db, telefone: string, numeroId: number): Promise<Date | null> {
  const [linha] = await db
    .select({ em: max(respostasClientes.recebidaEm) })
    .from(respostasClientes)
    .where(and(eq(respostasClientes.telefone, telefone), eq(respostasClientes.numeroId, numeroId)));

  return linha?.em ? new Date(linha.em as unknown as string | Date) : null;
}

// O WhatsApp só permite texto livre por 24h depois da última mensagem do cliente.
export function garantirJanelaAberta(ultimaDoCliente: Date | null): void {
  if (!ultimaDoCliente) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Só é possível responder a quem já enviou uma mensagem." });
  }
  if (Date.now() - ultimaDoCliente.getTime() > JANELA_RESPOSTA_MS) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A janela de 24h para resposta livre já fechou. Para falar com esse cliente agora, envie um template em uma nova campanha.",
    });
  }
}

export async function enfileirarResposta(db: Db, mensagemId: number, tentativa: number, atrasoMs = 0): Promise<void> {
  try {
    await getMensagemSaidaQueue().add(
      MENSAGEM_SAIDA_JOB_NAME,
      { mensagemId },
      { jobId: mensagemSaidaJobId(mensagemId, tentativa), ...(atrasoMs > 0 ? { delay: atrasoMs } : {}) },
    );
  } catch (cause) {
    await db
      .update(mensagensSaida)
      .set({ statusEnvio: "falhou", erroDetalhe: "Falha ao enfileirar o envio" })
      .where(eq(mensagensSaida.id, mensagemId));

    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível enfileirar o envio", cause });
  }
}

// Responder conta como ler, como no WhatsApp: o que o cliente escreveu até agora sai de "não lidas". Sem
// isso, toda conversa que o bot do n8n respondeu sozinho ficava com o aviso de não lida no menu.
export async function marcarComoRespondida(db: Db, telefone: string, numeroId: number): Promise<void> {
  const agora = new Date();
  await db
    .update(respostasClientes)
    .set({ lidaEm: agora })
    .where(
      and(
        eq(respostasClientes.telefone, telefone),
        eq(respostasClientes.numeroId, numeroId),
        isNull(respostasClientes.lidaEm),
        lte(respostasClientes.recebidaEm, agora),
      ),
    );
}

// Usada pela tela (tRPC) e pela API de integração: envia texto livre, checando a janela de 24h.
// "sem revisão" — quem chama (painel ou automação) já decidiu o texto; não existe rascunho aqui.
export async function enviarMensagem(
  db: Db,
  input: {
    telefone: string;
    numeroId: number;
    texto: string;
    sugestaoId?: number;
    // Imagem do agente (midias_agente) anexada à resposta: o texto vai como legenda quando cabe.
    imagem?: { midiaUrl: string; mimeType: string };
  },
  // Funcionário que escreveu pelo painel: se a conversa estiver sem atendente, ela passa a ser dele
  // (e ele fica ocupado na fila). Resposta do bot (integração) não tem autor.
  autorId?: number,
): Promise<{ id: number }> {
  garantirJanelaAberta(await ultimaMensagemDoCliente(db, input.telefone, input.numeroId));
  const conversa = { telefone: input.telefone, numeroId: input.numeroId };

  let id: number;
  if (!input.imagem) {
    [{ id }] = await db.insert(mensagensSaida).values({ ...conversa, texto: input.texto }).returning({ id: mensagensSaida.id });
    await enfileirarResposta(db, id, 1);
  } else if (input.texto.length <= LIMITE_LEGENDA_IMAGEM) {
    // Uma mensagem só: a imagem com a resposta de legenda, como o cliente vê no WhatsApp.
    [{ id }] = await db
      .insert(mensagensSaida)
      .values({ ...conversa, tipo: "imagem", texto: input.texto, midiaUrl: input.imagem.midiaUrl, midiaMimeType: input.imagem.mimeType })
      .returning({ id: mensagensSaida.id });
    await enfileirarResposta(db, id, 1);
  } else {
    // Legenda passa do limite do WhatsApp: a imagem vai sozinha e o texto logo depois. O atraso garante
    // a ordem (a fila envia até duas mensagens ao mesmo tempo).
    const [imagem] = await db
      .insert(mensagensSaida)
      .values({ ...conversa, tipo: "imagem", texto: "", midiaUrl: input.imagem.midiaUrl, midiaMimeType: input.imagem.mimeType })
      .returning({ id: mensagensSaida.id });
    await enfileirarResposta(db, imagem!.id, 1);
    [{ id }] = await db.insert(mensagensSaida).values({ ...conversa, texto: input.texto }).returning({ id: mensagensSaida.id });
    await enfileirarResposta(db, id, 1, 4000);
  }

  await marcarComoRespondida(db, input.telefone, input.numeroId);
  if (autorId !== undefined) await assumirAtendimento(db, input.telefone, input.numeroId, autorId);

  if (input.sugestaoId) {
    await db
      .update(sugestoesIa)
      .set({ status: "enviada" })
      .where(
        and(
          eq(sugestoesIa.id, input.sugestaoId),
          eq(sugestoesIa.telefone, input.telefone),
          eq(sugestoesIa.numeroId, input.numeroId),
          eq(sugestoesIa.status, "pendente"),
        ),
      );
  }

  return { id };
}

// A conversa reúne o que o cliente escreveu, os disparos que enviamos (template já preenchido) e as
// respostas da equipe (ou de automação), em ordem de horário. Usada pela tela e pela API de integração.
export async function obterConversa(db: Db, telefone: string, numeroId: number) {
  // Conversa excluída: só vale o que veio depois (ver excluirConversa).
  const excluidaEm = await conversaExcluidaEm(db, telefone, numeroId);
  const depoisDaExclusao = (coluna: Parameters<typeof gt>[0]): SQL | undefined => (excluidaEm ? gt(coluna, excluidaEm) : undefined);

  const [respostas, envios, saidas, [configComAtendente], [contato], [sugestao]] = await Promise.all([
    db
      .select({
        id: respostasClientes.id,
        tipo: respostasClientes.tipo,
        texto: respostasClientes.texto,
        midiaUrl: respostasClientes.midiaUrl,
        em: respostasClientes.recebidaEm,
        lidaEm: respostasClientes.lidaEm,
        campanhaId: respostasClientes.campanhaId,
        campanhaNome: campanhasDisparo.nome,
      })
      .from(respostasClientes)
      .leftJoin(campanhasDisparo, eq(campanhasDisparo.id, respostasClientes.campanhaId))
      .where(
        and(
          eq(respostasClientes.telefone, telefone),
          eq(respostasClientes.numeroId, numeroId),
          depoisDaExclusao(respostasClientes.recebidaEm),
        ),
      )
      .orderBy(desc(respostasClientes.recebidaEm), desc(respostasClientes.id))
      .limit(MAX_RESPOSTAS_NA_CONVERSA),
    db
      .select({
        id: disparoDestinatarios.id,
        em: disparoDestinatarios.enviadoEm,
        parametros: disparoDestinatarios.parametros,
        campanhaId: campanhasDisparo.id,
        campanhaNome: campanhasDisparo.nome,
        conteudo: templatesWhatsapp.conteudo,
      })
      .from(disparoDestinatarios)
      .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(
        and(
          eq(disparoDestinatarios.telefone, telefone),
          eq(disparoDestinatarios.statusEnvio, "enviado"),
          eq(campanhasDisparo.numeroId, numeroId),
          depoisDaExclusao(disparoDestinatarios.enviadoEm),
        ),
      )
      .orderBy(desc(disparoDestinatarios.enviadoEm))
      .limit(MAX_ENVIOS_NA_CONVERSA),
    db
      .select()
      .from(mensagensSaida)
      .where(
        and(eq(mensagensSaida.telefone, telefone), eq(mensagensSaida.numeroId, numeroId), depoisDaExclusao(mensagensSaida.createdAt)),
      )
      .orderBy(desc(mensagensSaida.createdAt), desc(mensagensSaida.id))
      .limit(MAX_SAIDAS_NA_CONVERSA),
    db
      .select({ config: conversasConfig, atendenteNome: usuarios.nome })
      .from(conversasConfig)
      .leftJoin(usuarios, eq(usuarios.id, conversasConfig.atendenteId))
      .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId))),
    db.select().from(contatos).where(eq(contatos.telefone, telefone)),
    db
      .select({ id: sugestoesIa.id, texto: sugestoesIa.texto, em: sugestoesIa.createdAt })
      .from(sugestoesIa)
      .where(and(eq(sugestoesIa.telefone, telefone), eq(sugestoesIa.numeroId, numeroId), eq(sugestoesIa.status, "pendente")))
      .orderBy(desc(sugestoesIa.createdAt))
      .limit(1),
  ]);

  const config = configComAtendente?.config;
  if (respostas.length === 0 && envios.length === 0 && saidas.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada" });
  }

  const mensagens: MensagemDaConversa[] = [
    ...respostas.map((resposta) => ({
      id: `r-${resposta.id}`,
      direcao: "recebida" as const,
      origem: "cliente" as const,
      tipo: resposta.tipo,
      texto: resposta.texto,
      midiaUrl: resposta.midiaUrl,
      em: resposta.em.toISOString(),
      campanhaId: resposta.campanhaId,
      campanhaNome: resposta.campanhaNome,
      status: null,
      erro: null,
      respostaId: null,
    })),
    ...envios.flatMap((envio): MensagemDaConversa[] =>
      envio.em
        ? [
            {
              id: `e-${envio.id}`,
              direcao: "enviada" as const,
              origem: "disparo" as const,
              tipo: "texto" as const,
              texto: preencherTemplate(envio.conteudo, envio.parametros),
              midiaUrl: null,
              em: envio.em.toISOString(),
              campanhaId: envio.campanhaId,
              campanhaNome: envio.campanhaNome,
              status: null,
              erro: null,
              respostaId: null,
            },
          ]
        : [],
    ),
    ...saidas.map(
      (saida): MensagemDaConversa => ({
        id: `s-${saida.id}`,
        direcao: "enviada",
        origem: "resposta",
        tipo: saida.tipo,
        texto: saida.texto,
        midiaUrl: saida.midiaUrl,
        em: saida.createdAt.toISOString(),
        campanhaId: null,
        campanhaNome: null,
        status: saida.statusEnvio,
        erro: saida.erroDetalhe,
        respostaId: saida.id,
      }),
    ),
  ].sort((a, b) => a.em.localeCompare(b.em) || a.id.localeCompare(b.id));

  const nome = contato?.nomePerfil?.trim() || (envios.map((envio) => envio.parametros.nome?.trim()).find(Boolean) ?? null);

  const ultimaDoCliente = respostas[0]?.em ?? null;
  const expiraEm = ultimaDoCliente ? new Date(ultimaDoCliente.getTime() + JANELA_RESPOSTA_MS) : null;

  return {
    telefone,
    numeroId,
    nome,
    naoLidas: respostas.filter((resposta) => resposta.lidaEm === null).length,
    totalRecebidas: respostas.length,
    iaAtiva: config?.iaAtiva ?? false,
    precisaHumano: config?.precisaHumano ?? false,
    motivoHumano: config?.motivoHumano ?? null,
    // Quem está com o atendimento aberto (null = ninguém; o bot responde se a IA estiver ligada).
    atendente:
      config?.atendenteId && configComAtendente?.atendenteNome
        ? { id: config.atendenteId, nome: configComAtendente.atendenteNome, desde: config.atendimentoDesde?.toISOString() ?? null }
        : null,
    sugestao: sugestao ? { id: sugestao.id, texto: sugestao.texto, em: sugestao.em.toISOString() } : null,
    janela: { aberta: expiraEm !== null && expiraEm.getTime() > Date.now(), expiraEm: expiraEm?.toISOString() ?? null },
    mensagens,
  };
}

// O bot (interno ou n8n) decidiu que precisa de uma pessoa: mesma trilha que já existe para a IA
// interna — a conversa ganha o selo "Humano" em Conversas, para de receber resposta automática e entra na
// fila: vai para o próximo funcionário disponível (ou espera, se todos estiverem ocupados).
export async function passarParaHumano(db: Db, telefone: string, numeroId: number, motivo: string): Promise<void> {
  await db
    .insert(conversasConfig)
    .values({ telefone, numeroId, precisaHumano: true, motivoHumano: motivo.slice(0, 500), humanoPedidoEm: new Date() })
    .onConflictDoUpdate({
      target: [conversasConfig.numeroId, conversasConfig.telefone],
      // Pedido repetido mantém o horário do primeiro: o aviso do painel não "renasce" a cada mensagem.
      set: { precisaHumano: true, motivoHumano: motivo.slice(0, 500), humanoPedidoEm: sql`coalesce(${conversasConfig.humanoPedidoEm}, now())` },
    });
  await distribuirFilaDoNumero(db, numeroId);
}

// "Excluir conversa": some de Conversas e do Funil, e o bot/IA passam a ler a conversa vazia. Nada de
// mensagem ou disparo é apagado do banco — as campanhas e os relatórios contam com essas linhas, e o
// disparo é o que faz uma resposta nova do cliente ser aceita pelo webhook (a conversa então recomeça).
export async function excluirConversa(db: Db, telefone: string, numeroId: number): Promise<void> {
  const agora = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(conversasExcluidas)
      .values({ numeroId, telefone, excluidaEm: agora })
      .onConflictDoUpdate({ target: [conversasExcluidas.numeroId, conversasExcluidas.telefone], set: { excluidaEm: agora } });
    // O contador de não lidas do menu não pode ficar apontando para uma conversa que sumiu.
    await tx
      .update(respostasClientes)
      .set({ lidaEm: agora })
      .where(and(eq(respostasClientes.telefone, telefone), eq(respostasClientes.numeroId, numeroId), isNull(respostasClientes.lidaEm)));
    await tx
      .update(sugestoesIa)
      .set({ status: "descartada" })
      .where(and(eq(sugestoesIa.telefone, telefone), eq(sugestoesIa.numeroId, numeroId), eq(sugestoesIa.status, "pendente")));
    // Funil e dúvidas saíram da conversa antiga; se o cliente voltar, a análise começa de novo.
    await tx.delete(funilClientes).where(and(eq(funilClientes.telefone, telefone), eq(funilClientes.numeroId, numeroId)));
    await tx.delete(duvidasIa).where(and(eq(duvidasIa.telefone, telefone), eq(duvidasIa.numeroId, numeroId)));
    await tx
      .update(conversasConfig)
      .set({ precisaHumano: false, motivoHumano: null, humanoPedidoEm: null, atendenteId: null, atendimentoDesde: null })
      .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
  });
  // Quem atendia essa conversa ficou livre.
  await distribuirFilaDoNumero(db, numeroId);
}
