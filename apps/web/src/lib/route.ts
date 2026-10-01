import { useEffect, useMemo, useState } from "react";

export type Rota =
  | { tela: "visao-geral" }
  | { tela: "nova-campanha" }
  | { tela: "campanhas"; campanhaId: number | null }
  | { tela: "calendario" }
  | { tela: "funil" }
  // criarNaConta: formulário de novo template para aquela conta (#/templates/novo/<contaId>).
  | { tela: "templates"; criarNaConta: number | null }
  | { tela: "conversas"; telefone: string | null; numeroId: number | null }
  | { tela: "relatorios" }
  | { tela: "duvidas" }
  | { tela: "configuracoes" }
  | { tela: "usuarios" };

export function parseHash(hash: string): Rota {
  const partes = hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (partes[0] === "nova-campanha") return { tela: "nova-campanha" };
  // A conversa é identificada pelo par número + telefone: #/conversas/<numeroId>/<telefone>
  if (partes[0] === "conversas") {
    const numeroId = Number(partes[1]);
    const telefone = /^\d{10,15}$/.test(partes[2] ?? "") ? partes[2]! : null;
    const valido = Number.isInteger(numeroId) && numeroId > 0 && telefone !== null;
    return { tela: "conversas", numeroId: valido ? numeroId : null, telefone: valido ? telefone : null };
  }
  if (partes[0] === "calendario") return { tela: "calendario" };
  if (partes[0] === "funil") return { tela: "funil" };
  if (partes[0] === "templates") {
    const contaId = Number(partes[2]);
    return { tela: "templates", criarNaConta: partes[1] === "novo" && Number.isInteger(contaId) && contaId > 0 ? contaId : null };
  }
  if (partes[0] === "relatorios") return { tela: "relatorios" };
  if (partes[0] === "duvidas") return { tela: "duvidas" };
  if (partes[0] === "configuracoes") return { tela: "configuracoes" };
  if (partes[0] === "usuarios") return { tela: "usuarios" };

  if (partes[0] === "campanhas") {
    const id = Number(partes[1]);
    return { tela: "campanhas", campanhaId: Number.isInteger(id) && id > 0 ? id : null };
  }

  return { tela: "visao-geral" };
}

export function hrefDe(rota: Rota): string {
  switch (rota.tela) {
    case "visao-geral":
      return "#/";
    case "nova-campanha":
      return "#/nova-campanha";
    case "campanhas":
      return rota.campanhaId === null ? "#/campanhas" : `#/campanhas/${rota.campanhaId}`;
    case "calendario":
      return "#/calendario";
    case "funil":
      return "#/funil";
    case "templates":
      return rota.criarNaConta === null ? "#/templates" : `#/templates/novo/${rota.criarNaConta}`;
    case "conversas":
      return rota.telefone === null || rota.numeroId === null ? "#/conversas" : `#/conversas/${rota.numeroId}/${rota.telefone}`;
    case "relatorios":
      return "#/relatorios";
    case "duvidas":
      return "#/duvidas";
    case "configuracoes":
      return "#/configuracoes";
    case "usuarios":
      return "#/usuarios";
  }
}

export function navegar(rota: Rota): void {
  window.location.hash = hrefDe(rota);
}

export function useRota(): Rota {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const atualizar = () => setHash(window.location.hash);
    window.addEventListener("hashchange", atualizar);
    return () => window.removeEventListener("hashchange", atualizar);
  }, []);

  return useMemo(() => parseHash(hash), [hash]);
}
