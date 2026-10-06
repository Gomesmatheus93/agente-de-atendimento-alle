import { doNumeroDaUnidade, duvidasIa, respostasClientes } from "@atendimento-academias/db";
import { classificarDuvida, resumoDashboardInputSchema, TOPICO_OUTROS } from "@atendimento-academias/shared";
import { and, desc, gte } from "drizzle-orm";
import { DIA_MS } from "../periodo.js";
import { procedimentoUnidade, router } from "../trpc.js";

const MAX_RESPOSTAS_ANALISADAS = 20_000;
const MAX_EXEMPLOS = 3;
const TAMANHO_MAX_EXEMPLO = 140;

interface Grupo {
  total: number;
  anterior: number;
  // Texto (em minúsculas) -> {original, vezes}, para mostrar as mensagens que mais se repetem.
  mensagens: Map<string, { original: string; vezes: number }>;
}

function resumirMensagem(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > TAMANHO_MAX_EXEMPLO ? `${limpo.slice(0, TAMANHO_MAX_EXEMPLO - 1)}…` : limpo;
}

export const duvidasRouter = router({
  ranking: procedimentoUnidade.input(resumoDashboardInputSchema).query(async ({ ctx, input }) => {
    const { dias } = input;
    const agora = Date.now();
    const inicioAtual = agora - dias * DIA_MS;
    const inicioAnterior = agora - 2 * dias * DIA_MS;

    const respostas = await ctx.db
      .select({ texto: respostasClientes.texto, recebidaEm: respostasClientes.recebidaEm })
      .from(respostasClientes)
      .where(and(doNumeroDaUnidade(respostasClientes.numeroId, ctx.unidadeId), gte(respostasClientes.recebidaEm, new Date(inicioAnterior))))
      .orderBy(desc(respostasClientes.recebidaEm))
      .limit(MAX_RESPOSTAS_ANALISADAS);

    const grupos = new Map<string, Grupo>();
    let totalRespostas = 0;
    let totalDuvidas = 0;

    for (const { texto, recebidaEm } of respostas) {
      const noPeriodoAtual = recebidaEm.getTime() >= inicioAtual;
      if (noPeriodoAtual) totalRespostas += 1;

      const topico = classificarDuvida(texto);
      if (topico === null) continue;

      const grupo = grupos.get(topico) ?? { total: 0, anterior: 0, mensagens: new Map() };
      grupos.set(topico, grupo);

      if (!noPeriodoAtual) {
        grupo.anterior += 1;
        continue;
      }

      grupo.total += 1;
      totalDuvidas += 1;
      const chave = resumirMensagem(texto).toLowerCase();
      const existente = grupo.mensagens.get(chave);
      if (existente) existente.vezes += 1;
      else grupo.mensagens.set(chave, { original: resumirMensagem(texto), vezes: 1 });
    }

    const ranking = [...grupos.entries()]
      .filter(([, grupo]) => grupo.total > 0)
      .map(([topico, grupo]) => ({
        topico,
        total: grupo.total,
        participacao: totalDuvidas > 0 ? grupo.total / totalDuvidas : 0,
        anterior: grupo.anterior,
        exemplos: [...grupo.mensagens.values()]
          .sort((a, b) => b.vezes - a.vezes)
          .slice(0, MAX_EXEMPLOS)
          .map((mensagem) => mensagem.original),
      }))
      // "Outros assuntos" sempre por último, mesmo quando é o maior grupo.
      .sort((a, b) => Number(a.topico === TOPICO_OUTROS) - Number(b.topico === TOPICO_OUTROS) || b.total - a.total);

    return { dias, totalRespostas, totalDuvidas, ranking };
  }),

  // Ranking a partir da análise diária da IA (duvidas_ia): temas agrupados pelo assunto de verdade, não
  // por palavra-chave, e com quantas vezes o agente não soube responder — o que falta no script dele.
  rankingIa: procedimentoUnidade.input(resumoDashboardInputSchema).query(async ({ ctx, input }) => {
    const { dias } = input;
    const agora = Date.now();
    const inicioAtual = agora - dias * DIA_MS;
    const inicioAnterior = agora - 2 * dias * DIA_MS;

    const linhas = await ctx.db
      .select()
      .from(duvidasIa)
      .where(and(doNumeroDaUnidade(duvidasIa.numeroId, ctx.unidadeId), gte(duvidasIa.perguntadaEm, new Date(inicioAnterior))))
      .orderBy(desc(duvidasIa.perguntadaEm))
      .limit(MAX_RESPOSTAS_ANALISADAS);

    const grupos = new Map<string, { total: number; naoSanadas: number; anterior: number; clientes: Set<string>; exemplos: string[]; exemplosNaoSanados: string[] }>();
    let totalPerguntas = 0;
    let totalNaoSanadas = 0;
    const clientes = new Set<string>();

    for (const linha of linhas) {
      const grupo = grupos.get(linha.tema) ?? { total: 0, naoSanadas: 0, anterior: 0, clientes: new Set(), exemplos: [], exemplosNaoSanados: [] };
      grupos.set(linha.tema, grupo);
      if (linha.perguntadaEm.getTime() < inicioAtual) {
        grupo.anterior += 1;
        continue;
      }
      const cliente = `${linha.numeroId}:${linha.telefone}`;
      grupo.total += 1;
      grupo.clientes.add(cliente);
      clientes.add(cliente);
      totalPerguntas += 1;
      const exemplo = resumirMensagem(linha.pergunta);
      if (!linha.sanada) {
        grupo.naoSanadas += 1;
        totalNaoSanadas += 1;
        if (grupo.exemplosNaoSanados.length < MAX_EXEMPLOS && !grupo.exemplosNaoSanados.includes(exemplo)) grupo.exemplosNaoSanados.push(exemplo);
      } else if (grupo.exemplos.length < MAX_EXEMPLOS && !grupo.exemplos.includes(exemplo)) {
        grupo.exemplos.push(exemplo);
      }
    }

    const ranking = [...grupos.entries()]
      .filter(([, grupo]) => grupo.total > 0)
      .map(([tema, grupo]) => ({
        tema,
        total: grupo.total,
        clientes: grupo.clientes.size,
        naoSanadas: grupo.naoSanadas,
        anterior: grupo.anterior,
        participacao: totalPerguntas > 0 ? grupo.total / totalPerguntas : 0,
        exemplos: grupo.exemplos,
        exemplosNaoSanados: grupo.exemplosNaoSanados,
      }))
      .sort((a, b) => b.total - a.total);

    return { dias, totalPerguntas, totalNaoSanadas, totalClientes: clientes.size, ranking };
  }),
});
