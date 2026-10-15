import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  CHAVE_MODO_AGENTE,
  CHAVE_N8N_WEBHOOK_URL,
  cifrar,
  contasInstagram,
  contatosUnidade,
  conversasInstagram,
  descadastros,
  mensagensInstagram,
  mensagensSaida,
  respostasClientes,
} from "@atendimento-academias/db";
import { and, eq } from "drizzle-orm";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { salvarValor } from "../src/config/plataforma.js";
import { criarWebhookInstagram } from "../src/webhooks/instagram.js";
import { criarWebhookWhatsapp } from "../src/webhooks/whatsapp.js";
import { clienteComConversa, criarUnidade, db, simularInternet, zerarBanco, type UnidadeDeTeste } from "./apoio.js";

// Webhooks da Meta: só aceita evento assinado com o segredo certo, não grava a mesma mensagem duas vezes
// e trata "sair" como pedido de descadastro (sem o bot responder por cima).

let unidade: UnidadeDeTeste;
let base: string;
let servidor: ReturnType<express.Express["listen"]>;
let internet: ReturnType<typeof simularInternet>;
const TEL = "5511988880001";
const N8N = "https://n8n.teste/webhook/vendas";

beforeAll(async () => {
  await zerarBanco();
  unidade = await criarUnidade();
  await clienteComConversa(unidade, TEL, null);
  await salvarValor(db, unidade.id, CHAVE_MODO_AGENTE, "n8n");
  await salvarValor(db, unidade.id, CHAVE_N8N_WEBHOOK_URL, N8N);
  internet = simularInternet((url) => (url.includes("/zz-pessoa?") ? Response.json({ name: "Ana", username: "ana.fit" }) : Response.json({ messages: [{ id: "wamid.x" }] })));
  const app = express();
  app.use("/whatsapp", criarWebhookWhatsapp());
  app.use("/instagram", criarWebhookInstagram());
  servidor = app.listen(0, "127.0.0.1");
  await new Promise((r) => servidor.once("listening", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor.close();
  vi.unstubAllGlobals();
});

function postar(caminho: string, corpo: unknown, segredo: string | null) {
  const texto = JSON.stringify(corpo);
  const assinatura = segredo ? `sha256=${createHmac("sha256", segredo).update(texto).digest("hex")}` : "sha256=errada";
  return internet.original(`${base}${caminho}`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": assinatura }, body: texto });
}

function eventoWhatsapp(id: string, texto: string, de = TEL) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: unidade.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: unidade.phoneNumberId },
              contacts: [{ wa_id: de, profile: { name: "Cliente Teste" } }],
              messages: [{ id, from: de, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  };
}

const mensagensDoCliente = () =>
  db.select().from(respostasClientes).where(and(eq(respostasClientes.telefone, TEL), eq(respostasClientes.numeroId, unidade.numeroId)));

describe("webhook do WhatsApp", () => {
  it("recusa evento com assinatura errada", async () => {
    const resposta = await postar("/whatsapp", eventoWhatsapp("wamid.falso", "oi"), null);
    expect(resposta.status).toBe(401);
    expect(await mensagensDoCliente()).toHaveLength(0);
  });

  it("grava a mensagem, põe o cliente na base e avisa o n8n", async () => {
    const resposta = await postar("/whatsapp", eventoWhatsapp("wamid.1", "Quanto custa o plano?"), unidade.segredoApp);
    expect(resposta.status).toBe(200);
    const linhas = await mensagensDoCliente();
    expect(linhas.map((l) => l.texto)).toEqual(["Quanto custa o plano?"]);
    const [contato] = await db.select().from(contatosUnidade).where(eq(contatosUnidade.telefone, TEL));
    expect(contato?.nome).toBe("Cliente Teste");
    const aviso = internet.chamadas.find((c) => c.url === N8N);
    expect(aviso?.corpo).toMatchObject({ telefone: TEL, numeroId: unidade.numeroId, mensagem: { texto: "Quanto custa o plano?" } });
  });

  it("a Meta reenviando o mesmo evento não duplica a mensagem nem chama o bot de novo", async () => {
    const antes = internet.chamadas.filter((c) => c.url === N8N).length;
    await postar("/whatsapp", eventoWhatsapp("wamid.1", "Quanto custa o plano?"), unidade.segredoApp);
    expect(await mensagensDoCliente()).toHaveLength(1);
    expect(internet.chamadas.filter((c) => c.url === N8N).length).toBe(antes);
  });

  it("ignora quem nunca recebeu disparo da unidade", async () => {
    await postar("/whatsapp", eventoWhatsapp("wamid.estranho", "oi", "5511900000000"), unidade.segredoApp);
    expect(await db.select().from(respostasClientes).where(eq(respostasClientes.telefone, "5511900000000"))).toHaveLength(0);
  });

  it("'sair' descadastra, confirma ao cliente e não aciona o bot", async () => {
    const antes = internet.chamadas.filter((c) => c.url === N8N).length;
    await postar("/whatsapp", eventoWhatsapp("wamid.sair", "SAIR"), unidade.segredoApp);
    const [linha] = await db.select().from(descadastros).where(and(eq(descadastros.unidadeId, unidade.id), eq(descadastros.telefone, TEL)));
    expect(linha?.origem).toBe("cliente");
    const confirmacoes = await db.select().from(mensagensSaida).where(eq(mensagensSaida.telefone, TEL));
    expect(confirmacoes.length).toBeGreaterThan(0);
    expect(internet.chamadas.filter((c) => c.url === N8N).length).toBe(antes);
  });
});

describe("webhook do Instagram", () => {
  let contaId: number;

  beforeAll(async () => {
    const [conta] = await db
      .insert(contasInstagram)
      .values({ unidadeId: unidade.id, igUserId: "ig-conta-teste", username: "allpfit_teste", tokenCifrado: cifrar("tok"), dmsAtivadasEm: new Date() })
      .returning();
    contaId = conta!.id;
  });

  const evento = (mensagem: Record<string, unknown>, de = "zz-pessoa", para = "ig-conta-teste") => ({
    object: "instagram",
    entry: [{ id: "ig-conta-teste", messaging: [{ sender: { id: de }, recipient: { id: para }, timestamp: Date.now(), message: mensagem }] }],
  });
  const segredo = () => process.env.INSTAGRAM_APP_SECRET!;

  it("recusa evento com assinatura errada", async () => {
    expect((await postar("/instagram", evento({ mid: "m-falso", text: "oi" }), null)).status).toBe(401);
  });

  it("grava a DM com o nome da pessoa e conta como não lida", async () => {
    expect((await postar("/instagram", evento({ mid: "m-1", text: "Oi! Vocês têm aula de spinning?" }), segredo())).status).toBe(200);
    const [conversa] = await db.select().from(conversasInstagram).where(eq(conversasInstagram.contaId, contaId));
    expect(conversa).toMatchObject({ username: "ana.fit", nome: "Ana", naoLidas: 1 });
  });

  it("não duplica a mesma DM nem o eco do que a própria conta mandou", async () => {
    await postar("/instagram", evento({ mid: "m-1", text: "Oi! Vocês têm aula de spinning?" }), segredo());
    await postar("/instagram", evento({ mid: "m-eco", text: "Temos sim!", is_echo: true }, "ig-conta-teste", "zz-pessoa"), segredo());
    await postar("/instagram", evento({ mid: "m-eco", text: "Temos sim!", is_echo: true }, "ig-conta-teste", "zz-pessoa"), segredo());
    const [conversa] = await db.select().from(conversasInstagram).where(eq(conversasInstagram.contaId, contaId));
    const mensagens = await db.select().from(mensagensInstagram).where(eq(mensagensInstagram.conversaId, conversa!.id));
    expect(mensagens.map((m) => `${m.origem}:${m.texto}`)).toEqual(["cliente:Oi! Vocês têm aula de spinning?", "app:Temos sim!"]);
  });
});
