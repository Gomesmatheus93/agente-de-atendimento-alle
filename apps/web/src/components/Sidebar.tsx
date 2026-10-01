import { useEffect, useState } from "react";
import { hrefDe, type Rota } from "../lib/route.js";
import { useTema } from "../lib/tema.js";
import { trpc } from "../lib/trpc.js";
import { Icone, type NomeIcone } from "./ui/Icone.js";

type Tela = Rota["tela"];

interface ItemMenu {
  tela: Tela;
  label: string;
  href: string;
  icone: NomeIcone;
  // Itens de administração só aparecem para quem é admin.
  soAdmin?: boolean;
}

const GRUPOS: Array<{ titulo: string; itens: ItemMenu[] }> = [
  {
    titulo: "Operação",
    itens: [
      { tela: "visao-geral", label: "Visão geral", href: hrefDe({ tela: "visao-geral" }), icone: "painel" },
      { tela: "conversas", label: "Conversas", href: hrefDe({ tela: "conversas", telefone: null, numeroId: null }), icone: "mensagem" },
      { tela: "funil", label: "Funil de clientes", href: hrefDe({ tela: "funil" }), icone: "funil" },
      { tela: "campanhas", label: "Campanhas", href: hrefDe({ tela: "campanhas", campanhaId: null }), icone: "kanban" },
      { tela: "calendario", label: "Calendário", href: hrefDe({ tela: "calendario" }), icone: "calendario" },
    ],
  },
  {
    titulo: "Análise",
    itens: [
      { tela: "relatorios", label: "Relatórios", href: hrefDe({ tela: "relatorios" }), icone: "grafico" },
      { tela: "duvidas", label: "Dúvidas", href: hrefDe({ tela: "duvidas" }), icone: "duvida" },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { tela: "templates", label: "Templates", href: hrefDe({ tela: "templates", criarNaConta: null }), icone: "documento" },
      { tela: "configuracoes", label: "Configurações", href: hrefDe({ tela: "configuracoes" }), icone: "engrenagem" },
      { tela: "usuarios", label: "Usuários", href: hrefDe({ tela: "usuarios" }), icone: "usuarios", soAdmin: true },
    ],
  },
];

function Marca() {
  return (
    <a href={hrefDe({ tela: "visao-geral" })} aria-label="Allp Chat — início" className="flex items-center gap-2.5 rounded-lg px-1">
      <img src="/allp-simbolo.png" alt="" aria-hidden="true" className="h-6 w-auto shrink-0" />
      <span className="font-heading text-base font-bold tracking-tight text-sidebar-ink">
        Allp <span className="text-brand-2">Chat</span>
      </span>
    </a>
  );
}

function Menu({ telaAtiva, onNavegar }: { telaAtiva: Tela; onNavegar?: () => void }) {
  // Conversas com mensagem ainda não lida; atualiza sozinho para o aviso aparecer sem recarregar.
  const naoLidas = trpc.conversas.contarNaoLidas.useQuery(undefined, { refetchInterval: 10_000 }).data?.conversas ?? 0;
  const ehAdmin = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario?.papel === "admin";

  const grupos = GRUPOS.map((grupo) => ({
    ...grupo,
    itens: grupo.itens.filter((item) => !item.soAdmin || ehAdmin),
  })).filter((grupo) => grupo.itens.length > 0);

  return (
    <nav aria-label="Principal" className="flex flex-col gap-5">
      {grupos.map((grupo) => (
        <div key={grupo.titulo} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-ink-2/60">{grupo.titulo}</p>
          {grupo.itens.map((item) => {
            const ativo = item.tela === telaAtiva;
            return (
              <a
                key={item.tela}
                href={item.href}
                onClick={onNavegar}
                aria-current={ativo ? "page" : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  ativo
                    ? "bg-white/10 font-medium text-sidebar-ink"
                    : "text-sidebar-ink-2 hover:bg-white/[0.05] hover:text-sidebar-ink"
                }`}
              >
                <Icone nome={item.icone} tamanho={16} className={ativo ? "text-brand-2" : ""} />
                <span className="truncate">{item.label}</span>
                {item.tela === "conversas" && naoLidas > 0 && (
                  <span
                    aria-label={`${naoLidas} conversa${naoLidas > 1 ? "s" : ""} com mensagem não lida`}
                    className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-2 px-1 text-[10px] font-bold text-brand-2-contrast"
                  >
                    {naoLidas > 99 ? "99+" : naoLidas}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BotaoNovaCampanha({ ativa, onNavegar }: { ativa: boolean; onNavegar?: () => void }) {
  return (
    <a
      href={hrefDe({ tela: "nova-campanha" })}
      onClick={onNavegar}
      aria-current={ativa ? "page" : undefined}
      className={`flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-semibold transition-colors ${
        ativa
          ? "border-brand-2/30 bg-brand-2/15 text-brand-2"
          : "border-white/10 bg-white/[0.06] text-sidebar-ink hover:bg-white/10"
      }`}
    >
      <Icone nome="mais" tamanho={15} />
      Nova campanha
    </a>
  );
}

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

// Rodapé: quem está logado, tema e saída, em uma linha só — o bloco antigo ocupava três.
function Rodape() {
  const utils = trpc.useUtils();
  const { tema, alternar } = useTema();
  const estado = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const sair = trpc.auth.sair.useMutation({ onSettled: () => void utils.invalidate() });

  const usuario = estado.data?.usuario;
  if (!usuario) return null;

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-linha pt-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-sidebar-ink"
      >
        {iniciais(usuario.nome)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-sidebar-ink">{usuario.nome}</span>
        <span className="mt-0.5 block text-[10px] capitalize text-sidebar-ink-2">{usuario.papel}</span>
      </span>

      <button
        type="button"
        onClick={alternar}
        aria-label={tema === "claro" ? "Usar tema escuro" : "Usar tema claro"}
        title={tema === "claro" ? "Usar tema escuro" : "Usar tema claro"}
        className="rounded-lg p-1.5 text-sidebar-ink-2 transition-colors hover:bg-white/10 hover:text-sidebar-ink"
      >
        <Icone nome={tema === "claro" ? "lua" : "sol"} tamanho={15} />
      </button>
      <button
        type="button"
        onClick={() => sair.mutate()}
        disabled={sair.isPending}
        aria-label="Sair"
        title="Sair"
        className="rounded-lg p-1.5 text-sidebar-ink-2 transition-colors hover:bg-white/10 hover:text-sidebar-ink disabled:opacity-50"
      >
        <Icone nome="sair" tamanho={15} />
      </button>
    </div>
  );
}

const CHAVE_COLAPSADA = "sidebar-colapsada";

function lerColapsadaInicial(): boolean {
  try {
    return localStorage.getItem(CHAVE_COLAPSADA) === "1";
  } catch {
    return false;
  }
}

export function Sidebar({ telaAtiva }: { telaAtiva: Tela }) {
  const [menuAberto, setMenuAberto] = useState(false);
  // Só a barra de desktop oculta e volta; no celular ela já vira um menu que abre por cima.
  const [colapsada, setColapsada] = useState(lerColapsadaInicial);

  function alternarColapso() {
    setColapsada((atual) => {
      const proximo = !atual;
      try {
        localStorage.setItem(CHAVE_COLAPSADA, proximo ? "1" : "0");
      } catch {
        // sem armazenamento: a preferência vale só nesta sessão
      }
      return proximo;
    });
  }

  useEffect(() => {
    if (!menuAberto) return;

    const fecharComEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuAberto(false);
    };
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", fecharComEscape);

    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener("keydown", fecharComEscape);
    };
  }, [menuAberto]);

  return (
    <>
      {colapsada ? (
        <button
          type="button"
          onClick={alternarColapso}
          aria-label="Mostrar menu"
          title="Mostrar menu"
          className="sticky top-5 z-30 ml-3 hidden h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg border border-card-border bg-surface text-ink-2 transition-colors hover:border-baseline hover:text-ink md:flex"
        >
          <Icone nome="menu" tamanho={16} />
        </button>
      ) : (
        // Tudo cabe sem rolar; a rolagem existe só como rede de segurança em telas muito baixas,
        // e sem barra visível, que é o que mais sujava a lateral.
        <aside className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 flex-col gap-5 bg-sidebar px-3 py-5 md:flex">
          <div className="flex items-center justify-between gap-2">
            <Marca />
            <button
              type="button"
              onClick={alternarColapso}
              aria-label="Ocultar menu"
              title="Ocultar menu"
              className="rounded-lg p-1.5 text-sidebar-ink-2 transition-colors hover:bg-white/10 hover:text-sidebar-ink"
            >
              <Icone nome="recolher" tamanho={15} />
            </button>
          </div>
          <BotaoNovaCampanha ativa={telaAtiva === "nova-campanha"} />
          <div className="sem-barra min-h-0 flex-1 overflow-y-auto">
            <Menu telaAtiva={telaAtiva} />
          </div>
          <Rodape />
        </aside>
      )}

      <header className="sticky top-0 z-50 border-b border-sidebar-linha bg-sidebar md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Marca />
          <button
            type="button"
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto((aberto) => !aberto)}
            className="rounded-lg p-2 text-sidebar-ink-2 hover:bg-white/10 hover:text-sidebar-ink"
          >
            <Icone nome={menuAberto ? "x" : "menu"} tamanho={22} />
          </button>
        </div>
      </header>

      {menuAberto && (
        <div className="fixed inset-0 top-14 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div className="sem-barra absolute bottom-0 left-0 top-0 flex w-[min(19rem,88vw)] flex-col gap-5 overflow-y-auto border-r border-sidebar-linha bg-sidebar px-3 py-4 shadow-lg">
            <BotaoNovaCampanha ativa={telaAtiva === "nova-campanha"} onNavegar={() => setMenuAberto(false)} />
            <div className="min-h-0 flex-1">
              <Menu telaAtiva={telaAtiva} onNavegar={() => setMenuAberto(false)} />
            </div>
            <Rodape />
          </div>
        </div>
      )}
    </>
  );
}
