import { beforeAll, describe, expect, it } from "vitest";
import { clienteComConversa, como, criarUnidade, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Exportar planilha: só o admin, só da própria unidade.

let a: UnidadeDeTeste;
let b: UnidadeDeTeste;

beforeAll(async () => {
  await zerarBanco();
  a = await criarUnidade();
  b = await criarUnidade();
});

describe("exportações", () => {
  it("contatos: admin exporta os da unidade, com etiquetas", async () => {
    const { id: etiqueta } = await como(a.admin).api.contatos.salvarEtiqueta({ nome: "Aluno", cor: "verde" });
    await como(a.admin).api.contatos.salvar({ telefone: "11911112222", nome: "Ana", email: "ana@x.com", etiquetaIds: [etiqueta] });
    await como(b.admin).api.contatos.salvar({ telefone: "11933334444", nome: "Bruno da B", email: null, etiquetaIds: [] });
    const linhas = await como(a.admin).api.exportacoes.contatos({} as never);
    expect(linhas[0]).toContain("WhatsApp");
    expect(linhas.slice(1)).toEqual([["Ana", "5511911112222", "ana@x.com", "", "Aluno", "manual", expect.any(String), "", ""]]);
  });

  it("membro não exporta nada", async () => {
    await expect(como(a.membro).api.exportacoes.contatos({} as never)).rejects.toThrow(/administrador/);
  });

  it("campanha e conversa de outra unidade não saem", async () => {
    const { campanhaId } = await clienteComConversa(b, "5511955556666");
    await expect(como(a.admin).api.exportacoes.campanha({ id: campanhaId })).rejects.toThrow(/não encontrada/);
    await expect(como(a.admin).api.exportacoes.conversa({ telefone: "5511955556666", numeroId: b.numeroId })).rejects.toThrow();
    const daB = await como(b.admin).api.exportacoes.campanha({ id: campanhaId });
    const [telefone, nome, situacao, , , , respondeu] = daB[1]!;
    expect({ telefone, nome, situacao, respondeu }).toEqual({ telefone: "5511955556666", nome: "Cliente", situacao: "enviado", respondeu: "sim" });
    const conversa = await como(b.admin).api.exportacoes.conversa({ telefone: "5511955556666", numeroId: b.numeroId });
    expect(conversa.slice(1).map((l) => l[1])).toContain("Cliente");
  });
});
