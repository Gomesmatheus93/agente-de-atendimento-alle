import { beforeAll, describe, expect, it } from "vitest";
import { clienteComConversa, como, criarUnidade, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Extras: primeiros passos (calculados dos dados da unidade).

let unidade: UnidadeDeTeste;

beforeAll(async () => {
  await zerarBanco();
  unidade = await criarUnidade();
});

describe("primeiros passos", () => {
  const feitos = async () => {
    const estado = await como(unidade.admin).api.primeirosPassos.estado();
    return { estado, feito: Object.fromEntries(estado.passos.map((p) => [p.chave, p.feito])) };
  };

  it("unidade nova: só o WhatsApp está pronto", async () => {
    const { estado, feito } = await feitos();
    expect(feito).toMatchObject({ whatsapp: true, webhook: false, template: false, contatos: false, campanha: false, equipe: true });
    expect(estado.concluido).toBe(false);
  });

  it("primeira mensagem recebida, template e campanha marcam os passos", async () => {
    await clienteComConversa(unidade, "5511977770000");
    await como(unidade.admin).api.contatos.importar({ linhas: [{ telefone: "11977771111", nome: "Ana" }], etiquetasParaTodos: [], atualizarNomes: true });
    const { estado, feito } = await feitos();
    expect(feito).toMatchObject({ webhook: true, template: true, campanha: true, contatos: true });
    expect(estado.prontos).toBe(estado.total - 1); // falta só o atendimento automático (sem chave de IA nos testes)
  });
});
