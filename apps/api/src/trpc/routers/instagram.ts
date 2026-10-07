import {
  buscarPerfil,
  configInstagram,
  contasInstagram,
  ErroInstagram,
  hojeEmBrasilia,
  instagramMetricasDiarias,
  listarPosts,
  metricasDoPost,
  tokenDaContaInstagram,
  type PerfilInstagram,
} from "@atendimento-academias/db";
import { insightsInstagramInputSchema } from "@atendimento-academias/shared";
import { and, asc, eq, gte } from "drizzle-orm";
import { pedirColetaInstagram } from "../../queue.js";
import { procedimentoAdmin, procedimentoUnidade, router } from "../trpc.js";

// Posts e perfil são lidos ao vivo da Meta (não ficam no banco); um cache curto evita gastar o limite de
// chamadas por hora da conta a cada vez que alguém abre a tela.
const CACHE_PERFIL_MS = 10 * 60_000;
const CACHE_POSTS_MS = 30 * 60_000;
const MAX_POSTS_COM_METRICAS = 24;
const MAX_POSTS_NA_TELA = 9;

interface Cache<T> {
  valor: T;
  em: number;
}
const cachePerfil = new Map<number, Cache<PerfilInstagram>>();
const cachePosts = new Map<string, Cache<PostComMetricas[]>>();

interface PostComMetricas {
  id: string;
  legenda: string;
  tipo: string;
  link: string | null;
  imagem: string | null;
  em: string;
  curtidas: number;
  comentarios: number;
  metricas: Record<string, number>;
}

async function perfilEmCache(contaId: number, token: string): Promise<PerfilInstagram | null> {
  const guardado = cachePerfil.get(contaId);
  if (guardado && Date.now() - guardado.em < CACHE_PERFIL_MS) return guardado.valor;
  try {
    const perfil = await buscarPerfil(token);
    cachePerfil.set(contaId, { valor: perfil, em: Date.now() });
    return perfil;
  } catch {
    return guardado?.valor ?? null;
  }
}

async function postsEmCache(contaId: number, igUserId: string, token: string, dias: number): Promise<PostComMetricas[]> {
  const chave = `${contaId}:${dias}`;
  const guardado = cachePosts.get(chave);
  if (guardado && Date.now() - guardado.em < CACHE_POSTS_MS) return guardado.valor;

  const posts = await listarPosts(igUserId, token, new Date(Date.now() - dias * 86_400_000));
  const comMetricas: PostComMetricas[] = [];
  for (const post of posts.slice(0, MAX_POSTS_COM_METRICAS)) {
    let metricas: Record<string, number> = {};
    try {
      metricas = await metricasDoPost(post.id, token);
    } catch {
      // post sem insights (ex.: de antes de virar conta profissional): fica só com curtidas e comentários
    }
    comMetricas.push({
      id: post.id,
      legenda: (post.caption ?? "").slice(0, 200),
      tipo: post.media_product_type === "REELS" ? "Reels" : post.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : post.media_type === "VIDEO" ? "Vídeo" : "Foto",
      link: post.permalink ?? null,
      imagem: post.thumbnail_url ?? post.media_url ?? null,
      em: post.timestamp,
      curtidas: post.like_count ?? metricas.likes ?? 0,
      comentarios: post.comments_count ?? metricas.comments ?? 0,
      metricas,
    });
  }
  cachePosts.set(chave, { valor: comMetricas, em: Date.now() });
  return comMetricas;
}

const somar = (linhas: Array<{ metricas: Record<string, number> }>, metrica: string) =>
  linhas.reduce((soma, linha) => soma + (linha.metricas[metrica] ?? 0), 0);

export const instagramRouter = router({
  // Situação da conexão da unidade (Configurações e topo da tela Instagram).
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const [conta] = await ctx.db.select().from(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    return {
      configurada: configInstagram() !== null,
      conta: conta
        ? {
            username: conta.username,
            nome: conta.nome,
            fotoUrl: conta.fotoUrl,
            conectadaEm: conta.createdAt.toISOString(),
            tokenExpiraEm: conta.tokenExpiraEm?.toISOString() ?? null,
            ultimaColetaEm: conta.ultimaColetaEm?.toISOString() ?? null,
            erroColeta: conta.erroColeta,
          }
        : null,
    };
  }),

  desconectar: procedimentoAdmin.mutation(async ({ ctx }) => {
    const [conta] = await ctx.db.delete(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId)).returning({ id: contasInstagram.id });
    if (conta) {
      cachePerfil.delete(conta.id);
      for (const chave of cachePosts.keys()) if (chave.startsWith(`${conta.id}:`)) cachePosts.delete(chave);
    }
    return { ok: true };
  }),

  atualizarAgora: procedimentoUnidade.mutation(async ({ ctx }) => {
    const [conta] = await ctx.db.select({ id: contasInstagram.id }).from(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    if (conta) {
      pedirColetaInstagram(conta.id, 2);
      cachePerfil.delete(conta.id);
      for (const chave of cachePosts.keys()) if (chave.startsWith(`${conta.id}:`)) cachePosts.delete(chave);
    }
    return { ok: Boolean(conta) };
  }),

  // Números do período comparados com o período anterior de mesmo tamanho, a série diária e os posts
  // que mais alcançaram.
  insights: procedimentoUnidade.input(insightsInstagramInputSchema).query(async ({ ctx, input }) => {
    const [conta] = await ctx.db.select().from(contasInstagram).where(eq(contasInstagram.unidadeId, ctx.unidadeId));
    if (!conta) return null;

    const inicioAtual = hojeEmBrasilia(-input.dias);
    const inicioAnterior = hojeEmBrasilia(-2 * input.dias);
    const linhas = await ctx.db
      .select()
      .from(instagramMetricasDiarias)
      .where(and(eq(instagramMetricasDiarias.contaId, conta.id), gte(instagramMetricasDiarias.dia, inicioAnterior)))
      .orderBy(asc(instagramMetricasDiarias.dia));
    const atual = linhas.filter((linha) => linha.dia >= inicioAtual);
    const anterior = linhas.filter((linha) => linha.dia < inicioAtual);

    const token = tokenDaContaInstagram(conta);
    const perfil = await perfilEmCache(conta.id, token);
    let posts: PostComMetricas[] = [];
    let erroPosts: string | null = null;
    try {
      posts = await postsEmCache(conta.id, conta.igUserId, token, input.dias);
    } catch (erro) {
      erroPosts = erro instanceof ErroInstagram ? erro.message : "Não foi possível buscar os posts agora.";
    }

    const metricas = ["reach", "views", "profile_views", "accounts_engaged", "total_interactions", "website_clicks", "profile_links_taps"];
    const comSeguidores = atual.filter((linha) => linha.seguidores !== null);
    const seguidoresAgora = perfil?.followers_count ?? comSeguidores.at(-1)?.seguidores ?? null;
    const seguidoresInicio = comSeguidores[0]?.seguidores ?? null;

    return {
      dias: input.dias,
      perfil: {
        username: perfil?.username ?? conta.username,
        nome: perfil?.name ?? conta.nome,
        fotoUrl: perfil?.profile_picture_url ?? conta.fotoUrl,
        seguidores: seguidoresAgora,
        seguindo: perfil?.follows_count ?? null,
        posts: perfil?.media_count ?? null,
      },
      // Dias de dados que já temos no período: a conta conectada há pouco ainda não tem o período inteiro.
      diasComDados: atual.length,
      crescimentoSeguidores: seguidoresAgora !== null && seguidoresInicio !== null && comSeguidores.length > 1 ? seguidoresAgora - seguidoresInicio : null,
      totais: Object.fromEntries(metricas.map((metrica) => [metrica, { atual: somar(atual, metrica), anterior: anterior.length > 0 ? somar(anterior, metrica) : null }])),
      serie: atual.map((linha) => ({
        dia: linha.dia,
        alcance: linha.metricas.reach ?? 0,
        visualizacoes: linha.metricas.views ?? 0,
        interacoes: linha.metricas.total_interactions ?? 0,
        seguidores: linha.seguidores,
      })),
      melhoresPosts: [...posts]
        .sort((a, b) => (b.metricas.reach ?? b.curtidas + b.comentarios) - (a.metricas.reach ?? a.curtidas + a.comentarios))
        .slice(0, MAX_POSTS_NA_TELA),
      totalPosts: posts.length,
      erroPosts,
      ultimaColetaEm: conta.ultimaColetaEm?.toISOString() ?? null,
      erroColeta: conta.erroColeta,
    };
  }),
});
