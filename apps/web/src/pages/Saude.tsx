import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { tempoRelativo } from "../lib/format.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Verificacao = SaidaApi["saude"]["estado"]["verificacoes"][number];

// Contador do topo e do menu: quantas peças estão com problema agora.
export function useProblemasDeSaude(habilitado: boolean) {
  const dados = trpc.saude.estado.useQuery(undefined, { enabled: habilitado, refetchInterval: 60_000, staleTime: 30_000 }).data;
  const falhas = dados?.falhas ?? 0;
  const atencoes = dados?.atencoes ?? 0;
  return { falhas, atencoes, total: falhas + atencoes };
}

const ESTILO = {
  falha: { selo: "bg-red-50 text-red-700 ring-red-200", rotulo: "Falha", icone: "alerta" as const },
  atencao: { selo: "bg-amber-50 text-amber-900 ring-amber-200", rotulo: "Atenção", icone: "alerta" as const },
  ok: { selo: "bg-emerald-50 text-emerald-800 ring-emerald-200", rotulo: "OK", icone: "check" as const },
};

export function Saude() {
  const utils = trpc.useUtils();
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const podeVerificar = usuario?.papel === "admin" || usuario?.papel === "superadmin";
  const estado = trpc.saude.estado.useQuery(undefined, { refetchInterval: 60_000 });
  const verificar = trpc.saude.verificarAgora.useMutation({
    onSuccess: () => {
      toast.sucesso("Verificação concluída.");
      void utils.saude.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  if (estado.isError) return <EstadoErro mensagem={estado.error.message} onTentarNovamente={() => void estado.refetch()} />;
  if (!estado.data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Esqueleto className="h-28" />
        <Esqueleto className="h-64" />
      </div>
    );
  }

  const { verificacoes, ultimaVerificacao, falhas, atencoes } = estado.data;
  const problemas = verificacoes.filter((v) => v.nivel !== "ok");
  const funcionando = verificacoes.filter((v) => v.nivel === "ok");

  const resumo =
    verificacoes.length === 0
      ? { titulo: "Ainda não verificado", texto: "A primeira verificação roda alguns minutos depois que o servidor sobe.", cor: "bg-surface-2 text-ink-2" }
      : falhas > 0
        ? {
            titulo: falhas === 1 ? "1 falha precisa de você" : `${falhas} falhas precisam de você`,
            texto: "Enquanto não for resolvido, parte do atendimento pode estar parada.",
            cor: "bg-red-50 text-red-700",
          }
        : atencoes > 0
          ? {
              titulo: atencoes === 1 ? "1 ponto de atenção" : `${atencoes} pontos de atenção`,
              texto: "Está funcionando, mas vale olhar antes que vire problema.",
              cor: "bg-amber-50 text-amber-900",
            }
          : { titulo: "Tudo funcionando", texto: "WhatsApp, bot, filas e integrações estão respondendo.", cor: "bg-emerald-50 text-emerald-800" };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden="true" className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${resumo.cor}`}>
            <Icone nome={falhas + atencoes > 0 ? "alerta" : "pulso"} tamanho={26} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-xl font-bold">{resumo.titulo}</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {resumo.texto}
              {ultimaVerificacao && <span className="text-ink-3"> · Verificado {tempoRelativo(ultimaVerificacao)}</span>}
            </p>
          </div>
          {podeVerificar && (
            <Button variante="secundario" onClick={() => verificar.mutate()} disabled={verificar.isPending}>
              <Icone nome="pulso" tamanho={15} />
              {verificar.isPending ? "Verificando…" : "Verificar agora"}
            </Button>
          )}
        </div>
      </Card>

      {problemas.length > 0 && (
        <section aria-labelledby="titulo-problemas" className="flex flex-col gap-3">
          <h3 id="titulo-problemas" className="font-heading text-base font-bold">
            Precisa de atenção
          </h3>
          {problemas.map((v) => (
            <CartaoProblema key={`${v.plataforma ? "p" : "u"}-${v.chave}`} verificacao={v} />
          ))}
        </section>
      )}

      {funcionando.length > 0 && (
        <section aria-labelledby="titulo-ok" className="flex flex-col gap-3">
          <h3 id="titulo-ok" className="font-heading text-base font-bold">
            Funcionando
          </h3>
          <Card className="!p-2">
            <ul className="grid gap-x-4 sm:grid-cols-2">
              {funcionando.map((v) => (
                <li key={`${v.plataforma ? "p" : "u"}-${v.chave}`} className="flex items-start gap-3 rounded-2xl px-3 py-2.5">
                  <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
                    <Icone nome="check" tamanho={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">
                      {v.titulo}
                      {v.plataforma && <span className="ml-1.5 text-[11px] font-medium text-ink-3">plataforma</span>}
                    </span>
                    <span className="block text-xs text-ink-2">{v.mensagem}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function CartaoProblema({ verificacao: v }: { verificacao: Verificacao }) {
  const estilo = ESTILO[v.nivel];
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 text-xs font-bold ring-1 ring-inset ${estilo.selo}`}>
        <Icone nome={estilo.icone} tamanho={13} />
        {estilo.rotulo}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">
          {v.titulo}
          {v.plataforma && <span className="ml-2 text-xs font-medium text-ink-3">vale para todas as unidades</span>}
        </p>
        <p className="mt-1 text-sm text-ink-2">{v.mensagem}</p>
        {v.acao && (
          <p className="mt-2 text-sm text-ink">
            <strong className="font-semibold">O que fazer:</strong> {v.acao}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-3">Começou {tempoRelativo(v.desde)} · verificado {tempoRelativo(v.verificadoEm)}</p>
      </div>
      {v.link && (
        <a
          href={v.link}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
        >
          Resolver
        </a>
      )}
    </Card>
  );
}
