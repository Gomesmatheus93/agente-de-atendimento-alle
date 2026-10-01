import {
  CHAVE_WEBHOOK_APP_SECRET,
  CHAVE_WEBHOOK_VERIFY_TOKEN,
  cifrar,
  configuracoes,
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
  gerarChaveIntegracao,
  revogarChaveIntegracao,
  salvarConfiguracaoDoAgente,
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
import { procedimentoAutenticado, router } from "../trpc.js";

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

async function numeroComToken(db: Db, numeroId: number) {
  const [numero] = await db.select().from(numerosWhatsapp).where(eq(numerosWhatsapp.id, numeroId));
  if (!numero) throw new TRPCError({ code: "NOT_FOUND", message: "Número não encontrado" });
  return { numero, token: await tokenDaConta(db, numero.contaId) };
}

// Guarda os números que a Meta reporta para a conta. Número que sumiu lá é apagado aqui, menos se
// estiver ativo: nesse caso some da lista de uso, mas a campanha antiga continua apontando para ele.
async function sincronizarNumeros(db: Db, contaId: number, wabaId: string, token: string): Promise<number> {
  const daMeta = await listarNumeros(wabaId, token);

  for (const numero of daMeta) {
    await db
      .insert(numerosWhatsapp)
      .values({
        contaId,
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

async function lerConfiguracao(db: Db, chave: string): Promise<string | null> {
  const [linha] = await db.select().from(configuracoes).where(eq(configuracoes.chave, chave));
  if (!linha) return null;
  return linha.secreto ? decifrar(linha.valor) : linha.valor;
}

async function salvarConfiguracao(db: Db, chave: string, valor: string, secreto: boolean): Promise<void> {
  const guardado = secreto ? cifrar(valor) : valor;
  await db
    .insert(configuracoes)
    .values({ chave, valor: guardado, secreto })
    .onConflictDoUpdate({ target: configuracoes.chave,  set: { valor: guardado, secreto } });
}

// A Meta classifica em MARKETING/UTILITY/AUTHENTICATION; aqui o nome é outro e define o preço.
export const CATEGORIA_POR_NOME: Record<string, "marketing" | "utilidade" | "autenticacao" | "servico"> = {
  MARKETING: "marketing",
  UTILITY: "utilidade",
  AUTHENTICATION: "autenticacao",
  SERVICE: "servico",
};

export const configuracoesRouter = router({
  listar: procedimentoAutenticado.query(async ({ ctx }) => {
    const contas = await ctx.db.select().from(contasWhatsapp).orderBy(asc(contasWhatsapp.nome));
    const numeros = contas.length
      ? await ctx.db
          .select()
          .from(numerosWhatsapp)
          .where(inArray(numerosWhatsapp.contaId, contas.map((conta) => conta.id)))
          .orderBy(asc(numerosWhatsapp.numeroExibicao))
      : [];

    const [verifyToken, appSecret, integracaoFinal, agente] = await Promise.all([
      lerConfiguracao(ctx.db, CHAVE_WEBHOOK_VERIFY_TOKEN),
      lerConfiguracao(ctx.db, CHAVE_WEBHOOK_APP_SECRET),
      chaveIntegracaoFinal(ctx.db),
      configuracaoDoAgente(ctx.db),
    ]);

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
        // O token de verificação é digitado igual no painel da Meta, então pode aparecer na tela.
        verifyToken: verifyToken ?? null,
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
  salvarConta: procedimentoAutenticado.input(salvarContaInputSchema).mutation(async ({ ctx, input }) => {
    const [existente] = await ctx.db.select().from(contasWhatsapp).where(eq(contasWhatsapp.wabaId, input.wabaId));

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
        .values({ nome, wabaId: input.wabaId, tokenCifrado, tokenFinal })
        .returning({ id: contasWhatsapp.id });
      contaId = id;
    }

    let encontrados: number;
    try {
      encontrados = await sincronizarNumeros(ctx.db, contaId, input.wabaId, token);
    } catch (erro) {
      throw erroDaMeta(erro);
    }

    return { contaId, nome, numeros: encontrados };
  }),

  sincronizarNumeros: procedimentoAutenticado.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    const [conta] = await ctx.db.select().from(contasWhatsapp).where(eq(contasWhatsapp.id, input.contaId));
    if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });

    try {
      const encontrados = await sincronizarNumeros(ctx.db, conta.id, conta.wabaId, decifrar(conta.tokenCifrado));
      return { numeros: encontrados };
    } catch (erro) {
      throw erroDaMeta(erro);
    }
  }),

  definirNumeroAtivo: procedimentoAutenticado.input(definirNumeroAtivoInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.update(numerosWhatsapp).set({ ativo: input.ativo }).where(eq(numerosWhatsapp.id, input.numeroId));
    return { numeroId: input.numeroId, ativo: input.ativo };
  }),

  removerConta: procedimentoAutenticado.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(contasWhatsapp).where(eq(contasWhatsapp.id, input.contaId));
    return { contaId: input.contaId };
  }),

  // Traz os templates aprovados da conta para a plataforma, para aparecerem em Nova campanha.
  sincronizarTemplates: procedimentoAutenticado.input(contaInputSchema).mutation(async ({ ctx, input }) => {
    const [conta] = await ctx.db.select().from(contasWhatsapp).where(eq(contasWhatsapp.id, input.contaId));
    if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });

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
  perfilDoNumero: procedimentoAutenticado.input(numeroInputSchema).query(async ({ ctx, input }) => {
    const { numero, token } = await numeroComToken(ctx.db, input.numeroId);
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

  salvarPerfilDoNumero: procedimentoAutenticado.input(salvarPerfilNumeroInputSchema).mutation(async ({ ctx, input }) => {
    const { numero, token } = await numeroComToken(ctx.db, input.numeroId);
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
  midiasAgente: procedimentoAutenticado.query(async ({ ctx }) =>
    ctx.db.select().from(midiasAgente).orderBy(asc(midiasAgente.chave)),
  ),

  // Salvar com um nome que já existe troca a imagem: o n8n continua pedindo pelo mesmo nome.
  salvarMidiaAgente: procedimentoAutenticado.input(salvarMidiaAgenteInputSchema).mutation(async ({ ctx, input }) => {
    const salvo = await salvarBuffer(Buffer.from(input.imagem.base64, "base64"), input.imagem.mimeType);
    const valores = { midiaUrl: salvo.url, mimeType: input.imagem.mimeType, descricao: input.descricao || null };
    await ctx.db
      .insert(midiasAgente)
      .values({ chave: input.chave, ...valores })
      .onConflictDoUpdate({ target: midiasAgente.chave, set: valores });
    return { chave: input.chave };
  }),

  removerMidiaAgente: procedimentoAutenticado.input(midiaAgenteInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(midiasAgente).where(eq(midiasAgente.chave, input.chave));
    return { ok: true };
  }),

  salvarWebhook: procedimentoAutenticado.input(salvarWebhookInputSchema).mutation(async ({ ctx, input }) => {
    if (input.verifyToken) await salvarConfiguracao(ctx.db, CHAVE_WEBHOOK_VERIFY_TOKEN, input.verifyToken, false);
    if (input.appSecret) await salvarConfiguracao(ctx.db, CHAVE_WEBHOOK_APP_SECRET, input.appSecret, true);
    return { ok: true };
  }),

  // Gera uma chave nova para sistemas externos (n8n, Zapier, etc.) chamarem /integracoes/*. Uma chave
  // nova invalida a anterior; a tela mostra o valor uma única vez, nesta resposta.
  gerarChaveIntegracao: procedimentoAutenticado.mutation(async ({ ctx }) => gerarChaveIntegracao(ctx.db)),

  revogarChaveIntegracao: procedimentoAutenticado.mutation(async ({ ctx }) => {
    await revogarChaveIntegracao(ctx.db);
    return { ok: true };
  }),

  // Escolhe quem responde quando a IA está ligada numa conversa: o agente interno (Claude, vira
  // rascunho) ou o webhook do n8n (responde direto). Ver acionarAgenteSeLigado no webhook.
  salvarModoAgente: procedimentoAutenticado.input(salvarModoAgenteInputSchema).mutation(async ({ ctx, input }) => {
    if (input.modo === "n8n" && !input.webhookN8nUrl) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Informe a URL do webhook do n8n para usar esse modo." });
    }
    await salvarConfiguracaoDoAgente(ctx.db, input.modo, input.webhookN8nUrl || null);
    return { ok: true };
  }),
});
