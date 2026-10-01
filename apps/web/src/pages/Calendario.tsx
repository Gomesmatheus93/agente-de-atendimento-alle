import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CancelarAgendamentoBotao } from "../components/CancelarAgendamentoBotao.js";
import { Card } from "../components/Card.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { ProgressBar } from "../components/ui/ProgressBar.js";
import { INFO_ETAPA, etapaDe, type Etapa } from "../lib/etapa.js";
import { formatarHora, formatarNumero } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Evento = SaidaApi["calendario"]["periodo"][number];
type EventoComEtapa = Evento & { etapa: Etapa };
type Filtro = "todos" | "agendados" | "enviados";

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MAX_CHIPS_POR_DIA = 3;
const MAX_PONTOS_NO_CELULAR = 4;
const SEMANAS_NA_GRADE = 6;

// Legenda e chips usam as mesmas cores das colunas do kanban de campanhas.
const ETAPAS_NA_LEGENDA: Etapa[] = ["agendada", "enviando", "concluida", "com-falhas", "falhou"];

function chaveDoDia(data: Date): string {
  const dois = (numero: number) => String(numero).padStart(2, "0");
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

function somarDias(data: Date, dias: number): Date {
  const resultado = new Date(data);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

// A grade sempre mostra 6 semanas cheias (domingo a sábado), incluindo os dias dos meses vizinhos.
function diasDaGrade(mes: Date): Date[] {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const inicio = somarDias(primeiro, -primeiro.getDay());
  return Array.from({ length: SEMANAS_NA_GRADE * 7 }, (_, indice) => somarDias(inicio, indice));
}

function passaNoFiltro(filtro: Filtro, etapa: Etapa): boolean {
  if (filtro === "todos") return true;
  return filtro === "agendados" ? etapa === "agendada" : etapa !== "agendada";
}

export function Calendario() {
  const [mes, setMes] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  });
  const [selecionado, setSelecionado] = useState(() => chaveDoDia(new Date()));
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const dias = useMemo(() => diasDaGrade(mes), [mes]);
  const inicio = dias[0]!;
  const fim = somarDias(dias[dias.length - 1]!, 1);

  const query = trpc.calendario.periodo.useQuery(
    { inicio: inicio.toISOString(), fim: fim.toISOString() },
    {
      placeholderData: keepPreviousData,
      // Mais rápido quando há algo prestes a mudar (agendada que vai começar, envio em andamento).
      refetchInterval: (consulta) =>
        consulta.state.data?.some((evento) => evento.status !== "concluida") ? 10_000 : 30_000,
    },
  );

  const eventos = useMemo<EventoComEtapa[]>(
    () => (query.data ?? []).map((evento) => ({ ...evento, etapa: etapaDe(evento.status, evento.progresso) })),
    [query.data],
  );

  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoComEtapa[]>();
    for (const evento of eventos) {
      if (!passaNoFiltro(filtro, evento.etapa)) continue;
      const chave = chaveDoDia(new Date(evento.quando));
      mapa.set(chave, [...(mapa.get(chave) ?? []), evento]);
    }
    return mapa;
  }, [eventos, filtro]);

  const totaisDoMes = useMemo(() => {
    const doMes = eventos.filter((evento) => {
      const data = new Date(evento.quando);
      return data.getMonth() === mes.getMonth() && data.getFullYear() === mes.getFullYear();
    });
    const agendados = doMes.filter((evento) => evento.etapa === "agendada").length;
    return { agendados, enviados: doMes.length - agendados };
  }, [eventos, mes]);

  const hojeChave = chaveDoDia(new Date());

  function irParaMes(deslocamento: number) {
    const novo = new Date(mes.getFullYear(), mes.getMonth() + deslocamento, 1);
    setMes(novo);
    const hoje = new Date();
    const ehMesAtual = novo.getFullYear() === hoje.getFullYear() && novo.getMonth() === hoje.getMonth();
    setSelecionado(chaveDoDia(ehMesAtual ? hoje : novo));
  }

  function irParaHoje() {
    const hoje = new Date();
    setMes(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    setSelecionado(chaveDoDia(hoje));
  }

  const tituloDoMes = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const eventosDoDia = porDia.get(selecionado) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <BotaoDeSeta rotulo="Mês anterior" seta="‹" onClick={() => irParaMes(-1)} />
          <h3 className="min-w-44 text-center font-heading text-xl font-extrabold tracking-tight first-letter:uppercase">{tituloDoMes}</h3>
          <BotaoDeSeta rotulo="Próximo mês" seta="›" onClick={() => irParaMes(1)} />
          <button
            type="button"
            onClick={irParaHoje}
            className="ml-1 rounded-lg border border-card-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-baseline"
          >
            Hoje
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Filtro" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200/60 p-0.5">
            {(
              [
                ["todos", "Todos"],
                ["agendados", "Agendados"],
                ["enviados", "Enviados"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={filtro === valor}
                onClick={() => setFiltro(valor)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  filtro === valor ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            <Icone nome="mais" tamanho={14} />
            Agendar campanha
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-ink-2">
        <p>
          <strong className="text-status-agendado">{formatarNumero(totaisDoMes.agendados)}</strong> agendados ·{" "}
          <strong className="text-ink">{formatarNumero(totaisDoMes.enviados)}</strong> já enviados neste mês
        </p>
        <ul aria-label="Legenda" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {ETAPAS_NA_LEGENDA.map((etapa) => (
            <li key={etapa} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${INFO_ETAPA[etapa].cor}`} />
              {etapa === "agendada" ? "Agendada" : INFO_ETAPA[etapa].titulo}
            </li>
          ))}
        </ul>
      </div>

      {query.isError && !query.data ? (
        <EstadoErro mensagem={query.error.message} onTentarNovamente={() => void query.refetch()} />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
          {/* div em vez de Card: o p-5 do Card venceria o p-0 (mesma camada do Tailwind), e a grade precisa encostar nas bordas. */}
          <div className="overflow-hidden rounded-xl border border-card-border bg-surface">
            {query.isPending ? (
              <Esqueleto className="h-[36rem] rounded-none" />
            ) : (
              <div className={`transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
                <div aria-hidden="true" className="grid grid-cols-7 border-b border-card-border bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  {DIAS_DA_SEMANA.map((dia) => (
                    <span key={dia} className="py-2">
                      {dia}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-px bg-card-border">
                  {dias.map((dia) => {
                    const chave = chaveDoDia(dia);
                    return (
                      <CelulaDoDia
                        key={chave}
                        dia={dia}
                        eventos={porDia.get(chave) ?? []}
                        foraDoMes={dia.getMonth() !== mes.getMonth()}
                        ehHoje={chave === hojeChave}
                        selecionada={chave === selecionado}
                        onSelecionar={() => setSelecionado(chave)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <PainelDoDia chave={selecionado} eventos={eventosDoDia} filtrando={filtro !== "todos"} />
        </div>
      )}
    </div>
  );
}

function BotaoDeSeta({ rotulo, seta, onClick }: { rotulo: string; seta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-surface text-lg font-bold leading-none text-ink-2 transition-colors hover:border-baseline hover:text-ink"
    >
      <span aria-hidden="true">{seta}</span>
    </button>
  );
}

interface CelulaDoDiaProps {
  dia: Date;
  eventos: EventoComEtapa[];
  foraDoMes: boolean;
  ehHoje: boolean;
  selecionada: boolean;
  onSelecionar: () => void;
}

function CelulaDoDia({ dia, eventos, foraDoMes, ehHoje, selecionada, onSelecionar }: CelulaDoDiaProps) {
  const rotulo = dia.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const excedente = eventos.length - MAX_CHIPS_POR_DIA;

  return (
    <button
      type="button"
      onClick={onSelecionar}
      aria-pressed={selecionada}
      aria-label={`${rotulo}: ${eventos.length === 0 ? "nenhum disparo" : `${eventos.length} ${eventos.length === 1 ? "disparo" : "disparos"}`}`}
      className={`flex min-h-[4.75rem] flex-col items-stretch gap-1 p-1.5 text-left transition-colors sm:min-h-[6.75rem] ${
        selecionada ? "bg-accent-soft ring-2 ring-inset ring-accent" : foraDoMes ? "bg-app-bg hover:bg-slate-100" : "bg-surface hover:bg-slate-50"
      }`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
          ehHoje ? "bg-accent text-accent-contrast" : foraDoMes ? "text-ink-3" : "text-ink"
        }`}
      >
        {dia.getDate()}
      </span>

      <span className="hidden flex-col gap-0.5 sm:flex">
        {eventos.slice(0, MAX_CHIPS_POR_DIA).map((evento) => (
          <span
            key={evento.id}
            title={`${formatarHora(evento.quando)} · ${evento.nome} (${INFO_ETAPA[evento.etapa].titulo})`}
            className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] font-medium ${
              evento.etapa === "agendada" ? "bg-status-agendado/10 text-status-agendado" : "bg-slate-100 text-ink"
            }`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${INFO_ETAPA[evento.etapa].cor}`} />
            <span className="shrink-0 tabular-nums opacity-70">{formatarHora(evento.quando)}</span>
            <span className="truncate">{evento.nome}</span>
          </span>
        ))}
        {excedente > 0 && <span className="px-1 text-[11px] font-semibold text-ink-3">+{excedente} mais</span>}
      </span>

      <span aria-hidden="true" className="flex flex-wrap gap-0.5 sm:hidden">
        {eventos.slice(0, MAX_PONTOS_NO_CELULAR).map((evento) => (
          <span key={evento.id} className={`h-1.5 w-1.5 rounded-full ${INFO_ETAPA[evento.etapa].cor}`} />
        ))}
      </span>
    </button>
  );
}

function PainelDoDia({ chave, eventos, filtrando }: { chave: string; eventos: EventoComEtapa[]; filtrando: boolean }) {
  const data = new Date(`${chave}T12:00:00`);
  const diaDaSemana = data.toLocaleDateString("pt-BR", { weekday: "long" });
  const diaEMes = data.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

  return (
    <aside aria-label="Disparos do dia selecionado" className="xl:sticky xl:top-8">
      <Card className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-text">{diaDaSemana}</p>
            <h3 className="font-heading text-lg font-bold tracking-tight">{diaEMes}</h3>
          </div>
          <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink-2">
            {eventos.length} {eventos.length === 1 ? "disparo" : "disparos"}
          </span>
        </div>

        {eventos.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-slate-300/80 p-5 text-sm text-ink-3">
            <p>{filtrando ? "Nenhum disparo neste dia com esse filtro." : "Nenhum disparo neste dia."}</p>
            <a href={hrefDe({ tela: "nova-campanha" })} className="text-xs font-semibold text-accent-text hover:underline">
              Agendar uma campanha →
            </a>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {eventos.map((evento) => (
              <ItemDoDia key={evento.id} evento={evento} />
            ))}
          </ul>
        )}
      </Card>
    </aside>
  );
}

function ItemDoDia({ evento }: { evento: EventoComEtapa }) {
  const { progresso } = evento;
  const agendada = evento.etapa === "agendada";

  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-card-border p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-ink-3">
            <Icone nome="relogio" tamanho={12} />
            {formatarHora(evento.quando)}
          </p>
          <a
            href={hrefDe({ tela: "campanhas", campanhaId: evento.id })}
            className="break-words font-heading text-sm font-bold leading-snug hover:text-accent-text hover:underline"
          >
            {evento.nome}
          </a>
        </div>
        <StatusBadge status={evento.status} />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-ink-2">{evento.templateNome}</span>
        {formatarNumero(progresso.total)} {progresso.total === 1 ? "destinatário" : "destinatários"}
      </p>

      {agendada ? (
        <CancelarAgendamentoBotao campanhaId={evento.id} nome={evento.nome} />
      ) : (
        <>
          <ProgressBar enviado={progresso.enviado} falhou={progresso.falhou} pendente={progresso.pendente} />
          <p className="flex flex-wrap gap-x-3 text-xs text-ink-2">
            <span>
              <strong className="tabular-nums text-ink">{formatarNumero(progresso.enviado)}</strong> enviados
            </span>
            <span>
              <strong className="tabular-nums text-ink">{formatarNumero(progresso.falhou)}</strong> falhas
            </span>
            {progresso.pendente > 0 && (
              <span>
                <strong className="tabular-nums text-ink">{formatarNumero(progresso.pendente)}</strong> pendentes
              </span>
            )}
          </p>
        </>
      )}
    </li>
  );
}
