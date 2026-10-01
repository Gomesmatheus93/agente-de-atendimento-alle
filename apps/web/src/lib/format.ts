export function formatarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, "");
  const local = digitos.startsWith("55") ? digitos.slice(2) : digitos;
  const ddd = local.slice(0, 2);
  const numero = local.slice(2);

  if (local.length === 11) return `+55 (${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  if (local.length === 10) return `+55 (${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return telefone;
}

export function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// Mostra centavos, e só abre mais casas quando o valor precisa (ex.: preço unitário de R$ 0,0625).
export function formatarMoeda(valor: number | null): string {
  return valor === null ? "—" : formatadorMoeda.format(valor);
}

export function formatarPercentual(fracao: number | null): string {
  if (fracao === null) return "—";
  return `${(fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function tempoRelativo(iso: string | Date, agora: number = Date.now()): string {
  const segundos = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 1000));

  if (segundos < 45) return "agora mesmo";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function formatarDataHora(iso: string | Date): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// chave no formato YYYY-MM-DD (dia local da campanha, já calculado pela API)
export function formatarDiaCurto(chave: string): string {
  const [, mes, dia] = chave.split("-");
  return `${dia}/${mes}`;
}

export function formatarDiaLongo(chave: string): string {
  return new Date(`${chave}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

// "3h 20min" ou "45 min": quanto falta para algo, em linguagem de gente.
export function formatarDuracao(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60_000));
  const horas = Math.floor(minutos / 60);
  return horas > 0 ? `${horas}h ${String(minutos % 60).padStart(2, "0")}min` : `${minutos} min`;
}

// "hoje às 15:13", "amanhã às 15:13", "ontem às 09:00" ou "15/09 às 09:00".
export function formatarQuando(iso: string | Date, agora: Date = new Date()): string {
  const data = new Date(iso);
  const dia = (deslocamento: number) => {
    const alvo = new Date(agora);
    alvo.setDate(alvo.getDate() + deslocamento);
    return alvo.toDateString() === data.toDateString();
  };

  const quando = dia(0)
    ? "hoje"
    : dia(1)
      ? "amanhã"
      : dia(-1)
        ? "ontem"
        : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${quando} às ${formatarHora(data)}`;
}

// Valor no formato do <input type="datetime-local"> ("2026-09-22T09:00"), no fuso do navegador.
export function paraCampoDataHora(data: Date): string {
  const dois = (numero: number) => String(numero).padStart(2, "0");
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

// O campo devolve um horário sem fuso; interpretado no fuso do navegador, que é o de quem está agendando.
export function lerCampoDataHora(valor: string): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarHora(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

// Para listas de conversa: hora se for de hoje, "Ontem", dia da semana na última semana, senão dd/mm.
export function formatarHoraOuData(iso: string | Date, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (mesmoDia(data, agora)) return formatarHora(data);

  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(data, ontem)) return "Ontem";

  if ((agora.getTime() - data.getTime()) / 86_400_000 < 7) {
    return data.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  }
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Separador de dia dentro da conversa.
export function rotuloDoDia(iso: string | Date, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (mesmoDia(data, agora)) return "Hoje";

  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(data, ontem)) return "Ontem";

  const opcoes: Intl.DateTimeFormatOptions =
    data.getFullYear() === agora.getFullYear() ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" };
  return data.toLocaleDateString("pt-BR", opcoes);
}
