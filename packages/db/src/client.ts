import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDbClient>;

// Postgres (Supabase). A conexão direta do Supabase aceita até ~60 conexões no plano gratuito, divididas
// entre API, worker e scripts: 10 por processo sobra.
export function createDbClient(databaseUrl: string) {
  const cliente = postgres(databaseUrl, { max: 10, connect_timeout: 15 });
  return drizzle(cliente, { schema });
}
