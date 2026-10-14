import { PERIODOS_VISAO } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../components/Card.js";
import { MedidorFunil } from "../components/charts/MedidorFunil.js";
import { MotivosFalhaBars } from "../components/charts/MotivosFalhaBars.js";
import { PilulasPorDia } from "../components/charts/PilulasPorDia.js";
import type { Variacao } from "../components/charts/StatTile.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { SeletorPeriodoVisao, type PeriodoEscolhido } from "../components/ui/SeletorPeriodoVisao.js";
import { formatarMoeda, formatarNumero, formatarPercentual, formatarQuando, formatarTelefone, tempoRelativo } from "../lib/format.js";
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((indice) => (
          <Esqueleto key={indice} className="h-[150px] rounded-3xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Esqueleto className="h-[300px] rounded-3xl lg:col-span-5" />
        <Esqueleto className="h-[300px] rounded-3xl lg:col-span-3" />
        <Esqueleto className="h-[300px] rounded-3xl lg:col-span-4" />
      </div>
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
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            Criar primeira campanha
          </a>
        }
      />
    );
  }

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      <Numeros resumo={resumo} referencia={referencia} comparar={comparar} />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-5">
          <TituloDoCard titulo={resumo.periodo.agrupamento === "mes" ? "Envios por mês" : "Envios por dia"} href={hrefDe({ tela: "relatorios" })} />
          <div className="mt-4">
            <PilulasPorDia serie={resumo.serie} agrupamento={resumo.periodo.agrupamento} />
          </div>
        </Card>
        <ProximoDisparo agendadas={resumo.agendadas} />
        <CampanhasRecentes campanhas={resumo.recentes} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <ConversasRecentes />
        <FunilResumo />
        <AtendimentoAgora atendimento={resumo.atendimento} />
      </div>

      {(resumo.atencao.length > 0 || resumo.motivosFalha.length > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {resumo.atencao.length > 0 && <PrecisaDeAtencao itens={resumo.atencao} />}
          {resumo.motivosFalha.length > 0 && <MotivosFalhaBars motivos={resumo.motivosFalha} />}
        </div>
      )}
    </div>
  );
}

// Título de card com o botão redondo de seta (atalho para a tela completa), como no modelo.
function TituloDoCard({ titulo, href, acao }: { titulo: string; href?: string; acao?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-heading text-lg font-semibold text-ink">{titulo}</h3>
      {acao}
      {href && (
        <a
          href={href}
          aria-label={`Abrir ${titulo}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-card-border text-ink transition-colors hover:border-accent hover:bg-accent hover:text-accent-contrast"
        >
          <Icone nome="setaDiagonal" tamanho={16} />
        </a>
      )}
    </div>
  );
}

function SeloVariacao({ variacao, sobreDestaque }: { variacao: Variacao | null | undefined; sobreDestaque?: boolean }) {
  if (!variacao) return null;
  const boa = variacao.direcao === "estavel" ? null : variacao.direcao === "alta" ? variacao.altaEhBoa : !variacao.altaEhBoa;
  const cor = sobreDestaque
    ? "border-white/30 text-white"
    : boa === null
      ? "border-card-border text-ink-3"
      : boa
        ? "border-success/30 text-success-text"
        : "border-brand-2/30 text-brand-2-text";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md border px-1 text-[10px] font-semibold ${cor}`}>
      {variacao.direcao === "alta" ? "▲" : variacao.direcao === "queda" ? "▼" : "•"} {variacao.texto}
    </span>
  );
}

// Os quatro números do período; o primeiro é o card de destaque (gradiente da marca), como no modelo.
function Numeros({ resumo, referencia, comparar }: { resumo: Resumo; referencia: string; comparar: boolean }) {
  const { atual, anterior } = resumo;
  const itens = [
    {
      rotulo: "Mensagens enviadas",
      valor: formatarNumero(atual.enviado),
      variacao: comparar ? variacaoPercentual(atual.enviado, anterior.enviado, true) : undefined,
      apoio: referencia,
      href: hrefDe({ tela: "campanhas", campanhaId: null }),
    },
    {
      rotulo: "Respostas",
      valor: formatarNumero(resumo.respostas.atual),
      variacao: comparar ? variacaoPercentual(resumo.respostas.atual, resumo.respostas.anterior, true) : undefined,
      apoio: resumo.taxaRetorno.atual !== null ? `${formatarPercentual(resumo.taxaRetorno.atual)} de quem recebeu` : referencia,
      href: hrefDe({ tela: "conversas", telefone: null, numeroId: null }),
    },
    {
      rotulo: "Custo do período",
      valor: formatarMoeda(resumo.custo.total),
      variacao: null,
      apoio: resumo.custo.porResposta !== null ? `${formatarMoeda(resumo.custo.porResposta)} por resposta` : "sem resposta ainda",
      href: hrefDe({ tela: "relatorios" }),
    },
    {
      rotulo: "Entrega",
      valor: formatarPercentual(atual.taxaSucesso),
      variacao: comparar ? variacaoEmPontos(atual.taxaSucesso, anterior.taxaSucesso) : undefined,
      apoio: atual.falhou > 0 ? `${formatarNumero(atual.falhou)} falharam` : "nenhuma falha",
      href: hrefDe({ tela: "campanhas-insights" }),
    },
  ];

  return (
    <section aria-label="Números do período" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {itens.map((item, indice) => {
        const destaque = indice === 0;
        return (
          <div
            key={item.rotulo}
            className={`relative overflow-hidden rounded-3xl p-5 shadow-card ${
              destaque ? "bg-gradient-to-br from-[#5b1593] via-[#470e75] to-[#25083d] text-white" : "bg-surface"
            }`}
          >
            {destaque && <span aria-hidden="true" className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full border-[18px] border-white/5" />}
            <div className="relative flex items-start justify-between gap-3">
              <p className={`text-[15px] font-medium ${destaque ? "text-white" : "text-ink"}`}>{item.rotulo}</p>
              <a
                href={item.href}
                aria-label={`Abrir ${item.rotulo}`}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                  destaque ? "bg-white text-[#470e75] hover:bg-brand-2 hover:text-white" : "border border-card-border text-ink hover:border-accent hover:bg-accent hover:text-accent-contrast"
                }`}
              >
                <Icone nome="setaDiagonal" tamanho={16} />
              </a>
            </div>
            <p className="tabular relative mt-4 font-heading text-[2.75rem] font-bold leading-none tracking-tight">{item.valor}</p>
            <p className={`relative mt-3 flex flex-wrap items-center gap-1.5 text-xs ${destaque ? "text-white/80" : "text-ink-3"}`}>
              <SeloVariacao variacao={item.variacao} sobreDestaque={destaque} />
              {item.apoio}
            </p>
          </div>
        );
      })}
    </section>
  );
}

// "Reminders" do modelo: o próximo disparo agendado em destaque.
function ProximoDisparo({ agendadas }: { agendadas: Resumo["agendadas"] }) {
  const proximo = agendadas.proximos[0];
  return (
    <Card className="flex flex-col lg:col-span-3">
      <TituloDoCard titulo="Próximo disparo" />
      {proximo ? (
        <div className="mt-5 flex flex-1 flex-col">
          <p className="font-heading text-2xl font-bold leading-tight text-accent-text">{proximo.nome}</p>
          <p className="mt-2 text-sm text-ink-3">
            {formatarQuando(proximo.quando)} · {formatarNumero(proximo.destinatarios)} {proximo.destinatarios === 1 ? "destinatário" : "destinatários"}
          </p>
          {agendadas.total > 1 && <p className="mt-1 text-xs text-ink-3">+ {formatarNumero(agendadas.total - 1)} agendada{agendadas.total - 1 === 1 ? "" : "s"} depois</p>}
          <a
            href={hrefDe({ tela: "campanhas", campanhaId: proximo.id })}
            className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            <Icone nome="calendario" tamanho={16} />
            Ver campanha
          </a>
        </div>
      ) : (
        <div className="mt-5 flex flex-1 flex-col">
          <p className="font-heading text-xl font-bold leading-tight text-ink">Nenhum disparo agendado</p>
          <p className="mt-2 text-sm text-ink-3">Agende uma campanha para ela sair sozinha no dia e hora certos.</p>
          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            <Icone nome="calendario" tamanho={16} />
            Agendar campanha
          </a>
        </div>
      )}
    </Card>
  );
}

// "Project" do modelo: as campanhas do período, cada uma com um ícone colorido e a data.
const CORES_STATUS: Record<string, string> = {
  concluida: "bg-success-soft text-success-text",
  enviando: "bg-amber-50 text-status-pendente",
  agendada: "bg-status-agendado/10 text-status-agendado",
};

function CampanhasRecentes({ campanhas }: { campanhas: Resumo["recentes"] }) {
  return (
    <Card className="lg:col-span-4">
      <TituloDoCard
        titulo="Campanhas"
        acao={
          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/40 px-3 py-1 text-xs font-semibold text-accent-text transition-colors hover:bg-accent-soft"
          >
            <Icone nome="mais" tamanho={12} /> Nova
          </a>
        }
      />
      {campanhas.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Nenhuma campanha neste período.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {campanhas.map((campanha) => (
            <li key={campanha.id}>
              <a
                href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })}
                className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${CORES_STATUS[campanha.status] ?? "bg-accent-soft text-accent-text"}`}>
                  <Icone nome="enviar" tamanho={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{campanha.nome}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {formatarNumero(campanha.progresso.enviado)} de {formatarNumero(campanha.progresso.total)} enviadas · {tempoRelativo(campanha.createdAt)}
                  </span>
                </span>
                <StatusBadge status={campanha.status} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// "Team collaboration" do modelo: quem falou por último e em que pé está cada conversa.
function ConversasRecentes() {
  const conversas = trpc.conversas.listar.useQuery({ limite: 5 }, { refetchInterval: 60_000 });
  return (
    <Card className="lg:col-span-4">
      <TituloDoCard titulo="Conversas recentes" href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })} />
      {conversas.isPending ? (
        <Esqueleto className="mt-4 h-48 rounded-2xl" />
      ) : (conversas.data ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Nenhuma conversa ainda.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {(conversas.data ?? []).map((conversa) => {
            const nome = conversa.nome ?? formatarTelefone(conversa.telefone);
            const selo = conversa.precisaHumano
              ? { texto: "Precisa de humano", classe: "bg-red-50 text-red-700" }
              : conversa.naoLidas > 0
                ? { texto: "Não lida", classe: "bg-amber-50 text-amber-800" }
                : conversa.iaAtiva
                  ? { texto: "IA atendendo", classe: "bg-accent-soft text-accent-text" }
                  : { texto: "Respondida", classe: "bg-success-soft text-success-text" };
            return (
              <li key={`${conversa.numeroId}:${conversa.telefone}`}>
                <a
                  href={hrefDe({ tela: "conversas", telefone: conversa.telefone, numeroId: conversa.numeroId })}
                  className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-soft to-brand-2-soft text-xs font-bold text-accent-text">
                    {nome.replace(/[^\p{L}\d ]/gu, "").split(/\s+/).slice(0, 2).map((parte) => parte.charAt(0).toUpperCase()).join("") || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{nome}</span>
                    <span className="block truncate text-[11px] text-ink-3">{conversa.ultimaMensagem || "—"}</span>
                  </span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${selo.classe}`}>{selo.texto}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// "Project progress" do modelo: o funil de clientes em meia-lua, com a taxa de fechamento no meio.
function FunilResumo() {
  const quadro = trpc.funil.quadro.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const etapas = quadro.data?.porEtapa;
  return (
    <Card className="flex flex-col lg:col-span-4">
      <TituloDoCard titulo="Funil de clientes" href={hrefDe({ tela: "funil" })} />
      <div className="mt-4 flex flex-1 items-center justify-center">
        {!etapas ? (
          <Esqueleto className="h-48 w-full rounded-2xl" />
        ) : (
          <MedidorFunil
            destaque={quadro.data?.taxaFechamento ?? null}
            legendaDestaque="taxa de fechamento"
            fatias={[
              { chave: "fechou", rotulo: "Fecharam", valor: etapas.fechou, cor: "graf-1" },
              { chave: "andamento", rotulo: "Em andamento", valor: etapas.em_conversa + etapas.interessado + etapas.fechando, cor: "graf-2" },
              { chave: "nao", rotulo: "Não fecharam", valor: etapas.nao_fechou, cor: "listras" },
            ]}
          />
        )}
      </div>
    </Card>
  );
}

// "Time tracker" do modelo (card escuro): o atendimento agora — quem está esperando resposta.
function AtendimentoAgora({ atendimento }: { atendimento: Resumo["atendimento"] }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#2d094b] via-[#25083d] to-[#140320] p-5 text-white shadow-card lg:col-span-4">
      <span aria-hidden="true" className="absolute -right-16 -top-16 h-56 w-56 rounded-full border-[22px] border-white/[0.04]" />
      <span aria-hidden="true" className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full border-[16px] border-brand-2/15" />
      <p className="relative font-heading text-lg font-semibold">Atendimento agora</p>
      <p className="tabular relative mt-6 text-center font-heading text-6xl font-bold tracking-tight">{formatarNumero(atendimento.aguardando)}</p>
      <p className="relative mt-1 text-center text-sm text-white/70">
        {atendimento.aguardando === 1 ? "conversa esperando resposta" : "conversas esperando resposta"}
      </p>
      <ul className="relative mt-4 flex flex-wrap justify-center gap-2 text-[11px]">
        {atendimento.acabando > 0 && <li className="rounded-full bg-brand-2/25 px-2.5 py-1 font-semibold text-[#ffd2b0]">{formatarNumero(atendimento.acabando)} com menos de 2h de janela</li>}
        {atendimento.precisaHumano > 0 && <li className="rounded-full bg-white/10 px-2.5 py-1">🙋 {formatarNumero(atendimento.precisaHumano)} pedindo uma pessoa</li>}
        {atendimento.sugestoesPendentes > 0 && <li className="rounded-full bg-white/10 px-2.5 py-1">{formatarNumero(atendimento.sugestoesPendentes)} rascunho{atendimento.sugestoesPendentes === 1 ? "" : "s"} da IA</li>}
        {atendimento.aguardando === 0 && atendimento.precisaHumano === 0 && <li className="rounded-full bg-white/10 px-2.5 py-1">Tudo em dia ✓</li>}
      </ul>
      <a
        href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
        className="relative mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#470e75] transition-colors hover:bg-brand-2 hover:text-white"
      >
        Abrir conversas
        <Icone nome="setaDireita" tamanho={15} />
      </a>
    </div>
  );
}

function PrecisaDeAtencao({ itens }: { itens: Resumo["atencao"] }) {
  return (
    <Card>
      <TituloDoCard titulo="Precisa de atenção" />
      <ul className="mt-3 flex flex-col gap-1">
        {itens.map((item) => (
          <li key={`${item.tipo}-${item.campanhaId}`}>
            <a
              href={hrefDe({ tela: "campanhas", campanhaId: item.campanhaId })}
              className="-mx-2 flex items-start gap-3 rounded-2xl px-2 py-2 text-sm transition-colors hover:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  item.tipo === "parada" ? "bg-amber-50 text-status-pendente" : "bg-red-50 text-status-falhou"
                }`}
              >
                <Icone nome={item.tipo === "parada" ? "relogio" : "alerta"} tamanho={14} />
              </span>
              <span>
                <span className="font-medium text-ink">{item.nome}</span>
                <span className="block text-xs text-ink-3">
                  {item.tipo === "parada"
                    ? `Enviando há ${item.minutos} min. O worker pode estar parado.`
                    : `${formatarNumero(item.falhas)} de ${formatarNumero(item.total)} envios falharam.`}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
