import { useEffect, useRef, useState } from "react";
import { CancelarAgendamentoBotao } from "../components/CancelarAgendamentoBotao.js";
import { BotaoExportar } from "../components/Exportar.js";
import { Card } from "../components/Card.js";
import { MensagemPreview } from "../components/MensagemPreview.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { ProgressBar } from "../components/ui/ProgressBar.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { INFO_ETAPA, etapaDe, type Etapa } from "../lib/etapa.js";
import {
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
  formatarPercentual,
  formatarQuando,
  formatarTelefone,
  tempoRelativo,
} from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { AbasCampanhas } from "./CampanhasInsights.js";

const INTERVALO_POLLING_MS = 2000;
const INTERVALO_CHECKS_MS = 30_000;
const INTERVALO_AGENDADAS_MS = 15_000;

type CampanhaListada = SaidaApi["campanhas"]["listar"][number];

// Filtros da lista, pela situação que vem do próprio envio.
const FILTROS = [
  { valor: "todas", rotulo: "Todas", etapas: null },
  { valor: "agendadas", rotulo: "Agendadas", etapas: ["agendada"] },
  { valor: "andamento", rotulo: "Em andamento", etapas: ["na-fila", "enviando"] },
  { valor: "falhas", rotulo: "Com falha", etapas: ["com-falhas", "falhou"] },
  { valor: "concluidas", rotulo: "Concluídas", etapas: ["concluida"] },
] as const satisfies ReadonlyArray<{ valor: string; rotulo: string; etapas: readonly Etapa[] | null }>;
type Filtro = (typeof FILTROS)[number]["valor"];

export function Campanhas({ campanhaId }: { campanhaId: number | null }) {
  const campanhasQuery = trpc.campanhas.listar.useQuery(undefined, {
    refetchInterval: (query) => {
      const lista = query.state.data;
      if (lista?.some((campanha) => campanha.status === "enviando")) return INTERVALO_POLLING_MS;
      // Campanhas agendadas viram "enviando" sozinhas na hora marcada; os checks (entregue/lida) seguem chegando.
      return lista?.some((campanha) => campanha.status === "agendada") ? INTERVALO_AGENDADAS_MS : INTERVALO_CHECKS_MS;
    },
  });
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");

  if (campanhasQuery.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Esqueleto className="h-10 w-80" />
        <Esqueleto className="h-80" />
      </div>
    );
  }

  if (campanhasQuery.isError) {
    return <EstadoErro mensagem={campanhasQuery.error.message} onTentarNovamente={() => void campanhasQuery.refetch()} />;
  }

  const campanhas = campanhasQuery.data;

  if (campanhas.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma campanha criada ainda"
        descricao="Crie uma campanha, cole a lista de telefones e acompanhe aqui o resultado de cada disparo."
        acao={
          <a
            href={hrefDe({ tela: "nova-campanha" })}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            <Icone nome="mais" tamanho={16} />
            Criar campanha
          </a>
        }
      />
    );
  }

  const atualizando = campanhas.some((campanha) => campanha.status === "enviando");
  const etapaDaCampanha = (c: CampanhaListada) => etapaDe(c.status, c.progresso);
  const contagem = (f: (typeof FILTROS)[number]) => (f.etapas === null ? campanhas.length : campanhas.filter((c) => (f.etapas as readonly Etapa[]).includes(etapaDaCampanha(c))).length);
  const filtroAtual = FILTROS.find((f) => f.valor === filtro)!;
  const termo = busca.trim().toLowerCase();
  const visiveis = campanhas.filter(
    (c) =>
      (filtroAtual.etapas === null || (filtroAtual.etapas as readonly Etapa[]).includes(etapaDaCampanha(c))) &&
      (!termo || c.nome.toLowerCase().includes(termo) || c.templateNome.toLowerCase().includes(termo)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className={`flex-col gap-4 ${campanhaId !== null ? "hidden lg:flex" : "flex"}`}>
        <AbasCampanhas ativa="quadro" />
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Filtrar campanhas" className="flex flex-wrap gap-1 rounded-full bg-surface p-1 shadow-card">
            {FILTROS.map((f) => {
              const n = contagem(f);
              if (n === 0 && f.valor !== "todas" && f.valor !== filtro) return null;
              return (
                <button
                  key={f.valor}
                  type="button"
                  aria-pressed={filtro === f.valor}
                  onClick={() => setFiltro(f.valor)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    filtro === f.valor ? "bg-accent text-accent-contrast" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {f.rotulo}
                  <span className={`text-xs tabular-nums ${filtro === f.valor ? "opacity-80" : "text-ink-3"}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <label className="relative min-w-52 flex-1 sm:max-w-xs">
            <span className="sr-only">Buscar campanha</span>
            <Icone nome="busca" tamanho={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou template"
              className="h-10 w-full !rounded-full pl-10 pr-4 text-sm"
            />
          </label>
          {atualizando && (
            <p role="status" className="ml-auto flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-pendente" />
              Atualizando automaticamente
            </p>
          )}
        </div>

        <Card className="overflow-x-auto !p-0">
          {visiveis.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-3">Nenhuma campanha com esse filtro.</p>
          ) : (
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-card-border">
                  <th scope="col" className="py-3 pl-5 pr-3 font-medium">
                    Campanha
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Situação
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Enviadas
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Entregues
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Lidas
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Respostas
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Custo
                  </th>
                  <th scope="col" className="py-3 pl-3 pr-5">
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((campanha) => (
                  <LinhaCampanha key={campanha.id} campanha={campanha} selecionada={campanha.id === campanhaId} />
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {campanhaId !== null && <DetalheCampanha campanhaId={campanhaId} />}
    </div>
  );
}

const SITUACAO: Record<Etapa, string> = {
  agendada: "Agendada",
  "na-fila": "Na fila",
  enviando: "Enviando",
  concluida: "Concluída",
  "com-falhas": "Concluída com falhas",
  falhou: "Falhou",
};

const porcentagem = (parte: number, todo: number) => (todo > 0 ? formatarPercentual(parte / todo) : "");

function LinhaCampanha({ campanha, selecionada }: { campanha: CampanhaListada; selecionada: boolean }) {
  const { progresso } = campanha;
  const etapa = etapaDe(campanha.status, progresso);
  const info = INFO_ETAPA[etapa];
  const agendada = campanha.status === "agendada";
  const href = hrefDe({ tela: "campanhas", campanhaId: campanha.id });
  const numero = (valor: number, apoio?: string) => (
    <td className="px-3 py-3 text-right">
      <a href={href} tabIndex={-1} className="block">
        <span className="font-semibold tabular-nums text-ink">{agendada ? "—" : formatarNumero(valor)}</span>
        {!agendada && apoio && <span className="block text-[11px] tabular-nums text-ink-3">{apoio}</span>}
      </a>
    </td>
  );

  return (
    <tr className={`border-b border-card-border transition-colors last:border-0 ${selecionada ? "bg-accent-soft" : "hover:bg-surface-2/60"}`}>
      <td className="py-3 pl-5 pr-3">
        <a href={href} aria-current={selecionada ? "true" : undefined} className="block min-w-0 focus-visible:outline-2">
          <span className="block font-semibold text-ink">{campanha.nome}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-ink-2">{campanha.templateNome}</span>
            {agendada ? `Dispara ${formatarQuando(campanha.disparoEm)}` : formatarDataHora(campanha.disparoEm)}
          </span>
        </a>
      </td>
      <td className="px-3 py-3">
        <a href={href} tabIndex={-1} className="inline-flex items-center gap-2 whitespace-nowrap text-ink-2">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${info.cor}`} />
          {SITUACAO[etapa]}
        </a>
      </td>
      {numero(progresso.enviado, progresso.falhou > 0 ? `${formatarNumero(progresso.falhou)} falha(s)` : `de ${formatarNumero(progresso.total)}`)}
      {numero(campanha.entregues, porcentagem(campanha.entregues, progresso.enviado))}
      {numero(campanha.lidas, porcentagem(campanha.lidas, progresso.enviado))}
      {numero(campanha.respostas, campanha.taxaRetorno !== null ? formatarPercentual(campanha.taxaRetorno) : undefined)}
      <td className="px-3 py-3 text-right">
        <a href={href} tabIndex={-1} className="font-semibold tabular-nums text-ink">
          {agendada ? "—" : formatarMoeda(campanha.custo)}
        </a>
      </td>
      <td className="py-3 pl-3 pr-5 text-right">
        <a href={href} aria-label={`Abrir ${campanha.nome}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-accent-soft hover:text-accent-text">
          <Icone nome="setaDireita" tamanho={15} />
        </a>
      </td>
    </tr>
  );
}

function DetalheCampanha({ campanhaId }: { campanhaId: number }) {
  const raizRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    raizRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [campanhaId]);

  return (
    <div ref={raizRef} className="scroll-mt-4">
      <ConteudoDetalhe campanhaId={campanhaId} />
    </div>
  );
}

function ConteudoDetalhe({ campanhaId }: { campanhaId: number }) {
  const exportarCampanha = trpc.exportacoes.campanha.useMutation();
  const detalheQuery = trpc.campanhas.detalhe.useQuery(
    { id: campanhaId },
    {
      // Depois do envio, as confirmações de entregue/lida continuam chegando (às vezes horas depois).
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "enviando") return INTERVALO_POLLING_MS;
        return status === "agendada" ? false : INTERVALO_CHECKS_MS;
      },
      retry: (tentativas, erro) => erro.data?.code !== "NOT_FOUND" && tentativas < 2,
    },
  );

  const voltar = (
    <a
      href={hrefDe({ tela: "campanhas", campanhaId: null })}
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline lg:hidden"
    >
      ← Todas as campanhas
    </a>
  );

  if (detalheQuery.isError) {
    return (
      <div>
        {voltar}
        <EstadoErro mensagem={detalheQuery.error.message} onTentarNovamente={() => void detalheQuery.refetch()} />
      </div>
    );
  }

  const campanha = detalheQuery.data;

  if (!campanha) {
    return (
      <div aria-busy="true">
        {voltar}
        <Esqueleto className="h-64" />
      </div>
    );
  }

  const { progresso } = campanha;

  return (
    <div className="min-w-0">
      {voltar}
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-3">Detalhe da campanha</p>
            <h3 className="font-heading text-xl font-bold tracking-tight">{campanha.nome}</h3>
            <p className="mt-1 text-sm text-ink-2">
              {campanha.templateNome} · criada em {formatarDataHora(campanha.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BotaoExportar compacto arquivo={`campanha ${campanha.nome}`} gerar={() => exportarCampanha.mutateAsync({ id: campanha.id })} />
            <StatusBadge status={campanha.status} />
          </div>
        </div>

        {campanha.status === "agendada" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-agendado/25 bg-status-agendado/10 px-4 py-3">
            <p className="text-sm text-status-agendado">
              <strong>Agendada.</strong> Dispara {formatarQuando(campanha.disparoEm)}, automaticamente, se o worker estiver rodando.
            </p>
            <CancelarAgendamentoBotao campanhaId={campanha.id} nome={campanha.nome} aoCancelar={() => (window.location.hash = hrefDe({ tela: "campanhas", campanhaId: null }))} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <ProgressBar enviado={progresso.enviado} falhou={progresso.falhou} pendente={progresso.pendente} />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Indicador rotulo="Enviados" valor={formatarNumero(progresso.enviado)} apoio={`de ${formatarNumero(progresso.total)}`} cor="bg-status-enviado" />
            <Indicador
              rotulo="Entregues"
              valor={formatarNumero(campanha.entregues)}
              apoio={progresso.enviado > 0 ? `${formatarPercentual(campanha.entregues / progresso.enviado)} dos enviados` : undefined}
              cor="bg-slate-400"
            />
            <Indicador
              rotulo="Lidas"
              valor={formatarNumero(campanha.lidas)}
              apoio={progresso.enviado > 0 ? `${formatarPercentual(campanha.lidas / progresso.enviado)} dos enviados` : undefined}
              cor="bg-sky-500"
            />
            <Indicador rotulo="Falhas" valor={formatarNumero(progresso.falhou)} cor="bg-status-falhou" />
            <Indicador rotulo="Pendentes" valor={formatarNumero(progresso.pendente)} cor="bg-status-pendente" />
            <Indicador
              rotulo="Respostas"
              valor={formatarNumero(campanha.respostas)}
              apoio={campanha.taxaRetorno !== null ? `${formatarPercentual(campanha.taxaRetorno)} dos enviados` : undefined}
              cor="bg-accent"
            />
            <Indicador rotulo="Custo" valor={formatarMoeda(campanha.custo)} apoio="sobre os enviados" cor="bg-baseline" />
          </dl>
        </div>

        <MensagemPreview rotulo="Mensagem enviada" mensagem={campanha.mensagem} />

        <div className="max-h-[60vh] overflow-auto rounded-xl border border-card-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <th className="px-4 py-2.5">Telefone</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {campanha.destinatarios.map((destinatario) => (
                <tr key={destinatario.id} className="border-t border-card-border transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-mono text-xs sm:text-sm">{formatarTelefone(destinatario.telefone)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={destinatario.statusEnvio} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-2">
                    {destinatario.erroDetalhe ?? <SituacaoDeEntrega destinatario={destinatario} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Checks do WhatsApp por destinatário: o passo mais avançado que a Meta confirmou.
function SituacaoDeEntrega({ destinatario }: { destinatario: { enviadoEm: string | null; entregueEm: string | null; lidaEm: string | null } }) {
  const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  if (destinatario.lidaEm) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-sky-600">
        <Icone nome="checkDuplo" tamanho={14} /> Lida em {hora(destinatario.lidaEm)}
      </span>
    );
  }
  if (destinatario.entregueEm) {
    return (
      <span className="inline-flex items-center gap-1">
        <Icone nome="checkDuplo" tamanho={14} /> Entregue em {hora(destinatario.entregueEm)}
      </span>
    );
  }
  if (destinatario.enviadoEm) {
    return (
      <span className="inline-flex items-center gap-1">
        <Icone nome="check" tamanho={12} /> Enviada em {hora(destinatario.enviadoEm)}
      </span>
    );
  }
  return null;
}

function Indicador({ rotulo, valor, apoio, cor }: { rotulo: string; valor: string; apoio?: string; cor: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${cor}`} />
        {rotulo}
      </dt>
      <dd className="mt-1 font-heading text-xl font-bold tabular-nums text-ink">{valor}</dd>
      {apoio && <p className="text-xs text-ink-3">{apoio}</p>}
    </div>
  );
}
