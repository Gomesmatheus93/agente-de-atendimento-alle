import {
  CORES_ETIQUETA,
  ETAPAS_FUNIL,
  MAX_CONTATOS_POR_IMPORTACAO,
  ROTULO_ETAPA_FUNIL,
  ROTULO_SITUACAO_CONVERSA,
  SITUACOES_CONVERSA,
  normalizarTelefone,
  type CorEtiqueta,
  type FiltroContatos,
} from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { ChipEtiqueta, ListaDeEtiquetas, MenuEtiquetas, ROTULO_COR, estiloDaCor, useEtiquetas, type Etiqueta } from "../components/Etiquetas.js";
import { BotaoExportar } from "../components/Exportar.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, EstadoVazio, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarNumero, formatarTelefone, tempoRelativo } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { iniciarCampanhaComContatos } from "./NovaCampanha/NovaCampanha.js";

type Contato = SaidaApi["contatos"]["listar"]["itens"][number];
type Aba = "contatos" | "segmentos" | "etiquetas";

const FILTRO_VAZIO: FiltroContatos = { busca: "", etiquetas: [], semEtiquetas: [], conversa: "qualquer", dias: 30, etapasFunil: [] };

function filtroAtivo(filtro: FiltroContatos): boolean {
  return Boolean(filtro.busca?.trim()) || filtro.etiquetas.length > 0 || filtro.semEtiquetas.length > 0 || filtro.conversa !== "qualquer" || filtro.etapasFunil.length > 0;
}

export function Contatos() {
  const [aba, setAba] = useState<Aba>("contatos");
  const [filtro, setFiltro] = useState<FiltroContatos>(FILTRO_VAZIO);

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Base de contatos" className="flex self-start rounded-full bg-surface p-1 shadow-card">
        {(
          [
            ["contatos", "Contatos"],
            ["segmentos", "Segmentos"],
            ["etiquetas", "Etiquetas"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={aba === valor}
            onClick={() => setAba(valor)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${aba === valor ? "bg-accent text-accent-contrast" : "text-ink-2 hover:text-ink"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "contatos" && <AbaContatos filtro={filtro} onFiltro={setFiltro} />}
      {aba === "segmentos" && (
        <AbaSegmentos
          onVerContatos={(f) => {
            setFiltro(f);
            setAba("contatos");
          }}
        />
      )}
      {aba === "etiquetas" && <AbaEtiquetas />}
    </div>
  );
}

// ---------- Contatos ----------

function AbaContatos({ filtro, onFiltro }: { filtro: FiltroContatos; onFiltro: (f: FiltroContatos) => void }) {
  const utils = trpc.useUtils();
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [editando, setEditando] = useState<Contato | "novo" | null>(null);
  const [importando, setImportando] = useState(false);
  const [salvandoSegmento, setSalvandoSegmento] = useState(false);
  const [criandoCampanha, setCriandoCampanha] = useState(false);
  const [busca, setBusca] = useState(filtro.busca ?? "");
  const etiquetas = useEtiquetas().data ?? [];
  const porId = useMemo(() => new Map(etiquetas.map((e) => [e.id, e])), [etiquetas]);

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const espera = window.setTimeout(() => {
      if ((filtro.busca ?? "") !== busca) onFiltro({ ...filtro, busca });
    }, 300);
    return () => window.clearTimeout(espera);
  }, [busca, filtro, onFiltro]);

  useEffect(() => {
    setPagina(0);
    setSelecionados(new Set());
  }, [filtro]);

  const lista = trpc.contatos.listar.useQuery({ filtro, pagina }, { placeholderData: keepPreviousData });
  const exportarContatos = trpc.exportacoes.contatos.useMutation();
  const dados = lista.data;

  const invalidar = () => {
    void utils.contatos.invalidate();
    setSelecionados(new Set());
  };
  const etiquetar = trpc.contatos.etiquetar.useMutation({
    onSuccess: (r, v) => {
      toast.sucesso(`${formatarNumero(r.alterados)} contato(s) ${v.acao === "adicionar" ? "etiquetados" : "sem a etiqueta"}.`);
      invalidar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const excluir = trpc.contatos.excluir.useMutation({
    onSuccess: (r) => {
      toast.sucesso(`${formatarNumero(r.excluidos)} contato(s) excluídos.`);
      invalidar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  async function criarCampanha() {
    setCriandoCampanha(true);
    try {
      const resultado = await utils.contatos.paraCampanha.fetch(filtro);
      if (resultado.contatos.length === 0) {
        toast.erro("Nenhum contato desse filtro pode receber campanhas.");
        return;
      }
      if (resultado.passouDoLimite) toast.erro("O filtro passa de 1.000 contatos; a campanha começa com os primeiros 1.000.");
      iniciarCampanhaComContatos(resultado.contatos, "");
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível montar a campanha.");
    } finally {
      setCriandoCampanha(false);
    }
  }

  const ids = dados?.itens.map((c) => c.id) ?? [];
  const todosDaPagina = ids.length > 0 && ids.every((id) => selecionados.has(id));
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Icone nome="busca" tamanho={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar contato"
              className="h-10 w-full !rounded-full pl-10 pr-4 text-sm"
            />
          </div>
          <Button variante="secundario" onClick={() => setImportando(true)}>
            <Icone nome="upload" tamanho={15} />
            Importar planilha
          </Button>
          <BotaoExportar arquivo="contatos" gerar={() => exportarContatos.mutateAsync(filtro)} />
          <Button onClick={() => setEditando("novo")}>
            <Icone nome="mais" tamanho={15} />
            Novo contato
          </Button>
        </div>
        <BarraDeFiltros filtro={filtro} etiquetas={etiquetas} onFiltro={onFiltro} />
      </Card>

      {dados && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-sm text-ink-2">
            <strong className="font-semibold text-ink">{formatarNumero(dados.total)}</strong> contato(s)
            {dados.descadastrados > 0 && ` · ${formatarNumero(dados.descadastrados)} não recebem campanhas`}
          </p>
          <div className="flex flex-wrap gap-2">
            {filtroAtivo(filtro) && (
              <Button variante="secundario" onClick={() => setSalvandoSegmento(true)}>
                Salvar como segmento
              </Button>
            )}
            <Button variante="secundario" disabled={dados.alcancaveis === 0 || criandoCampanha} onClick={() => void criarCampanha()}>
              <Icone nome="enviar" tamanho={15} />
              {criandoCampanha ? "Montando…" : `Campanha para ${formatarNumero(Math.min(dados.alcancaveis, 1000))}`}
            </Button>
          </div>
        </div>
      )}

      {selecionados.size > 0 && (
        <div role="toolbar" aria-label="Ações nos contatos selecionados" className="flex flex-wrap items-center gap-2 rounded-2xl bg-accent-soft px-4 py-2.5">
          <span className="text-sm font-semibold text-accent-text">{formatarNumero(selecionados.size)} selecionado(s)</span>
          <MenuEtiquetas
            rotulo={
              <>
                <Icone nome="etiqueta" tamanho={14} /> Pôr etiqueta
              </>
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-semibold text-ink hover:text-accent-text"
            conteudo={(fechar) => (
              <ListaDeEtiquetas
                marcadas={[]}
                onAlternar={(etiquetaId) => {
                  etiquetar.mutate({ ids: [...selecionados], etiquetaId, acao: "adicionar" });
                  fechar();
                }}
              />
            )}
          />
          <MenuEtiquetas
            rotulo="Tirar etiqueta"
            className="inline-flex h-8 items-center rounded-full bg-surface px-3 text-xs font-semibold text-ink hover:text-accent-text"
            conteudo={(fechar) => (
              <ListaDeEtiquetas
                marcadas={[]}
                permitirCriar={false}
                onAlternar={(etiquetaId) => {
                  etiquetar.mutate({ ids: [...selecionados], etiquetaId, acao: "remover" });
                  fechar();
                }}
              />
            )}
          />
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Excluir ${selecionados.size} contato(s) da base? As conversas continuam no painel.`)) excluir.mutate({ ids: [...selecionados] });
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-semibold text-red-700"
          >
            <Icone nome="lixeira" tamanho={13} /> Excluir
          </button>
          <button type="button" onClick={() => setSelecionados(new Set())} className="ml-auto text-xs font-semibold text-accent-text hover:underline">
            Limpar seleção
          </button>
        </div>
      )}

      {lista.isError && !dados && <EstadoErro mensagem={lista.error.message} onTentarNovamente={() => void lista.refetch()} />}
      {!dados && lista.isPending && <Esqueleto className="h-80" />}

      {dados && dados.itens.length === 0 && (
        <EstadoVazio
          titulo={filtroAtivo(filtro) ? "Nenhum contato com esse filtro" : "A base ainda está vazia"}
          descricao={
            filtroAtivo(filtro)
              ? "Mude os filtros para ver mais contatos."
              : "Importe a planilha de alunos e leads, ou espere: quem escreve no WhatsApp entra aqui sozinho."
          }
          acao={
            filtroAtivo(filtro) ? (
              <Button variante="secundario" onClick={() => onFiltro(FILTRO_VAZIO)}>
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => setImportando(true)}>Importar planilha</Button>
            )
          }
        />
      )}

      {dados && dados.itens.length > 0 && (
        <Card className="overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-card-border">
                <th className="w-10 py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Selecionar os contatos desta página"
                    checked={todosDaPagina}
                    onChange={() =>
                      setSelecionados((atual) => {
                        const novo = new Set(atual);
                        for (const id of ids) {
                          if (todosDaPagina) novo.delete(id);
                          else novo.add(id);
                        }
                        return novo;
                      })
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                </th>
                <th className="px-3 py-3 font-medium">Contato</th>
                <th className="px-3 py-3 font-medium">Etiquetas</th>
                <th className="px-3 py-3 font-medium">Última mensagem</th>
                <th className="py-3 pl-3 pr-5 text-right font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((contato) => (
                <tr key={contato.id} className="border-b border-card-border last:border-0 hover:bg-surface-2/60">
                  <td className="py-3 pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${contato.nome ?? formatarTelefone(contato.telefone)}`}
                      checked={selecionados.has(contato.id)}
                      onChange={() =>
                        setSelecionados((atual) => {
                          const novo = new Set(atual);
                          if (novo.has(contato.id)) novo.delete(contato.id);
                          else novo.add(contato.id);
                          return novo;
                        })
                      }
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setEditando(contato)} className="text-left">
                      <span className="block font-semibold text-ink hover:text-accent-text">{contato.nome ?? "Sem nome"}</span>
                      <span className="block text-xs text-ink-3">
                        {formatarTelefone(contato.telefone)}
                        {contato.descadastrado && <span className="ml-1.5 font-semibold text-red-700">· não recebe campanhas</span>}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {contato.etiquetaIds.map((id) => {
                        const etiqueta = porId.get(id);
                        return etiqueta ? <ChipEtiqueta key={id} etiqueta={etiqueta} /> : null;
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{contato.ultimaMensagemEm ? tempoRelativo(contato.ultimaMensagemEm) : <span className="text-ink-3">nunca escreveu</span>}</td>
                  <td className="py-3 pl-3 pr-5 text-right">
                    {contato.numeroId !== null && (
                      <a
                        href={hrefDe({ tela: "conversas", telefone: contato.telefone, numeroId: contato.numeroId })}
                        aria-label={`Abrir conversa com ${contato.nome ?? formatarTelefone(contato.telefone)}`}
                        title="Abrir conversa"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-2 hover:bg-accent-soft hover:text-accent-text"
                      >
                        <Icone nome="mensagem" tamanho={15} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-card-border px-5 py-3 text-sm">
              <span className="text-ink-2">
                Página {pagina + 1} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <Button variante="fantasma" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variante="fantasma" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {editando && <ModalContato contato={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />}
      {importando && <ModalImportar onFechar={() => setImportando(false)} />}
      {salvandoSegmento && <ModalSegmento filtro={filtro} onFechar={() => setSalvandoSegmento(false)} />}
    </div>
  );
}

function Seletor({ rotulo, ativo, children }: { rotulo: ReactNode; ativo: boolean; children: (fechar: () => void) => ReactNode }) {
  return (
    <MenuEtiquetas
      rotulo={
        <>
          {rotulo}
          <span aria-hidden="true" className="text-[10px]">
            ▾
          </span>
        </>
      }
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors ${
        ativo ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-ink-2 hover:text-ink"
      }`}
      conteudo={children}
    />
  );
}

function BarraDeFiltros({ filtro, etiquetas, onFiltro }: { filtro: FiltroContatos; etiquetas: Etiqueta[]; onFiltro: (f: FiltroContatos) => void }) {
  const alternar = (lista: number[], id: number) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  const nomes = (ids: number[]) => etiquetas.filter((e) => ids.includes(e.id)).map((e) => e.nome).join(", ");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seletor rotulo={filtro.etiquetas.length ? `Com: ${nomes(filtro.etiquetas)}` : "Com etiqueta"} ativo={filtro.etiquetas.length > 0}>
        {() => <ListaDeEtiquetas permitirCriar={false} marcadas={filtro.etiquetas} onAlternar={(id) => onFiltro({ ...filtro, etiquetas: alternar(filtro.etiquetas, id) })} />}
      </Seletor>
      <Seletor rotulo={filtro.semEtiquetas.length ? `Sem: ${nomes(filtro.semEtiquetas)}` : "Sem etiqueta"} ativo={filtro.semEtiquetas.length > 0}>
        {() => (
          <ListaDeEtiquetas permitirCriar={false} marcadas={filtro.semEtiquetas} onAlternar={(id) => onFiltro({ ...filtro, semEtiquetas: alternar(filtro.semEtiquetas, id) })} />
        )}
      </Seletor>
      <Seletor
        rotulo={filtro.conversa === "qualquer" ? "Conversa" : filtro.conversa === "nunca_escreveu" ? "Nunca escreveu" : `${filtro.conversa === "escreveu" ? "Escreveu" : "Sem escrever"} · ${filtro.dias} dias`}
        ativo={filtro.conversa !== "qualquer"}
      >
        {() => (
          <div className="flex flex-col gap-1">
            {SITUACOES_CONVERSA.map((situacao) => (
              <label key={situacao} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <input type="radio" name="conversa" checked={filtro.conversa === situacao} onChange={() => onFiltro({ ...filtro, conversa: situacao })} className="accent-[var(--color-accent)]" />
                {ROTULO_SITUACAO_CONVERSA[situacao]}
              </label>
            ))}
            {(filtro.conversa === "escreveu" || filtro.conversa === "nao_escreveu") && (
              <label className="mt-1 flex items-center gap-2 border-t border-card-border px-2 pt-2 text-sm">
                Dias
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={filtro.dias}
                  onChange={(evento) => onFiltro({ ...filtro, dias: Math.min(3650, Math.max(1, Number(evento.target.value) || 1)) })}
                  className="w-20 rounded-lg px-2 py-1 text-sm"
                />
              </label>
            )}
          </div>
        )}
      </Seletor>
      <Seletor rotulo={filtro.etapasFunil.length ? `Funil: ${filtro.etapasFunil.map((e) => ROTULO_ETAPA_FUNIL[e]).join(", ")}` : "Etapa do funil"} ativo={filtro.etapasFunil.length > 0}>
        {() => (
          <div className="flex flex-col gap-0.5">
            {ETAPAS_FUNIL.map((etapa) => (
              <label key={etapa} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={filtro.etapasFunil.includes(etapa)}
                  onChange={() =>
                    onFiltro({ ...filtro, etapasFunil: filtro.etapasFunil.includes(etapa) ? filtro.etapasFunil.filter((x) => x !== etapa) : [...filtro.etapasFunil, etapa] })
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {ROTULO_ETAPA_FUNIL[etapa]}
              </label>
            ))}
          </div>
        )}
      </Seletor>
      {filtroAtivo(filtro) && (
        <button type="button" onClick={() => onFiltro(FILTRO_VAZIO)} className="text-xs font-semibold text-accent-text hover:underline">
          Limpar filtros
        </button>
      )}
    </div>
  );
}

function Modal({ titulo, children, onFechar, largo = false }: { titulo: string; children: ReactNode; onFechar: () => void; largo?: boolean }) {
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => evento.key === "Escape" && onFechar();
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-3xl bg-surface p-5 shadow-pop ${largo ? "max-w-2xl" : "max-w-md"}`}>
        <h3 className="font-heading text-base font-bold">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalContato({ contato, onFechar }: { contato: Contato | null; onFechar: () => void }) {
  const utils = trpc.useUtils();
  const [nome, setNome] = useState(contato?.nome ?? "");
  const [telefone, setTelefone] = useState(contato ? formatarTelefone(contato.telefone) : "");
  const [email, setEmail] = useState(contato?.email ?? "");
  const [nascimento, setNascimento] = useState(contato?.nascimento ?? "");
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>(contato?.etiquetaIds ?? []);
  const salvar = trpc.contatos.salvar.useMutation({
    onSuccess: () => {
      toast.sucesso(contato ? "Contato atualizado." : "Contato criado.");
      void utils.contatos.invalidate();
      onFechar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    salvar.mutate({ id: contato?.id, nome: nome.trim() || null, telefone, email: email.trim() || null, nascimento: nascimento || null, etiquetaIds });
  }

  return (
    <Modal titulo={contato ? "Editar contato" : "Novo contato"} onFechar={onFechar}>
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          WhatsApp
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} required inputMode="tel" placeholder="(11) 91234-5678" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          E-mail <span className="text-xs font-normal text-ink-3">(opcional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Data de nascimento <span className="text-xs font-normal text-ink-3">(opcional; para a mensagem de aniversário)</span>
          <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-col gap-1 text-sm font-medium">
          Etiquetas
          <div className="rounded-2xl bg-surface-2 p-2">
            <ListaDeEtiquetas
              marcadas={etiquetaIds}
              onAlternar={(id, marcada) => setEtiquetaIds((atual) => (marcada ? [...new Set([...atual, id])] : atual.filter((x) => x !== id)))}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variante="fantasma" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending || !normalizarTelefone(telefone)}>
            {salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Importação ----------

// CSV de planilha (Excel exporta com ";" e aspas): separador detectado pela primeira linha.
export function lerCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const separador = [";", ",", "\t"].map((s) => [s, primeira.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i += 1;
      } else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) {
      linha.push(celula.trim());
      celula = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i += 1;
      linha.push(celula.trim());
      if (linha.some((x) => x !== "")) linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  linha.push(celula.trim());
  if (linha.some((x) => x !== "")) linhas.push(linha);
  return linhas;
}

interface Colunas {
  telefone: number;
  nome: number;
  email: number;
  nascimento: number;
  etiquetas: number;
}

function adivinharColunas(cabecalho: string[] | null, linhas: string[][]): Colunas {
  const achar = (padrao: RegExp) => (cabecalho ? cabecalho.findIndex((t) => padrao.test(t.toLowerCase())) : -1);
  let telefone = achar(/tel|cel|whats|fone|phone|contato/);
  if (telefone === -1) {
    const largura = Math.max(...linhas.map((l) => l.length));
    const acertos = Array.from({ length: largura }, (_, i) => linhas.slice(0, 50).filter((l) => normalizarTelefone(l[i] ?? "")).length);
    telefone = acertos.indexOf(Math.max(...acertos));
  }
  let nome = achar(/nome|name|cliente|aluno/);
  if (nome === telefone) nome = -1;
  return { telefone, nome, email: achar(/mail/), nascimento: achar(/nasc|anivers|birth/), etiquetas: achar(/etiqueta|tag|situa|status|tipo/) };
}

function ModalImportar({ onFechar }: { onFechar: () => void }) {
  const utils = trpc.useUtils();
  const arquivo = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [tabela, setTabela] = useState<string[][]>([]);
  const [temCabecalho, setTemCabecalho] = useState(false);
  const [colunas, setColunas] = useState<Colunas>({ telefone: 0, nome: -1, email: -1, nascimento: -1, etiquetas: -1 });
  const [paraTodos, setParaTodos] = useState("");
  const [atualizarNomes, setAtualizarNomes] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const importar = trpc.contatos.importar.useMutation();

  const cabecalho = temCabecalho ? tabela[0]! : null;
  const dados = temCabecalho ? tabela.slice(1) : tabela;
  const largura = Math.max(0, ...tabela.map((l) => l.length));
  const nomesDasColunas = Array.from({ length: largura }, (_, i) => cabecalho?.[i] || `Coluna ${i + 1}`);
  const validos = dados.filter((l) => normalizarTelefone(l[colunas.telefone] ?? "")).length;

  async function escolher(evento: ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0];
    evento.target.value = "";
    if (!escolhido) return;
    const linhas = lerCsv(await escolhido.text());
    if (linhas.length === 0) {
      toast.erro("A planilha está vazia.");
      return;
    }
    // Cabeçalho = primeira linha sem nenhum telefone.
    const cabecalhoDetectado = !linhas[0]!.some((c) => normalizarTelefone(c));
    setNomeArquivo(escolhido.name);
    setTabela(linhas);
    setTemCabecalho(cabecalhoDetectado);
    setColunas(adivinharColunas(cabecalhoDetectado ? linhas[0]! : null, cabecalhoDetectado ? linhas.slice(1) : linhas));
  }

  async function confirmar() {
    const linhas = dados.map((l) => ({
      telefone: l[colunas.telefone] ?? "",
      nome: colunas.nome >= 0 ? l[colunas.nome]?.slice(0, 150) : undefined,
      email: colunas.email >= 0 ? l[colunas.email]?.slice(0, 200) : undefined,
      nascimento: colunas.nascimento >= 0 ? l[colunas.nascimento]?.slice(0, 20) : undefined,
      etiquetas:
        colunas.etiquetas >= 0
          ? (l[colunas.etiquetas] ?? "")
              .split(/[,|/]/)
              .map((t) => t.trim().slice(0, 40))
              .filter(Boolean)
              .slice(0, 20)
          : undefined,
    }));
    const etiquetasParaTodos = paraTodos
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
    setEnviando(true);
    try {
      const total = { criados: 0, atualizados: 0, invalidos: 0 };
      for (let i = 0; i < linhas.length; i += MAX_CONTATOS_POR_IMPORTACAO) {
        const r = await importar.mutateAsync({ linhas: linhas.slice(i, i + MAX_CONTATOS_POR_IMPORTACAO), etiquetasParaTodos, atualizarNomes });
        total.criados += r.criados;
        total.atualizados += r.atualizados;
        total.invalidos += r.invalidos;
      }
      toast.sucesso(
        `${formatarNumero(total.criados)} novo(s), ${formatarNumero(total.atualizados)} atualizado(s)${total.invalidos ? `, ${formatarNumero(total.invalidos)} sem telefone válido` : ""}.`,
      );
      void utils.contatos.invalidate();
      onFechar();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  const seletorDeColuna = (rotulo: string, chave: keyof Colunas, opcional: boolean) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {rotulo}
      <select value={colunas[chave]} onChange={(e) => setColunas({ ...colunas, [chave]: Number(e.target.value) })} className="rounded-lg px-3 py-2 text-sm">
        {opcional && <option value={-1}>— não usar —</option>}
        {nomesDasColunas.map((nome, i) => (
          <option key={i} value={i}>
            {nome}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal titulo="Importar planilha de contatos" onFechar={onFechar} largo>
      <p className="text-sm text-ink-2">
        Salve a planilha como <strong>CSV</strong> (no Excel: Arquivo → Salvar como → CSV). Precisa ter o WhatsApp; nome, e-mail e etiquetas são
        opcionais. Quem já está na base é atualizado, sem perder as etiquetas que tinha.
      </p>
      <input ref={arquivo} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} onChange={(e) => void escolher(e)} />
      <Button variante="secundario" className="self-start" onClick={() => arquivo.current?.click()}>
        <Icone nome="upload" tamanho={15} />
        {nomeArquivo ? `Trocar arquivo (${nomeArquivo})` : "Escolher arquivo CSV"}
      </Button>

      {tabela.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={temCabecalho} onChange={(e) => setTemCabecalho(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />A primeira linha é o
            cabeçalho
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {seletorDeColuna("WhatsApp", "telefone", false)}
            {seletorDeColuna("Nome", "nome", true)}
            {seletorDeColuna("E-mail", "email", true)}
            {seletorDeColuna("Nascimento (dd/mm/aaaa)", "nascimento", true)}
            {seletorDeColuna("Etiquetas (separadas por vírgula)", "etiquetas", true)}
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Etiqueta para todos desta planilha <span className="text-xs font-normal text-ink-3">(opcional; várias separadas por vírgula, ex.: ex-aluno)</span>
            <input value={paraTodos} onChange={(e) => setParaTodos(e.target.value)} maxLength={200} className="rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={atualizarNomes} onChange={(e) => setAtualizarNomes(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            Atualizar o nome de quem já está na base
          </label>

          <div className="overflow-x-auto rounded-2xl ring-1 ring-card-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">WhatsApp</th>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Etiquetas</th>
                </tr>
              </thead>
              <tbody>
                {dados.slice(0, 5).map((l, i) => {
                  const tel = normalizarTelefone(l[colunas.telefone] ?? "");
                  return (
                    <tr key={i} className="border-t border-card-border">
                      <td className={`px-3 py-2 font-mono ${tel ? "" : "text-red-700"}`}>{tel ? formatarTelefone(tel) : `${l[colunas.telefone] ?? ""} (inválido)`}</td>
                      <td className="px-3 py-2">{colunas.nome >= 0 ? l[colunas.nome] || "—" : "—"}</td>
                      <td className="px-3 py-2">{[colunas.etiquetas >= 0 ? l[colunas.etiquetas] : "", paraTodos].filter(Boolean).join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-2">
            <strong className="text-ink">{formatarNumero(validos)}</strong> com WhatsApp válido
            {dados.length - validos > 0 && `, ${formatarNumero(dados.length - validos)} serão ignorados`}.
          </p>
        </>
      )}

      <div className="flex justify-end gap-2 border-t border-card-border pt-4">
        <Button variante="fantasma" onClick={onFechar}>
          Cancelar
        </Button>
        <Button disabled={validos === 0 || enviando} onClick={() => void confirmar()}>
          {enviando ? "Importando…" : `Importar ${formatarNumero(validos)} contato(s)`}
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Segmentos ----------

function descreverFiltro(filtro: FiltroContatos, etiquetas: Etiqueta[]): string {
  const nomes = (ids: number[]) => etiquetas.filter((e) => ids.includes(e.id)).map((e) => e.nome).join(" ou ");
  const partes: string[] = [];
  if (filtro.etiquetas.length) partes.push(`com ${nomes(filtro.etiquetas)}`);
  if (filtro.semEtiquetas.length) partes.push(`sem ${nomes(filtro.semEtiquetas)}`);
  if (filtro.conversa === "escreveu") partes.push(`escreveu nos últimos ${filtro.dias} dias`);
  if (filtro.conversa === "nao_escreveu") partes.push(`não escreve há ${filtro.dias} dias`);
  if (filtro.conversa === "nunca_escreveu") partes.push("nunca escreveu");
  if (filtro.etapasFunil.length) partes.push(`no funil: ${filtro.etapasFunil.map((e) => ROTULO_ETAPA_FUNIL[e]).join(", ")}`);
  if (filtro.busca?.trim()) partes.push(`busca "${filtro.busca.trim()}"`);
  return partes.length ? partes.join(" · ") : "Toda a base";
}

function ModalSegmento({ filtro, onFechar }: { filtro: FiltroContatos; onFechar: () => void }) {
  const utils = trpc.useUtils();
  const etiquetas = useEtiquetas().data ?? [];
  const [nome, setNome] = useState("");
  const salvar = trpc.contatos.salvarSegmento.useMutation({
    onSuccess: () => {
      toast.sucesso("Segmento salvo. Ele aparece em Segmentos e na escolha de destinatários da campanha.");
      void utils.contatos.segmentos.invalidate();
      onFechar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  return (
    <Modal titulo="Salvar segmento" onFechar={onFechar}>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          salvar.mutate({ nome, filtro });
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-ink-2">{descreverFiltro(filtro, etiquetas)}</p>
        <p className="text-xs text-ink-3">A lista é refeita a cada uso: quem passar a se encaixar no filtro entra sozinho.</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nome do segmento
          <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={80} placeholder="Ex.: Ex-alunos sem conversa há 30 dias" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variante="fantasma" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending || !nome.trim()}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AbaSegmentos({ onVerContatos }: { onVerContatos: (filtro: FiltroContatos) => void }) {
  const utils = trpc.useUtils();
  const consulta = trpc.contatos.segmentos.useQuery();
  const etiquetas = useEtiquetas().data ?? [];
  const [montando, setMontando] = useState<number | null>(null);
  const excluir = trpc.contatos.excluirSegmento.useMutation({
    onSuccess: () => void utils.contatos.segmentos.invalidate(),
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  async function campanha(id: number, nome: string, filtro: FiltroContatos) {
    setMontando(id);
    try {
      const resultado = await utils.contatos.paraCampanha.fetch(filtro);
      if (resultado.passouDoLimite) toast.erro("O segmento passa de 1.000 contatos; a campanha começa com os primeiros 1.000.");
      iniciarCampanhaComContatos(resultado.contatos, nome);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : "Não foi possível montar a campanha.");
    } finally {
      setMontando(null);
    }
  }

  if (consulta.isError) return <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />;
  if (!consulta.data) return <Esqueleto className="h-40" />;
  if (consulta.data.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum segmento salvo"
        descricao='Na aba Contatos, filtre (por etiqueta, conversa ou etapa do funil) e clique em "Salvar como segmento".'
      />
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {consulta.data.map((segmento) => (
        <Card key={segmento.id} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-heading text-base font-bold">{segmento.nome}</h3>
              <p className="mt-0.5 text-sm text-ink-2">{descreverFiltro(segmento.filtro, etiquetas)}</p>
            </div>
            <button
              type="button"
              aria-label={`Excluir o segmento ${segmento.nome}`}
              title="Excluir segmento"
              onClick={() => window.confirm(`Excluir o segmento "${segmento.nome}"? Os contatos continuam na base.`) && excluir.mutate({ id: segmento.id })}
              className="rounded-full p-2 text-ink-3 hover:bg-red-50 hover:text-red-700"
            >
              <Icone nome="lixeira" tamanho={15} />
            </button>
          </div>
          <p className="font-heading text-3xl font-bold tabular-nums">
            {formatarNumero(segmento.alcancaveis)}
            <span className="ml-2 text-sm font-medium text-ink-2">podem receber campanha</span>
          </p>
          {segmento.descadastrados > 0 && <p className="-mt-2 text-xs text-ink-3">{formatarNumero(segmento.descadastrados)} pediram para não receber</p>}
          <div className="mt-auto flex flex-wrap gap-2">
            <Button variante="secundario" onClick={() => onVerContatos(segmento.filtro)}>
              Ver contatos
            </Button>
            <Button disabled={segmento.alcancaveis === 0 || montando !== null} onClick={() => void campanha(segmento.id, segmento.nome, segmento.filtro)}>
              <Icone nome="enviar" tamanho={15} />
              {montando === segmento.id ? "Montando…" : "Criar campanha"}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------- Etiquetas ----------

function AbaEtiquetas() {
  const utils = trpc.useUtils();
  const consulta = useEtiquetas();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<CorEtiqueta>("roxo");
  const salvar = trpc.contatos.salvarEtiqueta.useMutation({
    onSuccess: () => {
      setNome("");
      void utils.contatos.etiquetas.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const excluir = trpc.contatos.excluirEtiqueta.useMutation({
    onSuccess: () => void utils.contatos.invalidate(),
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            salvar.mutate({ nome, cor });
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            Nova etiqueta
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="Ex.: Aluno, Lead, Ex-aluno, Plano anual" className="rounded-lg px-3 py-2 text-sm" />
          </label>
          <SeletorDeCor cor={cor} onCor={setCor} />
          <Button type="submit" disabled={!nome.trim() || salvar.isPending}>
            Criar
          </Button>
        </form>
      </Card>

      {consulta.data && consulta.data.length === 0 && <EstadoVazio titulo="Nenhuma etiqueta ainda" descricao="Etiquetas separam alunos, leads e ex-alunos para montar segmentos." />}
      {consulta.data && consulta.data.length > 0 && (
        <Card className="!p-2">
          <ul>
            {consulta.data.map((etiqueta) => (
              <LinhaEtiqueta
                key={etiqueta.id}
                etiqueta={etiqueta}
                onSalvar={(dados) => salvar.mutate({ id: etiqueta.id, ...dados })}
                onExcluir={() =>
                  window.confirm(`Excluir a etiqueta "${etiqueta.nome}"? Ela sai de ${etiqueta.contatos} contato(s); os contatos continuam na base.`) &&
                  excluir.mutate({ id: etiqueta.id })
                }
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SeletorDeCor({ cor, onCor }: { cor: CorEtiqueta; onCor: (c: CorEtiqueta) => void }) {
  return (
    <div role="radiogroup" aria-label="Cor" className="flex h-10 items-center gap-1.5">
      {CORES_ETIQUETA.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={cor === c}
          aria-label={ROTULO_COR[c]}
          title={ROTULO_COR[c]}
          onClick={() => onCor(c)}
          style={estiloDaCor(c)}
          className={`flex h-7 w-7 items-center justify-center rounded-full ${cor === c ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--etq-${c}-fg)` }} />
        </button>
      ))}
    </div>
  );
}

function LinhaEtiqueta({ etiqueta, onSalvar, onExcluir }: { etiqueta: Etiqueta; onSalvar: (d: { nome: string; cor: CorEtiqueta }) => void; onExcluir: () => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(etiqueta.nome);
  const [cor, setCor] = useState<CorEtiqueta>(etiqueta.cor as CorEtiqueta);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2/60">
      {editando ? (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            onSalvar({ nome, cor });
            setEditando(false);
          }}
          className="flex flex-1 flex-wrap items-center gap-3"
        >
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} required aria-label="Nome da etiqueta" className="min-w-40 flex-1 rounded-lg px-3 py-1.5 text-sm" />
          <SeletorDeCor cor={cor} onCor={setCor} />
          <Button type="submit" className="!min-h-8 !py-1">
            Salvar
          </Button>
          <Button variante="fantasma" className="!min-h-8 !py-1" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <>
          <ChipEtiqueta etiqueta={etiqueta} />
          <span className="flex-1 text-sm text-ink-2">{formatarNumero(etiqueta.contatos)} contato(s)</span>
          <Button variante="fantasma" className="!min-h-8 !py-1 text-xs" onClick={() => setEditando(true)}>
            Editar
          </Button>
          <button type="button" aria-label={`Excluir a etiqueta ${etiqueta.nome}`} onClick={onExcluir} className="rounded-full p-2 text-ink-3 hover:bg-red-50 hover:text-red-700">
            <Icone nome="lixeira" tamanho={15} />
          </button>
        </>
      )}
    </li>
  );
}
