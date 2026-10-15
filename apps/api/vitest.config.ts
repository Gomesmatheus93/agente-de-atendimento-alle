import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes automáticos: rodam contra um Postgres e um Redis locais (scripts/testes-infra.sh), nunca contra
// o banco de produção — o global-setup recusa qualquer endereço que não seja desta máquina.
const BANCO = process.env.TEST_DATABASE_URL ?? "postgresql://teste:teste@127.0.0.1:55432/allpchat_teste";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Um banco só para todos os arquivos: um de cada vez.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: BANCO,
      REDIS_URL: REDIS,
      // Chave de teste (32 bytes em base64); nada cifrado aqui vale fora dos testes.
      CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 7).toString("base64"),
      UPLOADS_DIR: path.join(tmpdir(), "allpchat-testes-uploads"),
      S3_BUCKET: "",
      INSTAGRAM_APP_SECRET: "segredo-instagram-teste",
      INSTAGRAM_APP_ID: "",
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "token-verificacao-teste",
      ANTHROPIC_API_KEY: "",
      SAUDE_MONITOR: "0",
    },
  },
});
