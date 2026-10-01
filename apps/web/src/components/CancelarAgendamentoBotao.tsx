import { useState } from "react";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc } from "../lib/trpc.js";
import { Button } from "./ui/Button.js";
import { toast } from "./ui/Toast.js";

interface CancelarAgendamentoBotaoProps {
  campanhaId: number;
  nome: string;
  aoCancelar?: () => void;
}

// Cancelar apaga a campanha (ninguém recebeu nada ainda), então pede uma confirmação antes.
export function CancelarAgendamentoBotao({ campanhaId, nome, aoCancelar }: CancelarAgendamentoBotaoProps) {
  const utils = trpc.useUtils();
  const [confirmando, setConfirmando] = useState(false);

  const atualizarTelas = () =>
    Promise.all([
      utils.campanhas.listar.invalidate(),
      utils.calendario.periodo.invalidate(),
      utils.dashboard.resumo.invalidate(),
    ]);

  const cancelar = trpc.campanhas.cancelarAgendamento.useMutation({
    onSuccess: async () => {
      toast.sucesso(`Agendamento de "${nome}" cancelado.`);
      await atualizarTelas();
      aoCancelar?.();
    },
    onError: (erro) => {
      toast.erro(mensagemDeErro(erro));
      setConfirmando(false);
      // Se o disparo já tinha começado, a tela precisa refletir o status novo.
      void atualizarTelas();
    },
  });

  if (!confirmando) {
    return (
      <Button variante="secundario" className="px-3 py-1.5 text-xs" onClick={() => setConfirmando(true)}>
        Cancelar agendamento
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Confirmar cancelamento de ${nome}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
    >
      <span>Cancelar e apagar esta campanha? Nenhuma mensagem foi enviada ainda.</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={cancelar.isPending}
          onClick={() => cancelar.mutate({ id: campanhaId })}
          className="rounded-md bg-status-falhou px-2.5 py-1 font-semibold text-white hover:brightness-95 disabled:opacity-60"
        >
          {cancelar.isPending ? "Cancelando…" : "Sim, cancelar"}
        </button>
        <button
          type="button"
          disabled={cancelar.isPending}
          onClick={() => setConfirmando(false)}
          className="rounded-md px-2.5 py-1 font-semibold text-red-800 hover:bg-red-100/60"
        >
          Manter
        </button>
      </span>
    </div>
  );
}
