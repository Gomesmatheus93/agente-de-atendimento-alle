import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { conversasConfig } from "./schema/conversasConfig.js";
import { usuarios } from "./schema/usuarios.js";
import { doNumeroDaUnidade, unidadeDoNumero } from "./unidade.js";

// Fila de atendimento humano de uma unidade.
// - Esperando: conversa que precisa de humano (cliente pediu / bot não soube) e ainda não tem atendente.
// - Livre: funcionário da unidade que fez check-in (disponível) e não tem nenhum atendimento aberto.
// - Ocupado: tem pelo menos uma conversa com ele de atendente; fica fora da fila até encerrar.
// Cada cliente esperando vai para o funcionário livre que está há mais tempo sem receber ninguém.
// Usada pela API e pelo worker (o bot interno também passa conversas para humano).

export interface Atribuicao {
  telefone: string;
  numeroId: number;
  atendenteId: number;
}

// Chave do lock de transação: duas distribuições da mesma unidade ao mesmo tempo dariam o mesmo
// funcionário para dois clientes.
const LOCK_FILA = 7311;

export async function distribuirFila(db: Db, unidadeId: number): Promise<Atribuicao[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_FILA}, ${unidadeId})`);

    const esperando = await tx
      .select({ telefone: conversasConfig.telefone, numeroId: conversasConfig.numeroId })
      .from(conversasConfig)
      .where(
        and(
          eq(conversasConfig.precisaHumano, true),
          isNull(conversasConfig.atendenteId),
          doNumeroDaUnidade(conversasConfig.numeroId, unidadeId),
        ),
      )
      .orderBy(asc(sql`coalesce(${conversasConfig.humanoPedidoEm}, ${conversasConfig.updatedAt})`));
    if (esperando.length === 0) return [];

    const livres = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(
        and(
          eq(usuarios.unidadeId, unidadeId),
          eq(usuarios.ativo, true),
          eq(usuarios.disponivel, true),
          sql`not exists (select 1 from ${conversasConfig} where ${conversasConfig.atendenteId} = ${usuarios.id})`,
        ),
      )
      .orderBy(sql`${usuarios.ultimaAtribuicaoEm} asc nulls first`, asc(usuarios.disponivelDesde), asc(usuarios.id));

    const agora = new Date();
    const atribuicoes: Atribuicao[] = [];
    for (let indice = 0; indice < Math.min(esperando.length, livres.length); indice += 1) {
      const conversa = esperando[indice]!;
      const atendenteId = livres[indice]!.id;
      await tx
        .update(conversasConfig)
        .set({ atendenteId, atendimentoDesde: agora })
        .where(and(eq(conversasConfig.numeroId, conversa.numeroId), eq(conversasConfig.telefone, conversa.telefone)));
      await tx.update(usuarios).set({ ultimaAtribuicaoEm: agora }).where(eq(usuarios.id, atendenteId));
      atribuicoes.push({ ...conversa, atendenteId });
    }
    return atribuicoes;
  });
}

export async function distribuirFilaDoNumero(db: Db, numeroId: number): Promise<Atribuicao[]> {
  const unidadeId = await unidadeDoNumero(db, numeroId);
  return unidadeId === null ? [] : distribuirFila(db, unidadeId);
}

// Funcionário respondeu à mão uma conversa sem atendente: ela passa a ser dele (e ele fica ocupado), e o
// bot para de responder enquanto o atendimento estiver aberto. Conversa de outro atendente continua dele.
export async function assumirAtendimento(db: Db, telefone: string, numeroId: number, usuarioId: number): Promise<void> {
  await db
    .insert(conversasConfig)
    .values({ telefone, numeroId, atendenteId: usuarioId, atendimentoDesde: new Date() })
    .onConflictDoUpdate({
      target: [conversasConfig.numeroId, conversasConfig.telefone],
      set: { atendenteId: usuarioId, atendimentoDesde: new Date() },
      setWhere: isNull(conversasConfig.atendenteId),
    });
}

// "Encerrar atendimento": a conversa volta para o bot e o funcionário fica livre para o próximo da fila.
export async function encerrarAtendimento(db: Db, telefone: string, numeroId: number): Promise<void> {
  await db
    .update(conversasConfig)
    .set({ precisaHumano: false, motivoHumano: null, humanoPedidoEm: null, atendenteId: null, atendimentoDesde: null })
    .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
  await distribuirFilaDoNumero(db, numeroId);
}

// Tira a conversa do atendente atual e devolve para a fila (o funcionário precisou sair, por exemplo).
// Mantém o horário do pedido original: o cliente não perde a vez.
export async function devolverParaFila(db: Db, telefone: string, numeroId: number): Promise<void> {
  await db
    .update(conversasConfig)
    .set({
      precisaHumano: true,
      humanoPedidoEm: sql`coalesce(${conversasConfig.humanoPedidoEm}, now())`,
      atendenteId: null,
      atendimentoDesde: null,
    })
    .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
  await distribuirFilaDoNumero(db, numeroId);
}

// Funcionário desativado ou removido: os clientes dele voltam para a fila em vez de ficarem sem ninguém.
export async function devolverAtendimentosDe(db: Db, usuarioId: number, unidadeId: number): Promise<void> {
  await db
    .update(conversasConfig)
    .set({
      precisaHumano: true,
      humanoPedidoEm: sql`coalesce(${conversasConfig.humanoPedidoEm}, now())`,
      atendenteId: null,
      atendimentoDesde: null,
    })
    .where(eq(conversasConfig.atendenteId, usuarioId));
  await distribuirFila(db, unidadeId);
}
