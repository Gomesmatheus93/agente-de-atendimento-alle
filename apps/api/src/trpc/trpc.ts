import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;

// Aberto: só o que precisa funcionar antes de entrar (estado do login, entrar, primeiro acesso).
export const publicProcedure = t.procedure;

// Tudo que lê ou mexe em dados da operação exige sessão. O painel guarda credenciais do WhatsApp e
// dispara mensagem real: sem sessão, nada responde.
export const procedimentoAutenticado = t.procedure.use(({ ctx, next }) => {
  if (!ctx.usuario) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Faça login para continuar." });
  }
  return next({ ctx: { ...ctx, usuario: ctx.usuario } });
});

// Tudo o que é dado da operação (conversas, campanhas, configurações...) vale dentro de uma unidade: a da
// pessoa, ou a que o superadmin escolheu. ctx.unidadeId é o filtro que separa uma unidade da outra.
export const procedimentoUnidade = procedimentoAutenticado.use(({ ctx, next }) => {
  const unidadeId = ctx.usuario.unidadeId;
  if (unidadeId === null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escolha uma unidade para continuar." });
  }
  return next({ ctx: { ...ctx, unidadeId } });
});

// Configurações e equipe da unidade: o dono dela (admin) ou o superadmin.
export const procedimentoAdmin = procedimentoUnidade.use(({ ctx, next }) => {
  if (ctx.usuario.papel !== "admin" && ctx.usuario.papel !== "superadmin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador da unidade pode fazer isso." });
  }
  return next({ ctx });
});

// Criar e gerenciar unidades: só o dono da plataforma.
export const procedimentoSuperadmin = procedimentoAutenticado.use(({ ctx, next }) => {
  if (ctx.usuario.papel !== "superadmin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o superadmin pode fazer isso." });
  }
  return next({ ctx });
});
