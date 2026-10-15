import { ROTULO_PAPEL } from "@atendimento-academias/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { hrefDe } from "../lib/route.js";
import { useTema } from "../lib/tema.js";
import { trpc } from "../lib/trpc.js";
import { useProblemasDeSaude } from "../pages/Saude.js";
import { usePedidosDeHumano } from "./AvisosDeHumano.js";
import { iniciais } from "./Sidebar.js";
import { Icone, type NomeIcone } from "./ui/Icone.js";

// A busca leva para Conversas já filtrada: a tela lê este valor ao abrir (e apaga).
export const CHAVE_BUSCA_CONVERSAS = "busca-conversas";

function BotaoRedondo({ href, icone, rotulo, contador, onClick }: { href?: string; icone: NomeIcone; rotulo: string; contador?: number; onClick?: () => void }) {
  const classe =
    "relative flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition-colors hover:bg-accent-soft hover:text-accent-text";
  const marca =
    contador && contador > 0 ? (
      <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-2 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
        {contador > 99 ? "99+" : contador}
      </span>
    ) : null;
  return href ? (
    <a href={href} aria-label={rotulo} title={rotulo} className={classe}>
      <Icone nome={icone} tamanho={18} />
      {marca}
    </a>
  ) : (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className={classe}>
      <Icone nome={icone} tamanho={18} />
      {marca}
    </button>
  );
}

// Barra do topo (desktop): busca de conversas, atalhos com contadores, tema e quem está logado.
export function BarraSuperior() {
  const utils = trpc.useUtils();
  const { tema, alternar } = useTema();
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const comUnidade = Boolean(usuario?.unidadeId);
  const naoLidas =
    (trpc.conversas.contarNaoLidas.useQuery(undefined, { refetchInterval: 10_000, enabled: comUnidade }).data?.conversas ?? 0) +
    (trpc.dmsInstagram.contarNaoLidas.useQuery(undefined, { refetchInterval: 10_000, enabled: comUnidade }).data?.conversas ?? 0);
  const esperando = usePedidosDeHumano().data?.length ?? 0;
  // Aviso de saúde do sistema: só para o responsável pela plataforma.
  const problemas = useProblemasDeSaude(comUnidade && usuario?.papel === "superadmin");
  const sair = trpc.auth.sair.useMutation({ onSettled: () => void utils.invalidate() });
  const [busca, setBusca] = useState("");
  const campo = useRef<HTMLInputElement>(null);

  // Ctrl/⌘ + K foca a busca de qualquer tela.
  useEffect(() => {
    const atalho = (evento: KeyboardEvent) => {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        campo.current?.focus();
      }
    };
    document.addEventListener("keydown", atalho);
    return () => document.removeEventListener("keydown", atalho);
  }, []);

  function buscar(evento: FormEvent) {
    evento.preventDefault();
    if (!busca.trim()) return;
    try {
      sessionStorage.setItem(CHAVE_BUSCA_CONVERSAS, busca.trim());
    } catch {
      // sem armazenamento: abre Conversas sem o filtro
    }
    setBusca("");
    window.location.hash = hrefDe({ tela: "conversas", telefone: null, numeroId: null });
    window.dispatchEvent(new Event(CHAVE_BUSCA_CONVERSAS));
  }

  if (!usuario) return null;
  const conversas = hrefDe({ tela: "conversas", telefone: null, numeroId: null });

  return (
    <div className="hidden items-center gap-3 rounded-[28px] bg-surface px-4 py-3 shadow-card md:flex">
      {comUnidade ? (
        <form role="search" onSubmit={buscar} className="relative w-full max-w-md">
          <Icone nome="busca" tamanho={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            ref={campo}
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar conversa, cliente ou telefone"
            aria-label="Buscar conversa"
            className="h-11 w-full !rounded-full !border-transparent !bg-surface-2 pl-11 pr-16 text-sm !shadow-none"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-3 shadow-card">
            Ctrl K
          </kbd>
        </form>
      ) : (
        <span />
      )}

      <div className="ml-auto flex items-center gap-2">
        {comUnidade && <BotaoRedondo href={conversas} icone="mensagem" rotulo={`Conversas${naoLidas ? ` (${naoLidas} não lidas)` : ""}`} contador={naoLidas} />}
        {comUnidade && <BotaoRedondo href={conversas} icone="sino" rotulo={`Clientes esperando uma pessoa${esperando ? ` (${esperando})` : ""}`} contador={esperando} />}
        {comUnidade && problemas.total > 0 && (
          <BotaoRedondo
            href={hrefDe({ tela: "saude" })}
            icone="alerta"
            rotulo={`Saúde do sistema: ${problemas.falhas ? `${problemas.falhas} falha(s)` : `${problemas.atencoes} ponto(s) de atenção`}`}
            contador={problemas.total}
          />
        )}
        <BotaoRedondo icone={tema === "claro" ? "lua" : "sol"} rotulo={tema === "claro" ? "Usar tema escuro" : "Usar tema claro"} onClick={alternar} />

        <div className="ml-2 flex items-center gap-3 border-l border-card-border pl-4">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#470e75] to-[#ff6600] text-sm font-bold text-white">
            {iniciais(usuario.nome)}
          </span>
          <span className="hidden min-w-0 lg:block">
            <span className="block max-w-[12rem] truncate text-sm font-semibold text-ink">{usuario.nome}</span>
            <span className="block max-w-[12rem] truncate text-xs text-ink-3">
              {ROTULO_PAPEL[usuario.papel]}
              {usuario.unidadeNome ? ` · ${usuario.unidadeNome}` : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => sair.mutate()}
            disabled={sair.isPending}
            aria-label="Sair"
            title="Sair"
            className="rounded-full p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <Icone nome="sair" tamanho={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
