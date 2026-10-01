import { z } from "zod";
import { extrairPlaceholders } from "../templates.js";

// Limites da Meta para template de mensagem.
export const LIMITE_CORPO_TEMPLATE = 1024;
export const LIMITE_CABECALHO_TEMPLATE = 60;
export const LIMITE_RODAPE_TEMPLATE = 60;
export const TIPOS_IMAGEM_TEMPLATE = ["image/jpeg", "image/png"] as const;
export const LIMITE_IMAGEM_TEMPLATE_BYTES = 5 * 1024 * 1024;

// A Meta aceita variáveis nomeadas ({{nome}}) ou numeradas ({{1}}, {{2}}...), nunca as duas juntas.
const NOME_VARIAVEL = /^[a-z][a-z0-9_]*$/;
const NUMERO_VARIAVEL = /^\d+$/;

// Imagem mandada pelo navegador como base64, sem o prefixo "data:...;base64,".
export const imagemTemplateSchema = z.object({
  base64: z
    .string()
    .min(1)
    // base64 ocupa 4/3 do arquivo.
    .max(Math.ceil((LIMITE_IMAGEM_TEMPLATE_BYTES * 4) / 3) + 4, "A imagem pode ter no máximo 5 MB"),
  mimeType: z.enum(TIPOS_IMAGEM_TEMPLATE, { message: "Use uma imagem JPG ou PNG" }),
});

export const criarTemplateInputSchema = z
  .object({
    contaId: z.number().int().positive(),
    nome: z
      .string()
      .trim()
      .min(1, "Dê um nome ao template")
      .max(512)
      .regex(/^[a-z0-9_]+$/, "O nome aceita só letras minúsculas sem acento, números e _"),
    // Autenticação tem formato próprio na Meta (código de uso único) e não entra por aqui.
    categoria: z.enum(["marketing", "utilidade"]),
    idioma: z.string().trim().min(2).max(15),
    cabecalho: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("nenhum") }),
      z.object({
        tipo: z.literal("texto"),
        texto: z.string().trim().min(1, "Escreva o texto do cabeçalho").max(LIMITE_CABECALHO_TEMPLATE),
      }),
      z.object({ tipo: z.literal("imagem"), imagem: imagemTemplateSchema }),
    ]),
    corpo: z.string().trim().min(1, "Escreva a mensagem").max(LIMITE_CORPO_TEMPLATE),
    // Um exemplo por variável do corpo: a Meta recusa template com variável sem exemplo.
    exemplos: z.record(z.string(), z.string().trim()),
    rodape: z.string().trim().max(LIMITE_RODAPE_TEMPLATE).optional(),
  })
  .superRefine((entrada, ctx) => {
    for (const problema of problemasDoCorpo(entrada.corpo, entrada.exemplos)) {
      ctx.addIssue({ code: "custom", path: ["corpo"], message: problema });
    }
  });

export type CriarTemplateInput = z.infer<typeof criarTemplateInputSchema>;

export const definirImagemTemplateInputSchema = z.object({
  templateId: z.number().int().positive(),
  imagem: imagemTemplateSchema,
});

// As regras da Meta que dá para conferir antes de enviar; usadas no formulário (aviso na hora) e na API.
export function problemasDoCorpo(corpo: string, exemplos: Record<string, string>): string[] {
  const problemas: string[] = [];
  const variaveis = extrairPlaceholders(corpo);

  const nomeadas = variaveis.filter((variavel) => !NUMERO_VARIAVEL.test(variavel));
  const numeradas = variaveis.filter((variavel) => NUMERO_VARIAVEL.test(variavel));

  if (nomeadas.length > 0 && numeradas.length > 0) {
    problemas.push("Use só variáveis com nome ({{nome}}) ou só numeradas ({{1}}), sem misturar.");
  }
  for (const variavel of nomeadas) {
    if (!NOME_VARIAVEL.test(variavel)) {
      problemas.push(`A variável {{${variavel}}} só pode ter letras minúsculas sem acento, números e _, começando por letra.`);
    }
  }
  if (numeradas.length > 0 && nomeadas.length === 0) {
    const esperadas = numeradas.map((_, indice) => String(indice + 1));
    if ([...numeradas].sort((a, b) => Number(a) - Number(b)).join() !== esperadas.join()) {
      problemas.push("Variáveis numeradas precisam ir em sequência: {{1}}, {{2}}, {{3}}...");
    }
  }

  const texto = corpo.trim();
  if (/^\{\{[^}]+\}\}/.test(texto) || /\{\{[^}]+\}\}[.!?…\s]*$/.test(texto)) {
    problemas.push("A Meta não aceita variável no começo nem no fim da mensagem. Coloque algum texto antes e depois.");
  }

  for (const variavel of variaveis) {
    if (!exemplos[variavel]?.trim()) problemas.push(`Preencha um exemplo para {{${variavel}}}.`);
  }
  return problemas;
}
