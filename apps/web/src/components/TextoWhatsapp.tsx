import type { ReactNode } from "react";

// Mostra o texto como o cliente vê no WhatsApp: *negrito*, _itálico_ e ~riscado~ formatados. As
// {{variáveis}} ficam destacadas; com "exemplos", aparece o valor de exemplo no lugar (ainda destacado).
export function TextoWhatsapp({ texto, exemplos }: { texto: string; exemplos?: Record<string, string> }) {
  return <>{formatar(texto, exemplos)}</>;
}

function formatar(texto: string, exemplos?: Record<string, string>): ReactNode[] {
  return texto.split(/(\{\{\s*[\w.-]+\s*\}\}|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((parte, indice) => {
    const variavel = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(parte);
    if (variavel) {
      const exemplo = exemplos?.[variavel[1]!]?.trim();
      return (
        <span
          key={indice}
          className={`rounded bg-brand-2-soft px-1 font-semibold text-brand-2-text ${exemplo ? "" : "font-mono text-[12px]"}`}
        >
          {exemplo || parte}
        </span>
      );
    }
    if (/^\*.+\*$/.test(parte)) return <strong key={indice}>{formatar(parte.slice(1, -1), exemplos)}</strong>;
    if (/^_.+_$/.test(parte)) return <em key={indice}>{parte.slice(1, -1)}</em>;
    if (/^~.+~$/.test(parte)) return <s key={indice}>{parte.slice(1, -1)}</s>;
    return parte;
  });
}
