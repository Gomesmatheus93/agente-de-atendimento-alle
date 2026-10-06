import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RequestHandler } from "express";

// Cabeçalhos que mandam o navegador se proteger: não adivinhar tipo de arquivo, não deixar outro site
// abrir o painel dentro de um iframe (clickjacking), não vazar a URL para fora e, no servidor (https),
// nunca mais aceitar http.
const BASICOS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), payment=()",
};

// O index.html do painel tem um script embutido (escolhe o tema antes de pintar a tela). Em vez de
// liberar qualquer script embutido, a política libera só esse, pelo hash do conteúdo.
function hashesDosScriptsEmbutidos(webDist: string | null): string[] {
  if (!webDist) return [];
  const arquivo = path.join(webDist, "index.html");
  if (!existsSync(arquivo)) return [];
  const html = readFileSync(arquivo, "utf8");
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, conteudo]) => `'sha256-${createHash("sha256").update(conteudo!).digest("base64")}'`,
  );
}

// O que o painel pode carregar: só da própria origem, mais as fontes do Google e as fotos de perfil que a
// Meta devolve por https. Um script injetado de fora não roda, e o painel não pode ser embutido.
function politicaDeConteudo(webDist: string | null): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashesDosScriptsEmbutidos(webDist).join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function cabecalhosDeSeguranca(webDist: string | null): RequestHandler {
  const producao = process.env.NODE_ENV === "production";
  const csp = politicaDeConteudo(webDist);
  return (_req, res, next) => {
    for (const [nome, valor] of Object.entries(BASICOS)) res.setHeader(nome, valor);
    // Em desenvolvimento quem serve as páginas é o Vite (com scripts próprios); a política vale no servidor.
    if (producao) {
      res.setHeader("Content-Security-Policy", csp);
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

// Freio para quem chama a API de integração com chave errada: conferir a chave custa um scrypt, então
// sem isso um robô poderia ocupar a CPU do servidor com chaves inventadas. Mesmo esquema do login.
const JANELA_MS = 15 * 60_000;
const MAX_FALHAS = 30;
const falhasDeChave = new Map<string, { falhas: number; desde: number }>();

export function chaveBloqueada(ip: string): boolean {
  const contagem = falhasDeChave.get(ip);
  if (!contagem) return false;
  if (Date.now() - contagem.desde > JANELA_MS) {
    falhasDeChave.delete(ip);
    return false;
  }
  return contagem.falhas >= MAX_FALHAS;
}

export function registrarFalhaDeChave(ip: string): void {
  const agora = Date.now();
  const contagem = falhasDeChave.get(ip);
  if (contagem && agora - contagem.desde <= JANELA_MS) contagem.falhas += 1;
  else falhasDeChave.set(ip, { falhas: 1, desde: agora });
  if (falhasDeChave.size > 10_000) {
    for (const [chave, valor] of falhasDeChave) if (agora - valor.desde > JANELA_MS) falhasDeChave.delete(chave);
  }
}
