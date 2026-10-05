// Sobe o Allp Chat no servidor (easypanel), num container só:
//   1. aplica as migrations pendentes no banco;
//   2. sobe a API (painel + webhook) e o worker lado a lado — os dois usam a mesma pasta uploads/.
// Se um dos dois cair, o outro é encerrado e o container sai com erro: o easypanel reinicia tudo junto,
// em vez de ficar meio no ar (por exemplo, API recebendo mensagens sem worker para enviar respostas).
// PROCESSOS escolhe o que sobe (padrão "api,worker"); útil para testar só a API.
import { spawn } from "node:child_process";

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
