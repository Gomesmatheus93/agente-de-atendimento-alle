import { randomBytes } from "node:crypto";
import {
  CHAVE_INTEGRACAO_FINAL,
  CHAVE_INTEGRACAO_HASH,
  CHAVE_MODO_AGENTE,
  CHAVE_N8N_WEBHOOK_URL,
  CHAVE_WEBHOOK_APP_SECRET,
  CHAVE_WEBHOOK_VERIFY_TOKEN,
  configuracoes,
  contasWhatsapp,
  decifrar,
  gerarHashDeSenha,
  MODOS_AGENTE,
  numerosWhatsapp,
  senhaConfere,
  type Db,
  type ModoAgente,
} from "@atendimento-academias/db";
import { eq, inArray } from "drizzle-orm";

// O webhook é chamado a cada mensagem e a cada status: ler o banco toda vez seria desperdício, e um
// cache curto mantém a mudança feita na tela valendo em poucos segundos.
const VALIDADE_MS = 15_000;

interface Cache<T> {
  valor: T;
  em: number;
}

let cacheWebhook: Cache<{ verifyToken: string | null; appSecret: string | null }> | undefined;
const cacheNumeros = new Map<string, Cache<{ id: number; contaId: number } | null>>();
const cacheTokens = new Map<number, Cache<string>>();

async function lerValor(db: Db, chave: string): Promise<string | null> {
  const [linha] = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave));
  if (!linha) return null;
  return linha.secreto ? decifrar(linha.valor) : linha.valor;
}

export async function configuracaoDoWebhook(db: Db): Promise<{ verifyToken: string | null; appSecret: string | null }> {
  if (cacheWebhook && Date.now() - cacheWebhook.em < VALIDADE_MS) return cacheWebhook.valor;

  const [verifyToken, appSecret] = await Promise.all([
    lerValor(db, CHAVE_WEBHOOK_VERIFY_TOKEN),
    lerValor(db, CHAVE_WEBHOOK_APP_SECRET),
  ]);

  cacheWebhook = { valor: { verifyToken, appSecret }, em: Date.now() };
  return cacheWebhook.valor;
}

// Devolve o número da operação correspondente ao destino do evento, ou null se ele não for nosso.
export async function numeroPeloPhoneNumberId(db: Db, phoneNumberId: string): Promise<{ id: number; contaId: number } | null> {
  const guardado = cacheNumeros.get(phoneNumberId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;

  const [linha] = await db
    .select({ id: numerosWhatsapp.id, contaId: numerosWhatsapp.contaId, ativo: numerosWhatsapp.ativo })
    .from(numerosWhatsapp)
    .where(eq(numerosWhatsapp.phoneNumberId, phoneNumberId));

  // Número conhecido mas desativado não recebe: desligar na tela precisa parar a entrada também.
  const valor = linha && linha.ativo ? { id: linha.id, contaId: linha.contaId } : null;
  cacheNumeros.set(phoneNumberId, { valor, em: Date.now() });
  return valor;
}

// Token de acesso da conta (WABA) que o webhook usa para baixar mídia recebida (áudio, figurinha) da Meta.
export async function tokenDaConta(db: Db, contaId: number): Promise<string> {
  const guardado = cacheTokens.get(contaId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;

  const [linha] = await db
    .select({ tokenCifrado: contasWhatsapp.tokenCifrado })
    .from(contasWhatsapp)
    .where(eq(contasWhatsapp.id, contaId));
  if (!linha) throw new Error(`Conta ${contaId} não encontrada`);

  const token = decifrar(linha.tokenCifrado);
  cacheTokens.set(contaId, { valor: token, em: Date.now() });
  return token;
}

const PREFIXO_CHAVE_INTEGRACAO = "ac_";

// Gera uma chave nova, substituindo a anterior (só uma por vez, como um token de API). Só o hash fica
// salvo — a chave em si é devolvida uma única vez, na hora de gerar, e não pode ser lida de novo depois.
export async function gerarChaveIntegracao(db: Db): Promise<{ chave: string; chaveFinal: string }> {
  const chave = `${PREFIXO_CHAVE_INTEGRACAO}${randomBytes(24).toString("base64url")}`;
  const hash = await gerarHashDeSenha(chave);
  const chaveFinal = chave.slice(-4);

  await db
    .insert(configuracoes)
    .values({ chave: CHAVE_INTEGRACAO_HASH, valor: hash, secreto: false })
    .onConflictDoUpdate({ target: configuracoes.chave,  set: { valor: hash } });
  await db
    .insert(configuracoes)
    .values({ chave: CHAVE_INTEGRACAO_FINAL, valor: chaveFinal, secreto: false })
    .onConflictDoUpdate({ target: configuracoes.chave,  set: { valor: chaveFinal } });

  return { chave, chaveFinal };
}

export async function revogarChaveIntegracao(db: Db): Promise<void> {
  await db.delete(configuracoes).where(eq(configuracoes.chave, CHAVE_INTEGRACAO_HASH));
  await db.delete(configuracoes).where(eq(configuracoes.chave, CHAVE_INTEGRACAO_FINAL));
}

export async function chaveIntegracaoFinal(db: Db): Promise<string | null> {
  const [linha] = await db.select({ valor: configuracoes.valor }).from(configuracoes).where(eq(configuracoes.chave, CHAVE_INTEGRACAO_FINAL));
  return linha?.valor ?? null;
}

// Usado pelas rotas de /integracoes: confere a chave do cabeçalho Authorization contra o hash salvo.
export async function chaveIntegracaoValida(db: Db, chaveApresentada: string | null): Promise<boolean> {
  if (!chaveApresentada) return false;

  const [linha] = await db.select({ valor: configuracoes.valor }).from(configuracoes).where(eq(configuracoes.chave, CHAVE_INTEGRACAO_HASH));
  if (!linha) return false;

  return senhaConfere(chaveApresentada, linha.valor);
}

let cacheModoAgente: Cache<{ modo: ModoAgente; webhookN8nUrl: string | null }> | undefined;

// Quem recebe a mensagem quando a "IA de atendimento" está ligada numa conversa: o agente interno
// (Claude, vira rascunho pra equipe aprovar) ou o webhook do n8n (responde direto, sem revisão).
export async function configuracaoDoAgente(db: Db): Promise<{ modo: ModoAgente; webhookN8nUrl: string | null }> {
  if (cacheModoAgente && Date.now() - cacheModoAgente.em < VALIDADE_MS) return cacheModoAgente.valor;

  const linhas = await db
    .select()
    .from(configuracoes)
    .where(inArray(configuracoes.chave, [CHAVE_MODO_AGENTE, CHAVE_N8N_WEBHOOK_URL]));

  const modoBruto = linhas.find((linha) => linha.chave === CHAVE_MODO_AGENTE)?.valor;
  const modo: ModoAgente = MODOS_AGENTE.includes(modoBruto as ModoAgente) ? (modoBruto as ModoAgente) : "interno";
  const webhookN8nUrl = linhas.find((linha) => linha.chave === CHAVE_N8N_WEBHOOK_URL)?.valor ?? null;

  const valor = { modo, webhookN8nUrl };
  cacheModoAgente = { valor, em: Date.now() };
  return valor;
}

export async function salvarConfiguracaoDoAgente(db: Db, modo: ModoAgente, webhookN8nUrl: string | null): Promise<void> {
  await db
    .insert(configuracoes)
    .values({ chave: CHAVE_MODO_AGENTE, valor: modo, secreto: false })
    .onConflictDoUpdate({ target: configuracoes.chave,  set: { valor: modo } });

  if (webhookN8nUrl !== null) {
    await db
      .insert(configuracoes)
      .values({ chave: CHAVE_N8N_WEBHOOK_URL, valor: webhookN8nUrl, secreto: false })
      .onConflictDoUpdate({ target: configuracoes.chave,  set: { valor: webhookN8nUrl } });
  }

  cacheModoAgente = undefined;
}
