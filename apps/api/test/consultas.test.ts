import { cifrar, contasInstagram, conversasInstagram, descadastrar, mensagensInstagram, respostasClientes } from "@atendimento-academias/db";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteComConversa, como, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Campos calculados por contato/conversa (última mensagem, "não recebe campanhas", prévia da DM,
// "respondeu"). Cada linha precisa olhar para os próprios dados — um erro de consulta já fez todas as
// linhas olharem para a mesma coisa. Os ids são desencontrados de propósito para não acertar por acaso.

let unidade: UnidadeDeTeste;

beforeAll(async () => {
  await zerarBanco();
  unidade = await criarUnidade();
  // Respostas avulsas antes, para os ids de respostas e destinatários não coincidirem.
  for (let i = 0; i < 3; i++) await clienteComConversa(unidade, `55119000000${i}`, 3 * 86_400_000);
});

describe("campos calculados por linha", () => {
  it("contatos: cada um com a própria última mensagem e o próprio 'não recebe campanhas'", async () => {
    await clienteComConversa(unidade, "5511911110000", 5 * 60_000);
    const api = como(unidade.admin).api;
    await api.contatos.salvar({ telefone: "11911110000", nome: "Escreveu", email: null, etiquetaIds: [] });
    await api.contatos.salvar({ telefone: "11922220000", nome: "Nunca escreveu", email: null, etiquetaIds: [] });
    await descadastrar(db, unidade.id, "5511911110000", "cliente");

    const lista = await api.contatos.listar({ filtro: { busca: "escreveu" } as never });
    const por = Object.fromEntries(lista.itens.map((c) => [c.nome, c]));
    expect(por["Escreveu"]!.ultimaMensagemEm).not.toBeNull();
    expect(por["Escreveu"]!.descadastrado).toBe(true);
    expect(por["Escreveu"]!.numeroId).toBe(unidade.numeroId);
    expect(por["Nunca escreveu"]!.ultimaMensagemEm).toBeNull();
    expect(por["Nunca escreveu"]!.descadastrado).toBe(false);
    expect(por["Nunca escreveu"]!.numeroId).toBeNull();
    expect(lista).toMatchObject({ total: 2, descadastrados: 1, alcancaveis: 1 });
  });

  it("etiquetas: cada uma conta os próprios contatos", async () => {
    const api = como(unidade.admin).api;
    const { id: um } = await api.contatos.salvarEtiqueta({ nome: "Uma", cor: "roxo" });
    const { id: duas } = await api.contatos.salvarEtiqueta({ nome: "Duas", cor: "azul" });
    await api.contatos.salvar({ telefone: "11933330001", nome: "X", email: null, etiquetaIds: [um, duas] });
    await api.contatos.salvar({ telefone: "11933330002", nome: "Y", email: null, etiquetaIds: [duas] });
    const contagem = Object.fromEntries((await api.contatos.etiquetas()).map((e) => [e.nome, e.contatos]));
    expect(contagem).toMatchObject({ Uma: 1, Duas: 2 });
  });

  it("DMs: cada conversa mostra a própria última mensagem", async () => {
    const [conta] = await db.insert(contasInstagram).values({ unidadeId: unidade.id, igUserId: "ig-consultas", username: "conta", tokenCifrado: cifrar("x") }).returning();
    const [c1] = await db.insert(conversasInstagram).values({ contaId: conta!.id, igsid: "p1", nome: "Pessoa 1" }).returning();
    const [c2] = await db.insert(conversasInstagram).values({ contaId: conta!.id, igsid: "p2", nome: "Pessoa 2" }).returning();
    await db.insert(mensagensInstagram).values([
      { conversaId: c1!.id, origem: "cliente", texto: "oi da pessoa 1", criadaEm: new Date(Date.now() - 60_000) },
      { conversaId: c2!.id, origem: "cliente", texto: "oi da pessoa 2", criadaEm: new Date(Date.now() - 30_000) },
      { conversaId: c2!.id, origem: "equipe", texto: "resposta para a 2", criadaEm: new Date() },
    ]);
    const lista = await como(unidade.admin).api.dmsInstagram.listar({});
    const por = Object.fromEntries(lista.map((c) => [c.nome, c]));
    expect(por["Pessoa 1"]).toMatchObject({ previa: "oi da pessoa 1", previaDoCliente: true });
    expect(por["Pessoa 2"]).toMatchObject({ previa: "resposta para a 2", previaDoCliente: false });
  });

  it("exportação da campanha: 'respondeu' de cada destinatário", async () => {
    const { campanhaId } = await clienteComConversa(unidade, "5511944440000", 60_000);
    expect((await db.select().from(respostasClientes)).length).toBeGreaterThan(3);
    const linhas = await como(unidade.admin).api.exportacoes.campanha({ id: campanhaId });
    expect(linhas[1]![6]).toBe("sim");
    const { campanhaId: semResposta } = await clienteComConversa(unidade, "5511955550000", null);
    expect((await como(unidade.admin).api.exportacoes.campanha({ id: semResposta }))[1]![6]).toBe("");
  });
});
