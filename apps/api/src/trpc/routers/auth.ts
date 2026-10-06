import { randomBytes } from "node:crypto";
import { gerarHashDeSenha, senhaConfere, sessoes, unidades, usuarios } from "@atendimento-academias/db";
import { criarPrimeiroUsuarioInputSchema, definirAssinaturaInputSchema, entrarInputSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { asc, count, eq, lt } from "drizzle-orm";
import { COOKIE_SESSAO, tokenDaSessao, type Context } from "../context.js";
import { limparFalhas, minutosBloqueado, registrarFalha } from "../limiteDeLogin.js";
import { procedimentoAutenticado, publicProcedure, router } from "../trpc.js";

const DURACAO_SESSAO_MS = 30 * 86_400_000;

// No servidor o painel é https: o cookie só viaja criptografado. Em desenvolvimento é http, então sem Secure.
const ATRIBUTOS_COOKIE = `HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

// Mesma resposta para e-mail inexistente e senha errada: não entrega quais e-mails existem.
const CREDENCIAIS_INVALIDAS = "E-mail ou senha incorretos.";

async function abrirSessao(ctx: Context, usuarioId: number, unidadeId: number | null = null): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);

  await ctx.db.insert(sessoes).values({ token, usuarioId, expiraEm, unidadeId });
  // Faxina barata: aproveita o login para tirar as sessões vencidas.
  await ctx.db.delete(sessoes).where(lt(sessoes.expiraEm, new Date()));

  ctx.res.appendHeader("Set-Cookie", `${COOKIE_SESSAO}=${token}; ${ATRIBUTOS_COOKIE}; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`);
}

async function contarUsuarios(ctx: Context): Promise<number> {
  const [linha] = await ctx.db.select({ total: count() }).from(usuarios);
  return linha?.total ?? 0;
}

export const authRouter = router({
  // Primeira chamada do painel: diz se há sessão e se o sistema ainda não tem nenhum usuário.
  estado: publicProcedure.query(async ({ ctx }) => ({
    usuario: ctx.usuario,
    precisaPrimeiroAcesso: ctx.usuario ? false : (await contarUsuarios(ctx)) === 0,
  })),

  // Só funciona enquanto não existe nenhum usuário: é o primeiro acesso, não um cadastro aberto. Quem faz
  // vira o superadmin (dono da plataforma), que depois cria as unidades e os donos delas.
  criarPrimeiroUsuario: publicProcedure.input(criarPrimeiroUsuarioInputSchema).mutation(async ({ ctx, input }) => {
    if ((await contarUsuarios(ctx)) > 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "O primeiro acesso já foi feito. Entre com seu e-mail e senha." });
    }

    const [{ id }] = await ctx.db
      .insert(usuarios)
      .values({ nome: input.nome, email: input.email, senhaHash: await gerarHashDeSenha(input.senha), papel: "superadmin" })
      .returning({ id: usuarios.id });

    await abrirSessao(ctx, id);
    return { id, nome: input.nome, email: input.email, papel: "superadmin" as const };
  }),

  entrar: publicProcedure.input(entrarInputSchema).mutation(async ({ ctx, input }) => {
    const ip = ctx.req.ip ?? "desconhecido";
    const espera = minutosBloqueado(ip, input.email);
    if (espera !== null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Muitas tentativas erradas. Tente de novo em ${espera} minuto${espera > 1 ? "s" : ""}.`,
      });
    }

    const [usuario] = await ctx.db.select().from(usuarios).where(eq(usuarios.email, input.email));

    // Confere a senha mesmo sem usuário seria ideal contra medir tempo; aqui o ganho não paga a complexidade.
    if (!usuario || !usuario.ativo || !(await senhaConfere(input.senha, usuario.senhaHash))) {
      registrarFalha(ip, input.email);
      throw new TRPCError({ code: "UNAUTHORIZED", message: CREDENCIAIS_INVALIDAS });
    }
    limparFalhas(ip, input.email);

    let unidadeDaSessao: number | null = null;
    if (usuario.papel === "superadmin") {
      // Entra direto na primeira unidade ativa; dá para trocar na tela Unidades.
      const [primeira] = await ctx.db.select({ id: unidades.id }).from(unidades).where(eq(unidades.ativo, true)).orderBy(asc(unidades.id)).limit(1);
      unidadeDaSessao = primeira?.id ?? null;
    } else {
      const [unidade] = usuario.unidadeId ? await ctx.db.select().from(unidades).where(eq(unidades.id, usuario.unidadeId)) : [];
      if (!unidade?.ativo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Esta unidade está desativada. Fale com o responsável pela plataforma." });
      }
    }

    await abrirSessao(ctx, usuario.id, unidadeDaSessao);
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel };
  }),

  // O próprio funcionário escolhe como assina as respostas (vale em qualquer computador em que entrar).
  definirAssinatura: procedimentoAutenticado.input(definirAssinaturaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.update(usuarios).set({ assinatura: input.assinatura }).where(eq(usuarios.id, ctx.usuario.id));
    return { assinatura: input.assinatura };
  }),

  sair: procedimentoAutenticado.mutation(async ({ ctx }) => {
    const token = tokenDaSessao(ctx.req.headers.cookie);

    if (token) await ctx.db.delete(sessoes).where(eq(sessoes.token, token));
    ctx.res.appendHeader("Set-Cookie", `${COOKIE_SESSAO}=; ${ATRIBUTOS_COOKIE}; Max-Age=0`);
    return { ok: true };
  }),
});
