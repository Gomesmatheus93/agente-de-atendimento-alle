import { extrairPlaceholders, ROTULO_CATEGORIA, type CategoriaTemplate } from "@atendimento-academias/shared";
import { useRef, useState, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { TextoWhatsapp } from "../components/TextoWhatsapp.js";
import { Button } from "../components/ui/Button.js";
import { EstadoVazio } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarMoeda } from "../lib/format.js";
import { lerImagemDeTemplate } from "../lib/imagem.js";
import { hrefDe } from "../lib/route.js";
import { trpc } from "../lib/trpc.js";
import type { SaidaApi } from "../lib/trpc.js";

type Conta = SaidaApi["templates"]["porConta"]["contas"][number];
type Template = Conta["templates"][number];

// Os status da Meta agrupados como a equipe pensa neles.
type Situacao = "aprovado" | "analise" | "recusado";
type FiltroStatus = "todos" | Situacao;

function situacaoDe(template: Template): Situacao {
  if (template.status === "APPROVED") return "aprovado";
  if (template.status === "PENDING" || template.status === "IN_APPEAL") return "analise";
  return "recusado";
}

interface Filtros {
  busca: string;
  status: FiltroStatus;
  categoria: CategoriaTemplate | "todas";
}

function filtrar(templates: Template[], filtros: Filtros): Template[] {
  const busca = filtros.busca.trim().toLowerCase();
  return templates.filter(
    (template) =>
      (filtros.status === "todos" || situacaoDe(template) === filtros.status) &&
      (filtros.categoria === "todas" || template.categoria === filtros.categoria) &&
      (busca === "" || template.nome.toLowerCase().includes(busca) || template.conteudo.toLowerCase().includes(busca)),
  );
}

export function Templates() {
  const templates = trpc.templates.porConta.useQuery(undefined, {
    // Enquanto algum template está em análise, a resposta da Meta (via webhook) aparece sem recarregar.
    refetchInterval: (consulta) =>
      consulta.state.data?.contas.some((conta) => conta.templates.some((template) => situacaoDe(template) === "analise"))
        ? 15_000
        : false,
  });
  const [filtros, setFiltros] = useState<Filtros>({ busca: "", status: "todos", categoria: "todas" });

  if (templates.isPending) return <p className="text-sm text-ink-2">Carregando…</p>;

  const dados = templates.data;
  if (!dados) return <p className="text-sm text-ink-2">Não foi possível carregar os templates.</p>;

  if (dados.contas.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhuma conta do WhatsApp conectada"
        descricao="Os templates vêm da conta do WhatsApp Business na Meta. Conecte a conta em Configurações e depois volte aqui."
        acao={
          <a
            href={hrefDe({ tela: "configuracoes" })}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-sm transition-colors hover:bg-accent-strong"
          >
            Ir para Configurações
          </a>
        }
      />
    );
  }

  const todos = dados.contas.flatMap((conta) => conta.templates);

  return (
    <div className="flex flex-col gap-8">
      {todos.length > 0 && <BarraDeFiltros filtros={filtros} onMudar={setFiltros} templates={todos} />}

      {dados.contas.map((conta) => (
        <SecaoDaConta key={conta.id} conta={conta} filtros={filtros} />
      ))}

      {dados.semConta.length > 0 && <SecaoExemplos templates={dados.semConta} />}
    </div>
  );
}

function BarraDeFiltros({
  filtros,
  onMudar,
  templates,
}: {
  filtros: Filtros;
  onMudar: (filtros: Filtros) => void;
  templates: Template[];
}) {
  const contar = (situacao: Situacao) => templates.filter((template) => situacaoDe(template) === situacao).length;
  const opcoes: Array<{ valor: FiltroStatus; rotulo: string; total: number }> = [
    { valor: "todos", rotulo: "Todos", total: templates.length },
    { valor: "aprovado", rotulo: "Aprovados", total: contar("aprovado") },
    { valor: "analise", rotulo: "Em análise", total: contar("analise") },
    { valor: "recusado", rotulo: "Reprovados", total: contar("recusado") },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-56 flex-1">
        <span className="sr-only">Buscar template</span>
        <Icone nome="busca" tamanho={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={filtros.busca}
          onChange={(evento) => onMudar({ ...filtros, busca: evento.target.value })}
          placeholder="Buscar por nome ou texto"
          className="w-full rounded-lg py-2 pl-9 pr-3 text-sm"
        />
      </label>

      <div role="group" aria-label="Filtrar por status" className="flex flex-wrap rounded-lg border border-card-border bg-surface p-0.5">
        {opcoes.map((opcao) => {
          const ativo = filtros.status === opcao.valor;
          return (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => onMudar({ ...filtros, status: opcao.valor })}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                ativo ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:text-ink"
              }`}
            >
              {opcao.rotulo} <span className="font-normal opacity-70">{opcao.total}</span>
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-ink-2">
        Categoria
        <select
          value={filtros.categoria}
          onChange={(evento) => onMudar({ ...filtros, categoria: evento.target.value as Filtros["categoria"] })}
          className="rounded-lg px-2 py-1.5 text-sm text-ink"
        >
          <option value="todas">Todas</option>
          {Object.entries(ROTULO_CATEGORIA).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SecaoDaConta({ conta, filtros }: { conta: Conta; filtros: Filtros }) {
  const utils = trpc.useUtils();

  const importar = trpc.configuracoes.sincronizarTemplates.useMutation({
    onSuccess: (r) => {
      toast.sucesso(
        r.precisamDeImagem > 0
          ? `${r.importados} template(s) atualizado(s). ${r.precisamDeImagem} usa(m) imagem no cabeçalho: confira se ela está configurada.`
          : `${r.importados} template(s) atualizado(s).`,
      );
      void utils.templates.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const visiveis = filtrar(conta.templates, filtros);
  const aprovados = conta.templates.filter((template) => template.aprovado).length;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-card-border pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Conta do WhatsApp</p>
          <h3 className="font-heading text-lg font-bold">{conta.nome}</h3>
          {conta.templates.length > 0 && (
            <p className="text-xs text-ink-2">
              {conta.templates.length} template(s) · {aprovados} aprovado(s) na Meta
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variante="secundario" disabled={importar.isPending} onClick={() => importar.mutate({ contaId: conta.id })}>
            {importar.isPending ? "Buscando…" : conta.templates.length === 0 ? "Importar da Meta" : "Atualizar da Meta"}
          </Button>
          <a
            href={hrefDe({ tela: "templates", criarNaConta: conta.id })}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
          >
            <Icone nome="mais" tamanho={15} />
            Novo template
          </a>
        </div>
      </header>

      {conta.templates.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nenhum template desta conta aqui ainda. Traga os que já existem na Meta com <strong>Importar da Meta</strong>,
          ou crie um em <strong>Novo template</strong>.
        </p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-ink-2">Nenhum template desta conta com esses filtros.</p>
      ) : (
        <GradeTemplates templates={visiveis} />
      )}
    </section>
  );
}

function SecaoExemplos({ templates }: { templates: Template[] }) {
  const [aberta, setAberta] = useState(false);

  return (
    <section className="rounded-xl border border-dashed border-card-border px-4 py-3">
      <button
        type="button"
        aria-expanded={aberta}
        onClick={() => setAberta((atual) => !atual)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-ink-2">Exemplos de teste ({templates.length})</span>
          <span className="block text-xs text-ink-3">
            Criados pelo <code className="font-mono">pnpm db:seed</code>. Não existem na Meta: campanha real com eles falha.
          </span>
        </span>
        <Icone nome="recolher" tamanho={16} className={`text-ink-3 transition-transform ${aberta ? "rotate-90" : "-rotate-90"}`} />
      </button>
      {aberta && (
        <div className="mt-4">
          <GradeTemplates templates={templates} />
        </div>
      )}
    </section>
  );
}

function GradeTemplates({ templates }: { templates: Template[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {templates.map((template) => (
        <li key={template.id}>
          <CartaoTemplate template={template} />
        </li>
      ))}
    </ul>
  );
}

function CartaoTemplate({ template }: { template: Template }) {
  const [expandido, setExpandido] = useState(false);
  const variaveis = extrairPlaceholders(template.conteudo);
  const longo = template.conteudo.length > 220 || template.conteudo.split("\n").length > 6;

  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 break-all font-mono text-sm font-semibold text-ink">{template.nome}</h4>
        <StatusTemplate template={template} />
      </div>

      {situacaoDe(template) === "recusado" && (
        <p role="note" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <strong>{ROTULO_STATUS[template.status] ?? template.status} pela Meta.</strong>{" "}
          {template.motivoStatus ? `Motivo: ${traduzirMotivo(template.motivoStatus)}. ` : ""}
          Não aparece em Nova campanha. Para corrigir, crie um template novo com o texto ajustado.
        </p>
      )}
      {situacaoDe(template) === "analise" && (
        <p className="rounded-lg bg-status-agendado/10 px-3 py-2 text-xs text-ink-2">
          A Meta está analisando. O resultado aparece aqui sozinho quando chegar — costuma levar minutos, às vezes até 24h.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-3 rounded-lg bg-app-bg px-3 py-2.5">
        <Info rotulo="Categoria">{ROTULO_CATEGORIA[template.categoria]}</Info>
        <Info rotulo="Idioma">{template.idioma}</Info>
        <Info rotulo="Custo por msg">{formatarMoeda(template.precoUnitario)}</Info>
      </dl>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Mensagem</p>
        <div className="overflow-hidden rounded-2xl rounded-tl-sm bg-accent-soft/50 ring-1 ring-inset ring-card-border">
          {template.exigeImagem && <ImagemDoCabecalho template={template} />}
          <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
            {template.cabecalhoTexto && <p className="text-sm font-bold text-ink">{template.cabecalhoTexto}</p>}
            <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-ink ${expandido ? "" : "line-clamp-6"}`}>
              <TextoWhatsapp texto={template.conteudo} />
            </p>
            {template.rodape && <p className="text-xs text-ink-3">{template.rodape}</p>}
          </div>
        </div>
        {longo && (
          <button
            type="button"
            onClick={() => setExpandido((atual) => !atual)}
            className="mt-1.5 text-xs font-semibold text-accent-text hover:underline"
          >
            {expandido ? "Mostrar menos" : "Ver mensagem inteira"}
          </button>
        )}
      </div>

      <div className="mt-auto">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Variáveis</p>
        {variaveis.length === 0 ? (
          <p className="text-xs text-ink-3">Nenhuma — a mensagem sai igual para todos.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {variaveis.map((variavel) => (
              <li key={variavel} className="rounded-md bg-brand-2-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-brand-2-text">
                {`{{${variavel}}}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// Cabeçalho de imagem: mostra a imagem configurada e deixa escolher/trocar. Sem imagem, o template não envia.
function ImagemDoCabecalho({ template }: { template: Template }) {
  const utils = trpc.useUtils();
  const entrada = useRef<HTMLInputElement>(null);
  const definir = trpc.templates.definirImagem.useMutation({
    onSuccess: () => {
      toast.sucesso("Imagem do cabeçalho salva.");
      void utils.templates.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      const imagem = await lerImagemDeTemplate(arquivo);
      definir.mutate({ templateId: template.id, imagem: { base64: imagem.base64, mimeType: imagem.mimeType } });
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível usar essa imagem.");
    }
  }

  const seletor = (
    <input
      ref={entrada}
      type="file"
      accept="image/jpeg,image/png"
      className="sr-only"
      onChange={(evento) => {
        void aoEscolher(evento.target.files?.[0]);
        evento.target.value = "";
      }}
    />
  );

  if (!template.temImagem) {
    return (
      <div className="flex flex-col items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-4 text-center">
        {seletor}
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
          <Icone nome="alerta" tamanho={14} />
          Este template usa imagem no topo e ainda não tem uma. Sem ela, o envio falha.
        </p>
        <Button className="px-3 py-1.5 text-xs" disabled={definir.isPending} onClick={() => entrada.current?.click()}>
          {definir.isPending ? "Enviando…" : "Escolher imagem"}
        </Button>
      </div>
    );
  }

  return (
    <div className="group relative">
      {seletor}
      {template.imagemUrl ? (
        <img src={template.imagemUrl} alt="Imagem do cabeçalho" className="aspect-[1.91/1] w-full object-cover" />
      ) : (
        <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-accent-soft text-xs text-ink-3">
          Imagem configurada na Meta
        </div>
      )}
      <button
        type="button"
        disabled={definir.isPending}
        onClick={() => entrada.current?.click()}
        className="absolute right-2 top-2 rounded-md bg-surface/90 px-2 py-1 text-[11px] font-semibold text-ink shadow-sm hover:bg-surface"
      >
        {definir.isPending ? "Enviando…" : "Trocar imagem"}
      </button>
    </div>
  );
}

const ROTULO_STATUS: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  IN_APPEAL: "Em recurso",
  REJECTED: "Reprovado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  FLAGGED: "Sinalizado",
  PENDING_DELETION: "Sendo excluído",
};

// Motivos mais comuns que a Meta manda no webhook; o resto aparece como veio.
const MOTIVOS: Record<string, string> = {
  INVALID_FORMAT: "formato inválido",
  TAG_CONTENT_MISMATCH: "o conteúdo não combina com a categoria escolhida",
  INCORRECT_CATEGORY: "categoria incorreta",
  PROMOTIONAL: "conteúdo promocional em categoria que não é marketing",
  ABUSIVE_CONTENT: "conteúdo considerado abusivo",
  SCAM: "suspeita de golpe",
  LOW_QUALITY: "baixa qualidade (muitos clientes bloquearam ou denunciaram)",
};

function traduzirMotivo(motivo: string): string {
  return MOTIVOS[motivo] ?? motivo;
}

function StatusTemplate({ template }: { template: Template }) {
  const situacao = situacaoDe(template);
  const estilo = {
    aprovado: { caixa: "bg-success-soft text-success-text", ponto: "bg-success" },
    analise: { caixa: "bg-status-agendado/10 text-status-agendado", ponto: "bg-status-agendado animate-pulse" },
    recusado: { caixa: "bg-red-50 text-red-700", ponto: "bg-status-falhou" },
  }[situacao];

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${estilo.caixa}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${estilo.ponto}`} />
      {ROTULO_STATUS[template.status] ?? template.status}
    </span>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
