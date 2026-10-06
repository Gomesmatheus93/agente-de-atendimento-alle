import { createHmac, timingSafeEqual } from "node:crypto";
import {
  campanhasDisparo,
  contatos,
  conversasConfig,
  disparoDestinatarios,
  mensagensSaida,
  respostasClientes,
  templatesWhatsapp,
  contasWhatsapp,
  type Db,
} from "@atendimento-academias/db";
import { IA_SUGESTAO_ATRASO_MS, type TipoMensagem } from "@atendimento-academias/shared";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import express, { type Request, type Router } from "express";
import { z } from "zod";
import {
  configuracaoDoAgente,
  numeroPeloPhoneNumberId,
  segredoDoAppDaUnidade,
  tokenDaConta,
  tokenDeVerificacaoConhecido,
  unidadesDasContas,
} from "../config/plataforma.js";
import { baixarMidia } from "../meta/graph.js";
import { salvarBuffer } from "../media/armazenamento.js";
import { pedirAnaliseDaConversa, pedirSugestaoIa } from "../queue.js";
import { getDb } from "../trpc/context.js";

// Uma resposta só é atribuída a uma campanha se chegou até esse tempo depois do envio.
const JANELA_ATRIBUICAO_MS = 7 * 86_400_000;

// Formato do webhook da WhatsApp Cloud API (Meta). Só os campos que usamos.
const payloadSchema = z.object({
  entry: z
    .array(
      z.object({
        // A Meta manda aqui o ID da conta do WhatsApp Business (WABA) dona do número.
        id: z.string().optional(),
        changes: z.array(
          z.object({
            // "messages" (mensagens e status de entrega) ou "message_template_status_update" (análise de template).
            field: z.string().optional(),
            value: z.object({
              // Análise de template: aprovado, reprovado, pausado... Não traz metadata/phone_number_id.
              event: z.string().optional(),
              message_template_id: z.union([z.number(), z.string()]).optional(),
              message_template_name: z.string().optional(),
              message_template_language: z.string().optional(),
              reason: z.string().nullable().optional(),
              // Número de destino do evento. O app pode estar inscrito em outras contas do WhatsApp.
              metadata: z.object({ phone_number_id: z.string() }).optional(),
              // Situação de cada mensagem que NÓS enviamos (sent, delivered, read, failed).
              statuses: z
                .array(
                  z.object({
                    id: z.string(),
                    status: z.string(),
                    timestamp: z.string().optional(),
                    recipient_id: z.string().optional(),
                    errors: z
                      .array(
                        z.object({
                          code: z.number().optional(),
                          title: z.string().optional(),
                          message: z.string().optional(),
                          error_data: z.object({ details: z.string().optional() }).optional(),
                        }),
                      )
                      .optional(),
                  }),
                )
                .optional(),
              // Quem enviou: traz o nome que a pessoa configurou no WhatsApp dela.
              contacts: z
                .array(
                  z.object({
                    wa_id: z.string(),
                    profile: z.object({ name: z.string() }).optional(),
                  }),
                )
                .optional(),
              messages: z
                .array(
                  z.object({
                    id: z.string(),
                    from: z.string(),
                    timestamp: z.string(),
                    // text, image, audio, sticker, reaction, ... — tratamos texto, áudio e figurinha.
                    type: z.string().optional(),
                    text: z.object({ body: z.string() }).optional(),
                    audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
                    sticker: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
                    button: z.object({ text: z.string() }).optional(),
                    interactive: z
                      .object({
                        button_reply: z.object({ title: z.string() }).optional(),
                        list_reply: z.object({ title: z.string() }).optional(),
                      })
                      .optional(),
                  }),
                )
                .optional(),
            }),
          }),
        ),
      }),
    )
    .default([]),
});

type MensagemRecebida = NonNullable<
  z.infer<typeof payloadSchema>["entry"][number]["changes"][number]["value"]["messages"]
>[number] & { numeroId?: number; contaId?: number; unidadeId?: number };

interface ConteudoMensagem {
  tipo: TipoMensagem;
  texto: string;
  midiaUrl: string | null;
  midiaMimeType: string | null;
}

interface RequisicaoComCorpoBruto extends Request {
  rawBody?: Buffer;
}

function textoDaMensagem(mensagem: MensagemRecebida): string | null {
  const texto =
    mensagem.text?.body ??
    mensagem.button?.text ??
    mensagem.interactive?.button_reply?.title ??
    mensagem.interactive?.list_reply?.title;
  return texto?.trim() ? texto.trim() : null;
}

// A Meta às vezes entrega números brasileiros sem o nono dígito (12 dígitos), enquanto guardamos com ele.
function variantesDoTelefone(telefone: string): string[] {
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("55")) return [digitos, `${digitos.slice(0, 4)}9${digitos.slice(4)}`];
  return [digitos];
}

function assinaturaValida(req: RequisicaoComCorpoBruto, segredo: string): boolean {
  const recebida = req.header("x-hub-signature-256");
  if (!recebida || !req.rawBody) return false;

  const esperada = `sha256=${createHmac("sha256", segredo).update(req.rawBody).digest("hex")}`;
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Guarda o nome que a pessoa configurou no WhatsApp. Só chega em mensagem recebida: de quem apenas
// recebeu um disparo e nunca escreveu, o WhatsApp não informa o nome.
async function registrarContato(db: Db, telefone: string, nomePerfil: string): Promise<void> {
  await db
    .insert(contatos)
    .values({ telefone, nomePerfil })
    .onConflictDoUpdate({ target: contatos.telefone,  set: { nomePerfil } });
}

// A IA liga sozinha quando um cliente nosso escreve, para o atendimento seguir sem esperar a equipe. Ela
// só fica parada quando: alguém da equipe desligou à mão nesta conversa (iaDesligadaManual), ou o cliente
// pediu uma pessoa / o bot não soube responder (precisaHumano — até "Encerrar atendimento").
async function acionarAgenteSeLigado(
  db: Db,
  telefone: string,
  numeroId: number,
  unidadeId: number,
  conteudo: ConteudoMensagem,
  nomePerfil: string | undefined,
): Promise<void> {
  const [existente] = await db
    .select({
      iaAtiva: conversasConfig.iaAtiva,
      iaDesligadaManual: conversasConfig.iaDesligadaManual,
      precisaHumano: conversasConfig.precisaHumano,
    })
    .from(conversasConfig)
    .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));

  if (!existente) {
    await db.insert(conversasConfig).values({ telefone, numeroId, iaAtiva: true }).onConflictDoNothing();
  } else if (!existente.iaAtiva && !existente.iaDesligadaManual) {
    await db
      .update(conversasConfig)
      .set({ iaAtiva: true })
      .where(and(eq(conversasConfig.telefone, telefone), eq(conversasConfig.numeroId, numeroId)));
  }

  if (existente?.iaDesligadaManual || existente?.precisaHumano) return;

  const { modo, webhookN8nUrl } = await configuracaoDoAgente(db, unidadeId);

  // Modo n8n: a plataforma só avisa que chegou mensagem nova; quem decide o que responder (e responde,
  // via POST /integracoes/mensagens) é o fluxo do n8n. Sem rascunho aqui — essa é a diferença combinada
  // com o modo interno, que só sugere.
  if (modo === "n8n") {
    if (!webhookN8nUrl) {
      console.warn(
        `[webhook-whatsapp] modo do agente é "n8n" mas nenhuma URL de webhook está configurada; ${telefone} ficou sem resposta automática.`,
      );
      return;
    }
    try {
      await fetch(webhookN8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone,
          numeroId,
          unidadeId,
          nomeCliente: nomePerfil ?? null,
          mensagem: {
            tipo: conteudo.tipo,
            texto: conteudo.texto,
            midiaUrl: conteudo.midiaUrl,
            recebidaEm: new Date().toISOString(),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (erro) {
      // A mensagem já está gravada; falhar em avisar o n8n não justifica fazer a Meta reenviar o webhook.
      console.error(`[webhook-whatsapp] falha ao notificar o n8n para ${telefone}:`, erro);
    }
    return;
  }

  try {
    await pedirSugestaoIa(telefone, numeroId, IA_SUGESTAO_ATRASO_MS);
  } catch (erro) {
    console.error(`[webhook-whatsapp] não foi possível pedir sugestão da IA para ${telefone}:`, erro);
  }
}

// Baixa áudio/figurinha da Meta (a mensagem só traz o id) e grava no disco local. Falha aqui não derruba
// o webhook inteiro: a mensagem simplesmente não vira resposta, como já acontecia com tipos sem texto.
async function baixarEArmazenarMidia(
  db: Db,
  mediaId: string,
  contaId: number,
  tipo: "audio" | "figurinha",
): Promise<ConteudoMensagem | null> {
  try {
    const token = await tokenDaConta(db, contaId);
    const midia = await baixarMidia(mediaId, token);
    const salvo = await salvarBuffer(midia.buffer, midia.mimeType);
    return { tipo, texto: "", midiaUrl: salvo.url, midiaMimeType: midia.mimeType };
  } catch (erro) {
    console.error(`[webhook-whatsapp] falha ao baixar ${tipo} (media id ${mediaId}):`, erro);
    return null;
  }
}

// Grava a mensagem se ela for de uma conversa nossa, e devolve o telefone usado (para o contato ficar na
// mesma chave). Conversa nossa é a de quem recebeu algum disparo nosso: o número é compartilhado com
// outro sistema, e o que os clientes dele escrevem também chega aqui. Devolve null quando não grava.
async function registrarResposta(
  db: Db,
  mensagem: MensagemRecebida,
  conteudo: ConteudoMensagem,
  numeroId: number,
): Promise<{ telefone: string; nova: boolean } | null> {
  const variantes = variantesDoTelefone(mensagem.from);
  const recebidaEm = new Date(Number(mensagem.timestamp) * 1000);

  const [destinatario] = await db
    .select({
      id: disparoDestinatarios.id,
      campanhaId: disparoDestinatarios.campanhaId,
      telefone: disparoDestinatarios.telefone,
    })
    .from(disparoDestinatarios)
    .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
    .where(
      and(
        inArray(disparoDestinatarios.telefone, variantes),
        eq(disparoDestinatarios.statusEnvio, "enviado"),
        eq(campanhasDisparo.numeroId, numeroId),
        gte(disparoDestinatarios.enviadoEm, new Date(recebidaEm.getTime() - JANELA_ATRIBUICAO_MS)),
      ),
    )
    .orderBy(desc(disparoDestinatarios.enviadoEm))
    .limit(1);

  // Fora da janela de atribuição a mensagem não conta para a campanha, mas a conversa continua sendo nossa.
  let telefone = destinatario?.telefone;
  if (!telefone) {
    const [algumDisparo] = await db
      .select({ telefone: disparoDestinatarios.telefone })
      .from(disparoDestinatarios)
      .innerJoin(campanhasDisparo, eq(campanhasDisparo.id, disparoDestinatarios.campanhaId))
      .where(
        and(
          inArray(disparoDestinatarios.telefone, variantes),
          eq(disparoDestinatarios.statusEnvio, "enviado"),
          eq(campanhasDisparo.numeroId, numeroId),
        ),
      )
      .orderBy(desc(disparoDestinatarios.enviadoEm))
      .limit(1);
    if (!algumDisparo) return null;
    telefone = algumDisparo.telefone;
  }

  const gravada = await db
    .insert(respostasClientes)
    .values({
      mensagemExternaId: mensagem.id,
      telefone,
      numeroId,
      campanhaId: destinatario?.campanhaId ?? null,
      destinatarioId: destinatario?.id ?? null,
      tipo: conteudo.tipo,
      texto: conteudo.texto,
      midiaUrl: conteudo.midiaUrl,
      midiaMimeType: conteudo.midiaMimeType,
      recebidaEm,
    })
    // Mensagem já registrada (webhook reenviado): mantém a linha como está.
    .onConflictDoNothing({ target: respostasClientes.mensagemExternaId })
    .returning({ id: respostasClientes.id });

  // Sem linha devolvida = era repetida: quem chama não aciona o bot de novo (o cliente receberia duas respostas).
  return { telefone, nova: gravada.length > 0 };
}

type Situacao = NonNullable<z.infer<typeof payloadSchema>["entry"][number]["changes"][number]["value"]["statuses"]>[number];

// Erros mais comuns depois que a Meta aceitou a mensagem, no texto que a equipe entende.
const ERRO_DE_ENTREGA: Record<number, string> = {
  131026: "Não foi entregue: o número não tem WhatsApp ou não pode receber mensagens.",
  131047: "Não foi entregue: a janela de 24h já tinha fechado.",
  131049: "A Meta segurou esta mensagem de marketing para não cansar o cliente (limite por pessoa). Tente mais tarde.",
  131050: "O cliente escolheu parar de receber mensagens de marketing desta empresa.",
  130472: "A Meta não entregou: o número faz parte de um experimento do WhatsApp.",
  131021: "Não foi entregue: remetente e destinatário são o mesmo número.",
};

function descreverFalha(situacao: Situacao): string {
  const erro = situacao.errors?.[0];
  if (erro?.code !== undefined && ERRO_DE_ENTREGA[erro.code]) return ERRO_DE_ENTREGA[erro.code]!;
  const texto = [erro?.title, erro?.error_data?.details].filter(Boolean).join(" — ");
  return `A Meta não entregou${erro?.code !== undefined ? ` (erro ${erro.code})` : ""}${texto ? `: ${texto}` : "."}`.slice(0, 1000);
}

// Os "checks" do WhatsApp: a Meta avisa quando a mensagem chegou no aparelho (delivered), quando o cliente
// abriu (read) e quando não conseguiu entregar (failed). Vale para respostas pelo painel/bot e para os
// disparos de campanha; só mexe em mensagens do número que recebeu o evento. Devolve quantas achou.
async function registrarSituacaoDeEntrega(db: Db, numeroId: number, situacao: Situacao): Promise<number> {
  const em = (situacao.timestamp ? new Date(Number(situacao.timestamp) * 1000) : new Date()).toISOString();
  // Chegam fora de ordem às vezes (lida antes de entregue): o primeiro horário de cada uma é o que vale.
  const primeiro = (coluna: PgColumn) =>
    sql`coalesce(${coluna}, ${em}::timestamptz)`;

  let saida: Record<string, unknown>;
  let disparo: Record<string, unknown>;
  if (situacao.status === "delivered") {
    saida = { entregueEm: primeiro(mensagensSaida.entregueEm) };
    disparo = { entregueEm: primeiro(disparoDestinatarios.entregueEm) };
  } else if (situacao.status === "read") {
    // Lida implica entregue (às vezes o aviso de entregue nem chega).
    saida = { entregueEm: primeiro(mensagensSaida.entregueEm), lidaEm: primeiro(mensagensSaida.lidaEm) };
    disparo = { entregueEm: primeiro(disparoDestinatarios.entregueEm), lidaEm: primeiro(disparoDestinatarios.lidaEm) };
  } else if (situacao.status === "failed") {
    // A Meta aceitou, mas não entregou: deixa de contar como enviada (e de entrar no custo da campanha).
    saida = disparo = { statusEnvio: "falhou", erroDetalhe: descreverFalha(situacao) };
  } else {
    return 1; // "sent": já está marcada como enviada desde que a Meta aceitou.
  }

  const atualizadas = await db
    .update(mensagensSaida)
    .set(saida)
    .where(and(eq(mensagensSaida.mensagemExternaId, situacao.id), eq(mensagensSaida.numeroId, numeroId)));
  if (atualizadas.count > 0) return atualizadas.count;

  const disparos = await db
    .update(disparoDestinatarios)
    .set(disparo)
    .where(
      and(
        eq(disparoDestinatarios.mensagemExternaId, situacao.id),
        sql`${disparoDestinatarios.campanhaId} in (select ${campanhasDisparo.id} from ${campanhasDisparo} where ${campanhasDisparo.numeroId} = ${numeroId})`,
      ),
    );
  return disparos.count;
}

// A Meta manda os eventos de todos os números da conta (WABA), inclusive os desativados no painel, que
// podem estar sendo usados por outro sistema e ter muito movimento. São ignorados; o log avisa uma vez a
// cada 10 minutos por número, para não esconder o que importa.
const AVISO_NUMERO_IGNORADO_MS = 10 * 60_000;
const ultimoAvisoPorNumero = new Map<string, number>();
function avisarNumeroIgnorado(phoneNumberId: string): void {
  const agora = Date.now();
  if (agora - (ultimoAvisoPorNumero.get(phoneNumberId) ?? 0) < AVISO_NUMERO_IGNORADO_MS) return;
  ultimoAvisoPorNumero.set(phoneNumberId, agora);
  console.log(
    `[webhook-whatsapp] ignorando eventos do número ${phoneNumberId}: desativado no painel, de unidade desativada ou não cadastrado (próximo aviso em 10 min)`,
  );
}

// O aviso pode chegar antes de o worker gravar o id da mensagem (a Meta é rápida): tenta de novo uma vez.
const ESPERA_PARA_REPETIR_MS = 5000;

// A Meta avisa aqui o resultado da análise de cada template (e quando ela pausa ou desativa um já aprovado).
// O evento traz o id do template na Meta; templates importados antes de guardarmos esse id são achados
// pelo nome + idioma dentro da conta (entry.id é o WABA). Só mexe nos templates da unidade dona da conta.
async function registrarStatusDeTemplates(
  db: Db,
  entradas: z.infer<typeof payloadSchema>["entry"],
  unidadePorWaba: Map<string, number>,
): Promise<void> {
  for (const entrada of entradas) {
    const unidadeId = entrada.id ? unidadePorWaba.get(entrada.id) : undefined;
    if (unidadeId === undefined) continue;
    for (const mudanca of entrada.changes) {
      const valor = mudanca.value;
      if (mudanca.field !== "message_template_status_update" || !valor.event) continue;

      const status = valor.event.toUpperCase();
      const motivo = valor.reason && valor.reason !== "NONE" ? valor.reason.slice(0, 500) : null;
      const alteracao = { status, ativo: status === "APPROVED", motivoStatus: status === "APPROVED" ? null : motivo };

      let atualizados = 0;
      if (valor.message_template_id !== undefined) {
        const resultado = await db
          .update(templatesWhatsapp)
          .set(alteracao)
          .where(and(eq(templatesWhatsapp.unidadeId, unidadeId), eq(templatesWhatsapp.metaId, String(valor.message_template_id))));
        atualizados = resultado.count;
      }
      if (atualizados === 0 && valor.message_template_name && entrada.id) {
        const [conta] = await db
          .select({ id: contasWhatsapp.id })
          .from(contasWhatsapp)
          .where(and(eq(contasWhatsapp.wabaId, entrada.id), eq(contasWhatsapp.unidadeId, unidadeId)));
        if (conta) {
          const resultado = await db
            .update(templatesWhatsapp)
            .set({ ...alteracao, ...(valor.message_template_id !== undefined ? { metaId: String(valor.message_template_id) } : {}) })
            .where(
              and(
                eq(templatesWhatsapp.contaId, conta.id),
                eq(templatesWhatsapp.nome, valor.message_template_name),
                ...(valor.message_template_language ? [eq(templatesWhatsapp.idioma, valor.message_template_language)] : []),
              ),
            );
          atualizados = resultado.count;
        }
      }

      console.log(
        `[webhook-whatsapp] template ${valor.message_template_name ?? valor.message_template_id ?? "?"}: ${status}${motivo ? ` (${motivo})` : ""}${atualizados === 0 ? " — não está na plataforma, ignorado" : ""}`,
      );
    }
  }
}

export function criarWebhookWhatsapp(): Router {
  const router = express.Router();

  router.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as RequisicaoComCorpoBruto).rawBody = buffer;
      },
    }),
  );

  // Verificação inicial exigida pela Meta ao cadastrar o webhook: vale o token de qualquer unidade.
  router.get("/", async (req, res) => {
    const tokenRecebido = req.query["hub.verify_token"];
    const tokenValido = typeof tokenRecebido === "string" && tokenRecebido !== "" && (await tokenDeVerificacaoConhecido(getDb(), tokenRecebido));

    if (req.query["hub.mode"] === "subscribe" && tokenValido) {
      console.log("[webhook-whatsapp] verificação da Meta aceita");
      res.status(200).send(String(req.query["hub.challenge"] ?? ""));
      return;
    }

    console.warn(
      `[webhook-whatsapp] verificação recusada (mode=${String(req.query["hub.mode"])}, token ${tokenValido ? "ok" : "não confere com o de nenhuma unidade"})`,
    );
    res.sendStatus(403);
  });

  router.post("/", async (req: RequisicaoComCorpoBruto, res) => {
    const db = getDb();

    const payload = payloadSchema.safeParse(req.body);
    if (!payload.success) {
      res.sendStatus(400);
      return;
    }

    // Cada unidade cadastra a própria conta e o segredo do app dela: a assinatura é conferida com o segredo
    // da unidade dona de cada conta citada no evento, e só o que é dessas unidades segue adiante.
    const unidadePorWaba = await unidadesDasContas(
      db,
      payload.data.entry.flatMap((entrada) => (entrada.id ? [entrada.id] : [])),
    );
    const autorizadas = new Set<number>();
    for (const unidadeId of new Set(unidadePorWaba.values())) {
      const segredo = await segredoDoAppDaUnidade(db, unidadeId);
      // Sem segredo não dá para autenticar quem chama: em produção recusa; em desenvolvimento aceita.
      if (segredo ? assinaturaValida(req, segredo) : process.env.NODE_ENV !== "production") autorizadas.add(unidadeId);
      else if (!segredo) console.error(`[webhook-whatsapp] unidade ${unidadeId} sem segredo do app no painel; evento recusado`);
    }
    if (unidadePorWaba.size > 0 && autorizadas.size === 0) {
      res.sendStatus(401);
      return;
    }
    for (const [wabaId, unidadeId] of unidadePorWaba) if (!autorizadas.has(unidadeId)) unidadePorWaba.delete(wabaId);

    try {
      await registrarStatusDeTemplates(db, payload.data.entry, unidadePorWaba);

      // Cada evento traz o número de destino; só seguem os que são de um número ativo da plataforma.
      const mudancas: Array<{
        valor: (typeof payload.data.entry)[number]["changes"][number]["value"];
        numeroId: number;
        contaId: number;
        unidadeId: number;
      }> = [];
      const descartados = new Set<string>();

      for (const entrada of payload.data.entry) {
        const unidadeDaEntrada = entrada.id ? unidadePorWaba.get(entrada.id) : undefined;
        for (const mudanca of entrada.changes) {
          if (mudanca.field === "message_template_status_update") continue;
          const phoneNumberId = mudanca.value.metadata?.phone_number_id;
          const numero = phoneNumberId ? await numeroPeloPhoneNumberId(db, phoneNumberId) : null;
          // O número precisa ser da mesma unidade cuja assinatura conferiu.
          if (numero && numero.unidadeId === unidadeDaEntrada) {
            mudancas.push({ valor: mudanca.value, numeroId: numero.id, contaId: numero.contaId, unidadeId: numero.unidadeId });
          } else descartados.add(phoneNumberId ?? "sem número");
        }
      }

      for (const phoneNumberId of descartados) avisarNumeroIgnorado(phoneNumberId);
      if (mudancas.length === 0) {
        res.sendStatus(200);
        return;
      }

      const mensagens = mudancas.flatMap((mudanca) =>
        (mudanca.valor.messages ?? []).map((m) => ({ ...m, numeroId: mudanca.numeroId, contaId: mudanca.contaId, unidadeId: mudanca.unidadeId })),
      );
      console.log(`[webhook-whatsapp] recebido: ${mensagens.length} mensagem(ns)`);

      // Checks do WhatsApp (entregue, lida, falhou). O log continua: é o que permite descobrir por que uma
      // mensagem aceita pela Meta não chegou ao aparelho.
      for (const mudanca of mudancas) {
        for (const situacao of mudanca.valor.statuses ?? []) {
          const erros = (situacao.errors ?? [])
            .map((erro) => `${erro.code ?? "?"} ${erro.title ?? ""} ${erro.message ?? ""} ${erro.error_data?.details ?? ""}`.trim())
            .join(" | ");
          console.log(
            `[webhook-whatsapp] status ${situacao.status} para ${situacao.recipient_id ?? "?"} (${situacao.id})${erros ? ` -> ${erros}` : ""}`,
          );
          const achadas = await registrarSituacaoDeEntrega(db, mudanca.numeroId, situacao);
          if (achadas === 0) {
            setTimeout(() => {
              registrarSituacaoDeEntrega(db, mudanca.numeroId, situacao).catch((erro) =>
                console.error(`[webhook-whatsapp] falha ao gravar status ${situacao.status} de ${situacao.id}:`, erro),
              );
            }, ESPERA_PARA_REPETIR_MS).unref();
          }
        }
      }

      const nomePorWaId = new Map(
        mudancas
          .flatMap((mudanca) => mudanca.valor.contacts ?? [])
          .flatMap((contato) => (contato.profile?.name.trim() ? [[contato.wa_id, contato.profile.name.trim()] as const] : [])),
      );

      for (const mensagem of mensagens) {
        const texto = textoDaMensagem(mensagem);

        let conteudo: ConteudoMensagem | null = texto
          ? { tipo: "texto", texto, midiaUrl: null, midiaMimeType: null }
          : null;

        if (!conteudo && mensagem.type === "audio" && mensagem.audio) {
          conteudo = await baixarEArmazenarMidia(db, mensagem.audio.id, mensagem.contaId!, "audio");
        } else if (!conteudo && mensagem.type === "sticker" && mensagem.sticker) {
          conteudo = await baixarEArmazenarMidia(db, mensagem.sticker.id, mensagem.contaId!, "figurinha");
        }

        if (!conteudo) {
          // Imagem, reação, vídeo, documento: chegam no webhook mas ainda não viram resposta do cliente.
          console.log(`[webhook-whatsapp] ignorada: mensagem de ${mensagem.from} sem conteúdo tratável (tipo ${mensagem.type ?? "desconhecido"})`);
          continue;
        }

        const registro = await registrarResposta(db, mensagem, conteudo, mensagem.numeroId);
        if (!registro) {
          console.log(`[webhook-whatsapp] ignorada: ${mensagem.from} nunca recebeu disparo nosso`);
          continue;
        }
        if (!registro.nova) {
          console.log(`[webhook-whatsapp] ignorada: mensagem ${mensagem.id} já tinha chegado (reenvio da Meta)`);
          continue;
        }
        const { telefone } = registro;
        const nomePerfil = nomePorWaId.get(mensagem.from);
        if (nomePerfil) await registrarContato(db, telefone, nomePerfil);
        await acionarAgenteSeLigado(db, telefone, mensagem.numeroId, mensagem.unidadeId, conteudo, nomePerfil);
        pedirAnaliseDaConversa(mensagem.numeroId, telefone);
      }
      res.sendStatus(200);
    } catch (erro) {
      // 500 faz a Meta reenviar; a chave única em mensagem_externa_id evita duplicar o que já foi gravado.
      console.error("[webhook-whatsapp] falha ao registrar mensagem:", erro);
      res.sendStatus(500);
    }
  });

  return router;
}
