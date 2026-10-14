import { CORES_ETIQUETA, type CorEtiqueta } from "@atendimento-academias/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Icone } from "./ui/Icone.js";
import { toast } from "./ui/Toast.js";

export type Etiqueta = SaidaApi["contatos"]["etiquetas"][number];

export const ROTULO_COR: Record<CorEtiqueta, string> = {
  roxo: "Roxo",
  laranja: "Laranja",
  verde: "Verde",
  azul: "Azul",
  rosa: "Rosa",
  cinza: "Cinza",
};

function corValida(cor: string): CorEtiqueta {
  return (CORES_ETIQUETA as readonly string[]).includes(cor) ? (cor as CorEtiqueta) : "roxo";
}

export function estiloDaCor(cor: string) {
  const c = corValida(cor);
  return { background: `var(--etq-${c}-bg)`, color: `var(--etq-${c}-fg)` };
}

export function useEtiquetas() {
  return trpc.contatos.etiquetas.useQuery(undefined, { staleTime: 30_000 });
}

export function ChipEtiqueta({ etiqueta, children }: { etiqueta: Pick<Etiqueta, "nome" | "cor">; children?: ReactNode }) {
  return (
    <span style={estiloDaCor(etiqueta.cor)} className="inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2.5 text-xs font-semibold">
      <span className="truncate">{etiqueta.nome}</span>
      {children}
    </span>
  );
}

// Fecha um menu flutuante ao clicar fora dele ou apertar Esc.
export function useFecharFora(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (evento: MouseEvent) => {
      if (ref.current && !ref.current.contains(evento.target as Node)) fechar();
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") fechar();
    };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, fechar]);
  return ref;
}

// Lista de etiquetas para marcar/desmarcar, com "criar etiqueta" no fim (opcional).
export function ListaDeEtiquetas({
  marcadas,
  onAlternar,
  permitirCriar = true,
}: {
  marcadas: number[];
  onAlternar: (id: number, marcada: boolean) => void;
  permitirCriar?: boolean;
}) {
  const utils = trpc.useUtils();
  const etiquetas = useEtiquetas().data ?? [];
  const [nova, setNova] = useState("");
  const criar = trpc.contatos.salvarEtiqueta.useMutation({
    onSuccess: (criada) => {
      setNova("");
      void utils.contatos.etiquetas.invalidate();
      onAlternar(criada.id, true);
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  return (
    <div className="flex flex-col gap-1">
      {etiquetas.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-3">Nenhuma etiqueta ainda.</p>}
      <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
        {etiquetas.map((etiqueta) => {
          const marcada = marcadas.includes(etiqueta.id);
          return (
            <label key={etiqueta.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" checked={marcada} onChange={() => onAlternar(etiqueta.id, !marcada)} className="h-4 w-4 accent-[var(--color-accent)]" />
              <ChipEtiqueta etiqueta={etiqueta} />
            </label>
          );
        })}
      </div>
      {permitirCriar && (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            if (nova.trim()) criar.mutate({ nome: nova.trim(), cor: CORES_ETIQUETA[etiquetas.length % CORES_ETIQUETA.length]! });
          }}
          className="mt-1 flex gap-1.5 border-t border-card-border pt-2"
        >
          <input
            value={nova}
            onChange={(evento) => setNova(evento.target.value)}
            maxLength={40}
            placeholder="Nova etiqueta"
            aria-label="Nome da nova etiqueta"
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!nova.trim() || criar.isPending}
            aria-label="Criar etiqueta"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-contrast disabled:opacity-40"
          >
            <Icone nome="mais" tamanho={15} />
          </button>
        </form>
      )}
    </div>
  );
}

// Botão que abre a lista de etiquetas num menu flutuante.
export function MenuEtiquetas({
  rotulo,
  conteudo,
  className = "",
  alinharDireita = false,
}: {
  rotulo: ReactNode;
  conteudo: (fechar: () => void) => ReactNode;
  className?: string;
  alinharDireita?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const fechar = () => setAberto(false);
  const ref = useFecharFora(aberto, fechar);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={aberto} onClick={() => setAberto((a) => !a)} className={className}>
        {rotulo}
      </button>
      {aberto && (
        <div className={`absolute top-full z-40 mt-1.5 w-64 rounded-2xl bg-surface p-2 shadow-pop ring-1 ring-card-border ${alinharDireita ? "right-0" : "left-0"}`}>
          {conteudo(fechar)}
        </div>
      )}
    </div>
  );
}

// Cabeçalho da conversa: etiquetas do cliente, com um "+" para marcar/desmarcar.
export function EtiquetasDaConversa({ telefone, numeroId }: { telefone: string; numeroId: number }) {
  const utils = trpc.useUtils();
  const todas = useEtiquetas().data ?? [];
  const doTelefone = trpc.contatos.doTelefone.useQuery({ telefone, numeroId }, { staleTime: 30_000 });
  const definir = trpc.contatos.etiquetasDoTelefone.useMutation({
    onSuccess: () => {
      void utils.contatos.doTelefone.invalidate({ telefone, numeroId });
      void utils.contatos.etiquetas.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const marcadas = doTelefone.data?.etiquetaIds ?? [];
  const visiveis = todas.filter((e) => marcadas.includes(e.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visiveis.map((e) => (
        <ChipEtiqueta key={e.id} etiqueta={e} />
      ))}
      <MenuEtiquetas
        rotulo={
          <>
            <Icone nome="etiqueta" tamanho={13} />
            {visiveis.length === 0 && "Etiqueta"}
          </>
        }
        className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-card-border px-2 text-xs font-medium text-ink-2 hover:border-accent hover:text-accent-text"
        conteudo={() => (
          <ListaDeEtiquetas
            marcadas={marcadas}
            onAlternar={(id, marcada) =>
              definir.mutate({ telefone, numeroId, etiquetaIds: marcada ? [...marcadas, id] : marcadas.filter((m) => m !== id) })
            }
          />
        )}
      />
    </div>
  );
}
