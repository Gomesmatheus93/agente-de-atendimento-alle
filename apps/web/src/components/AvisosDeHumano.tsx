import { useEffect, useRef, useState } from "react";
import { formatarTelefone, tempoRelativo } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Icone } from "./ui/Icone.js";

type Pedido = SaidaApi["conversas"]["pedidosDeHumano"][number];

// Quem está monitorando precisa perceber na hora que um cliente quer uma pessoa (ou que o bot travou),
// em qualquer tela do painel. Consulta curta e frequente: é uma lista pequena.
export const INTERVALO_PEDIDOS_MS = 10_000;
const CHAVE_DISPENSADOS = "avisos-humano-dispensados";
const MAX_VISIVEIS = 3;

// Um pedido é a conversa + o momento em que passou a precisar de humano: se for resolvido e pedir de
// novo, é outro aviso.
const chaveDe = (pedido: Pedido) => `${pedido.numeroId}:${pedido.telefone}:${pedido.desde}`;
const nomeDe = (pedido: Pedido) => pedido.nome ?? formatarTelefone(pedido.telefone);

export function usePedidosDeHumano() {
  return trpc.conversas.pedidosDeHumano.useQuery(undefined, { refetchInterval: INTERVALO_PEDIDOS_MS });
}

function lerDispensados(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHAVE_DISPENSADOS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

// Dois toques curtos. O navegador pode bloquear som antes do primeiro clique na página; aí só não toca.
function tocarAviso() {
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const audio = new Contexto();
    [0, 0.18].forEach((inicio, indice) => {
      const oscilador = audio.createOscillator();
      const volume = audio.createGain();
      oscilador.frequency.value = indice === 0 ? 880 : 1175;
      volume.gain.setValueAtTime(0.0001, audio.currentTime + inicio);
      volume.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + inicio + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + inicio + 0.16);
      oscilador.connect(volume).connect(audio.destination);
      oscilador.start(audio.currentTime + inicio);
      oscilador.stop(audio.currentTime + inicio + 0.17);
    });
    window.setTimeout(() => void audio.close(), 600);
  } catch {
    // sem áudio: o aviso visual continua
  }
}

export function AvisosDeHumano() {
  const pedidos = usePedidosDeHumano().data ?? [];
  const [dispensados, setDispensados] = useState(lerDispensados);
  const [permissao, setPermissao] = useState(() => ("Notification" in window ? Notification.permission : "denied"));
  // Pedidos já vistos nesta aba: só os novos tocam o som e geram notificação do navegador.
  const conhecidos = useRef<Set<string> | null>(null);

  const visiveis = pedidos.filter((pedido) => !dispensados.has(chaveDe(pedido)));

  useEffect(() => {
    const atuais = new Set(pedidos.map(chaveDe));
    if (conhecidos.current === null) {
      // Primeira carga: o que já estava pendente aparece, mas sem alarde.
      conhecidos.current = atuais;
      return;
    }
    const novos = pedidos.filter((pedido) => !conhecidos.current!.has(chaveDe(pedido)) && !dispensados.has(chaveDe(pedido)));
    conhecidos.current = atuais;
    if (novos.length === 0) return;

    tocarAviso();
    if ("Notification" in window && Notification.permission === "granted") {
      for (const pedido of novos) {
        const notificacao = new Notification(`${nomeDe(pedido)} precisa de ajuda`, {
          body: pedido.motivo ?? "O cliente está esperando uma pessoa da equipe.",
          tag: chaveDe(pedido),
        });
        notificacao.onclick = () => {
          window.focus();
          window.location.hash = hrefDe({ tela: "conversas", telefone: pedido.telefone, numeroId: pedido.numeroId });
        };
      }
    }
  }, [pedidos, dispensados]);

  function dispensar(pedido: Pedido) {
    setDispensados((atual) => {
      // Guarda só os que ainda estão pendentes: a lista não cresce para sempre.
      const pendentes = new Set(pedidos.map(chaveDe));
      const proximo = new Set([...atual].filter((chave) => pendentes.has(chave)));
      proximo.add(chaveDe(pedido));
      try {
        localStorage.setItem(CHAVE_DISPENSADOS, JSON.stringify([...proximo]));
      } catch {
        // sem armazenamento: vale só nesta aba
      }
      return proximo;
    });
  }

  if (visiveis.length === 0) return null;

  return (
    <aside
      aria-label="Clientes precisando de atendimento humano"
      aria-live="polite"
      className="fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {visiveis.slice(0, MAX_VISIVEIS).map((pedido) => (
        <div key={chaveDe(pedido)} role="alert" className="flex gap-3 rounded-xl border border-amber-200 bg-surface p-3.5 shadow-pop">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-900">
            <Icone nome="alerta" tamanho={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {nomeDe(pedido)} <span className="font-normal text-ink-2">precisa de ajuda</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{pedido.motivo ?? "O cliente está esperando uma pessoa da equipe."}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">esperando {tempoRelativo(pedido.desde)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href={hrefDe({ tela: "conversas", telefone: pedido.telefone, numeroId: pedido.numeroId })}
                onClick={() => dispensar(pedido)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
              >
                Abrir conversa
              </a>
              <button type="button" onClick={() => dispensar(pedido)} className="text-xs font-medium text-ink-2 hover:text-ink">
                Dispensar
              </button>
            </div>
          </div>
        </div>
      ))}

      {visiveis.length > MAX_VISIVEIS && (
        <a
          href={hrefDe({ tela: "conversas", telefone: null, numeroId: null })}
          className="self-end rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 shadow-pop"
        >
          + {visiveis.length - MAX_VISIVEIS} esperando atendimento
        </a>
      )}

      {permissao === "default" && (
        <button
          type="button"
          onClick={() => void Notification.requestPermission().then(setPermissao)}
          className="self-end rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-accent-text shadow-pop hover:underline"
        >
          Avisar também com a aba em segundo plano
        </button>
      )}
    </aside>
  );
}
