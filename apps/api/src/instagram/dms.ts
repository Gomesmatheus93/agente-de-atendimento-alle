import {
  CHAVE_N8N_INSTAGRAM_URL,
  contasInstagram,
  conversasInstagram,
  enviarDmInstagram,
  ErroInstagram,
  mensagensInstagram,
  TAMANHO_MAX_DM,
  tokenDaContaInstagram,
  type Db,
} from "@atendimento-academias/db";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { lerValor } from "../config/plataforma.js";

// DMs do Instagram: enviar (pelo painel ou pelo bot) e avisar o n8n quando chega mensagem.
export const JANELA_DM_MS = 24 * 60 * 60 * 1000;

export async function conversaDaUnidade(db: Db, conversaId: number, unidadeId: number) {
  const [linha] = await db
    .select({ conversa: conversasInstagram, conta: contasInstagram })
    .from(conversasInstagram)
    .innerJoin(contasInstagram, eq(contasInstagram.id, conversasInstagram.contaId))
    .where(and(eq(conversasInstagram.id, conversaId), eq(contasInstagram.unidadeId, unidadeId)));
  if (!linha) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa do Instagram não encontrada." });
  return linha;
}

export function janelaAberta(ultimaDoClienteEm: Date | null): boolean {
  return Boolean(ultimaDoClienteEm && Date.now() - ultimaDoClienteEm.getTime() < JANELA_DM_MS);
}

// Grava a mensagem e envia na hora (a API do Instagram responde rápido; não precisa de fila). Falha fica
// gravada como "falhou", com o motivo, para a equipe reenviar.
export async function enviarDm(
  db: Db,
  conversaId: number,
  unidadeId: number,
  texto: string,
  origem: "equipe" | "bot",
  autorNome: string | null,
): Promise<{ id: number; enviada: boolean; erro: string | null }> {
  const { conversa, conta } = await conversaDaUnidade(db, conversaId, unidadeId);
  if (!janelaAberta(conversa.ultimaDoClienteEm)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passaram 24h desde a última mensagem desta pessoa: o Instagram só deixa responder depois que ela escrever de novo.",
    });
  }
  if (texto.length > TAMANHO_MAX_DM) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `O Instagram aceita até ${TAMANHO_MAX_DM} caracteres por mensagem.` });
  }
  const [mensagem] = await db
    .insert(mensagensInstagram)
    .values({ conversaId, origem, texto, statusEnvio: "pendente", autorNome })
    .returning({ id: mensagensInstagram.id });
  return tentarEnvio(db, mensagem!.id, conversa.igsid, texto, tokenDaContaInstagram(conta), conversaId);
}

async function tentarEnvio(db: Db, mensagemId: number, igsid: string, texto: string, token: string, conversaId: number) {
  try {
    const { mid } = await enviarDmInstagram(igsid, texto, token);
    await db.update(mensagensInstagram).set({ statusEnvio: "enviado", mid, erroDetalhe: null }).where(eq(mensagensInstagram.id, mensagemId));
    await db.update(conversasInstagram).set({ ultimaMensagemEm: new Date(), naoLidas: 0 }).where(eq(conversasInstagram.id, conversaId));
    return { id: mensagemId, enviada: true, erro: null };
  } catch (erro) {
    const motivo = (erro instanceof ErroInstagram ? erro.message : erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
    await db.update(mensagensInstagram).set({ statusEnvio: "falhou", erroDetalhe: motivo }).where(eq(mensagensInstagram.id, mensagemId));
    console.error(`[instagram-dm] falha ao enviar a mensagem ${mensagemId}:`, motivo);
    return { id: mensagemId, enviada: false, erro: motivo };
  }
}

export async function reenviarDm(db: Db, mensagemId: number, unidadeId: number) {
  const [mensagem] = await db.select().from(mensagensInstagram).where(eq(mensagensInstagram.id, mensagemId));
  if (!mensagem) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
  const { conversa, conta } = await conversaDaUnidade(db, mensagem.conversaId, unidadeId);
  if (mensagem.statusEnvio !== "falhou") throw new TRPCError({ code: "BAD_REQUEST", message: "Só dá para reenviar mensagem que falhou." });
  if (!janelaAberta(conversa.ultimaDoClienteEm)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A janela de 24h desta conversa se encerrou." });
  }
  await db.update(mensagensInstagram).set({ statusEnvio: "pendente" }).where(eq(mensagensInstagram.id, mensagemId));
  return tentarEnvio(db, mensagemId, conversa.igsid, mensagem.texto, tokenDaContaInstagram(conta), conversa.id);
}

// Mensagem nova do cliente com o bot ligado: avisa o fluxo do n8n das DMs (se a unidade tiver um).
export async function avisarN8nInstagram(
  db: Db,
  unidadeId: number,
  conversa: { id: number; iaAtiva: boolean; precisaHumano: boolean; nome: string | null; username: string | null },
  mensagem: { texto: string; midiaUrl: string | null; em: Date },
): Promise<void> {
  if (!conversa.iaAtiva || conversa.precisaHumano) return;
  const url = await lerValor(db, unidadeId, CHAVE_N8N_INSTAGRAM_URL);
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canal: "instagram",
        conversaId: conversa.id,
        unidadeId,
        nomeCliente: conversa.nome,
        username: conversa.username,
        mensagem: { texto: mensagem.texto, midiaUrl: mensagem.midiaUrl, recebidaEm: mensagem.em.toISOString() },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (erro) {
    console.error(`[instagram-dm] falha ao avisar o n8n da conversa ${conversa.id}:`, erro);
  }
}

export async function passarDmParaHumano(db: Db, conversaId: number, motivo: string): Promise<void> {
  await db
    .update(conversasInstagram)
    .set({ precisaHumano: true, motivoHumano: motivo.slice(0, 300), naoLidas: sql`greatest(${conversasInstagram.naoLidas}, 1)` })
    .where(eq(conversasInstagram.id, conversaId));
}
