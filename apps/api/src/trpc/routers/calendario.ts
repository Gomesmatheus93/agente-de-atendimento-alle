import { campanhasDisparo, templatesWhatsapp } from "@atendimento-academias/db";
import { calendarioInputSchema } from "@atendimento-academias/shared";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { carregarProgresso, progressoVazio } from "../progresso.js";
import { procedimentoUnidade, router } from "../trpc.js";

export const calendarioRouter = router({
  // Campanhas cujo disparo cai no intervalo: as já disparadas (data em que começaram) e as agendadas (data prevista).
  periodo: procedimentoUnidade.input(calendarioInputSchema).query(async ({ ctx, input }) => {
    const campanhas = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        status: campanhasDisparo.status,
        quando: campanhasDisparo.disparoEm,
        templateNome: templatesWhatsapp.nome,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(
        and(
          eq(campanhasDisparo.unidadeId, ctx.unidadeId),
          gte(campanhasDisparo.disparoEm, new Date(input.inicio)),
          lt(campanhasDisparo.disparoEm, new Date(input.fim)),
        ),
      )
      .orderBy(asc(campanhasDisparo.disparoEm), asc(campanhasDisparo.id));

    const progressoPorCampanha = await carregarProgresso(
      ctx.db,
      campanhas.map((campanha) => campanha.id),
    );

    return campanhas.map((campanha) => ({
      ...campanha,
      quando: campanha.quando.toISOString(),
      progresso: progressoPorCampanha.get(campanha.id) ?? progressoVazio(),
    }));
  }),
});
