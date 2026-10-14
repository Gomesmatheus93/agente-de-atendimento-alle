import type { ButtonHTMLAttributes } from "react";

type Variante = "primario" | "secundario" | "fantasma" | "perigo";

const VARIANTES: Record<Variante, string> = {
  primario: "bg-accent text-accent-contrast hover:bg-accent-strong active:bg-accent-strong disabled:bg-accent/40",
  secundario:
    "border border-accent/30 bg-surface text-accent-text hover:border-accent hover:bg-accent-soft disabled:text-ink-3",
  fantasma: "text-ink-2 hover:bg-slate-200/60 hover:text-ink disabled:text-ink-3",
  // Ações que não se desfazem com um clique (excluir). Vermelho fixo: o mesmo nos dois temas, com texto branco legível.
  perigo: "bg-[#b42318] text-white hover:bg-[#912018] disabled:bg-[#b42318]/40",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
}

export function Button({ variante = "primario", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTES[variante]} ${className}`}
      {...props}
    />
  );
}
