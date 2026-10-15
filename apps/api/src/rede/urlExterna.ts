import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// URLs que um admin de unidade cadastra (webhook do n8n) e que o servidor chama sozinho. Sem esta
// conferência, alguém poderia apontar para um serviço interno da rede do servidor (localhost, 10.x,
// 169.254.169.254...) e usar a plataforma para alcançá-lo. Em produção só vale https para endereço público.

export class UrlNaoPermitida extends Error {}

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function ipPrivado(ip: string): boolean {
  const limpo = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(limpo) === 4) return ipv4Privado(limpo);
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpo);
  if (mapeado) return ipv4Privado(mapeado[1]!);
  return limpo === "::" || limpo === "::1" || limpo.startsWith("fc") || limpo.startsWith("fd") || limpo.startsWith("fe8") || limpo.startsWith("fe9") || limpo.startsWith("fea") || limpo.startsWith("feb");
}

function exigeEnderecoPublico(): boolean {
  return process.env.NODE_ENV === "production";
}

// Conferência na hora de salvar (sem rede): formato, https e host que não é IP interno nem "localhost".
export function motivoUrlRecusada(valor: string): string | null {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return "URL inválida.";
  }
  if (!exigeEnderecoPublico()) return url.protocol === "https:" || url.protocol === "http:" ? null : "Use uma URL http(s).";
  if (url.protocol !== "https:") return "Use uma URL https.";
  if (url.username || url.password) return "A URL não pode ter usuário e senha.";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return "Endereço interno não é permitido.";
  if (isIP(host.replace(/^\[|\]$/g, "")) && ipPrivado(host)) return "Endereço interno não é permitido.";
  return null;
}

// Na hora de chamar: o nome precisa resolver só para IPs públicos (um domínio pode apontar para 127.0.0.1).
export async function garantirUrlExterna(valor: string): Promise<URL> {
  const motivo = motivoUrlRecusada(valor);
  if (motivo) throw new UrlNaoPermitida(motivo);
  const url = new URL(valor);
  if (!exigeEnderecoPublico()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (enderecos.length === 0 || enderecos.some((e) => ipPrivado(e.address))) throw new UrlNaoPermitida(`${url.hostname} aponta para um endereço interno.`);
  return url;
}

// fetch para URL cadastrada por admin: confere o destino e não segue redirecionamento (que poderia levar
// para dentro da rede depois da conferência).
export async function fetchExterno(valor: string, init: RequestInit = {}): Promise<Response> {
  const url = await garantirUrlExterna(valor);
  return fetch(url, { ...init, redirect: "manual" });
}
