import { criarCampanhaInputSchema, detalheConversaInputSchema, enviarRespostaInputSchema, NOME_MIDIA_AGENTE } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import express, { type Router } from "express";
import { z } from "zod";
import { chaveIntegracaoValida } from "../config/plataforma.js";
import { criarCampanha } from "../servicos/campanhas.js";
import { enviarMensagem, obterConversa, passarParaHumano } from "../servicos/conversas.js";
import { getDb } from "../trpc/context.js";
import { midiasAgente } from "@atendimento-academias/db";
import { eq } from "drizzle-orm";

// API para automação externa (n8n, Zapier, um script...) disparar campanha sem passar pela tela.
// Fica no servidor do webhook (público) porque quem chama não roda na mesma máquina; a única porta
// de entrada é essa chave — não há cookie de sessão nem CORS aqui.
const CODIGO_HTTP: Partial<Record<string, number>> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  PRECONDITION_FAILED: 412,
  INTERNAL_SERVER_ERROR: 500,
};

export function criarRouterIntegracoes(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  router.use(async (req, res, next) => {
    const cabecalho = req.header("authorization") ?? "";
    const chave = cabecalho.startsWith("Bearer ") ? cabecalho.slice("Bearer ".length).trim() : null;

    const valida = await chaveIntegracaoValida(getDb(), chave);
    if (!valida) {
      res.status(401).json({ error: "Chave de integração ausente ou inválida (header Authorization: Bearer <chave>)." });
      return;
    }
    next();
  });

  // Cria uma campanha (dispara na hora, ou agenda se vier "agendarPara"). Mesmo formato e mesmas
  // regras da tela Nova campanha — ver criarCampanhaInputSchema em packages/shared.
  router.post("/campanhas", async (req, res) => {
    const entrada = criarCampanhaInputSchema.safeParse(req.body);
    if (!entrada.success) {
      res.status(400).json({ error: "Dados inválidos", detalhes: entrada.error.flatten() });
      return;
    }

    try {
      const resultado = await criarCampanha(getDb(), entrada.data);
      res.status(201).json(resultado);
    } catch (erro) {
      if (erro instanceof TRPCError) {
        res.status(CODIGO_HTTP[erro.code] ?? 500).json({ error: erro.message });
        return;
      }
      console.error("[integracoes] falha ao criar campanha:", erro);
      res.status(500).json({ error: "Falha inesperada ao criar a campanha" });
    }
  });

  // Histórico da conversa (o que o cliente escreveu, os disparos e as respostas já enviadas) — o
  // fluxo de venda do n8n chama isto para decidir o que responder.
  router.get("/conversas", async (req, res) => {
    const entrada = detalheConversaInputSchema.safeParse({
      telefone: req.query.telefone,
      numeroId: Number(req.query.numeroId),
    });
    if (!entrada.success) {
      res.status(400).json({ error: "Informe telefone e numeroId (query string)", detalhes: entrada.error.flatten() });
      return;
    }

    try {
      const conversa = await obterConversa(getDb(), entrada.data.telefone, entrada.data.numeroId);
      res.status(200).json(conversa);
    } catch (erro) {
      if (erro instanceof TRPCError) {
        res.status(CODIGO_HTTP[erro.code] ?? 500).json({ error: erro.message });
        return;
      }
      console.error("[integracoes] falha ao buscar conversa:", erro);
      res.status(500).json({ error: "Falha inesperada ao buscar a conversa" });
    }
  });

  // Manda uma mensagem de texto direto ao cliente (sem rascunho: quem chama já decidiu o texto).
  // Mesma checagem de janela de 24h e mesma fila de envio da tela de Conversas.
  // "imagem" (opcional): nome de uma imagem cadastrada em Configurações → Imagens do agente.
  router.post("/mensagens", async (req, res) => {
    const entrada = enviarRespostaInputSchema
      .omit({ sugestaoId: true })
      .extend({ imagem: z.string().trim().toLowerCase().regex(NOME_MIDIA_AGENTE).nullish() })
      .safeParse(req.body);
    if (!entrada.success) {
      res.status(400).json({ error: "Dados inválidos", detalhes: entrada.error.flatten() });
      return;
    }

    try {
      const { imagem: nomeDaImagem, ...mensagem } = entrada.data;
      let imagem: { midiaUrl: string; mimeType: string } | undefined;
      if (nomeDaImagem) {
        const [midia] = await getDb().select().from(midiasAgente).where(eq(midiasAgente.chave, nomeDaImagem));
        if (!midia) {
          res.status(400).json({ error: `Imagem "${nomeDaImagem}" não cadastrada (Configurações → Imagens do agente).` });
          return;
        }
        imagem = { midiaUrl: midia.midiaUrl, mimeType: midia.mimeType };
      }
      const resultado = await enviarMensagem(getDb(), { ...mensagem, imagem });
      res.status(201).json(resultado);
    } catch (erro) {
      if (erro instanceof TRPCError) {
        res.status(CODIGO_HTTP[erro.code] ?? 500).json({ error: erro.message });
        return;
      }
      console.error("[integracoes] falha ao enviar mensagem:", erro);
      res.status(500).json({ error: "Falha inesperada ao enviar a mensagem" });
    }
  });

  // O bot decidiu que precisa de uma pessoa: mesmo efeito do botão "Pedir humano" — a conversa ganha
  // o selo "Humano" em Conversas e para de receber resposta automática até alguém marcar como resolvida.
  router.post("/conversas/humano", async (req, res) => {
    const entrada = detalheConversaInputSchema
      .extend({ motivo: z.string().trim().min(1).max(500) })
      .safeParse(req.body);
    if (!entrada.success) {
      res.status(400).json({ error: "Dados inválidos", detalhes: entrada.error.flatten() });
      return;
    }

    await passarParaHumano(getDb(), entrada.data.telefone, entrada.data.numeroId, entrada.data.motivo);
    res.status(200).json({ ok: true });
  });

  return router;
}
