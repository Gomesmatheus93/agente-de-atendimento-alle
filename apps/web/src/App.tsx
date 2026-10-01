import { Layout } from "./components/Layout.js";
import { useRota } from "./lib/route.js";
import { trpc } from "./lib/trpc.js";
import { Login } from "./pages/Login.js";
import { Campanhas } from "./pages/Campanhas.js";
import { Configuracoes } from "./pages/Configuracoes.js";
import { Usuarios } from "./pages/Usuarios.js";
import { NovaCampanha } from "./pages/NovaCampanha/NovaCampanha.js";
import { Calendario } from "./pages/Calendario.js";
import { Conversas } from "./pages/Conversas.js";
import { Duvidas } from "./pages/Duvidas.js";
import { Funil } from "./pages/Funil.js";
import { Relatorios } from "./pages/Relatorios.js";
import { NovoTemplate } from "./pages/NovoTemplate.js";
import { Templates } from "./pages/Templates.js";
import { VisaoGeral } from "./pages/VisaoGeral.js";

export function App() {
  const utils = trpc.useUtils();
  // Enquanto não se sabe quem é, nada do painel é montado: as telas consultam rotas que exigem sessão.
  const estado = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 });

  if (estado.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg px-6">
        <div role="status" className="flex flex-col items-center gap-4 text-center">
          <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-sidebar shadow-pop">
            <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-2xl bg-accent/15" />
            <img src="/allp-simbolo.png" alt="" aria-hidden="true" className="relative h-8 w-auto" />
          </span>
          <span>
            <span className="block font-heading text-lg font-extrabold text-ink">Allp <span className="text-brand-2-text">Chat</span></span>
            <span className="mt-1 block text-xs text-ink-3">Preparando sua central…</span>
          </span>
        </div>
      </div>
    );
  }

  if (!estado.data?.usuario) {
    return (
      <Login
        primeiroAcesso={estado.data?.precisaPrimeiroAcesso ?? false}
        onEntrou={() => {
          void utils.invalidate();
        }}
      />
    );
  }

  return <Painel />;
}

function Painel() {
  const rota = useRota();

  switch (rota.tela) {
    case "visao-geral":
      return (
        <Layout telaAtiva="visao-geral" titulo="Visão geral" descricao="Acompanhe o desempenho dos seus disparos de WhatsApp.">
          <VisaoGeral />
        </Layout>
      );
    case "nova-campanha":
      return (
        <Layout
          telaAtiva="nova-campanha"
          titulo="Nova campanha"
          descricao="Escolha o template, defina os destinatários e revise antes de disparar."
        >
          <NovaCampanha />
        </Layout>
      );
    case "campanhas":
      return (
        <Layout
          telaAtiva="campanhas"
          titulo="Campanhas"
          descricao="Status de envio de cada número, atualizado em tempo real."
          ampla
        >
          <Campanhas campanhaId={rota.campanhaId} />
        </Layout>
      );
    case "calendario":
      return (
        <Layout
          telaAtiva="calendario"
          titulo="Calendário"
          descricao="Os disparos agendados e os que já foram enviados, dia a dia."
          ampla
        >
          <Calendario />
        </Layout>
      );
    case "templates":
      return (
        <Layout
          telaAtiva="templates"
          titulo={rota.criarNaConta === null ? "Templates" : "Novo template"}
          descricao={
            rota.criarNaConta === null
              ? "Os templates de cada conta do WhatsApp: crie, envie para aprovação da Meta e acompanhe o resultado."
              : "Comece por um modelo ou do zero. A Meta analisa antes de o template poder ser usado."
          }
        >
          {rota.criarNaConta === null ? <Templates /> : <NovoTemplate contaId={rota.criarNaConta} />}
        </Layout>
      );
    case "funil":
      return (
        <Layout
          telaAtiva="funil"
          titulo="Funil de clientes"
          descricao="Quem está perto de fechar, quem fechou e por que os outros não fecharam."
          ampla
        >
          <Funil />
        </Layout>
      );
    case "configuracoes":
      return (
        <Layout
          telaAtiva="configuracoes"
          titulo="Configurações"
          descricao="Contas do WhatsApp, números da operação e webhook — tudo pela plataforma."
        >
          <Configuracoes />
        </Layout>
      );
    case "usuarios":
      return (
        <Layout telaAtiva="usuarios" titulo="Usuários" descricao="Quem pode entrar no painel e o que cada um pode fazer.">
          <Usuarios />
        </Layout>
      );
    case "conversas":
      return (
        <Layout
          telaAtiva="conversas"
          titulo="Conversas"
          descricao="As respostas dos clientes aos seus disparos, reunidas em um só lugar."
          ampla
        >
          <Conversas telefone={rota.telefone} numeroId={rota.numeroId} />
        </Layout>
      );
    case "relatorios":
      return (
        <Layout
          telaAtiva="relatorios"
          titulo="Relatórios"
          descricao="Desempenho das campanhas: quantos clientes responderam e quanto cada resposta custou."
        >
          <Relatorios />
        </Layout>
      );
    case "duvidas":
      return (
        <Layout
          telaAtiva="duvidas"
          titulo="Ranking de dúvidas"
          descricao="Os assuntos que os clientes mais perguntam ao responder seus disparos."
        >
          <Duvidas />
        </Layout>
      );
  }
}
