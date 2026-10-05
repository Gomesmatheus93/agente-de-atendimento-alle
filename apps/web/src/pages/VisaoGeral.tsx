import { PERIODOS_VISAO } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "../components/Card.js";
import { EnviosPorDiaChart } from "../components/charts/EnviosPorDiaChart.js";
import { MotivosFalhaBars } from "../components/charts/MotivosFalhaBars.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { ProgressBar } from "../components/ui/ProgressBar.js";
import { SeletorPeriodoVisao, type PeriodoEscolhido } from "../components/ui/SeletorPeriodoVisao.js";
import { formatarMoeda, formatarNumero, formatarPercentual, formatarQuando, tempoRelativo } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { variacaoEmPontos, variacaoPercentual } from "../lib/variacao.js";

type Resumo = SaidaApi["dashboard"]["resumo"];

// Os números se atualizam sozinhos de hora em hora (e ao voltar para a aba); "Atualizar agora" força na hora.
const ATUALIZACAO_MS = 60 * 60 * 1000;
const CHAVE_PERIODO = "visao-geral-periodo";

// O período escolhido fica lembrado neste navegador.
function periodoSalvo(): PeriodoEscolhido {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PERIODO) ?? "null") as PeriodoEscolhido | null;
    if (salvo && (PERIODOS_VISAO as readonly string[]).includes(salvo.periodo)) return salvo;
  } catch {
    // sem armazenamento: começa no padrão
  }
  return { periodo: "7d" };
}

export function VisaoGeral() {
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>(periodoSalvo);
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PERIODO, JSON.stringify(periodo));
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  }, [periodo]);

  const resumoQuery = trpc.dashboard.resumo.useQuery(periodo, {
    placeholderData: keepPreviousData,
    refetchInterval: ATUALIZACAO_MS,
  });

  const resumo = resumoQuery.data;
  const atualizadoEm = resumoQuery.dataUpdatedAt ? new Date(resumoQuery.dataUpdatedAt) : null;
  const hora = (data: Date) => data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="flex items-center gap-2 pt-2 text-xs text-ink-3">
          {atualizadoEm && (
            <>
              Atualizado às {hora(atualizadoEm)} · próxima às {hora(new Date(atualizadoEm.getTime() + ATUALIZACAO_MS))}
              <button
                type="button"
                onClick={() => void resumoQuery.refetch()}
                disabled={resumoQuery.isFetching}
                className="font-semibold text-accent-text hover:underline disabled:opacity-50"
              >
                {resumoQuery.isFetching ? "Atualizando…" : "Atualizar agora"}
              </button>
            </>
          )}
        </p>
        <SeletorPeriodoVisao valor={periodo} onChange={setPeriodo} />
      </div>

      {!resumo && resumoQuery.isError && (
        <EstadoErro mensagem={resumoQuery.error.message} onTentarNovamente={() => void resumoQuery.refetch()} />
      )}

      {!resumo && resumoQuery.isPending && <CarregandoResumo />}

      {resumo && <ConteudoResumo resumo={resumo} atualizando={resumoQuery.isPlaceholderData} />}
    </div>
  );
}

function CarregandoResumo() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Esqueleto className="h-20" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((indice) => (
          <Esqueleto key={indice} className="h-[120px]" />
        ))}
      </div>
      <Esqueleto className="h-[360px]" />
    </div>
  );
}

function ConteudoResumo({ resumo, atualizando }: { resumo: Resumo; atualizando: boolean }) {
  const { atual, anterior } = resumo;
  const comparar = resumo.periodo.comparacao !== null;
  const referencia = resumo.periodo.comparacao ?? "em todo o período";
  const semNadaAinda =
    atual.total === 0 &&
    anterior.total === 0 &&
    resumo.recentes.length === 0 &&
    resumo.campanhasEmAndamento === 0 &&
    resumo.agendadas.total === 0;

  if (semNadaAinda) {
    return (
      <EstadoVazio
        titulo="Nenhum disparo ainda"
        descricao="Assim que você criar a primeira campanha, os indicadores e gráficos de envio aparecem aqui."
        acao={
          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            Criar primeira campanha
          </a>
        }
      />
    );
  }

  return (
    <div className={`flex flex-col gap-5 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      <FilaDeAtendimento resumo={resumo} />

      <Numeros resumo={resumo} referencia={referencia} comparar={comparar} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <EnviosPorDiaChart serie={resumo.serie} agrupamento={resumo.periodo.agrupamento} />
        </div>
        <div className="flex flex-col gap-4">
          <ProximosDisparos agendadas={resumo.agendadas} />
          {/* Só ocupa espaço quando há falha para explicar; período sem falhas não precisa de um card dizendo isso. */}
          {resumo.motivosFalha.length > 0 && <MotivosFalhaBars motivos={resumo.motivosFalha} />}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Mesma lógica: nada pedindo atenção não é informação, então some em vez de tranquilizar com uma caixa a mais. */}
        {resumo.atencao.length > 0 && <PrecisaDeAtencao itens={resumo.atencao} />}
        <CampanhasRecentes campanhas={resumo.recentes} expandida={resumo.atencao.length === 0} />
      </div>
    </div>
  );
}

function FilaDeAtendimento({ resumo }: { resumo: Resumo }) {
  const { aguardando, acabando, semJanela, sugestoesPendentes, precisaHumano } = resumo.atendimento;
  const nada = aguardando === 0 && semJanela === 0 && precisaHumano === 0;

  const detalhes = [
    acabando > 0 && {
      chave: "acabando",
      texto: `${formatarNumero(acabando)} ${acabando === 1 ? "com menos de 2h" : "com menos de 2h"} de janela`,
      urgente: true,
    },
    sugestoesPendentes > 0 && {
      chave: "ia",
      texto: `${formatarNumero(sugestoesPendentes)} ${sugestoesPendentes === 1 ? "rascunho da IA pronto" : "rascunhos da IA prontos"}`,
      urgente: false,
    },
    precisaHumano > 0 && {
      chave: "humano",
      texto: `${formatarNumero(precisaHumano)} ${precisaHumano === 1 ? "passada para a equipe" : "passadas para a equipe"}`,
      urgente: false,
    },
    semJanela > 0 && {
      chave: "fechada",
      texto: `${formatarNumero(semJanela)} sem janela: só template alcança`,
      urgente: false,
    },
  ].filter(Boolean) as Array<{ chave: string; texto: string; urgente: boolean }>;

  return (
    <section aria-label="Fila de atendimento" className="flex flex-wrap items-center gap-4 rounded-xl border border-card-border bg-surface p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
        <Icone nome="inbox" tamanho={18} />
      </span>

      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-semibold text-ink">Fila de atendimento</p>
        <p className="mt-0.5 text-sm text-ink-2">
          <strong className="tabular font-semibold text-ink">{formatarNumero(aguardando)}</strong>{" "}
          {aguardando === 1 ? "conversa esperando resposta" : "conversas esperando resposta"}
        </p>
      </div>

      {nada ? (
        <p className="flex items-center gap-1.5 text-xs text-success-text">
          <Icone nome="checkCirculo" tamanho={14} /> Em dia
        </p>
      ) : detalhes.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {detalhes.map((detalhe) => (
            <li key={detalhe.chave} className={detalhe.urgente ? "font-medium text-brand-2-text" : ""}>
              {detalhe.texto}
            </li>
          ))}
        </ul>
      ) : null}

      <a
        href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
        className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-accent-text transition-colors hover:bg-accent-soft"
      >
        Ver conversas
        <Icone nome="setaDireita" tamanho={14} />
      </a>
    </section>
  );
}

// Verde quando a variação é a desejada, laranja quando vai no sentido ruim, neutro quando não mudou.
function corDaVariacao(variacao: { direcao: "alta" | "queda" | "estavel"; altaEhBoa: boolean }): string {
  if (variacao.direcao === "estavel") return "text-ink-3";
  const boa = variacao.direcao === "alta" ? variacao.altaEhBoa : !variacao.altaEhBoa;
  return boa ? "text-success-text" : "text-brand-2-text";
}

// Em "Todo período" não há período anterior: os números aparecem sem a variação.
function Numeros({ resumo, referencia, comparar }: { resumo: Resumo; referencia: string; comparar: boolean }) {
  const { atual, anterior } = resumo;

  const itens = [
    {
      rotulo: "Mensagens enviadas",
      valor: formatarNumero(atual.enviado),
      variacao: comparar ? variacaoPercentual(atual.enviado, anterior.enviado, true) : undefined,
      apoio: referencia,
    },
    {
      rotulo: "Respostas",
      valor: formatarNumero(resumo.respostas.atual),
      variacao: comparar ? variacaoPercentual(resumo.respostas.atual, resumo.respostas.anterior, true) : undefined,
      apoio:
        resumo.taxaRetorno.atual !== null ? `${formatarPercentual(resumo.taxaRetorno.atual)} de quem recebeu` : referencia,
    },
    {
      rotulo: "Custo do período",
      valor: formatarMoeda(resumo.custo.total),
      variacao: null,
      apoio:
        resumo.custo.porResposta !== null ? `${formatarMoeda(resumo.custo.porResposta)} por resposta` : "sem resposta ainda",
    },
    {
      rotulo: "Entrega",
      valor: formatarPercentual(atual.taxaSucesso),
      variacao: comparar ? variacaoEmPontos(atual.taxaSucesso, anterior.taxaSucesso) : undefined,
      apoio: atual.falhou > 0 ? `${formatarNumero(atual.falhou)} falharam` : "nenhuma falha",
    },
  ];

  return (
    <section aria-label="Números do período" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {itens.map((item) => (
        <div key={item.rotulo} className="rounded-xl border border-card-border bg-surface p-4">
          <p className="text-sm text-ink-2">{item.rotulo}</p>
          <p className="tabular mt-2 font-heading text-2xl font-bold leading-none">{item.valor}</p>
          <p className="mt-1.5 text-xs text-ink-3">
            {item.variacao && (
              <span className={corDaVariacao(item.variacao)}>{item.variacao.texto} </span>
            )}
            {item.apoio}
          </p>
        </div>
      ))}
    </section>
  );
}

function ProximosDisparos({ agendadas }: { agendadas: Resumo["agendadas"] }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm font-bold">Próximos disparos</h3>
        <a href={hrefDe({ tela: "calendario" })} className="text-xs font-medium text-accent-text hover:underline">
          Calendário
        </a>
      </div>

      {agendadas.proximos.length === 0 ? (
        <p className="py-2 text-sm text-ink-2">
          Nenhuma campanha agendada.{" "}
          <a href={hrefDe({ tela: "nova-campanha" })} className="font-medium text-accent-text hover:underline">
            Agendar uma
          </a>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agendadas.proximos.map((campanha) => (
            <li key={campanha.id}>
              <a
                href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })}
                className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-agendado/10 text-status-agendado"
                >
                  <Icone nome="calendario" tamanho={12} />
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium leading-snug text-ink">{campanha.nome}</span>
                  <span className="block text-xs text-ink-2">
                    {formatarQuando(campanha.quando)} · {formatarNumero(campanha.destinatarios)}{" "}
                    {campanha.destinatarios === 1 ? "destinatário" : "destinatários"}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PrecisaDeAtencao({ itens }: { itens: Resumo["atencao"] }) {
  return (
    <Card>
      <h3 className="mb-3 font-heading text-sm font-bold">Precisa de atenção</h3>
      {itens.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-success-text">
            <Icone nome="check" tamanho={14} />
          </span>
          Tudo certo: nenhuma campanha com falhas ou parada.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {itens.map((item) => (
            <li key={`${item.tipo}-${item.campanhaId}`}>
              <a
                href={hrefDe({ tela: "campanhas", campanhaId: item.campanhaId })}
                className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    item.tipo === "parada" ? "bg-amber-50 text-status-pendente" : "bg-red-50 text-status-falhou"
                  }`}
                >
                  <Icone nome={item.tipo === "parada" ? "relogio" : "alerta"} tamanho={13} />
                </span>
                <span>
                  <span className="font-medium text-ink">{item.nome}</span>
                  <span className="block text-xs text-ink-2">
                    {item.tipo === "parada"
                      ? `Enviando há ${item.minutos} min. O worker pode estar parado.`
                      : `${formatarNumero(item.falhas)} de ${formatarNumero(item.total)} envios falharam.`}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CampanhasRecentes({ campanhas, expandida }: { campanhas: Resumo["recentes"]; expandida: boolean }) {
  return (
    <Card className={expandida ? "lg:col-span-3" : "lg:col-span-2"}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-heading text-sm font-bold">Campanhas recentes</h3>
        <a href={hrefDe({ tela: "campanhas", campanhaId: null })} className="text-xs font-medium text-accent-text hover:underline">
          Ver todas
        </a>
      </div>
      {campanhas.length === 0 ? (
        <p className="text-sm text-ink-2">Nenhuma campanha neste período.</p>
      ) : (
        <ul className="flex flex-col">
          {campanhas.map((campanha) => (
            <li key={campanha.id} className="border-b border-card-border last:border-0">
              <a
                href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })}
                className="flex flex-col gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{campanha.nome}</span>
                  <StatusBadge status={campanha.status} />
                </span>
                <ProgressBar
                  enviado={campanha.progresso.enviado}
                  falhou={campanha.progresso.falhou}
                  pendente={campanha.progresso.pendente}
                />
                <span className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-2">
                  <span>
                    {formatarNumero(campanha.progresso.enviado)} enviados · {formatarNumero(campanha.progresso.falhou)} falhas ·{" "}
                    {formatarNumero(campanha.progresso.total)} no total
                  </span>
                  <span>{tempoRelativo(campanha.createdAt)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
