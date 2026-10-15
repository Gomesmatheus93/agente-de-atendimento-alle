import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context.js";

// Erro inesperado (banco fora, bug) não vai para o navegador como veio: a mensagem do Drizzle, por exemplo,
// traz o SQL e os parâmetros da consulta. Quem usa o painel vê uma mensagem genérica; o detalhe fica no log
// (onError em index.ts). Erros que o código lança de propósito (TRPCError com mensagem) passam como estão.
const MENSAGEM_ERRO_INTERNO = "Algo deu errado do nosso lado. Tente de novo em instantes.";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (error.code !== "INTERNAL_SERVER_ERROR") return { ...shape, data: { ...shape.data, stack: undefined } };
    // Lançado de propósito com código interno e mensagem própria (ex.: "Falha ao falar com a Meta"): mantém.
    const proposital = !error.cause || error.cause === error;
    return {
      ...shape,
      message: proposital ? shape.message : MENSAGEM_ERRO_INTERNO,
      data: { ...shape.data, stack: undefined },
    };
  },
});

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

// Configuração técnica da unidade (WhatsApp, webhook, n8n, EVO, templates, saúde do sistema): só o
// responsável pela plataforma, dentro da unidade escolhida. O dono da unidade (admin) usa, não configura.
export const procedimentoPlataforma = procedimentoUnidade.use(({ ctx, next }) => {
  if (ctx.usuario.papel !== "superadmin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o responsável pela plataforma pode fazer isso." });
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
