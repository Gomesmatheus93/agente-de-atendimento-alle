import { useEffect, type ReactNode } from "react";
import type { Rota } from "../lib/route.js";
import { AvisosDeHumano, usePedidosDeHumano } from "./AvisosDeHumano.js";
import { BarraSuperior } from "./BarraSuperior.js";
import { Sidebar } from "./Sidebar.js";

interface LayoutProps {
  telaAtiva: Rota["tela"];
  titulo: string;
  descricao?: string;
  // Botões à direita do título (como "Nova campanha" / "Ver conversas" na Visão geral).
  acoes?: ReactNode;
  // Telas com quadro largo (kanban) usam toda a largura disponível em vez da coluna de leitura.
  ampla?: boolean;
  children: ReactNode;
}

// Ilhas sobre o fundo lavanda: menu à esquerda, barra superior e o conteúdo, todos de cantos grandes.
export function Layout({ telaAtiva, titulo, descricao, acoes, ampla = false, children }: LayoutProps) {
  // Com cliente esperando uma pessoa, o título da aba mostra quantos — dá para ver mesmo em outra aba.
  const esperando = usePedidosDeHumano().data?.length ?? 0;
  useEffect(() => {
    document.title = `${esperando > 0 ? `(${esperando}) 🙋 ` : ""}${titulo} · Allp Chat`;
  }, [titulo, esperando]);

  return (
    <div className="min-h-screen bg-app-bg md:flex md:gap-4 md:p-4">
      <Sidebar telaAtiva={telaAtiva} />
      <AvisosDeHumano />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <BarraSuperior />
        <main className="min-w-0 flex-1 px-4 pb-8 pt-6 sm:px-6 md:px-2 md:pt-2">
          <div className={`mx-auto w-full ${ampla ? "max-w-[1800px]" : "max-w-[1400px]"}`}>
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">{titulo}</h1>
                {descricao && <p className="mt-1.5 max-w-2xl text-sm text-ink-3">{descricao}</p>}
              </div>
              {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
            </header>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
