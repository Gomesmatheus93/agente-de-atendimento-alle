import { randomBytes } from "node:crypto";
import {
  campanhasDisparo,
  CHAVE_WEBHOOK_APP_SECRET,
  cifrar,
  contasWhatsapp,
  disparoDestinatarios,
  gerarHashDeSenha,
  numerosWhatsapp,
  respostasClientes,
  templatesWhatsapp,
  unidades,
  usuarios,
} from "@atendimento-academias/db";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { vi } from "vitest";
import { salvarValor } from "../src/config/plataforma.js";
import { getDb, type UsuarioDaSessao } from "../src/trpc/context.js";
import { appRouter } from "../src/trpc/router.js";

// Peças comuns dos testes: banco zerado, unidade pronta (conta, número, admin e membro), chamadas ao tRPC
// como um usuário, e a internet trocada por respostas simuladas.

export const db = getDb();

// Apaga os dados entre arquivos de teste (a estrutura fica). Sem reiniciar os ids: os caches da API são por
// id, e um id repetido entre testes poderia achar um valor antigo.
export async function zerarBanco(): Promise<void> {
  const tabelas = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  await db.execute(sql.raw(`truncate ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} cascade`));
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  redis.disconnect();
}

const unico = () => randomBytes(4).toString("hex");

export interface UnidadeDeTeste {
  id: number;
  numeroId: number;
  phoneNumberId: string;
  wabaId: string;
  segredoApp: string;
  admin: UsuarioDaSessao;
  membro: UsuarioDaSessao;
}

export async function criarUnidade(nome = `Unidade ${unico()}`): Promise<UnidadeDeTeste> {
  const [unidade] = await db.insert(unidades).values({ nome }).returning();
  const wabaId = `waba-${unico()}`;
  const phoneNumberId = `pn-${unico()}`;
  const [conta] = await db
    .insert(contasWhatsapp)
    .values({ unidadeId: unidade!.id, nome: `Conta ${nome}`, wabaId, tokenCifrado: cifrar("token-de-teste"), tokenFinal: "este" })
    .returning();
  const [numero] = await db
    .insert(numerosWhatsapp)
    .values({ contaId: conta!.id, unidadeId: unidade!.id, phoneNumberId, numeroExibicao: "+55 11 0000-0000", ativo: true })
    .returning();
  const segredoApp = `segredo-${unico()}`;
  await salvarValor(db, unidade!.id, CHAVE_WEBHOOK_APP_SECRET, segredoApp, true);

  const senhaHash = await gerarHashDeSenha("senha-de-teste-123");
  const pessoa = async (papel: "admin" | "membro"): Promise<UsuarioDaSessao> => {
    const email = `${papel}-${unico()}@teste.local`;
    const [linha] = await db.insert(usuarios).values({ nome: `${papel} ${nome}`, email, senhaHash, papel, unidadeId: unidade!.id }).returning();
    return { id: linha!.id, nome: linha!.nome, email, papel, unidadeId: unidade!.id, unidadeNome: nome, assinatura: papel === "admin" ? "Ana" : "Beto" };
  };
  return { id: unidade!.id, numeroId: numero!.id, phoneNumberId, wabaId, segredoApp, admin: await pessoa("admin"), membro: await pessoa("membro") };
}

export async function criarSuperadmin(unidadeId: number | null = null): Promise<UsuarioDaSessao> {
  const email = `super-${unico()}@teste.local`;
  const [linha] = await db.insert(usuarios).values({ nome: "Super", email, senhaHash: await gerarHashDeSenha("senha-de-teste-123"), papel: "superadmin" }).returning();
  return { id: linha!.id, nome: "Super", email, papel: "superadmin", unidadeId, unidadeNome: null, assinatura: "Super" };
}

// Chamada ao tRPC como se viesse do painel. "cabecalhos" guarda os Set-Cookie que a API devolveu.
export function como(usuario: UsuarioDaSessao | null, opcoes: { ip?: string; cookie?: string } = {}) {
  const cabecalhos: string[] = [];
  const req = { ip: opcoes.ip ?? "10.1.1.1", headers: { cookie: opcoes.cookie } };
  const res = { appendHeader: (_nome: string, valor: string) => cabecalhos.push(valor), setHeader: () => undefined };
  return { api: appRouter.createCaller({ req: req as never, res: res as never, db, usuario }), cabecalhos };
}

// Cliente que recebeu um disparo da unidade (só assim a conversa entra no painel) e, opcionalmente, já escreveu.
export async function clienteComConversa(unidade: UnidadeDeTeste, telefone: string, escreveuHaMs: number | null = 60_000) {
  const [template] = await db.insert(templatesWhatsapp).values({ unidadeId: unidade.id, nome: `t_${unico()}`, conteudo: "Oi {{nome}}" } as never).returning();
  const [campanha] = await db
    .insert(campanhasDisparo)
    .values({ unidadeId: unidade.id, nome: "Campanha teste", templateId: template!.id, numeroId: unidade.numeroId, status: "concluida" } as never)
    .returning();
  const [destinatario] = await db
    .insert(disparoDestinatarios)
    .values({ campanhaId: campanha!.id, telefone, parametros: { nome: "Cliente" }, statusEnvio: "enviado", enviadoEm: new Date(Date.now() - 3_600_000) })
    .returning();
  if (escreveuHaMs !== null) {
    await db.insert(respostasClientes).values({
      mensagemExternaId: `wamid.${unico()}`,
      telefone,
      numeroId: unidade.numeroId,
      campanhaId: campanha!.id,
      destinatarioId: destinatario!.id,
      tipo: "texto",
      texto: "Oi, quero saber dos planos",
      recebidaEm: new Date(Date.now() - escreveuHaMs),
    });
  }
  return { campanhaId: campanha!.id, templateId: template!.id };
}

// Toda chamada para fora (Meta, n8n, EVO, Instagram) passa por aqui; o servidor de teste local segue normal.
export function simularInternet(responder: (url: string, init?: RequestInit) => Response | Promise<Response> = () => Response.json({})) {
  const original = globalThis.fetch;
  const chamadas: Array<{ url: string; corpo: unknown }> = [];
  const falso = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    if (url.startsWith("http://127.0.0.1")) return original(entrada, init);
    let corpo: unknown = init?.body;
    try {
      corpo = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    } catch {
      // corpo que não é JSON fica como veio
    }
    chamadas.push({ url, corpo });
    return responder(url, init);
  });
  vi.stubGlobal("fetch", falso);
  return { chamadas, original };
}
