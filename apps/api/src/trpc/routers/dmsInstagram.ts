import {
  apagarDadosDoInstagram,
  ativarDmsInstagram,
  CHAVE_N8N_INSTAGRAM_URL,
  contasInstagram,
  conversasInstagram,
  ErroInstagram,
  mensagensInstagram,
  TAMANHO_MAX_DM,
  tokenDaContaInstagram,
} from "@atendimento-academias/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { motivoUrlRecusada } from "../../rede/urlExterna.js";
import { lerValor, salvarValor } from "../../config/plataforma.js";
import { conversaDaUnidade, enviarDm, JANELA_DM_MS, janelaAberta, reenviarDm } from "../../instagram/dms.js";
import { procedimentoAdmin, procedimentoUnidade, router } from "../trpc.js";

const conversaIdSchema = z.object({ conversaId: z.number().int().positive() });

function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// DMs do Instagram da unidade, no painel de Conversas.
export const dmsInstagramRouter = router({
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const [conta] = await ctx.db.select().from(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    const n8nUrl = await lerValor(ctx.db, ctx.unidadeId, CHAVE_N8N_INSTAGRAM_URL);
    return conta
      ? { conectada: true as const, username: conta.username, dmsAtivas: conta.dmsAtivadasEm !== null, botConfigurado: Boolean(n8nUrl), n8nUrl }
      : { conectada: false as const, username: null, dmsAtivas: false, botConfigurado: false, n8nUrl: null };
  }),

  // Inscreve a conta no webhook das DMs (contas conectadas antes das DMs existirem precisam disto uma vez).
  ativar: procedimentoAdmin.mutation(async ({ ctx }) => {
    const [conta] = await ctx.db.select().from(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    if (!conta) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Conecte o Instagram da unidade primeiro (tela Instagram)." });
    try {
      await ativarDmsInstagram(tokenDaContaInstagram(conta));
    } catch (erro) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `O Instagram recusou: ${erro instanceof ErroInstagram ? erro.message : "erro inesperado"}. Reconecte a conta na tela Instagram e tente de novo.`,
      });
    }
    await ctx.db.update(contasInstagram).set({ dmsAtivadasEm: new Date() }).where(eq(contasInstagram.id, conta.id));
    return { ok: true };
  }),

  // URL do fluxo do n8n que responde as DMs (vazio = sem bot no Instagram).
  definirBot: procedimentoAdmin.input(z.object({ url: z.string().trim().url("URL inválida").max(500).or(z.literal("")) })).mutation(async ({ ctx, input }) => {
    const recusada = input.url ? motivoUrlRecusada(input.url) : null;
    if (recusada) throw new TRPCError({ code: "BAD_REQUEST", message: `URL do n8n: ${recusada}` });
    await salvarValor(ctx.db, ctx.unidadeId, CHAVE_N8N_INSTAGRAM_URL, input.url);
    return { ok: true };
  }),

  listar: procedimentoUnidade.input(z.object({ busca: z.string().trim().max(100).optional(), apenasNaoLidas: z.boolean().default(false) })).query(async ({ ctx, input }) => {
    const busca = input.busca ? `%${escaparLike(input.busca)}%` : null;
    const linhas = await ctx.db
      .select({
        id: conversasInstagram.id,
        username: conversasInstagram.username,
        nome: conversasInstagram.nome,
        ultimaMensagemEm: conversasInstagram.ultimaMensagemEm,
        naoLidas: conversasInstagram.naoLidas,
        iaAtiva: conversasInstagram.iaAtiva,
        precisaHumano: conversasInstagram.precisaHumano,
        ultimaDoClienteEm: conversasInstagram.ultimaDoClienteEm,
        previa: sql<string | null>`(
          select ${mensagensInstagram.texto} from ${mensagensInstagram}
          where ${mensagensInstagram.conversaId} = ${conversasInstagram.id}
          order by ${mensagensInstagram.criadaEm} desc limit 1
        )`,
        previaDoCliente: sql<boolean | null>`(
          select ${mensagensInstagram.origem} = 'cliente' from ${mensagensInstagram}
          where ${mensagensInstagram.conversaId} = ${conversasInstagram.id}
          order by ${mensagensInstagram.criadaEm} desc limit 1
        )`,
      })
      .from(conversasInstagram)
      .innerJoin(contasInstagram, eq(contasInstagram.id, conversasInstagram.contaId))
      .where(
        and(
          eq(contasInstagram.unidadeId, ctx.unidadeId),
          input.apenasNaoLidas ? gt(conversasInstagram.naoLidas, 0) : undefined,
          busca ? or(ilike(conversasInstagram.username, busca), ilike(conversasInstagram.nome, busca)) : undefined,
        ),
      )
      .orderBy(desc(conversasInstagram.ultimaMensagemEm))
      .limit(200);
    return linhas.map((l) => ({
      ...l,
      ultimaMensagemEm: l.ultimaMensagemEm.toISOString(),
      janelaAberta: janelaAberta(l.ultimaDoClienteEm),
      ultimaDoClienteEm: undefined,
    }));
  }),

  detalhe: procedimentoUnidade.input(conversaIdSchema).query(async ({ ctx, input }) => {
    const { conversa, conta } = await conversaDaUnidade(ctx.db, input.conversaId, ctx.unidadeId);
    const mensagens = await ctx.db
      .select()
      .from(mensagensInstagram)
      .where(eq(mensagensInstagram.conversaId, conversa.id))
      .orderBy(desc(mensagensInstagram.criadaEm), desc(mensagensInstagram.id))
      .limit(300);
    return {
      id: conversa.id,
      username: conversa.username,
      nome: conversa.nome,
      conta: conta.username,
      naoLidas: conversa.naoLidas,
      iaAtiva: conversa.iaAtiva,
      precisaHumano: conversa.precisaHumano,
      motivoHumano: conversa.motivoHumano,
      janela: {
        aberta: janelaAberta(conversa.ultimaDoClienteEm),
        expiraEm: conversa.ultimaDoClienteEm ? new Date(conversa.ultimaDoClienteEm.getTime() + JANELA_DM_MS).toISOString() : null,
      },
      mensagens: mensagens.reverse().map((m) => ({
        id: m.id,
        origem: m.origem,
        texto: m.texto,
        midiaUrl: m.midiaUrl,
        status: m.statusEnvio,
        erro: m.erroDetalhe,
        autorNome: m.autorNome,
        em: m.criadaEm.toISOString(),
      })),
    };
  }),

  marcarComoLida: procedimentoUnidade.input(conversaIdSchema).mutation(async ({ ctx, input }) => {
    await conversaDaUnidade(ctx.db, input.conversaId, ctx.unidadeId);
    await ctx.db.update(conversasInstagram).set({ naoLidas: 0 }).where(eq(conversasInstagram.id, input.conversaId));
    return { ok: true };
  }),

  // Como no WhatsApp, a resposta pelo painel sai com o nome de quem respondeu na primeira linha.
  responder: procedimentoUnidade
    .input(conversaIdSchema.extend({ texto: z.string().trim().min(1, "Escreva a mensagem").max(TAMANHO_MAX_DM) }))
    .mutation(async ({ ctx, input }) => {
      const assinatura = ctx.usuario.assinatura?.trim();
      if (!assinatura) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Coloque seu nome no chat antes de responder." });
      const texto = `${assinatura}:\n${input.texto}`;
      const resultado = await enviarDm(ctx.db, input.conversaId, ctx.unidadeId, texto, "equipe", assinatura);
      if (!resultado.enviada) throw new TRPCError({ code: "BAD_REQUEST", message: `O Instagram não aceitou a mensagem: ${resultado.erro}` });
      return resultado;
    }),

  reenviar: procedimentoUnidade.input(z.object({ mensagemId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const resultado = await reenviarDm(ctx.db, input.mensagemId, ctx.unidadeId);
    if (!resultado.enviada) throw new TRPCError({ code: "BAD_REQUEST", message: `O Instagram não aceitou a mensagem: ${resultado.erro}` });
    return resultado;
  }),

  definirIa: procedimentoUnidade.input(conversaIdSchema.extend({ ativa: z.boolean() })).mutation(async ({ ctx, input }) => {
    await conversaDaUnidade(ctx.db, input.conversaId, ctx.unidadeId);
    await ctx.db.update(conversasInstagram).set({ iaAtiva: input.ativa }).where(eq(conversasInstagram.id, input.conversaId));
    return { ok: true };
  }),

  resolverHumano: procedimentoUnidade.input(conversaIdSchema).mutation(async ({ ctx, input }) => {
    await conversaDaUnidade(ctx.db, input.conversaId, ctx.unidadeId);
    await ctx.db.update(conversasInstagram).set({ precisaHumano: false, motivoHumano: null }).where(eq(conversasInstagram.id, input.conversaId));
    return { ok: true };
  }),

  // Pedido de exclusão de dados (LGPD): a conversa, as mensagens e os arquivos saem de vez. Só o admin.
  apagarDados: procedimentoAdmin.input(conversaIdSchema).mutation(async ({ ctx, input }) => {
    await conversaDaUnidade(ctx.db, input.conversaId, ctx.unidadeId);
    const resultado = await apagarDadosDoInstagram(ctx.db, input.conversaId);
    console.log(`[lgpd] ${ctx.usuario.nome} apagou a DM ${input.conversaId} na unidade ${ctx.unidadeId} (${resultado.mensagens} mensagens, ${resultado.arquivos} arquivos)`);
    return resultado;
  }),

  contarNaoLidas: procedimentoUnidade.query(async ({ ctx }) => {
    const [linha] = await ctx.db
      .select({ conversas: sql<number>`count(*) filter (where ${conversasInstagram.naoLidas} > 0)` })
      .from(conversasInstagram)
      .innerJoin(contasInstagram, eq(contasInstagram.id, conversasInstagram.contaId))
      .where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    return { conversas: Number(linha?.conversas ?? 0) };
  }),
});
