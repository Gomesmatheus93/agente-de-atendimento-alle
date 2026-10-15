import { z } from "zod";
import { ETAPAS_FUNIL } from "../funil.js";
import { normalizarTelefone } from "./campanha.js";

export const CORES_ETIQUETA = ["roxo", "laranja", "verde", "azul", "rosa", "cinza"] as const;
export type CorEtiqueta = (typeof CORES_ETIQUETA)[number];

export const MAX_CONTATOS_POR_IMPORTACAO = 5000;
export const CONTATOS_POR_PAGINA = 50;

// Situação da conversa com o contato, para montar segmentos ("ex-alunos que não falam com a gente há 30 dias").
export const SITUACOES_CONVERSA = ["qualquer", "escreveu", "nao_escreveu", "nunca_escreveu"] as const;
export const ROTULO_SITUACAO_CONVERSA: Record<(typeof SITUACOES_CONVERSA)[number], string> = {
  qualquer: "Qualquer",
  escreveu: "Escreveu nos últimos dias",
  nao_escreveu: "Não escreve há dias",
  nunca_escreveu: "Nunca escreveu",
};

// Filtro da base de contatos. É o que um segmento salva.
export const filtroContatosSchema = z.object({
  busca: z.string().trim().max(100).optional(),
  // Tem pelo menos uma destas etiquetas.
  etiquetas: z.array(z.number().int().positive()).max(50).default([]),
  // Não tem nenhuma destas.
  semEtiquetas: z.array(z.number().int().positive()).max(50).default([]),
  conversa: z.enum(SITUACOES_CONVERSA).default("qualquer"),
  dias: z.number().int().min(1).max(3650).default(30),
  etapasFunil: z.array(z.enum(ETAPAS_FUNIL)).default([]),
});
export type FiltroContatos = z.infer<typeof filtroContatosSchema>;

const telefoneContatoSchema = z.string().transform((valor, ctx) => {
  const normalizado = normalizarTelefone(valor);
  if (!normalizado) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Telefone inválido: ${valor}` });
    return z.NEVER;
  }
  return normalizado;
});

const nomeEtiquetaSchema = z.string().trim().min(1, "Dê um nome à etiqueta").max(40, "Etiqueta com até 40 caracteres");

// Data de nascimento como vem de planilha ("15/03/1990", "15/03", "1990-03-15") → "AAAA-MM-DD". Sem ano,
// usa 2000 (só dia e mês importam para o aniversário). Data impossível → null.
export function lerDataDeNascimento(texto: string | null | undefined): string | null {
  const valor = (texto ?? "").trim();
  if (!valor) return null;
  let dia: number, mes: number, ano: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(valor);
  const br = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(valor);
  if (iso) [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) {
    [dia, mes] = [Number(br[1]), Number(br[2])];
    const anoTexto = br[3];
    ano = !anoTexto ? 2000 : anoTexto.length === 2 ? (Number(anoTexto) > 30 ? 1900 : 2000) + Number(anoTexto) : Number(anoTexto);
  } else return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia || ano < 1900 || ano > 2100) return null;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export const salvarContatoInputSchema = z.object({
  id: z.number().int().positive().optional(),
  telefone: telefoneContatoSchema,
  nome: z.string().trim().max(150).nullable(),
  email: z.string().trim().email("E-mail inválido").max(200).nullable().or(z.literal("").transform(() => null)),
  nascimento: z
    .string()
    .nullish()
    .transform((valor, ctx) => {
      if (!valor) return null;
      const data = lerDataDeNascimento(valor);
      if (!data) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data de nascimento inválida" });
      return data;
    }),
  etiquetaIds: z.array(z.number().int().positive()).max(50),
});

export const importarContatosInputSchema = z.object({
  linhas: z
    .array(
      z.object({
        telefone: z.string().max(40),
        nome: z.string().max(150).optional(),
        email: z.string().max(200).optional(),
        nascimento: z.string().max(20).optional(),
        etiquetas: z.array(z.string().max(40)).max(20).optional(),
      }),
    )
    .min(1, "A planilha não tem linhas")
    .max(MAX_CONTATOS_POR_IMPORTACAO, `Importe até ${MAX_CONTATOS_POR_IMPORTACAO} contatos por vez`),
  // Etiquetas aplicadas a todos os contatos desta importação (ex.: "ex-aluno").
  etiquetasParaTodos: z.array(nomeEtiquetaSchema).max(10).default([]),
  // Contato que já existe: troca o nome pelo da planilha?
  atualizarNomes: z.boolean().default(true),
});

export const salvarEtiquetaInputSchema = z.object({
  id: z.number().int().positive().optional(),
  nome: nomeEtiquetaSchema,
  cor: z.enum(CORES_ETIQUETA).default("roxo"),
});

export const etiquetarContatosInputSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(5000),
  etiquetaId: z.number().int().positive(),
  acao: z.enum(["adicionar", "remover"]),
});

export const salvarSegmentoInputSchema = z.object({
  id: z.number().int().positive().optional(),
  nome: z.string().trim().min(1, "Dê um nome ao segmento").max(80),
  filtro: filtroContatosSchema,
});
