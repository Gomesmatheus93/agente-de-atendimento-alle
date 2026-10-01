import { calcularCusto, ROTULO_CATEGORIA } from "@atendimento-academias/shared";
import { Card } from "../../components/Card.js";
import { formatarMoeda, formatarNumero, formatarQuando } from "../../lib/format.js";
import type { TemplateDisponivel } from "./PassoTemplate.js";

interface ResumoLateralProps {
  nome: string;
  template: TemplateDisponivel | undefined;
  destinatarios: number;
  // Data do disparo quando agendado; nulo = dispara na hora.
  quando: Date | null;
}

// Fica visível em todos os passos, então o custo aparece assim que há template e números.
export function ResumoLateral({ nome, template, destinatarios, quando }: ResumoLateralProps) {
  const custo = template ? calcularCusto(destinatarios, template.precoUnitario) : null;

  return (
    <aside aria-label="Resumo da campanha" className="lg:sticky lg:top-8">
      <Card className="flex flex-col gap-5">
        <h3 className="font-heading text-sm font-bold">Resumo da campanha</h3>

        <dl className="flex flex-col gap-3 text-sm">
          <Linha rotulo="Nome">{nome.trim() || <Vazio />}</Linha>
          <Linha rotulo="Template">
            {template ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {template.nome}
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                  {ROTULO_CATEGORIA[template.categoria]}
                </span>
              </span>
            ) : (
              <Vazio />
            )}
          </Linha>
          <Linha rotulo="Destinatários">{destinatarios > 0 ? formatarNumero(destinatarios) : <Vazio />}</Linha>
          <Linha rotulo="Envio">{quando ? formatarQuando(quando) : "Assim que confirmar"}</Linha>
          <Linha rotulo="Preço por mensagem">{template ? formatarMoeda(template.precoUnitario) : <Vazio />}</Linha>
        </dl>

        <div className="rounded-xl bg-accent-soft px-4 py-3.5 ring-1 ring-inset ring-accent/15">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-text">Custo estimado</p>
          <p className="mt-1 font-heading text-[1.75rem] font-bold leading-tight tracking-tight tabular-nums text-ink">
            {formatarMoeda(custo)}
          </p>
          <p className="mt-1 text-xs text-ink-2">
            {template && destinatarios > 0
              ? `${formatarNumero(destinatarios)} × ${formatarMoeda(template.precoUnitario)}. A cobrança real é a do seu provedor.`
              : "Escolha o template e adicione os números para ver o custo."}
          </p>
        </div>
      </Card>
    </aside>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-3">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

function Vazio() {
  return <span className="font-normal text-ink-3">—</span>;
}
