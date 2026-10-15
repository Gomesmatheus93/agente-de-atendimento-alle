import {
  campanhasDisparo,
  funilClientes,
  lancamentosFinanceiros,
  numerosWhatsapp,
  sugestoesIa,
  templatesWhatsapp,
  usoIa,
} from "@atendimento-academias/db";
import {
  configFinanceiroSchema,
  custoIaUsd,
  resumoVisaoInputSchema,
  ROTULO_CATEGORIA,
  salvarLancamentoInputSchema,
  type CategoriaTemplate,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, min, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { configuracaoDoAgente } from "../../config/plataforma.js";
import { lerConfigFinanceiro, salvarConfigFinanceiro } from "../../financeiro/config.js";
import { chaveDia, inicioDoDia, somarDias } from "../periodo.js";
import { carregarProgresso, carregarRespondentes, progressoVazio } from "../progresso.js";
import { procedimentoAdmin, router } from "../trpc.js";
import { MAX_DIAS_POR_DIA, resolverPeriodo } from "./dashboard.js";

// Tela Financeiro: tudo o que a unidade gasta (mensagens de template, IA da plataforma, gastos lançados à
// mão) e o que volta (matrículas, receita estimada). Só o admin vê dinheiro.

type Fonte = "whatsapp" | "ia" | "manual";
const centavos = (valor: number) => Math.round(valor * 100) / 100;
const diaSp = (coluna: unknown) => sql<string>`to_char(${coluna} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;

// Lançamentos recorrentes repetem todo mês no mesmo dia (no último dia, nos meses mais curtos).
function ocorrencias(lancamento: { data: string; recorrente: boolean }, de: string, ate: string): string[] {
  if (!lancamento.recorrente) return lancamento.data >= de && lancamento.data <= ate ? [lancamento.data] : [];
  const [ano, mes, dia] = lancamento.data.split("-").map(Number) as [number, number, number];
  const dias: string[] = [];
  for (let i = 0; i < 600; i++) {
    const ultimo = new Date(Date.UTC(ano, mes - 1 + i + 1, 0)).getUTCDate();
    const data = new Date(Date.UTC(ano, mes - 1 + i, Math.min(dia, ultimo), 12)).toISOString().slice(0, 10);
    if (data > ate) break;
    if (data >= de) dias.push(data);
  }
  return dias;
}

export const financeiroRouter = router({
  resumo: procedimentoAdmin.input(resumoVisaoInputSchema).query(async ({ ctx, input }) => {
    const u = ctx.unidadeId;
    const hoje = chaveDia(new Date());
    const [primeira] =
      input.periodo === "tudo"
        ? await ctx.db
            .select({ em: min(campanhasDisparo.disparoEm) })
            .from(campanhasDisparo)
            .where(and(eq(campanhasDisparo.unidadeId, u), ne(campanhasDisparo.status, "agendada")))
        : [{ em: null }];
    const periodo = resolverPeriodo(input, hoje, primeira?.em ? chaveDia(new Date(primeira.em)) : null);
    const inicioAnterior = periodo.anterior[0] ?? periodo.inicio;
    const desde = inicioDoDia(inicioAnterior);
    const ate = inicioDoDia(somarDias(periodo.fim, 1));
    const porMes = periodo.atual.length > MAX_DIAS_POR_DIA;
    const ponto = (dia: string) => (porMes ? dia.slice(0, 7) : dia);
    const noAtual = (dia: string) => dia >= periodo.inicio;

    const [config, agente, campanhas, agendadas, sugestoes, analises, lancamentos, matriculas] = await Promise.all([
      lerConfigFinanceiro(ctx.db, u),
      configuracaoDoAgente(ctx.db, u),
      ctx.db
        .select({
          id: campanhasDisparo.id,
          nome: campanhasDisparo.nome,
          disparoEm: campanhasDisparo.disparoEm,
          custoUnitario: campanhasDisparo.custoUnitario,
          categoria: templatesWhatsapp.categoria,
        })
        .from(campanhasDisparo)
        .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
        .where(and(eq(campanhasDisparo.unidadeId, u), ne(campanhasDisparo.status, "agendada"), gte(campanhasDisparo.disparoEm, desde), lt(campanhasDisparo.disparoEm, ate))),
      ctx.db
        .select({ id: campanhasDisparo.id, custoUnitario: campanhasDisparo.custoUnitario })
        .from(campanhasDisparo)
        .where(and(eq(campanhasDisparo.unidadeId, u), eq(campanhasDisparo.status, "agendada"))),
      ctx.db
        .select({
          dia: diaSp(sugestoesIa.createdAt),
          modelo: sugestoesIa.modelo,
          entrada: sql<number>`sum(${sugestoesIa.tokensEntrada})`.mapWith(Number),
          saida: sql<number>`sum(${sugestoesIa.tokensSaida})`.mapWith(Number),
        })
        .from(sugestoesIa)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, sugestoesIa.numeroId))
        .where(and(eq(numerosWhatsapp.unidadeId, u), gte(sugestoesIa.createdAt, desde), lt(sugestoesIa.createdAt, ate)))
        .groupBy(diaSp(sugestoesIa.createdAt), sugestoesIa.modelo),
      ctx.db
        .select({
          dia: diaSp(usoIa.criadoEm),
          modelo: usoIa.modelo,
          entrada: sql<number>`sum(${usoIa.tokensEntrada})`.mapWith(Number),
          saida: sql<number>`sum(${usoIa.tokensSaida})`.mapWith(Number),
        })
        .from(usoIa)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, usoIa.numeroId))
        .where(and(eq(numerosWhatsapp.unidadeId, u), gte(usoIa.criadoEm, desde), lt(usoIa.criadoEm, ate)))
        .groupBy(diaSp(usoIa.criadoEm), usoIa.modelo),
      ctx.db.select().from(lancamentosFinanceiros).where(eq(lancamentosFinanceiros.unidadeId, u)),
      ctx.db
        .select({ dia: diaSp(funilClientes.etapaDesde) })
        .from(funilClientes)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, funilClientes.numeroId))
        .where(and(eq(numerosWhatsapp.unidadeId, u), eq(funilClientes.etapa, "fechou"), gte(funilClientes.etapaDesde, desde), lt(funilClientes.etapaDesde, ate))),
    ]);

    const [progresso, respondentes, progressoAgendadas] = await Promise.all([
      carregarProgresso(ctx.db, campanhas.map((c) => c.id)),
      carregarRespondentes(ctx.db, campanhas.map((c) => c.id)),
      carregarProgresso(ctx.db, agendadas.map((c) => c.id)),
    ]);

    // Soma por ponto do gráfico (dia ou mês) e por fonte, separando período atual e anterior.
    const serie = new Map([...new Set(periodo.atual.map(ponto))].map((chave) => [chave, { whatsapp: 0, ia: 0, manual: 0 }]));
    const totais = { atual: { whatsapp: 0, ia: 0, manual: 0 }, anterior: { whatsapp: 0, ia: 0, manual: 0 } };
    const detalhe = new Map<string, { rotulo: string; fonte: Fonte; valor: number }>();
    const somar = (dia: string, fonte: Fonte, valor: number, chaveDetalhe: string, rotulo: string) => {
      if (valor <= 0) return;
      if (!noAtual(dia)) {
        totais.anterior[fonte] += valor;
        return;
      }
      totais.atual[fonte] += valor;
      const p = serie.get(ponto(dia));
      if (p) p[fonte] += valor;
      const d = detalhe.get(chaveDetalhe) ?? { rotulo, fonte, valor: 0 };
      d.valor += valor;
      detalhe.set(chaveDetalhe, d);
    };

    const linhasCampanhas = campanhas.map((c) => {
      const enviadas = (progresso.get(c.id) ?? progressoVazio()).enviado;
      const custo = Number(c.custoUnitario ?? 0) * enviadas;
      const dia = chaveDia(c.disparoEm);
      somar(dia, "whatsapp", custo, `whatsapp:${c.categoria}`, `Mensagens de ${ROTULO_CATEGORIA[c.categoria as CategoriaTemplate].toLowerCase()}`);
      const resp = respondentes.get(c.id) ?? 0;
      return { id: c.id, nome: c.nome, dia, categoria: c.categoria, enviadas, custo: centavos(custo), respostas: resp, custoPorResposta: resp > 0 ? centavos(custo / resp) : null };
    });

    const reais = (usd: number) => usd * config.cotacaoDolar;
    const usoIaPorOrigem = { sugestoes: { tokens: 0, reais: 0 }, analise: { tokens: 0, reais: 0 } };
    for (const [linhas, origem, rotulo] of [
      [sugestoes, "sugestoes", "IA: sugestões de resposta"],
      [analises, "analise", "IA: análise das conversas (funil)"],
    ] as const) {
      for (const l of linhas) {
        const valor = reais(custoIaUsd(l.modelo, l.entrada, l.saida));
        somar(l.dia, "ia", valor, `ia:${origem}`, rotulo);
        if (noAtual(l.dia)) {
          usoIaPorOrigem[origem].tokens += l.entrada + l.saida;
          usoIaPorOrigem[origem].reais += valor;
        }
      }
    }

    for (const l of lancamentos) {
      for (const dia of ocorrencias(l, inicioAnterior, periodo.fim)) somar(dia, "manual", Number(l.valor), `manual:${l.descricao.toLowerCase()}`, l.descricao);
    }

    const total = (t: { whatsapp: number; ia: number; manual: number }) => t.whatsapp + t.ia + t.manual;
    const matriculasAtual = matriculas.filter((m) => noAtual(m.dia)).length;
    const matriculasAnterior = matriculas.length - matriculasAtual;
    const gastoAtual = total(totais.atual);
    const gastoAnterior = total(totais.anterior);
    const comparar = periodo.comparacao !== null;
    const respostas = linhasCampanhas.filter((c) => noAtual(c.dia)).reduce((s, c) => s + c.respostas, 0);
    const receita = config.ticketMedio !== null ? matriculasAtual * config.ticketMedio : null;
    const comprometido = agendadas.reduce(
      (acc, c) => {
        const mensagens = (progressoAgendadas.get(c.id) ?? progressoVazio()).total;
        return { campanhas: acc.campanhas + 1, mensagens: acc.mensagens + mensagens, valor: acc.valor + mensagens * Number(c.custoUnitario ?? 0) };
      },
      { campanhas: 0, mensagens: 0, valor: 0 },
    );
    const arredondar = (t: { whatsapp: number; ia: number; manual: number }) => ({
      total: centavos(total(t)),
      whatsapp: centavos(t.whatsapp),
      ia: centavos(t.ia),
      manual: centavos(t.manual),
    });

    return {
      periodo: { comparacao: periodo.comparacao, agrupamento: porMes ? ("mes" as const) : ("dia" as const) },
      config,
      gasto: { atual: arredondar(totais.atual), anterior: comparar ? arredondar(totais.anterior) : null },
      serie: [...serie.entries()].map(([dia, v]) => ({ dia, whatsapp: centavos(v.whatsapp), ia: centavos(v.ia), manual: centavos(v.manual) })),
      detalhamento: [...detalhe.values()].map((d) => ({ ...d, valor: centavos(d.valor) })).sort((a, b) => b.valor - a.valor),
      ia: {
        sugestoes: { tokens: usoIaPorOrigem.sugestoes.tokens, reais: centavos(usoIaPorOrigem.sugestoes.reais) },
        analise: { tokens: usoIaPorOrigem.analise.tokens, reais: centavos(usoIaPorOrigem.analise.reais) },
        // O bot do n8n usa a chave da Anthropic do próprio n8n: esse gasto não passa pela plataforma.
        botNoN8n: agente.modo === "n8n",
      },
      retorno: {
        matriculas: matriculasAtual,
        matriculasAnterior: comparar ? matriculasAnterior : null,
        custoPorMatricula: matriculasAtual > 0 ? centavos(gastoAtual / matriculasAtual) : null,
        custoPorMatriculaAnterior: comparar && matriculasAnterior > 0 ? centavos(gastoAnterior / matriculasAnterior) : null,
        respostas,
        custoPorResposta: respostas > 0 ? centavos(totais.atual.whatsapp / respostas) : null,
        receitaEstimada: receita,
        retornoPorReal: receita !== null && gastoAtual > 0 ? Math.round((receita / gastoAtual) * 10) / 10 : null,
      },
      campanhas: linhasCampanhas
        .filter((c) => noAtual(c.dia))
        .sort((a, b) => b.custo - a.custo)
        .slice(0, 8),
      comprometido: { ...comprometido, valor: centavos(comprometido.valor) },
    };
  }),

  salvarConfig: procedimentoAdmin.input(configFinanceiroSchema).mutation(async ({ ctx, input }) => {
    await salvarConfigFinanceiro(ctx.db, ctx.unidadeId, input);
    return { ok: true };
  }),

  lancamentos: procedimentoAdmin.query(async ({ ctx }) =>
    (
      await ctx.db
        .select()
        .from(lancamentosFinanceiros)
        .where(eq(lancamentosFinanceiros.unidadeId, ctx.unidadeId))
        .orderBy(desc(lancamentosFinanceiros.data), desc(lancamentosFinanceiros.id))
    ).map((l) => ({ id: l.id, descricao: l.descricao, valor: Number(l.valor), data: l.data, recorrente: l.recorrente })),
  ),

  salvarLancamento: procedimentoAdmin.input(salvarLancamentoInputSchema).mutation(async ({ ctx, input }) => {
    const dados = { descricao: input.descricao, valor: input.valor.toFixed(2), data: input.data, recorrente: input.recorrente };
    if (input.id) {
      const [alterado] = await ctx.db
        .update(lancamentosFinanceiros)
        .set(dados)
        .where(and(eq(lancamentosFinanceiros.id, input.id), eq(lancamentosFinanceiros.unidadeId, ctx.unidadeId)))
        .returning({ id: lancamentosFinanceiros.id });
      if (!alterado) throw new TRPCError({ code: "NOT_FOUND", message: "Lançamento não encontrado." });
      return alterado;
    }
    const [criado] = await ctx.db.insert(lancamentosFinanceiros).values({ ...dados, unidadeId: ctx.unidadeId }).returning({ id: lancamentosFinanceiros.id });
    return criado!;
  }),

  excluirLancamento: procedimentoAdmin.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(lancamentosFinanceiros).where(and(eq(lancamentosFinanceiros.id, input.id), eq(lancamentosFinanceiros.unidadeId, ctx.unidadeId)));
    return { ok: true };
  }),
});
