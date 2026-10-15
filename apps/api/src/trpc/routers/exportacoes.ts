import { qualificada as q, campanhasDisparo, contatoEtiquetas, contatosUnidade, disparoDestinatarios, etiquetas, respostasClientes } from "@atendimento-academias/db";
import { detalheConversaInputSchema, filtroContatosSchema } from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { garantirNumeroDaUnidade, obterConversa } from "../../servicos/conversas.js";
import { procedimentoAdmin, router } from "../trpc.js";
import { condicoes, descadastrado, ultimaMensagem } from "./contatos.js";

// Exportações em planilha (o navegador monta o CSV). Só o admin: exportar é tirar dados pessoais do
// sistema, e fica registrado no log quem exportou o quê.
const LIMITE = 20_000;

// Data como o Excel em português lê, no horário de Brasília.
const data = (valor: Date | string | null | undefined) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "";

export const exportacoesRouter = router({
  contatos: procedimentoAdmin.input(filtroContatosSchema).mutation(async ({ ctx, input }) => {
    const linhas = await ctx.db
      .select({
        id: contatosUnidade.id,
        nome: contatosUnidade.nome,
        telefone: contatosUnidade.telefone,
        email: contatosUnidade.email,
        origem: contatosUnidade.origem,
        criadoEm: contatosUnidade.createdAt,
        ultimaMensagemEm: ultimaMensagem(ctx.unidadeId),
        descadastrado: descadastrado(ctx.unidadeId),
      })
      .from(contatosUnidade)
      .where(and(...condicoes(ctx.unidadeId, input)))
      .orderBy(asc(contatosUnidade.nome))
      .limit(LIMITE);
    const ids = linhas.map((l) => l.id);
    const etiquetasPorContato = new Map<number, string[]>();
    for (let i = 0; i < ids.length; i += 1000) {
      const lote = await ctx.db
        .select({ contatoId: contatoEtiquetas.contatoId, nome: etiquetas.nome })
        .from(contatoEtiquetas)
        .innerJoin(etiquetas, eq(etiquetas.id, contatoEtiquetas.etiquetaId))
        .where(inArray(contatoEtiquetas.contatoId, ids.slice(i, i + 1000)));
      for (const { contatoId, nome } of lote) etiquetasPorContato.set(contatoId, [...(etiquetasPorContato.get(contatoId) ?? []), nome]);
    }
    console.log(`[exportacao] ${ctx.usuario.nome} exportou ${linhas.length} contato(s) da unidade ${ctx.unidadeId}`);
    return [
      ["Nome", "WhatsApp", "E-mail", "Etiquetas", "Origem", "Na base desde", "Última mensagem", "Não recebe campanhas"],
      ...linhas.map((l) => [
        l.nome ?? "",
        l.telefone,
        l.email ?? "",
        (etiquetasPorContato.get(l.id) ?? []).join(", "),
        l.origem,
        data(l.criadoEm),
        data(l.ultimaMensagemEm),
        l.descadastrado ? "sim" : "",
      ]),
    ];
  }),

  campanha: procedimentoAdmin.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const [campanha] = await ctx.db
      .select({ id: campanhasDisparo.id })
      .from(campanhasDisparo)
      .where(and(eq(campanhasDisparo.id, input.id), eq(campanhasDisparo.unidadeId, ctx.unidadeId)));
    if (!campanha) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada" });
    const linhas = await ctx.db
      .select({
        telefone: disparoDestinatarios.telefone,
        parametros: disparoDestinatarios.parametros,
        status: disparoDestinatarios.statusEnvio,
        enviadoEm: disparoDestinatarios.enviadoEm,
        entregueEm: disparoDestinatarios.entregueEm,
        lidaEm: disparoDestinatarios.lidaEm,
        erro: disparoDestinatarios.erroDetalhe,
        respondeu: sql<boolean>`exists (select 1 from ${respostasClientes} where ${q(respostasClientes.destinatarioId)} = ${q(disparoDestinatarios.id)})`,
      })
      .from(disparoDestinatarios)
      .where(eq(disparoDestinatarios.campanhaId, input.id))
      .orderBy(asc(disparoDestinatarios.id))
      .limit(LIMITE);
    console.log(`[exportacao] ${ctx.usuario.nome} exportou a campanha ${input.id} (${linhas.length} destinatário(s))`);
    return [
      ["WhatsApp", "Nome", "Situação", "Enviada em", "Entregue em", "Lida em", "Respondeu", "Erro"],
      ...linhas.map((l) => [
        l.telefone,
        l.parametros.nome ?? "",
        l.status,
        data(l.enviadoEm),
        data(l.entregueEm),
        data(l.lidaEm),
        l.respondeu ? "sim" : "",
        l.erro ?? "",
      ]),
    ];
  }),

  conversa: procedimentoAdmin.input(detalheConversaInputSchema).mutation(async ({ ctx, input }) => {
    await garantirNumeroDaUnidade(ctx.db, input.numeroId, ctx.unidadeId);
    const conversa = await obterConversa(ctx.db, input.telefone, input.numeroId);
    const quem = (m: (typeof conversa.mensagens)[number]) => (m.direcao === "recebida" ? "Cliente" : m.origem === "disparo" ? `Campanha ${m.campanhaNome ?? ""}`.trim() : "Equipe/bot");
    return [
      ["Data e hora", "Quem", "Tipo", "Mensagem", "Arquivo"],
      ...conversa.mensagens.map((m) => [data(m.em), quem(m), m.tipo, m.texto, m.midiaNome ?? (m.midiaUrl ? "sim" : "")]),
    ];
  }),
});
