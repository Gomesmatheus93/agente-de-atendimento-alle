import { z } from "zod";

export const TAMANHO_MIN_SENHA = 8;

// superadmin: dono da plataforma, cria as unidades e entra em qualquer uma. admin: dono da unidade, cuida
// das configurações e dos funcionários dela. membro: funcionário, atende as conversas da unidade.
export const PAPEIS_USUARIO = ["superadmin", "admin", "membro"] as const;
export type PapelUsuario = (typeof PAPEIS_USUARIO)[number];

// Os papéis que existem dentro de uma unidade: superadmin não é criado por tela, só no primeiro acesso.
export const PAPEIS_DA_UNIDADE = ["admin", "membro"] as const;
export type PapelDaUnidade = (typeof PAPEIS_DA_UNIDADE)[number];

export const ROTULO_PAPEL: Record<PapelUsuario, string> = {
  superadmin: "Superadmin",
  admin: "Administrador",
  membro: "Funcionário",
};

const senhaSchema = z
  .string()
  .min(TAMANHO_MIN_SENHA, `A senha precisa de pelo menos ${TAMANHO_MIN_SENHA} caracteres`)
  .max(200, "Senha muito longa");

export const entrarInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: z.string().min(1, "Informe a senha"),
});

export const criarPrimeiroUsuarioInputSchema = z.object({
  nome: z.string().trim().min(1, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaSchema,
});

export const criarUsuarioInputSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaSchema,
  papel: z.enum(PAPEIS_DA_UNIDADE).default("membro"),
});

export const atualizarUsuarioInputSchema = z.object({
  id: z.number().int().positive(),
  nome: z.string().trim().min(1).max(120).optional(),
  papel: z.enum(PAPEIS_DA_UNIDADE).optional(),
  ativo: z.boolean().optional(),
});

export const redefinirSenhaInputSchema = z.object({
  id: z.number().int().positive(),
  senha: senhaSchema,
});

export const usuarioIdInputSchema = z.object({
  id: z.number().int().positive(),
});

const nomeUnidadeSchema = z.string().trim().min(1, "Informe o nome da unidade").max(120);

// A unidade já nasce com o dono (admin): é ele quem cadastra o número e os funcionários.
export const criarUnidadeInputSchema = z.object({
  nome: nomeUnidadeSchema,
  admin: z.object({
    nome: z.string().trim().min(1, "Informe o nome do responsável").max(120),
    email: z.string().trim().toLowerCase().email("E-mail inválido"),
    senha: senhaSchema,
  }),
});

export const atualizarUnidadeInputSchema = z.object({
  id: z.number().int().positive(),
  nome: nomeUnidadeSchema.optional(),
  ativo: z.boolean().optional(),
});

// Superadmin escolhe em qual unidade está trabalhando (null = nenhuma, só a tela Unidades).
export const entrarNaUnidadeInputSchema = z.object({
  id: z.number().int().positive().nullable(),
});

// Assinatura do funcionário nas respostas pelo painel: o nome vai em negrito na primeira linha, para o
// cliente saber com quem fala e a equipe saber quem respondeu o quê. Sem asterisco nem quebra de linha,
// que quebrariam o negrito do WhatsApp.
export const TAMANHO_MAX_ASSINATURA = 60;
export const definirAssinaturaInputSchema = z.object({
  assinatura: z
    .string()
    .trim()
    .min(1, "Escreva seu nome")
    .max(TAMANHO_MAX_ASSINATURA, `Use no máximo ${TAMANHO_MAX_ASSINATURA} caracteres`)
    .regex(/^[^*_~\n\r]+$/, "Use só letras, números e espaços"),
});

// "*Nome*\nmensagem": é assim que a mensagem chega no WhatsApp do cliente.
export function assinarMensagem(assinatura: string, texto: string): string {
  return `*${assinatura}*\n${texto}`;
}
