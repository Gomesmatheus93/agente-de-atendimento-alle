import { randomBytes } from "node:crypto";
import {
  CHAVE_INTEGRACAO_FINAL,
  CHAVE_INTEGRACAO_HASH,
  CHAVE_MODO_AGENTE,
  CHAVE_N8N_WEBHOOK_URL,
  CHAVE_WEBHOOK_APP_SECRET,
  CHAVE_WEBHOOK_VERIFY_TOKEN,
  cifrar,
  configuracoes,
  contasWhatsapp,
  decifrar,
  gerarHashDeSenha,
  MODOS_AGENTE,
  numerosWhatsapp,
  senhaConfere,
  unidades,
  type Db,
  type ModoAgente,
} from "@atendimento-academias/db";
import { and, eq, inArray } from "drizzle-orm";

// O webhook é chamado a cada mensagem e a cada status: ler o banco toda vez seria desperdício, e um
// cache curto mantém a mudança feita na tela valendo em poucos segundos.
const VALIDADE_MS = 15_000;

interface Cache<T> {
  valor: T;
  em: number;
}

const cacheSegredos = new Map<number, Cache<string | null>>();
const cacheNumeros = new Map<string, Cache<{ id: number; contaId: number; unidadeId: number } | null>>();
const cacheTokens = new Map<number, Cache<string>>();

async function lerValor(db: Db, unidadeId: number, chave: string): Promise<string | null> {
  const [linha] = await db
    .select()
    .from(configuracoes)
    .where(and(eq(configuracoes.unidadeId, unidadeId), eq(configuracoes.chave, chave)));
  if (!linha) return null;
  return linha.secreto ? decifrar(linha.valor) : linha.valor;
}

// Cada unidade tem as próprias configurações (unidade_id + chave é único).
export async function salvarValor(db: Db, unidadeId: number, chave: string, valor: string, secreto = false): Promise<void> {
  const guardado = secreto ? cifrar(valor) : valor;
  await db
    .insert(configuracoes)
    .values({ unidadeId, chave, valor: guardado, secreto })
    .onConflictDoUpdate({ target: [configuracoes.unidadeId, configuracoes.chave], set: { valor: guardado, secreto } });
  if (chave === CHAVE_WEBHOOK_APP_SECRET) cacheSegredos.delete(unidadeId);
}

export async function configuracaoDoWebhook(db: Db, unidadeId: number): Promise<{ verifyToken: string | null; appSecret: string | null }> {
  const [verifyToken, appSecret] = await Promise.all([
    lerValor(db, unidadeId, CHAVE_WEBHOOK_VERIFY_TOKEN),
    lerValor(db, unidadeId, CHAVE_WEBHOOK_APP_SECRET),
  ]);
  return { verifyToken, appSecret };
}

// A Meta confere o webhook com o token que alguma unidade digitou no painel dela.
export async function tokenDeVerificacaoConhecido(db: Db, token: string): Promise<boolean> {
  const [linha] = await db
    .select({ id: configuracoes.id })
    .from(configuracoes)
    .where(and(eq(configuracoes.chave, CHAVE_WEBHOOK_VERIFY_TOKEN), eq(configuracoes.valor, token)))
    .limit(1);
  return Boolean(linha);
}

// Segredo do app da Meta da unidade: é com ele que se confere a assinatura dos eventos dos números dela.
export async function segredoDoAppDaUnidade(db: Db, unidadeId: number): Promise<string | null> {
  const guardado = cacheSegredos.get(unidadeId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;
  const valor = await lerValor(db, unidadeId, CHAVE_WEBHOOK_APP_SECRET);
  cacheSegredos.set(unidadeId, { valor, em: Date.now() });
  return valor;
}

// Unidade dona de cada conta (WABA) citada no evento: a Meta manda o id da conta em entry.id.
export async function unidadesDasContas(db: Db, wabaIds: string[]): Promise<Map<string, number>> {
  if (wabaIds.length === 0) return new Map();
  const linhas = await db
    .select({ wabaId: contasWhatsapp.wabaId, unidadeId: contasWhatsapp.unidadeId })
    .from(contasWhatsapp)
    .where(inArray(contasWhatsapp.wabaId, wabaIds));
  return new Map(linhas.map((linha) => [linha.wabaId, linha.unidadeId]));
}

// Devolve o número da operação correspondente ao destino do evento, ou null se ele não for nosso.
export async function numeroPeloPhoneNumberId(
  db: Db,
  phoneNumberId: string,
): Promise<{ id: number; contaId: number; unidadeId: number } | null> {
  const guardado = cacheNumeros.get(phoneNumberId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;

  const [linha] = await db
    .select({
      id: numerosWhatsapp.id,
      contaId: numerosWhatsapp.contaId,
      unidadeId: numerosWhatsapp.unidadeId,
      ativo: numerosWhatsapp.ativo,
      unidadeAtiva: unidades.ativo,
    })
    .from(numerosWhatsapp)
    .innerJoin(unidades, eq(unidades.id, numerosWhatsapp.unidadeId))
    .where(eq(numerosWhatsapp.phoneNumberId, phoneNumberId));

  // Número desativado (ou de unidade desativada) não recebe: desligar na tela precisa parar a entrada também.
  const valor = linha && linha.ativo && linha.unidadeAtiva ? { id: linha.id, contaId: linha.contaId, unidadeId: linha.unidadeId } : null;
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

// Gera uma chave nova para a unidade, substituindo a anterior (só uma por vez, como um token de API). Só o
// hash fica salvo — a chave em si é devolvida uma única vez, na hora de gerar. A chave carrega o número da
// unidade ("ac_u3_...") para a conferência achar o hash certo sem testar o de todas.
export async function gerarChaveIntegracao(db: Db, unidadeId: number): Promise<{ chave: string; chaveFinal: string }> {
  const chave = `${PREFIXO_CHAVE_INTEGRACAO}u${unidadeId}_${randomBytes(24).toString("base64url")}`;
  const chaveFinal = chave.slice(-4);

  await salvarValor(db, unidadeId, CHAVE_INTEGRACAO_HASH, await gerarHashDeSenha(chave));
  await salvarValor(db, unidadeId, CHAVE_INTEGRACAO_FINAL, chaveFinal);

  return { chave, chaveFinal };
}

export async function revogarChaveIntegracao(db: Db, unidadeId: number): Promise<void> {
  await db
    .delete(configuracoes)
    .where(and(eq(configuracoes.unidadeId, unidadeId), inArray(configuracoes.chave, [CHAVE_INTEGRACAO_HASH, CHAVE_INTEGRACAO_FINAL])));
}

export async function chaveIntegracaoFinal(db: Db, unidadeId: number): Promise<string | null> {
  return lerValor(db, unidadeId, CHAVE_INTEGRACAO_FINAL);
}

// Usado pelas rotas de /integracoes: confere a chave do cabeçalho Authorization e devolve de qual unidade
// ela é (null = inválida). Chaves de antes das unidades ("ac_<aleatório>") são conferidas contra todas.
export async function unidadeDaChaveIntegracao(db: Db, chaveApresentada: string | null): Promise<number | null> {
  if (!chaveApresentada) return null;

  const unidadeIndicada = /^ac_u(\d+)_/.exec(chaveApresentada)?.[1];
  const hashes = await db
    .select({ unidadeId: configuracoes.unidadeId, valor: configuracoes.valor })
    .from(configuracoes)
    .where(
      and(
        eq(configuracoes.chave, CHAVE_INTEGRACAO_HASH),
        unidadeIndicada ? eq(configuracoes.unidadeId, Number(unidadeIndicada)) : undefined,
      ),
    );

  for (const linha of hashes) {
    if (linha.unidadeId !== null && (await senhaConfere(chaveApresentada, linha.valor))) return linha.unidadeId;
  }
  return null;
}

const cacheModoAgente = new Map<number, Cache<{ modo: ModoAgente; webhookN8nUrl: string | null }>>();

// Quem recebe a mensagem quando a "IA de atendimento" está ligada numa conversa: o agente interno
// (Claude, vira rascunho pra equipe aprovar) ou o webhook do n8n (responde direto, sem revisão).
// Cada unidade escolhe o seu (e pode apontar para um fluxo do n8n próprio).
export async function configuracaoDoAgente(db: Db, unidadeId: number): Promise<{ modo: ModoAgente; webhookN8nUrl: string | null }> {
  const guardado = cacheModoAgente.get(unidadeId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;

  const [modoBruto, webhookN8nUrl] = await Promise.all([
    lerValor(db, unidadeId, CHAVE_MODO_AGENTE),
    lerValor(db, unidadeId, CHAVE_N8N_WEBHOOK_URL),
  ]);
  const modo: ModoAgente = MODOS_AGENTE.includes(modoBruto as ModoAgente) ? (modoBruto as ModoAgente) : "interno";

  const valor = { modo, webhookN8nUrl };
  cacheModoAgente.set(unidadeId, { valor, em: Date.now() });
  return valor;
}

export async function salvarConfiguracaoDoAgente(db: Db, unidadeId: number, modo: ModoAgente, webhookN8nUrl: string | null): Promise<void> {
  await salvarValor(db, unidadeId, CHAVE_MODO_AGENTE, modo);
  if (webhookN8nUrl !== null) await salvarValor(db, unidadeId, CHAVE_N8N_WEBHOOK_URL, webhookN8nUrl);
  cacheModoAgente.delete(unidadeId);
}
