import {
  ETAPAS_FUNIL,
  preencherNome,
  preencherTemplate,
  ROTULO_ETAPA_FUNIL,
  type ConfigAniversario,
  type ConfigFollowup,
} from "@atendimento-academias/shared";
import { useState, type ReactNode } from "react";
import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { EstadoErro, Esqueleto } from "../components/ui/EstadoVazio.js";
import { Icone } from "../components/ui/Icone.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { formatarNumero } from "../lib/format.js";
import { hrefDe } from "../lib/route.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Estado = SaidaApi["automacoes"]["estado"];

// Automações da unidade: mensagem de aniversário (campanha diária com template) e follow-up de quem
// parou de responder (dentro da janela de 24h). Só o admin configura.
export function Automacoes() {
  const consulta = trpc.automacoes.estado.useQuery();
  if (consulta.isError) return <EstadoErro mensagem={consulta.error.message} onTentarNovamente={() => void consulta.refetch()} />;
  if (!consulta.data) return <Esqueleto className="h-96" />;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <CartaoAniversario estado={consulta.data} />
      <CartaoFollowup estado={consulta.data} />
    </div>
  );
}

function Interruptor({ ativo, onMudar, rotulo }: { ativo: boolean; onMudar: (v: boolean) => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ativo}
      aria-label={rotulo}
      onClick={() => onMudar(!ativo)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${ativo ? "bg-accent" : "bg-slate-300"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${ativo ? "left-6" : "left-1"}`} />
    </button>
  );
}

function Cabecalho({ icone, titulo, descricao, ativo, onMudar }: { icone: "calendario" | "relogio"; titulo: string; descricao: string; ativo: boolean; onMudar: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
        <Icone nome={icone} tamanho={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-lg font-bold">{titulo}</h2>
        <p className="text-sm text-ink-2">{descricao}</p>
      </div>
      <Interruptor ativo={ativo} onMudar={onMudar} rotulo={`${ativo ? "Desligar" : "Ligar"} ${titulo.toLowerCase()}`} />
    </div>
  );
}

function Campo({ rotulo, children, apoio }: { rotulo: string; children: ReactNode; apoio?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {rotulo}
      {children}
      {apoio && <span className="text-xs font-normal text-ink-3">{apoio}</span>}
    </label>
  );
}

function Previa({ texto }: { texto: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Como chega no WhatsApp</p>
      <p className="max-w-sm whitespace-pre-wrap rounded-xl rounded-tl-sm bg-surface px-3 py-2 text-sm text-ink shadow-card">{texto}</p>
    </div>
  );
}

function CartaoAniversario({ estado }: { estado: Estado }) {
  const utils = trpc.useUtils();
  const [config, setConfig] = useState<ConfigAniversario>(() => ({
    ...estado.aniversario,
    numeroId: estado.aniversario.numeroId ?? estado.numeros[0]?.id ?? null,
  }));
  const salvar = trpc.automacoes.salvarAniversario.useMutation({
    onSuccess: (_r, v) => {
      toast.sucesso(v.ativo ? "Mensagem de aniversário ligada." : "Mensagem de aniversário desligada.");
      void utils.automacoes.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  const template = estado.templates.find((t) => t.id === config.templateId);
  const parametrosDaPrevia = Object.fromEntries(
    Object.entries(config.parametros).map(([nome, origem]) => [nome, origem.tipo === "nome" ? "Ana" : origem.valor || `{{${nome}}}`]),
  );

  function escolherTemplate(id: number | null) {
    const novo = estado.templates.find((t) => t.id === id);
    setConfig((c) => ({
      ...c,
      templateId: id,
      // Placeholder chamado "nome" já vem ligado ao nome do cliente.
      parametros: Object.fromEntries((novo?.placeholders ?? []).map((p) => [p, c.parametros[p] ?? (/nome/i.test(p) ? { tipo: "nome" as const } : { tipo: "fixo" as const, valor: "" })])),
    }));
  }

  return (
    <Card className="flex flex-col gap-5">
      <Cabecalho
        icone="calendario"
        titulo="Mensagem de aniversário"
        descricao="Todo dia, no horário escolhido, os aniversariantes da base recebem um template aprovado."
        ativo={config.ativo}
        onMudar={(ativo) => setConfig((c) => ({ ...c, ativo }))}
      />
      <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
        <strong className="text-ink">{formatarNumero(estado.contatosComNascimento)}</strong> contato(s) com data de nascimento ·{" "}
        <strong className="text-ink">{formatarNumero(estado.aniversariantesHoje)}</strong> fazem aniversário hoje.{" "}
        <a href={hrefDe({ tela: "contatos" })} className="font-semibold text-accent-text hover:underline">
          Completar em Contatos
        </a>
      </p>

      {estado.templates.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nenhum template aprovado ainda.{" "}
          <a href={hrefDe({ tela: "templates", criarNaConta: null })} className="font-semibold text-accent-text hover:underline">
            Crie um em Templates
          </a>
          , por exemplo: "Feliz aniversário, {"{{nome}}"}! Hoje seu treino é por nossa conta 🎉".
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Template">
            <select value={config.templateId ?? ""} onChange={(e) => escolherTemplate(e.target.value ? Number(e.target.value) : null)} className="rounded-lg px-3 py-2 text-sm">
              <option value="">Escolha…</option>
              {estado.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Horário do envio">
            <select value={config.hora} onChange={(e) => setConfig((c) => ({ ...c, hora: Number(e.target.value) }))} className="rounded-lg px-3 py-2 text-sm">
              {Array.from({ length: 14 }, (_, i) => i + 7).map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </Campo>
          {estado.numeros.length > 1 && (
            <Campo rotulo="Número que envia">
              <select value={config.numeroId ?? ""} onChange={(e) => setConfig((c) => ({ ...c, numeroId: Number(e.target.value) }))} className="rounded-lg px-3 py-2 text-sm">
                {estado.numeros.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.numeroExibicao}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </div>
      )}

      {template && template.placeholders.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">O que vai em cada parte do template</p>
          {template.placeholders.map((p) => {
            const origem = config.parametros[p] ?? { tipo: "fixo" as const, valor: "" };
            return (
              <div key={p} className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-surface-2 px-2 py-1 text-xs">{`{{${p}}}`}</code>
                <select
                  value={origem.tipo}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, parametros: { ...c.parametros, [p]: e.target.value === "nome" ? { tipo: "nome" } : { tipo: "fixo", valor: "" } } }))
                  }
                  aria-label={`Origem de ${p}`}
                  className="rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="nome">Primeiro nome do cliente</option>
                  <option value="fixo">Texto fixo</option>
                </select>
                {origem.tipo === "fixo" && (
                  <input
                    value={origem.valor}
                    onChange={(e) => setConfig((c) => ({ ...c, parametros: { ...c.parametros, [p]: { tipo: "fixo", valor: e.target.value } } }))}
                    aria-label={`Texto de ${p}`}
                    maxLength={200}
                    className="min-w-40 flex-1 rounded-lg px-3 py-1.5 text-sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {template && <Previa texto={preencherTemplate(template.conteudo, parametrosDaPrevia)} />}

      <p className="text-xs text-ink-3">
        Sai como uma campanha por dia ("Aniversariantes DD/MM"), cobrada pela Meta como qualquer template. Quem pediu para não receber fica de fora.
        Quem nasceu em 29/02 recebe em 28/02 nos anos não bissextos.
      </p>
      <Button className="self-start" disabled={salvar.isPending} onClick={() => salvar.mutate(config)}>
        {salvar.isPending ? "Salvando…" : "Salvar"}
      </Button>
    </Card>
  );
}

function CartaoFollowup({ estado }: { estado: Estado }) {
  const utils = trpc.useUtils();
  const [config, setConfig] = useState<ConfigFollowup>(estado.followup);
  const salvar = trpc.automacoes.salvarFollowup.useMutation({
    onSuccess: (_r, v) => {
      toast.sucesso(v.ativo ? "Follow-up ligado." : "Follow-up desligado.");
      void utils.automacoes.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  return (
    <Card className="flex flex-col gap-5">
      <Cabecalho
        icone="relogio"
        titulo="Follow-up automático"
        descricao="Quem parou de responder depois da nossa última mensagem recebe um lembrete, uma vez."
        ativo={config.ativo}
        onMudar={(ativo) => setConfig((c) => ({ ...c, ativo }))}
      />
      <Campo rotulo="Depois de quantas horas sem resposta" apoio="O lembrete só sai enquanto a janela de 24h do WhatsApp está aberta (mensagem livre, sem custo).">
        <select value={config.horas} onChange={(e) => setConfig((c) => ({ ...c, horas: Number(e.target.value) }))} className="max-w-40 rounded-lg px-3 py-2 text-sm">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h} hora{h > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Mensagem" apoio="{nome} vira o primeiro nome do cliente.">
        <textarea value={config.texto} onChange={(e) => setConfig((c) => ({ ...c, texto: e.target.value }))} rows={3} maxLength={1000} className="rounded-lg px-3 py-2 text-sm" />
      </Campo>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Só para clientes nestas etapas do funil</legend>
        <div className="flex flex-wrap gap-2">
          {ETAPAS_FUNIL.filter((e) => e !== "fechou" && e !== "nao_fechou").map((etapa) => {
            const marcada = config.etapas.includes(etapa);
            return (
              <label key={etapa} className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 ring-inset ${marcada ? "bg-accent-soft text-accent-text ring-accent/30" : "ring-card-border"}`}>
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={() => setConfig((c) => ({ ...c, etapas: marcada ? c.etapas.filter((x) => x !== etapa) : [...c.etapas, etapa] }))}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {ROTULO_ETAPA_FUNIL[etapa]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <Previa texto={preencherNome(config.texto, "Ana Souza")} />
      <p className="text-xs text-ink-3">
        Não vai para quem está com uma pessoa da equipe, pediu para não receber campanhas ou já fechou/desistiu. Sai pelo mesmo número da conversa.
      </p>
      <Button className="self-start" disabled={salvar.isPending || config.etapas.length === 0 || !config.texto.trim()} onClick={() => salvar.mutate(config)}>
        {salvar.isPending ? "Salvando…" : "Salvar"}
      </Button>
    </Card>
  );
}
