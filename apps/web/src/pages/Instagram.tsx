import { PERIODOS_INSIGHTS, type PeriodoInsights } from "@atendimento-academias/shared";
import { useState } from "react";
import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarDataHora, formatarNumero, formatarPercentual, tempoRelativo } from "../lib/format.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Insights = NonNullable<SaidaApi["instagram"]["insights"]>;

const CHAVE_PERIODO = "instagram-periodo";

function lerPeriodo(): PeriodoInsights {
  try {
    const salvo = Number(localStorage.getItem(CHAVE_PERIODO));
    return (PERIODOS_INSIGHTS as readonly number[]).includes(salvo) ? (salvo as PeriodoInsights) : 30;
  } catch {
    return 30;
  }
}

// Conectar / ver / desconectar o Instagram da unidade. Usado na tela Instagram (quando ainda não há conta)
// e em Configurações.
export function ConexaoInstagram() {
  const utils = trpc.useUtils();
  const estado = trpc.instagram.estado.useQuery();
  const papel = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario?.papel;
  const ehAdmin = papel === "admin" || papel === "superadmin";
  const desconectar = trpc.instagram.desconectar.useMutation({
    onSuccess: () => {
      toast.sucesso("Instagram desconectado.");
      void utils.instagram.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  if (estado.isPending) return <Esqueleto className="h-28" />;
  if (estado.isError) return <EstadoErro mensagem={estado.error.message} onTentarNovamente={() => void estado.refetch()} />;
  const { configurada, conta } = estado.data;

  return (
    <Card>
      <h3 className="flex items-center gap-2 font-heading text-base font-bold">
        <Icone nome="instagram" tamanho={18} />
        Instagram da unidade
      </h3>
      {!configurada ? (
        <p className="mt-2 text-sm text-ink-2">
          A plataforma ainda não tem o app do Instagram configurado (variáveis <code>INSTAGRAM_APP_ID</code> e{" "}
          <code>INSTAGRAM_APP_SECRET</code> no servidor). Fale com o responsável pela plataforma.
        </p>
      ) : conta ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {conta.fotoUrl ? (
              <img src={conta.fotoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-card-border" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
                <Icone nome="instagram" tamanho={20} />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">@{conta.username}</p>
              <p className="truncate text-xs text-ink-2">
                {conta.nome ? `${conta.nome} · ` : ""}conectado {tempoRelativo(conta.conectadaEm)}
                {conta.ultimaColetaEm ? ` · números de ${formatarDataHora(conta.ultimaColetaEm)}` : " · buscando os primeiros números…"}
              </p>
            </div>
          </div>
          {ehAdmin && (
            <div className="flex flex-wrap gap-2">
              <a href="/instagram/conectar" className="inline-flex items-center rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-baseline">
                Reconectar
              </a>
              <Button
                variante="fantasma"
                className="px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                disabled={desconectar.isPending}
                onClick={() => {
                  if (window.confirm(`Desconectar @${conta.username}? Os números já coletados são apagados.`)) desconectar.mutate();
                }}
              >
                Desconectar
              </Button>
            </div>
          )}
          {conta.erroColeta && (
            <p role="alert" className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {conta.erroColeta}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-ink-2">
            Conecte a conta profissional do Instagram da unidade para ver alcance, seguidores e o desempenho dos posts aqui
            no painel. Você entra com o login do Instagram e autoriza o Allp Chat — a senha não passa por aqui.
          </p>
          {ehAdmin ? (
            <a
              href="/instagram/conectar"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
            >
              <Icone nome="instagram" tamanho={16} />
              Conectar Instagram
            </a>
          ) : (
            <p className="text-xs text-ink-3">Peça ao administrador da unidade para conectar.</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function Instagram() {
  const estado = trpc.instagram.estado.useQuery();
  if (estado.isPending) return <Esqueleto className="h-40" />;
  if (!estado.data?.conta) return <ConexaoInstagram />;
  return <Painel />;
}

function Painel() {
  const utils = trpc.useUtils();
  const [dias, setDias] = useState<PeriodoInsights>(lerPeriodo);
  const consulta = trpc.instagram.insights.useQuery({ dias }, { refetchInterval: 15 * 60_000 });
  const atualizar = trpc.instagram.atualizarAgora.useMutation({
    onSuccess: () => {
      toast.sucesso("Buscando os números mais recentes no Instagram. Em instantes a tela atualiza.");
      window.setTimeout(() => void utils.instagram.invalidate(), 8000);
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function escolher(periodo: PeriodoInsights) {
    setDias(periodo);
    try {
      localStorage.setItem(CHAVE_PERIODO, String(periodo));
    } catch {
      // sem armazenamento: vale só nesta aba
    }
  }

  if (consulta.isPending) {
    return (
      <div aria-busy="true" className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((indice) => (
          <Esqueleto key={indice} className="h-28" />
        ))}
      </div>
    );
  }
  if (consulta.isError) return <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />;
  const dados = consulta.data;
  if (!dados) return <ConexaoInstagram />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Perfil perfil={dados.perfil} />
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Período" className="inline-flex rounded-xl bg-slate-200/60 p-1">
            {PERIODOS_INSIGHTS.map((periodo) => (
              <button
                key={periodo}
                type="button"
                aria-pressed={periodo === dias}
                onClick={() => escolher(periodo)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  periodo === dias ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                }`}
              >
                {periodo} dias
              </button>
            ))}
          </div>
          <Button variante="secundario" className="px-3 py-1.5 text-xs" disabled={atualizar.isPending} onClick={() => atualizar.mutate()}>
            Atualizar agora
          </Button>
        </div>
      </div>

      {dados.erroColeta && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {dados.erroColeta}
        </p>
      )}
      {dados.diasComDados < dados.dias && (
        <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A plataforma guarda os números do Instagram dia a dia a partir da conexão: por enquanto há{" "}
          <strong>{dados.diasComDados}</strong> {dados.diasComDados === 1 ? "dia" : "dias"} dos {dados.dias} do período.
          {dados.ultimaColetaEm ? ` Última atualização: ${formatarDataHora(dados.ultimaColetaEm)}.` : " Buscando os primeiros números…"}
        </p>
      )}

      <Kpis dados={dados} />
      <GraficoAlcance serie={dados.serie} />
      <MelhoresPosts dados={dados} />
    </div>
  );
}

function Perfil({ perfil }: { perfil: Insights["perfil"] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {perfil.fotoUrl ? (
        <img src={perfil.fotoUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-accent/30" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Icone nome="instagram" tamanho={22} />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-heading text-lg font-bold">@{perfil.username}</p>
        <p className="truncate text-xs text-ink-2">
          {perfil.nome ? `${perfil.nome} · ` : ""}
          {perfil.seguidores !== null ? `${formatarNumero(perfil.seguidores)} seguidores` : ""}
          {perfil.posts !== null ? ` · ${formatarNumero(perfil.posts)} posts` : ""}
        </p>
      </div>
    </div>
  );
}

function Variacao({ atual, anterior }: { atual: number; anterior: number | null }) {
  if (anterior === null || anterior === 0) return null;
  const variacao = (atual - anterior) / anterior;
  const subiu = variacao >= 0;
  return (
    <span className={`text-[11px] font-semibold ${subiu ? "text-emerald-700" : "text-red-700"}`}>
      {subiu ? "▲" : "▼"} {formatarPercentual(Math.abs(variacao))} vs. período anterior
    </span>
  );
}

function Kpis({ dados }: { dados: Insights }) {
  const t = dados.totais;
  const cliques = (t.website_clicks?.atual ?? 0) + (t.profile_links_taps?.atual ?? 0);
  const cliquesAntes =
    t.website_clicks?.anterior === null && t.profile_links_taps?.anterior === null
      ? null
      : (t.website_clicks?.anterior ?? 0) + (t.profile_links_taps?.anterior ?? 0);
  const itens = [
    {
      rotulo: "Seguidores",
      valor: dados.perfil.seguidores !== null ? formatarNumero(dados.perfil.seguidores) : "—",
      apoio:
        dados.crescimentoSeguidores !== null ? (
          <span className={`text-[11px] font-semibold ${dados.crescimentoSeguidores >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {dados.crescimentoSeguidores >= 0 ? "+" : ""}
            {formatarNumero(dados.crescimentoSeguidores)} no período
          </span>
        ) : null,
    },
    { rotulo: "Alcance", valor: formatarNumero(t.reach!.atual), apoio: <Variacao {...t.reach!} />, dica: "Contas únicas que viram algum conteúdo (soma dos dias)" },
    { rotulo: "Visualizações", valor: formatarNumero(t.views!.atual), apoio: <Variacao {...t.views!} /> },
    { rotulo: "Visitas ao perfil", valor: formatarNumero(t.profile_views!.atual), apoio: <Variacao {...t.profile_views!} /> },
    { rotulo: "Interações", valor: formatarNumero(t.total_interactions!.atual), apoio: <Variacao {...t.total_interactions!} />, dica: "Curtidas, comentários, salvamentos, compartilhamentos e respostas" },
    { rotulo: "Cliques no link", valor: formatarNumero(cliques), apoio: <Variacao atual={cliques} anterior={cliquesAntes} /> },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {itens.map((item) => (
        <div key={item.rotulo} title={item.dica} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-card-border">
          <dt className="text-xs font-medium text-ink-3">{item.rotulo}</dt>
          <dd className="mt-1 font-heading text-2xl font-bold tabular-nums text-ink">{item.valor}</dd>
          <dd className="mt-0.5 min-h-4">{item.apoio}</dd>
        </div>
      ))}
    </dl>
  );
}

function GraficoAlcance({ serie }: { serie: Insights["serie"] }) {
  if (serie.length === 0) return null;
  const maior = Math.max(...serie.map((ponto) => ponto.alcance), 1);
  const dia = (chave: string) => new Date(`${chave}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Alcance por dia</h3>
      <p className="mt-1 text-sm text-ink-2">Quantas contas viram algum conteúdo da unidade em cada dia.</p>
      <div className="mt-4 flex h-48 items-end gap-1" role="img" aria-label="Gráfico de alcance por dia">
        {serie.map((ponto) => (
          <div key={ponto.dia} className="group relative flex h-full flex-1 flex-col justify-end">
            <span
              className="block rounded-t bg-accent/80 transition-colors group-hover:bg-accent"
              style={{ height: `${Math.max(ponto.alcance > 0 ? 2 : 0, (ponto.alcance / maior) * 100)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white group-hover:block">
              {dia(ponto.dia)}: {formatarNumero(ponto.alcance)} de alcance · {formatarNumero(ponto.visualizacoes)} visualizações
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>{dia(serie[0]!.dia)}</span>
        <span>{dia(serie.at(-1)!.dia)}</span>
      </div>
    </Card>
  );
}

function MelhoresPosts({ dados }: { dados: Insights }) {
  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Posts que mais alcançaram</h3>
      <p className="mt-1 text-sm text-ink-2">
        {dados.totalPosts > 0
          ? `${formatarNumero(dados.totalPosts)} post${dados.totalPosts === 1 ? "" : "s"} publicado${dados.totalPosts === 1 ? "" : "s"} no período.`
          : "Nenhum post publicado no período."}
      </p>
      {dados.erroPosts && <p className="mt-2 text-xs text-red-700">{dados.erroPosts}</p>}
      {dados.melhoresPosts.length > 0 && (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dados.melhoresPosts.map((post) => (
            <li key={post.id} className="flex flex-col overflow-hidden rounded-xl ring-1 ring-inset ring-card-border">
              <a href={post.link ?? undefined} target="_blank" rel="noreferrer" className="relative block aspect-square bg-slate-100">
                {post.imagem ? (
                  <img src={post.imagem} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-ink-3">
                    <Icone nome="instagram" tamanho={28} />
                  </span>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{post.tipo}</span>
              </a>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <p className="line-clamp-2 text-xs text-ink-2">{post.legenda || "Sem legenda"}</p>
                <dl className="mt-auto grid grid-cols-3 gap-2 text-center">
                  <MetricaPost rotulo="Alcance" valor={post.metricas.reach} />
                  <MetricaPost rotulo="Curtidas" valor={post.curtidas} />
                  <MetricaPost rotulo="Coment." valor={post.comentarios} />
                  <MetricaPost rotulo="Salvos" valor={post.metricas.saved} />
                  <MetricaPost rotulo="Compart." valor={post.metricas.shares} />
                  <MetricaPost rotulo="Visualiz." valor={post.metricas.views} />
                </dl>
                <p className="text-[11px] text-ink-3">{formatarDataHora(post.em)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MetricaPost({ rotulo, valor }: { rotulo: string; valor: number | undefined }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-1.5">
      <dt className="text-[10px] text-ink-3">{rotulo}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">{valor === undefined ? "—" : formatarNumero(valor)}</dd>
    </div>
  );
}
