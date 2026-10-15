import { Redis } from "ioredis";

// Contadores com janela de tempo (tentativas de login, chave de integração errada, mensagens para o bot).
// Ficam no Redis: valem entre reinícios e entre réplicas da API. Se o Redis cair, a contagem segue na
// memória deste processo (o freio continua, só menos preciso) em vez de travar o login.

const PREFIXO = "limite:";
let redis: Redis | null | undefined;

function cliente(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  redis = url ? new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 1500 }) : null;
  redis?.on("error", () => {
    // Sem log a cada tentativa de reconexão: quem avisa do Redis fora é a tela de saúde.
  });
  return redis;
}

const memoria = new Map<string, { total: number; expira: number }>();

function naMemoria(chave: string, agora = Date.now()) {
  const item = memoria.get(chave);
  if (item && item.expira <= agora) {
    memoria.delete(chave);
    return undefined;
  }
  return item;
}

function limparMemoria(agora: number) {
  if (memoria.size < 10_000) return;
  for (const [chave, item] of memoria) if (item.expira <= agora) memoria.delete(chave);
}

export interface Contagem {
  total: number;
  // Quanto falta para a janela acabar (ms); 0 quando não há contagem.
  restanteMs: number;
}

export async function lerContagem(chave: string): Promise<Contagem> {
  const r = cliente();
  if (r) {
    try {
      const [[, total], [, ttl]] = (await r.multi().get(PREFIXO + chave).pttl(PREFIXO + chave).exec()) as [[null, string | null], [null, number]];
      return { total: Number(total ?? 0), restanteMs: Math.max(0, ttl) };
    } catch {
      // cai para a memória
    }
  }
  const item = naMemoria(chave);
  return item ? { total: item.total, restanteMs: item.expira - Date.now() } : { total: 0, restanteMs: 0 };
}

// Soma 1 e devolve o total da janela (a janela começa na primeira contagem).
export async function somarContagem(chave: string, janelaMs: number): Promise<number> {
  const r = cliente();
  if (r) {
    try {
      const [[, total]] = (await r.multi().incr(PREFIXO + chave).pexpire(PREFIXO + chave, janelaMs, "NX").exec()) as [[null, number], unknown];
      return total;
    } catch {
      // cai para a memória
    }
  }
  const agora = Date.now();
  limparMemoria(agora);
  const item = naMemoria(chave, agora);
  if (item) {
    item.total += 1;
    return item.total;
  }
  memoria.set(chave, { total: 1, expira: agora + janelaMs });
  return 1;
}

export async function zerarContagem(chave: string): Promise<void> {
  memoria.delete(chave);
  const r = cliente();
  if (r) await r.del(PREFIXO + chave).catch(() => undefined);
}

// Quantas mensagens de um mesmo cliente acionam o bot (n8n/IA). Cada acionamento custa uma chamada de IA;
// sem freio, um número mandando mensagem sem parar vira custo sem limite. Passou do limite do minuto, a
// mensagem fica só para a equipe; passou do limite do dia, a conversa vai para uma pessoa.
const BOT_MAX_POR_MINUTO = 8;
const BOT_MAX_POR_DIA = 150;

export type LimiteDoBot = "ok" | "minuto" | "dia" | "dia_agora";

export async function limiteDoBot(conversa: string): Promise<LimiteDoBot> {
  const [porMinuto, porDia] = await Promise.all([somarContagem(`bot:min:${conversa}`, 60_000), somarContagem(`bot:dia:${conversa}`, 86_400_000)]);
  if (porDia === BOT_MAX_POR_DIA + 1) return "dia_agora";
  if (porDia > BOT_MAX_POR_DIA) return "dia";
  if (porMinuto > BOT_MAX_POR_MINUTO) return "minuto";
  return "ok";
}

export const MOTIVO_LIMITE_DO_BOT = "Muitas mensagens em pouco tempo: o bot parou de responder esta conversa por hoje.";
