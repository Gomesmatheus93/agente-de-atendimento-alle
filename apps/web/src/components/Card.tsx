import type { HTMLAttributes } from "react";

// Ilha branca de cantos grandes sobre o fundo lavanda: a separação vem do contraste com o fundo, então não
// precisa de borda. A sombra é só um respiro; a de "flutuar" (--shadow-pop) fica para menus, toasts e avisos.
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-3xl bg-surface p-5 shadow-card ${className}`} {...props} />;
}
