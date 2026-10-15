import {
  apagarDadosDoCliente,
  contatosUnidade,
  descadastrar,
  descadastros,
  disparoDestinatarios,
  mensagensSaida,
  notasConversa,
  respostasClientes,
} from "@atendimento-academias/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { enviarMensagem as enviarPeloWorker } from "../../worker/src/queue/mensagem-saida-queue.js";
import type { WhatsAppProvider } from "../../worker/src/providers/whatsapp/WhatsAppProvider.js";
import { clienteComConversa, como, criarUnidade, db, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Envio: janela de 24h, assinatura de quem respondeu, campanha sem quem pediu para sair, a imagem que
// falha não derruba a resposta, e o pedido de exclusão de dados (LGPD).

let unidade: UnidadeDeTeste;

beforeAll(async () => {
  await zerarBanco();
  unidade = await criarUnidade();
});

describe("resposta pelo painel", () => {
  it("sai assinada com o nome de quem respondeu", async () => {
    await clienteComConversa(unidade, "5511911110001", 10 * 60_000);
    const { id } = await como(unidade.admin).api.conversas.enviarResposta({ telefone: "5511911110001", numeroId: unidade.numeroId, texto: "Oi! O plano mensal é R$ 99,90." });
    const [mensagem] = await db.select().from(mensagensSaida).where(eq(mensagensSaida.id, id));
    expect(mensagem!.texto).toBe("*Ana*\nOi! O plano mensal é R$ 99,90.");
    expect(mensagem!.statusEnvio).toBe("pendente");
  });

  it("não sai sem o nome de quem responde", async () => {
    await clienteComConversa(unidade, "5511911110002", 10 * 60_000);
    const semNome = { ...unidade.membro, assinatura: null };
    await expect(como(semNome).api.conversas.enviarResposta({ telefone: "5511911110002", numeroId: unidade.numeroId, texto: "oi" })).rejects.toThrow(/nome/);
  });

  it("depois de 24h da última mensagem do cliente, não deixa responder", async () => {
    await clienteComConversa(unidade, "5511911110003", 25 * 3_600_000);
    await expect(como(unidade.admin).api.conversas.enviarResposta({ telefone: "5511911110003", numeroId: unidade.numeroId, texto: "oi" })).rejects.toThrow(/24h/);
  });
});

describe("campanha", () => {
  it("quem pediu para sair fica de fora", async () => {
    const { templateId } = await clienteComConversa(unidade, "5511922220000", null);
    await descadastrar(db, unidade.id, "5511922220002", "cliente");
    const r = await como(unidade.admin).api.campanhas.criar({
      nome: "Promo",
      templateId,
      numeroId: unidade.numeroId,
      destinatarios: [
        { telefone: "11922220001", parametros: { nome: "Ana" } },
        { telefone: "11922220002", parametros: { nome: "Bia" } },
      ],
    });
    expect(r.descadastrados).toBe(1);
    const destinatarios = await db.select().from(disparoDestinatarios).where(eq(disparoDestinatarios.campanhaId, r.id));
    expect(destinatarios.map((d) => d.telefone)).toEqual(["5511922220001"]);
  });

  it("todos descadastrados: a campanha não é criada", async () => {
    const { templateId } = await clienteComConversa(unidade, "5511922230000", null);
    await descadastrar(db, unidade.id, "5511922230001", "equipe");
    await expect(
      como(unidade.admin).api.campanhas.criar({ nome: "Promo 2", templateId, numeroId: unidade.numeroId, destinatarios: [{ telefone: "11922230001", parametros: { nome: "Ana" } }] }),
    ).rejects.toThrow(/Todos os destinatários/);
  });
});

describe("worker de envio", () => {
  function provedor(imagemFunciona: boolean): WhatsAppProvider {
    return {
      enviarTemplate: async () => ({ sucesso: true, mensagemId: "t" }),
      enviarTexto: async () => ({ sucesso: true, mensagemId: "wamid.texto" }),
      enviarAudio: async () => ({ sucesso: true, mensagemId: "a" }),
      enviarImagem: async () => (imagemFunciona ? { sucesso: true, mensagemId: "wamid.img" } : { sucesso: false, erro: "mídia recusada" }),
      enviarArquivo: async () => ({ sucesso: true, mensagemId: "f" }),
    };
  }
  const fabrica = (p: WhatsAppProvider) => ({ para: async () => p }) as never;

  it("se a imagem não sai, o texto vai sozinho (e fica registrado o porquê)", async () => {
    const [m] = await db
      .insert(mensagensSaida)
      .values({ telefone: "5511933330001", numeroId: unidade.numeroId, tipo: "imagem", texto: "Nossos planos 👇", midiaUrl: "/uploads/planos.png" })
      .returning();
    await enviarPeloWorker(db, fabrica(provedor(false)), m!.id);
    const [depois] = await db.select().from(mensagensSaida).where(eq(mensagensSaida.id, m!.id));
    expect(depois).toMatchObject({ statusEnvio: "enviado", tipo: "texto", mensagemExternaId: "wamid.texto" });
    expect(depois!.erroDetalhe).toMatch(/imagem não foi enviada/);
  });

  it("imagem sem texto que falha fica como falha, para reenviar", async () => {
    const [m] = await db
      .insert(mensagensSaida)
      .values({ telefone: "5511933330002", numeroId: unidade.numeroId, tipo: "imagem", texto: "", midiaUrl: "/uploads/planos.png" })
      .returning();
    await enviarPeloWorker(db, fabrica(provedor(false)), m!.id);
    const [depois] = await db.select().from(mensagensSaida).where(eq(mensagensSaida.id, m!.id));
    expect(depois!.statusEnvio).toBe("falhou");
  });

  it("mensagem já enviada não sai de novo (job repetido)", async () => {
    let envios = 0;
    const p = { ...provedor(true), enviarTexto: async () => (envios++, { sucesso: true, mensagemId: "x" }) };
    const [m] = await db.insert(mensagensSaida).values({ telefone: "5511933330003", numeroId: unidade.numeroId, tipo: "texto", texto: "oi" }).returning();
    await enviarPeloWorker(db, fabrica(p), m!.id);
    await enviarPeloWorker(db, fabrica(p), m!.id);
    expect(envios).toBe(1);
  });
});

describe("exclusão de dados (LGPD)", () => {
  it("apaga tudo do cliente na unidade, mas mantém o 'não quero receber'", async () => {
    const TEL = "5511944440001";
    await clienteComConversa(unidade, TEL, 60_000);
    await db.insert(mensagensSaida).values({ telefone: TEL, numeroId: unidade.numeroId, tipo: "texto", texto: "resposta" });
    await db.insert(notasConversa).values({ numeroId: unidade.numeroId, telefone: TEL, autorNome: "Ana", texto: "pediu desconto" });
    await db.insert(contatosUnidade).values({ unidadeId: unidade.id, telefone: TEL, nome: "Cliente", origem: "conversa" });
    await descadastrar(db, unidade.id, TEL, "cliente");

    await expect(como(unidade.membro).api.conversas.apagarDadosDoCliente({ telefone: TEL, numeroId: unidade.numeroId })).rejects.toThrow(/administrador/);
    const r = await como(unidade.admin).api.conversas.apagarDadosDoCliente({ telefone: TEL, numeroId: unidade.numeroId });
    expect(r.mensagens).toBe(2);

    expect(await db.select().from(respostasClientes).where(eq(respostasClientes.telefone, TEL))).toHaveLength(0);
    expect(await db.select().from(mensagensSaida).where(eq(mensagensSaida.telefone, TEL))).toHaveLength(0);
    expect(await db.select().from(notasConversa).where(eq(notasConversa.telefone, TEL))).toHaveLength(0);
    expect(await db.select().from(contatosUnidade).where(eq(contatosUnidade.telefone, TEL))).toHaveLength(0);
    expect(await db.select().from(disparoDestinatarios).where(eq(disparoDestinatarios.telefone, TEL))).toHaveLength(0);
    expect(await db.select().from(descadastros).where(and(eq(descadastros.unidadeId, unidade.id), eq(descadastros.telefone, TEL)))).toHaveLength(1);
  });

  it("não apaga nada de outra unidade com o mesmo telefone", async () => {
    const outra = await criarUnidade();
    const TEL = "5511944440002";
    await clienteComConversa(outra, TEL, 60_000);
    await apagarDadosDoCliente(db, unidade.id, TEL);
    expect(await db.select().from(respostasClientes).where(eq(respostasClientes.telefone, TEL))).toHaveLength(1);
  });
});
