import {
  extrairPlaceholders,
  LIMITE_CABECALHO_TEMPLATE,
  LIMITE_CORPO_TEMPLATE,
  LIMITE_RODAPE_TEMPLATE,
  precoDaCategoria,
  problemasDoCorpo,
} from "@atendimento-academias/shared";
import { useRef, useState, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { TextoWhatsapp } from "../components/TextoWhatsapp.js";
import { Button } from "../components/ui/Button.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarMoeda } from "../lib/format.js";
import { lerImagemDeTemplate, type ImagemLida } from "../lib/imagem.js";
import { MODELOS_TEMPLATE, type ModeloTemplate } from "../lib/modelosTemplate.js";
import { hrefDe, navegar } from "../lib/route.js";
import { trpc } from "../lib/trpc.js";

type TipoCabecalho = "nenhum" | "texto" | "imagem";

interface Formulario {
  nome: string;
  categoria: "marketing" | "utilidade";
  idioma: string;
  tipoCabecalho: TipoCabecalho;
  textoCabecalho: string;
  imagem: ImagemLida | null;
  corpo: string;
  exemplos: Record<string, string>;
  rodape: string;
}

const VAZIO: Formulario = {
  nome: "",
  categoria: "marketing",
  idioma: "pt_BR",
  tipoCabecalho: "nenhum",
  textoCabecalho: "",
  imagem: null,
  corpo: "",
  exemplos: {},
  rodape: "",
};

const IDIOMAS = [
  { valor: "pt_BR", rotulo: "Português (Brasil)" },
  { valor: "en_US", rotulo: "Inglês (EUA)" },
  { valor: "es", rotulo: "Espanhol" },
];

// A Meta só aceita minúsculas sem acento, números e _ no nome.
function normalizarNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function doModelo(modelo: ModeloTemplate): Formulario {
  return {
    ...VAZIO,
    nome: modelo.nomeSugerido,
    categoria: modelo.categoria,
    tipoCabecalho: modelo.cabecalho.tipo,
    textoCabecalho: modelo.cabecalho.tipo === "texto" ? modelo.cabecalho.texto : "",
    corpo: modelo.corpo,
    exemplos: { ...modelo.exemplos },
    rodape: modelo.rodape,
  };
}

export function NovoTemplate({ contaId }: { contaId: number }) {
  const utils = trpc.useUtils();
  const contas = trpc.templates.porConta.useQuery();
  const [modeloEscolhido, setModeloEscolhido] = useState<string>("branco");
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [tentouEnviar, setTentouEnviar] = useState(false);

  const criar = trpc.templates.criar.useMutation({
    onSuccess: (resultado) => {
      toast.sucesso(
        resultado.status === "APPROVED"
          ? "Template aprovado pela Meta! Já dá para usar em Nova campanha."
          : "Template enviado para a Meta. Ele aparece como “Em análise” até a resposta chegar.",
      );
      void utils.templates.invalidate();
      navegar({ tela: "templates", criarNaConta: null });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const conta = contas.data?.contas.find((item) => item.id === contaId);
  const mudar = (parcial: Partial<Formulario>) => setForm((atual) => ({ ...atual, ...parcial }));

  function escolherModelo(id: string) {
    setModeloEscolhido(id);
    const modelo = MODELOS_TEMPLATE.find((item) => item.id === id);
    setForm(modelo ? doModelo(modelo) : VAZIO);
    setTentouEnviar(false);
  }

  const variaveis = extrairPlaceholders(form.corpo);
  const problemas = form.corpo.trim() ? problemasDoCorpo(form.corpo, form.exemplos) : [];
  const faltando: string[] = [];
  if (!form.nome) faltando.push("Dê um nome ao template.");
  if (!form.corpo.trim()) faltando.push("Escreva a mensagem.");
  if (form.tipoCabecalho === "texto" && !form.textoCabecalho.trim()) faltando.push("Escreva o texto do cabeçalho ou escolha “Nenhum”.");
  if (form.tipoCabecalho === "imagem" && !form.imagem) faltando.push("Escolha a imagem do cabeçalho ou escolha “Nenhum”.");
  const pendencias = [...faltando, ...problemas];

  function enviar() {
    setTentouEnviar(true);
    if (pendencias.length > 0) return;

    criar.mutate({
      contaId,
      nome: form.nome,
      categoria: form.categoria,
      idioma: form.idioma,
      cabecalho:
        form.tipoCabecalho === "texto"
          ? { tipo: "texto", texto: form.textoCabecalho }
          : form.tipoCabecalho === "imagem" && form.imagem
            ? { tipo: "imagem", imagem: { base64: form.imagem.base64, mimeType: form.imagem.mimeType } }
            : { tipo: "nenhum" },
      corpo: form.corpo,
      exemplos: Object.fromEntries(variaveis.map((variavel) => [variavel, form.exemplos[variavel] ?? ""])),
      rodape: form.rodape.trim() || undefined,
    });
  }

  if (contas.isPending) return <p className="text-sm text-ink-2">Carregando…</p>;
  if (!conta) {
    return (
      <Card>
        <p className="text-sm text-ink-2">
          Conta não encontrada.{" "}
          <a href={hrefDe({ tela: "templates", criarNaConta: null })} className="font-medium text-accent-text hover:underline">
            Voltar para Templates
          </a>
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={hrefDe({ tela: "templates", criarNaConta: null })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <Icone nome="recolher" tamanho={15} />
          Voltar para Templates
        </a>
        <p className="text-sm text-ink-2">
          Conta <strong className="text-ink">{conta.nome}</strong>
        </p>
      </div>

      <EscolhaDeModelo escolhido={modeloEscolhido} onEscolher={escolherModelo} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Secao numero={1} titulo="Identificação">
            <Campo rotulo="Nome do template" ajuda="Só letras minúsculas sem acento, números e _. É por ele que a Meta identifica o template.">
              <input
                value={form.nome}
                onChange={(evento) => mudar({ nome: normalizarNome(evento.target.value) })}
                placeholder="ex.: promocao_setembro"
                maxLength={512}
                className="rounded-lg px-3 py-2 font-mono text-sm"
              />
            </Campo>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Categoria</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <OpcaoCategoria
                  ativa={form.categoria === "marketing"}
                  onEscolher={() => mudar({ categoria: "marketing" })}
                  titulo="Marketing"
                  descricao="Promoções, novidades, convites e reengajamento."
                  preco={precoDaCategoria("marketing")}
                />
                <OpcaoCategoria
                  ativa={form.categoria === "utilidade"}
                  onEscolher={() => mudar({ categoria: "utilidade" })}
                  titulo="Utilidade"
                  descricao="Avisos sobre algo que o cliente já contratou: cobrança, confirmação, lembrete."
                  preco={precoDaCategoria("utilidade")}
                />
              </div>
              <p className="mt-1.5 text-xs text-ink-3">
                A Meta confere a categoria: se ela entender que é marketing, reclassifica — e o custo muda.
              </p>
            </fieldset>

            <Campo rotulo="Idioma">
              <select
                value={form.idioma}
                onChange={(evento) => mudar({ idioma: evento.target.value })}
                className="rounded-lg px-3 py-2 text-sm"
              >
                {IDIOMAS.map((idioma) => (
                  <option key={idioma.valor} value={idioma.valor}>
                    {idioma.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
          </Secao>

          <Secao numero={2} titulo="Cabeçalho" opcional>
            <div role="radiogroup" aria-label="Tipo de cabeçalho" className="flex w-fit rounded-lg border border-card-border bg-app-bg p-0.5">
              {(
                [
                  ["nenhum", "Nenhum"],
                  ["texto", "Texto"],
                  ["imagem", "Imagem"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={form.tipoCabecalho === valor}
                  onClick={() => mudar({ tipoCabecalho: valor })}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    form.tipoCabecalho === valor ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>

            {form.tipoCabecalho === "texto" && (
              <Campo rotulo="Texto do cabeçalho" contador={`${form.textoCabecalho.length}/${LIMITE_CABECALHO_TEMPLATE}`}>
                <input
                  value={form.textoCabecalho}
                  onChange={(evento) => mudar({ textoCabecalho: evento.target.value })}
                  maxLength={LIMITE_CABECALHO_TEMPLATE}
                  placeholder="ex.: Oferta especial para você"
                  className="rounded-lg px-3 py-2 text-sm"
                />
              </Campo>
            )}

            {form.tipoCabecalho === "imagem" && (
              <SeletorImagem imagem={form.imagem} onEscolher={(imagem) => mudar({ imagem })} />
            )}
          </Secao>

          <Secao numero={3} titulo="Mensagem">
            <EditorCorpo corpo={form.corpo} onMudar={(corpo) => mudar({ corpo })} />

            {variaveis.length > 0 && (
              <div className="rounded-lg border border-card-border bg-app-bg p-3">
                <p className="text-sm font-medium">Exemplos das variáveis</p>
                <p className="mb-3 text-xs text-ink-2">
                  A Meta pede um exemplo de cada variável para analisar o template. Não é o que o cliente recebe: o valor
                  real é definido em cada campanha.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {variaveis.map((variavel) => (
                    <label key={variavel} className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                      <span className="font-mono text-brand-2-text">{`{{${variavel}}}`}</span>
                      <input
                        value={form.exemplos[variavel] ?? ""}
                        onChange={(evento) => mudar({ exemplos: { ...form.exemplos, [variavel]: evento.target.value } })}
                        placeholder="ex.: Maria"
                        className="rounded-lg px-3 py-2 text-sm text-ink"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {problemas.length > 0 && (
              <ul role="note" className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {problemas.map((problema) => (
                  <li key={problema} className="flex gap-1.5">
                    <Icone nome="alerta" tamanho={13} className="mt-px" />
                    {problema}
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao numero={4} titulo="Rodapé" opcional>
            <Campo rotulo="Texto do rodapé" contador={`${form.rodape.length}/${LIMITE_RODAPE_TEMPLATE}`} ajuda="Aparece pequeno e cinza no fim da mensagem. Sem variáveis.">
              <input
                value={form.rodape}
                onChange={(evento) => mudar({ rodape: evento.target.value })}
                maxLength={LIMITE_RODAPE_TEMPLATE}
                placeholder="ex.: Responda SAIR para não receber mensagens"
                className="rounded-lg px-3 py-2 text-sm"
              />
            </Campo>
          </Secao>

          <Card className="flex flex-col gap-3">
            {tentouEnviar && pendencias.length > 0 && (
              <ul role="alert" className="flex flex-col gap-1 text-sm text-red-700">
                {pendencias.map((pendencia) => (
                  <li key={pendencia}>• {pendencia}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-xs text-ink-2">
                A Meta costuma responder em minutos, mas pode levar até 24 horas. O resultado aparece sozinho na tela
                Templates.
              </p>
              <Button onClick={enviar} disabled={criar.isPending}>
                <Icone nome="enviar" tamanho={15} />
                {criar.isPending ? "Enviando para a Meta…" : "Enviar para aprovação"}
              </Button>
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6">
          <PreviaWhatsapp form={form} />
        </div>
      </div>
    </div>
  );
}

function EscolhaDeModelo({ escolhido, onEscolher }: { escolhido: string; onEscolher: (id: string) => void }) {
  return (
    <section>
      <h3 className="font-heading text-base font-bold">Comece por um modelo</h3>
      <p className="mb-3 text-sm text-ink-2">Escolha um ponto de partida e ajuste o texto e a imagem como quiser.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <li>
          <CartaoModelo ativo={escolhido === "branco"} onEscolher={() => onEscolher("branco")} titulo="Em branco" descricao="Escrever do zero." />
        </li>
        {MODELOS_TEMPLATE.map((modelo) => (
          <li key={modelo.id}>
            <CartaoModelo
              ativo={escolhido === modelo.id}
              onEscolher={() => onEscolher(modelo.id)}
              titulo={modelo.titulo}
              descricao={modelo.descricao}
              etiqueta={modelo.categoria === "marketing" ? "Marketing" : "Utilidade"}
              comImagem={modelo.cabecalho.tipo === "imagem"}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CartaoModelo({
  ativo,
  onEscolher,
  titulo,
  descricao,
  etiqueta,
  comImagem,
}: {
  ativo: boolean;
  onEscolher: () => void;
  titulo: string;
  descricao: string;
  etiqueta?: string;
  comImagem?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onEscolher}
      className={`flex h-full w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        ativo ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-card-border bg-surface hover:border-baseline"
      }`}
    >
      <span className="text-sm font-semibold text-ink">{titulo}</span>
      <span className="text-xs leading-snug text-ink-2">{descricao}</span>
      {etiqueta && (
        <span className="mt-auto pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          {etiqueta}
          {comImagem ? " · com imagem" : ""}
        </span>
      )}
    </button>
  );
}

function Secao({ numero, titulo, opcional, children }: { numero: number; titulo: string; opcional?: boolean; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="flex items-center gap-2.5 font-heading text-base font-bold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-text">
          {numero}
        </span>
        {titulo}
        {opcional && <span className="text-xs font-normal text-ink-3">opcional</span>}
      </h3>
      {children}
    </Card>
  );
}

function Campo({ rotulo, ajuda, contador, children }: { rotulo: string; ajuda?: string; contador?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      <span className="flex items-baseline justify-between gap-2">
        {rotulo}
        {contador && <span className="text-xs font-normal text-ink-3">{contador}</span>}
      </span>
      {children}
      {ajuda && <span className="text-xs font-normal text-ink-2">{ajuda}</span>}
    </label>
  );
}

function OpcaoCategoria({
  ativa,
  onEscolher,
  titulo,
  descricao,
  preco,
}: {
  ativa: boolean;
  onEscolher: () => void;
  titulo: string;
  descricao: string;
  preco: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onEscolher}
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        ativa ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-card-border bg-surface hover:border-baseline"
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{titulo}</span>
        <span className="text-xs text-ink-2">{formatarMoeda(preco)}/msg</span>
      </span>
      <span className="text-xs leading-snug text-ink-2">{descricao}</span>
    </button>
  );
}

function SeletorImagem({ imagem, onEscolher }: { imagem: ImagemLida | null; onEscolher: (imagem: ImagemLida | null) => void }) {
  const entrada = useRef<HTMLInputElement>(null);

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      onEscolher(await lerImagemDeTemplate(arquivo));
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível usar essa imagem.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
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
      {imagem ? (
        <div className="flex flex-wrap items-center gap-4">
          <img src={imagem.previa} alt="Imagem do cabeçalho" className="h-24 w-40 rounded-lg object-cover ring-1 ring-card-border" />
          <div className="flex gap-2">
            <Button variante="secundario" className="px-3 py-1.5 text-xs" onClick={() => entrada.current?.click()}>
              Trocar imagem
            </Button>
            <Button variante="fantasma" className="px-3 py-1.5 text-xs" onClick={() => onEscolher(null)}>
              Remover
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-card-border px-4 py-6 text-center transition-colors hover:border-accent hover:bg-accent-soft/30"
        >
          <Icone nome="mais" tamanho={20} className="text-accent-text" />
          <span className="text-sm font-semibold text-ink">Escolher imagem</span>
          <span className="text-xs text-ink-2">JPG ou PNG, até 5 MB. Formato horizontal (1,91:1) fica melhor.</span>
        </button>
      )}
      <p className="text-xs text-ink-3">
        A mesma imagem vai para a análise da Meta e é usada em todos os envios deste template.
      </p>
    </div>
  );
}

function EditorCorpo({ corpo, onMudar }: { corpo: string; onMudar: (corpo: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [novaVariavel, setNovaVariavel] = useState("");

  // Insere no cursor (ou em volta da seleção) e devolve o foco para continuar digitando.
  function inserir(antes: string, depois = "") {
    const campo = area.current;
    const inicio = campo?.selectionStart ?? corpo.length;
    const fim = campo?.selectionEnd ?? corpo.length;
    const texto = corpo.slice(0, inicio) + antes + corpo.slice(inicio, fim) + depois + corpo.slice(fim);
    onMudar(texto.slice(0, LIMITE_CORPO_TEMPLATE));
    requestAnimationFrame(() => {
      campo?.focus();
      const cursor = fim + antes.length + depois.length;
      campo?.setSelectionRange(cursor, cursor);
    });
  }

  function inserirVariavel(nome: string) {
    const limpo = normalizarNome(nome);
    if (!limpo) return;
    inserir(`{{${limpo}}}`);
    setNovaVariavel("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 border-card-border bg-app-bg px-2 py-1.5">
        <button
          type="button"
          onClick={() => inserir("*", "*")}
          title="Negrito (selecione o texto antes)"
          className="rounded px-2 py-1 text-sm font-bold text-ink-2 hover:bg-surface hover:text-ink"
        >
          N
        </button>
        <button
          type="button"
          onClick={() => inserir("_", "_")}
          title="Itálico (selecione o texto antes)"
          className="rounded px-2 py-1 text-sm italic text-ink-2 hover:bg-surface hover:text-ink"
        >
          I
        </button>
        <span aria-hidden="true" className="h-5 w-px bg-card-border" />
        <span className="text-xs font-medium text-ink-2">Inserir variável:</span>
        <button
          type="button"
          onClick={() => inserirVariavel("nome")}
          className="rounded-md bg-brand-2-soft px-2 py-0.5 font-mono text-xs font-semibold text-brand-2-text hover:opacity-80"
        >
          {"{{nome}}"}
        </button>
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            inserirVariavel(novaVariavel);
          }}
          className="flex items-center gap-1"
        >
          <input
            value={novaVariavel}
            onChange={(evento) => setNovaVariavel(evento.target.value)}
            placeholder="outra, ex.: valor"
            aria-label="Nome da nova variável"
            className="w-32 rounded-md px-2 py-0.5 text-xs"
          />
          <button type="submit" className="rounded-md px-2 py-0.5 text-xs font-semibold text-accent-text hover:bg-surface">
            + Inserir
          </button>
        </form>
      </div>
      <textarea
        ref={area}
        value={corpo}
        onChange={(evento) => onMudar(evento.target.value)}
        maxLength={LIMITE_CORPO_TEMPLATE}
        rows={8}
        placeholder="Olá, {{nome}}! ..."
        className="-mt-2 rounded-b-lg rounded-t-none px-3 py-2 text-sm leading-relaxed"
      />
      <p className="flex justify-between gap-2 text-xs text-ink-3">
        <span>Use *asteriscos* para negrito e _sublinhados_ para itálico, como no WhatsApp.</span>
        <span>
          {corpo.length}/{LIMITE_CORPO_TEMPLATE}
        </span>
      </p>
    </div>
  );
}

function PreviaWhatsapp({ form }: { form: Formulario }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-card-border bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-card-border px-4 py-3 text-sm font-semibold">
        <Icone nome="mensagem" tamanho={16} className="text-accent-text" />
        Como o cliente vai ver
      </figcaption>
      <div className="bg-app-bg px-3 py-5">
        <div className="max-w-[19rem] overflow-hidden rounded-2xl rounded-tl-sm bg-surface shadow-sm ring-1 ring-card-border">
          {form.tipoCabecalho === "imagem" &&
            (form.imagem ? (
              <img src={form.imagem.previa} alt="" className="aspect-[1.91/1] w-full object-cover" />
            ) : (
              <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-accent-soft/50 text-xs text-ink-3">
                Imagem do cabeçalho
              </div>
            ))}
          <div className="flex flex-col gap-1.5 px-3 py-2.5">
            {form.tipoCabecalho === "texto" && form.textoCabecalho.trim() && (
              <p className="text-sm font-bold text-ink">{form.textoCabecalho}</p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
              {form.corpo.trim() ? (
                <TextoWhatsapp texto={form.corpo} exemplos={form.exemplos} />
              ) : (
                <span className="text-ink-3">A mensagem aparece aqui enquanto você escreve.</span>
              )}
            </p>
            {form.rodape.trim() && <p className="text-xs text-ink-3">{form.rodape}</p>}
            <p className="text-right text-[10px] text-ink-3">12:00</p>
          </div>
        </div>
      </div>
      <p className="border-t border-card-border px-4 py-2.5 text-xs text-ink-2">
        As partes em laranja mudam para cada cliente. Aqui aparecem os exemplos.
      </p>
    </figure>
  );
}
