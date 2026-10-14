import { conversaExcluidaEm, notasConversa, respostasRapidas } from "@atendimento-academias/db";
import { criarNotaInputSchema, detalheConversaInputSchema, salvarRespostaRapidaInputSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { garantirNumeroDaUnidade } from "../../servicos/conversas.js";
import { procedimentoUnidade, router } from "../trpc.js";

// Respostas rápidas da unidade (textos prontos chamados com "/" no chat).
export const respostasRapidasRouter = router({
  listar: procedimentoUnidade.query(({ ctx }) =>
    ctx.db
      .select({ id: respostasRapidas.id, atalho: respostasRapidas.atalho, texto: respostasRapidas.texto })
      .from(respostasRapidas)
      .where(eq(respostasRapidas.unidadeId, ctx.unidadeId))
      .orderBy(asc(respostasRapidas.atalho)),
  ),

  salvar: procedimentoUnidade.input(salvarRespostaRapidaInputSchema).mutation(async ({ ctx, input }) => {
    const [repetida] = await ctx.db
      .select({ id: respostasRapidas.id })
      .from(respostasRapidas)
      .where(and(eq(respostasRapidas.unidadeId, ctx.unidadeId), eq(respostasRapidas.atalho, input.atalho)));
    if (repetida && repetida.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: `Já existe uma resposta com o atalho /${input.atalho}.` });
    if (input.id) {
      const [alterada] = await ctx.db
        .update(respostasRapidas)
        .set({ atalho: input.atalho, texto: input.texto })
        .where(and(eq(respostasRapidas.id, input.id), eq(respostasRapidas.unidadeId, ctx.unidadeId)))
        .returning({ id: respostasRapidas.id });
      if (!alterada) throw new TRPCError({ code: "NOT_FOUND", message: "Resposta rápida não encontrada." });
      return alterada;
    }
    const [criada] = await ctx.db
      .insert(respostasRapidas)
      .values({ unidadeId: ctx.unidadeId, atalho: input.atalho, texto: input.texto })
      .returning({ id: respostasRapidas.id });
    return criada!;
  }),

  excluir: procedimentoUnidade.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(respostasRapidas).where(and(eq(respostasRapidas.id, input.id), eq(respostasRapidas.unidadeId, ctx.unidadeId)));
    return { ok: true };
  }),
});

// Notas internas: só a equipe vê. Excluir a conversa esconde as notas de antes, como as mensagens.
export const notasRouter = router({
  listar: procedimentoUnidade.input(detalheConversaInputSchema).query(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const excluidaEm = await conversaExcluidaEm(ctx.db, input.telefone, input.numeroId);
    const linhas = await ctx.db
      .select()
      .from(notasConversa)
      .where(
        and(
          eq(notasConversa.numeroId, input.numeroId),
          eq(notasConversa.telefone, input.telefone),
          excluidaEm ? gt(notasConversa.createdAt, excluidaEm) : undefined,
        ),
      )
      .orderBy(asc(notasConversa.createdAt))
      .limit(500);
    const podeApagarTudo = ctx.usuario.papel === "admin" || ctx.usuario.papel === "superadmin";
    return linhas.map((nota) => ({
      id: nota.id,
      autorNome: nota.autorNome,
      texto: nota.texto,
      em: nota.createdAt.toISOString(),
      podeExcluir: podeApagarTudo || nota.autorId === ctx.usuario.id,
    }));
  }),

  criar: procedimentoUnidade.input(criarNotaInputSchema).mutation(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const [nota] = await ctx.db
      .insert(notasConversa)
      .values({
        numeroId: input.numeroId,
        telefone: input.telefone,
        autorId: ctx.usuario.id,
        autorNome: ctx.usuario.assinatura?.trim() || ctx.usuario.nome,
        texto: input.texto,
      })
      .returning({ id: notasConversa.id });
    return nota!;
  }),

  excluir: procedimentoUnidade.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const [nota] = await ctx.db.select().from(notasConversa).where(eq(notasConversa.id, input.id));
    if (!nota) throw new TRPCError({ code: "NOT_FOUND", message: "Nota não encontrada." });
    await garantirNumeroDaUnidade(ctx.db, nota.numeroId, ctx.unidadeId);
    const admin = ctx.usuario.papel === "admin" || ctx.usuario.papel === "superadmin";
    if (!admin && nota.autorId !== ctx.usuario.id) throw new TRPCError({ code: "FORBIDDEN", message: "Só quem escreveu (ou o administrador) pode apagar a nota." });
    await ctx.db.delete(notasConversa).where(eq(notasConversa.id, input.id));
    return { ok: true };
  }),
});
