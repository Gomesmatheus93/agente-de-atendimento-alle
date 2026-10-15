import { detalheConversaInputSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lerValor } from "../../config/plataforma.js";
import { CHAVE_EVO_CHAVE_FINAL, configEvo, ErroEvo, salvarConfigEvo, testarEvo } from "../../evo/cliente.js";
import { cadastrarNoEvo, dadosDeCadastroSchema, situacaoParaIa } from "../../evo/integracao.js";
import { garantirNumeroDaUnidade } from "../../servicos/conversas.js";
import { procedimentoPlataforma, procedimentoUnidade, router } from "../trpc.js";

function erroDoEvo(erro: unknown): TRPCError {
  if (erro instanceof ErroEvo) return new TRPCError({ code: erro.status === 412 ? "PRECONDITION_FAILED" : "BAD_REQUEST", message: erro.message });
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao falar com o EVO", cause: erro });
}

// EVO (W12) da unidade: configuração (Configurações) e consulta/cadastro do cliente (Conversas).
export const evoRouter = router({
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const config = await configEvo(ctx.db, ctx.unidadeId);
    return {
      configurado: config !== null,
      dns: config?.dns ?? null,
      idBranch: config?.idBranch ?? null,
      // A chave nunca volta para a tela: só os últimos dígitos.
      chaveFinal: config ? await lerValor(ctx.db, ctx.unidadeId, CHAVE_EVO_CHAVE_FINAL) : null,
    };
  }),

  // Testa antes de salvar: DNS ou chave errados não chegam a ser gravados.
  salvar: procedimentoPlataforma
    .input(
      z.object({
        dns: z.string().trim().min(2, "Informe o DNS da academia no EVO").max(100),
        chave: z.string().trim().max(200).optional(),
        idBranch: z.number().int().positive().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const atual = await configEvo(ctx.db, ctx.unidadeId);
      const chave = input.chave || atual?.chave;
      if (!chave) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a chave da API do EVO." });
      try {
        await testarEvo({ dns: input.dns, chave, idBranch: input.idBranch });
      } catch (erro) {
        throw erroDoEvo(erro);
      }
      await salvarConfigEvo(ctx.db, ctx.unidadeId, { dns: input.dns, chave: input.chave || undefined, idBranch: input.idBranch });
      return { ok: true };
    }),

  cliente: procedimentoUnidade.input(detalheConversaInputSchema).query(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    return situacaoParaIa(ctx.db, ctx.unidadeId, input.telefone);
  }),

  cadastrar: procedimentoUnidade.input(detalheConversaInputSchema.merge(dadosDeCadastroSchema)).mutation(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const { telefone, numeroId: _numeroId, ...dados } = input;
    try {
      return await cadastrarNoEvo(ctx.db, ctx.unidadeId, telefone, dados);
    } catch (erro) {
      throw erroDoEvo(erro);
    }
  }),
});
