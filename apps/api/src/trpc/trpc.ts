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

// Gestão de usuários é só de quem administra a plataforma.
export const procedimentoAdmin = procedimentoAutenticado.use(({ ctx, next }) => {
  if (ctx.usuario.papel !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só um administrador pode fazer isso." });
  }
  return next({ ctx });
});
