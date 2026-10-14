import { z } from "zod";

// Telefone já normalizado (55 + DDD + número), só dígitos: é a chave de uma conversa.
export const telefoneConversaSchema = z.string().regex(/^\d{10,15}$/, "Telefone inválido");

// A conversa é o par número da operação + telefone do cliente: a mesma pessoa em dois números
// da operação são duas conversas, como aparece no WhatsApp dela.
export const numeroIdSchema = z.number().int().positive();

export const listarConversasInputSchema = z
  .object({
    busca: z.string().trim().max(100).optional(),
    apenasNaoLidas: z.boolean().default(false),
    limite: z.number().int().min(1).max(200).default(100),
  })
  .default({ apenasNaoLidas: false, limite: 100 });

export const detalheConversaInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
});

// texto: escrita ou template; audio: nota de voz (equipe manda e recebe; figurinha só chega do cliente).
// "imagem": hoje só de saída (imagens do agente, ver midias_agente); a recebida ainda é ignorada pelo webhook.
export const TIPO_MENSAGEM = ["texto", "audio", "figurinha", "imagem", "video", "documento"] as const;
export type TipoMensagem = (typeof TIPO_MENSAGEM)[number];

// Limite do WhatsApp para uma mensagem de texto.
export const TAMANHO_MAX_RESPOSTA = 4096;

// O WhatsApp só aceita texto livre até 24h depois da última mensagem do cliente; depois disso, só template.
export const JANELA_RESPOSTA_MS = 24 * 60 * 60 * 1000;

export const enviarRespostaInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
  texto: z
    .string()
    .trim()
    .min(1, "Escreva uma mensagem")
    .max(TAMANHO_MAX_RESPOSTA, `Máximo de ${TAMANHO_MAX_RESPOSTA} caracteres`),
  // Preenchido quando a resposta partiu de uma sugestão da IA (editada ou não).
  sugestaoId: z.number().int().positive().optional(),
});

export const reenviarRespostaInputSchema = z.object({
  id: z.number().int().positive(),
});

// Nota de voz: cap generoso (WhatsApp aceita áudio até 16MB); em base64 o texto fica ~33% maior que o
// arquivo, então o limite de caracteres já inclui essa folga.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const enviarAudioInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
  // Conteúdo do arquivo em base64 (sem o prefixo "data:...;base64,").
  audioBase64: z
    .string()
    .min(1, "Áudio vazio")
    .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 100, "Áudio maior que o limite permitido"),
  mimeType: z.string().min(1).max(100),
});

// Anexo enviado pela equipe. O teto vem do corpo da requisição do painel (16 MB, e base64 cresce 1/3);
// imagem tem o limite menor da Meta (5 MB).
export const MAX_ANEXO_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGEM_BYTES = 5 * 1024 * 1024;
export const TAMANHO_MAX_LEGENDA = 1024;

// O que o WhatsApp aceita, e o tipo de mensagem que cada formato vira.
export const MIME_DO_ANEXO: Record<string, "imagem" | "video" | "documento"> = {
  "image/jpeg": "imagem",
  "image/png": "imagem",
  "video/mp4": "video",
  "video/3gpp": "video",
  "application/pdf": "documento",
  "application/msword": "documento",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documento",
  "application/vnd.ms-excel": "documento",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "documento",
  "text/plain": "documento",
};

export const enviarAnexoInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
  arquivoBase64: z
    .string()
    .min(1, "Arquivo vazio")
    .max(Math.ceil((MAX_ANEXO_BYTES * 4) / 3) + 100, "Arquivo maior que 10 MB"),
  mimeType: z.string().refine((mime) => mime in MIME_DO_ANEXO, "Formato não aceito pelo WhatsApp. Use JPG, PNG, MP4, PDF, Word, Excel ou TXT."),
  nome: z.string().trim().min(1).max(255),
  legenda: z.string().trim().max(TAMANHO_MAX_LEGENDA).default(""),
});

export const marcarComoNaoLidaInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
});

// A IA de atendimento é ligada ou desligada por contato.
export const definirIaInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
  ativa: z.boolean(),
});

export const sugestaoIaInputSchema = z.object({
  id: z.number().int().positive(),
});

export const gerarSugestaoInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
});

export const resolverHumanoInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
});

// Respostas rápidas ("/precos" no chat) e notas internas da equipe.
export const TAMANHO_MAX_NOTA = 2000;

export const salvarRespostaRapidaInputSchema = z.object({
  id: z.number().int().positive().optional(),
  atalho: z
    .string()
    .trim()
    .toLowerCase()
    .transform((valor) => valor.replace(/^\/+/, ""))
    .pipe(z.string().min(1, "Dê um atalho").max(30, "Atalho com até 30 caracteres").regex(/^[a-z0-9à-ú_-]+$/, "Atalho sem espaços (use letras, números, - ou _)")),
  texto: z.string().trim().min(1, "Escreva o texto").max(4000, "Texto com até 4000 caracteres"),
});

export const criarNotaInputSchema = z.object({
  telefone: telefoneConversaSchema,
  numeroId: numeroIdSchema,
  texto: z.string().trim().min(1, "Escreva a nota").max(TAMANHO_MAX_NOTA, `Nota com até ${TAMANHO_MAX_NOTA} caracteres`),
});
