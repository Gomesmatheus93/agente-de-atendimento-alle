import { TAMANHO_MIN_SENHA } from "@atendimento-academias/shared";
import { useState, type FormEvent } from "react";
import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Unidade = SaidaApi["unidades"]["listar"][number];

// Só o superadmin: cria as unidades (cada uma já com o dono) e escolhe em qual está trabalhando.
export function Unidades() {
  const utils = trpc.useUtils();
  const unidades = trpc.unidades.listar.useQuery();
  const recarregar = () => void utils.unidades.listar.invalidate();

  if (unidades.isError) return <p className="text-sm text-ink-2">{mensagemDeErro(unidades.error)}</p>;

  return (
    <div className="flex flex-col gap-6">
      <NovaUnidade onCriada={recarregar} />

      <Card>
        <h3 className="font-heading text-base font-bold">Unidades</h3>
        <p className="mt-1 text-sm text-ink-2">
          Cada unidade é um painel separado: números, conversas, campanhas, templates, configurações e equipe próprios. Para
          ver ou configurar uma, entre nela (também dá pelo seletor do menu).
        </p>

        <ul className="mt-4 flex flex-col divide-y divide-card-border border-y border-card-border">
          {unidades.isPending && <li className="py-3 text-sm text-ink-2">Carregando…</li>}
          {unidades.data?.length === 0 && <li className="py-3 text-sm text-ink-2">Nenhuma unidade ainda.</li>}
          {unidades.data?.map((unidade) => <LinhaDaUnidade key={unidade.id} unidade={unidade} onMudou={recarregar} />)}
        </ul>
      </Card>
    </div>
  );
}

function NovaUnidade({ onCriada }: { onCriada: () => void }) {
  const [nome, setNome] = useState("");
  const [adminNome, setAdminNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const criar = trpc.unidades.criar.useMutation({
    onSuccess: () => {
      toast.sucesso(`Unidade ${nome} criada. ${adminNome} já pode entrar com esse e-mail e senha.`);
      setNome("");
      setAdminNome("");
      setEmail("");
      setSenha("");
      onCriada();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    criar.mutate({ nome, admin: { nome: adminNome, email, senha } });
  }

  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Nova unidade</h3>
      <p className="mt-1 text-sm text-ink-2">
        O responsável (dono da unidade) entra com o e-mail e a senha abaixo, cadastra o número de atendimento em
        Configurações e cria os usuários dos funcionários.
      </p>

      <form onSubmit={enviar} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Nome da unidade
          <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Allp Fit Centro" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nome do responsável
          <input value={adminNome} onChange={(e) => setAdminNome(e.target.value)} required className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          E-mail do responsável
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Senha provisória
          <input
            type="text"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={TAMANHO_MIN_SENHA}
            required
            className="rounded-lg px-3 py-2 font-mono text-sm"
          />
          <span className="text-xs font-normal text-ink-2">Pelo menos {TAMANHO_MIN_SENHA} caracteres.</span>
        </label>

        <Button type="submit" disabled={criar.isPending} className="self-start sm:col-span-2">
          {criar.isPending ? "Criando…" : "Criar unidade"}
        </Button>
      </form>
    </Card>
  );
}

function LinhaDaUnidade({ unidade, onMudou }: { unidade: Unidade; onMudou: () => void }) {
  const utils = trpc.useUtils();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(unidade.nome);
  const aoErrar = (erro: Parameters<typeof mensagemDeErro>[0]) => toast.erro(mensagemDeErro(erro));

  const atualizar = trpc.unidades.atualizar.useMutation({
    onSuccess: () => {
      setEditando(false);
      onMudou();
    },
    onError: aoErrar,
  });
  const entrar = trpc.unidades.entrar.useMutation({
    onSuccess: () => {
      toast.sucesso(`Agora você está na unidade ${unidade.nome}.`);
      // Tudo o que estava na tela era da unidade anterior.
      void utils.invalidate();
    },
    onError: aoErrar,
  });
  const ocupado = atualizar.isPending || entrar.isPending;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        {editando ? (
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              atualizar.mutate({ id: unidade.id, nome });
            }}
            className="flex items-center gap-2"
          >
            <input value={nome} onChange={(e) => setNome(e.target.value)} required aria-label="Nome da unidade" className="rounded-lg px-2.5 py-1 text-sm" />
            <Button type="submit" className="px-2.5 py-1 text-xs" disabled={ocupado}>
              Salvar
            </Button>
          </form>
        ) : (
          <p className="truncate text-sm font-semibold">
            {unidade.nome}
            {unidade.atual && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent-text">Você está aqui</span>}
            {!unidade.ativo && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">Desativada</span>}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-ink-2">
          {unidade.usuarios} {unidade.usuarios === 1 ? "pessoa" : "pessoas"} na equipe ·{" "}
          {unidade.numeros.length > 0 ? unidade.numeros.join(", ") : "nenhum número ativo"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!unidade.atual && unidade.ativo && (
          <Button className="px-2.5 py-1 text-xs" disabled={ocupado} onClick={() => entrar.mutate({ id: unidade.id })}>
            Entrar
          </Button>
        )}
        <Button variante="secundario" className="px-2.5 py-1 text-xs" disabled={ocupado} onClick={() => setEditando((aberto) => !aberto)}>
          {editando ? "Cancelar" : "Renomear"}
        </Button>
        <Button
          variante="secundario"
          className="px-2.5 py-1 text-xs"
          disabled={ocupado}
          onClick={() => {
            if (
              !unidade.ativo ||
              window.confirm(`Desativar ${unidade.nome}? A equipe perde o acesso e os números param de receber mensagens.`)
            ) {
              atualizar.mutate({ id: unidade.id, ativo: !unidade.ativo });
            }
          }}
        >
          {unidade.ativo ? "Desativar" : "Reativar"}
        </Button>
      </div>
    </li>
  );
}
