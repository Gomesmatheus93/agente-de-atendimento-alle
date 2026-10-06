import { contatos, conversasConfig, distribuirFila, doNumeroDaUnidade, usuarios } from "@atendimento-academias/db";
import { definirDisponivelInputSchema } from "@atendimento-academias/shared";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { procedimentoUnidade, router } from "../trpc.js";

// Fila de atendimento humano da unidade (regras em packages/db/src/fila.ts).
export const filaRouter = router({
  // Check-in / check-out do próprio funcionário. Ao ficar disponível, já recebe quem estiver esperando.
  definirDisponivel: procedimentoUnidade.input(definirDisponivelInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(usuarios)
      .set({ disponivel: input.disponivel, disponivelDesde: input.disponivel ? new Date() : null })
      .where(and(eq(usuarios.id, ctx.usuario.id), eq(usuarios.unidadeId, ctx.unidadeId)));
    if (input.disponivel) await distribuirFila(ctx.db, ctx.unidadeId);
    return { disponivel: input.disponivel };
  }),

  // A situação de cada pessoa da equipe (disponível, ocupada com quem, ausente), na ordem em que a fila
  // vai chamar, e os clientes que estão esperando alguém ficar livre.
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const [equipe, conversas] = await Promise.all([
      ctx.db
        .select({
          id: usuarios.id,
          nome: usuarios.nome,
          disponivel: usuarios.disponivel,
          disponivelDesde: usuarios.disponivelDesde,
          ultimaAtribuicaoEm: usuarios.ultimaAtribuicaoEm,
        })
        .from(usuarios)
        .where(and(eq(usuarios.unidadeId, ctx.unidadeId), eq(usuarios.ativo, true)))
        .orderBy(asc(usuarios.nome)),
      ctx.db
        .select({
          telefone: conversasConfig.telefone,
          numeroId: conversasConfig.numeroId,
          atendenteId: conversasConfig.atendenteId,
          atendimentoDesde: conversasConfig.atendimentoDesde,
          motivo: conversasConfig.motivoHumano,
          pedidoEm: conversasConfig.humanoPedidoEm,
          atualizadoEm: conversasConfig.updatedAt,
        })
        .from(conversasConfig)
        .where(
          and(
            doNumeroDaUnidade(conversasConfig.numeroId, ctx.unidadeId),
            or(isNotNull(conversasConfig.atendenteId), eq(conversasConfig.precisaHumano, true)),
          ),
        ),
    ]);

    const telefones = [...new Set(conversas.map((conversa) => conversa.telefone))];
    const nomes = telefones.length
      ? await ctx.db.select({ telefone: contatos.telefone, nome: contatos.nomePerfil }).from(contatos).where(inArray(contatos.telefone, telefones))
      : [];
    const nomePorTelefone = new Map(nomes.map((linha) => [linha.telefone, linha.nome?.trim() || null]));
    const cliente = (conversa: (typeof conversas)[number]) => ({
      telefone: conversa.telefone,
      numeroId: conversa.numeroId,
      nome: nomePorTelefone.get(conversa.telefone) ?? null,
      motivo: conversa.motivo,
    });

    const atendentes = equipe.map((pessoa) => {
      const atendendo = conversas
        .filter((conversa) => conversa.atendenteId === pessoa.id)
        .map((conversa) => ({ ...cliente(conversa), desde: conversa.atendimentoDesde?.toISOString() ?? null }));
      return {
        id: pessoa.id,
        nome: pessoa.nome,
        souEu: pessoa.id === ctx.usuario.id,
        situacao: atendendo.length > 0 ? ("ocupado" as const) : pessoa.disponivel ? ("disponivel" as const) : ("ausente" as const),
        disponivelDesde: pessoa.disponivelDesde?.toISOString() ?? null,
        ultimaAtribuicaoEm: pessoa.ultimaAtribuicaoEm?.getTime() ?? null,
        atendendo,
      };
    });

    // Mesma ordem que a fila usa para escolher o próximo (packages/db/src/fila.ts).
    const proximos = atendentes
      .filter((pessoa) => pessoa.situacao === "disponivel")
      .sort(
        (a, b) =>
          (a.ultimaAtribuicaoEm ?? -Infinity) - (b.ultimaAtribuicaoEm ?? -Infinity) ||
          (a.disponivelDesde ?? "").localeCompare(b.disponivelDesde ?? ""),
      )
      .map((pessoa) => pessoa.id);

    const esperando = conversas
      .filter((conversa) => conversa.atendenteId === null)
      .map((conversa) => ({ ...cliente(conversa), desde: (conversa.pedidoEm ?? conversa.atualizadoEm).toISOString() }))
      .sort((a, b) => a.desde.localeCompare(b.desde));

    return {
      atendentes: atendentes.map(({ ultimaAtribuicaoEm: _ultima, ...pessoa }) => ({
        ...pessoa,
        posicaoNaFila: pessoa.situacao === "disponivel" ? proximos.indexOf(pessoa.id) + 1 : null,
      })),
      esperando,
    };
  }),
});
