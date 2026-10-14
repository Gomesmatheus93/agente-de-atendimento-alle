import { createHmac, timingSafeEqual } from "node:crypto";
import {
  buscarPessoaInstagram,
  contasInstagram,
  conversasInstagram,
  mensagensInstagram,
  salvarArquivo,
  tokenDaContaInstagram,
  type Db,
} from "@atendimento-academias/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import express, { type Request, type Router } from "express";
import { z } from "zod";
import { segredoDoAppDaUnidade, tokenDeVerificacaoConhecido } from "../config/plataforma.js";
import { avisarN8nInstagram } from "../instagram/dms.js";
import { getDb } from "../trpc/context.js";

// Webhook das DMs do Instagram (produto Instagram do app da Meta → Webhooks → campo "messages").
// A Meta chama com object "instagram"; entry.id é a conta profissional (o ig_user_id guardado ao conectar).

const LIMITE_MIDIA_BYTES = 25 * 1024 * 1024;

const anexoSchema = z.object({ type: z.string(), payload: z.object({ url: z.string().optional() }).passthrough().optional() });

const payloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        messaging: z
          .array(
            z.object({
              sender: z.object({ id: z.string() }),
              recipient: z.object({ id: z.string() }),
              timestamp: z.number().optional(),
              message: z
                .object({
                  mid: z.string(),
                  text: z.string().optional(),
                  is_echo: z.boolean().optional(),
                  is_deleted: z.boolean().optional(),
                  attachments: z.array(anexoSchema).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
});

interface RequisicaoComCorpoBruto extends Request {
  rawBody?: Buffer;
}

function assinaturaConfere(req: RequisicaoComCorpoBruto, segredo: string): boolean {
  const recebida = req.header("x-hub-signature-256");
  if (!recebida || !req.rawBody) return false;
  const esperada = Buffer.from(`sha256=${createHmac("sha256", segredo).update(req.rawBody).digest("hex")}`);
  const veio = Buffer.from(recebida);
  return veio.length === esperada.length && timingSafeEqual(veio, esperada);
}

const DESCRICAO_ANEXO: Record<string, string> = {
  image: "[foto]",
  video: "[vídeo]",
  audio: "[áudio]",
  file: "[arquivo]",
  share: "[compartilhou uma publicação]",
  story_mention: "[mencionou a unidade no story]",
  ig_reel: "[compartilhou um reel]",
  reel: "[compartilhou um reel]",
  ig_post: "[compartilhou uma publicação]",
};

// Foto, vídeo ou áudio vêm com um link temporário: guarda no armazenamento para continuar abrindo.
async function guardarAnexo(url: string): Promise<string | null> {
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resposta.ok) return null;
    if (Number(resposta.headers.get("content-length") ?? 0) > LIMITE_MIDIA_BYTES) return null;
    const buffer = Buffer.from(await resposta.arrayBuffer());
    if (buffer.byteLength > LIMITE_MIDIA_BYTES) return null;
    const salvo = await salvarArquivo(buffer, resposta.headers.get("content-type") ?? "application/octet-stream");
    return salvo.url;
  } catch (erro) {
    console.error("[webhook-instagram] falha ao guardar anexo:", erro);
    return null;
  }
}

async function conversaDaPessoa(db: Db, conta: typeof contasInstagram.$inferSelect, igsid: string) {
  const [existente] = await db
    .select()
    .from(conversasInstagram)
    .where(and(eq(conversasInstagram.contaId, conta.id), eq(conversasInstagram.igsid, igsid)));
  if (existente) return existente;
  let perfil: { name?: string; username?: string } = {};
  try {
    perfil = await buscarPessoaInstagram(igsid, tokenDaContaInstagram(conta));
  } catch (erro) {
    console.warn(`[webhook-instagram] não foi possível ler o perfil de ${igsid}:`, erro instanceof Error ? erro.message : erro);
  }
  const [criada] = await db
    .insert(conversasInstagram)
    .values({ contaId: conta.id, igsid, username: perfil.username ?? null, nome: perfil.name ?? null })
    .onConflictDoUpdate({ target: [conversasInstagram.contaId, conversasInstagram.igsid], set: { updatedAt: sql`now()` } })
    .returning();
  return criada!;
}

type Evento = NonNullable<z.infer<typeof payloadSchema>["entry"][number]["messaging"]>[number];

async function tratarEvento(db: Db, conta: typeof contasInstagram.$inferSelect, evento: Evento): Promise<void> {
  const mensagem = evento.message;
  if (!mensagem || mensagem.is_deleted) return;
  const em = new Date(evento.timestamp ?? Date.now());
  const anexos = mensagem.attachments ?? [];
  const descricao = anexos.map((a) => DESCRICAO_ANEXO[a.type] ?? "[anexo]").join(" ");
  const texto = [mensagem.text?.trim(), mensagem.text?.trim() ? "" : descricao].filter(Boolean).join(" ") || descricao;

  // Eco: mensagem que a própria conta mandou (pelo nosso painel, pelo bot ou direto no app do Instagram).
  if (mensagem.is_echo) {
    const conversa = await conversaDaPessoa(db, conta, evento.recipient.id);
    const [jaTemos] = await db.select({ id: mensagensInstagram.id }).from(mensagensInstagram).where(eq(mensagensInstagram.mid, mensagem.mid));
    if (jaTemos) return;
    // O eco pode chegar antes de o envio terminar de gravar o mid: casa com a nossa mensagem recente de mesmo texto.
    const [nossa] = await db
      .select({ id: mensagensInstagram.id })
      .from(mensagensInstagram)
      .where(
        and(
          eq(mensagensInstagram.conversaId, conversa.id),
          isNull(mensagensInstagram.mid),
          eq(mensagensInstagram.texto, mensagem.text ?? ""),
          gte(mensagensInstagram.criadaEm, new Date(Date.now() - 5 * 60_000)),
        ),
      )
      .orderBy(desc(mensagensInstagram.criadaEm))
      .limit(1);
    if (nossa) return;
    await db
      .insert(mensagensInstagram)
      .values({ conversaId: conversa.id, origem: "app", texto, mid: mensagem.mid, statusEnvio: "enviado", criadaEm: em })
      .onConflictDoNothing();
    await db.update(conversasInstagram).set({ ultimaMensagemEm: em }).where(eq(conversasInstagram.id, conversa.id));
    return;
  }

  const conversa = await conversaDaPessoa(db, conta, evento.sender.id);
  const comArquivo = anexos.find((a) => ["image", "video", "audio"].includes(a.type) && a.payload?.url);
  const midiaUrl = comArquivo?.payload?.url ? await guardarAnexo(comArquivo.payload.url) : null;
  const gravada = await db
    .insert(mensagensInstagram)
    .values({ conversaId: conversa.id, origem: "cliente", texto, midiaUrl, mid: mensagem.mid, criadaEm: em })
    .onConflictDoNothing()
    .returning({ id: mensagensInstagram.id });
  if (gravada.length === 0) return; // reenvio da Meta

  const [atualizada] = await db
    .update(conversasInstagram)
    .set({ ultimaMensagemEm: em, ultimaDoClienteEm: em, naoLidas: sql`${conversasInstagram.naoLidas} + 1` })
    .where(eq(conversasInstagram.id, conversa.id))
    .returning();
  await avisarN8nInstagram(db, conta.unidadeId, atualizada!, { texto, midiaUrl, em });
}

export function criarWebhookInstagram(): Router {
  const router = express.Router();
  router.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as RequisicaoComCorpoBruto).rawBody = buffer;
      },
    }),
  );

  // Verificação ao cadastrar o webhook no app da Meta: INSTAGRAM_WEBHOOK_VERIFY_TOKEN, ou o token de
  // verificação do WhatsApp de qualquer unidade.
  router.get("/", async (req, res) => {
    const token = req.query["hub.verify_token"];
    const doAmbiente = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim();
    const valido =
      typeof token === "string" && token !== "" && ((doAmbiente && token === doAmbiente) || (await tokenDeVerificacaoConhecido(getDb(), token)));
    if (req.query["hub.mode"] === "subscribe" && valido) {
      console.log("[webhook-instagram] verificação da Meta aceita");
      res.status(200).send(String(req.query["hub.challenge"] ?? ""));
      return;
    }
    res.sendStatus(403);
  });

  router.post("/", async (req: RequisicaoComCorpoBruto, res) => {
    const db = getDb();
    const payload = payloadSchema.safeParse(req.body);
    if (!payload.success || payload.data.object !== "instagram") {
      res.sendStatus(payload.success ? 200 : 400);
      return;
    }

    // Assinado com o segredo do app do Instagram; por garantia aceita também o segredo do app da Meta
    // cadastrado na unidade dona da conta (é o mesmo app).
    const segredoInstagram = process.env.INSTAGRAM_APP_SECRET?.trim();
    for (const entrada of payload.data.entry) {
      const [conta] = await db.select().from(contasInstagram).where(eq(contasInstagram.igUserId, entrada.id));
      if (!conta) {
        console.log(`[webhook-instagram] conta ${entrada.id} não está conectada em nenhuma unidade; ignorado`);
        continue;
      }
      const segredoDaUnidade = await segredoDoAppDaUnidade(db, conta.unidadeId);
      const autentico =
        (segredoInstagram && assinaturaConfere(req, segredoInstagram)) ||
        (segredoDaUnidade && assinaturaConfere(req, segredoDaUnidade)) ||
        (!segredoInstagram && !segredoDaUnidade && process.env.NODE_ENV !== "production");
      if (!autentico) {
        console.error(`[webhook-instagram] assinatura não confere para a conta @${conta.username}; evento recusado`);
        res.sendStatus(401);
        return;
      }
      for (const evento of entrada.messaging ?? []) {
        try {
          await tratarEvento(db, conta, evento);
        } catch (erro) {
          console.error(`[webhook-instagram] falha ao tratar evento de @${conta.username}:`, erro);
        }
      }
    }
    res.sendStatus(200);
  });

  return router;
}
