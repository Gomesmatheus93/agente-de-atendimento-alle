import { createDbClient, sessoes, unidades, usuarios, type Db } from "@atendimento-academias/db";
import type * as trpcExpress from "@trpc/server/adapters/express";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, gt } from "drizzle-orm";

export const COOKIE_SESSAO = "sessao";

let dbSingleton: Db | undefined;

export function getDb(): Db {
  if (!dbSingleton) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL não configurada");
    }
    dbSingleton = createDbClient(databaseUrl);
  }
  return dbSingleton;
}

export interface UsuarioDaSessao {
  id: number;
  nome: string;
  email: string;
  papel: "superadmin" | "admin" | "membro";
  // Unidade em que a pessoa está trabalhando: a dela, ou a que o superadmin escolheu (null = nenhuma).
  unidadeId: number | null;
  unidadeNome: string | null;
  // Nome em negrito nas respostas pelo painel; null = ainda não escolheu (o chat pede antes de enviar).
  assinatura: string | null;
}

function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;

  for (const parte of cabecalho.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() === nome) return decodeURIComponent(parte.slice(separador + 1).trim());
  }
  return null;
}

const unidadeDaPessoa = alias(unidades, "unidade_da_pessoa");
const unidadeDaSessao = alias(unidades, "unidade_da_sessao");

// Sessão expirada não é apagada aqui: a limpeza sai mais barata em lote, e a consulta já a ignora.
async function usuarioDaRequisicao(db: Db, token: string | null): Promise<UsuarioDaSessao | null> {
  if (!token) return null;

  const [linha] = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: usuarios.papel,
      assinatura: usuarios.assinatura,
      propria: { id: unidadeDaPessoa.id, nome: unidadeDaPessoa.nome, ativo: unidadeDaPessoa.ativo },
      escolhida: { id: unidadeDaSessao.id, nome: unidadeDaSessao.nome },
    })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .leftJoin(unidadeDaPessoa, eq(unidadeDaPessoa.id, usuarios.unidadeId))
    .leftJoin(unidadeDaSessao, eq(unidadeDaSessao.id, sessoes.unidadeId))
    .where(and(eq(sessoes.token, token), gt(sessoes.expiraEm, new Date()), eq(usuarios.ativo, true)));
  if (!linha) return null;

  const base = {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel,
    assinatura: linha.assinatura,
  };
  // O superadmin não tem unidade própria: trabalha na que escolheu nesta sessão.
  if (linha.papel === "superadmin") {
    return { ...base, unidadeId: linha.escolhida?.id ?? null, unidadeNome: linha.escolhida?.nome ?? null };
  }
  // Unidade desativada pelo superadmin: a equipe dela perde o acesso.
  if (!linha.propria || !linha.propria.ativo) return null;
  return { ...base, unidadeId: linha.propria.id, unidadeNome: linha.propria.nome };
}

export function tokenDaSessao(cabecalhoCookie: string | undefined): string | null {
  return lerCookie(cabecalhoCookie, COOKIE_SESSAO);
}

// Usado também fora do tRPC (arquivos de /uploads), que exigem a mesma sessão.
export function usuarioDoCookie(cabecalhoCookie: string | undefined): Promise<UsuarioDaSessao | null> {
  return usuarioDaRequisicao(getDb(), lerCookie(cabecalhoCookie, COOKIE_SESSAO));
}

export async function createContext({ req, res }: trpcExpress.CreateExpressContextOptions) {
  const db = getDb();
  const usuario = await usuarioDoCookie(req.headers.cookie);

  return { req, res, db, usuario };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
