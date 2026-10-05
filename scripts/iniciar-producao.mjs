// Sobe o Allp Chat no servidor (easypanel), num container só:
//   1. aplica as migrations pendentes no banco;
//   2. sobe a API (painel + webhook) e o worker lado a lado — os dois usam a mesma pasta uploads/.
// Se um dos dois cair, o outro é encerrado e o container sai com erro: o easypanel reinicia tudo junto,
// em vez de ficar meio no ar (por exemplo, API recebendo mensagens sem worker para enviar respostas).
// PROCESSOS escolhe o que sobe (padrão "api,worker"); útil para testar só a API.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const processos = (process.env.PROCESSOS ?? "api,worker").split(",").map((nome) => nome.trim()).filter(Boolean);
const filhos = new Map();
let encerrando = false;

function rodar(nome, args) {
  const filho = spawn("pnpm", args, { stdio: "inherit", env: process.env });
  filhos.set(nome, filho);
  return filho;
}

function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of filhos.values()) filho.kill("SIGTERM");
  setTimeout(() => process.exit(codigo), 5000).unref();
}

for (const sinal of ["SIGTERM", "SIGINT"]) process.on(sinal, () => encerrar(0));

// Antes de tudo, confere a configuração e a conexão com o banco e diz no log o que está errado — o
// drizzle-kit, quando não conecta, só sai com código 1, sem explicar.
const faltando = ["DATABASE_URL", "REDIS_URL", "CHAVE_CRIPTOGRAFIA"].filter((nome) => !process.env[nome]?.trim());
if (faltando.length > 0) {
  console.error(`[iniciar] faltam variáveis de ambiente: ${faltando.join(", ")}. Cadastre em Environment e reimplante.`);
  process.exit(1);
}

const urlBanco = process.env.DATABASE_URL.trim();
const hostBanco = urlBanco.replace(/^[^@]*@/, "").replace(/[/?].*$/, "");
console.log(`[iniciar] testando o banco em ${hostBanco}...`);
try {
  // "postgres" é dependência do pacote db; o require parte de lá para achar o módulo.
  const postgres = createRequire(new URL("../packages/db/package.json", import.meta.url))("postgres");
  const sql = postgres(urlBanco, { max: 1, connect_timeout: 15 });
  await sql`select 1`;
  await sql.end();
  console.log("[iniciar] banco ok.");
} catch (erro) {
  const motivo = erro instanceof Error ? `${erro.code ?? ""} ${erro.message}`.trim() : String(erro);
  console.error(`[iniciar] não foi possível conectar ao banco (${hostBanco}): ${motivo}`);
  if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/.test(motivo) && hostBanco.startsWith("db.") && hostBanco.includes("supabase.co")) {
    console.error("[iniciar] Essa é a conexão direta do Supabase, que só funciona com IPv6. No servidor, use a do Session pooler (Supabase → Connect → Session pooler; o endereço tem pooler.supabase.com).");
  }
  if (/password authentication failed/i.test(motivo)) console.error("[iniciar] A senha na DATABASE_URL está errada (troque [YOUR-PASSWORD] pela senha do banco).");
  process.exit(1);
}

const migracao = rodar("migrations", ["--filter", "@atendimento-academias/db", "migrate"]);
migracao.on("exit", (codigo) => {
  filhos.delete("migrations");
  if (codigo !== 0) {
    console.error(`[iniciar] migrations falharam (código ${codigo}); nada foi iniciado.`);
    process.exit(codigo ?? 1);
  }
  for (const nome of processos) {
    const filho = rodar(nome, ["--filter", `@atendimento-academias/${nome}`, "exec", "tsx", "src/index.ts"]);
    filho.on("exit", (codigoFilho) => {
      if (encerrando) return;
      console.error(`[iniciar] ${nome} parou (código ${codigoFilho}); encerrando o container para reiniciar tudo.`);
      encerrar(codigoFilho || 1);
    });
  }
});
