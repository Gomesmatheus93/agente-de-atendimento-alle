import type { PeriodoDashboard } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card.js";
import { StatTile } from "../components/charts/StatTile.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { SeletorPeriodo } from "../components/ui/SeletorPeriodo.js";
import { formatarDataHora, formatarMoeda, formatarNumero, formatarPercentual } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { variacaoEmPontos, variacaoPercentual } from "../lib/variacao.js";

type Performance = SaidaApi["relatorios"]["performance"];

// Deixa folga à direita para o valor ficar na ponta da barra sem cortar.
const LARGURA_MAX_PCT = 78;

export function Relatorios() {
  const [dias, setDias] = useState<PeriodoDashboard>(30);

  const query = trpc.relatorios.performance.useQuery({ dias }, { placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const dados = query.data;

  return (
    <div className="flex flex-col gap-6">
      <SeletorPeriodo dias={dias} onChange={setDias} />

      {!dados && query.isError && <EstadoErro mensagem={query.error.message} onTentarNovamente={() => void query.refetch()} />}

      {!dados && query.isPending && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((indice) => (
              <Esqueleto key={indice} className="h-[104px]" />
            ))}
          </div>
          <Esqueleto className="h-64" />
        </div>
      )}

      {dados && <Conteudo dados={dados} atualizando={query.isPlaceholderData} />}
    </div>
  );
}

function Conteudo({ dados, atualizando }: { dados: Performance; atualizando: boolean }) {
  const { atual, anterior, dias } = dados;
  const referencia = `vs ${dias} dias anteriores`;

  if (atual.enviados === 0 && anterior.enviados === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum disparo neste período"
        descricao="Quando houver campanhas enviadas, aqui você compara quantos clientes responderam e quanto cada resposta custou."
        acao={
          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            Criar campanha
          </a>
        }
      />
    );
  }

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      {atual.respostas === 0 && (
        <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Nenhuma resposta registrada neste período.</strong> As respostas chegam pelo webhook do WhatsApp
          (<code className="font-mono text-xs">/webhooks/whatsapp</code> na API). Enquanto ele não estiver conectado, a taxa de retorno
          fica em zero.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          rotulo="Taxa de retorno"
          icone="percentual"
          valor={formatarPercentual(atual.taxaRetorno)}
          serie={dados.serie.map((ponto) => ponto.taxaRetorno)}
          variacao={variacaoEmPontos(atual.taxaRetorno, anterior.taxaRetorno)}
          referencia={referencia}
        />
        <StatTile
          rotulo="Clientes que responderam"
          icone="usuarios"
          valor={formatarNumero(atual.respostas)}
          serie={dados.serie.map((ponto) => ponto.respostas)}
          variacao={variacaoPercentual(atual.respostas, anterior.respostas, true)}
          referencia={referencia}
        />
        <StatTile
          rotulo="Mensagens enviadas"
          icone="enviar"
          valor={formatarNumero(atual.enviados)}
          serie={dados.serie.map((ponto) => ponto.enviados)}
          variacao={variacaoPercentual(atual.enviados, anterior.enviados, true)}
          referencia={referencia}
        />
        <StatTile
          rotulo="Custo por resposta"
          icone="moeda"
          valor={formatarMoeda(atual.custoPorResposta)}
          serie={dados.serie.map((ponto) => ponto.custoPorResposta)}
          variacao={
            atual.custoPorResposta !== null && anterior.custoPorResposta !== null
              ? variacaoPercentual(atual.custoPorResposta, anterior.custoPorResposta, false)
              : undefined
          }
          referencia={`custo total ${formatarMoeda(atual.custo)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <RetornoPorTemplate templates={dados.porTemplate} />
        <TabelaCampanhas campanhas={dados.porCampanha} totais={atual} />
      </div>
    </div>
  );
}

function RetornoPorTemplate({ templates }: { templates: Performance["porTemplate"] }) {
  const maxima = Math.max(0.01, ...templates.map((item) => item.taxaRetorno ?? 0));

  return (
    <Card className="flex h-full flex-col">
      <h3 className="mb-1 font-heading text-sm font-bold">Retorno por template</h3>
      <p className="mb-4 text-xs text-ink-2">Qual mensagem gera mais respostas.</p>

      {templates.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-2">Nenhum template usado no período.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {templates.map((item) => (
            <li key={item.nome}>
              <p className="mb-1 text-xs text-ink-2">{item.nome}</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 rounded-full bg-accent"
                  style={{ width: `${Math.max(2, ((item.taxaRetorno ?? 0) / maxima) * LARGURA_MAX_PCT)}%` }}
                />
                <span className="text-xs font-semibold tabular-nums text-ink">{formatarPercentual(item.taxaRetorno)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-2">
                {formatarNumero(item.respostas)} respostas em {formatarNumero(item.enviados)} enviadas
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TabelaCampanhas({ campanhas, totais }: { campanhas: Performance["porCampanha"]; totais: Performance["atual"] }) {
  return (
    <Card className="lg:col-span-2">
      <h3 className="mb-1 font-heading text-sm font-bold">Desempenho por campanha</h3>
      <p className="mb-3 text-xs text-ink-2">Ordenadas pela maior taxa de retorno.</p>

      {campanhas.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-2">Nenhuma campanha neste período.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-card-border text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <th className="pb-2 font-medium">Campanha</th>
                <th className="pb-2 text-right font-medium">Enviadas</th>
                <th className="pb-2 text-right font-medium">Respostas</th>
                <th className="pb-2 text-right font-medium">Retorno</th>
                <th className="pb-2 text-right font-medium">Custo</th>
                <th className="pb-2 text-right font-medium">Por resposta</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {campanhas.map((campanha) => (
                <tr key={campanha.id} className="border-b border-card-border transition-colors last:border-0 hover:bg-slate-50/70">
                  <td className="py-2 pr-3">
                    <a href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })} className="font-medium text-ink hover:text-accent-text hover:underline">
                      {campanha.nome}
                    </a>
                    <span className="block text-xs text-ink-2">
                      {campanha.templateNome} · {formatarDataHora(campanha.createdAt)}
                    </span>
                  </td>
                  <td className="py-2 text-right">{formatarNumero(campanha.enviados)}</td>
                  <td className="py-2 text-right">{formatarNumero(campanha.respostas)}</td>
                  <td className="py-2 text-right font-semibold">{formatarPercentual(campanha.taxaRetorno)}</td>
                  <td className="py-2 text-right">{formatarMoeda(campanha.custo)}</td>
                  <td className="py-2 text-right">{formatarMoeda(campanha.custoPorResposta)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-card-border font-semibold tabular-nums">
                <td className="pt-2">Total</td>
                <td className="pt-2 text-right">{formatarNumero(totais.enviados)}</td>
                <td className="pt-2 text-right">{formatarNumero(totais.respostas)}</td>
                <td className="pt-2 text-right">{formatarPercentual(totais.taxaRetorno)}</td>
                <td className="pt-2 text-right">{formatarMoeda(totais.custo)}</td>
                <td className="pt-2 text-right">{formatarMoeda(totais.custoPorResposta)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
