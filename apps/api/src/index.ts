import { existsSync } from "node:fs";
import path from "node:path";
import * as trpcExpress from "@trpc/server/adapters/express";
import express from "express";
import { criarRouterIntegracoes } from "./integracoes/router.js";
import { criarRotasInstagram } from "./instagram/conexao.js";
import { criarAvisosDaMeta, paginaExclusao, paginaPrivacidade } from "./instagram/paginasPublicas.js";
import { ArquivoNaoEncontrado, lerArquivo, nomeDoArquivo } from "@atendimento-academias/db";
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
// Arquivos (áudios, figurinhas, imagens, documentos, imagens de template e do agente): no S3 ou na pasta local
// (packages/db/src/armazenamento.ts), servidos daqui só para quem tem sessão — são mídias de clientes. A Meta não
// busca nada aqui: o worker lê o arquivo e sobe para ela. "private" impede proxy/CDN de guardar cópia.
painel.get("/uploads/:arquivo", async (req, res) => {
  const usuario = await usuarioDoCookie(req.headers.cookie).catch(() => null);
  if (!usuario) {
    res.status(401).end();
    return;
  }
  try {
    const { buffer, mimeType } = await lerArquivo(req.params.arquivo);
    // O arquivo pode vir do cliente (documento qualquer). Só imagem, vídeo, áudio, PDF e texto abrem no
    // navegador; o resto (um .html, por exemplo) baixa, para não rodar dentro do painel. E nada roda script.
    const base = mimeType.split(";")[0]!.trim().toLowerCase();
    const abreNoNavegador = /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(base) || base === "application/pdf" || base === "text/plain";
    const nome = typeof req.query.nome === "string" && req.query.nome.trim() ? req.query.nome.trim().slice(0, 255) : nomeDoArquivo(req.params.arquivo);
    res.setHeader("Content-Type", abreNoNavegador ? mimeType : "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // O leitor de PDF do Chrome não abre sob "sandbox"; ele já roda isolado do painel.
    if (base !== "application/pdf") res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
    res.setHeader(
      "Content-Disposition",
      `${abreNoNavegador ? "inline" : "attachment"}; filename="${nome.replace(/[^\w.\- ]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    );
    res.send(buffer);
  } catch (erro) {
    res.status(erro instanceof ArquivoNaoEncontrado ? 404 : 500).end();
  }
});
painel.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Conectar o Instagram de uma unidade (login do Instagram e volta com a autorização).
painel.use("/instagram", criarRotasInstagram());
painel.use("/instagram", criarAvisosDaMeta());
// Páginas públicas que a Meta exige para aprovar o app (sem login).
painel.get("/privacidade", paginaPrivacidade);
painel.get("/exclusao-de-dados", paginaExclusao);

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
  painel.get(/^\/(?!trpc|uploads|health|webhooks|integracoes|instagram|privacidade|exclusao-de-dados).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
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
