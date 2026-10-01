import { campanhasDisparo, disparoDestinatarios, numerosWhatsapp, templatesWhatsapp, type Db } from "@atendimento-academias/db";
import {
  ANTECEDENCIA_MAX_AGENDAMENTO_MS,
  ANTECEDENCIA_MIN_AGENDAMENTO_MS,
  DISPARO_ENVIO_JOB_NAME,
  disparoEnvioJobId,
  extrairPlaceholders,
  precoDaCategoria,
  type CriarCampanhaInput,
} from "@atendimento-academias/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDisparoQueue } from "../queue.js";

// Lógica de criar campanha: usada pela tela (tRPC, com sessão) e pela API de integração (chave, sem
// sessão) — as duas caem exatamente nas mesmas regras e no mesmo caminho de envio, não há um "modo
// simplificado" para automação externa.
export async function criarCampanha(db: Db, input: CriarCampanhaInput): Promise<{ id: number; agendada: boolean }> {
  const [template] = await db
    .select()
    .from(templatesWhatsapp)
    .where(and(eq(templatesWhatsapp.id, input.templateId), eq(templatesWhatsapp.ativo, true)));

  if (!template) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado" });
  }
  // A Meta recusa cada envio (erro 132012) quando o template tem cabeçalho de imagem e ela não vai junto.
  if (template.cabecalhoFormato === "IMAGE" && !template.cabecalhoImagemUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `O template "${template.nome}" usa imagem no cabeçalho e ainda não tem uma. Escolha a imagem na tela Templates antes de disparar.`,
    });
  }

  const [numero] = await db.select().from(numerosWhatsapp).where(eq(numerosWhatsapp.id, input.numeroId));
  if (!numero || !numero.ativo) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um número ativo para enviar a campanha." });
  }
  // O template é aprovado dentro de uma conta do WhatsApp; enviar por número de outra conta falha na Meta.
  if (template.contaId && template.contaId !== numero.contaId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `O template ${template.nome} não pertence à conta do número ${numero.numeroExibicao}.`,
    });
  }

  const placeholders = extrairPlaceholders(template.conteudo);

  // Cada destinatário tem os próprios valores, então a validação é linha a linha: a Meta recusa
  // o template inteiro se algum parâmetro chegar vazio.
  const linhas = input.destinatarios.map((destinatario) => {
    const faltando = placeholders.filter((nome) => !destinatario.parametros[nome]?.trim());
    if (faltando.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Faltou preencher ${faltando.join(", ")} para o telefone ${destinatario.telefone}`,
      });
    }

    return {
      telefone: destinatario.telefone,
      parametros: Object.fromEntries(placeholders.map((nome) => [nome, destinatario.parametros[nome]!.trim()])),
    };
  });

  // Com data, a campanha só é cadastrada agora; o worker a dispara quando chegar a hora.
  const disparoAgendado = input.agendarPara ? new Date(input.agendarPara) : null;
  if (disparoAgendado) {
    const antecedencia = disparoAgendado.getTime() - Date.now();
    if (antecedencia < ANTECEDENCIA_MIN_AGENDAMENTO_MS) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um horário pelo menos 2 minutos à frente, ou dispare agora." });
    }
    if (antecedencia > ANTECEDENCIA_MAX_AGENDAMENTO_MS) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Agende com no máximo 1 ano de antecedência." });
    }
  }

  const campanhaId = await db.transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(campanhasDisparo)
      .values({
        nome: input.nome,
        templateId: template.id,
        numeroId: numero.id,
        custoUnitario: precoDaCategoria(template.categoria).toFixed(4),
        ...(disparoAgendado ? { status: "agendada" as const, disparoEm: disparoAgendado } : {}),
      })
      .returning({ id: campanhasDisparo.id });

    await tx.insert(disparoDestinatarios).values(linhas.map((linha) => ({ campanhaId: id, ...linha })));

    return id;
  });

  if (disparoAgendado) return { id: campanhaId, agendada: true };

  const destinatarios = await db
    .select({ id: disparoDestinatarios.id })
    .from(disparoDestinatarios)
    .where(eq(disparoDestinatarios.campanhaId, campanhaId));

  try {
    await getDisparoQueue().addBulk(
      destinatarios.map((destinatario) => ({
        name: DISPARO_ENVIO_JOB_NAME,
        data: { destinatarioId: destinatario.id },
        opts: { jobId: disparoEnvioJobId(destinatario.id) },
      })),
    );
  } catch (cause) {
    await db
      .update(disparoDestinatarios)
      .set({ statusEnvio: "falhou", erroDetalhe: "Falha ao enfileirar o envio" })
      .where(and(eq(disparoDestinatarios.campanhaId, campanhaId), eq(disparoDestinatarios.statusEnvio, "pendente")));
    await db.update(campanhasDisparo).set({ status: "concluida" }).where(eq(campanhasDisparo.id, campanhaId));

    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível enfileirar os envios", cause });
  }

  return { id: campanhaId, agendada: false };
}
