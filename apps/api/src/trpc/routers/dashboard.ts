import {
  campanhasDisparo,
  conversasConfig,
  disparoDestinatarios,
  mensagensSaida,
  respostasClientes,
  sugestoesIa,
  templatesWhatsapp,
} from "@atendimento-academias/db";
import { resumoDashboardInputSchema } from "@atendimento-academias/shared";
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, lt, max, ne } from "drizzle-orm";
import { chaveDia, DIA_MS, diasAtras } from "../periodo.js";
import { carregarProgresso, carregarRespondentes, progressoVazio, taxa, type ProgressoPorStatus } from "../progresso.js";
import { procedimentoAutenticado, router } from "../trpc.js";

const MINUTO_MS = 60_000;
const JANELA_RESPOSTA_MS = 24 * 60 * MINUTO_MS;
// Abaixo disso a janela está acabando: é o que a equipe precisa atender antes de virar template.
const LIMIAR_ACABANDO_MS = 2 * 60 * MINUTO_MS;
const LIMITE_CAMPANHA_PARADA_MIN = 10;
const MAX_MOTIVOS = 5;
const MAX_ATENCAO = 5;
const MAX_PROXIMOS = 4;

interface Totais extends ProgressoPorStatus {
  taxaSucesso: number | null;
}

function totaisVazios(): Totais {
  return { ...progressoVazio(), taxaSucesso: null };
}

function somar(alvo: Totais, progresso: ProgressoPorStatus) {
  alvo.pendente += progresso.pendente;
  alvo.enviado += progresso.enviado;
  alvo.falhou += progresso.falhou;
  alvo.total += progresso.total;
  const finalizados = alvo.enviado + alvo.falhou;
  alvo.taxaSucesso = finalizados > 0 ? alvo.enviado / finalizados : null;
}

export const dashboardRouter = router({
  resumo: procedimentoAutenticado.input(resumoDashboardInputSchema).query(async ({ ctx, input }) => {
    const { dias } = input;
    const agora = Date.now();

    const chavesAtual = diasAtras(agora, dias - 1, 0);
    const chavesAnterior = diasAtras(agora, 2 * dias - 1, dias);
    const conjuntoAtual = new Set(chavesAtual);
    const conjuntoAnterior = new Set(chavesAnterior);

    const campanhas = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        status: campanhasDisparo.status,
        createdAt: campanhasDisparo.disparoEm,
        templateNome: templatesWhatsapp.nome,
        custoUnitario: campanhasDisparo.custoUnitario,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      // Campanha agendada ainda não disparou: não entra nos números de envio.
      .where(and(ne(campanhasDisparo.status, "agendada"), gte(campanhasDisparo.disparoEm, new Date(agora - (2 * dias + 1) * DIA_MS))))
      .orderBy(desc(campanhasDisparo.disparoEm), desc(campanhasDisparo.id));

    const progressoPorCampanha = await carregarProgresso(
      ctx.db,
      campanhas.map((campanha) => campanha.id),
    );

    const serie = new Map(chavesAtual.map((dia) => [dia, { dia, enviado: 0, falhou: 0, pendente: 0 }]));
    const atual = totaisVazios();
    const anterior = totaisVazios();
    const campanhasDoPeriodo: Array<(typeof campanhas)[number] & { progresso: ProgressoPorStatus }> = [];
    let custoDoPeriodo = 0;

    for (const campanha of campanhas) {
      const progresso = progressoPorCampanha.get(campanha.id) ?? progressoVazio();
      const dia = chaveDia(campanha.createdAt);

      if (conjuntoAtual.has(dia)) {
        const ponto = serie.get(dia)!;
        ponto.enviado += progresso.enviado;
        ponto.falhou += progresso.falhou;
        ponto.pendente += progresso.pendente;
        somar(atual, progresso);
        custoDoPeriodo += Number(campanha.custoUnitario ?? 0) * progresso.enviado;
        campanhasDoPeriodo.push({ ...campanha, progresso });
      } else if (conjuntoAnterior.has(dia)) {
        somar(anterior, progresso);
      }
    }

    const idsDoPeriodo = campanhasDoPeriodo.map((campanha) => campanha.id);

    // Respostas atribuídas às campanhas de cada janela: alimenta a taxa de retorno da visão geral.
    const respondentes = await carregarRespondentes(
      ctx.db,
      campanhas.map((campanha) => campanha.id),
    );
    let respostasAtual = 0;
    let respostasAnterior = 0;
    for (const campanha of campanhas) {
      const total = respondentes.get(campanha.id) ?? 0;
      if (total === 0) continue;
      const dia = chaveDia(campanha.createdAt);
      if (conjuntoAtual.has(dia)) respostasAtual += total;
      else if (conjuntoAnterior.has(dia)) respostasAnterior += total;
    }

    const motivosBrutos =
      idsDoPeriodo.length === 0
        ? []
        : await ctx.db
            .select({ motivo: disparoDestinatarios.erroDetalhe, total: count() })
            .from(disparoDestinatarios)
            .where(
              and(inArray(disparoDestinatarios.campanhaId, idsDoPeriodo), eq(disparoDestinatarios.statusEnvio, "falhou")),
            )
            .groupBy(disparoDestinatarios.erroDetalhe)
            .orderBy(desc(count()));

    const motivosFalha = motivosBrutos.slice(0, MAX_MOTIVOS).map((linha) => ({
      motivo: linha.motivo ?? "Motivo não informado",
      total: linha.total,
    }));
    const outros = motivosBrutos.slice(MAX_MOTIVOS).reduce((soma, linha) => soma + linha.total, 0);
    if (outros > 0) motivosFalha.push({ motivo: "Outros", total: outros });

    const [{ total: campanhasEmAndamento }] = await ctx.db
      .select({ total: count() })
      .from(campanhasDisparo)
      .where(eq(campanhasDisparo.status, "enviando"));

    const paradas = await ctx.db
      .select({ id: campanhasDisparo.id, nome: campanhasDisparo.nome, createdAt: campanhasDisparo.disparoEm })
      .from(campanhasDisparo)
      .where(
        and(
          eq(campanhasDisparo.status, "enviando"),
          lt(campanhasDisparo.disparoEm, new Date(agora - LIMITE_CAMPANHA_PARADA_MIN * MINUTO_MS)),
        ),
      )
      .orderBy(desc(campanhasDisparo.id))
      .limit(MAX_ATENCAO);

    // Campanhas agendadas que ainda vão disparar, da mais próxima para a mais distante.
    const proximos = await ctx.db
      .select({
        id: campanhasDisparo.id,
        nome: campanhasDisparo.nome,
        quando: campanhasDisparo.disparoEm,
        templateNome: templatesWhatsapp.nome,
      })
      .from(campanhasDisparo)
      .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
      .where(eq(campanhasDisparo.status, "agendada"))
      .orderBy(asc(campanhasDisparo.disparoEm))
      .limit(MAX_PROXIMOS);

    const destinatariosPorCampanha = await carregarProgresso(
      ctx.db,
      proximos.map((campanha) => campanha.id),
    );

    const [{ total: totalAgendadas }] = await ctx.db
      .select({ total: count() })
      .from(campanhasDisparo)
      .where(eq(campanhasDisparo.status, "agendada"));

    // Conversas com mensagem ainda não lida: atalho para a caixa de entrada.
    const [naoLidas] = await ctx.db
      .select({ conversas: countDistinct(respostasClientes.telefone) })
      .from(respostasClientes)
      .where(isNull(respostasClientes.lidaEm));

    // Conversas em que a última mensagem foi do cliente: são as que esperam alguém responder.
    const [ultimasDoCliente, ultimasSaidas, ultimosDisparos, [pendentesIa], [humanos]] = await Promise.all([
      ctx.db
        .select({ telefone: respostasClientes.telefone, numeroId: respostasClientes.numeroId, em: max(respostasClientes.recebidaEm) })
        .from(respostasClientes)
        .groupBy(respostasClientes.telefone, respostasClientes.numeroId),
      ctx.db
        .select({ telefone: mensagensSaida.telefone, numeroId: mensagensSaida.numeroId, em: max(mensagensSaida.createdAt) })
        .from(mensagensSaida)
        .groupBy(mensagensSaida.telefone, mensagensSaida.numeroId),
      ctx.db
        .select({ telefone: disparoDestinatarios.telefone, numeroId: campanhasDisparo.numeroId, em: max(disparoDestinatarios.enviadoEm) })
        .from(disparoDestinatarios)
        .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
        .where(eq(disparoDestinatarios.statusEnvio, "enviado"))
        .groupBy(disparoDestinatarios.telefone, campanhasDisparo.numeroId),
      ctx.db.select({ total: count() }).from(sugestoesIa).where(eq(sugestoesIa.status, "pendente")),
      ctx.db.select({ total: count() }).from(conversasConfig).where(eq(conversasConfig.precisaHumano, true)),
    ]);

    const chaveConversa = (numeroId: number | null, telefone: string) => `${numeroId ?? 0}|${telefone}`;
    const ultimaNossa = new Map<string, number>();
    for (const linha of [...ultimasSaidas, ...ultimosDisparos]) {
      if (!linha.em) continue;
      const chave = chaveConversa(linha.numeroId, linha.telefone);
      const quando = new Date(linha.em as unknown as string | Date).getTime();
      if (quando > (ultimaNossa.get(chave) ?? 0)) ultimaNossa.set(chave, quando);
    }

    const atendimento = { aguardando: 0, acabando: 0, semJanela: 0 };
    for (const linha of ultimasDoCliente) {
      if (!linha.em) continue;
      const quando = new Date(linha.em as unknown as string | Date).getTime();
      // Já respondemos depois dela: a conversa não está na fila.
      if ((ultimaNossa.get(chaveConversa(linha.numeroId, linha.telefone)) ?? 0) > quando) continue;

      const restante = quando + JANELA_RESPOSTA_MS - agora;
      if (restante <= 0) atendimento.semJanela += 1;
      else {
        atendimento.aguardando += 1;
        if (restante < LIMIAR_ACABANDO_MS) atendimento.acabando += 1;
      }
    }

    const atencao = [
      ...paradas.map((campanha) => ({
        tipo: "parada" as const,
        campanhaId: campanha.id,
        nome: campanha.nome,
        minutos: Math.round((agora - campanha.createdAt.getTime()) / MINUTO_MS),
      })),
      ...campanhasDoPeriodo
        .filter((campanha) => campanha.progresso.falhou > 0)
        .sort((a, b) => b.progresso.falhou - a.progresso.falhou)
        .slice(0, MAX_ATENCAO)
        .map((campanha) => ({
          tipo: "falhas" as const,
          campanhaId: campanha.id,
          nome: campanha.nome,
          falhas: campanha.progresso.falhou,
          total: campanha.progresso.total,
        })),
    ].slice(0, MAX_ATENCAO);

    return {
      dias,
      serie: [...serie.values()],
      atual,
      anterior,
      campanhasEmAndamento,
      motivosFalha,
      atencao,
      respostas: { atual: respostasAtual, anterior: respostasAnterior },
      // O que o período custou de verdade: preço congelado na campanha × mensagens que saíram.
      custo: {
        total: custoDoPeriodo,
        porResposta: respostasAtual > 0 ? custoDoPeriodo / respostasAtual : null,
      },
      atendimento: {
        ...atendimento,
        sugestoesPendentes: pendentesIa?.total ?? 0,
        precisaHumano: humanos?.total ?? 0,
      },
      taxaRetorno: {
        atual: taxa(respostasAtual, atual.enviado),
        anterior: taxa(respostasAnterior, anterior.enviado),
      },
      conversasNaoLidas: naoLidas?.conversas ?? 0,
      agendadas: {
        total: totalAgendadas,
        proximos: proximos.map((campanha) => ({
          ...campanha,
          quando: campanha.quando.toISOString(),
          destinatarios: (destinatariosPorCampanha.get(campanha.id) ?? progressoVazio()).total,
        })),
      },
      recentes: campanhasDoPeriodo.slice(0, 5),
    };
  }),
});
