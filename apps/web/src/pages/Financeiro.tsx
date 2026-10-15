import { CATEGORIAS_TEMPLATE, ROTULO_CATEGORIA, type ConfigFinanceiro } from "@atendimento-academias/shared";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { ColunasEmpilhadas } from "../components/charts/ColunasEmpilhadas.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { SeletorPeriodoVisao, type PeriodoEscolhido } from "../components/ui/SeletorPeriodoVisao.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarMoeda, formatarNumero } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Variacao } from "./VisaoGeral.js";

type Resumo = SaidaApi["financeiro"]["resumo"];
const CHAVE_PERIODO = "financeiro-periodo";

const SERIES = [
  { chave: "whatsapp", rotulo: "Mensagens de WhatsApp", cor: "bg-graf-1" },
  { chave: "ia", rotulo: "Inteligência artificial", cor: "bg-graf-2" },
  { chave: "manual", rotulo: "Outros gastos", cor: "bg-graf-3" },
];
const COR_DA_FONTE: Record<string, string> = { whatsapp: "bg-graf-1", ia: "bg-graf-2", manual: "bg-graf-3" };

function periodoSalvo(): PeriodoEscolhido {
  try {
    const bruto = localStorage.getItem(CHAVE_PERIODO);
    if (bruto) return JSON.parse(bruto) as PeriodoEscolhido;
  } catch {
    // sem armazenamento: começa em 30 dias
  }
  return { periodo: "30d" };
}

// Tela Financeiro (admin): tudo o que a unidade gasta e o que volta em matrículas.
export function Financeiro() {
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>(periodoSalvo);
  const [configurando, setConfigurando] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PERIODO, JSON.stringify(periodo));
    } catch {
      // vale só nesta visita
    }
  }, [periodo]);
  const consulta = trpc.financeiro.resumo.useQuery(periodo, { placeholderData: keepPreviousData });
  const dados = consulta.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variante="secundario" onClick={() => setConfigurando(true)}>
          <Icone nome="engrenagem" tamanho={15} />
          Preços e ticket médio
        </Button>
        <SeletorPeriodoVisao valor={periodo} onChange={setPeriodo} />
      </div>

      {!dados && consulta.isError && <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />}
      {!dados && consulta.isPending && <Esqueleto className="h-96" />}
      {dados && (
        <div className={`flex flex-col gap-4 transition-opacity ${consulta.isPlaceholderData ? "opacity-60" : ""}`}>
          <Numeros dados={dados} onConfigurar={() => setConfigurando(true)} />
          <Card className="min-w-0">
            <h3 className="font-heading text-lg font-semibold">Gasto por {dados.periodo.agrupamento === "mes" ? "mês" : "dia"}</h3>
            <div className="mt-4">
              <ColunasEmpilhadas
                pontos={dados.serie}
                series={SERIES}
                agrupamento={dados.periodo.agrupamento}
                rotuloAcessivel={`Gasto por ${dados.periodo.agrupamento === "mes" ? "mês" : "dia"}, por fonte`}
              />
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <ParaOndeFoi dados={dados} />
            <CampanhasDoPeriodo dados={dados} />
          </div>
          <Lancamentos />
        </div>
      )}
      {configurando && dados && <ConfigurarFinanceiro inicial={dados.config} onFechar={() => setConfigurando(false)} />}
    </div>
  );
}

function Numero({ rotulo, valor, apoio, variacao, destaque = false }: { rotulo: string; valor: string; apoio: ReactNode; variacao?: ReactNode; destaque?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-3xl p-5 shadow-card ${destaque ? "bg-gradient-to-br from-[#5b1593] via-[#470e75] to-[#25083d] text-white" : "bg-surface"}`}>
      {destaque && <span aria-hidden="true" className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full border-[18px] border-white/5" />}
      <p className={`relative text-[15px] font-medium ${destaque ? "text-white" : "text-ink"}`}>{rotulo}</p>
      <p className="relative mt-4 font-heading text-[2.25rem] font-bold leading-none tracking-tight">{valor}</p>
      <p className={`relative mt-3 flex flex-wrap items-center gap-1.5 text-xs ${destaque ? "text-white/80" : "text-ink-3"}`}>
        {variacao}
        {apoio}
      </p>
    </div>
  );
}

function Numeros({ dados, onConfigurar }: { dados: Resumo; onConfigurar: () => void }) {
  const { gasto, retorno } = dados;
  const comparacao = dados.periodo.comparacao ?? "em todo o período";
  return (
    <section aria-label="Números do período" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Numero
        destaque
        rotulo="Gasto no período"
        valor={formatarMoeda(gasto.atual.total)}
        variacao={<Variacao atual={gasto.atual.total} anterior={gasto.anterior?.total ?? null} altaEhBoa={false} sobreDestaque />}
        apoio={comparacao}
      />
      <Numero
        rotulo="Custo por matrícula"
        valor={formatarMoeda(retorno.custoPorMatricula)}
        variacao={<Variacao atual={retorno.custoPorMatricula} anterior={retorno.custoPorMatriculaAnterior} altaEhBoa={false} />}
        apoio={`${formatarNumero(retorno.matriculas)} matrícula(s) no período`}
      />
      <Numero
        rotulo="Receita estimada"
        valor={retorno.receitaEstimada === null ? "—" : formatarMoeda(retorno.receitaEstimada)}
        apoio={
          retorno.receitaEstimada === null ? (
            <button type="button" onClick={onConfigurar} className="font-semibold text-accent-text hover:underline">
              Informe o ticket médio para estimar
            </button>
          ) : (
            `matrículas × ticket de ${formatarMoeda(dados.config.ticketMedio)}`
          )
        }
      />
      <Numero
        rotulo="Retorno"
        valor={retorno.retornoPorReal === null ? "—" : `${retorno.retornoPorReal.toLocaleString("pt-BR")}×`}
        apoio={
          retorno.retornoPorReal === null
            ? retorno.custoPorResposta !== null
              ? `${formatarMoeda(retorno.custoPorResposta)} por resposta de campanha`
              : "sem receita estimada no período"
            : `R$ ${retorno.retornoPorReal.toLocaleString("pt-BR")} de receita para cada R$ 1 gasto`
        }
      />
    </section>
  );
}

// Participação no total; o que existe mas não chega a 1% aparece como "<1%" (nunca "0%").
function porcento(parte: number, total: number): string {
  const p = total > 0 ? (parte / total) * 100 : 0;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

function ParaOndeFoi({ dados }: { dados: Resumo }) {
  const maior = Math.max(1, ...dados.detalhamento.map((d) => d.valor));
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="font-heading text-lg font-semibold">Para onde foi o dinheiro</h3>
      {dados.detalhamento.length === 0 ? (
        <p className="text-sm text-ink-3">Nenhum gasto no período.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {dados.detalhamento.map((d) => (
            <li key={`${d.fonte}-${d.rotulo}`} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${COR_DA_FONTE[d.fonte]}`} />
                  <span className="truncate">{d.rotulo}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">
                  {formatarMoeda(d.valor)}
                  <span className="ml-2 text-xs font-normal text-ink-3">{porcento(d.valor, dados.gasto.atual.total)}</span>
                </span>
              </div>
              <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-2">
                <div className={`h-full rounded-full ${COR_DA_FONTE[d.fonte]}`} style={{ width: `${(d.valor / maior) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-col gap-2 border-t border-card-border pt-3 text-xs text-ink-2">
        {dados.comprometido.campanhas > 0 && (
          <p className="flex items-start gap-2">
            <Icone nome="calendario" tamanho={14} className="mt-px shrink-0 text-ink-3" />
            <span>
              <strong className="text-ink">{formatarMoeda(dados.comprometido.valor)}</strong> já comprometidos em {dados.comprometido.campanhas} campanha(s) agendada(s) (
              {formatarNumero(dados.comprometido.mensagens)} mensagens).
            </span>
          </p>
        )}
        {dados.ia.botNoN8n && (
          <p className="flex items-start gap-2">
            <Icone nome="alerta" tamanho={14} className="mt-px shrink-0 text-ink-3" />
            <span>
              O bot do n8n usa a chave da Anthropic do próprio n8n: esse gasto aparece no console da Anthropic, não aqui. Lance-o em "Outros gastos" para entrar
              na conta.
            </span>
          </p>
        )}
        <p className="flex items-start gap-2">
          <Icone nome="duvida" tamanho={14} className="mt-px shrink-0 text-ink-3" />
          <span>
            Mensagens: preço da categoria do template × mensagens enviadas (o valor fica congelado em cada campanha). IA: tokens × preço do modelo, convertidos a{" "}
            {formatarMoeda(dados.config.cotacaoDolar)} por dólar. Respostas dentro da janela de 24h não são cobradas.
          </span>
        </p>
      </div>
    </Card>
  );
}

function CampanhasDoPeriodo({ dados }: { dados: Resumo }) {
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="font-heading text-lg font-semibold">Campanhas que mais custaram</h3>
      {dados.campanhas.length === 0 ? (
        <p className="text-sm text-ink-3">Nenhuma campanha disparada no período.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-3">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Campanha
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Enviadas
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Custo
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Por resposta
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.campanhas.map((c) => (
              <tr key={c.id} className="border-t border-card-border">
                <td className="py-2.5 pr-2">
                  <a href={hrefDe({ tela: "campanhas", campanhaId: c.id })} className="font-semibold text-ink hover:text-accent-text">
                    {c.nome}
                  </a>
                  <span className="block text-xs text-ink-3">{ROTULO_CATEGORIA[c.categoria as keyof typeof ROTULO_CATEGORIA]}</span>
                </td>
                <td className="py-2.5 text-right tabular-nums">{formatarNumero(c.enviadas)}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums">{formatarMoeda(c.custo)}</td>
                <td className="py-2.5 text-right tabular-nums text-ink-2">{c.custoPorResposta === null ? "—" : formatarMoeda(c.custoPorResposta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function Lancamentos() {
  const utils = trpc.useUtils();
  const lista = trpc.financeiro.lancamentos.useQuery();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje);
  const [recorrente, setRecorrente] = useState(false);
  const atualizar = () => void utils.financeiro.invalidate();
  const salvar = trpc.financeiro.salvarLancamento.useMutation({
    onSuccess: () => {
      toast.sucesso("Gasto lançado.");
      setDescricao("");
      setValor("");
      atualizar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const excluir = trpc.financeiro.excluirLancamento.useMutation({ onSuccess: atualizar, onError: (erro) => toast.erro(mensagemDeErro(erro)) });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const numero = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!numero || numero <= 0) return toast.erro("Informe um valor maior que zero.");
    salvar.mutate({ descricao, valor: numero, data, recorrente });
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="font-heading text-lg font-semibold">Outros gastos</h3>
        <p className="text-sm text-ink-2">O que o sistema não enxerga sozinho: servidor, n8n, a IA do bot no n8n, mensalidades, anúncios...</p>
      </div>
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Descrição
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} required maxLength={120} placeholder="Ex.: Servidor (easypanel)" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Valor (R$)
          <input value={valor} onChange={(e) => setValor(e.target.value)} required inputMode="decimal" placeholder="0,00" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          Todo mês
        </label>
        <Button type="submit" disabled={salvar.isPending}>
          Lançar
        </Button>
      </form>
      {lista.data && lista.data.length > 0 && (
        <ul className="divide-y divide-card-border">
          {lista.data.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm bg-graf-3" />
              <span className="min-w-0 flex-1 truncate text-ink">{l.descricao}</span>
              <span className="shrink-0 text-xs text-ink-3">
                {l.recorrente ? `todo mês, desde ${l.data.split("-").reverse().join("/")}` : l.data.split("-").reverse().join("/")}
              </span>
              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{formatarMoeda(l.valor)}</span>
              <button
                type="button"
                aria-label={`Excluir ${l.descricao}`}
                onClick={() => window.confirm(`Excluir o lançamento "${l.descricao}"?`) && excluir.mutate({ id: l.id })}
                className="rounded-full p-1.5 text-ink-3 hover:bg-red-50 hover:text-red-700"
              >
                <Icone nome="lixeira" tamanho={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConfigurarFinanceiro({ inicial, onFechar }: { inicial: ConfigFinanceiro; onFechar: () => void }) {
  const utils = trpc.useUtils();
  const [ticket, setTicket] = useState(inicial.ticketMedio === null ? "" : String(inicial.ticketMedio).replace(".", ","));
  const [cotacao, setCotacao] = useState(String(inicial.cotacaoDolar).replace(".", ","));
  const [precos, setPrecos] = useState(Object.fromEntries(CATEGORIAS_TEMPLATE.map((c) => [c, String(inicial.precos[c]).replace(".", ",")])));
  const numero = (texto: string) => Number(texto.replace(/\./g, "").replace(",", "."));
  const salvar = trpc.financeiro.salvarConfig.useMutation({
    onSuccess: () => {
      toast.sucesso("Configuração salva.");
      void utils.financeiro.invalidate();
      onFechar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    salvar.mutate({
      ticketMedio: ticket.trim() ? numero(ticket) : null,
      cotacaoDolar: numero(cotacao),
      precos: Object.fromEntries(CATEGORIAS_TEMPLATE.map((c) => [c, numero(precos[c] ?? "0")])) as ConfigFinanceiro["precos"],
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Preços e ticket médio" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={enviar} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-surface p-5 shadow-pop">
        <h3 className="font-heading text-base font-bold">Preços e ticket médio</h3>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Ticket médio de uma matrícula (R$)
          <input value={ticket} onChange={(e) => setTicket(e.target.value)} inputMode="decimal" placeholder="Ex.: 99,90" className="rounded-lg px-3 py-2 text-sm" />
          <span className="text-xs font-normal text-ink-3">Para estimar a receita e o retorno. Em branco, a tela não estima receita.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Cotação do dólar (R$)
          <input value={cotacao} onChange={(e) => setCotacao(e.target.value)} required inputMode="decimal" className="rounded-lg px-3 py-2 text-sm" />
          <span className="text-xs font-normal text-ink-3">A IA é cobrada em dólar pela Anthropic.</span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Preço por mensagem de template (R$)</legend>
          <p className="text-xs text-ink-3">O que o provedor do WhatsApp cobra por mensagem enviada. Vale para as campanhas novas; as antigas mantêm o preço da época.</p>
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIAS_TEMPLATE.map((c) => (
              <label key={c} className="flex flex-col gap-1 text-sm">
                {ROTULO_CATEGORIA[c]}
                <input
                  value={precos[c] ?? ""}
                  onChange={(e) => setPrecos((p) => ({ ...p, [c]: e.target.value }))}
                  required
                  inputMode="decimal"
                  className="rounded-lg px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variante="fantasma" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}
