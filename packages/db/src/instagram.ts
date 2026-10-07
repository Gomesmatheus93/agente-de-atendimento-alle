import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { cifrar, decifrar } from "./cripto.js";
import { contasInstagram, instagramMetricasDiarias } from "./schema/instagram.js";

// API do Instagram com login do Instagram (graph.instagram.com): a conta profissional de cada unidade
// autoriza o app e devolve um token próprio. Usada pela API (conectar, posts) e pelo worker (coleta diária).

const VERSAO = "v23.0";
const GRAPH = `https://graph.instagram.com/${VERSAO}`;

// Pedidas já na conexão para a dona da unidade não precisar reconectar quando as DMs e o bot chegarem.
export const PERMISSOES_INSTAGRAM = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_insights",
] as const;

// Métricas da conta pedidas por dia (total do dia). A Meta muda a lista de tempos em tempos e algumas só
// existem para contas maiores: a que ela recusar fica de fora, sem derrubar as outras.
export const METRICAS_DA_CONTA = [
  "reach",
  "views",
  "profile_views",
  "accounts_engaged",
  "total_interactions",
  "website_clicks",
  "profile_links_taps",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

export const METRICAS_DO_POST = ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"] as const;

export class ErroInstagram extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo?: number,
  ) {
    super(message);
  }
}

export interface ConfigInstagram {
  appId: string;
  appSecret: string;
}

// O app do Instagram (produto "Instagram" no app da Meta) tem id e segredo próprios, diferentes dos do
// app do Facebook. São da plataforma inteira, vêm do ambiente.
export function configInstagram(): ConfigInstagram | null {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

async function lerResposta<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();
  let corpo: { error?: { message?: string; code?: number; error_user_msg?: string }; error_message?: string } & Record<string, unknown>;
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch {
    throw new ErroInstagram(`Resposta inesperada do Instagram (HTTP ${resposta.status})`, resposta.status);
  }
  if (!resposta.ok || corpo.error || corpo.error_message) {
    const mensagem = corpo.error?.error_user_msg ?? corpo.error?.message ?? corpo.error_message ?? `HTTP ${resposta.status}`;
    throw new ErroInstagram(mensagem, resposta.status, corpo.error?.code);
  }
  return corpo as T;
}

async function get<T>(caminho: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(caminho.startsWith("http") ? caminho : `${GRAPH}/${caminho}`);
  for (const [chave, valor] of Object.entries(params)) url.searchParams.set(chave, valor);
  let resposta: Response;
  try {
    resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (erro) {
    throw new ErroInstagram(`Não foi possível falar com o Instagram: ${erro instanceof Error ? erro.message : String(erro)}`, 0);
  }
  return lerResposta<T>(resposta);
}

// ---------- Conexão (login do Instagram) ----------

export function urlDeAutorizacao(config: ConfigInstagram, redirectUri: string, estado: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PERMISSOES_INSTAGRAM.join(","));
  url.searchParams.set("state", estado);
  return url.toString();
}

// Código da volta do login → token curto (1 h) → token longo (60 dias).
export async function trocarCodigoPorToken(
  config: ConfigInstagram,
  codigo: string,
  redirectUri: string,
): Promise<{ token: string; expiraEm: Date }> {
  const curto = await lerResposta<{ access_token: string }>(
    await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        // O Instagram às vezes devolve o código com "#_" no fim, que não faz parte dele.
        code: codigo.replace(/#_$/, ""),
      }),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  const longo = await get<{ access_token: string; expires_in: number }>(
    "https://graph.instagram.com/access_token",
    { grant_type: "ig_exchange_token", client_secret: config.appSecret },
    curto.access_token,
  );
  return { token: longo.access_token, expiraEm: new Date(Date.now() + longo.expires_in * 1000) };
}

// O token longo vale 60 dias e pode ser renovado (depois de 24 h de vida) por mais 60.
export async function renovarToken(token: string): Promise<{ token: string; expiraEm: Date }> {
  const novo = await get<{ access_token: string; expires_in: number }>(
    "https://graph.instagram.com/refresh_access_token",
    { grant_type: "ig_refresh_token" },
    token,
  );
  return { token: novo.access_token, expiraEm: new Date(Date.now() + novo.expires_in * 1000) };
}

export interface PerfilInstagram {
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  account_type?: string;
}

export function buscarPerfil(token: string): Promise<PerfilInstagram> {
  return get<PerfilInstagram>(
    "me",
    { fields: "user_id,username,name,profile_picture_url,followers_count,follows_count,media_count,account_type" },
    token,
  );
}

// ---------- Insights ----------

interface RespostaInsights {
  data?: Array<{ name: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }>;
}

function somarResposta(resposta: RespostaInsights): Record<string, number> {
  const valores: Record<string, number> = {};
  for (const item of resposta.data ?? []) {
    const valor = item.total_value?.value ?? item.values?.reduce((soma, ponto) => soma + (ponto.value ?? 0), 0);
    if (typeof valor === "number") valores[item.name] = valor;
  }
  return valores;
}

// Pede um lote de métricas de uma vez; se a Meta recusar o lote (basta uma métrica que ela não aceita),
// pede uma a uma e fica com as que vierem.
async function metricasComFolga(
  caminho: string,
  metricas: readonly string[],
  params: Record<string, string>,
  token: string,
): Promise<Record<string, number>> {
  try {
    return somarResposta(await get<RespostaInsights>(caminho, { ...params, metric: metricas.join(",") }, token));
  } catch (erro) {
    if (erro instanceof ErroInstagram && (erro.status === 401 || erro.codigo === 190)) throw erro;
    const valores: Record<string, number> = {};
    for (const metrica of metricas) {
      try {
        Object.assign(valores, somarResposta(await get<RespostaInsights>(caminho, { ...params, metric: metrica }, token)));
      } catch (erroDaMetrica) {
        if (erroDaMetrica instanceof ErroInstagram && (erroDaMetrica.status === 401 || erroDaMetrica.codigo === 190)) throw erroDaMetrica;
      }
    }
    return valores;
  }
}

// Dia no fuso de Brasília ("YYYY-MM-DD") → intervalo em segundos, como a API pede.
function intervaloDoDia(dia: string): { since: string; until: string } {
  const inicio = new Date(`${dia}T00:00:00-03:00`).getTime() / 1000;
  return { since: String(inicio), until: String(inicio + 86_400) };
}

export function metricasDoDia(igUserId: string, token: string, dia: string): Promise<Record<string, number>> {
  return metricasComFolga(`${igUserId}/insights`, METRICAS_DA_CONTA, { period: "day", metric_type: "total_value", ...intervaloDoDia(dia) }, token);
}

export interface PostInstagram {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export async function listarPosts(igUserId: string, token: string, desde: Date, limite = 100): Promise<PostInstagram[]> {
  const posts: PostInstagram[] = [];
  let proxima: string | undefined = `${igUserId}/media`;
  let params: Record<string, string> = {
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: "50",
  };
  while (proxima && posts.length < limite) {
    const pagina: { data?: PostInstagram[]; paging?: { next?: string } } = await get(proxima, params, token);
    const doPeriodo = (pagina.data ?? []).filter((post) => new Date(post.timestamp) >= desde);
    posts.push(...doPeriodo);
    // A lista vem do mais novo para o mais antigo: quando um post já é anterior ao período, parou.
    if (doPeriodo.length < (pagina.data?.length ?? 0)) break;
    proxima = pagina.paging?.next;
    params = {};
  }
  return posts.slice(0, limite);
}

export function metricasDoPost(mediaId: string, token: string): Promise<Record<string, number>> {
  return metricasComFolga(`${mediaId}/insights`, METRICAS_DO_POST, {}, token);
}

// ---------- Coleta (worker) ----------

export function hojeEmBrasilia(deslocamentoDias = 0): string {
  const data = new Date(Date.now() + deslocamentoDias * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(data);
}

export function tokenDaContaInstagram(conta: { tokenCifrado: string }): string {
  return decifrar(conta.tokenCifrado);
}

// Grava a "foto" dos últimos `dias` dias da conta (o de ontem para trás; hoje ainda não fechou) e atualiza
// nome, foto e seguidores. Seguidores do dia é o número no momento da coleta: a Meta não devolve o
// histórico dele de forma confiável.
export async function coletarInstagram(db: Db, contaId: number, dias = 1): Promise<{ dias: number; metricas: number }> {
  const [conta] = await db.select().from(contasInstagram).where(eq(contasInstagram.id, contaId));
  if (!conta) return { dias: 0, metricas: 0 };
  const token = tokenDaContaInstagram(conta);

  try {
    const perfil = await buscarPerfil(token);
    let metricas = 0;
    for (let deslocamento = dias; deslocamento >= 1; deslocamento -= 1) {
      const dia = hojeEmBrasilia(-deslocamento);
      const valores = await metricasDoDia(conta.igUserId, token, dia);
      metricas += Object.keys(valores).length;
      await db
        .insert(instagramMetricasDiarias)
        .values({ contaId, dia, metricas: valores, seguidores: deslocamento === 1 ? (perfil.followers_count ?? null) : null })
        .onConflictDoUpdate({
          target: [instagramMetricasDiarias.contaId, instagramMetricasDiarias.dia],
          set: {
            metricas: valores,
            // Não apaga o número de seguidores já registrado de um dia passado.
            seguidores: deslocamento === 1 ? (perfil.followers_count ?? null) : sql`${instagramMetricasDiarias.seguidores}`,
          },
        });
    }
    await db
      .update(contasInstagram)
      .set({
        username: perfil.username,
        nome: perfil.name ?? null,
        fotoUrl: perfil.profile_picture_url ?? null,
        ultimaColetaEm: new Date(),
        erroColeta: null,
      })
      .where(eq(contasInstagram.id, contaId));
    return { dias, metricas };
  } catch (erro) {
    const mensagem = erro instanceof ErroInstagram && (erro.status === 401 || erro.codigo === 190)
      ? "O Instagram não aceitou mais o acesso (senha trocada ou permissão retirada). Conecte de novo em Configurações."
      : `Falha ao buscar os dados do Instagram: ${erro instanceof Error ? erro.message : String(erro)}`;
    await db.update(contasInstagram).set({ erroColeta: mensagem.slice(0, 500) }).where(eq(contasInstagram.id, contaId));
    throw erro;
  }
}

// Renova os tokens que vencem nos próximos 15 dias (o worker roda todo dia: sobra folga se a Meta falhar).
export async function renovarTokensInstagram(db: Db): Promise<number> {
  const vencendo = await db
    .select()
    .from(contasInstagram)
    .where(and(lt(contasInstagram.tokenExpiraEm, new Date(Date.now() + 15 * 86_400_000))));
  let renovados = 0;
  for (const conta of vencendo) {
    try {
      const novo = await renovarToken(tokenDaContaInstagram(conta));
      await db
        .update(contasInstagram)
        .set({ tokenCifrado: cifrar(novo.token), tokenExpiraEm: novo.expiraEm })
        .where(eq(contasInstagram.id, conta.id));
      renovados += 1;
    } catch (erro) {
      console.error(`[instagram] não foi possível renovar o token de @${conta.username}:`, erro);
    }
  }
  return renovados;
}
