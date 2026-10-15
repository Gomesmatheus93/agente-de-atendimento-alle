import { useState } from "react";
import { trpc } from "../lib/trpc.js";
import { Card } from "./Card.js";
import { Icone } from "./ui/Icone.js";

// Primeiros passos de uma unidade nova, no topo da Visão geral (só para quem configura: admin e
// superadmin). Some sozinho quando os passos obrigatórios ficam prontos, ou quando a pessoa fecha.
export function PrimeirosPassos() {
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const podeConfigurar = usuario?.papel === "admin" || usuario?.papel === "superadmin";
  const chave = `primeiros-passos-fechado-${usuario?.unidadeId ?? 0}`;
  const [fechado, setFechado] = useState(() => {
    try {
      return localStorage.getItem(chave) === "1";
    } catch {
      return false;
    }
  });
  const estado = trpc.primeirosPassos.estado.useQuery(undefined, { enabled: podeConfigurar && !fechado, staleTime: 60_000 }).data;
  if (!podeConfigurar || fechado || !estado || estado.concluido) return null;

  function fechar() {
    setFechado(true);
    try {
      localStorage.setItem(chave, "1");
    } catch {
      // sem armazenamento: volta na próxima visita
    }
  }

  const obrigatorios = estado.passos.filter((p) => !p.opcional);
  const opcionais = estado.passos.filter((p) => p.opcional);
  const proximo = obrigatorios.find((p) => !p.feito);
  const progresso = Math.round((estado.prontos / estado.total) * 100);

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold">Primeiros passos da unidade</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {estado.prontos} de {estado.total} prontos{proximo ? ` · Próximo: ${proximo.titulo.charAt(0).toLowerCase()}${proximo.titulo.slice(1)}` : ""}
          </p>
        </div>
        <button type="button" onClick={fechar} className="text-xs font-semibold text-ink-3 hover:text-ink">
          Esconder
        </button>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={estado.total}
        aria-valuenow={estado.prontos}
        aria-label="Passos prontos"
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progresso}%` }} />
      </div>
      <ol className="grid gap-2 md:grid-cols-2">
        {obrigatorios.map((passo, indice) => (
          <Passo key={passo.chave} passo={passo} numero={indice + 1} destaque={passo === proximo} />
        ))}
      </ol>
      {opcionais.some((p) => !p.feito) && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Para ir além</p>
          <ul className="flex flex-wrap gap-2">
            {opcionais.map((passo) => (
              <li key={passo.chave}>
                <a
                  href={passo.link}
                  title={passo.descricao}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    passo.feito ? "bg-emerald-50 text-emerald-800" : "bg-surface-2 text-ink-2 hover:text-accent-text"
                  }`}
                >
                  <Icone nome={passo.feito ? "check" : "mais"} tamanho={12} />
                  {passo.titulo}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Passo({ passo, numero, destaque }: { passo: { titulo: string; descricao: string; feito: boolean; link: string }; numero: number; destaque: boolean }) {
  return (
    <li>
      <a
        href={passo.link}
        className={`flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors ${destaque ? "bg-accent-soft ring-1 ring-inset ring-accent/30" : "hover:bg-surface-2"}`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            passo.feito ? "bg-emerald-50 text-emerald-800" : destaque ? "bg-accent text-accent-contrast" : "bg-surface-2 text-ink-2"
          }`}
        >
          {passo.feito ? <Icone nome="check" tamanho={13} /> : numero}
        </span>
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${passo.feito ? "text-ink-3 line-through" : "text-ink"}`}>
            {passo.titulo}
            <span className="sr-only">{passo.feito ? " (pronto)" : " (falta)"}</span>
          </span>
          {!passo.feito && <span className="block text-xs text-ink-2">{passo.descricao}</span>}
        </span>
      </a>
    </li>
  );
}
