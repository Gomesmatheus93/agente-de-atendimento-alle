// Balão no estilo de conversa, para o texto parecer com o que a pessoa recebe no WhatsApp.
export function MensagemPreview({ mensagem, rotulo = "Prévia da mensagem" }: { mensagem: string; rotulo?: string }) {
  return (
    <figure className="rounded-xl border border-card-border bg-app-bg px-4 py-3.5">
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{rotulo}</figcaption>
      <p className="max-w-lg whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-sm text-ink ring-1 ring-inset ring-card-border">
        {mensagem}
      </p>
    </figure>
  );
}
