import { useState } from "react";
import { baixarCsv, nomeDeArquivo } from "../lib/csv.js";
import { trpc } from "../lib/trpc.js";
import { Icone } from "./ui/Icone.js";
import { toast } from "./ui/Toast.js";

// Botão "Exportar planilha": só para o admin (o servidor também confere).
export function BotaoExportar({
  arquivo,
  gerar,
  compacto = false,
}: {
  arquivo: string;
  gerar: () => Promise<string[][]>;
  compacto?: boolean;
}) {
  const papel = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario?.papel;
  const [gerando, setGerando] = useState(false);
  if (papel !== "admin" && papel !== "superadmin") return null;

  async function exportar() {
    setGerando(true);
    try {
      const linhas = await gerar();
      baixarCsv(nomeDeArquivo(arquivo), linhas);
      toast.sucesso(`Planilha com ${linhas.length - 1} linha(s) baixada.`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível exportar.");
    } finally {
      setGerando(false);
    }
  }

  return compacto ? (
    <button
      type="button"
      onClick={() => void exportar()}
      disabled={gerando}
      aria-label="Exportar planilha (CSV)"
      title="Exportar planilha (CSV)"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-slate-200/60 hover:text-ink disabled:opacity-50"
    >
      <Icone nome="download" tamanho={16} />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void exportar()}
      disabled={gerando}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-accent/30 bg-surface px-4 py-2 text-sm font-semibold text-accent-text transition-colors hover:border-accent hover:bg-accent-soft disabled:text-ink-3"
    >
      <Icone nome="download" tamanho={15} />
      {gerando ? "Gerando…" : "Exportar planilha"}
    </button>
  );
}
