import {
  preencherTemplate,
  resolverParametros,
  type ListaDestinatarios,
  type OrigemParametro,
} from "@atendimento-academias/shared";
import { MensagemPreview } from "../../components/MensagemPreview.js";
import { formatarNumero, formatarTelefone } from "../../lib/format.js";
import type { TemplateDisponivel } from "./PassoTemplate.js";

const MAX_EXEMPLO = 28;

function rotuloDaColuna(lista: ListaDestinatarios, indice: number): string {
  const exemplo = lista.validos.find((linha) => linha.colunas[indice]?.trim())?.colunas[indice]?.trim();
  if (!exemplo) return `Coluna ${indice + 1} da lista`;
  const curto = exemplo.length > MAX_EXEMPLO ? `${exemplo.slice(0, MAX_EXEMPLO)}…` : exemplo;
  return `Coluna ${indice + 1} da lista — ex: ${curto}`;
}

// Quantos destinatários ficariam sem valor nessa coluna e cairiam no padrão.
export function semValorNaColuna(lista: ListaDestinatarios, indice: number): number {
  return lista.validos.filter((linha) => !linha.colunas[indice]?.trim()).length;
}

interface PassoParametrosProps {
  template: TemplateDisponivel;
  lista: ListaDestinatarios;
  origens: Record<string, OrigemParametro>;
  onOrigem: (nome: string, origem: OrigemParametro) => void;
}

export function PassoParametros({ template, lista, origens, onOrigem }: PassoParametrosProps) {
  const primeira = lista.validos[0];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">
          Para cada valor do template <strong className="text-ink">{template.nome}</strong>, escolha se ele é igual para todos
          ou se vem de uma coluna da sua lista — aí cada pessoa recebe o próprio nome.
        </p>

        {template.placeholders.map((nome) => {
          const origem = origens[nome] ?? { tipo: "fixo" as const, valor: "" };
          const semValor = origem.tipo === "coluna" ? semValorNaColuna(lista, origem.indice) : 0;

          return (
            <fieldset key={nome} className="flex flex-col gap-2 rounded-xl border border-card-border p-3.5">
              <legend className="px-1 font-mono text-xs font-semibold text-ink-2">{`{{${nome}}}`}</legend>

              <label className="flex flex-col gap-1 text-sm font-medium">
                De onde vem
                <select
                  className="rounded-lg px-3 py-2 text-sm"
                  value={origem.tipo === "coluna" ? `coluna:${origem.indice}` : "fixo"}
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    onOrigem(
                      nome,
                      valor === "fixo"
                        ? { tipo: "fixo", valor: origem.tipo === "fixo" ? origem.valor : "" }
                        : { tipo: "coluna", indice: Number(valor.split(":")[1]), padrao: origem.tipo === "coluna" ? origem.padrao : "" },
                    );
                  }}
                >
                  <option value="fixo">Valor fixo — igual para todos</option>
                  {Array.from({ length: lista.colunas }, (_, indice) => (
                    <option key={indice} value={`coluna:${indice}`}>
                      {rotuloDaColuna(lista, indice)}
                    </option>
                  ))}
                </select>
              </label>

              {origem.tipo === "fixo" ? (
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Valor
                  <input
                    className="rounded-lg px-3 py-2 text-sm"
                    value={origem.valor}
                    onChange={(evento) => onOrigem(nome, { tipo: "fixo", valor: evento.target.value })}
                  />
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Quando a coluna estiver vazia, usar
                  <input
                    className="rounded-lg px-3 py-2 text-sm"
                    placeholder="cliente"
                    value={origem.padrao}
                    onChange={(evento) => onOrigem(nome, { ...origem, padrao: evento.target.value })}
                  />
                  <span className="text-xs font-normal text-ink-2">
                    {semValor === 0
                      ? "Todos os destinatários têm valor nessa coluna."
                      : `${formatarNumero(semValor)} de ${formatarNumero(lista.validos.length)} ${semValor === 1 ? "destinatário está" : "destinatários estão"} sem valor nessa coluna.`}
                  </span>
                </label>
              )}
            </fieldset>
          );
        })}

        {lista.colunas === 0 && (
          <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
            Sua lista tem só telefones, então não há coluna para variar. Para personalizar, volte e cole também o nome,
            no formato <span className="font-mono">Nome; telefone</span>.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <MensagemPreview
          rotulo={primeira ? `Prévia para ${formatarTelefone(primeira.telefone)}` : "Prévia da mensagem"}
          mensagem={preencherTemplate(template.conteudo, primeira ? resolverParametros(primeira, origens) : {})}
        />
        {lista.validos.length > 1 && (
          <p className="text-xs text-ink-2">
            É o primeiro da lista. Os outros {formatarNumero(lista.validos.length - 1)} recebem a mesma mensagem, com os
            valores deles.
          </p>
        )}
      </div>
    </div>
  );
}
