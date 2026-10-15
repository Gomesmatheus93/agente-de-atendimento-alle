import { createHash } from "node:crypto";
import { createDbClient, sessoes, unidades, usuarios, type Db } from "@atendimento-academias/db";
import type * as trpcExpress from "@trpc/server/adapters/express";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, gt } from "drizzle-orm";

export const COOKIE_SESSAO = "sessao";
export const DURACAO_SESSAO_MS = 30 * 86_400_000;
// Sessão em uso com menos que isto de validade ganha mais 30 dias (quem usa todo dia não é deslogado).
const RENOVAR_ABAIXO_DE_MS = 7 * 86_400_000;

// O cookie de sessão é aleatório (256 bits); no banco fica só o hash dele. Quem ler a tabela sessoes (um
// backup, um acesso indevido ao banco) não consegue entrar como ninguém.
export function hashDaSessao(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// No servidor o painel é https: o cookie só viaja criptografado. Em desenvolvimento é http, então sem Secure.
export const ATRIBUTOS_COOKIE = `HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export function cookieDeSessao(token: string): string {
  return `${COOKIE_SESSAO}=${token}; ${ATRIBUTOS_COOKIE}; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`;
}

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
async function usuarioDaRequisicao(db: Db, token: string | null): Promise<(UsuarioDaSessao & { expiraEm: Date }) | null> {
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
      expiraEm: sessoes.expiraEm,
    })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .leftJoin(unidadeDaPessoa, eq(unidadeDaPessoa.id, usuarios.unidadeId))
    .leftJoin(unidadeDaSessao, eq(unidadeDaSessao.id, sessoes.unidadeId))
    .where(and(eq(sessoes.token, hashDaSessao(token)), gt(sessoes.expiraEm, new Date()), eq(usuarios.ativo, true)));
  if (!linha) return null;

  const base = {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    papel: linha.papel,
    assinatura: linha.assinatura,
    expiraEm: linha.expiraEm,
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
export async function usuarioDoCookie(cabecalhoCookie: string | undefined): Promise<UsuarioDaSessao | null> {
  const encontrado = await usuarioDaRequisicao(getDb(), lerCookie(cabecalhoCookie, COOKIE_SESSAO));
  if (!encontrado) return null;
  const { expiraEm: _expiraEm, ...usuario } = encontrado;
  return usuario;
}

export async function createContext({ req, res }: trpcExpress.CreateExpressContextOptions) {
  const db = getDb();
  const token = lerCookie(req.headers.cookie, COOKIE_SESSAO);
  const encontrado = await usuarioDaRequisicao(db, token);
  let usuario: UsuarioDaSessao | null = null;
  if (encontrado && token) {
    const { expiraEm, ...resto } = encontrado;
    usuario = resto;
    if (expiraEm.getTime() - Date.now() < RENOVAR_ABAIXO_DE_MS) {
      await db
        .update(sessoes)
        .set({ expiraEm: new Date(Date.now() + DURACAO_SESSAO_MS) })
        .where(eq(sessoes.token, hashDaSessao(token)));
      res.appendHeader("Set-Cookie", cookieDeSessao(token));
    }
  }

  return { req, res, db, usuario };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
