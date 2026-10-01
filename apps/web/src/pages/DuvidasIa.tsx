import type { PeriodoDashboard } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { Card } from "../components/Card.js";
import { StatTile } from "../components/charts/StatTile.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { formatarNumero, formatarPercentual } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Ranking = SaidaApi["duvidas"]["rankingIa"];
type Tema = Ranking["ranking"][number];

// Ranking da análise diária da IA: as dúvidas agrupadas pelo assunto e, principalmente, as que o
// agente não soube responder — é a lista do que acrescentar ao script dele.
export function RankingIa({ dias }: { dias: PeriodoDashboard }) {
  const query = trpc.duvidas.rankingIa.useQuery({ dias }, { placeholderData: keepPreviousData });
  const dados = query.data;

  if (!dados && query.isError) return <EstadoErro mensagem={query.error.message} onTentarNovamente={() => void query.refetch()} />;
  if (!dados) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((indice) => (
            <Esqueleto key={indice} className="h-[104px]" />
          ))}
        </div>
        <Esqueleto className="h-80" />
      </div>
    );
  }

  if (dados.totalPerguntas === 0) {
    return (
      <EstadoVazio
        titulo="A IA ainda não encontrou dúvidas neste período"
        descricao="A análise roda todo dia às 3h nas conversas com mensagem nova e separa as perguntas dos clientes por assunto. Para rodar agora, use “Analisar agora” no Funil de clientes."
        acao={
          <a href={hrefDe({ tela: "funil" })} className="text-sm font-semibold text-accent-text hover:underline">
            Ir para o Funil de clientes
          </a>
        }
      />
    );
  }

  const faltando = dados.ranking.filter((tema) => tema.naoSanadas > 0).sort((a, b) => b.naoSanadas - a.naoSanadas);

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile rotulo="Perguntas identificadas" icone="duvida" valor={formatarNumero(dados.totalPerguntas)} referencia={`de ${formatarNumero(dados.totalClientes)} cliente(s)`} />
        <StatTile
          rotulo="Sem resposta do agente"
          icone="alerta"
          valor={formatarNumero(dados.totalNaoSanadas)}
          referencia={`${formatarPercentual(dados.totalNaoSanadas / dados.totalPerguntas)} das perguntas`}
        />
        <StatTile
          rotulo="Assunto mais perguntado"
          icone="grafico"
          valor={dados.ranking[0]?.tema ?? "—"}
          referencia={dados.ranking[0] ? `${formatarNumero(dados.ranking[0].total)} pergunta(s)` : undefined}
        />
      </div>

      {faltando.length > 0 && (
        <Card className="border-amber-200">
          <h3 className="flex items-center gap-2 font-heading text-sm font-semibold">
            <Icone nome="alerta" tamanho={15} className="text-status-pendente" />
            O que acrescentar ao script do agente
          </h3>
          <p className="mb-4 text-xs text-ink-2">
            Assuntos em que o cliente perguntou e a conversa não trouxe a resposta. Escreva a resposta na base de conhecimento do
            agente no n8n, começando pelos primeiros da lista.
          </p>
          <ol className="flex flex-col gap-3">
            {faltando.slice(0, 8).map((tema) => (
              <li key={tema.tema} className="rounded-lg bg-amber-50 px-3 py-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <strong className="font-semibold text-amber-900">{tema.tema}</strong>
                  <span className="text-xs text-amber-900">
                    {formatarNumero(tema.naoSanadas)} de {formatarNumero(tema.total)} sem resposta
                  </span>
                </p>
                {tema.exemplosNaoSanados.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {tema.exemplosNaoSanados.map((exemplo) => (
                      <li key={exemplo} className="text-xs text-amber-900/80">
                        “{exemplo}”
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card>
        <h3 className="mb-1 font-heading text-sm font-semibold">Dúvidas mais frequentes</h3>
        <p className="mb-4 text-xs text-ink-2">
          Perguntas dos clientes agrupadas por assunto pela IA, que lê a conversa inteira (entende “quanto fica?” como pergunta de preço, por exemplo).
        </p>
        <ol className="flex flex-col divide-y divide-card-border">
          {dados.ranking.map((tema, indice) => (
            <ItemTema key={tema.tema} posicao={indice + 1} tema={tema} maximo={dados.ranking[0]!.total} />
          ))}
        </ol>
      </Card>
    </div>
  );
}

function tendencia(tema: Tema): string {
  if (tema.anterior === 0) return "novo no período";
  const pct = Math.round(((tema.total - tema.anterior) / tema.anterior) * 100);
  if (pct === 0) return "igual ao período anterior";
  return `${pct > 0 ? "▲ +" : "▼ −"}${Math.abs(pct)}% vs período anterior`;
}

function ItemTema({ posicao, tema, maximo }: { posicao: number; tema: Tema; maximo: number }) {
  const sanadas = tema.total - tema.naoSanadas;
  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span
        aria-label={`Posição ${posicao}`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          posicao === 1 ? "bg-accent text-accent-contrast" : "bg-slate-200/60 text-ink-2"
        }`}
      >
        {posicao}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h4 className="font-heading text-sm font-semibold">{tema.tema}</h4>
          <p className="text-sm tabular-nums">
            <strong>{formatarNumero(tema.total)}</strong>
            <span className="text-ink-2">
              {" "}
              · {formatarNumero(tema.clientes)} cliente(s) · {formatarPercentual(tema.participacao)}
            </span>
          </p>
        </div>

        {/* Barra em duas partes: respondidas (roxo) e sem resposta (vermelho), no tamanho proporcional ao maior tema. */}
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200/60" aria-hidden="true">
          <div className="flex h-full" style={{ width: `${Math.max(2, (tema.total / maximo) * 100)}%` }}>
            <div className="h-full bg-accent" style={{ width: `${(sanadas / tema.total) * 100}%` }} />
            <div className="h-full bg-status-falhou" style={{ width: `${(tema.naoSanadas / tema.total) * 100}%` }} />
          </div>
        </div>

        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2">
          <span>{tendencia(tema)}</span>
          {tema.naoSanadas > 0 ? (
            <span className="font-medium text-red-700">{formatarNumero(tema.naoSanadas)} sem resposta</span>
          ) : (
            <span className="text-success-text">todas respondidas</span>
          )}
        </p>

        {[...tema.exemplosNaoSanados, ...tema.exemplos].length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {tema.exemplosNaoSanados.map((exemplo) => (
              <li key={`n-${exemplo}`} className="flex gap-2 break-words rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                <span className="shrink-0 font-semibold">sem resposta</span>“{exemplo}”
              </li>
            ))}
            {tema.exemplos.map((exemplo) => (
              <li key={`s-${exemplo}`} className="break-words rounded-md bg-app-bg px-2.5 py-1.5 text-xs text-ink-2">
                “{exemplo}”
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
