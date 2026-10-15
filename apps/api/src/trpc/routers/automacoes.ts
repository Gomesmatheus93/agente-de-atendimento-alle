import { contatosUnidade, numerosWhatsapp, templatesWhatsapp } from "@atendimento-academias/db";
import { configAniversarioSchema, configFollowupSchema, extrairPlaceholders } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { aniversariantesDeHoje, CHAVE_ANIVERSARIO, CHAVE_FOLLOWUP, lerConfigAniversario, lerConfigFollowup } from "../../automacoes/automacoes.js";
import { salvarValor } from "../../config/plataforma.js";
import { procedimentoAdmin, router } from "../trpc.js";

// Tela Automações (admin): mensagem de aniversário e follow-up de quem parou de responder.
export const automacoesRouter = router({
  estado: procedimentoAdmin.query(async ({ ctx }) => {
    const [aniversario, followup, templates, numeros, [comNascimento], hoje] = await Promise.all([
      lerConfigAniversario(ctx.db, ctx.unidadeId),
      lerConfigFollowup(ctx.db, ctx.unidadeId),
      ctx.db
        .select({ id: templatesWhatsapp.id, nome: templatesWhatsapp.nome, conteudo: templatesWhatsapp.conteudo, contaId: templatesWhatsapp.contaId })
        .from(templatesWhatsapp)
        .where(and(eq(templatesWhatsapp.unidadeId, ctx.unidadeId), eq(templatesWhatsapp.ativo, true), eq(templatesWhatsapp.status, "APPROVED")))
        .orderBy(asc(templatesWhatsapp.nome)),
      ctx.db
        .select({ id: numerosWhatsapp.id, numeroExibicao: numerosWhatsapp.numeroExibicao, contaId: numerosWhatsapp.contaId })
        .from(numerosWhatsapp)
        .where(and(eq(numerosWhatsapp.unidadeId, ctx.unidadeId), eq(numerosWhatsapp.ativo, true))),
      ctx.db.select({ total: count() }).from(contatosUnidade).where(and(eq(contatosUnidade.unidadeId, ctx.unidadeId), isNotNull(contatosUnidade.nascimento))),
      aniversariantesDeHoje(ctx.db, ctx.unidadeId),
    ]);
    return {
      aniversario,
      followup,
      templates: templates.map((t) => ({ ...t, placeholders: extrairPlaceholders(t.conteudo) })),
      numeros,
      contatosComNascimento: Number(comNascimento?.total ?? 0),
      aniversariantesHoje: hoje.length,
    };
  }),

  salvarAniversario: procedimentoAdmin.input(configAniversarioSchema).mutation(async ({ ctx, input }) => {
    if (input.ativo) {
      if (!input.templateId || !input.numeroId) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha o template e o número." });
      const [template] = await ctx.db
        .select()
        .from(templatesWhatsapp)
        .where(and(eq(templatesWhatsapp.id, input.templateId), eq(templatesWhatsapp.unidadeId, ctx.unidadeId), eq(templatesWhatsapp.ativo, true)));
      if (!template || template.status !== "APPROVED") throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um template aprovado desta unidade." });
      const [numero] = await ctx.db
        .select()
        .from(numerosWhatsapp)
        .where(and(eq(numerosWhatsapp.id, input.numeroId), eq(numerosWhatsapp.unidadeId, ctx.unidadeId), eq(numerosWhatsapp.ativo, true)));
      if (!numero) throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um número ativo desta unidade." });
      if (template.contaId && template.contaId !== numero.contaId) throw new TRPCError({ code: "BAD_REQUEST", message: "O template não é da conta desse número." });
      const faltando = extrairPlaceholders(template.conteudo).filter((p) => !input.parametros[p]);
      if (faltando.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Preencha o que vai em: ${faltando.join(", ")}.` });
    }
    await salvarValor(ctx.db, ctx.unidadeId, CHAVE_ANIVERSARIO, JSON.stringify(input));
    return { ok: true };
  }),

  salvarFollowup: procedimentoAdmin.input(configFollowupSchema).mutation(async ({ ctx, input }) => {
    await salvarValor(ctx.db, ctx.unidadeId, CHAVE_FOLLOWUP, JSON.stringify(input));
    return { ok: true };
  }),
});
