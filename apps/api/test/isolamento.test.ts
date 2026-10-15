import { arquivoDaUnidade, cifrar, contasInstagram, conversasInstagram, midiasAgente, notasConversa } from "@atendimento-academias/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteComConversa, como, criarSuperadmin, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Uma unidade nunca vê nem altera o que é de outra, trocando um id na chamada. E cada papel só faz o
// que lhe cabe (membro x admin x superadmin).

let a: UnidadeDeTeste;
let b: UnidadeDeTeste;
const TEL_B = "5511977776666";

beforeAll(async () => {
  await zerarBanco();
  a = await criarUnidade("Unidade A");
  b = await criarUnidade("Unidade B");
  await clienteComConversa(b, TEL_B);
});

describe("isolamento entre unidades", () => {
  it("não abre a conversa de outra unidade", async () => {
    await expect(como(a.admin).api.conversas.detalhe({ telefone: TEL_B, numeroId: b.numeroId })).rejects.toThrow();
    const daB = await como(b.admin).api.conversas.detalhe({ telefone: TEL_B, numeroId: b.numeroId });
    expect(daB.mensagens.length).toBeGreaterThan(0);
  });

  it("a lista de conversas só traz as da própria unidade", async () => {
    const lista = await como(a.admin).api.conversas.listar({ limite: 100 });
    expect(lista.find((c) => c.telefone === TEL_B)).toBeUndefined();
  });

  it("não responde pelo número de outra unidade", async () => {
    await expect(como(a.admin).api.conversas.enviarResposta({ telefone: TEL_B, numeroId: b.numeroId, texto: "oi" })).rejects.toThrow();
  });

  it("não mexe nos contatos nem nas etiquetas de outra unidade", async () => {
    const { id: contatoB } = await como(b.admin).api.contatos.salvar({ telefone: "11955554444", nome: "Cliente B", email: null, etiquetaIds: [] });
    const { id: etiquetaA } = await como(a.admin).api.contatos.salvarEtiqueta({ nome: "Lead", cor: "roxo" });
    const r = await como(a.admin).api.contatos.etiquetar({ ids: [contatoB], etiquetaId: etiquetaA, acao: "adicionar" });
    expect(r.alterados).toBe(0);
    const { id: etiquetaB } = await como(b.admin).api.contatos.salvarEtiqueta({ nome: "Aluno", cor: "verde" });
    await expect(como(a.admin).api.contatos.salvar({ telefone: "11944443333", nome: "X", email: null, etiquetaIds: [etiquetaB] })).rejects.toThrow(/Etiqueta/);
    const excluidos = await como(a.admin).api.contatos.excluir({ ids: [contatoB] });
    expect(excluidos.excluidos).toBe(0);
    expect((await como(a.admin).api.contatos.listar({ filtro: {} as never })).total).toBe(0);
  });

  it("não apaga a nota interna de outra unidade", async () => {
    const { id } = await como(b.admin).api.notas.criar({ telefone: TEL_B, numeroId: b.numeroId, texto: "nota da B" });
    await expect(como(a.admin).api.notas.excluir({ id })).rejects.toThrow();
    expect(await db.select().from(notasConversa).where(eq(notasConversa.id, id))).toHaveLength(1);
  });

  it("não cancela nem move campanha de outra unidade", async () => {
    const { campanhaId } = await clienteComConversa(b, "5511966665555", null);
    await expect(como(a.admin).api.campanhas.moverEtapa({ id: campanhaId, etapa: null })).rejects.toThrow(/não encontrada/);
    await expect(como(a.admin).api.campanhas.cancelarAgendamento({ id: campanhaId })).rejects.toThrow();
  });

  it("não troca a senha de quem é de outra unidade", async () => {
    await expect(como(a.admin).api.usuarios.redefinirSenha({ id: b.membro.id, senha: "outra-senha-123" })).rejects.toThrow(/não encontrado/);
  });

  it("não abre a DM do Instagram de outra unidade", async () => {
    const [conta] = await db.insert(contasInstagram).values({ unidadeId: b.id, igUserId: `ig-${b.id}`, username: "unidade_b", tokenCifrado: cifrar("x") }).returning();
    const [conversa] = await db.insert(conversasInstagram).values({ contaId: conta!.id, igsid: "pessoa-1" }).returning();
    await expect(como(a.admin).api.dmsInstagram.detalhe({ conversaId: conversa!.id })).rejects.toThrow(/não encontrada/);
    await expect(como(a.admin).api.dmsInstagram.apagarDados({ conversaId: conversa!.id })).rejects.toThrow(/não encontrada/);
    expect((await como(b.admin).api.dmsInstagram.detalhe({ conversaId: conversa!.id })).id).toBe(conversa!.id);
  });

  it("arquivo (/uploads) só é da unidade que o usa", async () => {
    await db.insert(midiasAgente).values({ unidadeId: b.id, chave: "planos", midiaUrl: "/uploads/arquivo-da-b.png", mimeType: "image/png" });
    expect(await arquivoDaUnidade(db, "/uploads/arquivo-da-b.png", b.id)).toBe(true);
    expect(await arquivoDaUnidade(db, "/uploads/arquivo-da-b.png", a.id)).toBe(false);
  });
});

describe("papéis", () => {
  it("sem login, nada responde", async () => {
    await expect(como(null).api.conversas.listar({ limite: 10 })).rejects.toThrow(/login/);
  });

  it("membro não faz o que é de admin", async () => {
    await expect(como(a.membro).api.usuarios.listar()).rejects.toThrow(/administrador/);
    await expect(como(a.membro).api.conversas.apagarDadosDoCliente({ telefone: TEL_B, numeroId: a.numeroId })).rejects.toThrow(/administrador/);
    await expect(como(a.membro).api.saude.verificarAgora()).rejects.toThrow(/responsável pela plataforma/);
  });

  it("admin não cria superadmin nem vê a rede", async () => {
    await expect(
      como(a.admin).api.usuarios.criar({ nome: "Invasor", email: "x@teste.local", senha: "senha-de-teste-123", papel: "superadmin" as never }),
    ).rejects.toThrow();
    await expect(como(a.admin).api.rede.resumo({ dias: 30 })).rejects.toThrow(/superadmin/);
    await expect(como(a.admin).api.unidades.listar()).rejects.toThrow(/superadmin/);
  });

  it("configuração técnica (WhatsApp, n8n, EVO, templates, saúde) é só do responsável pela plataforma", async () => {
    const admin = como(a.admin).api;
    await expect(admin.configuracoes.salvarModoAgente({ modo: "n8n", webhookN8nUrl: "https://n8n.exemplo.com/w" } as never)).rejects.toThrow(/responsável pela plataforma/);
    await expect(admin.configuracoes.gerarChaveIntegracao()).rejects.toThrow(/responsável pela plataforma/);
    await expect(admin.templates.criar({} as never)).rejects.toThrow();
    await expect(admin.saude.verificarAgora()).rejects.toThrow(/responsável pela plataforma/);
    await expect(admin.evo.salvar({ dns: "x", chave: "y", idBranch: null })).rejects.toThrow(/responsável pela plataforma/);
    // O que o admin usa no dia a dia continua: listar números e templates para criar campanha.
    await expect(admin.configuracoes.listar()).resolves.toBeTruthy();
    await expect(admin.templates.listar({ numeroId: a.numeroId })).resolves.toBeTruthy();
    // O superadmin, dentro da unidade, configura.
    await expect(como(await criarSuperadmin(a.id)).api.configuracoes.gerarChaveIntegracao()).resolves.toMatchObject({ chave: expect.any(String) });
  });

  it("superadmin vê a rede inteira", async () => {
    const resumo = await como(await criarSuperadmin()).api.rede.resumo({ dias: 30 });
    expect(resumo.unidades.map((u) => u.nome)).toEqual(expect.arrayContaining(["Unidade A", "Unidade B"]));
  });

  it("detalhe técnico da plataforma na Saúde só para o superadmin", async () => {
    const { verificacoesSaude } = await import("@atendimento-academias/db");
    await db.insert(verificacoesSaude).values({ unidadeId: null, chave: "armazenamento", nivel: "falha", titulo: "Arquivos (S3)", mensagem: "bucket-secreto recusou" });
    const doMembro = await como(a.membro).api.saude.estado();
    expect(doMembro.verificacoes.find((v) => v.chave === "armazenamento")!.mensagem).not.toContain("bucket-secreto");
    const doSuper = await como(await criarSuperadmin(a.id)).api.saude.estado();
    expect(doSuper.verificacoes.find((v) => v.chave === "armazenamento")!.mensagem).toContain("bucket-secreto");
  });
});
