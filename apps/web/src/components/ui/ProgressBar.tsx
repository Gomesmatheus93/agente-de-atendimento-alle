interface ProgressBarProps {
  enviado: number;
  falhou: number;
  pendente: number;
}

export function ProgressBar({ enviado, falhou, pendente }: ProgressBarProps) {
  const total = enviado + falhou + pendente;
  const pct = (valor: number) => (total === 0 ? 0 : (valor / total) * 100);

  return (
    <div
      role="img"
      aria-label={`${enviado} enviados, ${falhou} falhas e ${pendente} pendentes, de ${total} destinatários`}
      className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-200/70"
    >
      <div className="rounded-full bg-status-enviado" style={{ width: `${pct(enviado)}%` }} />
      <div className="rounded-full bg-status-falhou" style={{ width: `${pct(falhou)}%` }} />
      <div className="rounded-full bg-status-pendente" style={{ width: `${pct(pendente)}%` }} />
    </div>
  );
}
