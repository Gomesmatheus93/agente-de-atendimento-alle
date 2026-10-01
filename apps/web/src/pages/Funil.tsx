import {
  DESCRICAO_ETAPA_FUNIL,
  ETAPAS_FUNIL,
  MOTIVOS_PERDA,
  ROTULO_ETAPA_FUNIL,
  ROTULO_MOTIVO_PERDA,
  type EtapaFunil,
  type MotivoPerda,
} from "@atendimento-academias/shared";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { StatTile } from "../components/charts/StatTile.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarNumero, formatarPercentual, formatarTelefone, tempoRelativo } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Quadro = SaidaApi["funil"]["quadro"];
type CardCliente = Quadro["cards"][number];

const COR_ETAPA: Record<EtapaFunil, string> = {
  em_conversa: "bg-baseline",
  interessado: "bg-status-agendado",
  fechando: "bg-status-pendente",
  fechou: "bg-status-enviado",
  nao_fechou: "bg-status-falhou",
};

// Tipo próprio para só aceitar cards desta tela (e não arquivos ou links soltos de fora).
const TIPO_ARRASTE = "application/x-funil-cliente";
const chaveDe = (card: Pick<CardCliente, "numeroId" | "telefone">) => `${card.numeroId}:${card.telefone}`;

// Preços do Claude Opus 5 por milhão de tokens (entrada/saída), para estimar o custo da análise.
const USD_ENTRADA_POR_MILHAO = 5;
const USD_SAIDA_POR_MILHAO = 25;

export function Funil() {
  const utils = trpc.useUtils();
  const quadro = trpc.funil.quadro.useQuery(undefined, { refetchInterval: 30_000 });
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState(false);
  // Soltar em "Não fechou" pede o motivo antes de salvar.
  const [perdendo, setPerdendo] = useState<CardCliente | null>(null);

  const mover = trpc.funil.mover.useMutation({
    onMutate: async ({ telefone, numeroId, etapa, motivoPerda }) => {
      await utils.funil.quadro.cancel();
      const anterior = utils.funil.quadro.getData();
      utils.funil.quadro.setData(undefined, (dados) =>
        dados && {
          ...dados,
          cards: dados.cards.map((card) =>
            card.telefone === telefone && card.numeroId === numeroId
              ? { ...card, etapa, etapaOrigem: "manual" as const, motivoPerda: etapa === "nao_fechou" ? (motivoPerda ?? "outro") : null }
              : card,
          ),
        },
      );
      return { anterior };
    },
    onError: (erro, _variaveis, contexto) => {
      if (contexto?.anterior) utils.funil.quadro.setData(undefined, contexto.anterior);
      toast.erro(mensagemDeErro(erro));
    },
    onSettled: () => void utils.funil.quadro.invalidate(),
  });

  const devolver = trpc.funil.devolverParaIa.useMutation({
    onSuccess: () => {
      toast.sucesso("A IA volta a decidir a etapa deste cliente na próxima análise.");
      void utils.funil.quadro.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function moverPara(card: CardCliente, etapa: EtapaFunil) {
    if (card.etapa === etapa && etapa !== "nao_fechou") return;
    if (etapa === "nao_fechou") {
      setPerdendo({ ...card });
      return;
    }
    mover.mutate({ telefone: card.telefone, numeroId: card.numeroId, etapa });
  }

  if (quadro.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Esqueleto className="h-24" />
        <div className="flex gap-4 overflow-hidden">
          {ETAPAS_FUNIL.map((etapa) => (
            <Esqueleto key={etapa} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      </div>
    );
  }
  if (!quadro.data) return <EstadoErro mensagem={quadro.error?.message ?? "Erro ao carregar"} onTentarNovamente={() => void quadro.refetch()} />;

  const dados = quadro.data;
  const termo = busca.trim().toLowerCase();
  const soDigitos = termo.replace(/\D/g, "");
  const visiveis = termo
    ? dados.cards.filter(
        (card) =>
          card.nome?.toLowerCase().includes(termo) ||
          (soDigitos.length >= 3 && card.telefone.includes(soDigitos)) ||
          card.resumo?.toLowerCase().includes(termo) ||
          card.ultimaMensagem.toLowerCase().includes(termo),
      )
    : dados.cards;

  function soltar(chave: string, etapa: EtapaFunil) {
    const card = dados.cards.find((item) => chaveDe(item) === chave);
    if (card) moverPara(card, etapa);
  }

  return (
    <div className="flex flex-col gap-6">
      <PainelAnalise />

      {dados.cards.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum cliente respondeu ainda"
          descricao="Cada cliente que responder a um disparo vira um card aqui. A análise diária da IA posiciona os cards nas colunas; você também pode arrastar."
        />
      ) : (
        <>
          <Resumo dados={dados} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="relative min-w-56 max-w-md flex-1">
              <span className="sr-only">Buscar cliente</span>
              <Icone nome="busca" tamanho={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar por nome, telefone ou assunto"
                className="w-full rounded-lg py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <p className="flex items-center gap-2 text-xs text-ink-3">
              <Icone nome="arrastar" tamanho={14} />
              Arraste os cards ou use “Mover para”. Card movido à mão não é mais mudado pela IA.
            </p>
          </div>

          <div className="-mx-1 flex snap-x items-start gap-4 overflow-x-auto px-1 pb-3">
            {ETAPAS_FUNIL.map((etapa) => (
              <Coluna
                key={etapa}
                etapa={etapa}
                cards={visiveis.filter((card) => card.etapa === etapa)}
                arrastando={arrastando}
                onArraste={setArrastando}
                onSoltar={soltar}
                onMover={moverPara}
                onDevolver={(card) => devolver.mutate({ telefone: card.telefone, numeroId: card.numeroId })}
              />
            ))}
          </div>
        </>
      )}

      {perdendo && (
        <DialogoMotivo
          card={perdendo}
          onCancelar={() => setPerdendo(null)}
          onConfirmar={(motivoPerda, motivoDetalhe) => {
            mover.mutate({ telefone: perdendo.telefone, numeroId: perdendo.numeroId, etapa: "nao_fechou", motivoPerda, motivoDetalhe });
            setPerdendo(null);
          }}
        />
      )}
    </div>
  );
}

// Situação da análise diária: quando rodou, quanto analisou e quanto custou, com o botão de rodar agora.
function PainelAnalise() {
  const utils = trpc.useUtils();
  const status = trpc.funil.statusAnalise.useQuery(undefined, {
    refetchInterval: (consulta) => (consulta.state.data?.ultima?.situacao === "rodando" ? 4000 : 60_000),
  });
  const analisar = trpc.funil.analisarAgora.useMutation({
    onSuccess: () => {
      toast.sucesso("Análise iniciada. Os cards se atualizam sozinhos quando terminar.");
      void utils.funil.statusAnalise.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const ultima = status.data?.ultima;
  const rodando = ultima?.situacao === "rodando";
  // Quando a rodada termina, o quadro e o ranking precisam refletir o que a IA acabou de gravar.
  const estavaRodando = useRef(false);
  useEffect(() => {
    if (estavaRodando.current && !rodando) {
      void utils.funil.quadro.invalidate();
      void utils.duvidas.invalidate();
    }
    estavaRodando.current = rodando;
  }, [rodando, utils]);

  const custo =
    ultima?.tokensEntrada !== undefined && ultima.tokensSaida !== undefined
      ? (ultima.tokensEntrada * USD_ENTRADA_POR_MILHAO + ultima.tokensSaida * USD_SAIDA_POR_MILHAO) / 1_000_000
      : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <Icone nome="ia" tamanho={18} />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-sm font-bold text-ink">Análise diária da IA</p>
          {status.data && !status.data.disponivel ? (
            <p className="text-xs text-amber-900">
              Desligada: falta a <code className="font-mono">ANTHROPIC_API_KEY</code> no <code className="font-mono">.env</code> do worker. Sem ela, os cards
              ficam em “Em conversa” e só mudam quando você arrasta.
            </p>
          ) : rodando ? (
            <p className="flex items-center gap-2 text-xs text-status-agendado">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-agendado" />
              Analisando as conversas…
            </p>
          ) : ultima ? (
            <p className="text-xs text-ink-2">
              {ultima.situacao === "falhou" ? (
                <span className="text-red-700">A última rodada falhou: {ultima.mensagemErro}</span>
              ) : (
                <>
                  Última rodada {tempoRelativo(ultima.fim ?? ultima.inicio)} ({ultima.origem === "manual" ? "pedida na tela" : "automática"}):{" "}
                  {formatarNumero(ultima.analisadas ?? 0)} conversa(s) analisada(s)
                  {ultima.erros ? `, ${ultima.erros} com erro` : ""}
                  {ultima.restantes ? `, ${ultima.restantes} para a próxima` : ""}
                  {custo !== null ? ` · custo estimado US$ ${custo.toFixed(2)}` : ""}.
                </>
              )}{" "}
              Roda sozinha todo dia às 3h.
            </p>
          ) : (
            <p className="text-xs text-ink-2">Ainda não rodou. Roda sozinha todo dia às 3h, só nas conversas com mensagem nova.</p>
          )}
        </div>
      </div>
      <Button
        variante="secundario"
        disabled={rodando || analisar.isPending || status.data?.disponivel === false}
        onClick={() => analisar.mutate()}
      >
        {rodando ? "Analisando…" : "Analisar agora"}
      </Button>
    </Card>
  );
}

function Resumo({ dados }: { dados: Quadro }) {
  const total = dados.cards.length;
  const maiorMotivo = dados.motivos[0];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile rotulo="Clientes no funil" icone="usuarios" valor={formatarNumero(total)} referencia="que já responderam" />
      <StatTile
        rotulo="Perto de fechar"
        icone="relogio"
        valor={formatarNumero(dados.porEtapa.fechando)}
        referencia={`${formatarNumero(dados.porEtapa.interessado)} interessado(s) antes disso`}
      />
      <StatTile
        rotulo="Taxa de fechamento"
        icone="percentual"
        valor={dados.taxaFechamento === null ? "—" : formatarPercentual(dados.taxaFechamento)}
        referencia={`${formatarNumero(dados.porEtapa.fechou)} fecharam · ${formatarNumero(dados.porEtapa.nao_fechou)} não`}
      />
      <StatTile
        rotulo="Principal motivo de perda"
        icone="alerta"
        valor={maiorMotivo ? ROTULO_MOTIVO_PERDA[maiorMotivo.motivo as MotivoPerda] : "—"}
        referencia={
          maiorMotivo
            ? `${formatarNumero(maiorMotivo.total)} de ${formatarNumero(dados.porEtapa.nao_fechou)} que não fecharam`
            : "nenhum cliente perdido ainda"
        }
      />
    </div>
  );
}

interface ColunaProps {
  etapa: EtapaFunil;
  cards: CardCliente[];
  arrastando: boolean;
  onArraste: (arrastando: boolean) => void;
  onSoltar: (chave: string, etapa: EtapaFunil) => void;
  onMover: (card: CardCliente, etapa: EtapaFunil) => void;
  onDevolver: (card: CardCliente) => void;
}

function Coluna({ etapa, cards, arrastando, onArraste, onSoltar, onMover, onDevolver }: ColunaProps) {
  const [recebendo, setRecebendo] = useState(false);

  function aoArrastarSobre(evento: DragEvent<HTMLElement>) {
    if (!evento.dataTransfer.types.includes(TIPO_ARRASTE)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    setRecebendo(true);
  }

  return (
    <section
      aria-label={ROTULO_ETAPA_FUNIL[etapa]}
      onDragOver={aoArrastarSobre}
      onDragLeave={(evento) => {
        // dragleave também dispara ao passar por cima dos filhos; só desliga ao sair da coluna de fato.
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setRecebendo(false);
      }}
      onDrop={(evento) => {
        evento.preventDefault();
        setRecebendo(false);
        onArraste(false);
        const chave = evento.dataTransfer.getData(TIPO_ARRASTE);
        if (chave) onSoltar(chave, etapa);
      }}
      className={`flex max-h-[calc(100vh-14rem)] min-h-56 w-[18.5rem] shrink-0 snap-start flex-col rounded-2xl p-2.5 transition-colors ${
        recebendo ? "bg-accent-soft ring-2 ring-accent/40" : "bg-slate-200/50"
      }`}
    >
      <header className="flex flex-col gap-0.5 px-2 pb-3 pt-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${COR_ETAPA[etapa]}`} />
            {ROTULO_ETAPA_FUNIL[etapa]}
          </h3>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2 shadow-card">
            {formatarNumero(cards.length)}
          </span>
        </div>
        <p className="text-xs text-ink-3">{DESCRICAO_ETAPA_FUNIL[etapa]}</p>
      </header>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-0.5 pb-0.5">
        {cards.length === 0 ? (
          <p
            className={`flex min-h-24 flex-1 items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-xs font-medium ${
              recebendo ? "border-accent/50 text-accent-text" : "border-slate-300/80 text-ink-3"
            }`}
          >
            {recebendo ? "Solte aqui" : arrastando ? "Solte aqui" : "Nenhum cliente"}
          </p>
        ) : (
          cards.map((card) => <CartaoCliente key={chaveDe(card)} card={card} onArraste={onArraste} onMover={onMover} onDevolver={onDevolver} />)
        )}
      </div>
    </section>
  );
}

function CartaoCliente({
  card,
  onArraste,
  onMover,
  onDevolver,
}: {
  card: CardCliente;
  onArraste: (arrastando: boolean) => void;
  onMover: (card: CardCliente, etapa: EtapaFunil) => void;
  onDevolver: (card: CardCliente) => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const telefone = formatarTelefone(card.telefone);

  return (
    <div
      draggable
      onDragStart={(evento) => {
        evento.dataTransfer.setData(TIPO_ARRASTE, chaveDe(card));
        evento.dataTransfer.effectAllowed = "move";
        setArrastando(true);
        // Adiado: mexer no layout dentro do dragstart pode fazer o navegador cancelar o arraste.
        window.setTimeout(() => onArraste(true), 0);
      }}
      onDragEnd={() => {
        setArrastando(false);
        onArraste(false);
      }}
      className={`group flex shrink-0 cursor-grab flex-col gap-2.5 rounded-xl border border-card-border bg-surface p-3.5 transition-colors hover:border-baseline active:cursor-grabbing ${
        arrastando ? "rotate-1 opacity-40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <a
          href={hrefDe({ tela: "conversas", telefone: card.telefone, numeroId: card.numeroId })}
          draggable={false}
          className="min-w-0 hover:underline"
          title="Abrir a conversa"
        >
          <span className="block truncate font-heading text-sm font-semibold text-ink">{card.nome ?? telefone}</span>
          {card.nome && <span className="block text-xs text-ink-3">{telefone}</span>}
        </a>
        <span className="flex shrink-0 items-center gap-1">
          {card.naoLidas > 0 && (
            <span
              aria-label={`${card.naoLidas} mensagem(ns) não lida(s)`}
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-2 px-1 text-[10px] font-bold text-brand-2-contrast"
            >
              {card.naoLidas}
            </span>
          )}
          <Icone nome="arrastar" tamanho={14} className="text-baseline transition-colors group-hover:text-ink-3" />
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {card.precisaHumano && <Selo classe="bg-amber-50 text-amber-900">Precisa de humano</Selo>}
        {card.etapa === "nao_fechou" && card.motivoPerda && (
          <Selo classe="bg-red-50 text-red-700">{ROTULO_MOTIVO_PERDA[card.motivoPerda as MotivoPerda]}</Selo>
        )}
        {card.etapaOrigem === "manual" ? (
          <Selo classe="bg-slate-100 text-ink-2">Movido à mão</Selo>
        ) : card.analisadoEm ? (
          <Selo classe="bg-accent-soft text-accent-text">IA · {tempoRelativo(card.analisadoEm)}</Selo>
        ) : null}
      </div>

      {card.resumo ? (
        <p className="text-xs leading-relaxed text-ink">{card.resumo}</p>
      ) : (
        <p className="line-clamp-2 border-l-2 border-card-border pl-2 text-xs italic text-ink-2">“{card.ultimaMensagem}”</p>
      )}
      {card.etapa === "nao_fechou" && card.motivoDetalhe && <p className="text-xs text-ink-2">{card.motivoDetalhe}</p>}
      {card.proximoPasso && card.etapa !== "fechou" && (
        <p className="rounded-lg bg-app-bg px-2.5 py-1.5 text-xs text-ink-2">
          <strong className="font-semibold text-ink">Próximo passo:</strong> {card.proximoPasso}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-card-border pt-2 text-[11px] text-ink-3">
        <span>{card.ultimaEm ? `Última msg. ${tempoRelativo(card.ultimaEm)}` : ""}</span>
        <span className="flex items-center gap-2">
          {card.etapaOrigem === "manual" && (
            <button type="button" onClick={() => onDevolver(card)} className="font-medium text-accent-text hover:underline">
              Devolver à IA
            </button>
          )}
          <label className="flex items-center gap-1">
            <span className="sr-only">Mover para</span>
            <select
              value=""
              onChange={(evento) => {
                if (evento.target.value) onMover(card, evento.target.value as EtapaFunil);
              }}
              className="rounded-md px-1 py-0.5 text-[11px] text-ink-2"
            >
              <option value="">Mover para…</option>
              {ETAPAS_FUNIL.filter((etapa) => etapa !== card.etapa).map((etapa) => (
                <option key={etapa} value={etapa}>
                  {ROTULO_ETAPA_FUNIL[etapa]}
                </option>
              ))}
            </select>
          </label>
        </span>
      </div>
    </div>
  );
}

function Selo({ classe, children }: { classe: string; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${classe}`}>{children}</span>;
}

function DialogoMotivo({
  card,
  onCancelar,
  onConfirmar,
}: {
  card: CardCliente;
  onCancelar: () => void;
  onConfirmar: (motivo: MotivoPerda, detalhe: string | undefined) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPerda>((card.motivoPerda as MotivoPerda | null) ?? "preco");
  const [detalhe, setDetalhe] = useState(card.motivoDetalhe ?? "");

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-motivo" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancelar" onClick={onCancelar} className="absolute inset-0 cursor-default bg-black/40" />
      <Card className="relative flex w-full max-w-md flex-col gap-4 shadow-pop">
        <div>
          <h3 id="titulo-motivo" className="font-heading text-base font-bold">
            Por que {card.nome ?? formatarTelefone(card.telefone)} não fechou?
          </h3>
          <p className="text-sm text-ink-2">O motivo entra no resumo do funil e ajuda a ver onde o script perde clientes.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {MOTIVOS_PERDA.map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={motivo === opcao}
              onClick={() => setMotivo(opcao)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                motivo === opcao ? "border-accent bg-accent-soft/60 font-semibold text-ink ring-2 ring-accent/20" : "border-card-border text-ink-2 hover:border-baseline"
              }`}
            >
              {ROTULO_MOTIVO_PERDA[opcao]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Detalhe (opcional)
          <input
            value={detalhe}
            onChange={(evento) => setDetalhe(evento.target.value)}
            maxLength={500}
            placeholder="ex.: achou caro comparado à academia do bairro"
            className="rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirmar(motivo, detalhe.trim() || undefined)}>Mover para Não fechou</Button>
        </div>
      </Card>
    </div>
  );
}
