import { z } from "zod";
import { etapaKanbanSchema } from "../types/status.js";

export const MAX_TELEFONES_POR_CAMPANHA = 1000;

export function normalizarTelefone(valor: string): string | null {
  const digitos = valor.replace(/\D/g, "");

  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

export interface TelefoneInvalido {
  linha: number;
  valor: string;
}

// Uma linha da lista de destinatários. As células que não são o telefone viram colunas, na ordem em
// que aparecem: é delas que sai o nome de cada cliente quando um placeholder é ligado a uma coluna.
export interface LinhaDestinatario {
  telefone: string;
  colunas: string[];
}

export interface ListaDestinatarios {
  validos: LinhaDestinatario[];
  invalidos: TelefoneInvalido[];
  duplicados: number;
  total: number;
  // Maior número de colunas visto nas linhas válidas, para a tela saber quantas oferecer.
  colunas: number;
}

const SEPARADOR_DE_CELULAS = /[;,\t|]/;

// Em CSV e em lista colada o telefone costuma vir junto de outras colunas, em qualquer posição:
// a primeira célula que é um telefone válido é o telefone, e o resto vira coluna.
function separarLinha(linha: string): { telefone: string | null; colunas: string[] } {
  const celulas = linha.split(SEPARADOR_DE_CELULAS).map((celula) => celula.trim());
  const indice = celulas.findIndex((celula) => normalizarTelefone(celula) !== null);

  if (indice === -1) return { telefone: null, colunas: [] };

  return {
    telefone: normalizarTelefone(celulas[indice]!),
    colunas: celulas.filter((_, posicao) => posicao !== indice).filter((celula) => celula !== ""),
  };
}

export function parseListaDestinatarios(texto: string): ListaDestinatarios {
  const porTelefone = new Map<string, LinhaDestinatario>();
  const invalidos: TelefoneInvalido[] = [];
  let total = 0;
  let duplicados = 0;
  let colunas = 0;

  texto.split(/\r?\n/).forEach((linhaBruta, indice) => {
    const valor = linhaBruta.trim();
    if (valor === "") return;
    total += 1;

    const { telefone, colunas: celulas } = separarLinha(valor);
    if (!telefone) {
      invalidos.push({ linha: indice + 1, valor });
      return;
    }

    if (porTelefone.has(telefone)) {
      duplicados += 1;
      return;
    }

    porTelefone.set(telefone, { telefone, colunas: celulas });
    colunas = Math.max(colunas, celulas.length);
  });

  return { validos: [...porTelefone.values()], invalidos, duplicados, total, colunas };
}

const telefoneSchema = z.string().transform((valor, ctx) => {
  const normalizado = normalizarTelefone(valor);
  if (!normalizado) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Telefone inválido: ${valor}` });
    return z.NEVER;
  }
  return normalizado;
});

// Agendar exige ao menos isto de antecedência (senão é um envio imediato) e no máximo isto.
export const ANTECEDENCIA_MIN_AGENDAMENTO_MS = 2 * 60 * 1000;
export const ANTECEDENCIA_MAX_AGENDAMENTO_MS = 365 * 24 * 60 * 60 * 1000;

// De onde sai o valor de um placeholder: um texto igual para todos, ou uma coluna da lista de
// destinatários — que é o que faz cada cliente receber o próprio nome.
export type OrigemParametro =
  | { tipo: "fixo"; valor: string }
  | { tipo: "coluna"; indice: number; padrao: string };

// A Meta recusa template com parâmetro vazio, então coluna em branco cai no valor padrão.
export function resolverParametros(
  linha: LinhaDestinatario,
  origens: Record<string, OrigemParametro>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(origens).map(([nome, origem]) => {
      if (origem.tipo === "fixo") return [nome, origem.valor.trim()];
      return [nome, linha.colunas[origem.indice]?.trim() || origem.padrao.trim()];
    }),
  );
}

export const criarCampanhaInputSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome para a campanha"),
  templateId: z.number().int().positive(),
  // Número da plataforma por onde a campanha sai.
  numeroId: z.number().int().positive(),
  // Cada destinatário leva os próprios valores de placeholder.
  destinatarios: z
    .array(
      z.object({
        telefone: telefoneSchema,
        parametros: z.record(z.string(), z.string()),
      }),
    )
    .min(1, "Informe ao menos um telefone")
    .max(MAX_TELEFONES_POR_CAMPANHA, `Máximo de ${MAX_TELEFONES_POR_CAMPANHA} telefones por campanha`)
    // Telefone repetido recebe uma vez só; vale a primeira ocorrência, como na leitura da lista.
    .transform((destinatarios) => [...new Map(destinatarios.map((d) => [d.telefone, d])).values()]),
  // Data e hora do disparo (ISO, com fuso). Sem isso a campanha dispara na hora.
  agendarPara: z.string().datetime().optional(),
});

export type CriarCampanhaInput = z.infer<typeof criarCampanhaInputSchema>;

export const detalheCampanhaInputSchema = z.object({
  id: z.number().int().positive(),
});

// `etapa: null` devolve a campanha à posição automática (calculada pelo status de envio).
export const moverEtapaInputSchema = z.object({
  id: z.number().int().positive(),
  etapa: etapaKanbanSchema.nullable(),
});
