import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { configInstagram, contasInstagram } from "@atendimento-academias/db";
import { eq } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import { getDb } from "../trpc/context.js";

// Páginas públicas (sem login) que a Meta exige para aprovar o app — política de privacidade e instruções de
// exclusão de dados — e os dois avisos que ela manda quando alguém remove o app do Instagram ou pede para
// apagar os dados. Quem opera a plataforma e o contato vêm do ambiente (PRIVACIDADE_EMPRESA / _EMAIL).

const ATUALIZADA_EM = "7 de outubro de 2026";

function empresa(): string {
  return process.env.PRIVACIDADE_EMPRESA?.trim() || "Allp Fit";
}

function contato(): string | null {
  return process.env.PRIVACIDADE_EMAIL?.trim() || null;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function documento(titulo: string, corpo: string): string {
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapar(titulo)} · Allp Chat</title></head>` +
    `<body style="margin:0;background:#faf8fc;color:#1a0b2e;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6">` +
    `<main style="max-width:46rem;margin:0 auto;padding:3rem 1.25rem 4rem">` +
    `<p style="margin:0 0 .5rem;font-weight:700;color:#6d28d9">Allp Chat</p>` +
    `<h1 style="margin:0 0 .25rem;font-size:1.75rem;line-height:1.25">${escapar(titulo)}</h1>` +
    `<p style="margin:0 0 2rem;color:#5b5370;font-size:.9rem">Atualizada em ${ATUALIZADA_EM}</p>` +
    corpo +
    `</main></body></html>`
  );
}

const h2 = (texto: string) => `<h2 style="margin:2rem 0 .5rem;font-size:1.15rem">${escapar(texto)}</h2>`;
const p = (html: string) => `<p style="margin:.5rem 0">${html}</p>`;
const lista = (itens: string[]) => `<ul style="margin:.5rem 0;padding-left:1.25rem">${itens.map((item) => `<li style="margin:.25rem 0">${item}</li>`).join("")}</ul>`;

function linhaDeContato(): string {
  const email = contato();
  return email
    ? `pelo e-mail <a href="mailto:${escapar(email)}" style="color:#6d28d9">${escapar(email)}</a>`
    : "pelos canais de atendimento da unidade com que você fala";
}

export function paginaPrivacidade(_req: Request, res: Response): void {
  const nome = escapar(empresa());
  res.type("html").send(
    documento(
      "Política de Privacidade",
      p(
        `O Allp Chat é a plataforma de atendimento usada pelas unidades da ${nome} para conversar com clientes pelo WhatsApp e pelo Instagram, enviar comunicados e acompanhar os resultados das contas da empresa nessas redes. Esta política explica quais dados tratamos, para quê e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).`,
      ) +
        h2("Quem é responsável pelos dados") +
        p(`A ${nome} é a controladora dos dados tratados na plataforma. Cada unidade acessa apenas os dados dos próprios clientes e das próprias contas.`) +
        h2("Quais dados tratamos") +
        lista([
          "<strong>Clientes que falam com uma unidade pelo WhatsApp:</strong> número de telefone, nome do perfil do WhatsApp, mensagens trocadas (texto, áudio, imagens e figurinhas), a situação de entrega e leitura das mensagens enviadas e as informações que a própria pessoa informa na conversa (por exemplo, para fazer a matrícula).",
          "<strong>Clientes que falam com uma unidade pelo Instagram:</strong> identificador da conta no Instagram, nome de usuário e nome público, e as mensagens diretas trocadas com a unidade.",
          "<strong>Contas do Instagram das unidades:</strong> identificador, nome de usuário, nome, foto de perfil, número de seguidores e de publicações, métricas de desempenho da conta e das publicações (alcance, visualizações, interações, visitas ao perfil e cliques) e o token de acesso concedido pela própria conta.",
          "<strong>Pessoas da equipe que usam o painel:</strong> nome, e-mail, senha (guardada apenas em forma de hash) e o registro de quem respondeu cada mensagem.",
        ]) +
        h2("Para que usamos") +
        lista([
          "Responder e organizar o atendimento aos clientes, inclusive com respostas automáticas e sugestões geradas por inteligência artificial, sempre com a possibilidade de atendimento por uma pessoa da equipe.",
          "Enviar comunicados e campanhas pelo WhatsApp a quem tem relacionamento com a unidade.",
          "Mostrar à unidade o desempenho da conta do Instagram e das campanhas, e acompanhar o andamento de cada cliente até a matrícula.",
          "Manter a segurança da plataforma e cumprir obrigações legais.",
        ]) +
        p("As bases legais são a execução de contrato ou de procedimentos preliminares a pedido do titular, o legítimo interesse da empresa em atender e se comunicar com seus clientes, e o consentimento, quando ele for exigido.") +
        h2("Com quem compartilhamos") +
        p("Não vendemos dados. Eles são compartilhados apenas com os fornecedores necessários para o funcionamento do serviço:") +
        lista([
          "<strong>Meta Platforms</strong> (WhatsApp e Instagram), por onde as mensagens são enviadas e recebidas e de onde vêm as métricas das contas;",
          "<strong>Anthropic</strong>, que processa o texto das conversas para gerar respostas automáticas e análises — sem usar esses dados para treinar modelos;",
          "<strong>provedores de hospedagem e banco de dados</strong>, que armazenam as informações em ambiente protegido.",
        ]) +
        h2("Dados do Instagram") +
        p(
          "Os dados obtidos pela API do Instagram são usados apenas para mostrar à própria unidade o desempenho da conta dela e para o atendimento das mensagens diretas. Não são usados para publicidade, não são vendidos e não são compartilhados com outras unidades ou terceiros além dos listados acima. O acesso pode ser revogado a qualquer momento pela conta, nas configurações do Instagram (Apps e sites) ou pelo botão “Desconectar” no painel; quando isso acontece, apagamos a conta conectada e as métricas guardadas.",
        ) +
        h2("Por quanto tempo guardamos") +
        p(
          "Pelo tempo necessário para o atendimento e o relacionamento com o cliente e para cumprir obrigações legais. Dados de contas do Instagram desconectadas são apagados no momento da desconexão.",
        ) +
        h2("Segurança") +
        p(
          "Tokens de acesso e segredos são guardados cifrados; o acesso ao painel exige login, e cada pessoa só vê os dados da própria unidade. As comunicações usam conexão criptografada (HTTPS).",
        ) +
        h2("Seus direitos") +
        p(
          "Você pode pedir a confirmação de que tratamos seus dados, o acesso, a correção, a anonimização ou a exclusão deles, a portabilidade, informações sobre o compartilhamento e revogar o consentimento (art. 18 da LGPD). Veja como pedir a exclusão em <a href=\"/exclusao-de-dados\" style=\"color:#6d28d9\">Exclusão de dados</a>.",
        ) +
        h2("Contato") +
        p(`Para qualquer pedido ou dúvida sobre seus dados, fale com a ${nome} ${linhaDeContato()}.`) +
        h2("Alterações") +
        p("Esta política pode ser atualizada; a data no topo indica a versão em vigor."),
    ),
  );
}

export function paginaExclusao(req: Request, res: Response): void {
  const codigo = typeof req.query.codigo === "string" ? req.query.codigo.replace(/[^\w-]/g, "").slice(0, 64) : "";
  const confirmacao = codigo
    ? `<div style="border:1px solid #a7f3d0;background:#ecfdf5;border-radius:.75rem;padding:1rem 1.25rem;margin-bottom:1.5rem">` +
      `<strong>Pedido de exclusão recebido.</strong> Código de confirmação: <code>${escapar(codigo)}</code>. A conta do Instagram e os dados coletados dela foram apagados da plataforma.</div>`
    : "";
  res.type("html").send(
    documento(
      "Exclusão de dados",
      confirmacao +
        p("Você pode pedir a exclusão dos seus dados do Allp Chat a qualquer momento. Escolha o caso que se aplica:") +
        h2("Sou responsável por uma conta do Instagram conectada") +
        lista([
          "No painel do Allp Chat, vá em <strong>Configurações → Instagram da unidade → Desconectar</strong>; ou",
          "No Instagram, vá em <strong>Configurações → Apps e sites</strong>, encontre o Allp Chat e toque em <strong>Remover</strong>.",
        ]) +
        p("Nos dois casos, apagamos na hora a conta conectada, o token de acesso e as métricas guardadas dela.") +
        h2("Sou cliente e conversei com uma unidade pelo WhatsApp ou pelo Instagram") +
        p(
          `Peça a exclusão ${linhaDeContato()}, informando o número de telefone ou o nome de usuário usado na conversa. Confirmamos o pedido e apagamos seus dados em até 15 dias, exceto o que a lei nos obrigar a manter.`,
        ) +
        p('Mais detalhes na <a href="/privacidade" style="color:#6d28d9">Política de Privacidade</a>.'),
    ),
  );
}

// signed_request da Meta: "<assinatura>.<dados>", os dois em base64url; a assinatura é o HMAC-SHA256 dos
// dados com o segredo do app. Sem assinatura válida, o pedido é ignorado.
export function lerSignedRequest(signedRequest: string, segredo: string): Record<string, unknown> | null {
  const [assinatura, dados] = signedRequest.split(".", 2);
  if (!assinatura || !dados) return null;
  const esperada = createHmac("sha256", segredo).update(dados).digest();
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    return JSON.parse(Buffer.from(dados, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function apagarContaDoAviso(req: Request): Promise<{ apagada: boolean } | null> {
  const config = configInstagram();
  const signed = typeof req.body?.signed_request === "string" ? req.body.signed_request : "";
  if (!config || !signed) return null;
  const dados = lerSignedRequest(signed, config.appSecret);
  if (!dados) return null;
  const igUserId = String(dados.user_id ?? "");
  if (!igUserId) return { apagada: false };
  const apagadas = await getDb().delete(contasInstagram).where(eq(contasInstagram.igUserId, igUserId)).returning({ username: contasInstagram.username });
  if (apagadas[0]) console.log(`[instagram] @${apagadas[0].username} removeu o app: conta e métricas apagadas`);
  return { apagada: apagadas.length > 0 };
}

// Avisos que a Meta manda para cá (cadastrados no "login empresarial do Instagram").
export function criarAvisosDaMeta(): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "16kb" }));

  // A conta removeu o Allp Chat nas configurações do Instagram.
  router.post("/desautorizar", async (req, res) => {
    const resultado = await apagarContaDoAviso(req);
    res.sendStatus(resultado ? 200 : 400);
  });

  // Pedido de exclusão de dados: a Meta espera uma URL para a pessoa acompanhar e um código de confirmação.
  router.post("/exclusao-de-dados", async (req, res) => {
    const resultado = await apagarContaDoAviso(req);
    if (!resultado) {
      res.sendStatus(400);
      return;
    }
    const codigo = randomBytes(8).toString("hex");
    const base = process.env.PAINEL_URL_PUBLICA?.replace(/\/+$/, "") ?? `${req.protocol}://${req.get("host")}`;
    res.json({ url: `${base}/exclusao-de-dados?codigo=${codigo}`, confirmation_code: codigo });
  });

  return router;
}
