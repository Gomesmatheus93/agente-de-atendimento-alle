import { PAPEIS_DA_UNIDADE, ROTULO_PAPEL, TAMANHO_MIN_SENHA, type PapelDaUnidade } from "@atendimento-academias/shared";
import { useState, type FormEvent } from "react";
import { Card } from "../components/Card.js";
import { Button } from "../components/ui/Button.js";
import { toast } from "../components/ui/Toast.js";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc, type SaidaApi } from "../lib/trpc.js";

type Usuario = SaidaApi["usuarios"]["listar"][number];

export function Usuarios() {
  const utils = trpc.useUtils();
  const usuariosQuery = trpc.usuarios.listar.useQuery();
  const recarregar = () => void utils.usuarios.listar.invalidate();

  if (usuariosQuery.isError) {
    return <p className="text-sm text-ink-2">{mensagemDeErro(usuariosQuery.error)}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <NovoUsuario onCriado={recarregar} />

      <Card>
        <h3 className="font-heading text-base font-bold">Equipe da unidade</h3>
        <p className="mt-1 text-sm text-ink-2">
          O administrador cuida das configurações e da equipe; os funcionários atendem as conversas. Desativar ou trocar
          a senha derruba as sessões abertas da pessoa na hora.
        </p>

        <ul className="mt-4 flex flex-col divide-y divide-card-border border-y border-card-border">
          {usuariosQuery.isPending && <li className="py-3 text-sm text-ink-2">Carregando…</li>}
          {usuariosQuery.data?.map((usuario) => (
            <LinhaDoUsuario key={usuario.id} usuario={usuario} onMudou={recarregar} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function NovoUsuario({ onCriado }: { onCriado: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [papel, setPapel] = useState<PapelDaUnidade>("membro");

  const criar = trpc.usuarios.criar.useMutation({
    onSuccess: (usuario) => {
      toast.sucesso(`${usuario.nome} já pode entrar com esse e-mail e senha.`);
      setNome("");
      setEmail("");
      setSenha("");
      setPapel("membro");
      onCriado();
    },
    onError: (erro) => toast.erro(mensagemDeErro(erro)),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    criar.mutate({ nome, email, senha, papel });
  }

  return (
    <Card>
      <h3 className="font-heading text-base font-bold">Adicionar à equipe</h3>
      <p className="mt-1 text-sm text-ink-2">
        Você define a senha e a repassa para a pessoa. Não há e-mail de convite: quem receber entra direto com esses dados.
      </p>

      <form onSubmit={enviar} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required className="rounded-lg px-3 py-2 text-sm" />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg px-3 py-2 text-sm"
          />
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

        <label className="flex flex-col gap-1 text-sm font-medium">
          Papel
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value as PapelDaUnidade)}
            className="rounded-lg px-3 py-2 text-sm"
          >
            {PAPEIS_DA_UNIDADE.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_PAPEL[opcao]}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" disabled={criar.isPending} className="self-start sm:col-span-2">
          {criar.isPending ? "Criando…" : "Adicionar"}
        </Button>
      </form>
    </Card>
  );
}

function LinhaDoUsuario({ usuario, onMudou }: { usuario: Usuario; onMudou: () => void }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);

  const aoErrar = (erro: Parameters<typeof mensagemDeErro>[0]) => toast.erro(mensagemDeErro(erro));

  const atualizar = trpc.usuarios.atualizar.useMutation({ onSuccess: onMudou, onError: aoErrar });
  const remover = trpc.usuarios.remover.useMutation({
    onSuccess: () => {
      toast.sucesso("Usuário removido.");
      onMudou();
    },
    onError: aoErrar,
  });
  const redefinirSenha = trpc.usuarios.redefinirSenha.useMutation({
    onSuccess: () => {
      toast.sucesso("Senha trocada. As sessões abertas dessa pessoa foram encerradas.");
      setNovaSenha("");
      setTrocandoSenha(false);
    },
    onError: aoErrar,
  });

  const ocupado = atualizar.isPending || remover.isPending || redefinirSenha.isPending;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {usuario.nome}
            {usuario.souEu && <span className="ml-1 text-xs font-normal text-ink-2">(você)</span>}
            {!usuario.ativo && (
              <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">Desativado</span>
            )}
          </p>
          <p className="truncate text-xs text-ink-2">{usuario.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={usuario.papel}
            disabled={ocupado}
            onChange={(e) => atualizar.mutate({ id: usuario.id, papel: e.target.value as PapelDaUnidade })}
            className="rounded-lg px-2 py-1 text-xs"
            aria-label={`Papel de ${usuario.nome}`}
          >
            {PAPEIS_DA_UNIDADE.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_PAPEL[opcao]}
              </option>
            ))}
          </select>

          <Button
            variante="secundario"
            className="px-2.5 py-1 text-xs"
            disabled={ocupado}
            onClick={() => setTrocandoSenha((aberto) => !aberto)}
          >
            Trocar senha
          </Button>

          <Button
            variante="secundario"
            className="px-2.5 py-1 text-xs"
            disabled={ocupado}
            onClick={() => atualizar.mutate({ id: usuario.id, ativo: !usuario.ativo })}
          >
            {usuario.ativo ? "Desativar" : "Reativar"}
          </Button>

          {!usuario.souEu && (
            <Button
              variante="fantasma"
              className="px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm(`Remover o acesso de ${usuario.nome}?`)) remover.mutate({ id: usuario.id });
              }}
            >
              Remover
            </Button>
          )}
        </div>
      </div>

      {trocandoSenha && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            placeholder={`Nova senha (mín. ${TAMANHO_MIN_SENHA})`}
            className="min-w-52 flex-1 rounded-lg px-3 py-1.5 font-mono text-sm"
          />
          <Button
            className="px-3 py-1.5 text-xs"
            disabled={novaSenha.length < TAMANHO_MIN_SENHA || ocupado}
            onClick={() => redefinirSenha.mutate({ id: usuario.id, senha: novaSenha })}
          >
            Salvar senha
          </Button>
        </div>
      )}
    </li>
  );
}
