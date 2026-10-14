import { descadastrar, descadastros, recadastrar, situacaoDeDescadastro } from "@atendimento-academias/db";
import { detalheConversaInputSchema } from "@atendimento-academias/shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { garantirNumeroDaUnidade } from "../../servicos/conversas.js";
import { procedimentoUnidade, router } from "../trpc.js";

// Lista de "não quero receber campanhas" da unidade (opt-out).
export const descadastrosRouter = router({
  situacao: procedimentoUnidade.input(detalheConversaInputSchema).query(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const linha = await situacaoDeDescadastro(ctx.db, ctx.unidadeId, input.telefone);
    return linha
      ? { bloqueado: true as const, origem: linha.origem, motivo: linha.motivo, desde: linha.criadoEm.toISOString() }
      : { bloqueado: false as const };
  }),

  // A equipe bloqueia (cliente pediu por outro canal) ou libera (cliente pediu para voltar).
  definir: procedimentoUnidade.input(detalheConversaInputSchema.extend({ bloqueado: z.boolean() })).mutation(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    if (input.bloqueado) await descadastrar(ctx.db, ctx.unidadeId, input.telefone, "equipe", `Bloqueado por ${ctx.usuario.nome}`);
    else await recadastrar(ctx.db, ctx.unidadeId, input.telefone);
    return { bloqueado: input.bloqueado };
  }),

  listar: procedimentoUnidade.query(async ({ ctx }) =>
    (await ctx.db.select().from(descadastros).where(eq(descadastros.unidadeId, ctx.unidadeId)).orderBy(desc(descadastros.criadoEm)).limit(1000)).map(
      (linha) => ({ telefone: linha.telefone, origem: linha.origem, motivo: linha.motivo, desde: linha.criadoEm.toISOString() }),
    ),
  ),
});
