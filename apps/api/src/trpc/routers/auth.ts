import { randomBytes } from "node:crypto";
import { gerarHashDeSenha, senhaConfere, sessoes, usuarios } from "@atendimento-academias/db";
import { criarPrimeiroUsuarioInputSchema, entrarInputSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { count, eq, lt } from "drizzle-orm";
import { COOKIE_SESSAO, type Context } from "../context.js";
import { procedimentoAutenticado, publicProcedure, router } from "../trpc.js";

const DURACAO_SESSAO_MS = 30 * 86_400_000;

// Mesma resposta para e-mail inexistente e senha errada: não entrega quais e-mails existem.
const CREDENCIAIS_INVALIDAS = "E-mail ou senha incorretos.";

async function abrirSessao(ctx: Context, usuarioId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);

  await ctx.db.insert(sessoes).values({ token, usuarioId, expiraEm });
  // Faxina barata: aproveita o login para tirar as sessões vencidas.
  await ctx.db.delete(sessoes).where(lt(sessoes.expiraEm, new Date()));

  // Sem "Secure" porque o painel roda em http no seu computador; ao publicar em https, acrescente.
  ctx.res.appendHeader(
    "Set-Cookie",
    `${COOKIE_SESSAO}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`,
  );
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

  // Só funciona enquanto não existe nenhum usuário: é o primeiro acesso, não um cadastro aberto.
  criarPrimeiroUsuario: publicProcedure.input(criarPrimeiroUsuarioInputSchema).mutation(async ({ ctx, input }) => {
    if ((await contarUsuarios(ctx)) > 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "O primeiro acesso já foi feito. Entre com seu e-mail e senha." });
    }

    const [{ id }] = await ctx.db
      .insert(usuarios)
      .values({ nome: input.nome, email: input.email, senhaHash: await gerarHashDeSenha(input.senha), papel: "admin" })
      .returning({ id: usuarios.id });

    await abrirSessao(ctx, id);
    return { id, nome: input.nome, email: input.email, papel: "admin" as const };
  }),

  entrar: publicProcedure.input(entrarInputSchema).mutation(async ({ ctx, input }) => {
    const [usuario] = await ctx.db.select().from(usuarios).where(eq(usuarios.email, input.email));

    // Confere a senha mesmo sem usuário seria ideal contra medir tempo; aqui o ganho não paga a complexidade.
    if (!usuario || !usuario.ativo || !(await senhaConfere(input.senha, usuario.senhaHash))) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: CREDENCIAIS_INVALIDAS });
    }

    await abrirSessao(ctx, usuario.id);
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel };
  }),

  sair: procedimentoAutenticado.mutation(async ({ ctx }) => {
    const cookie = ctx.req.headers.cookie ?? "";
    const token = cookie
      .split(";")
      .map((parte) => parte.trim())
      .find((parte) => parte.startsWith(`${COOKIE_SESSAO}=`))
      ?.slice(COOKIE_SESSAO.length + 1);

    if (token) await ctx.db.delete(sessoes).where(eq(sessoes.token, token));
    ctx.res.appendHeader("Set-Cookie", `${COOKIE_SESSAO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  }),
});
