import { campanhasDisparo, templatesWhatsapp } from "@atendimento-academias/db";
import { calcularCusto, resumoDashboardInputSchema } from "@atendimento-academias/shared";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { chaveDia, DIA_MS, diasAtras } from "../periodo.js";
import { carregarProgresso, carregarRespondentes, precoUnitarioDe, progressoVazio, taxa } from "../progresso.js";
import { procedimentoAutenticado, router } from "../trpc.js";

const MAX_CAMPANHAS_NA_TABELA = 50;
// Janela usada para estimar a taxa de resposta esperada de uma campanha nova.
const JANELA_HISTORICO_DIAS = 90;
const MAX_CAMPANHAS_NO_HISTORICO = 200;

interface Acumulado {
  enviados: number;
  respostas: number;
  custo: number;
}

function acumuladoVazio(): Acumulado {
  return { enviados: 0, respostas: 0, custo: 0 };
}

function somar(alvo: Acumulado, enviados: number, respostas: number, custo: number) {
  alvo.enviados += enviados;
  alvo.respostas += respostas;
  alvo.custo += custo;
}

function indicadores({ enviados, respostas, custo }: Acumulado) {
  return {
    enviados,
    respostas,
    taxaRetorno: taxa(respostas, enviados),
    custo: calcularCusto(1, custo),
    custoPorResposta: respostas > 0 ? calcularCusto(1, custo / respostas) : null,
  };
}

// Mais alta primeiro; campanhas sem envio (taxa nula) vão para o fim.
function porTaxaDesc<T extends { taxaRetorno: number | null; enviados: number }>(a: T, b: T): number {
  return (b.taxaRetorno ?? -1) - (a.taxaRetorno ?? -1) || b.enviados - a.enviados;
}

export const relatoriosRouter = router({
  performance: procedimentoAutenticado.input(resumoDashboardInputSchema).query(async ({ ctx, input }) => {
    const { dias } = input;
    const agora = Date.now();

    const diasAtual = diasAtras(agora, dias - 1, 0);
    const conjuntoAtual = new Set(diasAtual);
    const conjuntoAnterior = new Set(diasAtras(agora, 2 * dias - 1, dias));

    const campanhas = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        createdAt: campanhasDisparo.disparoEm,
        custoUnitario: campanhasDisparo.custoUnitario,
        templateId: campanhasDisparo.templateId,
        templateNome: templatesWhatsapp.nome,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(and(ne(campanhasDisparo.status, "agendada"), gte(campanhasDisparo.disparoEm, new Date(agora - (2 * dias + 1) * DIA_MS))))
      .orderBy(desc(campanhasDisparo.disparoEm), desc(campanhasDisparo.id));

    const ids = campanhas.map((campanha) => campanha.id);
    const [progressoPorCampanha, respondentesPorCampanha] = await Promise.all([
      carregarProgresso(ctx.db, ids),
      carregarRespondentes(ctx.db, ids),
    ]);

    const atual = acumuladoVazio();
    const anterior = acumuladoVazio();
    const porCampanha: Array<ReturnType<typeof indicadores> & { id: number; nome: string; templateNome: string; createdAt: Date }> = [];
    const porTemplate = new Map<number, Acumulado & { nome: string }>();
    const porDia = new Map<string, Acumulado>(diasAtual.map((dia) => [dia, acumuladoVazio()]));

    for (const campanha of campanhas) {
      const dia = chaveDia(campanha.createdAt);
      const emAtual = conjuntoAtual.has(dia);
      if (!emAtual && !conjuntoAnterior.has(dia)) continue;

      const enviados = (progressoPorCampanha.get(campanha.id) ?? progressoVazio()).enviado;
      const respostas = respondentesPorCampanha.get(campanha.id) ?? 0;
      const preco = precoUnitarioDe(campanha.custoUnitario);
      const custo = preco === null ? 0 : calcularCusto(enviados, preco);

      if (!emAtual) {
        somar(anterior, enviados, respostas, custo);
        continue;
      }

      somar(atual, enviados, respostas, custo);
      somar(porDia.get(dia)!, enviados, respostas, custo);
      porCampanha.push({
        id: campanha.id,
        nome: campanha.nome,
        templateNome: campanha.templateNome,
        createdAt: campanha.createdAt,
        ...indicadores({ enviados, respostas, custo }),
      });

      const doTemplate = porTemplate.get(campanha.templateId) ?? { ...acumuladoVazio(), nome: campanha.templateNome };
      somar(doTemplate, enviados, respostas, custo);
      porTemplate.set(campanha.templateId, doTemplate);
    }

    return {
      dias,
      atual: indicadores(atual),
      anterior: indicadores(anterior),
      // Cada ponto agrupa as campanhas criadas naquele dia (a resposta conta no dia do disparo, não no da resposta).
      serie: diasAtual.map((dia) => ({ dia, ...indicadores(porDia.get(dia)!) })),
      porTemplate: [...porTemplate.values()].map(({ nome, ...acumulado }) => ({ nome, ...indicadores(acumulado) })).sort(porTaxaDesc),
      porCampanha: porCampanha.sort(porTaxaDesc).slice(0, MAX_CAMPANHAS_NA_TABELA),
    };
  }),

  // Taxa de resposta média das campanhas recentes, usada para estimar o retorno de uma campanha nova.
  taxaRespostaMedia: procedimentoAutenticado.query(async ({ ctx }) => {
    const campanhas = await ctx.db
      .select({ id: campanhasDisparo.id })
      .from(campanhasDisparo)
      .where(and(ne(campanhasDisparo.status, "agendada"), gte(campanhasDisparo.disparoEm, new Date(Date.now() - JANELA_HISTORICO_DIAS * DIA_MS))))
      .orderBy(desc(campanhasDisparo.id))
      .limit(MAX_CAMPANHAS_NO_HISTORICO);

    const ids = campanhas.map((campanha) => campanha.id);
    const [progressoPorCampanha, respondentesPorCampanha] = await Promise.all([
      carregarProgresso(ctx.db, ids),
      carregarRespondentes(ctx.db, ids),
    ]);

    const total = acumuladoVazio();
    for (const id of ids) {
      somar(total, progressoPorCampanha.get(id)?.enviado ?? 0, respondentesPorCampanha.get(id) ?? 0, 0);
    }

    return { taxa: taxa(total.respostas, total.enviados), enviados: total.enviados, campanhas: ids.length };
  }),
});
