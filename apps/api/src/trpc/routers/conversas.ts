import {
  campanhasDisparo,
  contatos,
  conversasConfig,
  disparoDestinatarios,
  mensagensSaida,
  numerosWhatsapp,
  respostasClientes,
  sugestoesIa,
  templatesWhatsapp,
  conversasExcluidas,
} from "@atendimento-academias/db";
import {
  definirIaInputSchema,
  detalheConversaInputSchema,
  enviarAudioInputSchema,
  enviarRespostaInputSchema,
  gerarSugestaoInputSchema,
  marcarComoNaoLidaInputSchema,
  resolverHumanoInputSchema,
  sugestaoIaInputSchema,
  listarConversasInputSchema,
  preencherTemplate,
  reenviarRespostaInputSchema,
  type TipoMensagem,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, count, countDistinct, desc, eq, inArray, isNotNull, isNull, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { salvarBase64 } from "../../media/armazenamento.js";
import { pedirSugestaoIa } from "../../queue.js";
import {
  enfileirarResposta,
  enviarMensagem,
  excluirConversa,
  garantirJanelaAberta,
  marcarComoRespondida,
  obterConversa,
  ultimaMensagemDoCliente,
} from "../../servicos/conversas.js";
import { procedimentoAutenticado, router } from "../trpc.js";

// Curingas do LIKE digitados pelo usuário viram texto comum.
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

const naoLidasEm = sql<string>`sum(case when ${respostasClientes.lidaEm} is null then 1 else 0 end)`;

// A conversa é o par número da operação + telefone do cliente.
function chaveDaConversa(numeroId: number | null, telefone: string): string {
  return `${numeroId ?? 0}|${telefone}`;
}

// Prévia da lista de conversas: áudio e figurinha não têm texto, então a lista mostra um rótulo no lugar.
function previaDoConteudo(tipo: TipoMensagem, texto: string): string {
  if (tipo === "audio") return "🎤 Áudio";
  if (tipo === "figurinha") return "Figurinha";
  if (tipo === "imagem") return texto ? `🖼️ ${texto}` : "🖼️ Imagem";
  return texto;
}

export const conversasRouter = router({
  // Uma conversa por telefone que recebeu um disparo ou nos escreveu, da mais recente para a mais antiga.
  // Cada fonte é limitada por recência: juntar as mais recentes de cada uma e cortar de novo dá o mesmo
  // resultado de ordenar tudo junto, sem carregar a base inteira.
  listar: procedimentoAutenticado.input(listarConversasInputSchema).query(async ({ ctx, input }) => {
    const busca = input.busca?.trim();
    const padrao = busca ? `%${escaparLike(busca)}%` : null;
    const digitos = busca ? busca.replace(/\D/g, "") : "";

    const telefonesComNomeQueCombina = padrao
      ? [
          ctx.db.select({ telefone: contatos.telefone }).from(contatos).where(ilike(contatos.nomePerfil, padrao)),
          ctx.db
            .select({ telefone: disparoDestinatarios.telefone })
            .from(disparoDestinatarios)
            .where(sql`${disparoDestinatarios.parametros}->>'nome' ilike ${padrao}`),
        ]
      : [];

    function filtroDeBusca(coluna: PgColumn, texto?: SQL): SQL | undefined {
      if (!padrao) return undefined;
      const condicoes: SQL[] = telefonesComNomeQueCombina.map((consulta) => inArray(coluna, consulta));
      if (texto) condicoes.push(texto);
      if (digitos.length >= 3) condicoes.push(ilike(coluna, `%${digitos}%`));
      return or(...condicoes);
    }

    const ultimaRecebidaEm = max(respostasClientes.recebidaEm);
    const ultimoDisparoEm = max(disparoDestinatarios.enviadoEm);
    const ultimaSaidaEm = max(mensagensSaida.createdAt);

    // Um telefone entra na lista por qualquer uma das três coisas que podem ter acontecido com ele.
    const [recebidas, disparos, enviadas] = await Promise.all([
      ctx.db
        .select({ telefone: respostasClientes.telefone, numeroId: respostasClientes.numeroId, em: ultimaRecebidaEm })
        .from(respostasClientes)
        .where(filtroDeBusca(respostasClientes.telefone, padrao ? ilike(respostasClientes.texto, padrao) : undefined))
        .groupBy(respostasClientes.telefone, respostasClientes.numeroId)
        .orderBy(desc(ultimaRecebidaEm))
        .limit(input.limite),
      ctx.db
        .select({ telefone: disparoDestinatarios.telefone, numeroId: campanhasDisparo.numeroId, em: ultimoDisparoEm })
        .from(disparoDestinatarios)
        .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
        .where(
          and(
            eq(disparoDestinatarios.statusEnvio, "enviado"),
            isNotNull(disparoDestinatarios.enviadoEm),
            filtroDeBusca(disparoDestinatarios.telefone),
          ),
        )
        .groupBy(disparoDestinatarios.telefone, campanhasDisparo.numeroId)
        .orderBy(desc(ultimoDisparoEm))
        .limit(input.limite),
      ctx.db
        .select({ telefone: mensagensSaida.telefone, numeroId: mensagensSaida.numeroId, em: ultimaSaidaEm })
        .from(mensagensSaida)
        .where(filtroDeBusca(mensagensSaida.telefone, padrao ? ilike(mensagensSaida.texto, padrao) : undefined))
        .groupBy(mensagensSaida.telefone, mensagensSaida.numeroId)
        .orderBy(desc(ultimaSaidaEm))
        .limit(input.limite),
    ]);

    // A mesma pessoa falando com dois números da operação são duas conversas, como no WhatsApp dela.
    const atividade = new Map<string, { telefone: string; numeroId: number; em: Date }>();
    for (const linha of [...recebidas, ...disparos, ...enviadas]) {
      if (!linha.em || linha.numeroId === null) continue;
      const em = new Date(linha.em as unknown as string | Date);
      const chave = chaveDaConversa(linha.numeroId, linha.telefone);
      const atual = atividade.get(chave);
      if (!atual || em > atual.em) atividade.set(chave, { telefone: linha.telefone, numeroId: linha.numeroId, em });
    }

    // Conversa excluída só volta à lista se tiver acontecido algo depois da exclusão.
    const exclusoes = await ctx.db.select().from(conversasExcluidas);
    const excluidaEm = new Map(exclusoes.map((linha) => [chaveDaConversa(linha.numeroId, linha.telefone), linha.excluidaEm]));
    const ordenadas = [...atividade.entries()]
      .filter(([chave, conversa]) => {
        const excluida = excluidaEm.get(chave);
        return !excluida || conversa.em > excluida;
      })
      .map(([, conversa]) => conversa)
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, input.limite);
    if (ordenadas.length === 0) return [];
    const telefones = [...new Set(ordenadas.map((conversa) => conversa.telefone))];

    // As contagens são exatas para os telefones escolhidos, mesmo que a última resposta seja antiga.
    const [contagens, respostas, destinatarios, saidas, configs, perfis, numeros] = await Promise.all([
      ctx.db
        .select({ telefone: respostasClientes.telefone, numeroId: respostasClientes.numeroId, naoLidas: naoLidasEm, total: count() })
        .from(respostasClientes)
        .where(inArray(respostasClientes.telefone, telefones))
        .groupBy(respostasClientes.telefone, respostasClientes.numeroId),
      ctx.db
        .select({
          telefone: respostasClientes.telefone,
          numeroId: respostasClientes.numeroId,
          tipo: respostasClientes.tipo,
          texto: respostasClientes.texto,
          em: respostasClientes.recebidaEm,
        })
        .from(respostasClientes)
        .where(inArray(respostasClientes.telefone, telefones))
        .orderBy(desc(respostasClientes.recebidaEm), desc(respostasClientes.id)),
      ctx.db
        .select({
          telefone: disparoDestinatarios.telefone,
          numeroId: campanhasDisparo.numeroId,
          parametros: disparoDestinatarios.parametros,
          em: disparoDestinatarios.enviadoEm,
          conteudo: templatesWhatsapp.conteudo,
        })
        .from(disparoDestinatarios)
        .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
        .innerJoin(templatesWhatsapp, eq(templatesWhatsapp.id, campanhasDisparo.templateId))
        .where(and(inArray(disparoDestinatarios.telefone, telefones), eq(disparoDestinatarios.statusEnvio, "enviado")))
        .orderBy(desc(disparoDestinatarios.enviadoEm), desc(disparoDestinatarios.id)),
      ctx.db
        .select({
          telefone: mensagensSaida.telefone,
          numeroId: mensagensSaida.numeroId,
          tipo: mensagensSaida.tipo,
          texto: mensagensSaida.texto,
          em: mensagensSaida.createdAt,
        })
        .from(mensagensSaida)
        .where(inArray(mensagensSaida.telefone, telefones))
        .orderBy(desc(mensagensSaida.createdAt), desc(mensagensSaida.id)),
      ctx.db
        .select({
          telefone: conversasConfig.telefone,
          numeroId: conversasConfig.numeroId,
          iaAtiva: conversasConfig.iaAtiva,
          precisaHumano: conversasConfig.precisaHumano,
        })
        .from(conversasConfig)
        .where(inArray(conversasConfig.telefone, telefones)),
      ctx.db
        .select({ telefone: contatos.telefone, nomePerfil: contatos.nomePerfil })
        .from(contatos)
        .where(inArray(contatos.telefone, telefones)),
      ctx.db.select({ id: numerosWhatsapp.id, exibicao: numerosWhatsapp.numeroExibicao }).from(numerosWhatsapp),
    ]);

    const exibicaoDoNumero = new Map(numeros.map((numero) => [numero.id, numero.exibicao]));
    const contagemPorConversa = new Map(contagens.map((linha) => [chaveDaConversa(linha.numeroId, linha.telefone), linha]));
    const configPorConversa = new Map(configs.map((config) => [chaveDaConversa(config.numeroId, config.telefone), config]));

    // Todas as listas vêm da mais nova para a mais antiga: a primeira de cada conversa é a que vale.
    function primeiraPorConversa<T extends { telefone: string; numeroId: number | null }>(linhasOrdenadas: T[]): Map<string, T> {
      const mapa = new Map<string, T>();
      for (const linha of linhasOrdenadas) {
        const chave = chaveDaConversa(linha.numeroId, linha.telefone);
        if (!mapa.has(chave)) mapa.set(chave, linha);
      }
      return mapa;
    }

    const ultimaRecebidaPorConversa = primeiraPorConversa(respostas);
    const ultimoDisparoPorConversa = primeiraPorConversa(destinatarios);
    const ultimaSaidaPorConversa = primeiraPorConversa(saidas);

    // O nome do perfil é o que a própria pessoa escolheu no WhatsApp; o parâmetro da campanha é o que
    // digitamos sobre ela. O dela vale mais.
    const nomePorTelefone = new Map<string, string>();
    for (const perfil of perfis) {
      if (perfil.nomePerfil?.trim()) nomePorTelefone.set(perfil.telefone, perfil.nomePerfil.trim());
    }
    for (const destinatario of destinatarios) {
      const nome = destinatario.parametros.nome?.trim();
      if (nome && !nomePorTelefone.has(destinatario.telefone)) nomePorTelefone.set(destinatario.telefone, nome);
    }

    const conversas = ordenadas.map(({ telefone, numeroId, em: ultimaEm }) => {
      const chave = chaveDaConversa(numeroId, telefone);
      const contagem = contagemPorConversa.get(chave);
      const recebida = ultimaRecebidaPorConversa.get(chave);
      const saida = ultimaSaidaPorConversa.get(chave);
      const disparo = ultimoDisparoPorConversa.get(chave);

      // A prévia é a última mensagem da conversa, venha de quem vier — como em qualquer caixa de entrada.
      const candidatas: Array<{ em: Date; texto: string }> = [];
      if (recebida) candidatas.push({ em: recebida.em, texto: previaDoConteudo(recebida.tipo, recebida.texto) });
      if (saida) candidatas.push({ em: saida.em, texto: `Você: ${previaDoConteudo(saida.tipo, saida.texto)}` });
      if (disparo?.em) {
        candidatas.push({ em: disparo.em, texto: `Você: ${preencherTemplate(disparo.conteudo, disparo.parametros)}` });
      }
      const previa = candidatas.sort((a, b) => b.em.getTime() - a.em.getTime())[0]?.texto ?? "";

      return {
        telefone,
        numeroId,
        numeroExibicao: exibicaoDoNumero.get(numeroId) ?? null,
        nome: nomePorTelefone.get(telefone) ?? null,
        ultimaMensagem: previa,
        iaAtiva: configPorConversa.get(chave)?.iaAtiva ?? false,
        precisaHumano: configPorConversa.get(chave)?.precisaHumano ?? false,
        ultimaEm: ultimaEm.toISOString(),
        naoLidas: Number(contagem?.naoLidas ?? 0),
        total: Number(contagem?.total ?? 0),
      };
    });

    return input.apenasNaoLidas ? conversas.filter((conversa) => conversa.naoLidas > 0) : conversas;
  }),
  // A conversa reúne o que o cliente escreveu, os disparos que enviamos (template já preenchido)
  // e as respostas da equipe, em ordem de horário. Mesma consulta usada pela API de integração.
  detalhe: procedimentoAutenticado
    .input(detalheConversaInputSchema)
    .query(async ({ ctx, input }) => obterConversa(ctx.db, input.telefone, input.numeroId)),

  excluir: procedimentoAutenticado.input(detalheConversaInputSchema).mutation(async ({ ctx, input }) => {
    await excluirConversa(ctx.db, input.telefone, input.numeroId);
    return { ok: true };
  }),

  // A resposta é gravada como pendente e enviada em segundo plano pelo worker; a tela acompanha o status.
  enviarResposta: procedimentoAutenticado.input(enviarRespostaInputSchema).mutation(async ({ ctx, input }) => enviarMensagem(ctx.db, input)),

  // Nota de voz gravada no painel: grava o arquivo em disco e enfileira igual a uma resposta de texto.
  enviarAudio: procedimentoAutenticado.input(enviarAudioInputSchema).mutation(async ({ ctx, input }) => {
    garantirJanelaAberta(await ultimaMensagemDoCliente(ctx.db, input.telefone, input.numeroId));

    const salvo = await salvarBase64(input.audioBase64, input.mimeType);

    const [{ id }] = await ctx.db
      .insert(mensagensSaida)
      .values({
        telefone: input.telefone,
        numeroId: input.numeroId,
        tipo: "audio",
        texto: "",
        midiaUrl: salvo.url,
        midiaMimeType: input.mimeType,
      })
      .returning({ id: mensagensSaida.id });

    await enfileirarResposta(ctx.db, id, 1);
    await marcarComoRespondida(ctx.db, input.telefone, input.numeroId);

    return { id };
  }),

  reenviarResposta: procedimentoAutenticado.input(reenviarRespostaInputSchema).mutation(async ({ ctx, input }) => {
    const [mensagem] = await ctx.db.select().from(mensagensSaida).where(eq(mensagensSaida.id, input.id));

    if (!mensagem) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada" });
    }
    if (mensagem.statusEnvio !== "falhou") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Só é possível reenviar mensagens que falharam." });
    }

    if (!mensagem.numeroId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Mensagem sem número de origem; não dá para reenviar." });
    }
    garantirJanelaAberta(await ultimaMensagemDoCliente(ctx.db, mensagem.telefone, mensagem.numeroId));

    await ctx.db
      .update(mensagensSaida)
      .set({ statusEnvio: "pendente", erroDetalhe: null })
      .where(eq(mensagensSaida.id, input.id));

    await enfileirarResposta(ctx.db, input.id, mensagem.tentativas + 1);

    return { id: input.id };
  }),

  // Liga ou desliga a IA nessa conversa. Ao ligar, ela já sugere uma resposta se o cliente estiver esperando.
  definirIa: procedimentoAutenticado.input(definirIaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .insert(conversasConfig)
      .values({ telefone: input.telefone, numeroId: input.numeroId, iaAtiva: input.ativa })
      .onConflictDoUpdate({ target: conversasConfig.telefone,  set: { iaAtiva: input.ativa, numeroId: input.numeroId } });

    if (input.ativa) await pedirSugestaoIa(input.telefone, input.numeroId);

    return { telefone: input.telefone, ativa: input.ativa };
  }),

  // Pede à IA uma sugestão agora, sem esperar o cliente escrever de novo.
  gerarSugestao: procedimentoAutenticado.input(gerarSugestaoInputSchema).mutation(async ({ input }) => {
    await pedirSugestaoIa(input.telefone, input.numeroId);
    return { telefone: input.telefone };
  }),

  descartarSugestao: procedimentoAutenticado.input(sugestaoIaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(sugestoesIa)
      .set({ status: "descartada" })
      .where(and(eq(sugestoesIa.id, input.id), eq(sugestoesIa.status, "pendente")));
    return { id: input.id };
  }),

  // A equipe assumiu a conversa que a IA passou adiante; ela volta a sugerir nas próximas mensagens.
  resolverHumano: procedimentoAutenticado.input(resolverHumanoInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(conversasConfig)
      .set({ precisaHumano: false, motivoHumano: null })
      .where(and(eq(conversasConfig.telefone, input.telefone), eq(conversasConfig.numeroId, input.numeroId)));
    return { telefone: input.telefone };
  }),

  marcarComoLida: procedimentoAutenticado.input(detalheConversaInputSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(respostasClientes)
      .set({ lidaEm: new Date() })
      .where(
        and(
          eq(respostasClientes.telefone, input.telefone),
          eq(respostasClientes.numeroId, input.numeroId),
          isNull(respostasClientes.lidaEm),
        ),
      );

    return { telefone: input.telefone };
  }),

  // "Marcar como não lida": destrava de novo a última mensagem do cliente. O contador de não lidas e a
  // ordenação da lista de conversas já são derivados de respostas_clientes.lida_em, então isso basta
  // para a conversa voltar a aparecer como não lida, sem precisar de uma coluna à parte.
  marcarComoNaoLida: procedimentoAutenticado.input(marcarComoNaoLidaInputSchema).mutation(async ({ ctx, input }) => {
    const [ultima] = await ctx.db
      .select({ id: respostasClientes.id })
      .from(respostasClientes)
      .where(and(eq(respostasClientes.telefone, input.telefone), eq(respostasClientes.numeroId, input.numeroId)))
      .orderBy(desc(respostasClientes.recebidaEm), desc(respostasClientes.id))
      .limit(1);

    if (ultima) {
      await ctx.db.update(respostasClientes).set({ lidaEm: null }).where(eq(respostasClientes.id, ultima.id));
    }

    return { telefone: input.telefone };
  }),

  // Alimenta o contador do menu lateral.
  contarNaoLidas: procedimentoAutenticado.query(async ({ ctx }) => {
    const [linha] = await ctx.db
      .select({ conversas: countDistinct(respostasClientes.telefone), mensagens: count() })
      .from(respostasClientes)
      .where(isNull(respostasClientes.lidaEm));

    return { conversas: linha?.conversas ?? 0, mensagens: linha?.mensagens ?? 0 };
  }),
});
