import { Card } from "../components/Card.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarTelefone, tempoRelativo } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Estado = SaidaApi["fila"]["estado"];
type Cliente = Estado["esperando"][number];

const ATUALIZAR_A_CADA_MS = 10_000;

const SITUACAO = {
  disponivel: { rotulo: "Disponível", classe: "bg-emerald-50 text-emerald-800", ponto: "bg-emerald-500" },
  ocupado: { rotulo: "Ocupado", classe: "bg-amber-50 text-amber-900", ponto: "bg-amber-500" },
  ausente: { rotulo: "Ausente", classe: "bg-slate-100 text-ink-2", ponto: "bg-slate-400" },
} as const;

const nomeDe = (cliente: { nome: string | null; telefone: string }) => cliente.nome ?? formatarTelefone(cliente.telefone);

function LinkConversa({ cliente }: { cliente: Pick<Cliente, "telefone" | "numeroId" | "nome"> }) {
  return (
    <a href={hrefDe({ tela: "conversas", telefone: cliente.telefone, numeroId: cliente.numeroId })} className="font-semibold text-accent-text hover:underline">
      {nomeDe(cliente)}
    </a>
  );
}

// Quem está na fila, quem está atendendo quem, e os clientes esperando alguém ficar livre.
export function Fila() {
  const estado = trpc.fila.estado.useQuery(undefined, { refetchInterval: ATUALIZAR_A_CADA_MS });

  if (estado.isPending) return <p className="text-sm text-ink-2">Carregando…</p>;
  if (estado.isError) return <p className="text-sm text-ink-2">{mensagemDeErro(estado.error)}</p>;

  const { atendentes, esperando } = estado.data;
  const proximos = atendentes.filter((pessoa) => pessoa.posicaoNaFila !== null).sort((a, b) => a.posicaoNaFila! - b.posicaoNaFila!);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h3 className="font-heading text-base font-bold">Como funciona</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
          <li>Cada funcionário faz o check-in no menu lateral para entrar na fila.</li>
          <li>
            Quando um cliente pede uma pessoa (ou o bot não sabe responder), ele vai para quem está disponível há mais tempo
            sem receber ninguém.
          </li>
          <li>
            Enquanto atende, a pessoa fica ocupada e a fila passa a vez para a próxima. Responder um cliente à mão também
            conta como atendimento.
          </li>
          <li>Ao clicar em “Encerrar atendimento” na conversa, o bot volta a responder e a pessoa fica livre.</li>
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="font-heading text-base font-bold">Esperando atendimento</h3>
          <p className="mt-1 text-sm text-ink-2">
            {esperando.length === 0
              ? "Ninguém esperando agora."
              : proximos.length === 0
                ? "Ninguém está disponível na fila: estes clientes vão para o primeiro que fizer check-in ou ficar livre."
                : "Vão para os próximos da fila assim que alguém ficar livre."}
          </p>
          {esperando.length > 0 && (
            <ol className="mt-4 flex flex-col divide-y divide-card-border border-y border-card-border">
              {esperando.map((cliente, indice) => (
                <li key={`${cliente.numeroId}:${cliente.telefone}`} className="flex items-start gap-3 py-3 text-sm">
                  <span className="mt-0.5 w-5 shrink-0 text-right font-semibold text-ink-3">{indice + 1}º</span>
                  <span className="min-w-0 flex-1">
                    <LinkConversa cliente={cliente} />
                    {cliente.motivo && <span className="block truncate text-xs text-ink-2">{cliente.motivo}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{tempoRelativo(cliente.desde)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <h3 className="font-heading text-base font-bold">Equipe</h3>
          <p className="mt-1 text-sm text-ink-2">
            {proximos.length > 0 ? `Próximo a receber: ${proximos[0]!.nome}.` : "Ninguém disponível na fila agora."}
          </p>
          <ul className="mt-4 flex flex-col divide-y divide-card-border border-y border-card-border">
            {atendentes.map((pessoa) => {
              const situacao = SITUACAO[pessoa.situacao];
              return (
                <li key={pessoa.id} className="flex flex-col gap-1.5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${situacao.ponto}`} />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {pessoa.nome}
                      {pessoa.souEu && <span className="ml-1 text-xs font-normal text-ink-2">(você)</span>}
                    </span>
                    {pessoa.posicaoNaFila !== null && <span className="text-xs text-ink-3">{pessoa.posicaoNaFila}º da fila</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${situacao.classe}`}>{situacao.rotulo}</span>
                  </div>
                  {pessoa.atendendo.map((cliente) => (
                    <AtendimentoAberto key={`${cliente.numeroId}:${cliente.telefone}`} cliente={cliente} />
                  ))}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AtendimentoAberto({ cliente }: { cliente: Estado["atendentes"][number]["atendendo"][number] }) {
  const utils = trpc.useUtils();
  const devolver = trpc.conversas.devolverParaFila.useMutation({
    onSuccess: () => {
      toast.sucesso(`${nomeDe(cliente)} voltou para a fila.`);
      void utils.fila.estado.invalidate();
      void utils.conversas.pedidosDeHumano.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  return (
    <p className="flex flex-wrap items-center gap-x-2 pl-[18px] text-xs text-ink-2">
      atendendo <LinkConversa cliente={cliente} />
      {cliente.desde && <span className="text-ink-3">{tempoRelativo(cliente.desde)}</span>}
      <button
        type="button"
        onClick={() => devolver.mutate({ telefone: cliente.telefone, numeroId: cliente.numeroId })}
        disabled={devolver.isPending}
        className="font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
      >
        Devolver para a fila
      </button>
    </p>
  );
}
