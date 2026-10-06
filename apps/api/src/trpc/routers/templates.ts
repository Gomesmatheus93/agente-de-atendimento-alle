import { contasWhatsapp, decifrar, numerosWhatsapp, templatesWhatsapp } from "@atendimento-academias/db";
import {
  criarTemplateInputSchema,
  definirImagemTemplateInputSchema,
  extrairPlaceholders,
  listarTemplatesInputSchema,
  precoDaCategoria,
  type CriarTemplateInput,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { salvarBuffer } from "../../media/armazenamento.js";
import { criarTemplateNaMeta, subirImagemParaHandle } from "../../meta/graph.js";
import { procedimentoUnidade, router } from "../trpc.js";
import { CATEGORIA_POR_NOME, erroDaMeta } from "./configuracoes.js";

const CATEGORIA_NA_META = { marketing: "MARKETING", utilidade: "UTILITY" } as const;

// Monta os componentes no formato de POST /<waba>/message_templates. A Meta exige um exemplo para cada
// variável, e o formato do exemplo muda entre variáveis nomeadas ({{nome}}) e numeradas ({{1}}).
function componentesParaMeta(entrada: CriarTemplateInput, imagemHandle: string | null) {
  const componentes: Array<Record<string, unknown>> = [];

  if (entrada.cabecalho.tipo === "texto") {
    componentes.push({ type: "HEADER", format: "TEXT", text: entrada.cabecalho.texto });
  } else if (entrada.cabecalho.tipo === "imagem" && imagemHandle) {
    componentes.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [imagemHandle] } });
  }

  const variaveis = extrairPlaceholders(entrada.corpo);
  const numeradas = variaveis.length > 0 && variaveis.every((variavel) => /^\d+$/.test(variavel));
  const corpo: Record<string, unknown> = { type: "BODY", text: entrada.corpo };
  if (variaveis.length > 0) {
    corpo.example = numeradas
      ? { body_text: [[...variaveis].sort((a, b) => Number(a) - Number(b)).map((variavel) => entrada.exemplos[variavel]!)] }
      : { body_text_named_params: variaveis.map((variavel) => ({ param_name: variavel, example: entrada.exemplos[variavel]! })) };
  }
  componentes.push(corpo);

  if (entrada.rodape) componentes.push({ type: "FOOTER", text: entrada.rodape });

  return { componentes, formato: numeradas ? "POSITIONAL" : "NAMED" };
}

export const templatesRouter = router({
  // Sem número escolhido, lista todos; com número, só os da conta dele — são os que a Meta aceita enviar.
  listar: procedimentoUnidade.input(listarTemplatesInputSchema).query(async ({ ctx, input }) => {
    let contaId: number | null = null;
    if (input.numeroId) {
      const [numero] = await ctx.db
        .select()
        .from(numerosWhatsapp)
        .where(and(eq(numerosWhatsapp.id, input.numeroId), eq(numerosWhatsapp.unidadeId, ctx.unidadeId)));
      contaId = numero?.contaId ?? null;
    }

    const templates = await ctx.db
      .select()
      .from(templatesWhatsapp)
      .where(
        and(
          eq(templatesWhatsapp.unidadeId, ctx.unidadeId),
          eq(templatesWhatsapp.ativo, true),
          contaId === null ? undefined : eq(templatesWhatsapp.contaId, contaId),
        ),
      );

    return templates.map((template) => ({
      id: template.id,
      nome: template.nome,
      conteudo: template.conteudo,
      categoria: template.categoria,
      idioma: template.idioma,
      // Template com cabeçalho de imagem só envia se a imagem estiver configurada.
      exigeImagem: template.cabecalhoFormato === "IMAGE",
      temImagem: Boolean(template.cabecalhoImagemUrl),
      precoUnitario: precoDaCategoria(template.categoria),
      placeholders: extrairPlaceholders(template.conteudo),
    }));
  }),

  // Tela Templates: todos os templates de cada conta, inclusive os que a Meta ainda não aprovou (esses
  // ficam fora de Nova campanha). Os sem conta são os exemplos do seed, que não existem na Meta.
  porConta: procedimentoUnidade.query(async ({ ctx }) => {
    const [contas, templates] = await Promise.all([
      ctx.db
        .select({ id: contasWhatsapp.id, nome: contasWhatsapp.nome })
        .from(contasWhatsapp)
        .where(eq(contasWhatsapp.unidadeId, ctx.unidadeId))
        .orderBy(asc(contasWhatsapp.nome)),
      ctx.db.select().from(templatesWhatsapp).where(eq(templatesWhatsapp.unidadeId, ctx.unidadeId)).orderBy(asc(templatesWhatsapp.nome)),
    ]);

    const resumir = (template: (typeof templates)[number]) => ({
      id: template.id,
      nome: template.nome,
      conteudo: template.conteudo,
      categoria: template.categoria,
      idioma: template.idioma,
      status: template.status,
      motivoStatus: template.motivoStatus,
      aprovado: template.ativo,
      cabecalhoFormato: template.cabecalhoFormato,
      cabecalhoTexto: template.cabecalhoTexto,
      rodape: template.rodape,
      exigeImagem: template.cabecalhoFormato === "IMAGE",
      // Só a imagem guardada aqui dá para mostrar; media id da Meta não abre no navegador.
      imagemUrl: template.cabecalhoImagemUrl && /^(\/uploads\/|https?:\/\/)/.test(template.cabecalhoImagemUrl) ? template.cabecalhoImagemUrl : null,
      temImagem: Boolean(template.cabecalhoImagemUrl),
      precoUnitario: precoDaCategoria(template.categoria),
    });

    return {
      contas: contas.map((conta) => ({
        ...conta,
        templates: templates.filter((template) => template.contaId === conta.id).map(resumir),
      })),
      semConta: templates.filter((template) => template.contaId === null).map(resumir),
    };
  }),

  // Cria o template na Meta e guarda aqui como PENDING. A aprovação (ou reprovação, com motivo) chega
  // depois pelo webhook, no campo message_template_status_update; "Atualizar da Meta" também traz.
  criar: procedimentoUnidade.input(criarTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const [conta] = await ctx.db
      .select()
      .from(contasWhatsapp)
      .where(and(eq(contasWhatsapp.id, input.contaId), eq(contasWhatsapp.unidadeId, ctx.unidadeId)));
    if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });

    const [repetido] = await ctx.db
      .select({ id: templatesWhatsapp.id })
      .from(templatesWhatsapp)
      .where(
        and(eq(templatesWhatsapp.contaId, conta.id), eq(templatesWhatsapp.nome, input.nome), eq(templatesWhatsapp.idioma, input.idioma)),
      );
    if (repetido) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Já existe um template "${input.nome}" neste idioma nesta conta. Escolha outro nome, como ${input.nome}_v2.`,
      });
    }

    const token = decifrar(conta.tokenCifrado);

    // A imagem vai duas vezes: para a Meta como exemplo na análise, e para o disco, porque a Meta exige
    // a imagem de novo em cada envio — é essa cópia local que o worker manda.
    let imagemLocal: string | null = null;
    let imagemHandle: string | null = null;
    if (input.cabecalho.tipo === "imagem") {
      const buffer = Buffer.from(input.cabecalho.imagem.base64, "base64");
      imagemLocal = (await salvarBuffer(buffer, input.cabecalho.imagem.mimeType)).url;
      try {
        imagemHandle = await subirImagemParaHandle(token, buffer, input.cabecalho.imagem.mimeType, "cabecalho");
      } catch (erro) {
        throw erroDaMeta(erro);
      }
    }

    const { componentes, formato } = componentesParaMeta(input, imagemHandle);

    let criado;
    try {
      criado = await criarTemplateNaMeta(conta.wabaId, token, {
        name: input.nome,
        language: input.idioma,
        category: CATEGORIA_NA_META[input.categoria],
        parameter_format: formato,
        components: componentes,
      });
    } catch (erro) {
      throw erroDaMeta(erro);
    }

    const aprovado = criado.status === "APPROVED";
    await ctx.db.insert(templatesWhatsapp).values({
      unidadeId: ctx.unidadeId,
      contaId: conta.id,
      nome: input.nome,
      conteudo: input.corpo,
      idioma: input.idioma,
      // A Meta pode reclassificar (ex.: utilidade que ela considera marketing); vale a dela.
      categoria: CATEGORIA_POR_NOME[criado.category] ?? input.categoria,
      cabecalhoFormato: input.cabecalho.tipo === "texto" ? "TEXT" : input.cabecalho.tipo === "imagem" ? "IMAGE" : null,
      cabecalhoTexto: input.cabecalho.tipo === "texto" ? input.cabecalho.texto : null,
      cabecalhoImagemUrl: imagemLocal,
      rodape: input.rodape || null,
      metaId: criado.id,
      status: criado.status,
      ativo: aprovado,
    });

    return { status: criado.status, categoria: CATEGORIA_POR_NOME[criado.category] ?? input.categoria };
  }),

  // Imagem usada no envio de um template que tem cabeçalho de imagem (importado da Meta sem ela, ou para trocar).
  definirImagem: procedimentoUnidade.input(definirImagemTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const [template] = await ctx.db
      .select()
      .from(templatesWhatsapp)
      .where(and(eq(templatesWhatsapp.id, input.templateId), eq(templatesWhatsapp.unidadeId, ctx.unidadeId)));
    if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado" });
    if (template.cabecalhoFormato !== "IMAGE") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Este template não tem cabeçalho de imagem." });
    }

    const salvo = await salvarBuffer(Buffer.from(input.imagem.base64, "base64"), input.imagem.mimeType);
    await ctx.db.update(templatesWhatsapp).set({ cabecalhoImagemUrl: salvo.url }).where(eq(templatesWhatsapp.id, template.id));
    return { imagemUrl: salvo.url };
  }),
});
