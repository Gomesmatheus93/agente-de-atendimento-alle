import { ROTULO_PAPEL } from "@atendimento-academias/shared";
import { useEffect, useState } from "react";
import { hrefDe, type Rota } from "../lib/route.js";
import { useTema } from "../lib/tema.js";
import { trpc } from "../lib/trpc.js";
import { usePedidosDeHumano } from "./AvisosDeHumano.js";
import { useProblemasDeSaude } from "../pages/Saude.js";
import { Icone, type NomeIcone } from "./ui/Icone.js";

type Tela = Rota["tela"];

interface ItemMenu {
  tela: Tela;
  label: string;
  href: string;
  icone: NomeIcone;
  // Itens de administração só aparecem para o dono da unidade (admin) e o superadmin.
  soAdmin?: boolean;
  soSuperadmin?: boolean;
}

const GRUPOS: Array<{ titulo: string; itens: ItemMenu[] }> = [
  {
    titulo: "Operação",
    itens: [
      { tela: "visao-geral", label: "Visão geral", href: hrefDe({ tela: "visao-geral" }), icone: "painel" },
      { tela: "conversas", label: "Conversas", href: hrefDe({ tela: "conversas", telefone: null, numeroId: null }), icone: "mensagem" },
      { tela: "contatos", label: "Contatos", href: hrefDe({ tela: "contatos" }), icone: "agenda" },
      { tela: "funil", label: "Funil de clientes", href: hrefDe({ tela: "funil" }), icone: "funil" },
      { tela: "campanhas", label: "Campanhas", href: hrefDe({ tela: "campanhas", campanhaId: null }), icone: "kanban" },
      { tela: "calendario", label: "Calendário", href: hrefDe({ tela: "calendario" }), icone: "calendario" },
    ],
  },
  {
    titulo: "Análise",
    itens: [
      { tela: "financeiro", label: "Financeiro", href: hrefDe({ tela: "financeiro" }), icone: "moeda", soAdmin: true },
      { tela: "relatorios", label: "Relatórios", href: hrefDe({ tela: "relatorios" }), icone: "grafico" },
      { tela: "duvidas", label: "Dúvidas", href: hrefDe({ tela: "duvidas" }), icone: "duvida" },
      { tela: "instagram", label: "Instagram", href: hrefDe({ tela: "instagram" }), icone: "instagram" },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { tela: "templates", label: "Templates", href: hrefDe({ tela: "templates", criarNaConta: null }), icone: "documento", soSuperadmin: true },
      { tela: "automacoes", label: "Automações", href: hrefDe({ tela: "automacoes" }), icone: "relogio", soAdmin: true },
      { tela: "configuracoes", label: "Configurações", href: hrefDe({ tela: "configuracoes" }), icone: "engrenagem", soSuperadmin: true },
      { tela: "usuarios", label: "Equipe", href: hrefDe({ tela: "usuarios" }), icone: "usuarios", soAdmin: true },
      { tela: "saude", label: "Saúde do sistema", href: hrefDe({ tela: "saude" }), icone: "pulso", soSuperadmin: true },
      { tela: "rede", label: "Visão da rede", href: hrefDe({ tela: "rede" }), icone: "grafico", soSuperadmin: true },
      { tela: "unidades", label: "Unidades", href: hrefDe({ tela: "unidades" }), icone: "predio", soSuperadmin: true },
    ],
  },
];

function Marca() {
  return (
    <a href={hrefDe({ tela: "visao-geral" })} aria-label="Allp Chat — início" className="flex items-center gap-2.5 rounded-lg px-1">
      <img src="/allp-simbolo.png" alt="" aria-hidden="true" className="h-7 w-auto shrink-0" />
      <span className="font-heading text-lg font-bold tracking-tight text-sidebar-ink">
        Allp <span className="text-brand-2">Chat</span>
      </span>
    </a>
  );
}

// Grupos do menu (Operação, Análise, Administração) abrem e fecham; a escolha fica salva neste navegador.
const CHAVE_GRUPOS_FECHADOS = "menu-grupos-fechados";

function lerGruposFechados(): Set<string> {
  try {
    const bruto = localStorage.getItem(CHAVE_GRUPOS_FECHADOS);
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : []);
  } catch {
    return new Set();
  }
}

function Menu({ telaAtiva, onNavegar }: { telaAtiva: Tela; onNavegar?: () => void }) {
  const [fechados, setFechados] = useState<Set<string>>(lerGruposFechados);
  function alternarGrupo(titulo: string) {
    setFechados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(titulo)) proximo.delete(titulo);
      else proximo.add(titulo);
      try {
        localStorage.setItem(CHAVE_GRUPOS_FECHADOS, JSON.stringify([...proximo]));
      } catch {
        // sem armazenamento: vale só nesta visita
      }
      return proximo;
    });
  }
  // Entrou numa tela de um grupo fechado (por um link, por exemplo): o grupo abre para mostrar onde se está.
  useEffect(() => {
    const grupoAtivo = GRUPOS.find((grupo) => grupo.itens.some((item) => item.tela === telaAtiva))?.titulo;
    if (grupoAtivo && fechados.has(grupoAtivo)) alternarGrupo(grupoAtivo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telaAtiva]);

  // Conversas com mensagem ainda não lida; atualiza sozinho para o aviso aparecer sem recarregar.
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const papel = usuario?.papel;
  const comUnidade = Boolean(usuario?.unidadeId);
  // WhatsApp + DMs do Instagram.
  const naoLidas =
    (trpc.conversas.contarNaoLidas.useQuery(undefined, { refetchInterval: 10_000, enabled: comUnidade }).data?.conversas ?? 0) +
    (trpc.dmsInstagram.contarNaoLidas.useQuery(undefined, { refetchInterval: 10_000, enabled: comUnidade }).data?.conversas ?? 0);
  const ehSuperadmin = papel === "superadmin";
  const ehAdmin = papel === "admin" || ehSuperadmin;
  const precisamDeHumano = usePedidosDeHumano().data?.length ?? 0;
  // A saúde do sistema é do responsável pela plataforma.
  const problemas = useProblemasDeSaude(comUnidade && ehSuperadmin);

  // Sem unidade escolhida, o superadmin só tem a tela Unidades.
  const grupos = GRUPOS.map((grupo) => ({
    ...grupo,
    itens: grupo.itens.filter(
      (item) => (!item.soAdmin || ehAdmin) && (!item.soSuperadmin || ehSuperadmin) && (comUnidade || item.tela === "unidades" || item.tela === "rede"),
    ),
  })).filter((grupo) => grupo.itens.length > 0);

  return (
    <nav aria-label="Principal" className="flex flex-col gap-3">
      {grupos.map((grupo) => {
        const fechado = fechados.has(grupo.titulo);
        const idLista = `menu-grupo-${grupo.titulo.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}`;
        // Fechado, o grupo ainda avisa que há algo esperando dentro dele.
        const avisos =
          (grupo.itens.some((i) => i.tela === "conversas") ? naoLidas + precisamDeHumano : 0) +
          (grupo.itens.some((i) => i.tela === "saude") ? problemas.total : 0);
        return (
        <div key={grupo.titulo} className="flex flex-col">
          <button
            type="button"
            onClick={() => alternarGrupo(grupo.titulo)}
            aria-expanded={!fechado}
            aria-controls={idLista}
            className="group flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-ink-2/70 transition-colors hover:text-sidebar-ink"
          >
            <span className="flex-1 text-left">{grupo.titulo}</span>
            {fechado && avisos > 0 && (
              <span aria-label={`${avisos} aviso(s) dentro de ${grupo.titulo}`} className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-2 px-1 text-[9px] font-bold normal-case tracking-normal text-brand-2-contrast">
                {avisos > 99 ? "99+" : avisos}
              </span>
            )}
            <span aria-hidden="true" className={`flex transition-transform duration-200 ${fechado ? "-rotate-90" : ""}`}>
              <Icone nome="seta" tamanho={13} />
            </span>
          </button>
          <div
            id={idLista}
            ref={(el) => {
              // Fechado, os links ficam fora do Tab e do leitor de tela (inert), mesmo durante a animação.
              if (el) fechado ? el.setAttribute("inert", "") : el.removeAttribute("inert");
            }}
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${fechado ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
          >
          {/* -ml-5/pl-5: a marca do item ativo (colada na borda do menu) fica dentro do recorte da animação. */}
          <div className="-ml-5 flex min-h-0 flex-col gap-0.5 overflow-hidden pl-5 pt-1">
          {grupo.itens.map((item) => {
            const ativo = item.tela === telaAtiva;
            return (
              <a
                key={item.tela}
                href={item.href}
                onClick={onNavegar}
                aria-current={ativo ? "page" : undefined}
                className={`relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  ativo ? "font-semibold text-sidebar-ink" : "text-sidebar-ink-2 hover:bg-surface-2 hover:text-sidebar-ink"
                }`}
              >
                {/* Marca do item ativo colada na borda do menu, como no modelo. */}
                {ativo && <span aria-hidden="true" className="absolute -left-5 top-1/2 h-7 w-1.5 -translate-y-1/2 rounded-r-full bg-accent" />}
                <Icone nome={item.icone} tamanho={18} className={ativo ? "text-accent-text" : ""} />
                <span className="truncate">{item.label}</span>
                {item.tela === "conversas" && precisamDeHumano > 0 && (
                  <span
                    aria-label={`${precisamDeHumano} cliente${precisamDeHumano > 1 ? "s" : ""} precisando de atendimento humano`}
                    title="Precisando de atendimento humano"
                    className="ml-auto inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-md bg-amber-400 px-1 text-[10px] font-bold text-amber-950"
                  >
                    🙋{precisamDeHumano}
                  </span>
                )}
                {item.tela === "saude" && problemas.total > 0 && (
                  <span
                    aria-label={`${problemas.total} problema${problemas.total > 1 ? "s" : ""} no sistema`}
                    className={`ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px] font-bold ${
                      problemas.falhas > 0 ? "bg-[#b42318] text-white" : "bg-amber-400 text-amber-950"
                    }`}
                  >
                    {problemas.total}
                  </span>
                )}
                {item.tela === "conversas" && naoLidas > 0 && (
                  <span
                    aria-label={`${naoLidas} conversa${naoLidas > 1 ? "s" : ""} com mensagem não lida`}
                    className={`${precisamDeHumano > 0 ? "ml-1" : "ml-auto"} inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-accent px-1.5 text-[10px] font-bold text-accent-contrast`}
                  >
                    {naoLidas > 99 ? "99+" : naoLidas}
                  </span>
                )}
              </a>
            );
          })}
          </div>
          </div>
        </div>
        );
      })}
    </nav>
  );
}

export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

// Em qual unidade se está: o superadmin escolhe (troca o painel inteiro); os demais só veem o nome.
function SeletorDeUnidade() {
  const utils = trpc.useUtils();
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const ehSuperadmin = usuario?.papel === "superadmin";
  const unidades = trpc.unidades.listar.useQuery(undefined, { enabled: ehSuperadmin });
  const entrar = trpc.unidades.entrar.useMutation({
    // Tudo o que estava na tela era da unidade anterior.
    onSuccess: () => void utils.invalidate(),
  });

  if (!usuario) return null;
  if (!ehSuperadmin) {
    return usuario.unidadeNome ? (
      <p className="flex items-center gap-2 truncate rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] font-medium text-sidebar-ink">
        <Icone nome="predio" tamanho={15} className="shrink-0 text-accent-text" />
        <span className="truncate">{usuario.unidadeNome}</span>
      </p>
    ) : null;
  }

  return (
    <label className="flex flex-col gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-ink-2/70">
      Unidade
      <select
        value={usuario.unidadeId ?? ""}
        onChange={(evento) => entrar.mutate({ id: evento.target.value ? Number(evento.target.value) : null })}
        disabled={entrar.isPending}
        className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] font-medium normal-case tracking-normal text-sidebar-ink"
      >
        <option value="">Nenhuma (visão da rede)</option>
        {(unidades.data ?? []).map((unidade) => (
          <option key={unidade.id} value={unidade.id}>
            {unidade.nome}
            {unidade.ativo ? "" : " (desativada)"}
          </option>
        ))}
      </select>
    </label>
  );
}

// Só no menu do celular: lá não há barra superior, então quem está logado, o tema e a saída ficam aqui.
function RodapeCelular() {
  const utils = trpc.useUtils();
  const { tema, alternar } = useTema();
  const usuario = trpc.auth.estado.useQuery(undefined, { retry: false, staleTime: 30_000 }).data?.usuario;
  const sair = trpc.auth.sair.useMutation({ onSettled: () => void utils.invalidate() });
  if (!usuario) return null;

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-linha pt-3">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
        {iniciais(usuario.nome)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-sidebar-ink">{usuario.nome}</span>
        <span className="block text-[11px] text-sidebar-ink-2">{ROTULO_PAPEL[usuario.papel]}</span>
      </span>
      <button type="button" onClick={alternar} aria-label={tema === "claro" ? "Usar tema escuro" : "Usar tema claro"} className="rounded-full p-2 text-sidebar-ink-2 hover:bg-surface-2">
        <Icone nome={tema === "claro" ? "lua" : "sol"} tamanho={16} />
      </button>
      <button type="button" onClick={() => sair.mutate()} disabled={sair.isPending} aria-label="Sair" className="rounded-full p-2 text-sidebar-ink-2 hover:bg-surface-2 disabled:opacity-50">
        <Icone nome="sair" tamanho={16} />
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
          className="sticky top-4 z-30 hidden h-11 w-11 shrink-0 items-center justify-center self-start rounded-2xl bg-surface text-ink-2 shadow-card transition-colors hover:text-accent-text md:flex"
        >
          <Icone nome="menu" tamanho={16} />
        </button>
      ) : (
        // Tudo cabe sem rolar; a rolagem existe só como rede de segurança em telas muito baixas,
        // e sem barra visível, que é o que mais sujava a lateral.
        <aside className="sticky top-4 z-30 hidden h-[calc(100vh-2rem)] w-64 shrink-0 flex-col gap-6 rounded-[28px] bg-sidebar px-5 py-6 shadow-card md:flex">
          <div className="flex items-center justify-between gap-2">
            <Marca />
            <button
              type="button"
              onClick={alternarColapso}
              aria-label="Ocultar menu"
              title="Ocultar menu"
              className="rounded-full p-1.5 text-sidebar-ink-2 transition-colors hover:bg-surface-2 hover:text-sidebar-ink"
            >
              <Icone nome="recolher" tamanho={15} />
            </button>
          </div>
          <SeletorDeUnidade />
          <div className="sem-barra -mx-5 min-h-0 flex-1 overflow-y-auto px-5">
            <Menu telaAtiva={telaAtiva} />
          </div>
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
            className="rounded-full p-2 text-sidebar-ink-2 hover:bg-surface-2 hover:text-sidebar-ink"
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
            <SeletorDeUnidade />
            <div className="-mx-3 min-h-0 flex-1 px-5">
              <Menu telaAtiva={telaAtiva} onNavegar={() => setMenuAberto(false)} />
            </div>
            <RodapeCelular />
          </div>
        </div>
      )}
    </>
  );
}
