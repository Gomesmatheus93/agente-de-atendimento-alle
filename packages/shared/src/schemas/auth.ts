import { z } from "zod";

export const TAMANHO_MIN_SENHA = 8;

export const PAPEIS_USUARIO = ["admin", "membro"] as const;
export type PapelUsuario = (typeof PAPEIS_USUARIO)[number];

export const ROTULO_PAPEL: Record<PapelUsuario, string> = {
  admin: "Administrador",
  membro: "Membro",
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
  papel: z.enum(PAPEIS_USUARIO).default("membro"),
});

export const atualizarUsuarioInputSchema = z.object({
  id: z.number().int().positive(),
  nome: z.string().trim().min(1).max(120).optional(),
  papel: z.enum(PAPEIS_USUARIO).optional(),
  ativo: z.boolean().optional(),
});

export const redefinirSenhaInputSchema = z.object({
  id: z.number().int().positive(),
  senha: senhaSchema,
});

export const usuarioIdInputSchema = z.object({
  id: z.number().int().positive(),
});
