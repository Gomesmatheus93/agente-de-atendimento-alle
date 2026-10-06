import { campanhasDisparo, disparoDestinatarios, templatesWhatsapp } from "@atendimento-academias/db";
import {
  calcularCusto,
  criarCampanhaInputSchema,
  detalheCampanhaInputSchema,
  listarCampanhasInputSchema,
  moverEtapaInputSchema,
  preencherTemplate,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { carregarProgresso, carregarRespondentes, precoUnitarioDe, progressoVazio, taxa } from "../progresso.js";
import { criarCampanha } from "../../servicos/campanhas.js";
import { procedimentoUnidade, router } from "../trpc.js";

// Custo é sobre as mensagens enviadas; a taxa de retorno é a fatia dessas mensagens que gerou resposta.
function resumoRetornoECusto(enviados: number, respostas: number, custoUnitario: string | null) {
  const precoUnitario = precoUnitarioDe(custoUnitario);
  return {
    respostas,
    taxaRetorno: taxa(respostas, enviados),
    custo: precoUnitario === null ? null : calcularCusto(enviados, precoUnitario),
  };
}

export const campanhasRouter = router({
  // A regra de negócio mora em servicos/campanhas.ts: é a mesma usada pela API de integração (n8n),
  // então uma campanha criada pela tela e uma criada por automação passam pelo mesmo caminho.
  criar: procedimentoUnidade.input(criarCampanhaInputSchema).mutation(async ({ ctx, input }) => criarCampanha(ctx.db, input, ctx.unidadeId)),

  listar: procedimentoUnidade.input(listarCampanhasInputSchema).query(async ({ ctx, input }) => {
    const campanhas = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        status: campanhasDisparo.status,
        createdAt: campanhasDisparo.createdAt,
        disparoEm: campanhasDisparo.disparoEm,
        custoUnitario: campanhasDisparo.custoUnitario,
        etapaManual: campanhasDisparo.etapaManual,
        templateNome: templatesWhatsapp.nome,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(eq(campanhasDisparo.unidadeId, ctx.unidadeId))
      .orderBy(desc(campanhasDisparo.id))
      .limit(input.limite);

    const ids = campanhas.map((campanha) => campanha.id);
    const [progressoPorCampanha, respondentesPorCampanha] = await Promise.all([
      carregarProgresso(ctx.db, ids),
      carregarRespondentes(ctx.db, ids),
    ]);

    return campanhas.map(({ custoUnitario, ...campanha }) => {
      const progresso = progressoPorCampanha.get(campanha.id) ?? progressoVazio();
      return {
        ...campanha,
        progresso,
        ...resumoRetornoECusto(progresso.enviado, respondentesPorCampanha.get(campanha.id) ?? 0, custoUnitario),
      };
    });
  }),

  // Só vale para campanha que ainda não disparou: apaga a campanha e os destinatários, que nunca receberam nada.
  cancelarAgendamento: procedimentoUnidade.input(detalheCampanhaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.transaction(async (tx) => {
      // Trava a linha: se o worker estiver iniciando essa campanha agora, um dos dois espera o outro.
      const [campanha] = await tx
        .select({ status: campanhasDisparo.status })
        .from(campanhasDisparo)
        .where(and(eq(campanhasDisparo.id, input.id), eq(campanhasDisparo.unidadeId, ctx.unidadeId)))
        .for("update");

      if (!campanha) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada" });
      }
      if (campanha.status !== "agendada") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Essa campanha já começou a ser disparada e não pode mais ser cancelada.",
        });
      }

      await tx.delete(disparoDestinatarios).where(eq(disparoDestinatarios.campanhaId, input.id));
      await tx.delete(campanhasDisparo).where(eq(campanhasDisparo.id, input.id));
    });

    return { id: input.id };
  }),

  // Só muda onde o card aparece no kanban; não interfere no envio, que segue com o worker.
  moverEtapa: procedimentoUnidade.input(moverEtapaInputSchema).mutation(async ({ ctx, input }) => {
    const [campanha] = await ctx.db
      .select({ id: campanhasDisparo.id })
      .from(campanhasDisparo)
      .where(and(eq(campanhasDisparo.id, input.id), eq(campanhasDisparo.unidadeId, ctx.unidadeId)));

    if (!campanha) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada" });
    }

    await ctx.db.update(campanhasDisparo).set({ etapaManual: input.etapa }).where(eq(campanhasDisparo.id, input.id));

    return { id: input.id, etapa: input.etapa };
  }),

  detalhe: procedimentoUnidade.input(detalheCampanhaInputSchema).query(async ({ ctx, input }) => {
    const [campanha] = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        status: campanhasDisparo.status,
        createdAt: campanhasDisparo.createdAt,
        disparoEm: campanhasDisparo.disparoEm,
        custoUnitario: campanhasDisparo.custoUnitario,
        templateNome: templatesWhatsapp.nome,
        templateConteudo: templatesWhatsapp.conteudo,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(and(eq(campanhasDisparo.id, input.id), eq(campanhasDisparo.unidadeId, ctx.unidadeId)));

    if (!campanha) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada" });
    }

    const destinatarios = await ctx.db
      .select({
        id: disparoDestinatarios.id,
        telefone: disparoDestinatarios.telefone,
        statusEnvio: disparoDestinatarios.statusEnvio,
        erroDetalhe: disparoDestinatarios.erroDetalhe,
        enviadoEm: disparoDestinatarios.enviadoEm,
        parametros: disparoDestinatarios.parametros,
      })
      .from(disparoDestinatarios)
      .where(eq(disparoDestinatarios.campanhaId, input.id))
      .orderBy(asc(disparoDestinatarios.id));

    const progresso = progressoVazio();
    for (const destinatario of destinatarios) {
      progresso[destinatario.statusEnvio] += 1;
      progresso.total += 1;
    }

    const { templateConteudo, custoUnitario, ...dadosCampanha } = campanha;
    const respondentes = (await carregarRespondentes(ctx.db, [input.id])).get(input.id) ?? 0;

    return {
      ...dadosCampanha,
      ...resumoRetornoECusto(progresso.enviado, respondentes, custoUnitario),
      // Todos os destinatários de uma campanha compartilham os mesmos parâmetros.
      mensagem: preencherTemplate(templateConteudo, destinatarios[0]?.parametros ?? {}),
      progresso,
      destinatarios: destinatarios.map(({ parametros: _parametros, ...destinatario }) => destinatario),
    };
  }),
});
