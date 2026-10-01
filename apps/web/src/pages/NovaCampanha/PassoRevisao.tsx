import {
  calcularCusto,
  preencherTemplate,
  resolverParametros,
  ROTULO_CATEGORIA,
  type LinhaDestinatario,
  type OrigemParametro,
} from "@atendimento-academias/shared";
import { Card } from "../../components/Card.js";
import { MensagemPreview } from "../../components/MensagemPreview.js";
import { Icone } from "../../components/ui/Icone.js";
import { formatarMoeda, formatarNumero, formatarPercentual, formatarTelefone, paraCampoDataHora } from "../../lib/format.js";
import { trpc } from "../../lib/trpc.js";
import type { TemplateDisponivel } from "./PassoTemplate.js";

const AMOSTRA = 5;
// Abaixo disso a taxa média das campanhas anteriores oscila demais para servir de estimativa.
const MIN_ENVIOS_PARA_ESTIMAR = 100;

interface PassoRevisaoProps {
  nome: string;
  template: TemplateDisponivel;
  origens: Record<string, OrigemParametro>;
  linhas: LinhaDestinatario[];
  agendar: boolean;
  quando: string;
  onAgendar: (agendar: boolean) => void;
  onQuando: (quando: string) => void;
}

export function PassoRevisao({ nome, template, origens, linhas, agendar, quando, onAgendar, onQuando }: PassoRevisaoProps) {
  const personalizado = Object.values(origens).some((origem) => origem.tipo === "coluna");
  const primeira = linhas[0];

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-2">Campanha</dt>
          <dd className="text-sm font-medium">{nome.trim()}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">Template</dt>
          <dd className="text-sm font-medium">{template.nome}</dd>
        </div>
      </dl>

      <MensagemPreview
        rotulo={
          personalizado && primeira
            ? `Mensagem de ${formatarTelefone(primeira.telefone)} — os outros recebem com os valores deles`
            : "Mensagem que cada pessoa vai receber"
        }
        mensagem={preencherTemplate(template.conteudo, primeira ? resolverParametros(primeira, origens) : {})}
      />

      <Card className="bg-app-bg">
        <p className="text-sm font-medium">
          {formatarNumero(linhas.length)} {linhas.length === 1 ? "destinatário" : "destinatários"}
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
          {linhas.slice(0, AMOSTRA).map((linha) => {
            const valores = personalizado ? Object.values(resolverParametros(linha, origens)).join(" · ") : "";
            return (
              <li key={linha.telefone}>
                <span className="font-mono">{formatarTelefone(linha.telefone)}</span>
                {valores && <span> → {valores}</span>}
              </li>
            );
          })}
          {linhas.length > AMOSTRA && <li>e mais {formatarNumero(linhas.length - AMOSTRA)}</li>}
        </ul>
      </Card>

      <EstimativaCustoERetorno template={template} quantidade={linhas.length} />

      <QuandoEnviar agendar={agendar} quando={quando} onAgendar={onAgendar} onQuando={onQuando} />

      <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {agendar ? (
          <>
            <strong>Agendamento:</strong> o disparo sai sozinho na data escolhida, desde que o worker esteja rodando nessa hora. Até lá
            você pode cancelar no Calendário.
          </>
        ) : (
          <>
            <strong>Antes de disparar:</strong> o envio começa imediatamente e não pode ser cancelado.
          </>
        )}
      </p>
    </div>
  );
}

function EstimativaCustoERetorno({ template, quantidade }: { template: TemplateDisponivel; quantidade: number }) {
  const historicoQuery = trpc.relatorios.taxaRespostaMedia.useQuery();
  const custoTotal = calcularCusto(quantidade, template.precoUnitario);
  const historico = historicoQuery.data;

  const temHistorico = historico !== undefined && historico.taxa !== null && historico.enviados >= MIN_ENVIOS_PARA_ESTIMAR;
  const respostasEstimadas = temHistorico ? Math.round(quantidade * historico.taxa!) : null;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h4 className="font-heading text-sm font-semibold">Custo do disparo</h4>
        <p className="mt-1 text-2xl font-bold tabular-nums">{formatarMoeda(custoTotal)}</p>
        <p className="mt-1 text-xs text-ink-2">
          {formatarNumero(quantidade)} {quantidade === 1 ? "número" : "números"} × {formatarMoeda(template.precoUnitario)} por mensagem
          (categoria {ROTULO_CATEGORIA[template.categoria].toLowerCase()}). Valor estimado; a cobrança real é a do seu provedor
          de WhatsApp.
        </p>
      </div>

      <div className="border-t border-card-border pt-4">
        <h4 className="font-heading text-sm font-semibold">Respostas esperadas</h4>
        {historicoQuery.isPending ? (
          <p className="mt-1 text-sm text-ink-2">Calculando…</p>
        ) : respostasEstimadas !== null && historico ? (
          <>
            <p className="mt-1 text-2xl font-bold tabular-nums">~{formatarNumero(respostasEstimadas)}</p>
            <p className="mt-1 text-xs text-ink-2">
              Estimativa pela taxa de resposta das suas campanhas dos últimos 90 dias ({formatarPercentual(historico.taxa)} de{" "}
              {formatarNumero(historico.enviados)} mensagens enviadas).
              {respostasEstimadas > 0 && ` Isso daria cerca de ${formatarMoeda(custoTotal / respostasEstimadas)} por resposta.`}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-2">
            Ainda não há histórico suficiente para estimar. Depois que suas campanhas receberem respostas, a estimativa aparece
            aqui.
          </p>
        )}
      </div>
    </Card>
  );
}

interface QuandoEnviarProps {
  agendar: boolean;
  quando: string;
  onAgendar: (agendar: boolean) => void;
  onQuando: (quando: string) => void;
}

function QuandoEnviar({ agendar, quando, onAgendar, onQuando }: QuandoEnviarProps) {
  const opcoes = [
    { agendar: false, titulo: "Enviar agora", descricao: "O envio começa assim que você confirmar.", icone: "enviar" as const },
    { agendar: true, titulo: "Agendar", descricao: "Escolha a data e a hora; o disparo sai sozinho.", icone: "calendario" as const },
  ];

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Quando enviar</legend>

      <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
        {opcoes.map((opcao) => {
          const selecionada = opcao.agendar === agendar;
          return (
            <label
              key={opcao.titulo}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                selecionada
                  ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20"
                  : "border-card-border bg-surface hover:border-baseline"
              }`}
            >
              <input type="radio" name="quando-enviar" className="sr-only" checked={selecionada} onChange={() => onAgendar(opcao.agendar)} />
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selecionada ? "bg-accent text-accent-contrast" : "bg-slate-100 text-ink-2"}`}>
                <Icone nome={opcao.icone} tamanho={16} />
              </span>
              <span>
                <span className="block font-heading text-sm font-bold">{opcao.titulo}</span>
                <span className="block text-xs text-ink-2">{opcao.descricao}</span>
              </span>
            </label>
          );
        })}
      </div>

      {agendar && (
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
          Data e hora do disparo
          <input
            type="datetime-local"
            value={quando}
            min={paraCampoDataHora(new Date(Date.now() + 5 * 60_000))}
            onChange={(evento) => onQuando(evento.target.value)}
            className="w-full max-w-xs rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-xs font-normal text-ink-2">No horário do seu computador.</span>
        </label>
      )}
    </fieldset>
  );
}
