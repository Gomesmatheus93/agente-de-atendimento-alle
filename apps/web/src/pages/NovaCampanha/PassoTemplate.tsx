import { ROTULO_CATEGORIA } from "@atendimento-academias/shared";
import { EstadoErro, EstadoVazio, Esqueleto } from "../../components/ui/EstadoVazio.js";
import { Icone } from "../../components/ui/Icone.js";
import { formatarMoeda } from "../../lib/format.js";
import { hrefDe } from "../../lib/route.js";
import { trpc, type SaidaApi } from "../../lib/trpc.js";

export type TemplateDisponivel = SaidaApi["templates"]["listar"][number];

const inputClasses = "rounded-lg px-3 py-2 text-sm";

interface PassoTemplateProps {
  nome: string;
  numeroId: number | null;
  templateId: number | null;
  onNome: (nome: string) => void;
  onNumero: (numeroId: number) => void;
  onTemplate: (templateId: number) => void;
}

export function PassoTemplate({ nome, numeroId, templateId, onNome, onNumero, onTemplate }: PassoTemplateProps) {
  const configuracao = trpc.configuracoes.listar.useQuery();
  // Os templates são aprovados por conta na Meta: sem número escolhido não dá para saber quais valem.
  const templatesQuery = trpc.templates.listar.useQuery(
    { numeroId: numeroId ?? undefined },
    { enabled: numeroId !== null },
  );

  const numeros = (configuracao.data?.contas ?? []).flatMap((conta) =>
    conta.numeros.filter((numero) => numero.ativo).map((numero) => ({ ...numero, conta: conta.nome })),
  );

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nome da campanha
        <input
          className={inputClasses}
          value={nome}
          maxLength={255}
          placeholder="Ex.: Promoção de renovação, setembro"
          onChange={(evento) => onNome(evento.target.value)}
        />
        <span className="text-xs font-normal text-ink-2">Só para você se organizar; os destinatários não veem.</span>
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Enviar pelo número</legend>

        {numeros.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum número ativo"
            descricao="Conecte a conta do WhatsApp e ative um número em Configurações para poder disparar."
          />
        ) : (
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {numeros.map((numero) => {
              const selecionado = numero.id === numeroId;
              return (
                <label
                  key={numero.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                    selecionado ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-card-border bg-surface hover:border-baseline"
                  }`}
                >
                  <input type="radio" name="numero" className="sr-only" checked={selecionado} onChange={() => onNumero(numero.id)} />
                  <span className="min-w-0">
                    <span className="block font-mono">{numero.numeroExibicao}</span>
                    <span className="block truncate text-xs text-ink-2">{numero.nomeVerificado ?? numero.conta}</span>
                  </span>
                  {selecionado && <Icone nome="check" tamanho={14} className="ml-auto text-accent-text" />}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Template da mensagem</legend>

        {numeroId === null && <p className="text-sm text-ink-2">Escolha o número primeiro.</p>}

        {templatesQuery.isPending && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Esqueleto className="h-28" />
            <Esqueleto className="h-28" />
          </div>
        )}

        {templatesQuery.isError && (
          <EstadoErro mensagem={templatesQuery.error.message} onTentarNovamente={() => void templatesQuery.refetch()} />
        )}

        {templatesQuery.data?.length === 0 && (
          <EstadoVazio
            titulo="Nenhum template nesta conta"
            descricao="Em Configurações, use Importar templates para trazer os templates aprovados desta conta do WhatsApp."
          />
        )}

        <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
          {templatesQuery.data?.map((template) => {
            const selecionado = template.id === templateId;
            return (
              <label
                key={template.id}
                className={`flex cursor-pointer flex-col gap-2.5 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  selecionado ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-card-border bg-surface hover:border-baseline"
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  className="sr-only"
                  checked={selecionado}
                  onChange={() => onTemplate(template.id)}
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-heading text-sm font-bold">{template.nome}</span>
                  {selecionado && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
                      <Icone nome="check" tamanho={12} />
                      Selecionado
                    </span>
                  )}
                </span>
                <span className="line-clamp-3 text-sm text-ink-2">{template.conteudo}</span>
                <span className="text-xs text-ink-2">
                  {template.placeholders.length === 0
                    ? "Sem parâmetros"
                    : `Parâmetros: ${template.placeholders.join(", ")}`}
                </span>
                {template.exigeImagem && !template.temImagem && (
                  <span className="rounded-md bg-amber-50 px-1.5 py-1 text-xs text-amber-900">
                    Este template usa imagem no cabeçalho e ainda não tem uma. Escolha a imagem em{" "}
                    <a href={hrefDe({ tela: "templates", criarNaConta: null })} className="font-semibold underline">
                      Templates
                    </a>{" "}
                    antes de disparar.
                  </span>
                )}
                <span className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-ink-2">
                    {ROTULO_CATEGORIA[template.categoria]}
                  </span>
                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent-text">
                    {formatarMoeda(template.precoUnitario)} / mensagem
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
