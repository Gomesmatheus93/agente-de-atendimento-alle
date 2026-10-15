import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { filtrarRespostas, ModalRespostasRapidas, preencherResposta, SugestoesDeResposta, useRespostasRapidas } from "../components/Atendimento.js";
import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarHora, formatarHoraOuData, rotuloDoDia } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Assinatura, AvisoDeHumano, Avatar, IndicadorDaJanela, InterruptorDaIa, useAssinatura } from "./Conversas.js";

type Detalhe = SaidaApi["dmsInstagram"]["detalhe"];
type Mensagem = Detalhe["mensagens"][number];

const INTERVALO_MS = 5000;
const TAMANHO_MAX_DM = 1000;

const ROTULO_ORIGEM: Record<Mensagem["origem"], string> = {
  cliente: "",
  equipe: "Você",
  bot: "Bot",
  app: "Pelo app do Instagram",
};

export function ConversasInstagram({ conversaId, seletor }: { conversaId: number | null; seletor: ReactNode }) {
  const [busca, setBusca] = useState("");
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);
  const lista = trpc.dmsInstagram.listar.useQuery(
    { busca: busca.trim() || undefined, apenasNaoLidas },
    { placeholderData: keepPreviousData, refetchInterval: INTERVALO_MS },
  );

  return (
    <div className="grid h-[calc(100vh-15rem)] min-h-[32rem] overflow-hidden rounded-3xl bg-surface shadow-card lg:grid-cols-[23rem_minmax(0,1fr)]">
      <section aria-label="Lista de DMs" className={`min-h-0 flex-col border-card-border lg:border-r ${conversaId ? "hidden lg:flex" : "flex"}`}>
        <div className="flex flex-col gap-3 border-b border-card-border p-3">
          {seletor}
          <label className="relative block">
            <span className="sr-only">Buscar DMs</span>
            <Icone nome="busca" tamanho={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou @" className="w-full py-2 pl-9 pr-3 text-sm" />
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
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${apenasNaoLidas === opcao.valor ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </div>

        {lista.isError && !lista.data && <p className="p-6 text-center text-sm text-ink-3">{lista.error.message}</p>}
        {lista.isPending && (
          <div aria-busy="true" className="flex flex-col gap-2 p-3">
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-16" />
            ))}
          </div>
        )}
        {lista.data && lista.data.length === 0 && (
          <p className="p-6 text-center text-sm text-ink-3">{busca || apenasNaoLidas ? "Nenhuma DM com esse filtro." : "Nenhuma DM ainda. Quando alguém mandar mensagem para o Instagram da unidade, ela aparece aqui."}</p>
        )}
        {lista.data && lista.data.length > 0 && (
          <ul className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${lista.isPlaceholderData ? "opacity-60" : ""}`}>
            {lista.data.map((c) => {
              const naoLida = c.naoLidas > 0;
              return (
                <li key={c.id}>
                  <a
                    href={hrefDe({ tela: "conversas", telefone: null, numeroId: null, instagramId: c.id })}
                    aria-current={c.id === conversaId ? "true" : undefined}
                    className={`flex gap-3 border-b border-card-border px-4 py-3 transition-colors ${c.id === conversaId ? "bg-accent-soft" : "hover:bg-slate-50"}`}
                  >
                    <Avatar nome={c.nome ?? c.username} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className={`truncate text-sm text-ink ${naoLida ? "font-semibold" : "font-medium"}`}>{c.nome ?? (c.username ? `@${c.username}` : "Pessoa do Instagram")}</p>
                          {c.precisaHumano && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-bold uppercase text-amber-900">
                              <Icone nome="usuarios" tamanho={9} />
                              Humano
                            </span>
                          )}
                        </div>
                        <time dateTime={c.ultimaMensagemEm} className={`shrink-0 text-[11px] ${naoLida ? "font-semibold text-accent-text" : "text-ink-3"}`}>
                          {formatarHoraOuData(c.ultimaMensagemEm)}
                        </time>
                      </div>
                      {c.nome && c.username && <p className="truncate text-[11px] text-ink-3">@{c.username}</p>}
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className={`line-clamp-1 break-words text-xs ${naoLida ? "text-ink" : "text-ink-2"}`}>
                          {c.previaDoCliente === false ? "Você: " : ""}
                          {c.previa}
                        </p>
                        {naoLida && (
                          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-2 px-1.5 text-[11px] font-bold text-brand-2-contrast">{c.naoLidas}</span>
                        )}
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="DM" className={`min-h-0 min-w-0 flex-col bg-app-bg ${conversaId ? "flex" : "hidden lg:flex"}`}>
        {conversaId ? <DmAberta key={conversaId} conversaId={conversaId} /> : <PainelDoInstagram />}
      </section>
    </div>
  );
}

// Sem DM aberta: situação das DMs e do bot (admin configura aqui).
function PainelDoInstagram() {
  const utils = trpc.useUtils();
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const admin = usuario?.papel === "admin" || usuario?.papel === "superadmin";
  const estado = trpc.dmsInstagram.estado.useQuery().data;
  const [url, setUrl] = useState<string | null>(null);
  const ativar = trpc.dmsInstagram.ativar.useMutation({
    onSuccess: () => {
      toast.sucesso("DMs ativadas: as próximas mensagens do Instagram chegam aqui.");
      void utils.dmsInstagram.estado.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const definirBot = trpc.dmsInstagram.definirBot.useMutation({
    onSuccess: (_r, v) => {
      toast.sucesso(v.url ? "Bot das DMs configurado." : "Bot das DMs desligado: as DMs ficam só com a equipe.");
      setUrl(null);
      void utils.dmsInstagram.estado.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  if (!estado) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Icone nome="instagram" tamanho={26} />
      </span>
      <div className="max-w-md text-center">
        <h3 className="font-heading text-base font-bold">DMs de @{estado.username}</h3>
        <p className="mt-1 text-sm text-ink-2">Escolha uma conversa na lista. A resposta só pode ir até 24h depois da última mensagem da pessoa, como no WhatsApp.</p>
      </div>
      {admin && (
        <Card className="flex w-full max-w-md flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Recebimento das DMs</p>
              <p className="text-xs text-ink-2">{estado.dmsAtivas ? "Ativado." : "A conta ainda não foi inscrita para mandar as DMs para cá."}</p>
            </div>
            <Button variante={estado.dmsAtivas ? "fantasma" : "primario"} disabled={ativar.isPending} onClick={() => ativar.mutate()} className="shrink-0">
              {ativar.isPending ? "Ativando…" : estado.dmsAtivas ? "Ativar de novo" : "Ativar DMs"}
            </Button>
          </div>
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              definirBot.mutate({ url: (url ?? estado.n8nUrl ?? "").trim() });
            }}
            className="flex flex-col gap-1.5 border-t border-card-border pt-4"
          >
            <label htmlFor="bot-instagram" className="text-sm font-semibold text-ink">
              Bot nas DMs (n8n) <span className="font-normal text-ink-3">· opcional</span>
            </label>
            <p className="text-xs text-ink-2">URL do webhook do fluxo do n8n que responde as DMs. Em branco, as DMs ficam só com a equipe.</p>
            <div className="flex gap-2">
              <input
                id="bot-instagram"
                value={url ?? estado.n8nUrl ?? ""}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/webhook/instagram"
                className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
              />
              <Button type="submit" variante="secundario" disabled={definirBot.isPending}>
                Salvar
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function DmAberta({ conversaId }: { conversaId: number }) {
  const utils = trpc.useUtils();
  const estado = trpc.dmsInstagram.estado.useQuery().data;
  const detalhe = trpc.dmsInstagram.detalhe.useQuery({ conversaId }, { refetchInterval: INTERVALO_MS });
  const rolagem = useRef<HTMLDivElement>(null);
  const atualizar = () => {
    void utils.dmsInstagram.detalhe.invalidate({ conversaId });
    void utils.dmsInstagram.listar.invalidate();
    void utils.dmsInstagram.contarNaoLidas.invalidate();
  };
  const marcarLida = trpc.dmsInstagram.marcarComoLida.useMutation({ onSuccess: atualizar });
  const definirIa = trpc.dmsInstagram.definirIa.useMutation({ onSuccess: atualizar, onError: (e) => toast.erro(mensagemDeErro(e)) });
  const resolverHumano = trpc.dmsInstagram.resolverHumano.useMutation({
    onSuccess: () => {
      toast.sucesso("Atendimento encerrado. O bot volta a responder esta pessoa.");
      atualizar();
    },
    onError: (e) => toast.erro(mensagemDeErro(e)),
  });
  const reenviar = trpc.dmsInstagram.reenviar.useMutation({ onSuccess: atualizar, onError: (e) => toast.erro(mensagemDeErro(e)) });
  const papel = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario?.papel;
  const apagarDados = trpc.dmsInstagram.apagarDados.useMutation({
    onSuccess: (r) => {
      toast.sucesso(`Dados apagados: ${r.mensagens} mensagem(ns) e ${r.arquivos} arquivo(s).`);
      void utils.dmsInstagram.invalidate();
      window.location.hash = hrefDe({ tela: "conversas", telefone: null, numeroId: null });
    },
    onError: (e) => toast.erro(mensagemDeErro(e)),
  });

  const dados = detalhe.data;
  useEffect(() => {
    if (dados && dados.naoLidas > 0 && !marcarLida.isPending) marcarLida.mutate({ conversaId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados?.naoLidas, conversaId]);
  const total = dados?.mensagens.length ?? 0;
  useEffect(() => {
    if (rolagem.current) rolagem.current.scrollTop = rolagem.current.scrollHeight;
  }, [total]);

  const voltar = (
    <a
      href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
      aria-label="Voltar para a lista"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-slate-200/60 lg:hidden"
    >
      <span aria-hidden="true">←</span>
    </a>
  );

  if (detalhe.isError) return <EstadoErro mensagem={detalhe.error.message} onTentarNovamente={() => void detalhe.refetch()} />;
  if (!dados) {
    return (
      <div aria-busy="true" className="flex flex-1 flex-col gap-3 p-6">
        <Esqueleto className="h-14" />
        <Esqueleto className="ml-auto h-20 w-2/3" />
      </div>
    );
  }

  const titulo = dados.nome ?? (dados.username ? `@${dados.username}` : "Pessoa do Instagram");
  let diaAnterior = "";

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-card-border bg-surface px-4 py-3">
        {voltar}
        <Avatar nome={dados.nome ?? dados.username} tamanho="lg" />
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="truncate font-heading text-base font-bold leading-tight">{titulo}</h3>
          <p className="flex items-center gap-1 truncate text-xs text-ink-3">
            <Icone nome="instagram" tamanho={11} />
            {dados.username ? `@${dados.username} · ` : ""}DM para @{dados.conta}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IndicadorDaJanela expiraEm={dados.janela.expiraEm} />
          {dados.username && (
            <a
              href={`https://instagram.com/${dados.username}`}
              target="_blank"
              rel="noreferrer"
              title="Abrir o perfil no Instagram"
              aria-label="Abrir o perfil no Instagram"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-slate-200/60 hover:text-ink"
            >
              <Icone nome="instagram" tamanho={16} />
            </a>
          )}
          {(papel === "admin" || papel === "superadmin") && (
            <button
              type="button"
              disabled={apagarDados.isPending}
              onClick={() => {
                if (window.confirm("A pessoa pediu a exclusão dos dados (LGPD)? Isto apaga de vez esta conversa, as mensagens e os arquivos. Não dá para desfazer."))
                  apagarDados.mutate({ conversaId });
              }}
              aria-label="Apagar os dados desta pessoa (LGPD)"
              title="Apagar os dados desta pessoa (LGPD)"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-red-50 hover:text-red-700"
            >
              <Icone nome="lixeira" tamanho={16} />
            </button>
          )}
          {estado?.botConfigurado && <InterruptorDaIa ativa={dados.iaAtiva} onAlternar={(ativa) => definirIa.mutate({ conversaId, ativa })} />}
        </div>
      </header>

      <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <ol className="mx-auto flex max-w-3xl flex-col gap-2">
          {dados.mensagens.map((m) => {
            const dia = new Date(m.em).toDateString();
            const novoDia = dia !== diaAnterior;
            diaAnterior = dia;
            const enviada = m.origem !== "cliente";
            const falhou = m.status === "falhou";
            const video = m.midiaUrl && /\.(mp4|3gp|mov|webm)$/i.test(m.midiaUrl);
            const audio = m.midiaUrl && /\.(ogg|opus|mp3|m4a|aac|amr)$/i.test(m.midiaUrl);
            return (
              <li key={m.id} className="flex flex-col gap-2">
                {novoDia && <p className="my-2 self-center rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] font-semibold text-ink-2">{rotuloDoDia(m.em)}</p>}
                <div className={`flex flex-col gap-1 ${enviada ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ring-1 ring-inset sm:max-w-[75%] ${
                      falhou ? "rounded-br-sm bg-red-50 ring-red-200" : enviada ? "rounded-br-sm bg-accent-soft ring-accent/20" : "rounded-bl-sm bg-surface ring-card-border"
                    }`}
                  >
                    {enviada && (
                      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-accent-text">
                        <Icone nome={m.origem === "bot" ? "ia" : m.origem === "app" ? "instagram" : "mensagem"} tamanho={11} />
                        {ROTULO_ORIGEM[m.origem]}
                      </p>
                    )}
                    {m.midiaUrl &&
                      (video ? (
                        <video controls preload="metadata" src={m.midiaUrl} className="mb-1 max-h-72 w-64 max-w-full rounded-lg bg-black" />
                      ) : audio ? (
                        <audio controls preload="metadata" src={m.midiaUrl} className="mb-1 h-10 w-60 max-w-full" />
                      ) : (
                        <a href={m.midiaUrl} target="_blank" rel="noreferrer">
                          <img src={m.midiaUrl} alt="Foto enviada pela pessoa" className="mb-1 max-h-72 w-64 max-w-full rounded-lg object-cover" />
                        </a>
                      ))}
                    {(!m.midiaUrl || !/^\[(foto|vídeo|áudio)\]$/.test(m.texto)) && <p className="whitespace-pre-wrap break-words text-ink">{m.texto}</p>}
                  </div>
                  <p className="flex flex-wrap items-center justify-end gap-x-1.5 px-1 text-[11px] text-ink-3">
                    <time dateTime={m.em}>{formatarHora(m.em)}</time>
                    {m.status === "pendente" && <span>· Enviando…</span>}
                    {falhou && (
                      <>
                        <span className="font-semibold text-red-700" title={m.erro ?? undefined}>
                          · Não enviada{m.erro ? `: ${m.erro}` : ""}
                        </span>
                        <button type="button" disabled={reenviar.isPending} onClick={() => reenviar.mutate({ mensagemId: m.id })} className="font-semibold text-accent-text hover:underline">
                          Tentar de novo
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {dados.precisaHumano && <AvisoDeHumano motivo={dados.motivoHumano} ocupado={resolverHumano.isPending} onResolver={() => resolverHumano.mutate({ conversaId })} />}

      <CompositorDm conversaId={conversaId} expiraEm={dados.janela.expiraEm} nomeCliente={dados.nome} onEnviada={atualizar} />
    </>
  );
}

function CompositorDm({ conversaId, expiraEm, nomeCliente, onEnviada }: { conversaId: number; expiraEm: string | null; nomeCliente: string | null; onEnviada: () => void }) {
  const assinatura = useAssinatura();
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const respostas = useRespostasRapidas().data ?? [];
  const [ativa, setAtiva] = useState(0);
  const [fechadaEm, setFechadaEm] = useState<string | null>(null);
  const [gerenciando, setGerenciando] = useState(false);
  const responder = trpc.dmsInstagram.responder.useMutation({
    onSuccess: () => {
      setTexto("");
      onEnviada();
    },
    onError: (erro) => {
      toast.erro(mensagemDeErro(erro));
      onEnviada();
    },
  });

  const aberta = Boolean(expiraEm && new Date(expiraEm).getTime() > Date.now());
  if (!aberta) {
    return (
      <footer className="border-t border-card-border bg-surface p-3 sm:p-4">
        <p role="note" className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>A janela de 24h se encerrou.</strong> O Instagram só deixa responder até 24h depois da última mensagem da pessoa. Quando ela escrever de novo, a
          resposta volta a ficar liberada.
        </p>
      </footer>
    );
  }

  // O nome de quem responde vai na primeira linha ("Nome:"), como a assinatura do WhatsApp.
  const maximo = TAMANHO_MAX_DM - (assinatura ? assinatura.length + 2 : 0);
  const busca = /^\/(\S*)$/.exec(texto)?.[1] ?? null;
  const listaAberta = busca !== null && fechadaEm !== texto;
  const sugestoes = listaAberta ? filtrarRespostas(respostas, busca) : [];
  const podeEnviar = Boolean(assinatura) && texto.trim() !== "" && texto.length <= maximo && !responder.isPending;

  function escolher(textoResposta: string) {
    setTexto(preencherResposta(textoResposta, nomeCliente).slice(0, maximo));
    setAtiva(0);
    campo.current?.focus();
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (listaAberta) {
      if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        const n = Math.max(1, sugestoes.length);
        setAtiva((a) => (a + (evento.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if ((evento.key === "Enter" || evento.key === "Tab") && sugestoes.length > 0 && !evento.shiftKey) {
        evento.preventDefault();
        escolher(sugestoes[Math.min(ativa, sugestoes.length - 1)]!.texto);
        return;
      }
      if (evento.key === "Escape") {
        evento.preventDefault();
        setFechadaEm(texto);
        return;
      }
    }
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      if (podeEnviar) responder.mutate({ conversaId, texto });
    }
  }

  return (
    <footer className="border-t border-card-border bg-surface p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <Assinatura key={assinatura ?? ""} assinatura={assinatura} />
        {gerenciando && <ModalRespostasRapidas onFechar={() => setGerenciando(false)} />}
        <div className="relative flex items-end gap-2">
          {listaAberta && (
            <SugestoesDeResposta
              respostas={sugestoes}
              ativa={Math.min(ativa, Math.max(0, sugestoes.length - 1))}
              onEscolher={(r) => escolher(r.texto)}
              onGerenciar={() => setGerenciando(true)}
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (respostas.length === 0) return setGerenciando(true);
              setTexto("/");
              setFechadaEm(null);
              campo.current?.focus();
            }}
            disabled={!assinatura}
            aria-label="Respostas rápidas"
            title="Respostas rápidas (ou digite /)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-card-border text-ink-2 transition-colors hover:border-baseline hover:text-ink disabled:opacity-50"
          >
            <Icone nome="raio" tamanho={16} />
          </button>
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAtiva(0);
            }}
            onKeyDown={aoTeclar}
            rows={Math.min(6, Math.max(1, texto.split("\n").length))}
            maxLength={maximo}
            disabled={!assinatura}
            aria-label="Escreva uma resposta"
            placeholder={assinatura ? "Responder no Instagram…" : "Coloque seu nome acima para responder"}
            className="min-h-10 flex-1 resize-none px-3 py-2 text-sm"
          />
          <Button onClick={() => podeEnviar && responder.mutate({ conversaId, texto })} disabled={!podeEnviar} className="h-10 shrink-0">
            <Icone nome="enviar" tamanho={15} />
            {responder.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
        <p className="text-[11px] text-ink-3">Enter envia · Shift+Enter quebra a linha · / respostas rápidas · até {TAMANHO_MAX_DM} caracteres</p>
      </div>
    </footer>
  );
}
