import { createDbClient, sessoes, usuarios, type Db } from "@atendimento-academias/db";
import type * as trpcExpress from "@trpc/server/adapters/express";
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
  papel: "admin" | "membro";
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

// Sessão expirada não é apagada aqui: a limpeza sai mais barata em lote, e a consulta já a ignora.
async function usuarioDaRequisicao(db: Db, token: string | null): Promise<UsuarioDaSessao | null> {
  if (!token) return null;

  const [linha] = await db
    .select({ id: usuarios.id, nome: usuarios.nome, email: usuarios.email, papel: usuarios.papel })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.token, token), gt(sessoes.expiraEm, new Date()), eq(usuarios.ativo, true)));

  return linha ?? null;
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
