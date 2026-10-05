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

// Soma (ou subtrai) dias a uma chave YYYY-MM-DD, pelo calendário (sem depender de fuso nem de hora).
export function somarDias(chave: string, dias: number): string {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return new Date(Date.UTC(ano!, mes! - 1, dia! + dias, 12)).toISOString().slice(0, 10);
}

// Todos os dias de `inicio` a `fim`, inclusive, em ordem.
export function diasEntre(inicio: string, fim: string): string[] {
  const chaves: string[] = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) chaves.push(dia);
  return chaves;
}

// Meia-noite do dia no fuso da operação. São Paulo não tem horário de verão desde 2019: -03:00 fixo.
export function inicioDoDia(chave: string): Date {
  return new Date(`${chave}T00:00:00-03:00`);
}
