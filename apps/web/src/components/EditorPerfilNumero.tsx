import {
  CATEGORIAS_PERFIL,
  LIMITE_DESCRICAO_PERFIL,
  LIMITE_ENDERECO_PERFIL,
  LIMITE_RECADO_PERFIL,
  type CategoriaPerfil,
} from "@atendimento-academias/shared";
import { useRef, useState, type ReactNode } from "react";
import { mensagemDeErro } from "../lib/erro.js";
import { lerImagemDeTemplate, type ImagemLida } from "../lib/imagem.js";
import { trpc } from "../lib/trpc.js";
import { Button } from "./ui/Button.js";
import { Icone } from "./ui/Icone.js";
import { toast } from "./ui/Toast.js";

interface Numero {
  id: number;
  numeroExibicao: string;
  nomeVerificado: string | null;
}

// Perfil comercial do número: é o que o cliente vê ao abrir o contato no WhatsApp. Os dados vêm da
// Meta na hora (não ficam guardados aqui), então o formulário só aparece depois que eles chegam.
export function EditorPerfilNumero({ numero, onFechar }: { numero: Numero; onFechar: () => void }) {
  const perfil = trpc.configuracoes.perfilDoNumero.useQuery({ numeroId: numero.id }, { staleTime: 0, retry: false });

  if (perfil.isPending) return <p className="py-6 text-center text-sm text-ink-2">Buscando o perfil na Meta…</p>;
  if (!perfil.data) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-sm text-red-700">{perfil.error ? mensagemDeErro(perfil.error) : "Não foi possível carregar o perfil."}</p>
        <Button variante="secundario" className="px-3 py-1.5 text-xs" onClick={() => void perfil.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return <Formulario numero={numero} inicial={perfil.data} onFechar={onFechar} />;
}

type Perfil = {
  recado: string;
  descricao: string;
  endereco: string;
  email: string;
  sites: string[];
  categoria: string;
  fotoUrl: string | null;
};

function Formulario({ numero, inicial, onFechar }: { numero: Numero; inicial: Perfil; onFechar: () => void }) {
  const utils = trpc.useUtils();
  const entradaFoto = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<ImagemLida | null>(null);
  const [recado, setRecado] = useState(inicial.recado);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [endereco, setEndereco] = useState(inicial.endereco);
  const [email, setEmail] = useState(inicial.email);
  const [site1, setSite1] = useState(inicial.sites[0] ?? "");
  const [site2, setSite2] = useState(inicial.sites[1] ?? "");
  const [categoria, setCategoria] = useState<CategoriaPerfil>(
    inicial.categoria in CATEGORIAS_PERFIL ? (inicial.categoria as CategoriaPerfil) : "OTHER",
  );

  const salvar = trpc.configuracoes.salvarPerfilDoNumero.useMutation({
    onSuccess: () => {
      toast.sucesso(
        foto
          ? "Perfil atualizado na Meta. A foto nova pode levar alguns minutos para aparecer para os clientes."
          : "Perfil atualizado na Meta.",
      );
      setFoto(null);
      void utils.configuracoes.perfilDoNumero.invalidate({ numeroId: numero.id });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      setFoto(await lerImagemDeTemplate(arquivo));
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível usar essa imagem.");
    }
  }

  function enviar() {
    salvar.mutate({
      numeroId: numero.id,
      recado,
      descricao,
      endereco,
      email,
      sites: [site1, site2].map((site) => site.trim()).filter(Boolean),
      categoria,
      ...(foto ? { foto: { base64: foto.base64, mimeType: foto.mimeType } } : {}),
    });
  }

  const fotoAtual = foto?.previa ?? inicial.fotoUrl;
  const nome = numero.nomeVerificado ?? numero.numeroExibicao;

  return (
    <div className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex flex-col gap-4">
        <p role="note" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Icone nome="alerta" tamanho={14} className="mt-px" />
          <span>
            O perfil é do número, não da plataforma: muda para <strong>todos</strong> que conversam com ele no WhatsApp,
            inclusive por outros sistemas que usem o mesmo número.
          </span>
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <input
            ref={entradaFoto}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={(evento) => {
              void escolherFoto(evento.target.files?.[0]);
              evento.target.value = "";
            }}
          />
          <Avatar url={fotoAtual} nome={nome} tamanho="h-20 w-20" />
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <Button variante="secundario" className="px-3 py-1.5 text-xs" onClick={() => entradaFoto.current?.click()}>
                {fotoAtual ? "Trocar foto" : "Escolher foto"}
              </Button>
              {foto && (
                <Button variante="fantasma" className="px-3 py-1.5 text-xs" onClick={() => setFoto(null)}>
                  Desfazer
                </Button>
              )}
            </div>
            <p className="text-xs text-ink-3">JPG ou PNG, quadrada (ideal 640×640). O WhatsApp corta em círculo.</p>
          </div>
        </div>

        <Campo rotulo="Recado" ajuda="A frase curta que aparece embaixo do nome." contador={`${recado.length}/${LIMITE_RECADO_PERFIL}`}>
          <input
            value={recado}
            onChange={(evento) => setRecado(evento.target.value)}
            maxLength={LIMITE_RECADO_PERFIL}
            placeholder="ex.: O topo é seu! 💪"
            className="rounded-lg px-3 py-2 text-sm"
          />
        </Campo>

        <Campo rotulo="Descrição" contador={`${descricao.length}/${LIMITE_DESCRICAO_PERFIL}`}>
          <textarea
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            maxLength={LIMITE_DESCRICAO_PERFIL}
            rows={3}
            placeholder="ex.: Atendimento oficial da Allp Fit. Planos, matrículas e dúvidas."
            className="rounded-lg px-3 py-2 text-sm"
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Categoria">
            <select
              value={categoria}
              onChange={(evento) => setCategoria(evento.target.value as CategoriaPerfil)}
              className="rounded-lg px-3 py-2 text-sm"
            >
              {Object.entries(CATEGORIAS_PERFIL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="E-mail">
            <input
              type="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              maxLength={128}
              placeholder="contato@allpfit.com.br"
              className="rounded-lg px-3 py-2 text-sm"
            />
          </Campo>
        </div>

        <Campo rotulo="Endereço" contador={`${endereco.length}/${LIMITE_ENDERECO_PERFIL}`}>
          <input
            value={endereco}
            onChange={(evento) => setEndereco(evento.target.value)}
            maxLength={LIMITE_ENDERECO_PERFIL}
            className="rounded-lg px-3 py-2 text-sm"
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Site">
            <input value={site1} onChange={(evento) => setSite1(evento.target.value)} placeholder="https://allpfit.com.br" className="rounded-lg px-3 py-2 text-sm" />
          </Campo>
          <Campo rotulo="Outro site" ajuda="Opcional. A Meta aceita até 2.">
            <input value={site2} onChange={(evento) => setSite2(evento.target.value)} placeholder="https://" className="rounded-lg px-3 py-2 text-sm" />
          </Campo>
        </div>

        <p className="text-xs text-ink-3">
          O nome exibido (“{nome}”) não muda por aqui: a troca de nome passa por análise da Meta, no Gerenciador do
          WhatsApp.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando na Meta…" : "Salvar perfil"}
          </Button>
          <Button variante="fantasma" onClick={onFechar}>
            Fechar
          </Button>
        </div>
      </div>

      <PreviaPerfil
        fotoUrl={fotoAtual}
        nome={nome}
        numero={numero.numeroExibicao}
        recado={recado}
        descricao={descricao}
        categoria={CATEGORIAS_PERFIL[categoria]}
        endereco={endereco}
        email={email}
        sites={[site1, site2].filter((site) => site.trim())}
      />
    </div>
  );
}

function Avatar({ url, nome, tamanho }: { url: string | null; nome: string; tamanho: string }) {
  return url ? (
    <img src={url} alt="" className={`${tamanho} shrink-0 rounded-full object-cover ring-1 ring-card-border`} />
  ) : (
    <span className={`${tamanho} flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent-text`}>
      {nome.charAt(0).toUpperCase()}
    </span>
  );
}

// Imita a tela "dados do contato" do WhatsApp, para ver o resultado antes de salvar.
function PreviaPerfil(props: {
  fotoUrl: string | null;
  nome: string;
  numero: string;
  recado: string;
  descricao: string;
  categoria: string;
  endereco: string;
  email: string;
  sites: string[];
}) {
  const linhas: Array<[string, string]> = [
    ["Categoria", props.categoria],
    ...(props.endereco.trim() ? [["Endereço", props.endereco] as [string, string]] : []),
    ...(props.email.trim() ? [["E-mail", props.email] as [string, string]] : []),
    ...props.sites.map((site) => ["Site", site] as [string, string]),
  ];

  return (
    <figure className="self-start overflow-hidden rounded-2xl border border-card-border bg-surface">
      <figcaption className="border-b border-card-border px-4 py-2.5 text-xs font-semibold text-ink-2">Como o cliente vê</figcaption>
      <div className="flex flex-col items-center gap-1 px-4 pb-4 pt-5 text-center">
        <Avatar url={props.fotoUrl} nome={props.nome} tamanho="h-24 w-24" />
        <p className="mt-2 font-heading text-base font-bold text-ink">{props.nome}</p>
        <p className="text-xs text-ink-2">{props.numero}</p>
        <p className="mt-1 text-sm text-ink">{props.recado.trim() || <span className="text-ink-3">sem recado</span>}</p>
      </div>
      {(props.descricao.trim() || linhas.length > 0) && (
        <dl className="flex flex-col gap-2.5 border-t border-card-border px-4 py-3 text-left">
          {props.descricao.trim() && <p className="whitespace-pre-wrap text-sm text-ink">{props.descricao}</p>}
          {linhas.map(([rotulo, valor], indice) => (
            <div key={indice} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{rotulo}</dt>
              <dd className="break-words text-sm text-ink">{valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
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
