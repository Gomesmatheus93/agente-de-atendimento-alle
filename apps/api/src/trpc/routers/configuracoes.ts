import {
  CHAVE_WEBHOOK_APP_SECRET,
  CHAVE_WEBHOOK_VERIFY_TOKEN,
  cifrar,
  contasWhatsapp,
  decifrar,
  midiasAgente,
  numerosWhatsapp,
  templatesWhatsapp,
  type Db,
} from "@atendimento-academias/db";
import {
  contaInputSchema,
  definirNumeroAtivoInputSchema,
  midiaAgenteInputSchema,
  numeroInputSchema,
  salvarMidiaAgenteInputSchema,
  salvarPerfilNumeroInputSchema,
  salvarContaInputSchema,
  salvarModoAgenteInputSchema,
  salvarWebhookInputSchema,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  chaveIntegracaoFinal,
  configuracaoDoAgente,
  configuracaoDoWebhook,
  gerarChaveIntegracao,
  revogarChaveIntegracao,
  salvarConfiguracaoDoAgente,
  salvarValor,
} from "../../config/plataforma.js";
import {
  atualizarPerfilDoNumero,
  buscarConta,
  buscarPerfilDoNumero,
  ErroGraph,
  listarNumeros,
  listarTemplates,
  subirImagemParaHandle,
} from "../../meta/graph.js";
import { salvarBuffer } from "../../media/armazenamento.js";
import { procedimentoAdmin, procedimentoUnidade, router } from "../trpc.js";

export function erroDaMeta(erro: unknown): TRPCError {
  if (erro instanceof ErroGraph) {
    return new TRPCError({ code: "BAD_REQUEST", message: `A Meta recusou: ${erro.message}` });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao falar com a Meta", cause: erro });
}

export async function tokenDaConta(db: Db, contaId: number): Promise<string> {
  const [conta] = await db.select().from(contasWhatsapp).where(eq(contasWhatsapp.id, contaId));
  if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
  return decifrar(conta.tokenCifrado);
}

async function numeroComToken(db: Db, unidadeId: number, numeroId: number) {
  const [numero] = await db
    .select()
    .from(numerosWhatsapp)
    .where(and(eq(numerosWhatsapp.id, numeroId), eq(numerosWhatsapp.unidadeId, unidadeId)));
  if (!numero) throw new TRPCError({ code: "NOT_FOUND", message: "Número não encontrado" });
  return { numero, token: await tokenDaConta(db, numero.contaId) };
}

// A conta da unidade (outra unidade não enxerga nem mexe).
async function contaDaUnidade(db: Db, unidadeId: number, contaId: number) {
  const [conta] = await db
    .select()
    .from(contasWhatsapp)
    .where(and(eq(contasWhatsapp.id, contaId), eq(contasWhatsapp.unidadeId, unidadeId)));
  if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
  return conta;
}

// Guarda os números que a Meta reporta para a conta. Número que sumiu lá é apagado aqui, menos se
// estiver ativo: nesse caso some da lista de uso, mas a campanha antiga continua apontando para ele.
async function sincronizarNumeros(db: Db, unidadeId: number, contaId: number, wabaId: string, token: string): Promise<number> {
  const daMeta = await listarNumeros(wabaId, token);

  for (const numero of daMeta) {
    await db
      .insert(numerosWhatsapp)
      .values({
        contaId,
        unidadeId,
        phoneNumberId: numero.id,
        numeroExibicao: numero.display_phone_number,
        nomeVerificado: numero.verified_name ?? null,
        qualidade: numero.quality_rating ?? null,
      })
      .onConflictDoUpdate({ target: numerosWhatsapp.phoneNumberId, 
        set: {
          contaId,
          numeroExibicao: numero.display_phone_number,
          nomeVerificado: numero.verified_name ?? null,
          qualidade: numero.quality_rating ?? null,
        },
      });
  }
  return daMeta.length;
}

// A Meta classifica em MARKETING/UTILITY/AUTHENTICATION; aqui o nome é outro e define o preço.
export const CATEGORIA_POR_NOME: Record<string, "marketing" | "utilidade" | "autenticacao" | "servico"> = {
  MARKETING: "marketing",
  UTILITY: "utilidade",
  AUTHENTICATION: "autenticacao",
  SERVICE: "servico",
};

// Tudo aqui é da unidade em que se está trabalhando. Ler (números, templates, perfil) é de toda a equipe;
// mudar credenciais, webhook, chave de integração, comportamento do agente e o perfil público do número é
// só do administrador da unidade (ou do superadmin).
export const configuracoesRouter = router({
  listar: procedimentoUnidade.query(async ({ ctx }) => {
    const contas = await ctx.db
      .select()
      .from(contasWhatsapp)
      .where(eq(contasWhatsapp.unidadeId, ctx.unidadeId))
      .orderBy(asc(contasWhatsapp.nome));
    const numeros = contas.length
      ? await ctx.db
          .select()
          .from(numerosWhatsapp)
          .where(inArray(numerosWhatsapp.contaId, contas.map((conta) => conta.id)))
          .orderBy(asc(numerosWhatsapp.numeroExibicao))
      : [];

    const [{ verifyToken, appSecret }, integracaoFinal, agente] = await Promise.all([
      configuracaoDoWebhook(ctx.db, ctx.unidadeId),
      chaveIntegracaoFinal(ctx.db, ctx.unidadeId),
      configuracaoDoAgente(ctx.db, ctx.unidadeId),
    ]);
    const ehAdmin = ctx.usuario.papel === "admin" || ctx.usuario.papel === "superadmin";

    return {
      // O token nunca sai daqui: a tela mostra só os últimos dígitos para você reconhecer qual está salvo.
      contas: contas.map((conta) => ({
        id: conta.id,
        nome: conta.nome,
        wabaId: conta.wabaId,
        tokenFinal: conta.tokenFinal,
        numeros: numeros
          .filter((numero) => numero.contaId === conta.id)
          .map((numero) => ({
            id: numero.id,
            phoneNumberId: numero.phoneNumberId,
            numeroExibicao: numero.numeroExibicao,
            nomeVerificado: numero.nomeVerificado,
            qualidade: numero.qualidade,
            ativo: numero.ativo,
          })),
      })),
      webhook: {
        // O token de verificação é digitado igual no painel da Meta, então aparece na tela — só para admin.
        verifyToken: ehAdmin ? (verifyToken ?? null) : null,
        // O segredo do app não: só dizemos se existe.
        appSecretConfigurado: appSecret !== null,
      },
      // A chave em si nunca volta para cá: só os últimos dígitos, pra reconhecer qual está ativa.
      integracao: { chaveFinal: integracaoFinal },
      agente,
      numerosAtivos: numeros.filter((numero) => numero.ativo).length,
    };
  }),

  // Cadastra ou atualiza uma conta. O token é testado na Meta antes de salvar: se não funcionar, nada é gravado.
  salvarConta: procedimentoAdmin.input(salvarContaInputSchema).mutation(async ({ ctx, input }) => {
    const [existente] = await ctx.db.select().from(contasWhatsapp).where(eq(contasWhatsapp.wabaId, input.wabaId));
    // Uma conta só pode ser de uma unidade: senão as conversas de uma apareceriam na outra.
    if (existente && existente.unidadeId !== ctx.unidadeId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Esta conta do WhatsApp já está cadastrada em outra unidade. Cada unidade precisa da própria conta.",
      });
    }

    const token = input.token ?? (existente ? decifrar(existente.tokenCifrado) : null);
    if (!token) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o token de acesso da conta." });
    }

    let conta;
    try {
      conta = await buscarConta(input.wabaId, token);
    } catch (erro) {
      throw erroDaMeta(erro);
    }

    const nome = input.nome?.trim() || conta.name || `Conta ${input.wabaId}`;
    const tokenCifrado = cifrar(token);
    const tokenFinal = token.slice(-4);

    let contaId: number;
    if (existente) {
      await ctx.db
        .update(contasWhatsapp)
        .set({ nome, tokenCifrado, tokenFinal })
        .where(eq(contasWhatsapp.id, existente.id));
      contaId = existente.id;
    } else {
      const [{ id }] = await ctx.db
        .insert(contasWhatsapp)
        .values({ unidadeId: ctx.unidadeId, nome, wabaId: input.wabaId, tokenCifrado, tokenFinal })
        .returning({ id: contasWhatsapp.id });
      contaId = id;
    }

    let encontrados: number;
    try {
      encontrados = await sincronizarNumeros(ctx.db, ctx.unidadeId, contaId, input.wabaId, token);
    } catch (erro) {
      throw erroDaMeta(erro);
    }

    return { contaId, nome, numeros: encontrados };
  }),

  sincronizarNumeros: procedimentoUnidade.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    const conta = await contaDaUnidade(ctx.db, ctx.unidadeId, input.contaId);

    try {
      const encontrados = await sincronizarNumeros(ctx.db, ctx.unidadeId, conta.id, conta.wabaId, decifrar(conta.tokenCifrado));
      return { numeros: encontrados };
    } catch (erro) {
      throw erroDaMeta(erro);
    }
  }),

  definirNumeroAtivo: procedimentoAdmin.input(definirNumeroAtivoInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(numerosWhatsapp)
      .set({ ativo: input.ativo })
      .where(and(eq(numerosWhatsapp.id, input.numeroId), eq(numerosWhatsapp.unidadeId, ctx.unidadeId)));
    return { numeroId: input.numeroId, ativo: input.ativo };
  }),

  removerConta: procedimentoAdmin.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(contasWhatsapp).where(and(eq(contasWhatsapp.id, input.contaId), eq(contasWhatsapp.unidadeId, ctx.unidadeId)));
    return { contaId: input.contaId };
  }),

  // Traz os templates aprovados da conta para a plataforma, para aparecerem em Nova campanha.
  sincronizarTemplates: procedimentoUnidade.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    const conta = await contaDaUnidade(ctx.db, ctx.unidadeId, input.contaId);

    let daMeta;
    try {
      daMeta = await listarTemplates(conta.wabaId, decifrar(conta.tokenCifrado));
    } catch (erro) {
      throw erroDaMeta(erro);
    }

    let importados = 0;
    let precisamDeImagem = 0;

    for (const template of daMeta) {
      const corpo = template.components?.find((parte) => parte.type === "BODY")?.text;
      // Sem corpo não há o que preencher nem o que mostrar na prévia.
      if (!corpo) continue;

      const cabecalho = template.components?.find((parte) => parte.type === "HEADER");
      const aprovado = template.status === "APPROVED";
      if (cabecalho?.format === "IMAGE") precisamDeImagem += 1;

      const [existente] = await ctx.db
        .select()
        .from(templatesWhatsapp)
        .where(
          and(
            eq(templatesWhatsapp.contaId, conta.id),
            eq(templatesWhatsapp.nome, template.name),
            eq(templatesWhatsapp.idioma, template.language),
          ),
        );

      const valores = {
        unidadeId: ctx.unidadeId,
        contaId: conta.id,
        nome: template.name,
        conteudo: corpo,
        idioma: template.language,
        categoria: CATEGORIA_POR_NOME[template.category] ?? ("marketing" as const),
        cabecalhoFormato: cabecalho?.format ?? null,
        cabecalhoTexto: cabecalho?.format === "TEXT" ? (cabecalho.text ?? null) : null,
        rodape: template.components?.find((parte) => parte.type === "FOOTER")?.text ?? null,
        metaId: template.id,
        status: template.status,
        ativo: aprovado,
        // O motivo de reprovação chega pelo webhook; aprovado depois, ele deixa de valer.
        ...(aprovado ? { motivoStatus: null } : {}),
      };

      // A imagem do cabeçalho não vem da Meta: quem já tinha uma configurada mantém.
      if (existente) await ctx.db.update(templatesWhatsapp).set(valores).where(eq(templatesWhatsapp.id, existente.id));
      else await ctx.db.insert(templatesWhatsapp).values(valores);
      importados += 1;
    }

    return { importados, precisamDeImagem };
  }),

  // Perfil comercial do número (foto, recado, descrição...), lido direto da Meta: não fica guardado aqui.
  perfilDoNumero: procedimentoUnidade.input(numeroInputSchema).query(async ({ ctx, input }) => {
    const { numero, token } = await numeroComToken(ctx.db, ctx.unidadeId, input.numeroId);
    let perfil;
    try {
      perfil = await buscarPerfilDoNumero(numero.phoneNumberId, token);
    } catch (erro) {
      throw erroDaMeta(erro);
    }
    return {
      recado: perfil.about ?? "",
      descricao: perfil.description ?? "",
      endereco: perfil.address ?? "",
      email: perfil.email ?? "",
      sites: perfil.websites ?? [],
      categoria: perfil.vertical ?? "OTHER",
      fotoUrl: perfil.profile_picture_url ?? null,
    };
  }),

  salvarPerfilDoNumero: procedimentoAdmin.input(salvarPerfilNumeroInputSchema).mutation(async ({ ctx, input }) => {
    const { numero, token } = await numeroComToken(ctx.db, ctx.unidadeId, input.numeroId);
    try {
      // A foto vai pela Resumable Upload API; o perfil recebe só o handle devolvido.
      const fotoHandle = input.foto
        ? await subirImagemParaHandle(token, Buffer.from(input.foto.base64, "base64"), input.foto.mimeType, "perfil")
        : undefined;
      await atualizarPerfilDoNumero(numero.phoneNumberId, token, {
        about: input.recado,
        description: input.descricao,
        address: input.endereco,
        email: input.email,
        websites: input.sites.filter(Boolean),
        vertical: input.categoria,
        ...(fotoHandle ? { profile_picture_handle: fotoHandle } : {}),
      });
    } catch (erro) {
      throw erroDaMeta(erro);
    }
    return { ok: true };
  }),

  // Imagens que o agente do n8n anexa às respostas, pelo nome ("imagem": "planos" em /integracoes/mensagens).
  midiasAgente: procedimentoUnidade.query(async ({ ctx }) =>
    ctx.db.select().from(midiasAgente).where(eq(midiasAgente.unidadeId, ctx.unidadeId)).orderBy(asc(midiasAgente.chave)),
  ),

  // Salvar com um nome que já existe troca a imagem: o n8n continua pedindo pelo mesmo nome.
  salvarMidiaAgente: procedimentoAdmin.input(salvarMidiaAgenteInputSchema).mutation(async ({ ctx, input }) => {
    const salvo = await salvarBuffer(Buffer.from(input.imagem.base64, "base64"), input.imagem.mimeType);
    const valores = { midiaUrl: salvo.url, mimeType: input.imagem.mimeType, descricao: input.descricao || null };
    await ctx.db
      .insert(midiasAgente)
      .values({ unidadeId: ctx.unidadeId, chave: input.chave, ...valores })
      .onConflictDoUpdate({ target: [midiasAgente.unidadeId, midiasAgente.chave], set: valores });
    return { chave: input.chave };
  }),

  removerMidiaAgente: procedimentoAdmin.input(midiaAgenteInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(midiasAgente).where(and(eq(midiasAgente.unidadeId, ctx.unidadeId), eq(midiasAgente.chave, input.chave)));
    return { ok: true };
  }),

  salvarWebhook: procedimentoAdmin.input(salvarWebhookInputSchema).mutation(async ({ ctx, input }) => {
    if (input.verifyToken) await salvarValor(ctx.db, ctx.unidadeId, CHAVE_WEBHOOK_VERIFY_TOKEN, input.verifyToken);
    if (input.appSecret) await salvarValor(ctx.db, ctx.unidadeId, CHAVE_WEBHOOK_APP_SECRET, input.appSecret, true);
    return { ok: true };
  }),

  // Gera uma chave nova para sistemas externos (n8n, Zapier, etc.) chamarem /integracoes/*. Uma chave
  // nova invalida a anterior; a tela mostra o valor uma única vez, nesta resposta.
  gerarChaveIntegracao: procedimentoAdmin.mutation(async ({ ctx }) => gerarChaveIntegracao(ctx.db, ctx.unidadeId)),

  revogarChaveIntegracao: procedimentoAdmin.mutation(async ({ ctx }) => {
    await revogarChaveIntegracao(ctx.db, ctx.unidadeId);
    return { ok: true };
  }),

  // Escolhe quem responde quando a IA está ligada numa conversa: o agente interno (Claude, vira
  // rascunho) ou o webhook do n8n (responde direto). Ver acionarAgenteSeLigado no webhook.
  salvarModoAgente: procedimentoAdmin.input(salvarModoAgenteInputSchema).mutation(async ({ ctx, input }) => {
    if (input.modo === "n8n" && !input.webhookN8nUrl) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a URL do webhook do n8n para usar esse modo." });
    }
    await salvarConfiguracaoDoAgente(ctx.db, ctx.unidadeId, input.modo, input.webhookN8nUrl || null);
    return { ok: true };
  }),
});
