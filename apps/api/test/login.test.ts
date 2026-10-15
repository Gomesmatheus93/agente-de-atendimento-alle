import { sessoes, usuarios } from "@atendimento-academias/db";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { limiteDoBot } from "../src/limites.js";
import { usuarioDoCookie } from "../src/trpc/context.js";
import { como, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Entrar, sessão (só o hash fica no banco), bloqueio por tentativas erradas e o freio do bot.

let unidade: UnidadeDeTeste;
const SENHA = "senha-de-teste-123";

beforeAll(async () => {
  await zerarBanco();
  unidade = await criarUnidade();
});

function tokenDoCookie(cabecalhos: string[]): string {
  const cookie = cabecalhos.find((c) => c.startsWith("sessao="))!;
  return cookie.split(";")[0]!.split("=")[1]!;
}

describe("login e sessão", () => {
  it("entra com a senha certa e o cookie sai HttpOnly", async () => {
    const { api, cabecalhos } = como(null, { ip: "10.9.0.1" });
    await api.auth.entrar({ email: unidade.admin.email, senha: SENHA });
    const cookie = cabecalhos.find((c) => c.startsWith("sessao="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("o banco guarda só o hash do token, e o hash não serve como cookie", async () => {
    const { api, cabecalhos } = como(null, { ip: "10.9.0.2" });
    await api.auth.entrar({ email: unidade.membro.email, senha: SENHA });
    const token = tokenDoCookie(cabecalhos);
    const [sessao] = await db.select().from(sessoes).where(eq(sessoes.usuarioId, unidade.membro.id));
    expect(sessao!.token).not.toBe(token);
    expect(sessao!.token).toBe(createHash("sha256").update(token).digest("hex"));
    expect((await usuarioDoCookie(`sessao=${token}`))?.email).toBe(unidade.membro.email);
    expect(await usuarioDoCookie(`sessao=${sessao!.token}`)).toBeNull();
  });

  it("senha errada e e-mail inexistente dão a mesma resposta", async () => {
    await expect(como(null, { ip: "10.9.0.3" }).api.auth.entrar({ email: unidade.admin.email, senha: "nao-e-essa-123" })).rejects.toThrow("E-mail ou senha incorretos.");
    await expect(como(null, { ip: "10.9.0.3" }).api.auth.entrar({ email: "ninguem@teste.local", senha: "nao-e-essa-123" })).rejects.toThrow("E-mail ou senha incorretos.");
  });

  it("bloqueia depois de 5 senhas erradas, mesmo com a senha certa", async () => {
    const ip = "10.9.0.4";
    for (let i = 0; i < 5; i++) await expect(como(null, { ip }).api.auth.entrar({ email: unidade.admin.email, senha: "errada-123456" })).rejects.toThrow();
    await expect(como(null, { ip }).api.auth.entrar({ email: unidade.admin.email, senha: SENHA })).rejects.toThrow(/Muitas tentativas/);
    // De outro IP a conta continua acessível (o bloqueio é por IP + e-mail).
    await expect(como(null, { ip: "10.9.0.5" }).api.auth.entrar({ email: unidade.admin.email, senha: SENHA })).resolves.toBeTruthy();
  });

  it("usuário desativado perde a sessão na hora", async () => {
    const { api, cabecalhos } = como(null, { ip: "10.9.0.6" });
    await api.auth.entrar({ email: unidade.membro.email, senha: SENHA });
    const token = tokenDoCookie(cabecalhos);
    await como(unidade.admin).api.usuarios.atualizar({ id: unidade.membro.id, ativo: false });
    expect(await usuarioDoCookie(`sessao=${token}`)).toBeNull();
    await db.update(usuarios).set({ ativo: true }).where(eq(usuarios.id, unidade.membro.id));
  });

  it("sair apaga a sessão", async () => {
    const { api, cabecalhos } = como(null, { ip: "10.9.0.7" });
    await api.auth.entrar({ email: unidade.admin.email, senha: SENHA });
    const token = tokenDoCookie(cabecalhos);
    await como(unidade.admin, { cookie: `sessao=${token}` }).api.auth.sair();
    expect(await usuarioDoCookie(`sessao=${token}`)).toBeNull();
  });
});

describe("freio do bot por cliente", () => {
  it("passa de 8 mensagens no minuto: para de acionar o bot", async () => {
    const resultados = [];
    for (let i = 0; i < 10; i++) resultados.push(await limiteDoBot("teste:cliente-rapido"));
    expect(resultados.slice(0, 8).every((r) => r === "ok")).toBe(true);
    expect(resultados.slice(8)).toEqual(["minuto", "minuto"]);
  });
});
