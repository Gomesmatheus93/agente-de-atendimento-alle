import {
  contatoEtiquetas,
  contatosUnidade,
  descadastros,
  doNumeroDaUnidade,
  etiquetas,
  funilClientes,
  numerosWhatsapp,
  qualificada as q,
  respostasClientes,
  segmentos,
  type Db,
} from "@atendimento-academias/db";
import {
  CONTATOS_POR_PAGINA,
  detalheConversaInputSchema,
  etiquetarContatosInputSchema,
  filtroContatosSchema,
  importarContatosInputSchema,
  MAX_TELEFONES_POR_CAMPANHA,
  normalizarTelefone,
  salvarContatoInputSchema,
  salvarEtiquetaInputSchema,
  salvarSegmentoInputSchema,
  type FiltroContatos,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { garantirNumeroDaUnidade } from "../../servicos/conversas.js";
import { procedimentoUnidade, router } from "../trpc.js";

// Base de contatos da unidade: lista com filtros, importação de planilha, etiquetas e segmentos salvos.

function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Última mensagem que o contato mandou para algum número da unidade.
export function ultimaMensagem(unidadeId: number): SQL<Date | null> {
  return sql<Date | null>`(
    select max(${q(respostasClientes.recebidaEm)}) from ${respostasClientes}
    where ${q(respostasClientes.telefone)} = ${q(contatosUnidade.telefone)} and ${q(respostasClientes.numeroId)} in (
      select ${q(numerosWhatsapp.id)} from ${numerosWhatsapp} where ${q(numerosWhatsapp.unidadeId)} = ${unidadeId}
    )
  )`;
}

export function descadastrado(unidadeId: number): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${descadastros} where ${q(descadastros.unidadeId)} = ${unidadeId} and ${q(descadastros.telefone)} = ${q(contatosUnidade.telefone)}
  )`;
}

export function condicoes(unidadeId: number, filtro: FiltroContatos): SQL[] {
  const lista: SQL[] = [eq(contatosUnidade.unidadeId, unidadeId)];
  const busca = filtro.busca?.trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    lista.push(
      digitos.length >= 4
        ? sql`(${contatosUnidade.nome} ilike ${`%${escaparLike(busca)}%`} or ${contatosUnidade.telefone} like ${`%${digitos}%`})`
        : sql`${contatosUnidade.nome} ilike ${`%${escaparLike(busca)}%`}`,
    );
  }
  if (filtro.etiquetas.length > 0) {
    lista.push(sql`exists (
      select 1 from ${contatoEtiquetas} where ${contatoEtiquetas.contatoId} = ${contatosUnidade.id}
        and ${inArray(contatoEtiquetas.etiquetaId, filtro.etiquetas)}
    )`);
  }
  if (filtro.semEtiquetas.length > 0) {
    lista.push(sql`not exists (
      select 1 from ${contatoEtiquetas} where ${contatoEtiquetas.contatoId} = ${contatosUnidade.id}
        and ${inArray(contatoEtiquetas.etiquetaId, filtro.semEtiquetas)}
    )`);
  }
  const ultima = ultimaMensagem(unidadeId);
  const limite = sql`now() - make_interval(days => ${filtro.dias})`;
  if (filtro.conversa === "escreveu") lista.push(sql`${ultima} >= ${limite}`);
  if (filtro.conversa === "nao_escreveu") lista.push(sql`(${ultima} is null or ${ultima} < ${limite})`);
  if (filtro.conversa === "nunca_escreveu") lista.push(sql`${ultima} is null`);
  if (filtro.etapasFunil.length > 0) {
    lista.push(sql`exists (
      select 1 from ${funilClientes} where ${funilClientes.telefone} = ${contatosUnidade.telefone}
        and ${doNumeroDaUnidade(funilClientes.numeroId, unidadeId)} and ${inArray(funilClientes.etapa, filtro.etapasFunil)}
    )`);
  }
  return lista;
}

async function contar(db: Db, unidadeId: number, filtro: FiltroContatos) {
  const [linha] = await db
    .select({ total: count(), descadastrados: sql<number>`count(*) filter (where ${descadastrado(unidadeId)})` })
    .from(contatosUnidade)
    .where(and(...condicoes(unidadeId, filtro)));
  const total = Number(linha?.total ?? 0);
  const fora = Number(linha?.descadastrados ?? 0);
  return { total, descadastrados: fora, alcancaveis: total - fora };
}

async function etiquetasDosContatos(db: Db, ids: number[]): Promise<Map<number, number[]>> {
  const mapa = new Map<number, number[]>();
  if (ids.length === 0) return mapa;
  const linhas = await db.select().from(contatoEtiquetas).where(inArray(contatoEtiquetas.contatoId, ids));
  for (const { contatoId, etiquetaId } of linhas) mapa.set(contatoId, [...(mapa.get(contatoId) ?? []), etiquetaId]);
  return mapa;
}

async function garantirEtiquetasDaUnidade(db: Db, unidadeId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const achadas = await db
    .select({ id: etiquetas.id })
    .from(etiquetas)
    .where(and(eq(etiquetas.unidadeId, unidadeId), inArray(etiquetas.id, [...new Set(ids)])));
  if (achadas.length !== new Set(ids).size) throw new TRPCError({ code: "NOT_FOUND", message: "Etiqueta não encontrada." });
}

// Acha (sem diferenciar maiúsculas) ou cria as etiquetas pelo nome; devolve nome em minúsculas -> id.
async function etiquetasPorNome(db: Db, unidadeId: number, nomes: string[]): Promise<Map<string, number>> {
  const limpos = [...new Map(nomes.map((n) => n.trim()).filter(Boolean).map((n) => [n.toLowerCase(), n.slice(0, 40)])).values()];
  const mapa = new Map<string, number>();
  if (limpos.length === 0) return mapa;
  const existentes = await db.select({ id: etiquetas.id, nome: etiquetas.nome }).from(etiquetas).where(eq(etiquetas.unidadeId, unidadeId));
  for (const e of existentes) mapa.set(e.nome.toLowerCase(), e.id);
  const novas = limpos.filter((n) => !mapa.has(n.toLowerCase()));
  if (novas.length > 0) {
    const criadas = await db
      .insert(etiquetas)
      .values(novas.map((nome) => ({ unidadeId, nome })))
      .onConflictDoNothing()
      .returning({ id: etiquetas.id, nome: etiquetas.nome });
    for (const e of criadas) mapa.set(e.nome.toLowerCase(), e.id);
  }
  return mapa;
}

async function contatoDaUnidade(db: Db, unidadeId: number, id: number) {
  const [contato] = await db
    .select()
    .from(contatosUnidade)
    .where(and(eq(contatosUnidade.id, id), eq(contatosUnidade.unidadeId, unidadeId)));
  if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado." });
  return contato;
}

async function definirEtiquetas(db: Db, contatoId: number, etiquetaIds: number[]): Promise<void> {
  await db.delete(contatoEtiquetas).where(eq(contatoEtiquetas.contatoId, contatoId));
  if (etiquetaIds.length > 0) {
    await db
      .insert(contatoEtiquetas)
      .values([...new Set(etiquetaIds)].map((etiquetaId) => ({ contatoId, etiquetaId })))
      .onConflictDoNothing();
  }
}

export const contatosRouter = router({
  listar: procedimentoUnidade
    .input(z.object({ filtro: filtroContatosSchema, pagina: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const onde = and(...condicoes(ctx.unidadeId, input.filtro));
      const [linhas, contagem] = await Promise.all([
        ctx.db
          .select({
            id: contatosUnidade.id,
            telefone: contatosUnidade.telefone,
            nome: contatosUnidade.nome,
            email: contatosUnidade.email,
            origem: contatosUnidade.origem,
            criadoEm: contatosUnidade.createdAt,
            ultimaMensagemEm: ultimaMensagem(ctx.unidadeId),
            descadastrado: descadastrado(ctx.unidadeId),
            numeroId: sql<number | null>`(
              select ${q(respostasClientes.numeroId)} from ${respostasClientes}
              where ${q(respostasClientes.telefone)} = ${q(contatosUnidade.telefone)} and ${q(respostasClientes.numeroId)} in (
                select ${q(numerosWhatsapp.id)} from ${numerosWhatsapp} where ${q(numerosWhatsapp.unidadeId)} = ${ctx.unidadeId}
              )
              order by ${q(respostasClientes.recebidaEm)} desc limit 1
            )`,
          })
          .from(contatosUnidade)
          .where(onde)
          .orderBy(sql`${contatosUnidade.nome} is null`, asc(sql`lower(${contatosUnidade.nome})`), asc(contatosUnidade.telefone))
          .limit(CONTATOS_POR_PAGINA)
          .offset(input.pagina * CONTATOS_POR_PAGINA),
        contar(ctx.db, ctx.unidadeId, input.filtro),
      ]);
      const porContato = await etiquetasDosContatos(
        ctx.db,
        linhas.map((l) => l.id),
      );
      return {
        ...contagem,
        porPagina: CONTATOS_POR_PAGINA,
        itens: linhas.map((l) => ({
          ...l,
          criadoEm: l.criadoEm.toISOString(),
          ultimaMensagemEm: l.ultimaMensagemEm ? new Date(l.ultimaMensagemEm).toISOString() : null,
          etiquetaIds: porContato.get(l.id) ?? [],
        })),
      };
    }),

  contar: procedimentoUnidade.input(filtroContatosSchema).query(({ ctx, input }) => contar(ctx.db, ctx.unidadeId, input)),

  // Destinatários de uma campanha a partir de um filtro/segmento: sem quem pediu para não receber.
  paraCampanha: procedimentoUnidade.input(filtroContatosSchema).query(async ({ ctx, input }) => {
    const linhas = await ctx.db
      .select({ telefone: contatosUnidade.telefone, nome: contatosUnidade.nome })
      .from(contatosUnidade)
      .where(and(...condicoes(ctx.unidadeId, input), sql`not ${descadastrado(ctx.unidadeId)}`))
      .orderBy(asc(contatosUnidade.id))
      .limit(MAX_TELEFONES_POR_CAMPANHA + 1);
    return { contatos: linhas.slice(0, MAX_TELEFONES_POR_CAMPANHA), passouDoLimite: linhas.length > MAX_TELEFONES_POR_CAMPANHA };
  }),

  salvar: procedimentoUnidade.input(salvarContatoInputSchema).mutation(async ({ ctx, input }) => {
    await garantirEtiquetasDaUnidade(ctx.db, ctx.unidadeId, input.etiquetaIds);
    const dados = { telefone: input.telefone, nome: input.nome || null, email: input.email };
    let id: number;
    if (input.id) {
      await contatoDaUnidade(ctx.db, ctx.unidadeId, input.id);
      const [repetido] = await ctx.db
        .select({ id: contatosUnidade.id })
        .from(contatosUnidade)
        .where(and(eq(contatosUnidade.unidadeId, ctx.unidadeId), eq(contatosUnidade.telefone, input.telefone)));
      if (repetido && repetido.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "Já existe um contato com este telefone." });
      await ctx.db.update(contatosUnidade).set(dados).where(eq(contatosUnidade.id, input.id));
      id = input.id;
    } else {
      const [criado] = await ctx.db
        .insert(contatosUnidade)
        .values({ ...dados, unidadeId: ctx.unidadeId, origem: "manual" })
        .onConflictDoNothing()
        .returning({ id: contatosUnidade.id });
      if (!criado) throw new TRPCError({ code: "CONFLICT", message: "Já existe um contato com este telefone." });
      id = criado.id;
    }
    await definirEtiquetas(ctx.db, id, input.etiquetaIds);
    return { id };
  }),

  excluir: procedimentoUnidade.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    const apagados = await ctx.db
      .delete(contatosUnidade)
      .where(and(eq(contatosUnidade.unidadeId, ctx.unidadeId), inArray(contatosUnidade.id, input.ids)))
      .returning({ id: contatosUnidade.id });
    return { excluidos: apagados.length };
  }),

  // Planilha de alunos/leads: telefone obrigatório; nome, e-mail e etiquetas opcionais. Telefone que já
  // está na base é atualizado (e ganha as etiquetas novas, sem perder as que tinha).
  importar: procedimentoUnidade.input(importarContatosInputSchema).mutation(async ({ ctx, input }) => {
    const porTelefone = new Map<string, { telefone: string; nome: string | null; email: string | null; etiquetas: string[] }>();
    let invalidos = 0;
    for (const linha of input.linhas) {
      const telefone = normalizarTelefone(linha.telefone);
      if (!telefone) {
        invalidos += 1;
        continue;
      }
      const email = linha.email?.trim() && z.string().email().safeParse(linha.email.trim()).success ? linha.email.trim() : null;
      const anterior = porTelefone.get(telefone);
      porTelefone.set(telefone, {
        telefone,
        nome: linha.nome?.trim() || anterior?.nome || null,
        email: email ?? anterior?.email ?? null,
        etiquetas: [...(anterior?.etiquetas ?? []), ...(linha.etiquetas ?? [])],
      });
    }
    const linhas = [...porTelefone.values()];
    const mapaEtiquetas = await etiquetasPorNome(ctx.db, ctx.unidadeId, [...input.etiquetasParaTodos, ...linhas.flatMap((l) => l.etiquetas)]);
    const paraTodos = input.etiquetasParaTodos.map((n) => mapaEtiquetas.get(n.trim().toLowerCase())).filter((id): id is number => id !== undefined);

    let criados = 0;
    let atualizados = 0;
    for (let inicio = 0; inicio < linhas.length; inicio += 500) {
      const lote = linhas.slice(inicio, inicio + 500);
      const gravados = await ctx.db
        .insert(contatosUnidade)
        .values(lote.map((l) => ({ unidadeId: ctx.unidadeId, telefone: l.telefone, nome: l.nome, email: l.email, origem: "importacao" as const })))
        .onConflictDoUpdate({
          target: [contatosUnidade.unidadeId, contatosUnidade.telefone],
          set: {
            nome: input.atualizarNomes
              ? sql`coalesce(excluded.nome, ${contatosUnidade.nome})`
              : sql`coalesce(${contatosUnidade.nome}, excluded.nome)`,
            email: sql`coalesce(excluded.email, ${contatosUnidade.email})`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: contatosUnidade.id, telefone: contatosUnidade.telefone, novo: sql<boolean>`(xmax = 0)` });
      criados += gravados.filter((g) => g.novo).length;
      atualizados += gravados.filter((g) => !g.novo).length;

      const idPorTelefone = new Map(gravados.map((g) => [g.telefone, g.id]));
      const ligacoes = lote.flatMap((l) => {
        const contatoId = idPorTelefone.get(l.telefone)!;
        const ids = new Set([...paraTodos, ...l.etiquetas.map((n) => mapaEtiquetas.get(n.trim().toLowerCase())).filter((id): id is number => id !== undefined)]);
        return [...ids].map((etiquetaId) => ({ contatoId, etiquetaId }));
      });
      if (ligacoes.length > 0) await ctx.db.insert(contatoEtiquetas).values(ligacoes).onConflictDoNothing();
    }
    return { criados, atualizados, invalidos };
  }),

  etiquetar: procedimentoUnidade.input(etiquetarContatosInputSchema).mutation(async ({ ctx, input }) => {
    await garantirEtiquetasDaUnidade(ctx.db, ctx.unidadeId, [input.etiquetaId]);
    const daUnidade = await ctx.db
      .select({ id: contatosUnidade.id })
      .from(contatosUnidade)
      .where(and(eq(contatosUnidade.unidadeId, ctx.unidadeId), inArray(contatosUnidade.id, input.ids)));
    const ids = daUnidade.map((c) => c.id);
    if (ids.length === 0) return { alterados: 0 };
    if (input.acao === "adicionar") {
      await ctx.db
        .insert(contatoEtiquetas)
        .values(ids.map((contatoId) => ({ contatoId, etiquetaId: input.etiquetaId })))
        .onConflictDoNothing();
    } else {
      await ctx.db.delete(contatoEtiquetas).where(and(eq(contatoEtiquetas.etiquetaId, input.etiquetaId), inArray(contatoEtiquetas.contatoId, ids)));
    }
    return { alterados: ids.length };
  }),

  // Etiquetas no cabeçalho da conversa: o contato é criado na base se ainda não estiver lá.
  doTelefone: procedimentoUnidade.input(detalheConversaInputSchema).query(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const [contato] = await ctx.db
      .select({ id: contatosUnidade.id, nome: contatosUnidade.nome })
      .from(contatosUnidade)
      .where(and(eq(contatosUnidade.unidadeId, ctx.unidadeId), eq(contatosUnidade.telefone, input.telefone)));
    if (!contato) return { contatoId: null, etiquetaIds: [] as number[] };
    return { contatoId: contato.id, etiquetaIds: (await etiquetasDosContatos(ctx.db, [contato.id])).get(contato.id) ?? [] };
  }),

  etiquetasDoTelefone: procedimentoUnidade
    .input(detalheConversaInputSchema.extend({ etiquetaIds: z.array(z.number().int().positive()).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
      await garantirEtiquetasDaUnidade(ctx.db, ctx.unidadeId, input.etiquetaIds);
      const [contato] = await ctx.db
        .insert(contatosUnidade)
        .values({ unidadeId: ctx.unidadeId, telefone: input.telefone, origem: "conversa" })
        .onConflictDoUpdate({ target: [contatosUnidade.unidadeId, contatosUnidade.telefone], set: { updatedAt: sql`now()` } })
        .returning({ id: contatosUnidade.id });
      await definirEtiquetas(ctx.db, contato!.id, input.etiquetaIds);
      return { contatoId: contato!.id };
    }),

  etiquetas: procedimentoUnidade.query(async ({ ctx }) => {
    const linhas = await ctx.db
      .select({
        id: etiquetas.id,
        nome: etiquetas.nome,
        cor: etiquetas.cor,
        contatos: sql<number>`(select count(*) from ${contatoEtiquetas} where ${q(contatoEtiquetas.etiquetaId)} = ${q(etiquetas.id)})`,
      })
      .from(etiquetas)
      .where(eq(etiquetas.unidadeId, ctx.unidadeId))
      .orderBy(asc(sql`lower(${etiquetas.nome})`));
    return linhas.map((l) => ({ ...l, contatos: Number(l.contatos) }));
  }),

  salvarEtiqueta: procedimentoUnidade.input(salvarEtiquetaInputSchema).mutation(async ({ ctx, input }) => {
    const [repetida] = await ctx.db
      .select({ id: etiquetas.id })
      .from(etiquetas)
      .where(and(eq(etiquetas.unidadeId, ctx.unidadeId), sql`lower(${etiquetas.nome}) = ${input.nome.toLowerCase()}`));
    if (repetida && repetida.id !== input.id) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma etiqueta com esse nome." });
    if (input.id) {
      const [alterada] = await ctx.db
        .update(etiquetas)
        .set({ nome: input.nome, cor: input.cor })
        .where(and(eq(etiquetas.id, input.id), eq(etiquetas.unidadeId, ctx.unidadeId)))
        .returning({ id: etiquetas.id });
      if (!alterada) throw new TRPCError({ code: "NOT_FOUND", message: "Etiqueta não encontrada." });
      return alterada;
    }
    const [criada] = await ctx.db.insert(etiquetas).values({ unidadeId: ctx.unidadeId, nome: input.nome, cor: input.cor }).returning({ id: etiquetas.id });
    return criada!;
  }),

  excluirEtiqueta: procedimentoUnidade.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(etiquetas).where(and(eq(etiquetas.id, input.id), eq(etiquetas.unidadeId, ctx.unidadeId)));
    return { ok: true };
  }),

  segmentos: procedimentoUnidade.query(async ({ ctx }) => {
    const linhas = await ctx.db.select().from(segmentos).where(eq(segmentos.unidadeId, ctx.unidadeId)).orderBy(desc(segmentos.updatedAt));
    return Promise.all(
      linhas.map(async (s) => {
        const filtro = filtroContatosSchema.parse(s.filtro);
        return { id: s.id, nome: s.nome, filtro, ...(await contar(ctx.db, ctx.unidadeId, filtro)) };
      }),
    );
  }),

  salvarSegmento: procedimentoUnidade.input(salvarSegmentoInputSchema).mutation(async ({ ctx, input }) => {
    if (input.id) {
      const [alterado] = await ctx.db
        .update(segmentos)
        .set({ nome: input.nome, filtro: input.filtro })
        .where(and(eq(segmentos.id, input.id), eq(segmentos.unidadeId, ctx.unidadeId)))
        .returning({ id: segmentos.id });
      if (!alterado) throw new TRPCError({ code: "NOT_FOUND", message: "Segmento não encontrado." });
      return alterado;
    }
    const [criado] = await ctx.db.insert(segmentos).values({ unidadeId: ctx.unidadeId, nome: input.nome, filtro: input.filtro }).returning({ id: segmentos.id });
    return criado!;
  }),

  excluirSegmento: procedimentoUnidade.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(segmentos).where(and(eq(segmentos.id, input.id), eq(segmentos.unidadeId, ctx.unidadeId)));
    return { ok: true };
  }),
});
