import { TAMANHO_MIN_SENHA } from "@atendimento-academias/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button.js";
import { Icone } from "../components/ui/Icone.js";
import { mensagemDeErro } from "../lib/erro.js";
import { trpc } from "../lib/trpc.js";

export function Login({ primeiroAcesso, onEntrou }: { primeiroAcesso: boolean; onEntrou: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senhaVisivel, setSenhaVisivel] = useState(false);

  const entrar = trpc.auth.entrar.useMutation({ onSuccess: onEntrou });
  const criarPrimeiro = trpc.auth.criarPrimeiroUsuario.useMutation({ onSuccess: onEntrou });
  const acao = primeiroAcesso ? criarPrimeiro : entrar;

  useEffect(() => {
    document.title = `${primeiroAcesso ? "Primeiro acesso" : "Entrar"} · Allp Chat`;
  }, [primeiroAcesso]);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (primeiroAcesso) criarPrimeiro.mutate({ nome, email, senha });
    else entrar.mutate({ email, senha });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/allp-simbolo.png" alt="" aria-hidden="true" className="h-9 w-auto" />
          <div>
            <h1 className="font-heading text-xl font-bold text-ink">{primeiroAcesso ? "Crie o primeiro acesso" : "Entrar"}</h1>
            <p className="mt-1 text-sm text-ink-2">
              {primeiroAcesso
                ? "Ninguém entrou ainda. Quem começa vira o superadmin, que cria as unidades."
                : "Allp Chat"}
            </p>
          </div>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4 rounded-2xl border border-card-border p-6">
          {primeiroAcesso && (
            <Campo rotulo="Seu nome">
              <input
                value={nome}
                onChange={(evento) => setNome(evento.target.value)}
                autoComplete="name"
                required
                className="w-full px-3.5 py-2.5 text-sm"
              />
            </Campo>
          )}

          <Campo rotulo="E-mail">
            <input
              type="email"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              autoComplete="username"
              required
              className="w-full px-3.5 py-2.5 text-sm"
            />
          </Campo>

          <Campo rotulo="Senha" ajuda={primeiroAcesso ? `Pelo menos ${TAMANHO_MIN_SENHA} caracteres.` : undefined}>
            <span className="relative block min-w-0">
              <input
                type={senhaVisivel ? "text" : "password"}
                value={senha}
                onChange={(evento) => setSenha(evento.target.value)}
                autoComplete={primeiroAcesso ? "new-password" : "current-password"}
                minLength={primeiroAcesso ? TAMANHO_MIN_SENHA : undefined}
                required
                className="w-full px-3.5 py-2.5 pr-16 text-sm"
              />
              <button
                type="button"
                onClick={() => setSenhaVisivel((visivel) => !visivel)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-2 hover:text-ink"
              >
                {senhaVisivel ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </Campo>

          {acao.error && (
            <p role="alert" className="text-sm text-status-falhou">
              {mensagemDeErro(acao.error)}
            </p>
          )}

          <Button type="submit" disabled={acao.isPending} className="mt-1 w-full py-2.5">
            {acao.isPending ? "Entrando…" : primeiroAcesso ? "Criar acesso e entrar" : "Entrar"}
            {!acao.isPending && <Icone nome="setaDireita" tamanho={16} />}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {rotulo}
      {children}
      {ajuda && <span className="text-xs font-normal text-ink-2">{ajuda}</span>}
    </label>
  );
}
