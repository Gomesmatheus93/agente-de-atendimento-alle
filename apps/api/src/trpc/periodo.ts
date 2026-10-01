export const FUSO = "America/Sao_Paulo";
export const DIA_MS = 86_400_000;

const formatadorDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Dia no fuso da operação, no formato YYYY-MM-DD.
export function chaveDia(data: Date): string {
  return formatadorDia.format(data);
}

// Chaves dos dias de `inicio` a `fim` dias atrás, em ordem cronológica.
export function diasAtras(agora: number, inicio: number, fim: number): string[] {
  const chaves: string[] = [];
  for (let i = inicio; i >= fim; i--) {
    chaves.push(chaveDia(new Date(agora - i * DIA_MS)));
  }
  return chaves;
}
