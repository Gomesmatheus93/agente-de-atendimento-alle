import { JANELA_RESPOSTA_MS, TAMANHO_MAX_ASSINATURA, TAMANHO_MAX_RESPOSTA } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import {
  formatarDuracao,
  formatarHora,
  formatarHoraOuData,
  formatarNumero,
  formatarQuando,
  formatarTelefone,
  rotuloDoDia,
} from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type ConversaResumo = SaidaApi["conversas"]["listar"][number];
type Conversa = SaidaApi["conversas"]["detalhe"];
type Mensagem = Conversa["mensagens"][number];

const INTERVALO_POLLING_MS = 5000;
const INTERVALO_ENVIANDO_MS = 1000;
const ATRASO_BUSCA_MS = 300;
// A conversa só rola sozinha até o fim se quem lê já estava perto dele; senão não tira a pessoa de onde ela está.
const MARGEM_FIM_PX = 160;

function useValorAtrasado<T>(valor: T, atrasoMs: number): T {
  const [atrasado, setAtrasado] = useState(valor);

  useEffect(() => {
    const timer = window.setTimeout(() => setAtrasado(valor), atrasoMs);
    return () => window.clearTimeout(timer);
  }, [valor, atrasoMs]);

  return atrasado;
}

// Faz o componente renderizar de novo de tempos em tempos (para a contagem da janela de 24h andar sozinha).
function useAgora(intervaloMs: number): number {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(timer);
  }, [intervaloMs]);

  return agora;
}

export function Conversas({ telefone, numeroId }: { telefone: string | null; numeroId: number | null }) {
  // Rascunhos por contato: trocar de conversa no meio de uma resposta não apaga o que foi digitado.
  const rascunhos = useRef<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);
  const buscaAtrasada = useValorAtrasado(busca.trim(), ATRASO_BUSCA_MS);

  const listaQuery = trpc.conversas.listar.useQuery(
    { busca: buscaAtrasada || undefined, apenasNaoLidas, limite: 100 },
    { placeholderData: keepPreviousData, refetchInterval: INTERVALO_POLLING_MS },
  );

  const filtrando = buscaAtrasada !== "" || apenasNaoLidas;

  if (listaQuery.isError && !listaQuery.data) {
    return <EstadoErro mensagem={listaQuery.error.message} onTentarNovamente={() => void listaQuery.refetch()} />;
  }

  if (listaQuery.data?.length === 0 && !filtrando) {
    return (
      <EstadoVazio
        titulo="Nenhuma conversa ainda"
        descricao="Quando um cliente responder a um disparo, a conversa aparece aqui. As respostas chegam pelo webhook do WhatsApp (/webhooks/whatsapp na API)."
      />
    );
  }

  return (
    <div className="grid h-[calc(100vh-15rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-card-border bg-surface lg:grid-cols-[23rem_minmax(0,1fr)]">
      <section
        aria-label="Lista de conversas"
        className={`min-h-0 flex-col border-card-border lg:border-r ${telefone ? "hidden lg:flex" : "flex"}`}
      >
        <div className="flex flex-col gap-3 border-b border-card-border p-3">
          <label className="relative block">
            <span className="sr-only">Buscar conversas</span>
            <Icone nome="busca" tamanho={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar por nome, telefone ou mensagem"
              className="w-full py-2 pl-9 pr-3 text-sm"
            />
          </label>

          <div role="group" aria-label="Filtro" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/60 p-0.5">
            {[
              { valor: false, rotulo: "Todas" },
              { valor: true, rotulo: "Não lidas" },
            ].map((opcao) => (
              <button
                key={opcao.rotulo}
                type="button"
                aria-pressed={apenasNaoLidas === opcao.valor}
                onClick={() => setApenasNaoLidas(opcao.valor)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  apenasNaoLidas === opcao.valor ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"
                }`}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </div>

        <ListaDeConversas
          conversas={listaQuery.data}
          carregando={listaQuery.isPending}
          selecionado={telefone}
          filtrando={filtrando}
          atualizando={listaQuery.isPlaceholderData}
        />
      </section>

      <section
        aria-label="Conversa"
        className={`min-h-0 min-w-0 flex-col bg-app-bg ${telefone ? "flex" : "hidden lg:flex"}`}
      >
        {telefone && numeroId ? (
          <ConversaAberta
            key={`${numeroId}-${telefone}`}
            telefone={telefone}
            numeroId={numeroId}
            rascunhoInicial={rascunhos.current[telefone] ?? ""}
            onRascunho={(texto) => {
              rascunhos.current[telefone] = texto;
            }}
          />
        ) : (
          <SemConversaSelecionada />
        )}
      </section>
    </div>
  );
}

function ListaDeConversas({
  conversas,
  carregando,
  selecionado,
  filtrando,
  atualizando,
}: {
  conversas: ConversaResumo[] | undefined;
  carregando: boolean;
  selecionado: string | null;
  filtrando: boolean;
  atualizando: boolean;
}) {
  if (carregando) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 p-3">
        {[0, 1, 2, 3, 4].map((indice) => (
          <Esqueleto key={indice} className="h-16" />
        ))}
      </div>
    );
  }

  if (!conversas || conversas.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-ink-3">
        {filtrando ? "Nenhuma conversa encontrada com esse filtro." : "Nenhuma conversa."}
      </p>
    );
  }

  return (
    <ul className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      {conversas.map((conversa) => (
        <ItemDaLista
          key={`${conversa.numeroId}-${conversa.telefone}`}
          conversa={conversa}
          selecionada={conversa.telefone === selecionado}
        />
      ))}
    </ul>
  );
}

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

function Avatar({ nome, tamanho = "md" }: { nome: string | null; tamanho?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text ${
        tamanho === "lg" ? "h-11 w-11 text-sm" : "h-10 w-10 text-xs"
      }`}
    >
      {nome ? iniciais(nome) : <Icone nome="usuarios" tamanho={tamanho === "lg" ? 20 : 18} />}
    </span>
  );
}

function ItemDaLista({ conversa, selecionada }: { conversa: ConversaResumo; selecionada: boolean }) {
  const naoLida = conversa.naoLidas > 0;

  return (
    <li>
      <a
        href={hrefDe({ tela: "conversas", telefone: conversa.telefone, numeroId: conversa.numeroId })}
        aria-current={selecionada ? "true" : undefined}
        className={`flex gap-3 border-b border-card-border px-4 py-3 transition-colors ${
          selecionada ? "bg-accent-soft" : "hover:bg-slate-50"
        }`}
      >
        <Avatar nome={conversa.nome} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className={`truncate text-sm text-ink ${naoLida ? "font-semibold" : "font-medium"}`}>
                {conversa.nome ?? formatarTelefone(conversa.telefone)}
              </p>
              {conversa.precisaHumano ? (
                <span
                  title="O cliente precisa de uma pessoa da equipe"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-bold uppercase text-amber-900"
                >
                  <Icone nome="usuarios" tamanho={9} />
                  Humano
                </span>
              ) : (
                conversa.iaAtiva && (
                  <span
                    title="IA de atendimento ligada para este contato"
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-soft px-1 text-[10px] font-bold uppercase text-accent-text"
                  >
                    <Icone nome="ia" tamanho={9} />
                    IA
                  </span>
                )
              )}
            </div>
            <time
              dateTime={conversa.ultimaEm}
              className={`shrink-0 text-[11px] ${naoLida ? "font-semibold text-accent-text" : "text-ink-3"}`}
            >
              {formatarHoraOuData(conversa.ultimaEm)}
            </time>
          </div>
          <p className="truncate text-[11px] text-ink-3">
            {conversa.nome ? formatarTelefone(conversa.telefone) : ""}
            {conversa.nome && conversa.numeroExibicao ? " · " : ""}
            {conversa.numeroExibicao ? `via ${conversa.numeroExibicao}` : ""}
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className={`line-clamp-1 break-words text-xs ${naoLida ? "text-ink" : "text-ink-2"}`}>{conversa.ultimaMensagem}</p>
            {naoLida && (
              <span
                aria-label={`${conversa.naoLidas} não lida${conversa.naoLidas > 1 ? "s" : ""}`}
                className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-2 px-1.5 text-[11px] font-bold text-brand-2-contrast"
              >
                {conversa.naoLidas}
              </span>
            )}
          </div>
        </div>
      </a>
    </li>
  );
}

function SemConversaSelecionada() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Icone nome="mensagem" tamanho={26} />
      </span>
      <h3 className="font-heading text-base font-bold">Selecione uma conversa</h3>
      <p className="max-w-xs text-sm text-ink-2">
        Escolha um contato na lista para ver o disparo que ele recebeu e tudo o que respondeu.
      </p>
    </div>
  );
}

function ConversaAberta({
  telefone,
  numeroId,
  rascunhoInicial,
  onRascunho,
}: {
  telefone: string;
  numeroId: number;
  rascunhoInicial: string;
  onRascunho: (texto: string) => void;
}) {
  const utils = trpc.useUtils();
  const rolagemRef = useRef<HTMLDivElement>(null);
  const rolouAteOFim = useRef(false);
  const forcarRolagem = useRef(false);

  const conversaQuery = trpc.conversas.detalhe.useQuery(
    { telefone, numeroId },
    {
      // Com uma resposta ainda sendo enviada, consulta mais rápido para o "Enviando…" virar "Enviado" na hora.
      refetchInterval: (query) =>
        query.state.data?.mensagens.some((mensagem) => mensagem.status === "pendente")
          ? INTERVALO_ENVIANDO_MS
          : INTERVALO_POLLING_MS,
      retry: (tentativas, erro) => erro.data?.code !== "NOT_FOUND" && tentativas < 2,
    },
  );

  const marcarComoLida = trpc.conversas.marcarComoLida.useMutation({
    onSuccess: () => {
      void utils.conversas.listar.invalidate();
      void utils.conversas.contarNaoLidas.invalidate();
      void utils.conversas.detalhe.invalidate({ telefone, numeroId });
    },
  });

  const reenviar = trpc.conversas.reenviarResposta.useMutation({
    onSuccess: () => void utils.conversas.detalhe.invalidate({ telefone, numeroId }),
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  // Atualiza o botão na hora e desfaz se o servidor recusar.
  const definirIa = trpc.conversas.definirIa.useMutation({
    onMutate: async ({ ativa }) => {
      await utils.conversas.detalhe.cancel({ telefone, numeroId });
      const anterior = utils.conversas.detalhe.getData({ telefone, numeroId });
      utils.conversas.detalhe.setData({ telefone, numeroId }, (atual) => (atual ? { ...atual, iaAtiva: ativa } : atual));
      return { anterior };
    },
    onSuccess: (_resultado, { ativa }) =>
      toast.sucesso(
        ativa
          ? "IA ligada: ela sugere respostas para este contato, e nada sai sem alguém da equipe enviar."
          : "IA desligada por enquanto. Ela será religada quando o cliente enviar outra mensagem.",
      ),
    onError: (erro, _variaveis, contexto) => {
      if (contexto?.anterior) utils.conversas.detalhe.setData({ telefone, numeroId }, contexto.anterior);
      toast.erro(mensagemDeErro(erro));
    },
    onSettled: () => {
      void utils.conversas.detalhe.invalidate({ telefone, numeroId });
      void utils.conversas.listar.invalidate();
    },
  });

  // Levar a sugestão para o campo de resposta; "vez" muda a cada clique para o compositor reagir de novo.
  const [sugestaoParaEditar, setSugestaoParaEditar] = useState<{ id: number; texto: string; vez: number } | null>(null);

  const aoMudarIa = () => {
    void utils.conversas.detalhe.invalidate({ telefone, numeroId });
    void utils.conversas.listar.invalidate();
  };

  const gerarSugestao = trpc.conversas.gerarSugestao.useMutation({
    onSuccess: () => toast.sucesso("A IA está escrevendo uma sugestão. Ela aparece aqui em alguns segundos."),
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const resolverHumano = trpc.conversas.resolverHumano.useMutation({
    onSuccess: () => {
      toast.sucesso("Atendimento encerrado. O bot volta a responder este cliente.");
      aoMudarIa();
      void utils.conversas.pedidosDeHumano.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  // Some da tela ao marcar: como no WhatsApp, "não lida" é para voltar à caixa de entrada depois.
  const marcarNaoLida = trpc.conversas.marcarComoNaoLida.useMutation({
    onSuccess: () => {
      void utils.conversas.listar.invalidate();
      void utils.conversas.contarNaoLidas.invalidate();
      window.location.hash = hrefDe({ tela: "conversas", telefone: null, numeroId: null });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const excluir = trpc.conversas.excluir.useMutation({
    onSuccess: () => {
      toast.sucesso("Conversa excluída. Se o cliente escrever de novo, ela volta começando do zero.");
      void utils.conversas.listar.invalidate();
      void utils.conversas.contarNaoLidas.invalidate();
      void utils.funil.quadro.invalidate();
      window.location.hash = hrefDe({ tela: "conversas", telefone: null, numeroId: null });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
    onSettled: () => setConfirmandoExclusao(false),
  });

  const conversa = conversaQuery.data;
  const naoLidas = conversa?.naoLidas ?? 0;

  // Abrir a conversa (ou receber mensagem nova com ela aberta) conta como ler.
  useEffect(() => {
    if (naoLidas > 0 && !marcarComoLida.isPending) marcarComoLida.mutate({ telefone, numeroId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naoLidas, telefone, numeroId]);

  const totalDeMensagens = conversa?.mensagens.length ?? 0;
  useEffect(() => {
    const area = rolagemRef.current;
    if (!area || totalDeMensagens === 0) return;

    const pertoDoFim = area.scrollHeight - area.scrollTop - area.clientHeight < MARGEM_FIM_PX;
    if (!rolouAteOFim.current || pertoDoFim || forcarRolagem.current) {
      area.scrollTop = area.scrollHeight;
      rolouAteOFim.current = true;
      forcarRolagem.current = false;
    }
  }, [totalDeMensagens]);

  const voltar = (
    <a
      href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
      aria-label="Voltar para a lista de conversas"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-slate-200/60 lg:hidden"
    >
      <span aria-hidden="true">←</span>
    </a>
  );

  if (conversaQuery.isError) {
    const naoEncontrada = conversaQuery.error.data?.code === "NOT_FOUND";
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-card-border bg-surface p-3">{voltar}</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-ink-2">{naoEncontrada ? "Essa conversa não existe mais." : conversaQuery.error.message}</p>
          {!naoEncontrada && (
            <button type="button" onClick={() => void conversaQuery.refetch()} className="text-sm font-semibold text-accent-text hover:underline">
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!conversa) {
    return (
      <div aria-busy="true" className="flex flex-1 flex-col gap-3 p-6">
        <Esqueleto className="h-14" />
        <Esqueleto className="ml-auto h-20 w-2/3" />
        <Esqueleto className="h-12 w-1/2" />
      </div>
    );
  }

  const titulo = conversa.nome ?? formatarTelefone(conversa.telefone);

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-card-border bg-surface px-4 py-3">
        {voltar}
        <Avatar nome={conversa.nome} tamanho="lg" />
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="truncate font-heading text-base font-bold leading-tight">{titulo}</h3>
          <p className="truncate text-xs text-ink-3">
            {conversa.nome ? `${formatarTelefone(conversa.telefone)} · ` : ""}
            {formatarNumero(conversa.totalRecebidas)} {conversa.totalRecebidas === 1 ? "mensagem recebida" : "mensagens recebidas"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IndicadorDaJanela expiraEm={conversa.janela.expiraEm} />
          <button
            type="button"
            onClick={() => marcarNaoLida.mutate({ telefone, numeroId })}
            disabled={marcarNaoLida.isPending}
            aria-label="Marcar como não lida"
            title="Marcar como não lida"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-slate-200/60 hover:text-ink disabled:opacity-50"
          >
            <Icone nome="inbox" tamanho={16} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmandoExclusao(true)}
            aria-label="Excluir conversa"
            title="Excluir conversa"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            <Icone nome="lixeira" tamanho={16} />
          </button>
          <InterruptorDaIa ativa={conversa.iaAtiva} onAlternar={(ativa) => definirIa.mutate({ telefone, numeroId, ativa })} />
        </div>
      </header>

      {confirmandoExclusao && (
        <ConfirmarExclusao
          nome={titulo}
          excluindo={excluir.isPending}
          onCancelar={() => setConfirmandoExclusao(false)}
          onConfirmar={() => excluir.mutate({ telefone, numeroId })}
        />
      )}

      <div ref={rolagemRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <MensagensDaConversa
          mensagens={conversa.mensagens}
          reenviandoId={reenviar.isPending ? (reenviar.variables?.id ?? null) : null}
          onReenviar={(id) => reenviar.mutate({ id })}
        />
      </div>

      {conversa.precisaHumano && (
        <AvisoDeHumano
          motivo={conversa.motivoHumano}
          ocupado={resolverHumano.isPending}
          onResolver={() => resolverHumano.mutate({ telefone, numeroId })}
        />
      )}

      {conversa.janela.aberta && conversa.iaAtiva && !conversa.precisaHumano && (
        <CartaoDaSugestao
          telefone={conversa.telefone}
          numeroId={numeroId}
          sugestao={conversa.sugestao}
          pedindo={gerarSugestao.isPending}
          onPedir={() => gerarSugestao.mutate({ telefone, numeroId })}
          onEditar={(sugestao) => setSugestaoParaEditar({ ...sugestao, vez: Date.now() })}
          onMudou={() => {
            forcarRolagem.current = true;
            aoMudarIa();
          }}
        />
      )}

      <Compositor
        telefone={conversa.telefone}
        numeroId={numeroId}
        expiraEm={conversa.janela.expiraEm}
        sugestaoParaEditar={sugestaoParaEditar}
        rascunhoInicial={rascunhoInicial}
        onRascunho={onRascunho}
        onEnviada={() => {
          forcarRolagem.current = true;
          void utils.conversas.detalhe.invalidate({ telefone, numeroId });
          void utils.conversas.listar.invalidate();
        }}
      />
    </>
  );
}

function MensagensDaConversa({
  mensagens,
  reenviandoId,
  onReenviar,
}: {
  mensagens: Mensagem[];
  reenviandoId: number | null;
  onReenviar: (id: number) => void;
}) {
  let diaAnterior = "";

  return (
    <ol className="mx-auto flex max-w-3xl flex-col gap-2">
      {mensagens.map((mensagem) => {
        const dia = new Date(mensagem.em).toDateString();
        const novoDia = dia !== diaAnterior;
        diaAnterior = dia;

        return (
          <li key={mensagem.id} className="flex flex-col gap-2">
            {novoDia && (
              <p className="my-2 self-center rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] font-semibold text-ink-2">
                {rotuloDoDia(mensagem.em)}
              </p>
            )}
            <Balao mensagem={mensagem} reenviando={mensagem.respostaId !== null && mensagem.respostaId === reenviandoId} onReenviar={onReenviar} />
          </li>
        );
      })}
    </ol>
  );
}

function Balao({
  mensagem,
  reenviando,
  onReenviar,
}: {
  mensagem: Mensagem;
  reenviando: boolean;
  onReenviar: (id: number) => void;
}) {
  const enviada = mensagem.direcao === "enviada";
  const falhou = mensagem.status === "falhou";
  const figurinha = mensagem.tipo === "figurinha";

  return (
    <div className={`flex flex-col gap-1 ${enviada ? "items-end" : "items-start"}`}>
      <div
        className={
          figurinha
            ? "max-w-[60%] sm:max-w-[40%]"
            : `max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ring-1 ring-inset sm:max-w-[75%] ${
                falhou
                  ? "rounded-br-sm bg-red-50 ring-red-200"
                  : enviada
                    ? "rounded-br-sm bg-accent-soft ring-accent/20"
                    : "rounded-bl-sm bg-surface ring-card-border"
              }`
        }
      >
        {enviada && !figurinha && (
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-accent-text">
            <Icone nome={mensagem.origem === "resposta" ? "mensagem" : "enviar"} tamanho={11} />
            {mensagem.origem === "resposta" ? "Você" : "Disparo"}
          </p>
        )}

        {mensagem.tipo === "audio" ? (
          mensagem.midiaUrl ? (
            <audio controls preload="metadata" src={mensagem.midiaUrl} className="h-10 w-60 max-w-full" />
          ) : (
            <p className="text-ink-3">Áudio indisponível</p>
          )
        ) : mensagem.tipo === "imagem" ? (
          <div className="flex flex-col gap-2">
            {mensagem.midiaUrl ? (
              <a href={mensagem.midiaUrl} target="_blank" rel="noreferrer" title="Abrir a imagem">
                <img src={mensagem.midiaUrl} alt="Imagem enviada" className="max-h-72 w-64 max-w-full rounded-lg object-cover" />
              </a>
            ) : (
              <p className="text-sm text-ink-3">Imagem indisponível</p>
            )}
            {mensagem.texto && <p className="whitespace-pre-wrap break-words text-ink">{comNegrito(mensagem.texto)}</p>}
          </div>
        ) : figurinha ? (
          mensagem.midiaUrl ? (
            <img src={mensagem.midiaUrl} alt="Figurinha enviada pelo cliente" className="h-32 w-32 object-contain" />
          ) : (
            <p className="text-sm text-ink-3">Figurinha indisponível</p>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words text-ink">{comNegrito(mensagem.texto)}</p>
        )}
      </div>

      <p className="flex flex-wrap items-center justify-end gap-x-1.5 px-1 text-[11px] text-ink-3">
        <time dateTime={mensagem.em}>{formatarHora(mensagem.em)}</time>
        {mensagem.status === "pendente" && (
          <span className="inline-flex items-center gap-1">
            <Icone nome="relogio" tamanho={11} />
            Enviando…
          </span>
        )}
        {mensagem.status === "enviado" && (
          <span className="inline-flex items-center gap-1 text-accent-text">
            <Icone nome="check" tamanho={11} />
            Enviado
          </span>
        )}
        {mensagem.campanhaId !== null && mensagem.campanhaNome && (
          <>
            <span aria-hidden="true">·</span>
            <a href={hrefDe({ tela: "campanhas", campanhaId: mensagem.campanhaId })} className="hover:text-accent-text hover:underline">
              {enviada ? "" : "Em resposta a "}
              {mensagem.campanhaNome}
            </a>
          </>
        )}
      </p>

      {falhou && mensagem.respostaId !== null && (
        <p role="alert" className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 px-1 text-[11px] text-red-700">
          <span>Não foi possível enviar{mensagem.erro ? `: ${mensagem.erro}` : "."}</span>
          <button
            type="button"
            disabled={reenviando}
            onClick={() => onReenviar(mensagem.respostaId!)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-red-700 underline-offset-2 hover:underline disabled:opacity-50"
          >
            <Icone nome="desfazer" tamanho={11} />
            {reenviando ? "Reenviando…" : "Tentar novamente"}
          </button>
        </p>
      )}
    </div>
  );
}

// Ordem de preferência: opus em ogg é o que a Cloud API entende melhor como nota de voz; webm é o que
// mais navegador grava; mp4/aac fica de reserva para o que não suportar nenhum dos dois.
const CANDIDATOS_MIME_AUDIO = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function mimeTypeDeGravacaoSuportado(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATOS_MIME_AUDIO.find((tipo) => MediaRecorder.isTypeSupported(tipo));
}

function formatarCronometro(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(segundos % 60).padStart(2, "0")}`;
}

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      // O resultado vem como "data:audio/webm;base64,AAAA…"; só a parte depois da vírgula interessa.
      const resultado = leitor.result as string;
      resolve(resultado.slice(resultado.indexOf(",") + 1));
    };
    leitor.onerror = () => reject(leitor.error as Error);
    leitor.readAsDataURL(blob);
  });
}

// O WhatsApp mostra *texto* em negrito (é assim que vai a assinatura do atendente); aqui fica igual.
function comNegrito(texto: string): ReactNode[] {
  return texto.split(/(\*[^*\n]+\*)/g).map((parte, indice) =>
    /^\*[^*\n]+\*$/.test(parte) ? <strong key={indice}>{parte.slice(1, -1)}</strong> : parte,
  );
}

// Nome do funcionário nas respostas: escolhido uma vez (fica salvo no usuário) e trocável a qualquer momento.
// Sem ele o envio fica travado — toda resposta pelo painel sai assinada.
function useAssinatura() {
  return trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario?.assinatura ?? null;
}

function Assinatura({ assinatura }: { assinatura: string | null }) {
  const utils = trpc.useUtils();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(assinatura ?? "");
  const salvar = trpc.auth.definirAssinatura.useMutation({
    onSuccess: () => {
      setEditando(false);
      void utils.auth.estado.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  if (assinatura && !editando) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
        <span>
          Assinando como <strong className="text-ink">*{assinatura}*</strong>
        </span>
        <button
          type="button"
          onClick={() => {
            setNome(assinatura);
            setEditando(true);
          }}
          className="font-semibold text-accent-text hover:underline"
        >
          Trocar nome
        </button>
      </p>
    );
  }

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        if (nome.trim()) salvar.mutate({ assinatura: nome });
      }}
      className="flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2.5"
    >
      <label htmlFor="assinatura-atendente" className="text-xs font-semibold text-ink">
        Seu nome no atendimento
        <span className="block font-normal text-ink-2">
          Vai em negrito no topo de cada mensagem que você enviar, para o cliente saber com quem está falando.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="assinatura-atendente"
          value={nome}
          onChange={(evento) => setNome(evento.target.value.replace(/[*_~\n\r]/g, ""))}
          maxLength={TAMANHO_MAX_ASSINATURA}
          placeholder="Ex.: Ana"
          autoFocus={!assinatura}
          className="min-w-40 flex-1 rounded-lg px-3 py-1.5 text-sm"
        />
        <Button type="submit" disabled={!nome.trim() || salvar.isPending} className="h-8 shrink-0 px-3 text-xs">
          {salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
        {assinatura && (
          <Button type="button" variante="fantasma" onClick={() => setEditando(false)} className="h-8 shrink-0 px-3 text-xs">
            Cancelar
          </Button>
        )}
      </div>
      {nome.trim() && (
        <p className="text-[11px] text-ink-3">
          O cliente vê: <strong className="text-ink-2">{nome.trim()}</strong> e, na linha de baixo, a sua mensagem.
        </p>
      )}
    </form>
  );
}

interface CompositorProps {
  telefone: string;
  numeroId: number;
  expiraEm: string | null;
  sugestaoParaEditar: { id: number; texto: string; vez: number } | null;
  rascunhoInicial: string;
  onRascunho: (texto: string) => void;
  onEnviada: () => void;
}

function Compositor({ telefone, numeroId, expiraEm, sugestaoParaEditar, rascunhoInicial, onRascunho, onEnviada }: CompositorProps) {
  const [texto, setTexto] = useState(rascunhoInicial);
  // De qual sugestão da IA saiu o texto do campo, para ela ser marcada como usada ao enviar.
  const [sugestaoId, setSugestaoId] = useState<number | null>(null);
  const agora = useAgora(30_000);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  const [gravando, setGravando] = useState(false);
  const [segundosGravando, setSegundosGravando] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cronometroRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sugestaoParaEditar) return;
    setTexto(sugestaoParaEditar.texto);
    setSugestaoId(sugestaoParaEditar.id);
    onRascunho(sugestaoParaEditar.texto);
    campoRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestaoParaEditar?.vez]);

  const enviar = trpc.conversas.enviarResposta.useMutation({
    onSuccess: () => {
      setTexto("");
      setSugestaoId(null);
      onRascunho("");
      onEnviada();
    },
    // Em erro o texto fica no campo: quem escreveu não perde a mensagem.
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const enviarAudio = trpc.conversas.enviarAudio.useMutation({
    onSuccess: onEnviada,
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function pararStream() {
    streamRef.current?.getTracks().forEach((faixa) => faixa.stop());
    streamRef.current = null;
    if (cronometroRef.current !== null) {
      window.clearInterval(cronometroRef.current);
      cronometroRef.current = null;
    }
  }

  // Some ao desmontar com uma gravação esquecida aberta (trocou de conversa no meio da gravação).
  useEffect(() => pararStream, []);

  async function iniciarGravacao() {
    const mimeType = mimeTypeDeGravacaoSuportado();
    if (!mimeType) {
      toast.erro("Este navegador não permite gravar áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const gravador = new MediaRecorder(stream, { mimeType });
      pedacosRef.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) pedacosRef.current.push(evento.data);
      };
      gravador.onstop = () => {
        const blob = new Blob(pedacosRef.current, { type: mimeType });
        pararStream();
        if (blob.size > 0) void enviarGravacao(blob, mimeType);
      };

      gravadorRef.current = gravador;
      gravador.start();
      setSegundosGravando(0);
      setGravando(true);
      cronometroRef.current = window.setInterval(() => setSegundosGravando((atual) => atual + 1), 1000);
    } catch {
      toast.erro("Não foi possível acessar o microfone. Verifique a permissão do navegador para este site.");
    }
  }

  function pararEEnviar() {
    gravadorRef.current?.stop();
    setGravando(false);
  }

  function cancelarGravacao() {
    if (gravadorRef.current) {
      gravadorRef.current.onstop = pararStream;
      gravadorRef.current.stop();
    }
    setGravando(false);
  }

  async function enviarGravacao(blob: Blob, mimeType: string) {
    try {
      const audioBase64 = await blobParaBase64(blob);
      enviarAudio.mutate({ telefone, numeroId, audioBase64, mimeType });
    } catch {
      toast.erro("Não foi possível preparar o áudio para envio.");
    }
  }

  const assinatura = useAssinatura();
  const restante = expiraEm ? new Date(expiraEm).getTime() - agora : 0;

  if (restante <= 0) {
    return (
      <footer className="border-t border-card-border bg-surface p-3 sm:p-4">
        <p role="note" className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{expiraEm ? "A janela de 24h se encerrou." : "Este contato ainda não escreveu."}</strong> O WhatsApp só permite texto
          livre até 24h depois da última mensagem do cliente. Para falar com ele agora, envie um template em{" "}
          <a href="#/nova-campanha" className="font-semibold underline underline-offset-2">
            Nova campanha
          </a>
          .
        </p>
      </footer>
    );
  }

  // A assinatura ("*Nome*" + quebra de linha) ocupa parte do limite de caracteres do WhatsApp.
  const maximo = TAMANHO_MAX_RESPOSTA - (assinatura ? assinatura.length + 3 : 0);
  const podeEnviar = Boolean(assinatura) && texto.trim() !== "" && texto.length <= maximo && !enviar.isPending;

  function enviarAgora() {
    if (podeEnviar) enviar.mutate({ telefone, numeroId, texto, sugestaoId: sugestaoId ?? undefined });
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha. Ignora o Enter usado para confirmar acentuação (IME).
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      enviarAgora();
    }
  }

  const perto = texto.length > maximo * 0.9;

  return (
    <footer className="border-t border-card-border bg-surface p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <Assinatura key={assinatura ?? ""} assinatura={assinatura} />
        {gravando ? (
          <div className="flex h-10 items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-status-falhou" />
            <span className="flex-1 text-sm font-medium tabular-nums text-red-800">
              Gravando… {formatarCronometro(segundosGravando)}
            </span>
            <button
              type="button"
              onClick={cancelarGravacao}
              aria-label="Cancelar gravação"
              title="Cancelar"
              className="rounded-md p-1.5 text-red-700 hover:bg-red-100"
            >
              <Icone nome="lixeira" tamanho={15} />
            </button>
            <Button onClick={pararEEnviar} className="h-8 shrink-0 px-3 text-xs">
              <Icone nome="enviar" tamanho={13} />
              Enviar
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={campoRef}
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value);
                onRascunho(evento.target.value);
                // Apagou tudo: o que vier a seguir já não é a sugestão.
                if (evento.target.value.trim() === "") setSugestaoId(null);
              }}
              onKeyDown={aoTeclar}
              rows={Math.min(6, Math.max(1, texto.split("\n").length))}
              maxLength={maximo}
              disabled={!assinatura}
              aria-label="Escreva uma resposta"
              placeholder={assinatura ? "Escreva uma resposta…" : "Coloque seu nome acima para responder"}
              className="min-h-10 flex-1 resize-none px-3 py-2 text-sm"
            />
            {texto.trim() === "" && (
              <button
                type="button"
                onClick={() => void iniciarGravacao()}
                disabled={enviarAudio.isPending}
                aria-label="Gravar áudio"
                title="Gravar áudio"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-card-border text-ink-2 transition-colors hover:border-baseline hover:text-ink disabled:opacity-50"
              >
                <Icone nome="microfone" tamanho={16} />
              </button>
            )}
            <Button onClick={enviarAgora} disabled={!podeEnviar} className="h-10 shrink-0">
              <Icone nome="enviar" tamanho={15} />
              {enviar.isPending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        )}

        {!gravando && (
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span>
              Enter envia · Shift+Enter quebra a linha
              {enviarAudio.isPending && " · Enviando áudio…"}
            </span>
            <span className={perto ? "font-semibold text-amber-800" : ""}>
              {perto
                ? `${formatarNumero(texto.length)}/${formatarNumero(maximo)} caracteres`
                : `Você pode responder por mais ${formatarDuracao(restante)}`}
            </span>
          </p>
        )}
      </div>
    </footer>
  );
}

// O cliente pediu uma pessoa ou o bot não soube responder: o bot fica parado até alguém encerrar.
function AvisoDeHumano({ motivo, ocupado, onResolver }: { motivo: string | null; ocupado: boolean; onResolver: () => void }) {
  return (
    <div role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-start gap-2 text-sm text-amber-900">
          <Icone nome="usuarios" tamanho={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Este cliente precisa de uma pessoa da equipe.</strong>
            <span className="block text-xs">
              {motivo ? `${motivo} · ` : ""}O bot não responde até o atendimento ser encerrado.
            </span>
          </span>
        </p>
        <Button variante="secundario" onClick={onResolver} disabled={ocupado} className="px-3 py-1.5 text-xs">
          {ocupado ? "Salvando…" : "Encerrar atendimento"}
        </Button>
      </div>
    </div>
  );
}

interface CartaoDaSugestaoProps {
  telefone: string;
  numeroId: number;
  sugestao: { id: number; texto: string; em: string } | null;
  pedindo: boolean;
  onPedir: () => void;
  onEditar: (sugestao: { id: number; texto: string }) => void;
  onMudou: () => void;
}

function CartaoDaSugestao({ telefone, numeroId, sugestao, pedindo, onPedir, onEditar, onMudou }: CartaoDaSugestaoProps) {
  const assinatura = useAssinatura();
  const enviar = trpc.conversas.enviarResposta.useMutation({
    onSuccess: onMudou,
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const descartar = trpc.conversas.descartarSugestao.useMutation({
    onSuccess: onMudou,
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  if (!sugestao) {
    return (
      <div className="border-t border-card-border bg-app-bg px-4 py-2 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-xs text-ink-2">
          <span className="flex items-center gap-1.5">
            <Icone nome="ia" tamanho={13} />
            A IA sugere uma resposta quando o cliente escreve.
          </span>
          <button type="button" onClick={onPedir} disabled={pedindo} className="font-semibold text-accent-text hover:underline disabled:opacity-50">
            {pedindo ? "Pedindo…" : "Pedir sugestão agora"}
          </button>
        </div>
      </div>
    );
  }

  const ocupado = enviar.isPending || descartar.isPending;

  return (
    <section aria-label="Sugestão da IA" className="border-t border-accent/20 bg-accent-soft/40 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-text">
          <Icone nome="ia" tamanho={12} />
          Sugestão da IA · revise antes de enviar
        </p>
        <p className="whitespace-pre-wrap break-words rounded-xl bg-surface px-3.5 py-2.5 text-sm text-ink ring-1 ring-inset ring-accent/20">
          {sugestao.texto}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variante="fantasma" onClick={() => descartar.mutate({ id: sugestao.id })} disabled={ocupado} className="px-3 py-1.5 text-xs">
            Descartar
          </Button>
          <Button variante="secundario" onClick={() => onEditar(sugestao)} disabled={ocupado} className="px-3 py-1.5 text-xs">
            Editar antes
          </Button>
          <Button
            onClick={() => enviar.mutate({ telefone, numeroId, texto: sugestao.texto, sugestaoId: sugestao.id })}
            disabled={ocupado || !assinatura}
            title={assinatura ? `Sai assinada como ${assinatura}` : "Coloque seu nome no chat para enviar"}
            className="px-3 py-1.5 text-xs"
          >
            <Icone nome="enviar" tamanho={13} />
            {enviar.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function InterruptorDaIa({ ativa, onAlternar }: { ativa: boolean; onAlternar: (ativa: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ativa}
      onClick={() => onAlternar(!ativa)}
      title="A IA é ligada automaticamente quando o cliente envia uma mensagem. Conversas encaminhadas para atendimento humano continuam pausadas."
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        ativa
          ? "border-accent/30 bg-accent-soft text-accent-text"
          : "border-card-border bg-surface text-ink-2 hover:border-baseline hover:text-ink"
      }`}
    >
      <Icone nome="ia" tamanho={14} />
      IA de atendimento
      <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${ativa ? "bg-accent" : "bg-slate-300"}`}>
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${ativa ? "left-[14px]" : "left-0.5"}`}
        />
      </span>
      <span className="sr-only">{ativa ? "ligada" : "desligada"}</span>
    </button>
  );
}

// Abaixo disso a janela é destacada em âmbar: dá tempo de responder, mas pouco.
const LIMIAR_ACABANDO_MS = 2 * 60 * 60 * 1000;

function IndicadorDaJanela({ expiraEm }: { expiraEm: string | null }) {
  const agora = useAgora(30_000);
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);

  // O pop-up fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (evento: PointerEvent) => {
      if (!raizRef.current?.contains(evento.target as Node)) setAberto(false);
    };
    const aoTeclar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };

    document.addEventListener("pointerdown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const restante = expiraEm ? new Date(expiraEm).getTime() - agora : 0;
  const estado = !expiraEm ? "sem" : restante <= 0 ? "fechada" : restante < LIMIAR_ACABANDO_MS ? "acabando" : "aberta";

  const rotulo =
    estado === "sem"
      ? "Sem janela aberta"
      : estado === "fechada"
        ? "Janela de 24h encerrada"
        : `Janela de 24h · ${formatarDuracao(restante)}`;

  const classes = {
    aberta: "border-success/30 bg-success-soft text-success-text",
    acabando: "border-amber-200 bg-amber-50 text-amber-800",
    fechada: "border-red-200 bg-red-50 text-red-700",
    sem: "border-card-border bg-surface text-ink-2",
  }[estado];

  const consumido = expiraEm ? Math.min(1, Math.max(0, 1 - restante / JANELA_RESPOSTA_MS)) : 1;

  return (
    <div ref={raizRef} className="relative">
      <button
        type="button"
        aria-expanded={aberto}
        aria-haspopup="dialog"
        onClick={() => setAberto((atual) => !atual)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors hover:brightness-95 ${classes}`}
      >
        {estado === "acabando" ? (
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-pendente" />
        ) : (
          <Icone nome="relogio" tamanho={13} />
        )}
        {rotulo}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Janela de resposta de 24 horas"
          // No celular o chip quebra para a esquerda da linha; a partir de sm ele fica à direita do cabeçalho.
          className="absolute left-0 top-full z-30 mt-2 w-[min(21rem,calc(100vw-4.5rem))] rounded-xl border border-card-border bg-surface p-4 text-sm shadow-pop sm:left-auto sm:right-0"
        >
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-heading text-sm font-bold">Janela de resposta de 24h</h4>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar"
              className="-mr-1 -mt-1 rounded-md p-1 text-ink-3 hover:bg-slate-200/60 hover:text-ink"
            >
              <Icone nome="x" tamanho={14} />
            </button>
          </div>

          <p className={`mt-2 font-heading text-xl font-extrabold tabular-nums ${estado === "fechada" ? "text-red-700" : estado === "acabando" ? "text-amber-800" : "text-success-text"}`}>
            {estado === "sem"
              ? "Nenhuma mensagem do cliente"
              : estado === "fechada"
                ? `Fechou ${formatarQuando(expiraEm!)}`
                : `Faltam ${formatarDuracao(restante)}`}
          </p>

          {expiraEm && (
            <div
              role="img"
              aria-label={`${Math.round(consumido * 100)}% da janela já passou`}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70"
            >
              <div
                className={`h-full rounded-full ${estado === "fechada" ? "bg-status-falhou" : estado === "acabando" ? "bg-status-pendente" : "bg-success"}`}
                style={{ width: `${consumido * 100}%` }}
              />
            </div>
          )}

          {expiraEm && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-3">Última mensagem do cliente</dt>
              <dd className="text-right font-medium">{formatarQuando(new Date(new Date(expiraEm).getTime() - JANELA_RESPOSTA_MS))}</dd>
              <dt className="text-ink-3">{estado === "fechada" ? "Fechou" : "Fecha"}</dt>
              <dd className="text-right font-medium">{formatarQuando(expiraEm)}</dd>
            </dl>
          )}

          <p className="mt-3 border-t border-card-border pt-3 text-xs text-ink-2">
            {estado === "fechada" || estado === "sem"
              ? "Sem janela aberta, o WhatsApp só permite enviar um template. Use Nova campanha para chamar esse cliente. Se ele responder, a janela abre de novo."
              : "Enquanto a janela estiver aberta, você pode responder com texto livre. Cada nova mensagem do cliente reabre a janela por mais 24h. Depois que fecha, só é possível enviar um template."}
          </p>
        </div>
      )}
    </div>
  );
}

function ConfirmarExclusao({
  nome,
  excluindo,
  onCancelar,
  onConfirmar,
}: {
  nome: string;
  excluindo: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-excluir-conversa" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancelar" onClick={onCancelar} className="absolute inset-0 cursor-default bg-black/40" />
      <div className="relative flex w-full max-w-md flex-col gap-4 rounded-xl border border-card-border bg-surface p-5 shadow-pop">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
            <Icone nome="lixeira" tamanho={18} />
          </span>
          <div>
            <h3 id="titulo-excluir-conversa" className="font-heading text-base font-bold">
              Excluir a conversa com {nome}?
            </h3>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-sm text-ink-2">
              <li>Some de Conversas e do Funil de clientes.</li>
              <li>O bot e a IA passam a ver a conversa vazia, como se fosse o primeiro contato.</li>
              <li>Se o cliente escrever de novo, a conversa volta, começando do zero.</li>
              <li>Campanhas e relatórios não mudam, e nada é apagado do WhatsApp do cliente.</li>
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variante="fantasma" onClick={onCancelar} disabled={excluindo}>
            Cancelar
          </Button>
          <Button variante="perigo" onClick={onConfirmar} disabled={excluindo}>
            {excluindo ? "Excluindo…" : "Excluir conversa"}
          </Button>
        </div>
      </div>
    </div>
  );
}
