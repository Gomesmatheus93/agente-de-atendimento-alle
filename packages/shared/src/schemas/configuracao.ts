import { z } from "zod";
import { imagemTemplateSchema } from "./template.js";

export const salvarContaInputSchema = z.object({
  // Identificação da conta do WhatsApp Business, na tela Configuração da API da Meta.
  wabaId: z.string().trim().regex(/^\d{5,30}$/, "A identificação da conta é só números"),
  // Token de acesso. Em conta já salva, deixar em branco mantém o token atual.
  token: z.string().trim().min(20, "Token muito curto").optional(),
  nome: z.string().trim().max(120).optional(),
});

export const contaInputSchema = z.object({
  contaId: z.number().int().positive(),
});

export const definirNumeroAtivoInputSchema = z.object({
  numeroId: z.number().int().positive(),
  ativo: z.boolean(),
});

export const salvarWebhookInputSchema = z.object({
  // Em branco mantém o valor já salvo.
  verifyToken: z.string().trim().max(200).optional(),
  appSecret: z.string().trim().max(200).optional(),
});

export const salvarModoAgenteInputSchema = z.object({
  modo: z.enum(["interno", "n8n"]),
  // Em branco mantém a URL já salva; só obrigatório de fato ter algo quando modo === "n8n".
  webhookN8nUrl: z.union([z.string().trim().url("URL inválida"), z.literal("")]).optional(),
});

export const listarTemplatesInputSchema = z
  .object({
    // Templates são aprovados por conta na Meta: a lista depende do número escolhido.
    numeroId: z.number().int().positive().optional(),
  })
  .default({});

// Categoria do negócio no perfil do WhatsApp (campo "vertical" da Meta), com o rótulo mostrado na tela.
export const CATEGORIAS_PERFIL = {
  HEALTH: "Saúde e bem-estar",
  PROF_SERVICES: "Serviços profissionais",
  RETAIL: "Varejo",
  EDU: "Educação",
  ENTERTAIN: "Entretenimento",
  EVENT_PLAN: "Eventos",
  FINANCE: "Finanças",
  BEAUTY: "Beleza",
  APPAREL: "Vestuário",
  AUTO: "Automotivo",
  GROCERY: "Supermercado",
  HOTEL: "Hotelaria",
  RESTAURANT: "Restaurante",
  TRAVEL: "Viagens",
  NONPROFIT: "Sem fins lucrativos",
  GOVT: "Governo",
  OTHER: "Outro",
} as const;
export type CategoriaPerfil = keyof typeof CATEGORIAS_PERFIL;

// Limites da Meta para o perfil comercial do número.
export const LIMITE_RECADO_PERFIL = 139;
export const LIMITE_DESCRICAO_PERFIL = 512;
export const LIMITE_ENDERECO_PERFIL = 256;

export const numeroInputSchema = z.object({
  numeroId: z.number().int().positive(),
});

export const salvarPerfilNumeroInputSchema = z.object({
  numeroId: z.number().int().positive(),
  recado: z.string().trim().max(LIMITE_RECADO_PERFIL),
  descricao: z.string().trim().max(LIMITE_DESCRICAO_PERFIL),
  endereco: z.string().trim().max(LIMITE_ENDERECO_PERFIL),
  email: z.union([z.string().trim().email("E-mail inválido").max(128), z.literal("")]),
  sites: z
    .array(z.string().trim().max(256).regex(/^https?:\/\//, "O site precisa começar com http:// ou https://"))
    .max(2, "A Meta aceita no máximo 2 sites"),
  categoria: z.enum(Object.keys(CATEGORIAS_PERFIL) as [CategoriaPerfil, ...CategoriaPerfil[]]),
  // Só quando a foto muda. Mesmo formato da imagem de template (JPG/PNG até 5 MB, em base64).
  foto: imagemTemplateSchema.optional(),
});

// Imagens que o agente pode anexar às respostas (ex.: tabela de planos). O n8n pede pelo nome:
// POST /integracoes/mensagens com "imagem": "planos".
export const NOME_MIDIA_AGENTE = /^[a-z0-9_-]{1,40}$/;

export const salvarMidiaAgenteInputSchema = z.object({
  chave: z.string().trim().toLowerCase().regex(NOME_MIDIA_AGENTE, "Use só letras minúsculas, números, - e _ (até 40)"),
  descricao: z.string().trim().max(200).optional(),
  imagem: imagemTemplateSchema,
});

export const midiaAgenteInputSchema = z.object({ chave: z.string().regex(NOME_MIDIA_AGENTE) });

// O WhatsApp aceita legenda de imagem até 1024 caracteres; texto maior vai numa mensagem separada.
export const LIMITE_LEGENDA_IMAGEM = 1024;
