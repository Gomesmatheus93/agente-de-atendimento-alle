import { PERIODOS_INSIGHTS, type PeriodoInsights } from "@atendimento-academias/shared";
import { useState } from "react";
import { Card } from "../components/Card.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone, type NomeIcone } from "../components/ui/Icone.js";
import { formatarDataHora, formatarMoeda, formatarNumero, formatarPercentual } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Insights = SaidaApi["campanhas"]["insights"];
type CampanhaInsight = Insights["campanhas"][number];

const CHAVE_PERIODO = "insights-campanhas-periodo";
// Com poucos envios uma taxa engana (1 de 1 = 100%): os destaques só comparam campanhas com volume.
const MIN_ENVIOS_PARA_COMPARAR = 5;
const MIN_ENVIOS_POR_HORA = 3;

const taxa = (parte: number, total: number) => (total > 0 ? parte / total : null);

function lerPeriodo(): PeriodoInsights {
  try {
    const salvo = Number(localStorage.getItem(CHAVE_PERIODO));
    return (PERIODOS_INSIGHTS as readonly number[]).includes(salvo) ? (salvo as PeriodoInsights) : 30;
  } catch {
    return 30;
  }
}

function formatarMinutos(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 1) return "< 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = minutos / 60;
  if (horas < 24) return `${horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${Math.round(horas / 24)} d`;
}

// Abas da tela Campanhas: o quadro (kanban) e os insights.
export function AbasCampanhas({ ativa }: { ativa: "quadro" | "insights" }) {
  const abas = [
    { id: "quadro", rotulo: "Quadro", href: hrefDe({ tela: "campanhas", campanhaId: null }), icone: "kanban" },
    { id: "insights", rotulo: "Insights", href: hrefDe({ tela: "campanhas-insights" }), icone: "grafico" },
  ] as const;
  return (
    <nav aria-label="Visões de campanhas" className="inline-flex rounded-xl bg-slate-200/60 p-1">
      {abas.map((aba) => (
        <a
          key={aba.id}
          href={aba.href}
          aria-current={aba.id === ativa ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
            aba.id === ativa ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
          }`}
        >
          <Icone nome={aba.icone} tamanho={14} />
          {aba.rotulo}
        </a>
      ))}
    </nav>
  );
}

export function CampanhasInsights() {
  const [dias, setDias] = useState<PeriodoInsights>(lerPeriodo);
  const consulta = trpc.campanhas.insights.useQuery({ dias }, { refetchInterval: 60_000 });

  function escolher(periodo: PeriodoInsights) {
    setDias(periodo);
    try {
      localStorage.setItem(CHAVE_PERIODO, String(periodo));
    } catch {
      // sem armazenamento: vale só nesta aba
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AbasCampanhas ativa="insights" />
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
      </div>

      {consulta.isPending ? (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((indice) => (
            <Esqueleto key={indice} className="h-28" />
          ))}
        </div>
      ) : consulta.isError ? (
        <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.campanhas.length === 0 ? (
        <EstadoVazio titulo="Nenhuma campanha disparada no período" descricao="Escolha um período maior ou dispare uma campanha para ver como ela performa." />
      ) : (
        <Painel dados={consulta.data} />
      )}
    </div>
  );
}

function Painel({ dados }: { dados: Insights }) {
  const { totais } = dados;
  return (
    <>
      <Destaques dados={dados} />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Enviadas" valor={formatarNumero(totais.enviados)} apoio={`${formatarNumero(totais.campanhas)} campanha${totais.campanhas === 1 ? "" : "s"}`} />
        <Kpi rotulo="Entregues" valor={formatarPercentual(taxa(totais.entregues, totais.enviados))} apoio={`${formatarNumero(totais.entregues)} no aparelho`} />
        <Kpi rotulo="Lidas" valor={formatarPercentual(taxa(totais.lidas, totais.enviados))} apoio={`${formatarNumero(totais.lidas)} abertas`} />
        <Kpi rotulo="Responderam" valor={formatarPercentual(taxa(totais.responderam, totais.enviados))} apoio={`${formatarNumero(totais.responderam)} clientes`} />
        <Kpi rotulo="Matrículas" valor={formatarNumero(totais.fecharam)} apoio={`${formatarPercentual(taxa(totais.fecharam, totais.enviados))} das enviadas`} destaque />
        <Kpi
          rotulo="Custo por matrícula"
          valor={formatarMoeda(totais.custoPorMatricula)}
          apoio={`${formatarMoeda(totais.custo)} no total`}
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <FunilGeral totais={totais} />
        <PorHorario porHora={dados.porHora} />
      </div>

      <TabelaCampanhas campanhas={dados.campanhas} />

      {dados.motivosFalha.length > 0 && <MotivosFalha motivos={dados.motivosFalha} falhas={totais.falhas} total={totais.total} />}

      <p className="text-xs text-ink-3">
        <strong>Como ler:</strong> “Responderam” conta quem respondeu ao disparo em até 7 dias. Cada matrícula (etapa “Fechou”
        no Funil) conta para uma campanha só: a última que o cliente recebeu antes de fechar. Entregues e lidas vêm dos checks
        do WhatsApp — disparos anteriores a eles e clientes que desligaram a confirmação de leitura ficam de fora.
      </p>
    </>
  );
}

function Kpi({ rotulo, valor, apoio, destaque }: { rotulo: string; valor: string; apoio?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ring-1 ring-inset ${destaque ? "bg-accent-soft ring-accent/20" : "bg-surface ring-card-border"}`}>
      <dt className="text-xs font-medium text-ink-3">{rotulo}</dt>
      <dd className={`mt-1 font-heading text-2xl font-bold tabular-nums ${destaque ? "text-accent-text" : "text-ink"}`}>{valor}</dd>
      {apoio && <dd className="mt-0.5 truncate text-[11px] text-ink-3">{apoio}</dd>}
    </div>
  );
}

// Frases prontas com o que vale a pena saber, calculadas dos números do período.
function Destaques({ dados }: { dados: Insights }) {
  const comVolume = dados.campanhas.filter((campanha) => campanha.enviados >= MIN_ENVIOS_PARA_COMPARAR);
  const comparaveis = comVolume.length >= 2 ? comVolume : dados.campanhas.filter((campanha) => campanha.enviados > 0);
  const frases: Array<{ icone: NomeIcone; texto: string }> = [];

  const melhorResposta = [...comparaveis].sort((a, b) => (taxa(b.responderam, b.enviados) ?? 0) - (taxa(a.responderam, a.enviados) ?? 0))[0];
  if (melhorResposta && melhorResposta.responderam > 0 && comparaveis.length > 1) {
    frases.push({
      icone: "mensagem",
      texto: `“${melhorResposta.nome}” teve a melhor taxa de resposta: ${formatarPercentual(taxa(melhorResposta.responderam, melhorResposta.enviados))} dos clientes responderam.`,
    });
  }

  const maisMatriculas = [...dados.campanhas].sort((a, b) => b.fecharam - a.fecharam || (a.custoPorMatricula ?? Infinity) - (b.custoPorMatricula ?? Infinity))[0];
  if (maisMatriculas && maisMatriculas.fecharam > 0) {
    frases.push({
      icone: "check",
      texto: `“${maisMatriculas.nome}” trouxe mais matrículas: ${formatarNumero(maisMatriculas.fecharam)}${
        maisMatriculas.custoPorMatricula !== null ? `, a ${formatarMoeda(maisMatriculas.custoPorMatricula)} cada` : ""
      }.`,
    });
  } else if (dados.totais.responderam > 0) {
    frases.push({ icone: "funil", texto: "Nenhuma matrícula atribuída às campanhas do período ainda. Acompanhe os interessados no Funil." });
  }

  const horas = dados.porHora.filter((hora) => hora.enviados >= MIN_ENVIOS_POR_HORA);
  const melhorHora = [...horas].sort((a, b) => b.responderam / b.enviados - a.responderam / a.enviados)[0];
  if (melhorHora && horas.length > 1 && melhorHora.responderam > 0) {
    frases.push({
      icone: "relogio",
      texto: `Disparos das ${melhorHora.hora}h às ${melhorHora.hora + 1}h tiveram a maior taxa de resposta (${formatarPercentual(
        melhorHora.responderam / melhorHora.enviados,
      )}). Vale agendar as próximas nesse horário.`,
    });
  }

  if (dados.totais.falhas > 0 && dados.motivosFalha[0]) {
    frases.push({
      icone: "alerta",
      texto: `${formatarPercentual(taxa(dados.totais.falhas, dados.totais.total))} dos envios falharam. Motivo mais comum: ${dados.motivosFalha[0].motivo}`,
    });
  }

  if (frases.length === 0) return null;
  return (
    <section aria-label="Destaques" className="grid gap-3 md:grid-cols-2">
      {frases.map((frase) => (
        <p key={frase.texto} className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink ring-1 ring-inset ring-card-border">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            <Icone nome={frase.icone} tamanho={14} />
          </span>
          <span className="min-w-0 break-words">{frase.texto}</span>
        </p>
      ))}
    </section>
  );
}

function FunilGeral({ totais }: { totais: Insights["totais"] }) {
  const etapas = [
    { rotulo: "Enviadas", valor: totais.enviados, cor: "bg-status-enviado" },
    { rotulo: "Entregues", valor: totais.entregues, cor: "bg-slate-400" },
    { rotulo: "Lidas", valor: totais.lidas, cor: "bg-sky-500" },
    { rotulo: "Responderam", valor: totais.responderam, cor: "bg-accent" },
    { rotulo: "Interessados", valor: totais.interessados + totais.fecharam, cor: "bg-amber-400" },
    { rotulo: "Matrículas", valor: totais.fecharam, cor: "bg-emerald-500" },
  ];
  const base = Math.max(totais.enviados, 1);
  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Funil das campanhas</h3>
      <p className="mt-1 text-sm text-ink-2">Do disparo à matrícula, somando as campanhas do período.</p>
      <ol className="mt-4 flex flex-col gap-2.5">
        {etapas.map((etapa) => (
          <li key={etapa.rotulo} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="text-ink-2">{etapa.rotulo}</span>
            <span className="h-6 overflow-hidden rounded-md bg-slate-100">
              <span className={`block h-full rounded-md ${etapa.cor}`} style={{ width: `${Math.max(etapa.valor > 0 ? 2 : 0, (etapa.valor / base) * 100)}%` }} />
            </span>
            <span className="text-right tabular-nums">
              <strong className="text-ink">{formatarNumero(etapa.valor)}</strong>{" "}
              <span className="text-[11px] text-ink-3">{formatarPercentual(etapa.valor / base)}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PorHorario({ porHora }: { porHora: Insights["porHora"] }) {
  const maior = Math.max(...porHora.map((hora) => hora.enviados), 1);
  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Melhor horário para disparar</h3>
      <p className="mt-1 text-sm text-ink-2">Taxa de resposta pela hora do disparo (horário de Brasília).</p>
      {porHora.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Sem disparos no período.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-2">
          {porHora.map((hora) => {
            const resposta = hora.enviados > 0 ? hora.responderam / hora.enviados : 0;
            return (
              <li key={hora.hora} className="grid grid-cols-[3.5rem_1fr_7.5rem] items-center gap-3 text-sm">
                <span className="tabular-nums text-ink-2">{String(hora.hora).padStart(2, "0")}h</span>
                <span className="relative h-5 overflow-hidden rounded-md bg-slate-100" title={`${hora.enviados} enviadas`}>
                  {/* Barra clara: volume enviado; escura: taxa de resposta. */}
                  <span className="absolute inset-y-0 left-0 rounded-md bg-accent/15" style={{ width: `${(hora.enviados / maior) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 rounded-md bg-accent" style={{ width: `${resposta * 100}%` }} />
                </span>
                <span className="text-right text-xs tabular-nums text-ink-2">
                  <strong className="text-ink">{formatarPercentual(resposta)}</strong> de {formatarNumero(hora.enviados)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

const ORDENS = {
  resposta: { rotulo: "Taxa de resposta", valor: (campanha: CampanhaInsight) => taxa(campanha.responderam, campanha.enviados) ?? -1 },
  matriculas: { rotulo: "Matrículas", valor: (campanha: CampanhaInsight) => campanha.fecharam },
  custoMatricula: { rotulo: "Menor custo por matrícula", valor: (campanha: CampanhaInsight) => (campanha.custoPorMatricula === null ? -Infinity : -campanha.custoPorMatricula) },
  leitura: { rotulo: "Taxa de leitura", valor: (campanha: CampanhaInsight) => taxa(campanha.lidas, campanha.enviados) ?? -1 },
  data: { rotulo: "Mais recentes", valor: (campanha: CampanhaInsight) => new Date(campanha.disparoEm).getTime() },
} as const;
type Ordem = keyof typeof ORDENS;

function TabelaCampanhas({ campanhas }: { campanhas: CampanhaInsight[] }) {
  const [ordem, setOrdem] = useState<Ordem>("resposta");
  const ordenadas = [...campanhas].sort((a, b) => ORDENS[ordem].valor(b) - ORDENS[ordem].valor(a));
  const pct = (parte: number, total: number) => formatarPercentual(taxa(parte, total));

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="font-heading text-base font-bold">Cada campanha</h3>
          <p className="mt-1 text-sm text-ink-2">Clique numa campanha para ver o detalhe de cada destinatário.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-ink-2">
          Ordenar por
          <select value={ordem} onChange={(evento) => setOrdem(evento.target.value as Ordem)} className="rounded-lg px-2 py-1.5 text-sm text-ink">
            {Object.entries(ORDENS).map(([chave, { rotulo }]) => (
              <option key={chave} value={chave}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-slate-50">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              <th className="px-5 py-2.5">Campanha</th>
              <th className="px-3 py-2.5 text-right">Enviadas</th>
              <th className="px-3 py-2.5 text-right">Entregues</th>
              <th className="px-3 py-2.5 text-right">Lidas</th>
              <th className="px-3 py-2.5 text-right">Responderam</th>
              <th className="px-3 py-2.5 text-right">Matrículas</th>
              <th className="px-3 py-2.5 text-right">Custo</th>
              <th className="px-3 py-2.5 text-right">Por matrícula</th>
              <th className="px-5 py-2.5 text-right" title="Mediana do tempo entre o disparo e a primeira resposta">
                Responde em
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((campanha) => (
              <tr key={campanha.id} className="border-t border-card-border transition-colors hover:bg-slate-50/70">
                <td className="max-w-[16rem] px-5 py-2.5">
                  <a href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })} className="block truncate font-semibold text-ink hover:text-accent-text hover:underline">
                    {campanha.nome}
                  </a>
                  <span className="block truncate text-[11px] text-ink-3">
                    {formatarDataHora(campanha.disparoEm)} · {campanha.templateNome}
                    {campanha.falhas > 0 && <span className="text-red-700"> · {formatarNumero(campanha.falhas)} falha{campanha.falhas === 1 ? "" : "s"}</span>}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatarNumero(campanha.enviados)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(campanha.entregues, campanha.enviados)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(campanha.lidas, campanha.enviados)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <strong>{pct(campanha.responderam, campanha.enviados)}</strong>
                  <span className="block text-[11px] text-ink-3">{formatarNumero(campanha.responderam)}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <strong className={campanha.fecharam > 0 ? "text-emerald-700" : ""}>{formatarNumero(campanha.fecharam)}</strong>
                  {campanha.interessados > 0 && <span className="block text-[11px] text-ink-3">+{formatarNumero(campanha.interessados)} interessados</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatarMoeda(campanha.custo)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatarMoeda(campanha.custoPorMatricula)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatarMinutos(campanha.minutosAteResponder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MotivosFalha({ motivos, falhas, total }: { motivos: Insights["motivosFalha"]; falhas: number; total: number }) {
  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Por que os envios falharam</h3>
      <p className="mt-1 text-sm text-ink-2">
        {formatarNumero(falhas)} de {formatarNumero(total)} envios ({formatarPercentual(taxa(falhas, total))}) não chegaram ao cliente.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-card-border border-y border-card-border">
        {motivos.map((motivo) => (
          <li key={motivo.motivo} className="flex items-start justify-between gap-4 py-2.5 text-sm">
            <span className="min-w-0 break-words text-ink-2">{motivo.motivo}</span>
            <strong className="shrink-0 tabular-nums">{formatarNumero(motivo.total)}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}
