import { gerarHashDeSenha, numerosWhatsapp, sessoes, unidades, usuarios } from "@atendimento-academias/db";
import { atualizarUnidadeInputSchema, criarUnidadeInputSchema, entrarNaUnidadeInputSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { asc, count, eq, inArray } from "drizzle-orm";
import { tokenDaSessao } from "../context.js";
import { procedimentoSuperadmin, router } from "../trpc.js";

// Tela Unidades: só o superadmin. Cada unidade nasce com o dono (admin), que cadastra o número e a equipe.
export const unidadesRouter = router({
  listar: procedimentoSuperadmin.query(async ({ ctx }) => {
    const [lista, equipes, numeros] = await Promise.all([
      ctx.db.select().from(unidades).orderBy(asc(unidades.nome)),
      ctx.db.select({ unidadeId: usuarios.unidadeId, total: count() }).from(usuarios).groupBy(usuarios.unidadeId),
      ctx.db
        .select({ unidadeId: numerosWhatsapp.unidadeId, exibicao: numerosWhatsapp.numeroExibicao })
        .from(numerosWhatsapp)
        .where(eq(numerosWhatsapp.ativo, true)),
    ]);
    const usuariosPorUnidade = new Map(equipes.map((linha) => [linha.unidadeId, linha.total]));

    return lista.map((unidade) => ({
      id: unidade.id,
      nome: unidade.nome,
      ativo: unidade.ativo,
      usuarios: usuariosPorUnidade.get(unidade.id) ?? 0,
      numeros: numeros.filter((numero) => numero.unidadeId === unidade.id).map((numero) => numero.exibicao),
      atual: unidade.id === ctx.usuario.unidadeId,
    }));
  }),

  criar: procedimentoSuperadmin.input(criarUnidadeInputSchema).mutation(async ({ ctx, input }) => {
    const [existente] = await ctx.db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, input.admin.email));
    if (existente) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Já existe um usuário com o e-mail do responsável." });
    }

    const senhaHash = await gerarHashDeSenha(input.admin.senha);
    const id = await ctx.db.transaction(async (tx) => {
      const [{ id }] = await tx.insert(unidades).values({ nome: input.nome }).returning({ id: unidades.id });
      await tx.insert(usuarios).values({ nome: input.admin.nome, email: input.admin.email, senhaHash, papel: "admin", unidadeId: id });
      return id;
    });
    return { id };
  }),

  atualizar: procedimentoSuperadmin.input(atualizarUnidadeInputSchema).mutation(async ({ ctx, input }) => {
    const [unidade] = await ctx.db.select().from(unidades).where(eq(unidades.id, input.id));
    if (!unidade) throw new TRPCError({ code: "NOT_FOUND", message: "Unidade não encontrada" });

    await ctx.db
      .update(unidades)
      .set({ ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.ativo !== undefined ? { ativo: input.ativo } : {}) })
      .where(eq(unidades.id, input.id));

    if (input.ativo === false) {
      // Desativar: a equipe perde o acesso na hora, e as mensagens dos números dela passam a ser ignoradas
      // pelo webhook. Reativar devolve tudo como estava.
      await ctx.db
        .delete(sessoes)
        .where(inArray(sessoes.usuarioId, ctx.db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.unidadeId, input.id))));
    }
    return { id: input.id };
  }),

  // Escolhe em qual unidade o superadmin está trabalhando nesta sessão: o painel inteiro passa a mostrar
  // só os dados dela.
  entrar: procedimentoSuperadmin.input(entrarNaUnidadeInputSchema).mutation(async ({ ctx, input }) => {
    if (input.id !== null) {
      const [unidade] = await ctx.db.select().from(unidades).where(eq(unidades.id, input.id));
      if (!unidade) throw new TRPCError({ code: "NOT_FOUND", message: "Unidade não encontrada" });
    }
    const token = tokenDaSessao(ctx.req.headers.cookie);
    if (token) await ctx.db.update(sessoes).set({ unidadeId: input.id }).where(eq(sessoes.token, token));
    return { id: input.id };
  }),
});
