import { TOPICO_OUTROS, type PeriodoDashboard } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card.js";
import { StatTile } from "../components/charts/StatTile.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { SeletorPeriodo } from "../components/ui/SeletorPeriodo.js";
import { formatarNumero, formatarPercentual } from "../lib/format.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { RankingIa } from "./DuvidasIa.js";

type Ranking = SaidaApi["duvidas"]["ranking"];
type Topico = Ranking["ranking"][number];

export function Duvidas() {
  const [dias, setDias] = useState<PeriodoDashboard>(30);
  // A análise da IA é a principal; a de palavras-chave fica como alternativa (não depende da IA estar ligada).
  const [fonte, setFonte] = useState<"ia" | "palavras">("ia");

  const query = trpc.duvidas.ranking.useQuery(
    { dias },
    { placeholderData: keepPreviousData, refetchInterval: 30_000, enabled: fonte === "palavras" },
  );
  const dados = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Como as dúvidas são agrupadas" className="flex rounded-lg border border-card-border bg-surface p-0.5">
          {(
            [
              ["ia", "Análise da IA"],
              ["palavras", "Palavras-chave"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={fonte === valor}
              onClick={() => setFonte(valor)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                fonte === valor ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:text-ink"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <SeletorPeriodo dias={dias} onChange={setDias} />
      </div>

      {fonte === "ia" && <RankingIa dias={dias} />}

      {fonte === "palavras" && !dados && query.isError && <EstadoErro mensagem={query.error.message} onTentarNovamente={() => void query.refetch()} />}

      {fonte === "palavras" && !dados && query.isPending && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((indice) => (
              <Esqueleto key={indice} className="h-[104px]" />
            ))}
          </div>
          <Esqueleto className="h-80" />
        </div>
      )}

      {fonte === "palavras" && dados && <Conteudo dados={dados} atualizando={query.isPlaceholderData} />}
    </div>
  );
}

function Conteudo({ dados, atualizando }: { dados: Ranking; atualizando: boolean }) {
  if (dados.totalRespostas === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma mensagem de cliente neste período"
        descricao="Quando os clientes responderem aos disparos, as dúvidas são agrupadas por assunto aqui. As respostas chegam pelo webhook do WhatsApp (/webhooks/whatsapp na API)."
      />
    );
  }

  const [maisPerguntado] = dados.ranking;

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile rotulo="Mensagens recebidas" icone="mensagem" valor={formatarNumero(dados.totalRespostas)} referencia={`nos últimos ${dados.dias} dias`} />
        <StatTile
          rotulo="Dúvidas identificadas"
          icone="duvida"
          valor={formatarNumero(dados.totalDuvidas)}
          referencia={`${formatarPercentual(dados.totalDuvidas / dados.totalRespostas)} das mensagens`}
        />
        <StatTile
          rotulo="Assunto mais perguntado"
          icone="grafico"
          valor={maisPerguntado ? maisPerguntado.topico : "—"}
          referencia={maisPerguntado ? `${formatarNumero(maisPerguntado.total)} mensagens` : undefined}
        />
      </div>

      <Card>
        <h3 className="mb-1 font-heading text-sm font-semibold">Dúvidas mais frequentes</h3>
        <p className="mb-4 text-xs text-ink-2">
          Mensagens agrupadas por assunto, a partir de palavras-chave. Só entram as que parecem uma dúvida ou pedido; respostas como
          "ok" ou "obrigado" ficam de fora.
        </p>

        {dados.ranking.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-2">Nenhuma dúvida identificada nas mensagens deste período.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-card-border">
            {dados.ranking.map((topico, indice) => (
              <ItemDoRanking key={topico.topico} posicao={indice + 1} topico={topico} maximo={dados.ranking[0]!.total} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function tendencia(topico: Topico): string {
  if (topico.anterior === 0) return "novo no período";
  const pct = Math.round(((topico.total - topico.anterior) / topico.anterior) * 100);
  if (pct === 0) return "igual ao período anterior";
  return `${pct > 0 ? "▲ +" : "▼ −"}${Math.abs(pct)}% vs período anterior`;
}

function ItemDoRanking({ posicao, topico, maximo }: { posicao: number; topico: Topico; maximo: number }) {
  const ehOutros = topico.topico === TOPICO_OUTROS;

  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span
        aria-label={`Posição ${posicao}`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          posicao === 1 && !ehOutros ? "bg-accent text-accent-contrast" : "bg-slate-200/60 text-ink-2"
        }`}
      >
        {posicao}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h4 className="font-heading text-sm font-semibold">{topico.topico}</h4>
          <p className="text-sm tabular-nums">
            <strong>{formatarNumero(topico.total)}</strong>
            <span className="text-ink-2"> · {formatarPercentual(topico.participacao)} das dúvidas</span>
          </p>
        </div>

        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200/60">
          <div
            className={`h-full rounded-full ${ehOutros ? "bg-baseline" : "bg-accent"}`}
            style={{ width: `${Math.max(2, (topico.total / maximo) * 100)}%` }}
          />
        </div>

        <p className="mt-1 text-xs text-ink-2">{tendencia(topico)}</p>

        {topico.exemplos.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {topico.exemplos.map((exemplo) => (
              <li key={exemplo} className="break-words rounded-md bg-app-bg px-2.5 py-1.5 text-xs text-ink-2">
                “{exemplo}”
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
