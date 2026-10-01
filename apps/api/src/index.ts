import * as trpcExpress from "@trpc/server/adapters/express";
import express from "express";
import { criarRouterIntegracoes } from "./integracoes/router.js";
import { diretorioDeUploads } from "./media/armazenamento.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";
import { criarWebhookWhatsapp } from "./webhooks/whatsapp.js";

// Dois servidores com exposições diferentes:
// - o do painel (tRPC) cria campanhas, envia mensagens e guarda credenciais: só atende a máquina local;
// - o do webhook é o único que precisa ir para a internet — a Meta chama /webhooks/whatsapp, e sistemas
//   externos (n8n etc.) chamam /integracoes/*, autenticados por chave própria, sem cookie de sessão.
// Assim um túnel ou proxy apontado para o webhook não expõe junto as rotas internas do painel.

const painel = express();
painel.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);
// Áudio de nota de voz e figurinha recebida: gravados em disco (media/armazenamento.ts) e servidos daqui.
// Fica atrás da mesma restrição do resto do painel (127.0.0.1 / proxy do Vite), sem rota pública própria.
painel.use("/uploads", express.static(diretorioDeUploads(), { maxAge: "30d", immutable: true }));
painel.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const webhook = express();
webhook.use("/webhooks/whatsapp", criarWebhookWhatsapp());
webhook.use("/integracoes", criarRouterIntegracoes());
webhook.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const portaPainel = Number(process.env.PAINEL_PORT ?? 3334);
const hostPainel = process.env.PAINEL_HOST ?? "127.0.0.1";
const portaWebhook = Number(process.env.WEBHOOK_PORT ?? 3333);

painel.listen(portaPainel, hostPainel, () => {
  console.log(`painel (tRPC) ouvindo em http://${hostPainel}:${portaPainel}`);
});

webhook.listen(portaWebhook, () => {
  console.log(`webhook ouvindo na porta ${portaWebhook}`);
});
