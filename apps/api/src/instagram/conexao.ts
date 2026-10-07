import { randomBytes } from "node:crypto";
import { buscarPerfil, cifrar, configInstagram, contasInstagram, ErroInstagram, trocarCodigoPorToken, urlDeAutorizacao } from "@atendimento-academias/db";
import { eq } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import { pedirColetaInstagram } from "../queue.js";
import { getDb, usuarioDoCookie } from "../trpc/context.js";

// "Conectar Instagram" (Configurações): o painel manda a pessoa para o login do Instagram, que volta em
// /instagram/retorno com um código. Fica no servidor do painel porque precisa da sessão (cookie) para saber
// de qual unidade é a conta e se quem conectou é o administrador dela.

const VALIDADE_ESTADO_MS = 10 * 60_000;
// Dias de histórico buscados logo depois de conectar (os anteriores a isso a Meta nem sempre devolve).
const DIAS_INICIAIS = 7;

// "state" do OAuth: amarra a volta a quem começou a conexão (e evita que outro site conecte uma conta na
// unidade de alguém). Em memória: vale por 10 minutos, num processo só.
const estados = new Map<string, { unidadeId: number; usuarioId: number; expira: number }>();

export function urlDeRetorno(req: Request): string {
  const base = process.env.PAINEL_URL_PUBLICA?.replace(/\/+$/, "") ?? `${req.protocol}://${req.get("host")}`;
  return `${base}/instagram/retorno`;
}

function pagina(res: Response, status: number, titulo: string, texto: string): void {
  const escapar = (valor: string) => valor.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram · Allp Chat</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a0b2e">` +
        `<h1 style="font-size:1.25rem">${escapar(titulo)}</h1><p>${escapar(texto)}</p>` +
        `<p><a href="/#/configuracoes" style="color:#6d28d9;font-weight:600">Voltar para Configurações</a></p></body></html>`,
    );
}

export function criarRotasInstagram(): Router {
  const router = express.Router();

  router.get("/conectar", async (req, res) => {
    const usuario = await usuarioDoCookie(req.headers.cookie);
    if (!usuario) return res.redirect("/");
    if (usuario.unidadeId === null || (usuario.papel !== "admin" && usuario.papel !== "superadmin")) {
      return pagina(res, 403, "Sem permissão", "Só o administrador da unidade pode conectar o Instagram.");
    }
    const config = configInstagram();
    if (!config) {
      return pagina(
        res,
        503,
        "Instagram ainda não configurado",
        "A plataforma ainda não tem o app do Instagram configurado (INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET). Fale com o responsável pela plataforma.",
      );
    }
    const agora = Date.now();
    for (const [chave, valor] of estados) if (valor.expira < agora) estados.delete(chave);
    const estado = randomBytes(24).toString("base64url");
    estados.set(estado, { unidadeId: usuario.unidadeId, usuarioId: usuario.id, expira: agora + VALIDADE_ESTADO_MS });
    res.redirect(urlDeAutorizacao(config, urlDeRetorno(req), estado));
  });

  router.get("/retorno", async (req, res) => {
    const estado = typeof req.query.state === "string" ? req.query.state : "";
    const pendente = estados.get(estado);
    estados.delete(estado);
    const usuario = await usuarioDoCookie(req.headers.cookie);
    if (!pendente || pendente.expira < Date.now() || !usuario || usuario.id !== pendente.usuarioId) {
      return pagina(res, 400, "Conexão expirada", "A conexão com o Instagram demorou demais ou foi iniciada em outro navegador. Tente de novo em Configurações.");
    }
    if (typeof req.query.error === "string") {
      return pagina(res, 400, "Conexão cancelada", "O Instagram não foi conectado: a autorização foi recusada ou cancelada.");
    }
    const codigo = typeof req.query.code === "string" ? req.query.code : "";
    const config = configInstagram();
    if (!codigo || !config) return pagina(res, 400, "Conexão incompleta", "O Instagram não devolveu a autorização. Tente de novo.");

    try {
      const { token, expiraEm } = await trocarCodigoPorToken(config, codigo, urlDeRetorno(req));
      const perfil = await buscarPerfil(token);
      const db = getDb();
      const [outra] = await db.select().from(contasInstagram).where(eq(contasInstagram.igUserId, perfil.user_id));
      if (outra && outra.unidadeId !== pendente.unidadeId) {
        return pagina(res, 409, "Conta já conectada", `@${perfil.username} já está conectado em outra unidade. Cada unidade precisa do próprio Instagram.`);
      }
      const valores = {
        igUserId: perfil.user_id,
        username: perfil.username,
        nome: perfil.name ?? null,
        fotoUrl: perfil.profile_picture_url ?? null,
        tokenCifrado: cifrar(token),
        tokenExpiraEm: expiraEm,
        erroColeta: null,
      };
      const [conta] = await db
        .insert(contasInstagram)
        .values({ unidadeId: pendente.unidadeId, ...valores })
        .onConflictDoUpdate({ target: contasInstagram.unidadeId, set: valores })
        .returning({ id: contasInstagram.id });
      pedirColetaInstagram(conta!.id, DIAS_INICIAIS);
      console.log(`[instagram] @${perfil.username} conectado na unidade ${pendente.unidadeId}`);
      res.redirect("/#/instagram");
    } catch (erro) {
      console.error("[instagram] falha ao conectar:", erro);
      const detalhe = erro instanceof ErroInstagram ? erro.message : "erro inesperado";
      pagina(res, 502, "Não foi possível conectar", `O Instagram recusou a conexão (${detalhe}). Confira se a conta é profissional e tente de novo.`);
    }
  });

  return router;
}
