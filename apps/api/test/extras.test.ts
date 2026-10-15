import { beforeAll, describe, expect, it } from "vitest";
import { campanhasDisparo, contatosUnidade, conversasConfig, descadastrar, disparoDestinatarios, followupsEnviados, mensagensSaida } from "@atendimento-academias/db";
import { lerDataDeNascimento } from "@atendimento-academias/shared";
import { and, eq } from "drizzle-orm";
import { agoraEmBrasilia, rodarAniversario, rodarFollowup } from "../src/automacoes/automacoes.js";
import { clienteComConversa, como, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Extras: mensagem de aniversário e follow-up.

beforeAll(async () => {
  await zerarBanco();
});

describe("data de nascimento da planilha", () => {
  it.each([
    ["15/03/1990", "1990-03-15"],
    ["5/3/90", "1990-03-05"],
    ["15/03", "2000-03-15"],
    ["1990-03-15", "1990-03-15"],
    ["29/02/2000", "2000-02-29"],
  ])("'%s' → %s", (entrada, esperado) => expect(lerDataDeNascimento(entrada)).toBe(esperado));
  it.each(["31/02/1990", "abc", "", "15/13/1990"])("'%s' é inválida", (entrada) => expect(lerDataDeNascimento(entrada)).toBeNull());
});

describe("mensagem de aniversário", () => {
  let aniv: UnidadeDeTeste;
  let templateId: number;
  // Meio-dia em Brasília, num dia fixo.
  const AGORA = new Date("2027-06-10T15:00:00Z");

  beforeAll(async () => {
    aniv = await criarUnidade();
    ({ templateId } = await clienteComConversa(aniv, "5511966660000", null));
    const api = como(aniv.admin).api;
    await api.contatos.salvar({ telefone: "11966660001", nome: "Ana Souza", email: null, nascimento: "10/06/1990", etiquetaIds: [] });
    await api.contatos.salvar({ telefone: "11966660002", nome: "Bia", email: null, nascimento: "11/06/1991", etiquetaIds: [] });
    await api.contatos.salvar({ telefone: "11966660003", nome: "Caio", email: null, nascimento: "10/06/1985", etiquetaIds: [] });
    await descadastrar(db, aniv.id, "5511966660003", "cliente");
  });

  it("só o admin configura, e o template precisa ser da unidade", async () => {
    const config = { ativo: true, templateId, numeroId: aniv.numeroId, hora: 9, parametros: { nome: { tipo: "nome" as const } } };
    await expect(como(aniv.membro).api.automacoes.salvarAniversario(config)).rejects.toThrow(/administrador/);
    await expect(como(aniv.admin).api.automacoes.salvarAniversario({ ...config, parametros: {} })).rejects.toThrow(/Preencha/);
    const outra = await criarUnidade();
    await expect(como(outra.admin).api.automacoes.salvarAniversario({ ...config, numeroId: outra.numeroId })).rejects.toThrow(/template/);
    await como(aniv.admin).api.automacoes.salvarAniversario(config);
  });

  it("antes da hora escolhida, não sai", async () => {
    expect(await rodarAniversario(db, aniv.id, new Date("2027-06-10T10:00:00Z"))).toBeNull(); // 7h em Brasília
  });

  it("sai uma campanha só com os aniversariantes do dia (sem quem pediu para sair), com o primeiro nome", async () => {
    expect(agoraEmBrasilia(AGORA)).toMatchObject({ dia: "2027-06-10", hora: 12 });
    expect(await rodarAniversario(db, aniv.id, AGORA)).toEqual({ enviados: 1 });
    const [campanha] = await db.select().from(campanhasDisparo).where(and(eq(campanhasDisparo.unidadeId, aniv.id), eq(campanhasDisparo.nome, "Aniversariantes 10/06")));
    const destinatarios = await db.select().from(disparoDestinatarios).where(eq(disparoDestinatarios.campanhaId, campanha!.id));
    expect(destinatarios.map((d) => [d.telefone, d.parametros.nome])).toEqual([["5511966660001", "Ana"]]);
  });

  it("no mesmo dia não sai de novo", async () => {
    expect(await rodarAniversario(db, aniv.id, new Date("2027-06-10T20:00:00Z"))).toBeNull();
  });

  it("quem nasceu em 29/02 recebe em 28/02 nos anos não bissextos", async () => {
    await como(aniv.admin).api.contatos.salvar({ telefone: "11966660004", nome: "Duda", email: null, nascimento: "29/02/2000", etiquetaIds: [] });
    expect(await rodarAniversario(db, aniv.id, new Date("2027-02-28T15:00:00Z"))).toEqual({ enviados: 1 });
  });
});

describe("follow-up de quem parou de responder", () => {
  let fu: UnidadeDeTeste;
  const H = 3_600_000;

  async function conversa(telefone: string, clienteHaMs: number, nossaHaMs: number | null) {
    await clienteComConversa(fu, telefone, clienteHaMs);
    if (nossaHaMs !== null) {
      await db.insert(mensagensSaida).values({ telefone, numeroId: fu.numeroId, tipo: "texto", texto: "nossa resposta", statusEnvio: "enviado", createdAt: new Date(Date.now() - nossaHaMs) });
    }
  }
  const followupsPara = (telefone: string) =>
    db.select().from(mensagensSaida).where(and(eq(mensagensSaida.telefone, telefone), eq(mensagensSaida.statusEnvio, "pendente")));

  beforeAll(async () => {
    fu = await criarUnidade();
    await como(fu.admin).api.automacoes.salvarFollowup({ ativo: true, horas: 4, texto: "Oi {nome}! Ficou alguma dúvida?", etapas: ["em_conversa", "interessado", "fechando"] });
    await conversa("5511977770001", 6 * H, 5 * H); // parou de responder há 5h: recebe
    await conversa("5511977770002", 6 * H, 1 * H); // respondemos há 1h: ainda não
    await conversa("5511977770003", 2 * H, null); // o cliente falou por último: não
    await conversa("5511977770004", 25 * H, 24.5 * H); // janela fechada: não
    await conversa("5511977770005", 6 * H, 5 * H);
    await db.insert(conversasConfig).values({ telefone: "5511977770005", numeroId: fu.numeroId, precisaHumano: true }); // com uma pessoa: não
    await conversa("5511977770006", 6 * H, 5 * H);
    await descadastrar(db, fu.id, "5511977770006", "cliente"); // pediu para sair: não
    await db.insert(contatosUnidade).values({ unidadeId: fu.id, telefone: "5511977770001", nome: "Marina Lopes", origem: "conversa" });
  });

  it("manda só para quem parou de responder, dentro da janela e sem impedimento", async () => {
    expect(await rodarFollowup(db, fu.id)).toEqual({ enviados: 1 });
    const enviados = await followupsPara("5511977770001");
    expect(enviados.map((m) => m.texto)).toEqual(["Oi Marina! Ficou alguma dúvida?"]);
    for (const tel of ["5511977770002", "5511977770003", "5511977770004", "5511977770005", "5511977770006"]) expect(await followupsPara(tel), tel).toHaveLength(0);
  });

  it("não insiste: um follow-up por mensagem do cliente", async () => {
    await db.update(mensagensSaida).set({ statusEnvio: "enviado", createdAt: new Date(Date.now() - 4.5 * H) }).where(eq(mensagensSaida.telefone, "5511977770001"));
    expect(await rodarFollowup(db, fu.id)).toEqual({ enviados: 0 });
    expect(await db.select().from(followupsEnviados).where(eq(followupsEnviados.telefone, "5511977770001"))).toHaveLength(1);
  });

  it("desligado, não manda nada", async () => {
    await como(fu.admin).api.automacoes.salvarFollowup({ ativo: false, horas: 4, texto: "x", etapas: ["em_conversa"] });
    await conversa("5511977770007", 6 * H, 5 * H);
    expect(await rodarFollowup(db, fu.id)).toEqual({ enviados: 0 });
  });
});
