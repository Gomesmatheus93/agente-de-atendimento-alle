import { campanhasDisparo, disparoDestinatarios, templatesWhatsapp } from "@atendimento-academias/db";
import {
  calcularCusto,
  criarCampanhaInputSchema,
  detalheCampanhaInputSchema,
  insightsCampanhasInputSchema,
  listarCampanhasInputSchema,
  moverEtapaInputSchema,
  preencherTemplate,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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

const MINUTO_S = 60;
const MAX_MOTIVOS_FALHA = 5;

// Linha crua da consulta de insights (números vêm do Postgres como texto).
type LinhaInsight = {
  campanha_id: number;
  total: string;
  enviados: string;
  falhas: string;
  entregues: string;
  lidas: string;
  responderam: string;
  interessados: string;
  fecharam: string;
  mediana_leitura_s: number | null;
  mediana_resposta_s: number | null;
};

const minutos = (segundos: number | null) => (segundos === null ? null : Math.round(segundos / MINUTO_S));

export const campanhasRouter = router({
  // Painel de insights: o funil de cada campanha — enviada → entregue → lida → respondeu → fechou
  // matrícula —, quanto custou cada matrícula, quanto o cliente demora para ler e responder, o melhor
  // horário para disparar e por que os envios falham. "Respondeu" é a resposta atribuída ao disparo
  // (até 7 dias depois); "fechou"/"interessado" é a situação atual do cliente no Funil.
  insights: procedimentoUnidade.input(insightsCampanhasInputSchema).query(async ({ ctx, input }) => {
    const desde = new Date(Date.now() - input.dias * 86_400_000);
    const destinatarios = sql`
      select d.id, d.campanha_id, d.telefone, d.status_envio, d.erro_detalhe, d.enviado_em, d.entregue_em, d.lida_em, c.numero_id
      from disparo_destinatarios d
      join campanhas_disparo c on c.id = d.campanha_id
      where c.unidade_id = ${ctx.unidadeId} and c.status <> 'agendada' and c.disparo_em >= ${desde.toISOString()}::timestamptz`;
    // Primeira resposta do cliente DEPOIS do disparo (a atribuição do webhook olha só uma janela de dias).
    const respostas = sql`
      select dest.id as destinatario_id, min(r.recebida_em) as primeira
      from dest
      join respostas_clientes r on r.destinatario_id = dest.id and r.recebida_em >= dest.enviado_em
      group by dest.id`;
    // Cada matrícula (ou interesse) conta para uma campanha só: a última que o cliente recebeu antes de
    // fechar (a última mensagem que a análise do Funil leu). Sem isso, quem recebeu 5 campanhas e fechou
    // apareceria como matrícula nas 5.
    const ultimoToque = sql`
      select distinct on (dest.numero_id, dest.telefone) dest.id
      from dest
      join funil_clientes f on f.numero_id = dest.numero_id and f.telefone = dest.telefone
      where dest.status_envio = 'enviado' and dest.enviado_em <= coalesce(f.ultima_mensagem_analisada, now())
      order by dest.numero_id, dest.telefone, dest.enviado_em desc`;

    const [campanhas, porCampanha, porHora, falhas] = await Promise.all([
      ctx.db
        .select({
          id: campanhasDisparo.id,
          nome: campanhasDisparo.nome,
          disparoEm: campanhasDisparo.disparoEm,
          custoUnitario: campanhasDisparo.custoUnitario,
          templateNome: templatesWhatsapp.nome,
        })
        .from(campanhasDisparo)
        .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
        .where(and(eq(campanhasDisparo.unidadeId, ctx.unidadeId), sql`${campanhasDisparo.status} <> 'agendada'`, sql`${campanhasDisparo.disparoEm} >= ${desde.toISOString()}::timestamptz`))
        .orderBy(desc(campanhasDisparo.disparoEm)),
      ctx.db.execute<LinhaInsight>(sql`
        with dest as (${destinatarios}), resp as (${respostas}), toque as (${ultimoToque})
        select dest.campanha_id,
          count(*) as total,
          count(*) filter (where status_envio = 'enviado') as enviados,
          count(*) filter (where status_envio = 'falhou') as falhas,
          count(*) filter (where status_envio = 'enviado' and (entregue_em is not null or lida_em is not null)) as entregues,
          count(*) filter (where status_envio = 'enviado' and lida_em is not null) as lidas,
          count(resp.destinatario_id) as responderam,
          count(*) filter (where toque.id is not null and f.etapa in ('interessado', 'fechando')) as interessados,
          count(*) filter (where toque.id is not null and f.etapa = 'fechou') as fecharam,
          percentile_cont(0.5) within group (order by extract(epoch from lida_em - enviado_em))
            filter (where lida_em is not null and enviado_em is not null) as mediana_leitura_s,
          percentile_cont(0.5) within group (order by extract(epoch from resp.primeira - dest.enviado_em))
            filter (where resp.primeira is not null and dest.enviado_em is not null) as mediana_resposta_s
        from dest
        left join resp on resp.destinatario_id = dest.id
        left join funil_clientes f on f.numero_id = dest.numero_id and f.telefone = dest.telefone
        left join toque on toque.id = dest.id
        group by dest.campanha_id`),
      // Hora do disparo no horário de Brasília: em que horário as pessoas mais leem e respondem.
      ctx.db.execute<{ hora: number; enviados: string; lidas: string; responderam: string }>(sql`
        with dest as (${destinatarios}), resp as (${respostas})
        select extract(hour from dest.enviado_em at time zone 'America/Sao_Paulo')::int as hora,
          count(*) as enviados,
          count(*) filter (where lida_em is not null) as lidas,
          count(resp.destinatario_id) as responderam
        from dest left join resp on resp.destinatario_id = dest.id
        where dest.status_envio = 'enviado' and dest.enviado_em is not null
        group by 1 order by 1`),
      ctx.db.execute<{ motivo: string | null; total: string }>(sql`
        with dest as (${destinatarios})
        select erro_detalhe as motivo, count(*) as total from dest
        where status_envio = 'falhou' group by erro_detalhe order by count(*) desc limit ${MAX_MOTIVOS_FALHA}`),
    ]);

    const linhaPorCampanha = new Map(porCampanha.map((linha) => [Number(linha.campanha_id), linha]));
    const lista = campanhas.map((campanha) => {
      const linha = linhaPorCampanha.get(campanha.id);
      const enviados = Number(linha?.enviados ?? 0);
      const fecharam = Number(linha?.fecharam ?? 0);
      const preco = precoUnitarioDe(campanha.custoUnitario);
      const custo = preco === null ? null : calcularCusto(enviados, preco);
      return {
        id: campanha.id,
        nome: campanha.nome,
        templateNome: campanha.templateNome,
        disparoEm: campanha.disparoEm.toISOString(),
        total: Number(linha?.total ?? 0),
        enviados,
        falhas: Number(linha?.falhas ?? 0),
        entregues: Number(linha?.entregues ?? 0),
        lidas: Number(linha?.lidas ?? 0),
        responderam: Number(linha?.responderam ?? 0),
        interessados: Number(linha?.interessados ?? 0),
        fecharam,
        custo,
        custoPorMatricula: custo !== null && fecharam > 0 ? calcularCusto(1, custo / fecharam) : null,
        minutosAteLer: minutos(linha?.mediana_leitura_s ?? null),
        minutosAteResponder: minutos(linha?.mediana_resposta_s ?? null),
      };
    });

    const somar = (campo: "total" | "enviados" | "falhas" | "entregues" | "lidas" | "responderam" | "interessados" | "fecharam") =>
      lista.reduce((soma, campanha) => soma + campanha[campo], 0);
    const custoTotal = lista.reduce((soma, campanha) => soma + (campanha.custo ?? 0), 0);
    const fecharam = somar("fecharam");

    return {
      dias: input.dias,
      totais: {
        campanhas: lista.length,
        total: somar("total"),
        enviados: somar("enviados"),
        falhas: somar("falhas"),
        entregues: somar("entregues"),
        lidas: somar("lidas"),
        responderam: somar("responderam"),
        interessados: somar("interessados"),
        fecharam,
        custo: calcularCusto(1, custoTotal),
        custoPorMatricula: fecharam > 0 ? calcularCusto(1, custoTotal / fecharam) : null,
      },
      campanhas: lista,
      porHora: porHora.map((linha) => ({
        hora: Number(linha.hora),
        enviados: Number(linha.enviados),
        lidas: Number(linha.lidas),
        responderam: Number(linha.responderam),
      })),
      motivosFalha: falhas.map((linha) => ({ motivo: linha.motivo ?? "Motivo não informado", total: Number(linha.total) })),
    };
  }),

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
        entregueEm: disparoDestinatarios.entregueEm,
        lidaEm: disparoDestinatarios.lidaEm,
        parametros: disparoDestinatarios.parametros,
      })
      .from(disparoDestinatarios)
      .where(eq(disparoDestinatarios.campanhaId, input.id))
      .orderBy(asc(disparoDestinatarios.id));

    const progresso = progressoVazio();
    // Checks do WhatsApp: quantos chegaram no aparelho e quantos o cliente abriu (lida conta como entregue).
    let entregues = 0;
    let lidas = 0;
    for (const destinatario of destinatarios) {
      progresso[destinatario.statusEnvio] += 1;
      progresso.total += 1;
      if (destinatario.statusEnvio === "enviado" && (destinatario.entregueEm || destinatario.lidaEm)) entregues += 1;
      if (destinatario.statusEnvio === "enviado" && destinatario.lidaEm) lidas += 1;
    }

    const { templateConteudo, custoUnitario, ...dadosCampanha } = campanha;
    const respondentes = (await carregarRespondentes(ctx.db, [input.id])).get(input.id) ?? 0;

    return {
      ...dadosCampanha,
      ...resumoRetornoECusto(progresso.enviado, respondentes, custoUnitario),
      // Todos os destinatários de uma campanha compartilham os mesmos parâmetros.
      mensagem: preencherTemplate(templateConteudo, destinatarios[0]?.parametros ?? {}),
      progresso,
      entregues,
      lidas,
      destinatarios: destinatarios.map(({ parametros: _parametros, ...destinatario }) => destinatario),
    };
  }),
});
