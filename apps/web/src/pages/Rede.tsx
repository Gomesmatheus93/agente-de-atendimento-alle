import { keepPreviousData } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarMoeda, formatarNumero, formatarPercentual } from "../lib/format.js";
import { navegar } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";
import { Variacao } from "./VisaoGeral.js";

type Resumo = SaidaApi["rede"]["resumo"];
type Linha = Resumo["unidades"][number];
type Dias = 7 | 30 | 90;
type Coluna = "nome" | "atendidos" | "matriculas" | "conversao" | "envios" | "custoPorMatricula";

const CHAVE_DIAS = "rede-dias";

function diasSalvos(): Dias {
  try {
    const valor = Number(localStorage.getItem(CHAVE_DIAS));
    return valor === 7 || valor === 90 ? valor : 30;
  } catch {
    return 30;
  }
}

const moeda = (valor: number | null) => (valor === null ? "—" : formatarMoeda(Math.round(valor * 100) / 100));

// Visão da rede (superadmin): todas as unidades lado a lado.
export function Rede() {
  const utils = trpc.useUtils();
  const [dias, setDias] = useState<Dias>(diasSalvos);
  const [ordem, setOrdem] = useState<{ coluna: Coluna; desc: boolean }>({ coluna: "matriculas", desc: true });
  const consulta = trpc.rede.resumo.useQuery({ dias }, { placeholderData: keepPreviousData, refetchInterval: 5 * 60_000 });
  const entrar = trpc.unidades.entrar.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      navegar({ tela: "visao-geral" });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function escolherDias(valor: Dias) {
    setDias(valor);
    try {
      localStorage.setItem(CHAVE_DIAS, String(valor));
    } catch {
      // sem armazenamento: vale só agora
    }
  }

  if (consulta.isError && !consulta.data) return <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />;
  const dados = consulta.data;

  const valorDe = (l: Linha, coluna: Coluna): number | string => {
    switch (coluna) {
      case "nome":
        return l.nome.toLowerCase();
      case "atendidos":
        return l.atendidos.atual;
      case "matriculas":
        return l.matriculas.atual;
      case "conversao":
        return l.conversao ?? -1;
      case "envios":
        return l.envios;
      case "custoPorMatricula":
        return l.custoPorMatricula ?? Number.MAX_VALUE;
    }
  };
  const unidades = dados
    ? [...dados.unidades].sort((a, b) => {
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        const va = valorDe(a, ordem.coluna);
        const vb = valorDe(b, ordem.coluna);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : va - (vb as number);
        return ordem.desc ? -cmp : cmp;
      })
    : [];
  const atencao = unidades.filter((u) => u.ativo && (u.saude.falhas > 0 || u.precisaHumano > 0));

  const cabecalho = (coluna: Coluna, rotulo: string, direita = true) => (
    <th scope="col" aria-sort={ordem.coluna === coluna ? (ordem.desc ? "descending" : "ascending") : "none"} className={`px-3 py-3 font-medium ${direita ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => setOrdem((o) => ({ coluna, desc: o.coluna === coluna ? !o.desc : coluna !== "nome" && coluna !== "custoPorMatricula" }))}
        className={`inline-flex items-center gap-1 hover:text-ink ${ordem.coluna === coluna ? "text-ink" : ""}`}
      >
        {rotulo}
        {ordem.coluna === coluna && <span aria-hidden="true">{ordem.desc ? "▼" : "▲"}</span>}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Período" className="inline-flex rounded-full bg-surface p-1 shadow-card">
          {([7, 30, 90] as const).map((valor) => (
            <button
              key={valor}
              type="button"
              aria-pressed={dias === valor}
              onClick={() => escolherDias(valor)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${dias === valor ? "bg-accent text-accent-contrast" : "text-ink-2 hover:text-ink"}`}
            >
              {valor} dias
            </button>
          ))}
        </div>
        {dados && (
          <p className="text-sm text-ink-2">
            {formatarNumero(dados.totais.unidades)} unidade(s) ativa(s) · comparado aos {dias} dias anteriores
          </p>
        )}
      </div>

      {dados && dados.plataforma.falhas + dados.plataforma.atencoes > 0 && (
        <a href="#/saude" className="flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          <Icone nome="alerta" tamanho={16} />
          <span className="flex-1">
            <strong>Plataforma:</strong> {dados.plataforma.problemas.join(", ")}
          </span>
          <span className="font-semibold">Ver saúde do sistema</span>
        </a>
      )}

      {!dados ? (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <section aria-label="Números da rede" className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity ${consulta.isPlaceholderData ? "opacity-60" : ""}`}>
          <Numero destaque rotulo="Matrículas" valor={formatarNumero(dados.totais.matriculas.atual)} variacao={<Variacao {...dados.totais.matriculas} altaEhBoa sobreDestaque />} apoio="em toda a rede" />
          <Numero rotulo="Clientes atendidos" valor={formatarNumero(dados.totais.atendidos.atual)} variacao={<Variacao {...dados.totais.atendidos} altaEhBoa />} apoio="conversaram com alguma unidade" />
          <Numero rotulo="Taxa de conversão" valor={formatarPercentual(dados.totais.conversao)} apoio="dos atendidos se matricularam" />
          <Numero rotulo="Custo por matrícula" valor={moeda(dados.totais.custoPorMatricula)} apoio={`${moeda(dados.totais.custo)} em disparos`} />
        </section>
      )}

      {atencao.length > 0 && (
        <section aria-labelledby="titulo-atencao" className="flex flex-col gap-3">
          <h2 id="titulo-atencao" className="font-heading text-lg font-bold">
            Precisa de atenção
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {atencao.map((u) => (
              <Card key={u.id} className="flex items-start gap-3">
                <span aria-hidden="true" className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${u.saude.falhas > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"}`}>
                  <Icone nome="alerta" tamanho={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{u.nome}</p>
                  <ul className="mt-0.5 text-sm text-ink-2">
                    {u.saude.problemas.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                    {u.precisaHumano > 0 && <li>{u.precisaHumano} cliente(s) esperando uma pessoa</li>}
                  </ul>
                </div>
                <button type="button" disabled={entrar.isPending} onClick={() => entrar.mutate({ id: u.id })} className="shrink-0 text-sm font-semibold text-accent-text hover:underline">
                  Abrir
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {dados && (
        <section aria-labelledby="titulo-unidades" className="flex flex-col gap-3">
          <h2 id="titulo-unidades" className="font-heading text-lg font-bold">
            Unidades
          </h2>
          <Card className={`overflow-x-auto !p-0 transition-opacity ${consulta.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-card-border">
                  <th scope="col" className="w-0 py-3 pl-5">
                    <span className="sr-only">Saúde</span>
                  </th>
                  {cabecalho("nome", "Unidade", false)}
                  {cabecalho("atendidos", "Atendidos")}
                  {cabecalho("matriculas", "Matrículas")}
                  {cabecalho("conversao", "Conversão")}
                  {cabecalho("envios", "Disparos")}
                  {cabecalho("custoPorMatricula", "Custo / matrícula")}
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Agora
                  </th>
                  <th scope="col" className="py-3 pl-3 pr-5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => (
                  <tr key={u.id} className={`border-b border-card-border last:border-0 ${u.ativo ? "" : "opacity-50"}`}>
                    <td className="py-3 pl-5">
                      <PontoDeSaude linha={u} />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink">{u.nome}</p>
                      <p className="text-xs text-ink-3">
                        {u.ativo ? `${u.numerosAtivos} número(s) · ${u.equipe} na equipe${u.instagram ? ` · @${u.instagram.username}` : ""}` : "Desativada"}
                      </p>
                    </td>
                    <Celula valor={formatarNumero(u.atendidos.atual)} variacao={<Variacao {...u.atendidos} altaEhBoa />} />
                    <Celula valor={formatarNumero(u.matriculas.atual)} variacao={<Variacao {...u.matriculas} altaEhBoa />} />
                    <Celula valor={formatarPercentual(u.conversao)} />
                    <Celula valor={formatarNumero(u.envios)} apoio={u.campanhas > 0 ? `${u.campanhas} campanha(s)${u.falhasDeEnvio ? ` · ${u.falhasDeEnvio} falha(s)` : ""}` : undefined} />
                    <Celula valor={moeda(u.custoPorMatricula)} apoio={u.custo > 0 ? `${moeda(u.custo)} no total` : undefined} />
                    <td className="px-3 py-3 text-right text-xs">
                      {u.precisaHumano > 0 && <span className="block font-semibold text-amber-900">🙋 {u.precisaHumano} esperando</span>}
                      {u.instagram && u.instagram.naoLidas > 0 && <span className="block text-ink-2">{u.instagram.naoLidas} DM(s) não lida(s)</span>}
                      {u.precisaHumano === 0 && (!u.instagram || u.instagram.naoLidas === 0) && <span className="text-ink-3">—</span>}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right">
                      {u.ativo && (
                        <button
                          type="button"
                          disabled={entrar.isPending}
                          onClick={() => entrar.mutate({ id: u.id })}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-card-border px-3 text-xs font-semibold text-ink hover:border-accent hover:text-accent-text"
                        >
                          Abrir
                          <Icone nome="setaDireita" tamanho={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

function Numero({ rotulo, valor, variacao, apoio, destaque = false }: { rotulo: string; valor: string; variacao?: ReactNode; apoio: string; destaque?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-3xl p-5 shadow-card ${destaque ? "bg-gradient-to-br from-[#5b1593] via-[#470e75] to-[#25083d] text-white" : "bg-surface"}`}>
      {destaque && <span aria-hidden="true" className="absolute -bottom-16 -right-10 h-40 w-40 rounded-full border-[18px] border-white/5" />}
      <p className={`relative text-[15px] font-medium ${destaque ? "text-white" : "text-ink"}`}>{rotulo}</p>
      <p className="tabular relative mt-4 font-heading text-[2.75rem] font-bold leading-none tracking-tight">{valor}</p>
      <p className={`relative mt-3 flex flex-wrap items-center gap-1.5 text-xs ${destaque ? "text-white/80" : "text-ink-3"}`}>
        {variacao}
        {apoio}
      </p>
    </div>
  );
}

function Celula({ valor, variacao, apoio }: { valor: string; variacao?: ReactNode; apoio?: string }) {
  return (
    <td className="px-3 py-3 text-right">
      <span className="inline-flex items-center gap-1.5">
        {variacao}
        <span className="tabular font-semibold text-ink">{valor}</span>
      </span>
      {apoio && <span className="block text-[11px] text-ink-3">{apoio}</span>}
    </td>
  );
}

function PontoDeSaude({ linha }: { linha: Linha }) {
  const { falhas, atencoes, problemas } = linha.saude;
  const cor = falhas > 0 ? "bg-status-falhou" : atencoes > 0 ? "bg-status-pendente" : "bg-status-enviado";
  const texto = falhas + atencoes > 0 ? problemas.join(", ") : "Tudo funcionando";
  return <span role="img" aria-label={`Saúde: ${texto}`} title={texto} className={`block h-2.5 w-2.5 rounded-full ${cor}`} />;
}
