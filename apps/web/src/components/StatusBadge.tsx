// Sem ring: a cor de fundo já distingue o status, e um anel por cima de cada badge somava mais uma borda
// numa tela que já tem borda no card e na tabela em volta dela.
const ESTILOS: Record<string, { label: string; ponto: string; classes: string }> = {
  agendada: { label: "Agendada", ponto: "bg-status-agendado", classes: "bg-status-agendado/10 text-status-agendado" },
  pendente: { label: "Pendente", ponto: "bg-status-pendente", classes: "bg-amber-50 text-amber-800" },
  enviado: { label: "Enviado", ponto: "bg-status-enviado", classes: "bg-success-soft text-success-text" },
  falhou: { label: "Falhou", ponto: "bg-status-falhou", classes: "bg-red-50 text-red-700" },
  enviando: { label: "Enviando", ponto: "bg-status-pendente animate-pulse", classes: "bg-amber-50 text-amber-800" },
  concluida: { label: "Concluída", ponto: "bg-status-enviado", classes: "bg-success-soft text-success-text" },
};

export function StatusBadge({ status }: { status: string }) {
  const estilo = ESTILOS[status] ?? { label: status, ponto: "bg-baseline", classes: "bg-slate-100 text-ink-2" };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${estilo.classes}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${estilo.ponto}`} />
      {estilo.label}
    </span>
  );
}
