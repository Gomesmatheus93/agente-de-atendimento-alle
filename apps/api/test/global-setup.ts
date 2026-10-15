import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const BANCO = process.env.TEST_DATABASE_URL ?? "postgresql://teste:teste@127.0.0.1:55432/allpchat_teste";

// Antes de tudo: banco zerado com todas as migrações do projeto aplicadas.
export default async function prepararBanco(): Promise<void> {
  const host = new URL(BANCO).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Os testes apagam o banco inteiro: só rodam num banco local (veio ${host}).`);
  }
  const sql = postgres(BANCO, { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
  } catch {
    await sql.end();
    throw new Error("Banco de teste fora do ar. Rode antes: pnpm test:infra");
  }
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  const pasta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations");
  await migrate(drizzle(sql), { migrationsFolder: pasta });
  await sql.end();
}
