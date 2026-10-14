import { useState, type FormEvent } from "react";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc } from "../lib/trpc.js";
import { Card } from "./Card.js";
import { Button } from "./ui/Button.js";
import { Icone } from "./ui/Icone.js";
import { toast } from "./ui/Toast.js";

// Situação do cliente no EVO (sistema da academia), no cabeçalho da conversa: aluno, lead ou não
// cadastrado — e, se não estiver lá, um botão para cadastrar como lead.
export function SeloEvo({ telefone, numeroId, nome }: { telefone: string; numeroId: number; nome: string | null }) {
  const consulta = trpc.evo.cliente.useQuery({ telefone, numeroId }, { staleTime: 5 * 60_000, retry: false });
  const [cadastrando, setCadastrando] = useState(false);
  const dados = consulta.data;
  if (!dados || dados.situacao === "nao_configurado") return null;

  const base = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold";
  let selo;
  if (dados.situacao === "aluno") {
    const plano = dados.aluno.planos[0];
    selo = (
      <span
        className={`${base} ${dados.aluno.ativo ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-ink-2"}`}
        title={`EVO: aluno #${dados.aluno.id}${dados.aluno.status ? ` · ${dados.aluno.status}` : ""}${plano ? ` · ${plano.nome}${plano.vencimento ? ` até ${new Date(plano.vencimento).toLocaleDateString("pt-BR")}` : ""}` : ""}${dados.aluno.bloqueado ? " · acesso bloqueado" : ""}`}
      >
        <Icone nome="check" tamanho={13} />
        {dados.aluno.ativo ? "Aluno ativo" : "Aluno inativo"}
      </span>
    );
  } else if (dados.situacao === "lead") {
    selo = (
      <span className={`${base} bg-sky-50 text-sky-800`} title={`EVO: lead #${dados.lead.id}${dados.lead.cadastradoEm ? ` desde ${new Date(dados.lead.cadastradoEm).toLocaleDateString("pt-BR")}` : ""}`}>
        <Icone nome="usuarios" tamanho={13} />
        Lead no EVO
      </span>
    );
  } else if (dados.situacao === "erro") {
    selo = (
      <span className={`${base} bg-amber-50 text-amber-900`} title={dados.mensagem}>
        <Icone nome="alerta" tamanho={13} />
        EVO indisponível
      </span>
    );
  } else {
    selo = (
      <button
        type="button"
        onClick={() => setCadastrando(true)}
        className={`${base} border border-dashed border-card-border text-ink-2 hover:border-accent hover:text-accent-text`}
        title="Este telefone não está no EVO. Clique para cadastrar como lead."
      >
        <Icone nome="mais" tamanho={13} />
        Cadastrar no EVO
      </button>
    );
  }

  return (
    <>
      {selo}
      {cadastrando && <CadastroEvo telefone={telefone} numeroId={numeroId} nomeInicial={nome ?? ""} onFechar={() => setCadastrando(false)} />}
    </>
  );
}

function CadastroEvo({ telefone, numeroId, nomeInicial, onFechar }: { telefone: string; numeroId: number; nomeInicial: string; onFechar: () => void }) {
  const utils = trpc.useUtils();
  const [nome, setNome] = useState(nomeInicial);
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [nascimento, setNascimento] = useState("");
  const cadastrar = trpc.evo.cadastrar.useMutation({
    onSuccess: (resultado) => {
      toast.sucesso(resultado.criado ? "Cadastrado no EVO como lead." : "Este cliente já estava no EVO.");
      void utils.evo.cliente.invalidate({ telefone, numeroId });
      onFechar();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    cadastrar.mutate({ telefone, numeroId, nome, cpf: cpf || null, email: email || null, nascimento: nascimento || null });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Cadastrar no EVO" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={enviar} className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-surface p-5 shadow-pop">
        <div>
          <h3 className="font-heading text-base font-bold">Cadastrar no EVO</h3>
          <p className="mt-1 text-sm text-ink-2">Entra como lead (prospect), com o WhatsApp da conversa. A matrícula com plano continua sendo feita no EVO.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nome completo
          <input value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            CPF <span className="text-xs font-normal text-ink-3">(opcional)</span>
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className="rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nascimento <span className="text-xs font-normal text-ink-3">(opcional)</span>
            <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className="rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          E-mail <span className="text-xs font-normal text-ink-3">(opcional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variante="fantasma" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={cadastrar.isPending}>
            {cadastrar.isPending ? "Cadastrando…" : "Cadastrar"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Configurações → EVO: DNS da academia e chave da API (Integração no EVO). Salvar já testa.
export function ConfiguracaoEvo() {
  const utils = trpc.useUtils();
  const estado = trpc.evo.estado.useQuery();
  const [dns, setDns] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [idBranch, setIdBranch] = useState<string | null>(null);
  const salvar = trpc.evo.salvar.useMutation({
    onSuccess: () => {
      toast.sucesso("EVO conectado: a conexão foi testada e funcionou.");
      setChave("");
      void utils.evo.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  const atual = estado.data;
  const valorDns = dns ?? atual?.dns ?? "";
  const valorBranch = idBranch ?? (atual?.idBranch ? String(atual.idBranch) : "");

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    salvar.mutate({ dns: valorDns, chave: chave || undefined, idBranch: valorBranch ? Number(valorBranch) : null });
  }

  return (
    <Card>
      <h3 className="font-heading text-base font-bold">EVO (sistema da academia)</h3>
      <p className="mt-1 text-sm text-ink-2">
        Com o EVO ligado, o bot sabe se quem está falando já é aluno ou lead, e cadastra como lead quem ainda não está lá.
        Os dados ficam no EVO em <strong>Configurações → Integração → API</strong>.
        {atual?.configurado && <span className="ml-1 font-semibold text-emerald-700">Conectado.</span>}
      </p>
      <form onSubmit={enviar} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          DNS da academia
          <input value={valorDns} onChange={(e) => setDns(e.target.value)} required placeholder="ex.: allpfit" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Chave da API
          <input
            type="password"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            required={!atual?.configurado}
            placeholder={atual?.chaveFinal ? `•••• ${atual.chaveFinal} (deixe em branco para manter)` : ""}
            autoComplete="off"
            className="rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Id da filial <span className="text-xs font-normal text-ink-3">(só chave multilocal)</span>
          <input value={valorBranch} onChange={(e) => setIdBranch(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="rounded-lg px-3 py-2 text-sm" />
        </label>
        <Button type="submit" disabled={salvar.isPending} className="self-start sm:col-span-3">
          {salvar.isPending ? "Testando…" : atual?.configurado ? "Salvar e testar" : "Conectar EVO"}
        </Button>
      </form>
    </Card>
  );
}

// Lista de "não quero receber campanhas": selo quando o cliente está nela, e o botão para a equipe
// bloquear (pediu por outro canal) ou liberar (pediu para voltar).
export function SeloDescadastro({ telefone, numeroId }: { telefone: string; numeroId: number }) {
  const utils = trpc.useUtils();
  const situacao = trpc.descadastros.situacao.useQuery({ telefone, numeroId }, { staleTime: 60_000 });
  const definir = trpc.descadastros.definir.useMutation({
    onSuccess: (resultado) => {
      toast.sucesso(resultado.bloqueado ? "Este cliente não vai mais receber campanhas." : "Cliente liberado para receber campanhas.");
      void utils.descadastros.invalidate();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });
  if (!situacao.data) return null;
  if (situacao.data.bloqueado) {
    const origem = { cliente: "o cliente pediu", equipe: "bloqueado pela equipe", meta: "o cliente parou de aceitar marketing no WhatsApp" }[situacao.data.origem];
    return (
      <button
        type="button"
        onClick={() => {
          if (window.confirm("Liberar este cliente para voltar a receber campanhas? Só faça isso se ele pediu.")) definir.mutate({ telefone, numeroId, bloqueado: false });
        }}
        disabled={definir.isPending}
        title={`Fora das campanhas: ${origem}. Clique para liberar.`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-50 px-2.5 text-xs font-semibold text-red-700"
      >
        <Icone nome="proibido" tamanho={13} />
        Não recebe campanhas
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm("Tirar este cliente das campanhas? Ele continua podendo conversar com a unidade.")) definir.mutate({ telefone, numeroId, bloqueado: true });
      }}
      disabled={definir.isPending}
      aria-label="Não enviar campanhas para este cliente"
      title="Não enviar campanhas para este cliente"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-red-50 hover:text-red-700"
    >
      <Icone nome="proibido" tamanho={16} />
    </button>
  );
}
