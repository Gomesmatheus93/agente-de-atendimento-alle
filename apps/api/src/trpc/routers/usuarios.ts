import { gerarHashDeSenha, sessoes, usuarios, type Db } from "@atendimento-academias/db";
import {
  atualizarUsuarioInputSchema,
  criarUsuarioInputSchema,
  redefinirSenhaInputSchema,
  usuarioIdInputSchema,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { procedimentoAdmin, router } from "../trpc.js";

// A unidade não pode ficar sem ninguém que administre: é a regra que protege rebaixar, desativar
// ou remover o último admin dela — inclusive você mesmo, por engano.
async function garantirQueSobraAdmin(db: Db, unidadeId: number, usuarioId: number): Promise<void> {
  const [linha] = await db
    .select({ total: count() })
    .from(usuarios)
    .where(and(eq(usuarios.unidadeId, unidadeId), eq(usuarios.papel, "admin"), eq(usuarios.ativo, true), ne(usuarios.id, usuarioId)));

  if ((linha?.total ?? 0) === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Este é o único administrador ativo da unidade. Promova outra pessoa antes de mudar este acesso.",
    });
  }
}

// Só pessoas da unidade em que se está trabalhando: um admin não mexe na equipe de outra unidade.
async function usuarioDaUnidade(db: Db, unidadeId: number, id: number) {
  const [usuario] = await db.select().from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.unidadeId, unidadeId)));
  if (!usuario) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
  return usuario;
}

export const usuariosRouter = router({
  listar: procedimentoAdmin.query(async ({ ctx }) => {
    const linhas = await ctx.db
      .select({
        id: usuarios.id,
        nome: usuarios.nome,
        email: usuarios.email,
        papel: usuarios.papel,
        ativo: usuarios.ativo,
        criadoEm: usuarios.createdAt,
      })
      .from(usuarios)
      .where(eq(usuarios.unidadeId, ctx.unidadeId))
      .orderBy(asc(usuarios.nome));

    return linhas.map((linha) => ({
      ...linha,
      criadoEm: linha.criadoEm.toISOString(),
      // A tela usa isso para não deixar você se desativar ou se rebaixar sem querer.
      souEu: linha.id === ctx.usuario.id,
    }));
  }),

  criar: procedimentoAdmin.input(criarUsuarioInputSchema).mutation(async ({ ctx, input }) => {
    const [existente] = await ctx.db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, input.email));
    if (existente) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Já existe um usuário com esse e-mail." });
    }

    const [{ id }] = await ctx.db
      .insert(usuarios)
      .values({
        nome: input.nome,
        email: input.email,
        papel: input.papel,
        unidadeId: ctx.unidadeId,
        senhaHash: await gerarHashDeSenha(input.senha),
      })
      .returning({ id: usuarios.id });

    return { id, nome: input.nome, email: input.email, papel: input.papel };
  }),

  atualizar: procedimentoAdmin.input(atualizarUsuarioInputSchema).mutation(async ({ ctx, input }) => {
    const usuario = await usuarioDaUnidade(ctx.db, ctx.unidadeId, input.id);

    const perdeAdmin = usuario.papel === "admin" && (input.papel === "membro" || input.ativo === false);
    if (perdeAdmin) await garantirQueSobraAdmin(ctx.db, ctx.unidadeId, usuario.id);

    await ctx.db
      .update(usuarios)
      .set({
        ...(input.nome !== undefined ? { nome: input.nome } : {}),
        ...(input.papel !== undefined ? { papel: input.papel } : {}),
        ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
      })
      .where(eq(usuarios.id, input.id));

    // Quem foi desativado perde o acesso na hora, sem esperar a sessão vencer.
    if (input.ativo === false) await ctx.db.delete(sessoes).where(eq(sessoes.usuarioId, input.id));

    return { id: input.id };
  }),

  redefinirSenha: procedimentoAdmin.input(redefinirSenhaInputSchema).mutation(async ({ ctx, input }) => {
    await usuarioDaUnidade(ctx.db, ctx.unidadeId, input.id);

    await ctx.db
      .update(usuarios)
      .set({ senhaHash: await gerarHashDeSenha(input.senha) })
      .where(eq(usuarios.id, input.id));

    // Trocar a senha derruba as sessões abertas dessa pessoa, em qualquer computador.
    await ctx.db.delete(sessoes).where(eq(sessoes.usuarioId, input.id));
    return { id: input.id };
  }),

  remover: procedimentoAdmin.input(usuarioIdInputSchema).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.usuario.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode remover o próprio acesso." });
    }

    const usuario = await usuarioDaUnidade(ctx.db, ctx.unidadeId, input.id);
    if (usuario.papel === "admin") await garantirQueSobraAdmin(ctx.db, ctx.unidadeId, usuario.id);

    await ctx.db.delete(usuarios).where(eq(usuarios.id, input.id));
    return { id: input.id };
  }),
});
