import { useSyncExternalStore } from "react";

export type Tema = "claro" | "escuro";

const CHAVE = "tema";

function temaAtual(): Tema {
  return document.documentElement.dataset.theme === "dark" ? "escuro" : "claro";
}

// O atributo no <html> é a fonte da verdade (o script do index.html já o define antes da pintura);
// observar o atributo mantém todos os botões de tema sincronizados.
function assinar(aoMudar: () => void): () => void {
  const observador = new MutationObserver(aoMudar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observador.disconnect();
}

export function useTema(): { tema: Tema; alternar: () => void } {
  const tema = useSyncExternalStore(assinar, temaAtual, () => "claro" as Tema);

  function alternar() {
    const proximo: Tema = temaAtual() === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.theme = proximo === "escuro" ? "dark" : "light";
    try {
      localStorage.setItem(CHAVE, proximo);
    } catch {
      // sem armazenamento: o tema vale só nesta sessão
    }
  }

  return { tema, alternar };
}
