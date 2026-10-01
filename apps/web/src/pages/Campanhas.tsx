import { useEffect, useRef, useState, type DragEvent } from "react";
import { CancelarAgendamentoBotao } from "../components/CancelarAgendamentoBotao.js";
import { Card } from "../components/Card.js";
import { MensagemPreview } from "../components/MensagemPreview.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { ProgressBar } from "../components/ui/ProgressBar.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { ETAPAS, INFO_ETAPA, etapaDe, etapaExibida, type Etapa } from "../lib/etapa.js";
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

const INTERVALO_POLLING_MS = 2000;
const INTERVALO_AGENDADAS_MS = 15_000;

export function Campanhas({ campanhaId }: { campanhaId: number | null }) {
  const campanhasQuery = trpc.campanhas.listar.useQuery(undefined, {
    refetchInterval: (query) => {
      const lista = query.state.data;
      if (lista?.some((campanha) => campanha.status === "enviando")) return INTERVALO_POLLING_MS;
      // Campanhas agendadas viram "enviando" sozinhas na hora marcada: reconsulta de vez em quando.
      return lista?.some((campanha) => campanha.status === "agendada") ? INTERVALO_AGENDADAS_MS : false;
    },
  });

  const utils = trpc.useUtils();
  // Durante um arraste todas as colunas abrem, para dar onde soltar; as vazias ficam estreitas no resto do tempo.
  const [arrastando, setArrastando] = useState(false);

  // Atualiza o card na hora e desfaz se o servidor recusar; o refetch final garante o estado real.
  const moverEtapa = trpc.campanhas.moverEtapa.useMutation({
    onMutate: async ({ id, etapa }) => {
      await utils.campanhas.listar.cancel();
      const anterior = utils.campanhas.listar.getData();
      utils.campanhas.listar.setData(undefined, (lista) =>
        lista?.map((campanha) => (campanha.id === id ? { ...campanha, etapaManual: etapa } : campanha)),
      );
      return { anterior };
    },
    onError: (erro, _variaveis, contexto) => {
      if (contexto?.anterior) utils.campanhas.listar.setData(undefined, contexto.anterior);
      toast.erro(mensagemDeErro(erro));
    },
    onSettled: () => void utils.campanhas.listar.invalidate(),
  });

  if (campanhasQuery.isPending) {
    return (
      <div aria-busy="true" className="flex gap-4 overflow-hidden">
        {ETAPAS.map((etapa) => (
          <Esqueleto key={etapa} className="h-80 w-[19rem] shrink-0" />
        ))}
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
        descricao="Crie uma campanha, cole a lista de telefones e acompanhe aqui o status de envio de cada número."
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

  function mover(campanha: CampanhaListada, destino: Etapa) {
    if (destino === etapaExibida(campanha)) return;
    // Soltar na coluna que o status já indicaria equivale a voltar ao automático.
    const etapa = destino === etapaDe(campanha.status, campanha.progresso) ? null : destino;
    moverEtapa.mutate({ id: campanha.id, etapa });
  }

  function restaurar(campanha: CampanhaListada) {
    moverEtapa.mutate({ id: campanha.id, etapa: null });
  }

  function soltar(id: number, destino: Etapa) {
    const campanha = campanhas.find((item) => item.id === id);
    if (campanha) mover(campanha, destino);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className={`flex-col gap-3 ${campanhaId !== null ? "hidden lg:flex" : "flex"}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="flex items-center gap-2 text-xs text-ink-3">
            <Icone nome="arrastar" tamanho={14} />
            Arraste os cards entre as colunas ou use “Mover para”. A posição fica salva; sem ela, o card segue o status de envio.
          </p>
          {atualizando && (
            <p role="status" className="flex items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-pendente" />
              Atualizando automaticamente
            </p>
          )}
        </div>

        <div className="-mx-1 flex snap-x items-start gap-4 overflow-x-auto px-1 pb-3">
          {ETAPAS.map((etapa) => (
            <ColunaKanban
              key={etapa}
              etapa={etapa}
              campanhas={campanhas.filter((campanha) => etapaExibida(campanha) === etapa)}
              campanhaId={campanhaId}
              arrastando={arrastando}
              onArraste={setArrastando}
              onSoltar={soltar}
              onMover={mover}
              onRestaurar={restaurar}
            />
          ))}
        </div>
      </div>

      {campanhaId !== null && <DetalheCampanha campanhaId={campanhaId} />}
    </div>
  );
}

type CampanhaListada = SaidaApi["campanhas"]["listar"][number];

// Tipo próprio para só aceitar cards da nossa tela (e não arquivos ou links soltos de fora).
const TIPO_ARRASTE = "application/x-campanha-id";

interface ColunaKanbanProps {
  etapa: Etapa;
  campanhas: CampanhaListada[];
  campanhaId: number | null;
  arrastando: boolean;
  onArraste: (arrastando: boolean) => void;
  onSoltar: (id: number, etapa: Etapa) => void;
  onMover: (campanha: CampanhaListada, etapa: Etapa) => void;
  onRestaurar: (campanha: CampanhaListada) => void;
}

function ColunaKanban({ etapa, campanhas, campanhaId, arrastando, onArraste, onSoltar, onMover, onRestaurar }: ColunaKanbanProps) {
  const { titulo, descricao, cor } = INFO_ETAPA[etapa];
  const [recebendo, setRecebendo] = useState(false);
  const compacta = campanhas.length === 0 && !arrastando;

  function aoArrastarSobre(evento: DragEvent<HTMLElement>) {
    if (!evento.dataTransfer.types.includes(TIPO_ARRASTE)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setRecebendo(true);
  }

  function aoSair(evento: DragEvent<HTMLElement>) {
    // dragleave também dispara ao passar por cima dos filhos; só desliga ao sair da coluna de fato.
    if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setRecebendo(false);
  }

  function aoSoltar(evento: DragEvent<HTMLElement>) {
    evento.preventDefault();
    setRecebendo(false);
    onArraste(false);
    const id = Number(evento.dataTransfer.getData(TIPO_ARRASTE));
    if (Number.isInteger(id) && id > 0) onSoltar(id, etapa);
  }

  return (
    <section
      aria-label={titulo}
      onDragOver={aoArrastarSobre}
      onDragLeave={aoSair}
      onDrop={aoSoltar}
      className={`flex max-h-[calc(100vh-15rem)] min-h-56 shrink-0 snap-start flex-col rounded-2xl p-2.5 transition-colors ${
        compacta ? "w-48" : "w-[18.5rem]"
      } ${recebendo ? "bg-accent-soft ring-2 ring-accent/40" : "bg-slate-200/50"}`}
    >
      <header className="flex flex-col gap-0.5 px-2 pb-3 pt-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${cor}`} />
            {titulo}
          </h3>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2 shadow-card">
            {formatarNumero(campanhas.length)}
          </span>
        </div>
        {!compacta && <p className="text-xs text-ink-3">{descricao}</p>}
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-0.5 pb-0.5">
        {campanhas.length === 0 ? (
          <p
            className={`flex min-h-24 flex-1 items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-xs font-medium ${
              recebendo ? "border-accent/50 text-accent-text" : "border-slate-300/80 text-ink-3"
            }`}
          >
            {recebendo ? "Solte aqui" : "Nenhuma campanha"}
          </p>
        ) : (
          campanhas.map((campanha) => (
            <CartaoCampanha
              key={campanha.id}
              campanha={campanha}
              etapaAtual={etapa}
              selecionada={campanha.id === campanhaId}
              onArraste={onArraste}
              onMover={onMover}
              onRestaurar={onRestaurar}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface CartaoCampanhaProps {
  campanha: CampanhaListada;
  etapaAtual: Etapa;
  selecionada: boolean;
  onArraste: (arrastando: boolean) => void;
  onMover: (campanha: CampanhaListada, etapa: Etapa) => void;
  onRestaurar: (campanha: CampanhaListada) => void;
}

function CartaoCampanha({ campanha, etapaAtual, selecionada, onArraste, onMover, onRestaurar }: CartaoCampanhaProps) {
  const [arrastando, setArrastando] = useState(false);
  const { progresso } = campanha;
  const agendada = campanha.status === "agendada";

  function aoComecarArraste(evento: DragEvent<HTMLDivElement>) {
    evento.dataTransfer.setData(TIPO_ARRASTE, String(campanha.id));
    evento.dataTransfer.effectAllowed = "move";
    setArrastando(true);
    // Adiado: mexer no layout dentro do dragstart pode fazer o navegador cancelar o arraste.
    window.setTimeout(() => onArraste(true), 0);
  }

  return (
    <div
      draggable
      onDragStart={aoComecarArraste}
      onDragEnd={() => {
        setArrastando(false);
        onArraste(false);
      }}
      className={`group shrink-0 cursor-grab rounded-xl border bg-surface transition-colors active:cursor-grabbing ${
        selecionada ? "border-accent ring-2 ring-accent/20" : "border-card-border hover:border-baseline"
      } ${arrastando ? "rotate-1 opacity-40" : ""}`}
    >
      {/* draggable=false: senão o navegador arrasta o link em vez do card inteiro. */}
      <a
        href={hrefDe({ tela: "campanhas", campanhaId: campanha.id })}
        draggable={false}
        aria-current={selecionada ? "true" : undefined}
        className="flex flex-col gap-3 p-3.5 pb-3"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-heading text-sm font-semibold leading-snug text-ink">{campanha.nome}</span>
          <Icone nome="arrastar" tamanho={14} className="mt-0.5 text-baseline transition-colors group-hover:text-ink-3" />
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-ink-2">{campanha.templateNome}</span>
          {agendada ? `Dispara ${formatarQuando(campanha.disparoEm)}` : tempoRelativo(campanha.disparoEm)}
        </span>

        {agendada ? (
          <p className="rounded-lg bg-status-agendado/10 px-3 py-2 text-xs font-medium text-status-agendado">
            {formatarNumero(progresso.total)} {progresso.total === 1 ? "destinatário" : "destinatários"} · ainda não enviado
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <ProgressBar enviado={progresso.enviado} falhou={progresso.falhou} pendente={progresso.pendente} />
            <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
              <Metrica rotulo="enviados" valor={formatarNumero(progresso.enviado)} cor="bg-status-enviado" />
              {progresso.falhou > 0 && <Metrica rotulo="falhas" valor={formatarNumero(progresso.falhou)} cor="bg-status-falhou" />}
              {progresso.pendente > 0 && <Metrica rotulo="pendentes" valor={formatarNumero(progresso.pendente)} cor="bg-status-pendente" />}
            </dl>
          </div>
        )}

        {!agendada && (
        <span className="flex items-center justify-between gap-2 border-t border-card-border pt-2.5 text-xs text-ink-3">
          <span className="flex items-center gap-1.5">
            <Icone nome="mensagem" tamanho={13} />
            <strong className="tabular-nums text-ink">{formatarNumero(campanha.respostas)}</strong>
            {campanha.taxaRetorno !== null && <span>({formatarPercentual(campanha.taxaRetorno)})</span>}
          </span>
          <span className="flex items-center gap-1.5">
            <Icone nome="moeda" tamanho={13} />
            <strong className="tabular-nums text-ink">{formatarMoeda(campanha.custo)}</strong>
          </span>
        </span>
        )}
      </a>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-b-xl border-t border-card-border px-3.5 py-2">
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          Mover para
          <select
            value={etapaAtual}
            onChange={(evento) => onMover(campanha, evento.target.value as Etapa)}
            className="rounded-md py-0.5 pl-1.5 pr-1 text-xs font-medium text-ink"
          >
            {ETAPAS.map((etapa) => (
              <option key={etapa} value={etapa}>
                {INFO_ETAPA[etapa].titulo}
              </option>
            ))}
          </select>
        </label>
        {campanha.etapaManual !== null && (
          <button
            type="button"
            onClick={() => onRestaurar(campanha)}
            title="Posição definida por você. Clique para o card voltar a seguir o status de envio."
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent-text hover:bg-accent-soft"
          >
            <Icone nome="desfazer" tamanho={12} />
            Automático
          </button>
        )}
      </div>
    </div>
  );
}

function Metrica({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="flex items-center gap-1">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${cor}`} />
      <span className="font-semibold tabular-nums text-ink">{valor}</span> {rotulo}
    </div>
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
  const detalheQuery = trpc.campanhas.detalhe.useQuery(
    { id: campanhaId },
    {
      refetchInterval: (query) => (query.state.data?.status === "enviando" ? INTERVALO_POLLING_MS : false),
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
          <StatusBadge status={campanha.status} />
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
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Indicador rotulo="Enviados" valor={formatarNumero(progresso.enviado)} apoio={`de ${formatarNumero(progresso.total)}`} cor="bg-status-enviado" />
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
                    {destinatario.erroDetalhe ??
                      (destinatario.enviadoEm ? `Enviado às ${new Date(destinatario.enviadoEm).toLocaleTimeString("pt-BR")}` : "")}
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
