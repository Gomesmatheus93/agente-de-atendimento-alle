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
export const TIPO_MENSAGEM = ["texto", "audio", "figurinha", "imagem"] as const;
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
