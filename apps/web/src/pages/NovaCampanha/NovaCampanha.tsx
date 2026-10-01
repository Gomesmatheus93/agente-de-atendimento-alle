import {
  ANTECEDENCIA_MIN_AGENDAMENTO_MS,
  MAX_TELEFONES_POR_CAMPANHA,
  extrairPlaceholders,
  parseListaDestinatarios,
  resolverParametros,
  type OrigemParametro,
} from "@atendimento-academias/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../../components/Card.js";
import { Button } from "../../components/ui/Button.js";
import { toast } from "../../components/ui/Toast.js";
import { mensagemDeErro } from "../../lib/erro.js";
import { formatarNumero, formatarQuando, lerCampoDataHora, paraCampoDataHora } from "../../lib/format.js";
import { navegar } from "../../lib/route.js";
import { trpc } from "../../lib/trpc.js";
import { PassoDestinatarios } from "./PassoDestinatarios.js";
import { PassoParametros, semValorNaColuna } from "./PassoParametros.js";
import { PassoRevisao } from "./PassoRevisao.js";
import { PassoTemplate } from "./PassoTemplate.js";
import { ResumoLateral } from "./ResumoLateral.js";
import { Stepper } from "./Stepper.js";

type PassoId = "template" | "parametros" | "destinatarios" | "revisar";

interface Rascunho {
  nome: string;
  // Número da operação por onde a campanha sai.
  numeroId: number | null;
  templateId: number | null;
  // De onde sai cada placeholder: um valor fixo, ou uma coluna da lista de destinatários.
  origens: Record<string, OrigemParametro>;
  telefonesTexto: string;
  passoId: PassoId;
  // Quando enviar: agora, ou na data/hora escolhida (formato do campo datetime-local).
  agendar: boolean;
  quando: string;
}

const CHAVE_RASCUNHO = "rascunho-nova-campanha";

// Em desenvolvimento o disparo é testado no próprio celular: VITE_TELEFONES_TESTE já deixa esses
// números na caixa de destinatários, inclusive depois de criar uma campanha. Vazio em produção.
const TELEFONES_TESTE = (import.meta.env.VITE_TELEFONES_TESTE ?? "")
  .split(",")
  .map((telefone) => telefone.trim())
  .filter((telefone) => telefone !== "")
  .join("\n");

const RASCUNHO_VAZIO: Rascunho = {
  nome: "",
  numeroId: null,
  templateId: null,
  origens: {},
  telefonesTexto: TELEFONES_TESTE,
  passoId: "template",
  agendar: false,
  quando: "",
};

// Sugestão ao escolher "Agendar": amanhã às 9h.
function sugestaoDeHorario(): string {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(9, 0, 0, 0);
  return paraCampoDataHora(amanha);
}

const TITULOS: Record<PassoId, string> = {
  template: "Escolha o template",
  destinatarios: "Defina os destinatários",
  parametros: "Preencha os parâmetros",
  revisar: "Revise e dispare",
};

// O rascunho sobrevive a recarregar a página sem perder o que foi digitado.
function carregarRascunho(): Rascunho {
  try {
    const bruto = sessionStorage.getItem(CHAVE_RASCUNHO);
    if (bruto) return { ...RASCUNHO_VAZIO, ...JSON.parse(bruto) };
  } catch {
    // sessionStorage indisponível ou conteúdo inválido: começa vazio
  }
  return RASCUNHO_VAZIO;
}

export function NovaCampanha() {
  const [rascunho, setRascunho] = useState(carregarRascunho);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const passoAnterior = useRef<PassoId | null>(null);

  const templatesQuery = trpc.templates.listar.useQuery(
    { numeroId: rascunho.numeroId ?? undefined },
    { enabled: rascunho.numeroId !== null },
  );
  const utils = trpc.useUtils();

  const template = templatesQuery.data?.find((item) => item.id === rascunho.templateId);
  const lista = useMemo(() => parseListaDestinatarios(rascunho.telefonesTexto), [rascunho.telefonesTexto]);
  const placeholders = template ? extrairPlaceholders(template.conteudo) : [];
  const temParametros = placeholders.length > 0;

  const passos = useMemo(
    () => [
      { id: "template", rotulo: "Template" },
      { id: "destinatarios", rotulo: "Destinatários" },
      ...(temParametros ? [{ id: "parametros", rotulo: "Parâmetros" }] : []),
      { id: "revisar", rotulo: "Revisar" },
    ],
    [temParametros],
  );

  const indice = Math.max(0, passos.findIndex((passo) => passo.id === rascunho.passoId));
  const passoAtual = passos[indice]!.id as PassoId;

  useEffect(() => {
    try {
      sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(rascunho));
    } catch {
      // sem persistência, o fluxo continua funcionando
    }
  }, [rascunho]);

  useEffect(() => {
    const mudou = passoAnterior.current !== null && passoAnterior.current !== passoAtual;
    passoAnterior.current = passoAtual;
    if (mudou) tituloRef.current?.focus();
  }, [passoAtual]);

  const criarCampanha = trpc.campanhas.criar.useMutation({
    onSuccess: async (campanha, variaveis) => {
      try {
        sessionStorage.removeItem(CHAVE_RASCUNHO);
      } catch {
        // ignorado
      }
      setRascunho(RASCUNHO_VAZIO);
      toast.sucesso(
        campanha.agendada && variaveis.agendarPara
          ? `Campanha "${variaveis.nome.trim()}" agendada para ${formatarQuando(variaveis.agendarPara)}, para ${formatarNumero(variaveis.destinatarios.length)} número(s).`
          : `Campanha "${variaveis.nome.trim()}" criada. Disparando para ${formatarNumero(variaveis.destinatarios.length)} número(s).`,
      );
      await Promise.all([
        utils.campanhas.listar.invalidate(),
        utils.dashboard.resumo.invalidate(),
        utils.relatorios.invalidate(),
        utils.calendario.periodo.invalidate(),
      ]);
      // Agendada: o calendário mostra onde ela ficou; enviada agora: a tela da campanha acompanha o envio.
      navegar(campanha.agendada ? { tela: "calendario" } : { tela: "campanhas", campanhaId: campanha.id });
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function atualizar(parcial: Partial<Rascunho>) {
    setRascunho((atual) => ({ ...atual, ...parcial }));
  }

  function motivoDeBloqueio(): string | null {
    switch (passoAtual) {
      case "template":
        if (rascunho.nome.trim() === "") return "Dê um nome à campanha para continuar.";
        if (rascunho.numeroId === null) return "Escolha o número que vai enviar.";
        if (!template) return "Escolha um template para continuar.";
        return null;
      case "parametros": {
        // Uma coluna sem valor padrão só serve se todos os destinatários tiverem aquela célula preenchida.
        const faltando = placeholders.filter((nome) => {
          const origem = rascunho.origens[nome];
          if (!origem) return true;
          if (origem.tipo === "fixo") return origem.valor.trim() === "";
          return origem.padrao.trim() === "" && semValorNaColuna(lista, origem.indice) > 0;
        });
        return faltando.length > 0 ? `Falta definir: ${faltando.join(", ")}.` : null;
      }
      case "destinatarios":
        if (lista.invalidos.length > 0) return "Corrija ou remova as linhas sem telefone válido.";
        if (lista.validos.length === 0) return "Adicione ao menos um telefone válido.";
        if (lista.validos.length > MAX_TELEFONES_POR_CAMPANHA) {
          return `Máximo de ${formatarNumero(MAX_TELEFONES_POR_CAMPANHA)} telefones (você tem ${formatarNumero(lista.validos.length)}).`;
        }
        return null;
      case "revisar": {
        if (!rascunho.agendar) return null;
        const quando = lerCampoDataHora(rascunho.quando);
        if (!quando) return "Escolha a data e a hora do disparo.";
        if (quando.getTime() - Date.now() < ANTECEDENCIA_MIN_AGENDAMENTO_MS) {
          return "Escolha um horário pelo menos 2 minutos à frente, ou dispare agora.";
        }
        return null;
      }
    }
  }

  const bloqueio = motivoDeBloqueio();
  const ehUltimo = indice === passos.length - 1;

  function avancar() {
    if (bloqueio) return;
    if (!ehUltimo) return atualizar({ passoId: passos[indice + 1]!.id as PassoId });
    if (!template || rascunho.numeroId === null) return;

    const quando = rascunho.agendar ? lerCampoDataHora(rascunho.quando) : null;
    criarCampanha.mutate({
      nome: rascunho.nome,
      templateId: template.id,
      numeroId: rascunho.numeroId,
      destinatarios: lista.validos.map((linha) => ({
        telefone: linha.telefone,
        parametros: resolverParametros(linha, rascunho.origens),
      })),
      agendarPara: quando?.toISOString(),
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,44rem)_20rem]">
      <div className="min-w-0">
      <Stepper passos={passos} atual={indice} />

      <Card>
        <h3 ref={tituloRef} tabIndex={-1} className="mb-5 font-heading text-lg font-bold outline-none">
          {TITULOS[passoAtual]}
        </h3>

        {passoAtual === "template" && (
          <PassoTemplate
            nome={rascunho.nome}
            numeroId={rascunho.numeroId}
            templateId={rascunho.templateId}
            onNome={(nome) => atualizar({ nome })}
            // Trocar de número troca a conta, e os templates da conta anterior não valem mais.
            onNumero={(numeroId) =>
              atualizar(numeroId === rascunho.numeroId ? {} : { numeroId, templateId: null, origens: {} })
            }
            onTemplate={(templateId) => atualizar(templateId === rascunho.templateId ? {} : { templateId, origens: {} })}
          />
        )}

        {passoAtual === "parametros" && template && (
          <PassoParametros
            template={template}
            lista={lista}
            origens={rascunho.origens}
            onOrigem={(nome, origem) => atualizar({ origens: { ...rascunho.origens, [nome]: origem } })}
          />
        )}

        {passoAtual === "destinatarios" && template && (
          <PassoDestinatarios
            texto={rascunho.telefonesTexto}
            lista={lista}
            precoUnitario={template.precoUnitario}
            onTexto={(telefonesTexto) => atualizar({ telefonesTexto })}
          />
        )}

        {passoAtual === "revisar" && template && (
          <PassoRevisao
            nome={rascunho.nome}
            template={template}
            origens={rascunho.origens}
            linhas={lista.validos}
            agendar={rascunho.agendar}
            quando={rascunho.quando}
            onAgendar={(agendar) => atualizar({ agendar, quando: agendar && !rascunho.quando ? sugestaoDeHorario() : rascunho.quando })}
            onQuando={(quando) => atualizar({ quando })}
          />
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-card-border pt-5">
          <div>
            {indice > 0 && (
              <Button variante="fantasma" onClick={() => atualizar({ passoId: passos[indice - 1]!.id as PassoId })} disabled={criarCampanha.isPending}>
                ← Voltar
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p role="status" className="text-xs text-ink-2">
              {bloqueio}
            </p>
            <Button onClick={avancar} disabled={bloqueio !== null || criarCampanha.isPending}>
              {ehUltimo
                ? criarCampanha.isPending
                  ? rascunho.agendar
                    ? "Agendando..."
                    : "Disparando..."
                  : rascunho.agendar
                    ? "Agendar disparo"
                    : `Disparar para ${formatarNumero(lista.validos.length)} número(s)`
                : "Avançar →"}
            </Button>
          </div>
        </div>
      </Card>
      </div>

      <ResumoLateral
        nome={rascunho.nome}
        template={template}
        destinatarios={lista.validos.length}
        quando={rascunho.agendar ? lerCampoDataHora(rascunho.quando) : null}
      />
    </div>
  );
}
