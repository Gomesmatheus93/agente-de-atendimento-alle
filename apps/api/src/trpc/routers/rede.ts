import {
  campanhasDisparo,
  contasInstagram,
  conversasConfig,
  conversasInstagram,
  disparoDestinatarios,
  funilClientes,
  numerosWhatsapp,
  respostasClientes,
  unidades,
  usuarios,
  verificacoesSaude,
} from "@atendimento-academias/db";
import { and, asc, count, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { procedimentoSuperadmin, router } from "../trpc.js";

// Visão da rede (superadmin): todas as unidades lado a lado, no período escolhido e no anterior de mesmo
// tamanho, para comparar quem está crescendo, quem converte melhor e quem precisa de atenção agora.
export const redeRouter = router({
  resumo: procedimentoSuperadmin.input(z.object({ dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) })).query(async ({ ctx, input }) => {
    const agora = Date.now();
    const inicio = new Date(agora - input.dias * 86_400_000);
    const inicioAnterior = new Date(agora - 2 * input.dias * 86_400_000);
    const atual = (coluna: unknown) => sql`${coluna} >= ${inicio.toISOString()}::timestamptz`;

    const [lista, atendidos, matriculas, campanhas, humanos, saude, dms, equipe, numeros] = await Promise.all([
      ctx.db.select({ id: unidades.id, nome: unidades.nome, ativo: unidades.ativo }).from(unidades).orderBy(asc(unidades.nome)),
      ctx.db
        .select({
          unidadeId: numerosWhatsapp.unidadeId,
          atual: sql<number>`count(distinct (${respostasClientes.numeroId}, ${respostasClientes.telefone})) filter (where ${atual(respostasClientes.recebidaEm)})`.mapWith(Number),
          anterior: sql<number>`count(distinct (${respostasClientes.numeroId}, ${respostasClientes.telefone})) filter (where not ${atual(respostasClientes.recebidaEm)})`.mapWith(Number),
        })
        .from(respostasClientes)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, respostasClientes.numeroId))
        .where(gte(respostasClientes.recebidaEm, inicioAnterior))
        .groupBy(numerosWhatsapp.unidadeId),
      ctx.db
        .select({
          unidadeId: numerosWhatsapp.unidadeId,
          atual: sql<number>`count(*) filter (where ${atual(funilClientes.etapaDesde)})`.mapWith(Number),
          anterior: sql<number>`count(*) filter (where not ${atual(funilClientes.etapaDesde)})`.mapWith(Number),
        })
        .from(funilClientes)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, funilClientes.numeroId))
        .where(and(eq(funilClientes.etapa, "fechou"), gte(funilClientes.etapaDesde, inicioAnterior)))
        .groupBy(numerosWhatsapp.unidadeId),
      // Custo = preço congelado na campanha × mensagens que saíram.
      ctx.db
        .select({
          unidadeId: campanhasDisparo.unidadeId,
          campanhas: sql<number>`count(distinct ${campanhasDisparo.id})`.mapWith(Number),
          envios: sql<number>`count(${disparoDestinatarios.id}) filter (where ${disparoDestinatarios.statusEnvio} = 'enviado')`.mapWith(Number),
          falhas: sql<number>`count(${disparoDestinatarios.id}) filter (where ${disparoDestinatarios.statusEnvio} = 'falhou')`.mapWith(Number),
          custo: sql<number>`coalesce(sum(${campanhasDisparo.custoUnitario}) filter (where ${disparoDestinatarios.statusEnvio} = 'enviado'), 0)`.mapWith(Number),
        })
        .from(campanhasDisparo)
        .leftJoin(disparoDestinatarios, eq(disparoDestinatarios.campanhaId, campanhasDisparo.id))
        .where(and(ne(campanhasDisparo.status, "agendada"), gte(campanhasDisparo.disparoEm, inicio)))
        .groupBy(campanhasDisparo.unidadeId),
      ctx.db
        .select({ unidadeId: numerosWhatsapp.unidadeId, total: count() })
        .from(conversasConfig)
        .innerJoin(numerosWhatsapp, eq(numerosWhatsapp.id, conversasConfig.numeroId))
        .where(eq(conversasConfig.precisaHumano, true))
        .groupBy(numerosWhatsapp.unidadeId),
      ctx.db
        .select({
          unidadeId: verificacoesSaude.unidadeId,
          falhas: sql<number>`count(*) filter (where ${verificacoesSaude.nivel} = 'falha')`.mapWith(Number),
          atencoes: sql<number>`count(*) filter (where ${verificacoesSaude.nivel} = 'atencao')`.mapWith(Number),
          problemas: sql<string[]>`coalesce(array_agg(${verificacoesSaude.titulo}) filter (where ${verificacoesSaude.nivel} <> 'ok'), '{}')`,
        })
        .from(verificacoesSaude)
        .groupBy(verificacoesSaude.unidadeId),
      ctx.db
        .select({ unidadeId: contasInstagram.unidadeId, username: contasInstagram.username, naoLidas: sql<number>`count(${conversasInstagram.id}) filter (where ${conversasInstagram.naoLidas} > 0)`.mapWith(Number) })
        .from(contasInstagram)
        .leftJoin(conversasInstagram, eq(conversasInstagram.contaId, contasInstagram.id))
        .groupBy(contasInstagram.unidadeId, contasInstagram.username),
      ctx.db
        .select({ unidadeId: usuarios.unidadeId, total: count() })
        .from(usuarios)
        .where(and(isNotNull(usuarios.unidadeId), eq(usuarios.ativo, true)))
        .groupBy(usuarios.unidadeId),
      ctx.db
        .select({ unidadeId: numerosWhatsapp.unidadeId, total: count() })
        .from(numerosWhatsapp)
        .where(eq(numerosWhatsapp.ativo, true))
        .groupBy(numerosWhatsapp.unidadeId),
    ]);

    const por = <T extends { unidadeId: number | null }>(linhas: T[]) => new Map(linhas.map((l) => [l.unidadeId, l]));
    const [mAtendidos, mMatriculas, mCampanhas, mHumanos, mSaude, mDms, mEquipe, mNumeros] = [atendidos, matriculas, campanhas, humanos, saude, dms, equipe, numeros].map(
      (l) => por(l as Array<{ unidadeId: number | null }>),
    ) as [
      Map<number | null, (typeof atendidos)[number]>,
      Map<number | null, (typeof matriculas)[number]>,
      Map<number | null, (typeof campanhas)[number]>,
      Map<number | null, (typeof humanos)[number]>,
      Map<number | null, (typeof saude)[number]>,
      Map<number | null, (typeof dms)[number]>,
      Map<number | null, (typeof equipe)[number]>,
      Map<number | null, (typeof numeros)[number]>,
    ];
    const plataforma = mSaude.get(null);

    const linhas = lista.map((u) => {
      const a = mAtendidos.get(u.id);
      const m = mMatriculas.get(u.id);
      const c = mCampanhas.get(u.id);
      const s = mSaude.get(u.id);
      const ig = mDms.get(u.id);
      const atendidosAtual = a?.atual ?? 0;
      const matriculasAtual = m?.atual ?? 0;
      const custo = c?.custo ?? 0;
      return {
        id: u.id,
        nome: u.nome,
        ativo: u.ativo,
        atendidos: { atual: atendidosAtual, anterior: a?.anterior ?? 0 },
        matriculas: { atual: matriculasAtual, anterior: m?.anterior ?? 0 },
        conversao: atendidosAtual > 0 ? matriculasAtual / atendidosAtual : null,
        campanhas: c?.campanhas ?? 0,
        envios: c?.envios ?? 0,
        falhasDeEnvio: c?.falhas ?? 0,
        custo,
        custoPorMatricula: matriculasAtual > 0 ? custo / matriculasAtual : null,
        precisaHumano: mHumanos.get(u.id)?.total ?? 0,
        instagram: ig ? { username: ig.username, naoLidas: ig.naoLidas } : null,
        equipe: mEquipe.get(u.id)?.total ?? 0,
        numerosAtivos: mNumeros.get(u.id)?.total ?? 0,
        saude: { falhas: s?.falhas ?? 0, atencoes: s?.atencoes ?? 0, problemas: (s?.problemas ?? []).slice(0, 5) },
      };
    });

    const soma = (f: (l: (typeof linhas)[number]) => number) => linhas.filter((l) => l.ativo).reduce((t, l) => t + f(l), 0);
    const totalAtendidos = soma((l) => l.atendidos.atual);
    const totalMatriculas = soma((l) => l.matriculas.atual);
    const totalCusto = soma((l) => l.custo);
    return {
      dias: input.dias,
      totais: {
        unidades: linhas.filter((l) => l.ativo).length,
        atendidos: { atual: totalAtendidos, anterior: soma((l) => l.atendidos.anterior) },
        matriculas: { atual: totalMatriculas, anterior: soma((l) => l.matriculas.anterior) },
        conversao: totalAtendidos > 0 ? totalMatriculas / totalAtendidos : null,
        custo: totalCusto,
        custoPorMatricula: totalMatriculas > 0 ? totalCusto / totalMatriculas : null,
        precisaHumano: soma((l) => l.precisaHumano),
      },
      plataforma: { falhas: plataforma?.falhas ?? 0, atencoes: plataforma?.atencoes ?? 0, problemas: plataforma?.problemas ?? [] },
      unidades: linhas,
    };
  }),
});
