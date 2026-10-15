import { PERIODOS_VISAO, ROTULO_MOTIVO_PERDA, type MotivoPerda } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { PrimeirosPassos } from "../components/PrimeirosPassos.js";
import { MedidorFunil } from "../components/charts/MedidorFunil.js";
import { PilulasPorDia } from "../components/charts/PilulasPorDia.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { SeletorPeriodoVisao, type PeriodoEscolhido } from "../components/ui/SeletorPeriodoVisao.js";
import { formatarMoeda, formatarNumero, formatarPercentual } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Dono = SaidaApi["dashboard"]["dono"];

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
  return { periodo: "30d" };
}

// Painel do dono da unidade: poucas perguntas, respondidas de relance — estamos vendendo? quanto custa?
// tem alguém esperando? por que não fecham? O detalhe de cada coisa fica na tela própria.
export function VisaoGeral() {
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>(periodoSalvo);
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PERIODO, JSON.stringify(periodo));
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  }, [periodo]);

  const consulta = trpc.dashboard.dono.useQuery(periodo, { placeholderData: keepPreviousData, refetchInterval: ATUALIZACAO_MS });
  const dados = consulta.data;
  const atualizadoEm = consulta.dataUpdatedAt ? new Date(consulta.dataUpdatedAt) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-ink-3">
          {atualizadoEm && (
            <>
              Atualizado às {atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              <button
                type="button"
                onClick={() => void consulta.refetch()}
                disabled={consulta.isFetching}
                className="font-semibold text-accent-text hover:underline disabled:opacity-50"
              >
                {consulta.isFetching ? "Atualizando…" : "Atualizar agora"}
              </button>
            </>
          )}
        </p>
        <SeletorPeriodoVisao valor={periodo} onChange={setPeriodo} />
      </div>

      <PrimeirosPassos />

      {!dados && consulta.isError && <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />}
      {!dados && consulta.isPending && <Carregando />}
      {dados && (
        <div className={`flex flex-col gap-4 transition-opacity ${consulta.isPlaceholderData ? "opacity-60" : ""}`}>
          <AlertaAgora agora={dados.agora} />
          <Numeros dados={dados} />
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="min-w-0 lg:col-span-7">
              <Titulo titulo={dados.periodo.agrupamento === "mes" ? "Matrículas por mês" : "Matrículas por dia"} href={hrefDe({ tela: "funil" })} />
              <div className="mt-5">
                <PilulasPorDia
                  serie={dados.serie.map((ponto) => ({ dia: ponto.dia, valor: ponto.matriculas }))}
                  agrupamento={dados.periodo.agrupamento}
                  descrever={(valor) => `${formatarNumero(valor)} ${valor === 1 ? "matrícula" : "matrículas"}`}
                  rotuloAcessivel={`Matrículas por ${dados.periodo.agrupamento === "mes" ? "mês" : "dia"}`}
                />
              </div>
            </Card>
            <Card className="flex flex-col lg:col-span-5">
              <Titulo titulo="Onde estão os clientes" href={hrefDe({ tela: "funil" })} />
              <div className="mt-4 flex flex-1 items-center justify-center">
                <MedidorFunil
                  destaque={dados.funil.taxaFechamento}
                  legendaDestaque="dos decididos fecharam"
                  fatias={[
                    { chave: "fechou", rotulo: "Matriculados", valor: dados.funil.fechou, cor: "graf-1" },
                    { chave: "andamento", rotulo: "Em negociação", valor: dados.funil.emAndamento, cor: "graf-2" },
                    { chave: "nao", rotulo: "Não fecharam", valor: dados.funil.naoFechou, cor: "listras" },
                  ]}
                />
              </div>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ListaCurta
              titulo="Por que não fecharam"
              href={hrefDe({ tela: "funil" })}
              vazio="Nenhum cliente desistiu neste período."
              itens={dados.motivosPerda.map((item) => ({
                chave: item.motivo,
                texto: ROTULO_MOTIVO_PERDA[item.motivo as MotivoPerda] ?? item.motivo,
                total: item.total,
              }))}
            />
            <ListaCurta
              titulo="O que os clientes mais perguntam"
              href={hrefDe({ tela: "duvidas" })}
              vazio="Nenhuma dúvida registrada neste período."
              itens={dados.duvidas.map((item) => ({
                chave: item.tema,
                texto: item.tema,
                total: item.total,
                nota: item.semResposta > 0 ? `${formatarNumero(item.semResposta)} sem resposta do bot` : undefined,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Carregando() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((indice) => (
          <Esqueleto key={indice} className="h-[150px] rounded-3xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Esqueleto className="h-[300px] rounded-3xl lg:col-span-7" />
        <Esqueleto className="h-[300px] rounded-3xl lg:col-span-5" />
      </div>
    </div>
  );
}

// Título de card com o botão redondo de seta (atalho para a tela completa), como no modelo.
function Titulo({ titulo, href }: { titulo: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-heading text-lg font-semibold text-ink">{titulo}</h3>
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

// Só aparece quando tem cliente esperando: é a única coisa do painel que pede ação agora.
function AlertaAgora({ agora }: { agora: Dono["agora"] }) {
  if (agora.precisaHumano === 0 && agora.aguardando === 0) return null;
  const partes = [
    agora.precisaHumano > 0 && `${formatarNumero(agora.precisaHumano)} ${agora.precisaHumano === 1 ? "cliente pedindo" : "clientes pedindo"} uma pessoa`,
    agora.aguardando > 0 && `${formatarNumero(agora.aguardando)} ${agora.aguardando === 1 ? "conversa" : "conversas"} sem resposta`,
    agora.acabando > 0 && `${formatarNumero(agora.acabando)} com a janela de 24h acabando`,
  ].filter(Boolean);
  return (
    <section
      aria-label="Clientes esperando"
      className="flex flex-wrap items-center gap-4 rounded-3xl bg-gradient-to-r from-[#25083d] to-[#470e75] px-5 py-4 text-white shadow-card"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-2 text-lg">🙋</span>
      <p className="min-w-0 flex-1 text-sm">
        <strong className="block text-base font-semibold">Tem cliente esperando agora</strong>
        <span className="text-white/75">{partes.join(" · ")}</span>
      </p>
      <a
        href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#470e75] transition-colors hover:bg-brand-2 hover:text-white"
      >
        Atender
        <Icone nome="setaDireita" tamanho={15} />
      </a>
    </section>
  );
}

// Variação contra o período anterior, já no sentido certo (subir custo é ruim).
export function Variacao({
  atual,
  anterior,
  altaEhBoa,
  emPontos,
  sobreDestaque,
}: {
  atual: number | null;
  anterior: number | null;
  altaEhBoa: boolean;
  emPontos?: boolean;
  sobreDestaque?: boolean;
}) {
  if (atual === null || anterior === null) return null;
  let texto: string;
  let direcao: "alta" | "queda" | "estavel";
  if (emPontos) {
    const pontos = (atual - anterior) * 100;
    direcao = Math.abs(pontos) < 0.05 ? "estavel" : pontos > 0 ? "alta" : "queda";
    texto = direcao === "estavel" ? "igual" : `${Math.abs(pontos).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
  } else if (anterior === 0) {
    if (atual === 0) return null;
    direcao = "alta";
    texto = "novo";
  } else {
    const pct = ((atual - anterior) / anterior) * 100;
    direcao = Math.abs(pct) < 0.5 ? "estavel" : pct > 0 ? "alta" : "queda";
    texto = direcao === "estavel" ? "igual" : `${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  }
  const boa = direcao === "estavel" ? null : (direcao === "alta") === altaEhBoa;
  const cor = sobreDestaque
    ? "border-white/30 text-white"
    : boa === null
      ? "border-card-border text-ink-3"
      : boa
        ? "border-success/30 text-success-text"
        : "border-brand-2/30 text-brand-2-text";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md border px-1 text-[10px] font-semibold ${cor}`}>
      {direcao === "alta" ? "▲" : direcao === "queda" ? "▼" : "•"} {texto}
    </span>
  );
}

function Numeros({ dados }: { dados: Dono }) {
  const comparacao = dados.periodo.comparacao ?? "em todo o período";
  const itens: Array<{ rotulo: string; valor: string; variacao: ReactNode; apoio: string; href: string }> = [
    {
      rotulo: "Matrículas",
      valor: formatarNumero(dados.matriculas.atual),
      variacao: <Variacao {...dados.matriculas} altaEhBoa sobreDestaque />,
      apoio: comparacao,
      href: hrefDe({ tela: "funil" }),
    },
    {
      rotulo: "Clientes atendidos",
      valor: formatarNumero(dados.atendidos.atual),
      variacao: <Variacao {...dados.atendidos} altaEhBoa />,
      apoio: "conversaram com a unidade",
      href: hrefDe({ tela: "conversas", telefone: null, numeroId: null }),
    },
    {
      rotulo: "Taxa de conversão",
      valor: formatarPercentual(dados.conversao.atual),
      variacao: <Variacao {...dados.conversao} altaEhBoa emPontos />,
      apoio: "dos atendidos se matricularam",
      href: hrefDe({ tela: "funil" }),
    },
    {
      rotulo: "Custo por matrícula",
      valor: dados.custoPorMatricula.atual === null ? "—" : formatarMoeda(Math.round(dados.custoPorMatricula.atual * 100) / 100),
      variacao: <Variacao atual={dados.custoPorMatricula.atual} anterior={dados.custoPorMatricula.anterior} altaEhBoa={false} />,
      apoio: `${formatarMoeda(Math.round(dados.custoPorMatricula.custoTotal * 100) / 100)} em disparos`,
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
                  destaque
                    ? "bg-white text-[#470e75] hover:bg-brand-2 hover:text-white"
                    : "border border-card-border text-ink hover:border-accent hover:bg-accent hover:text-accent-contrast"
                }`}
              >
                <Icone nome="setaDiagonal" tamanho={16} />
              </a>
            </div>
            <p className="tabular relative mt-4 font-heading text-[2.75rem] font-bold leading-none tracking-tight">{item.valor}</p>
            <p className={`relative mt-3 flex flex-wrap items-center gap-1.5 text-xs ${destaque ? "text-white/80" : "text-ink-3"}`}>
              {item.variacao}
              {item.apoio}
            </p>
          </div>
        );
      })}
    </section>
  );
}

// Lista de até 3 itens com barra de proporção: o "top 3" de algo, para ler em dois segundos.
function ListaCurta({
  titulo,
  href,
  vazio,
  itens,
}: {
  titulo: string;
  href: string;
  vazio: string;
  itens: Array<{ chave: string; texto: string; total: number; nota?: string }>;
}) {
  const maior = Math.max(...itens.map((item) => item.total), 1);
  return (
    <Card>
      <Titulo titulo={titulo} href={href} />
      {itens.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{vazio}</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3.5">
          {itens.map((item, indice) => (
            <li key={item.chave} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-text">
                {indice + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-ink">{item.texto}</span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink">{formatarNumero(item.total)}</span>
                </div>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-graf-trilho">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(item.total / maior) * 100}%` }} />
                </span>
                {item.nota && <span className="mt-1 block text-[11px] text-brand-2-text">{item.nota}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
