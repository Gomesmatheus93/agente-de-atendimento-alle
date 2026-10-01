import { useEffect, type ReactNode } from "react";
import type { Rota } from "../lib/route.js";
import { Sidebar } from "./Sidebar.js";

interface LayoutProps {
  telaAtiva: Rota["tela"];
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
  // Telas com quadro largo (kanban) usam toda a largura disponível em vez da coluna de leitura.
  ampla?: boolean;
  children: ReactNode;
}

export function Layout({ telaAtiva, titulo, descricao, acoes, ampla = false, children }: LayoutProps) {
  useEffect(() => {
    document.title = `${titulo} · Allp Chat`;
  }, [titulo]);

  return (
    <div className="min-h-screen bg-app-bg md:flex">
      <Sidebar telaAtiva={telaAtiva} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">
        <div className={`mx-auto w-full ${ampla ? "max-w-[1800px]" : "max-w-6xl"}`}>
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-bold leading-tight text-ink sm:text-[1.75rem]">{titulo}</h1>
              {descricao && <p className="mt-1 max-w-2xl text-sm text-ink-2">{descricao}</p>}
            </div>
            {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
