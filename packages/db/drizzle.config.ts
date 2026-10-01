import { defineConfig } from "drizzle-kit";

try {
  // Um .env só, na raiz do projeto, para todos os programas (ver .env.example).
  process.loadEnvFile("../../.env");
} catch {
  // sem .env local: usa só as variáveis já presentes no ambiente
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
  },
});
