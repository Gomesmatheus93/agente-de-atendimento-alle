import { useState, type FormEvent } from "react";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarHora } from "../lib/format.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Button } from "./ui/Button.js";
import { Icone } from "./ui/Icone.js";
import { toast } from "./ui/Toast.js";

export type Nota = SaidaApi["notas"]["listar"][number];
export type RespostaRapida = SaidaApi["respostasRapidas"]["listar"][number];

export function useRespostasRapidas() {
  return trpc.respostasRapidas.listar.useQuery(undefined, { staleTime: 60_000 });
}

// {nome} vira o primeiro nome do cliente; sem nome, some (e o espaço antes também).
export function preencherResposta(texto: string, nomeCliente: string | null): string {
  const primeiro = nomeCliente?.trim().split(/\s+/)[0] ?? "";
  return primeiro ? texto.replaceAll("{nome}", primeiro) : texto.replace(/ ?\{nome\}/g, "");
}

export function filtrarRespostas(respostas: RespostaRapida[], busca: string): RespostaRapida[] {
  const termo = busca.toLowerCase();
  return respostas
    .filter((r) => r.atalho.startsWith(termo) || (termo.length >= 2 && r.texto.toLowerCase().includes(termo)))
    .sort((a, b) => Number(!a.atalho.startsWith(termo)) - Number(!b.atalho.startsWith(termo)))
    .slice(0, 8);
}

// Nota interna no meio da conversa: amarela, com cadeado, para nunca parecer mensagem do cliente.
export function BalaoNota({ nota, onExcluir, excluindo }: { nota: Nota; onExcluir: () => void; excluindo: boolean }) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl bg-amber-50 px-4 py-2.5 text-sm ring-1 ring-inset ring-amber-200">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
        <Icone nome="cadeado" tamanho={11} />
        Nota interna · {nota.autorNome}
        <span className="font-normal normal-case tracking-normal">· {formatarHora(nota.em)}</span>
        {nota.podeExcluir && (
          <button
            type="button"
            onClick={onExcluir}
            disabled={excluindo}
            aria-label="Apagar nota"
            title="Apagar nota"
            className="ml-auto rounded p-0.5 text-amber-900/70 hover:text-red-700"
          >
            <Icone nome="lixeira" tamanho={12} />
          </button>
        )}
      </p>
      <p className="whitespace-pre-wrap break-words text-amber-900">{nota.texto}</p>
    </div>
  );
}

// Lista que aparece acima do campo ao digitar "/".
export function SugestoesDeResposta({
  respostas,
  ativa,
  onEscolher,
  onGerenciar,
}: {
  respostas: RespostaRapida[];
  ativa: number;
  onEscolher: (resposta: RespostaRapida) => void;
  onGerenciar: () => void;
}) {
  return (
    <div role="listbox" aria-label="Respostas rápidas" className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-card-border">
      {respostas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-2">Nenhuma resposta rápida com esse atalho.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {respostas.map((resposta, indice) => (
            <li key={resposta.id}>
              <button
                type="button"
                role="option"
                aria-selected={indice === ativa}
                // mousedown: escolhe antes de o campo perder o foco.
                onMouseDown={(evento) => {
                  evento.preventDefault();
                  onEscolher(resposta);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left ${indice === ativa ? "bg-accent-soft" : "hover:bg-surface-2"}`}
              >
                <span className="text-xs font-bold text-accent-text">/{resposta.atalho}</span>
                <span className="line-clamp-2 text-sm text-ink-2">{resposta.texto}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onMouseDown={(evento) => {
          evento.preventDefault();
          onGerenciar();
        }}
        className="flex w-full items-center gap-1.5 border-t border-card-border px-4 py-2 text-xs font-semibold text-accent-text hover:bg-surface-2"
      >
        <Icone nome="engrenagem" tamanho={12} />
        Gerenciar respostas rápidas
      </button>
    </div>
  );
}

export function ModalRespostasRapidas({ onFechar }: { onFechar: () => void }) {
  const utils = trpc.useUtils();
  const lista = useRespostasRapidas().data ?? [];
  const [editando, setEditando] = useState<RespostaRapida | "nova" | null>(lista.length === 0 ? "nova" : null);
  const excluir = trpc.respostasRapidas.excluir.useMutation({
    onSuccess: () => void utils.respostasRapidas.invalidate(),
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Respostas rápidas" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-3xl bg-surface p-5 shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-bold">Respostas rápidas</h3>
            <p className="mt-1 text-sm text-ink-2">
              No chat, digite <span className="font-mono font-semibold">/</span> e o atalho. Use <span className="font-mono">{"{nome}"}</span> para o primeiro nome do
              cliente.
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-full p-2 text-ink-2 hover:bg-surface-2">
            <Icone nome="x" tamanho={16} />
          </button>
        </div>

        {editando ? (
          <FormularioResposta resposta={editando === "nova" ? null : editando} onPronto={() => setEditando(null)} />
        ) : (
          <Button variante="secundario" className="self-start" onClick={() => setEditando("nova")}>
            <Icone nome="mais" tamanho={15} />
            Nova resposta rápida
          </Button>
        )}

        {lista.length > 0 && (
          <ul className="flex flex-col gap-2">
            {lista.map((resposta) => (
              <li key={resposta.id} className="flex items-start gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-accent-text">/{resposta.atalho}</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{resposta.texto}</p>
                </div>
                <button type="button" onClick={() => setEditando(resposta)} className="text-xs font-semibold text-accent-text hover:underline">
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Excluir /${resposta.atalho}`}
                  onClick={() => window.confirm(`Excluir a resposta /${resposta.atalho}?`) && excluir.mutate({ id: resposta.id })}
                  className="rounded-full p-1 text-ink-3 hover:text-red-700"
                >
                  <Icone nome="lixeira" tamanho={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FormularioResposta({ resposta, onPronto }: { resposta: RespostaRapida | null; onPronto: () => void }) {
  const utils = trpc.useUtils();
  const [atalho, setAtalho] = useState(resposta?.atalho ?? "");
  const [texto, setTexto] = useState(resposta?.texto ?? "");
  const salvar = trpc.respostasRapidas.salvar.useMutation({
    onSuccess: () => {
      toast.sucesso(resposta ? "Resposta atualizada." : "Resposta criada.");
      void utils.respostasRapidas.invalidate();
      onPronto();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    salvar.mutate({ id: resposta?.id, atalho, texto });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Atalho
        <span className="flex items-center rounded-lg bg-surface ring-1 ring-card-border">
          <span className="pl-3 font-mono text-ink-3">/</span>
          <input
            value={atalho}
            onChange={(e) => setAtalho(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            required
            maxLength={30}
            placeholder="precos"
            className="min-w-0 flex-1 !border-0 !bg-transparent px-1 py-2 text-sm !shadow-none"
          />
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Texto
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          required
          maxLength={4000}
          rows={5}
          placeholder={"Oi {nome}! Nossos planos:\n• Mensal: R$ 99,90\n• Anual: R$ 79,90/mês"}
          className="rounded-lg px-3 py-2 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variante="fantasma" onClick={onPronto}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
