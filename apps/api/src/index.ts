import { existsSync } from "node:fs";
import path from "node:path";
import * as trpcExpress from "@trpc/server/adapters/express";
import express from "express";
import { criarRouterIntegracoes } from "./integracoes/router.js";
import { diretorioDeUploads } from "./media/armazenamento.js";
import { cabecalhosDeSeguranca } from "./seguranca.js";
import { createContext, usuarioDoCookie } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";
import { criarWebhookWhatsapp } from "./webhooks/whatsapp.js";

// Dois servidores com exposições diferentes:
// - o do painel (tRPC) cria campanhas, envia mensagens e guarda credenciais: só atende a máquina local;
// - o do webhook é o único que precisa ir para a internet — a Meta chama /webhooks/whatsapp, e sistemas
//   externos (n8n etc.) chamam /integracoes/*, autenticados por chave própria, sem cookie de sessão.
// Assim um túnel ou proxy apontado para o webhook não expõe junto as rotas internas do painel.

// No servidor não há Vite: o painel montado (vite build) é servido daqui, na mesma origem do /trpc — o
// cookie de sessão vale sem CORS, como no proxy do Vite em desenvolvimento. WEB_DIST só existe no container.
const webDist = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null;

// Maior coisa que o painel manda: nota de voz de até 10 MB, que em base64 vira ~13,4 MB. Acima disso a
// requisição é recusada antes de ser lida inteira — sem isso, quem nem fez login podia mandar centenas de
// MB e esgotar a memória do servidor.
const MAX_CORPO_PAINEL = 16 * 1024 * 1024;

const painel = express();
painel.disable("x-powered-by");
// No servidor, o proxy do easypanel fica na frente: confiar em um salto faz req.ip ser o IP de quem acessa
// (usado no limite de tentativas de login), sem aceitar X-Forwarded-For forjado pelo navegador.
if (process.env.NODE_ENV === "production") painel.set("trust proxy", 1);
painel.use(cabecalhosDeSeguranca(webDist));
painel.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
    maxBodySize: MAX_CORPO_PAINEL,
  }),
);
// Áudio de nota de voz, figurinha, imagens de template e do agente: gravados em disco (media/armazenamento.ts)
// e servidos daqui só para quem tem sessão — são mídias de clientes. A Meta não busca nada aqui: o worker lê
// o arquivo do disco e sobe para ela. "private" impede proxy/CDN de guardar cópia para outros.
painel.use(
  "/uploads",
  (req, res, next) => {
    usuarioDoCookie(req.headers.cookie).then(
      (usuario) => (usuario ? next() : res.status(401).end()),
      next,
    );
  },
  express.static(diretorioDeUploads(), { maxAge: "30d", immutable: true, setHeaders: (res) => res.setHeader("Cache-Control", "private, max-age=2592000, immutable") }),
);
painel.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// No servidor (easypanel) há um domínio só, apontado para o painel: o webhook da Meta e a API do n8n
// respondem também por aqui (https://<domínio>/webhooks/whatsapp e /integracoes). As duas rotas já
// têm autenticação própria (assinatura da Meta / chave de integração), como no servidor do webhook.
if (process.env.NODE_ENV === "production") {
  painel.use("/webhooks/whatsapp", criarWebhookWhatsapp());
  painel.use("/integracoes", criarRouterIntegracoes());
}

if (webDist && existsSync(path.join(webDist, "index.html"))) {
  painel.use(express.static(webDist, { index: false, maxAge: "1h" }));
  // A navegação do painel é por hash (#/...): qualquer outro GET devolve a página principal.
  painel.get(/^\/(?!trpc|uploads|health|webhooks|integracoes).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  console.log(`painel web servido de ${webDist}`);
}

const webhook = express();
webhook.disable("x-powered-by");
if (process.env.NODE_ENV === "production") webhook.set("trust proxy", 1);
webhook.use(cabecalhosDeSeguranca(null));
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
