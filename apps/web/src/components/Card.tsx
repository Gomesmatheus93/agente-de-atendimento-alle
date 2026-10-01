import type { HTMLAttributes } from "react";

// Só borda, sem sombra: ela já marca o limite do card. Sombra (--shadow-card/--shadow-pop) fica reservada
// para o que flutua por cima do conteúdo — menu, tooltip, toast — onde ela sinaliza sobreposição de verdade.
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-card-border bg-surface p-4 ${className}`} {...props} />;
}
