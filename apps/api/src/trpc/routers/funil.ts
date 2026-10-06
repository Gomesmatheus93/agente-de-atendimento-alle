import { configuracoes, contatos, conversasConfig, conversasExcluidas, funilClientes, respostasClientes } from "@atendimento-academias/db";
import {
  CHAVE_ANALISE_DISPONIVEL,
  CHAVE_ANALISE_STATUS,
  ETAPAS_FUNIL,
  moverNoFunilInputSchema,
  type EtapaFunil,
  type StatusDaAnalise,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { pedirAnaliseDeConversas } from "../../queue.js";
import { procedimentoAutenticado, router } from "../trpc.js";

// O quadro mostra as conversas mais recentes; acima disso o kanban deixa de ser legível mesmo.
const MAX_CARDS = 1000;
const TAMANHO_PREVIA = 160;

export const funilRouter = router({
  // Um card por cliente que já respondeu (número + telefone). Sem linha em funil_clientes = "em_conversa".
  quadro: procedimentoAutenticado.query(async ({ ctx }) => {
    const conversas = await ctx.db
      .select({
        numeroId: respostasClientes.numeroId,
        telefone: respostasClientes.telefone,
        ultimaId: max(respostasClientes.id),
        ultimaEm: max(respostasClientes.recebidaEm),
        mensagens: count(),
        naoLidas: sql<number>`count(*) filter (where ${respostasClientes.lidaEm} is null)`.mapWith(Number),
      })
      .from(respostasClientes)
      .where(isNotNull(respostasClientes.numeroId))
      .groupBy(respostasClientes.numeroId, respostasClientes.telefone)
      .orderBy(desc(max(respostasClientes.recebidaEm)))
      .limit(MAX_CARDS);

    const ids = conversas.flatMap((conversa) => (conversa.ultimaId === null ? [] : [conversa.ultimaId]));
    const telefones = [...new Set(conversas.map((conversa) => conversa.telefone))];

    const [ultimas, funil, nomes, configs, exclusoes] = await Promise.all([
      ids.length ? ctx.db.select({ id: respostasClientes.id, tipo: respostasClientes.tipo, texto: respostasClientes.texto }).from(respostasClientes).where(inArray(respostasClientes.id, ids)) : [],
      ctx.db.select().from(funilClientes),
      telefones.length ? ctx.db.select().from(contatos).where(inArray(contatos.telefone, telefones)) : [],
      telefones.length
        ? ctx.db.select({ telefone: conversasConfig.telefone, numeroId: conversasConfig.numeroId, precisaHumano: conversasConfig.precisaHumano }).from(conversasConfig).where(inArray(conversasConfig.telefone, telefones))
        : [],
      ctx.db.select().from(conversasExcluidas),
    ]);

    // Conversa excluída sai do funil até o cliente escrever de novo.
    const excluidaEm = new Map(exclusoes.map((linha) => [`${linha.numeroId}:${linha.telefone}`, linha.excluidaEm]));

    const textoPorId = new Map(ultimas.map((linha) => [linha.id, linha.tipo === "texto" ? linha.texto : `[${linha.tipo}]`]));
    const funilPorConversa = new Map(funil.map((linha) => [`${linha.numeroId}:${linha.telefone}`, linha]));
    const nomePorTelefone = new Map(nomes.map((linha) => [linha.telefone, linha.nomePerfil]));
    const humanoPorConversa = new Map(configs.map((linha) => [`${linha.numeroId}:${linha.telefone}`, linha.precisaHumano]));

    const cards = conversas
      .filter((conversa) => {
        const excluida = excluidaEm.get(`${conversa.numeroId}:${conversa.telefone}`);
        return !excluida || (conversa.ultimaEm !== null && conversa.ultimaEm > excluida);
      })
      .map((conversa) => {
      const situacao = funilPorConversa.get(`${conversa.numeroId}:${conversa.telefone}`);
      const texto = (conversa.ultimaId !== null ? textoPorId.get(conversa.ultimaId) : undefined) ?? "";
      return {
        numeroId: conversa.numeroId!,
        telefone: conversa.telefone,
        nome: nomePorTelefone.get(conversa.telefone)?.trim() || null,
        ultimaMensagem: texto.length > TAMANHO_PREVIA ? `${texto.slice(0, TAMANHO_PREVIA - 1)}…` : texto,
        ultimaEm: conversa.ultimaEm?.toISOString() ?? null,
        mensagens: conversa.mensagens,
        naoLidas: conversa.naoLidas,
        precisaHumano: humanoPorConversa.get(`${conversa.numeroId}:${conversa.telefone}`) ?? false,
        etapa: (situacao?.etapa ?? "em_conversa") as EtapaFunil,
        etapaOrigem: situacao?.etapaOrigem ?? null,
        motivoPerda: situacao?.motivoPerda ?? null,
        motivoDetalhe: situacao?.motivoDetalhe ?? null,
        resumo: situacao?.resumo ?? null,
        proximoPasso: situacao?.proximoPasso ?? null,
        analisadoEm: situacao?.analisadoEm?.toISOString() ?? null,
      };
    });

    const porEtapa = Object.fromEntries(ETAPAS_FUNIL.map((etapa) => [etapa, cards.filter((card) => card.etapa === etapa).length])) as Record<EtapaFunil, number>;
    const motivos = new Map<string, number>();
    for (const card of cards) if (card.etapa === "nao_fechou" && card.motivoPerda) motivos.set(card.motivoPerda, (motivos.get(card.motivoPerda) ?? 0) + 1);
    const decididos = porEtapa.fechou + porEtapa.nao_fechou;

    return {
      cards,
      porEtapa,
      taxaFechamento: decididos > 0 ? porEtapa.fechou / decididos : null,
      motivos: [...motivos.entries()].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total),
    };
  }),

  // Mover à mão fixa a etapa: a análise diária continua atualizando o resumo, mas não muda mais o card de coluna.
  mover: procedimentoAutenticado.input(moverNoFunilInputSchema).mutation(async ({ ctx, input }) => {
    const perdeu = input.etapa === "nao_fechou";
    const valores = {
      etapa: input.etapa,
      etapaOrigem: "manual" as const,
      motivoPerda: perdeu ? (input.motivoPerda ?? "outro") : null,
      motivoDetalhe: perdeu ? input.motivoDetalhe || null : null,
    };
    await ctx.db
      .insert(funilClientes)
      .values({ numeroId: input.numeroId, telefone: input.telefone, ...valores })
      .onConflictDoUpdate({ target: [funilClientes.numeroId, funilClientes.telefone],  set: valores });
    return { ok: true };
  }),

  // Devolve o card para a IA decidir a etapa na próxima análise.
  devolverParaIa: procedimentoAutenticado
    .input(moverNoFunilInputSchema.pick({ telefone: true, numeroId: true }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(funilClientes)
        // Zerar a última mensagem analisada faz a próxima rodada reler a conversa e reposicionar o card.
        .set({ etapaOrigem: "ia", ultimaMensagemAnalisada: null })
        .where(and(eq(funilClientes.numeroId, input.numeroId), eq(funilClientes.telefone, input.telefone)));
      return { ok: true };
    }),

  statusAnalise: procedimentoAutenticado.query(async ({ ctx }) => {
    const linhas = await ctx.db
      .select()
      .from(configuracoes)
      .where(inArray(configuracoes.chave, [CHAVE_ANALISE_STATUS, CHAVE_ANALISE_DISPONIVEL]));
    const status = linhas.find((linha) => linha.chave === CHAVE_ANALISE_STATUS)?.valor;
    return {
      disponivel: linhas.find((linha) => linha.chave === CHAVE_ANALISE_DISPONIVEL)?.valor === "1",
      ultima: status ? (JSON.parse(status) as StatusDaAnalise) : null,
    };
  }),

  analisarAgora: procedimentoAutenticado.mutation(async ({ ctx }) => {
    const [disponivel] = await ctx.db.select().from(configuracoes).where(eq(configuracoes.chave, CHAVE_ANALISE_DISPONIVEL));
    if (disponivel?.valor !== "1") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "A análise por IA está desligada: coloque a ANTHROPIC_API_KEY no .env da raiz do projeto e reinicie o worker.",
      });
    }
    await pedirAnaliseDeConversas();
    return { ok: true };
  }),
});
