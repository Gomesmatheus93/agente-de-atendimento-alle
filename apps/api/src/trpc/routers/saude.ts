import { verificacoesSaude } from "@atendimento-academias/db";
import { TRPCError } from "@trpc/server";
import { eq, isNull, or } from "drizzle-orm";
import { monitorLigado, verificarPlataforma, verificarUnidade } from "../../saude/monitor.js";
import { procedimentoAdmin, procedimentoUnidade, router } from "../trpc.js";

const ORDEM = { falha: 0, atencao: 1, ok: 2 } as const;
const ESPERA_ENTRE_VERIFICACOES_MS = 30_000;
const ultimaManual = new Map<number, number>();

// Saúde do sistema da unidade: o que o monitor encontrou na última rodada (peças da unidade e as da
// plataforma, que valem para todas).
export const saudeRouter = router({
  estado: procedimentoUnidade.query(async ({ ctx }) => {
    const linhas = await ctx.db
      .select()
      .from(verificacoesSaude)
      .where(or(eq(verificacoesSaude.unidadeId, ctx.unidadeId), isNull(verificacoesSaude.unidadeId)));
    // Peças da plataforma (worker, Redis, S3): só o superadmin vê o detalhe técnico (nome do bucket, texto
    // do erro). A equipe da unidade sabe que há um problema e que ele não é dela para resolver.
    const superadmin = ctx.usuario.papel === "superadmin";
    const semDetalhe = (linha: (typeof linhas)[number]) =>
      linha.unidadeId === null && !superadmin
        ? {
            mensagem: linha.nivel === "ok" ? "Funcionando." : "Há um problema na infraestrutura da plataforma. O responsável pela plataforma já foi avisado.",
            acao: null,
          }
        : { mensagem: linha.mensagem, acao: linha.acao };
    const verificacoes = linhas
      .map((linha) => ({
        chave: linha.chave,
        plataforma: linha.unidadeId === null,
        nivel: linha.nivel,
        titulo: linha.titulo,
        ...semDetalhe(linha),
        link: linha.link,
        desde: linha.desde.toISOString(),
        verificadoEm: linha.verificadoEm.toISOString(),
      }))
      .sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel] || a.titulo.localeCompare(b.titulo, "pt-BR"));
    const ultimaVerificacao = linhas.reduce<string | null>((maior, l) => {
      const em = l.verificadoEm.toISOString();
      return !maior || em > maior ? em : maior;
    }, null);
    return {
      verificacoes,
      ultimaVerificacao,
      falhas: verificacoes.filter((v) => v.nivel === "falha").length,
      atencoes: verificacoes.filter((v) => v.nivel === "atencao").length,
    };
  }),

  // "Verificar agora": não espera a próxima rodada (ex.: depois de trocar o token).
  verificarAgora: procedimentoAdmin.mutation(async ({ ctx }) => {
    const ultima = ultimaManual.get(ctx.unidadeId) ?? 0;
    if (Date.now() - ultima < ESPERA_ENTRE_VERIFICACOES_MS) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Acabou de verificar. Espere alguns segundos." });
    }
    ultimaManual.set(ctx.unidadeId, Date.now());
    await verificarUnidade(ctx.db, ctx.unidadeId);
    if (monitorLigado()) await verificarPlataforma(ctx.db);
    return { ok: true };
  }),
});
