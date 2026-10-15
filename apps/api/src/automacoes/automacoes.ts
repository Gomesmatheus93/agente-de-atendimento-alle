import { contatosUnidade, followupsEnviados, unidades, type Db } from "@atendimento-academias/db";
import {
  CONFIG_ANIVERSARIO_PADRAO,
  CONFIG_FOLLOWUP_PADRAO,
  configAniversarioSchema,
  configFollowupSchema,
  criarCampanhaInputSchema,
  mascararTelefone,
  MAX_TELEFONES_POR_CAMPANHA,
  preencherNome,
  type ConfigAniversario,
  type ConfigFollowup,
} from "@atendimento-academias/shared";
import { and, eq, sql } from "drizzle-orm";
import { lerValor, salvarValor } from "../config/plataforma.js";
import { criarCampanha } from "../servicos/campanhas.js";
import { enviarMensagem } from "../servicos/conversas.js";

// Automações que rodam sozinhas (aniversário e follow-up). Só em produção (ou com AUTOMACOES=1): o
// computador de desenvolvimento usa o mesmo banco e mandaria mensagens de verdade.

export const CHAVE_ANIVERSARIO = "automacao.aniversario";
export const CHAVE_FOLLOWUP = "automacao.followup";
const CHAVE_ANIVERSARIO_ULTIMO_DIA = "automacao.aniversario.ultimo_dia";
const INTERVALO_MS = 10 * 60_000;

export async function lerConfigAniversario(db: Db, unidadeId: number): Promise<ConfigAniversario> {
  const bruto = await lerValor(db, unidadeId, CHAVE_ANIVERSARIO);
  const lido = bruto ? configAniversarioSchema.safeParse(JSON.parse(bruto)) : null;
  return lido?.success ? lido.data : CONFIG_ANIVERSARIO_PADRAO;
}

export async function lerConfigFollowup(db: Db, unidadeId: number): Promise<ConfigFollowup> {
  const bruto = await lerValor(db, unidadeId, CHAVE_FOLLOWUP);
  const lido = bruto ? configFollowupSchema.safeParse(JSON.parse(bruto)) : null;
  return lido?.success ? lido.data : CONFIG_FOLLOWUP_PADRAO;
}

// Data e hora em Brasília (o "hoje" do aniversário é o da academia, não o do servidor).
export function agoraEmBrasilia(agora = new Date()): { dia: string; mesDia: string; hora: number; bissexto: boolean } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const ano = Number(partes.year);
  return {
    dia: `${partes.year}-${partes.month}-${partes.day}`,
    mesDia: `${partes.month}-${partes.day}`,
    hora: Number(partes.hour),
    bissexto: (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0,
  };
}

// Aniversariantes de hoje (quem nasceu em 29/02 faz aniversário em 28/02 nos anos não bissextos).
export async function aniversariantesDeHoje(db: Db, unidadeId: number, agora = new Date()) {
  const { mesDia, bissexto } = agoraEmBrasilia(agora);
  const dias = mesDia === "02-28" && !bissexto ? ["02-28", "02-29"] : [mesDia];
  return db
    .select({ telefone: contatosUnidade.telefone, nome: contatosUnidade.nome })
    .from(contatosUnidade)
    .where(
      and(
        eq(contatosUnidade.unidadeId, unidadeId),
        sql`to_char(${contatosUnidade.nascimento}, 'MM-DD') in (${sql.join(
          dias.map((d) => sql`${d}`),
          sql`, `,
        )})`,
      ),
    )
    .limit(MAX_TELEFONES_POR_CAMPANHA);
}

// Uma vez por dia, a partir da hora escolhida: cria a campanha "Aniversariantes DD/MM" com o template.
// Template fora da janela de 24h é a única forma de a Meta deixar a academia escrever primeiro.
export async function rodarAniversario(db: Db, unidadeId: number, agora = new Date()): Promise<{ enviados: number } | null> {
  const config = await lerConfigAniversario(db, unidadeId);
  if (!config.ativo || !config.templateId || !config.numeroId) return null;
  const { dia, hora } = agoraEmBrasilia(agora);
  if (hora < config.hora) return null;
  if ((await lerValor(db, unidadeId, CHAVE_ANIVERSARIO_ULTIMO_DIA)) === dia) return null;
  // Marca antes de enviar: se algo falhar no meio, não manda duas vezes no mesmo dia.
  await salvarValor(db, unidadeId, CHAVE_ANIVERSARIO_ULTIMO_DIA, dia);

  const pessoas = await aniversariantesDeHoje(db, unidadeId, agora);
  if (pessoas.length === 0) return { enviados: 0 };
  const destinatarios = pessoas.map((p) => ({
    telefone: p.telefone,
    parametros: Object.fromEntries(
      Object.entries(config.parametros).map(([nome, origem]) => [nome, origem.tipo === "nome" ? p.nome?.trim().split(/\s+/)[0] || "tudo bem" : origem.valor]),
    ),
  }));
  const ddmm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const pedido = criarCampanhaInputSchema.parse({ nome: `Aniversariantes ${ddmm}`, templateId: config.templateId, numeroId: config.numeroId, destinatarios });
  const campanha = await criarCampanha(db, pedido, unidadeId);
  console.log(`[automacoes] aniversário da unidade ${unidadeId}: campanha ${campanha.id} para ${destinatarios.length - campanha.descadastrados} pessoa(s)`);
  return { enviados: destinatarios.length - campanha.descadastrados };
}

// Follow-up: o cliente parou de responder depois da nossa última mensagem e a janela de 24h ainda está
// aberta (mensagem livre, sem custo de template). Um por mensagem do cliente.
export async function rodarFollowup(db: Db, unidadeId: number): Promise<{ enviados: number }> {
  const config = await lerConfigFollowup(db, unidadeId);
  if (!config.ativo) return { enviados: 0 };
  const etapas = sql.join(
    config.etapas.map((e) => sql`${e}`),
    sql`, `,
  );
  const candidatos = await db.execute<{ numero_id: number; telefone: string; cliente_em: Date; nome: string | null }>(sql`
    with numeros as (select id from numeros_whatsapp where unidade_id = ${unidadeId}),
    cliente as (
      select numero_id, telefone, max(recebida_em) as em from respostas_clientes
      where numero_id in (select id from numeros) and recebida_em > now() - interval '23 hours'
      group by numero_id, telefone
    ),
    nossa as (
      select numero_id, telefone, max(created_at) as em from mensagens_saida
      where numero_id in (select id from numeros) and status_envio = 'enviado'
      group by numero_id, telefone
    )
    select c.numero_id, c.telefone, c.em as cliente_em,
      coalesce(
        (select cu.nome from contatos_unidade cu where cu.unidade_id = ${unidadeId} and cu.telefone = c.telefone),
        (select ct.nome_perfil from contatos ct where ct.telefone = c.telefone)
      ) as nome
    from cliente c join nossa n on n.numero_id = c.numero_id and n.telefone = c.telefone
    where n.em > c.em
      and n.em < now() - make_interval(hours => ${config.horas})
      and not exists (select 1 from followups_enviados f where f.numero_id = c.numero_id and f.telefone = c.telefone and f.apos_mensagem_em = c.em)
      and not exists (select 1 from conversas_config cc where cc.numero_id = c.numero_id and cc.telefone = c.telefone and cc.precisa_humano)
      and not exists (select 1 from descadastros d where d.unidade_id = ${unidadeId} and d.telefone = c.telefone)
      and not exists (select 1 from conversas_excluidas x where x.numero_id = c.numero_id and x.telefone = c.telefone and x.excluida_em > c.em)
      and coalesce((select fc.etapa::text from funil_clientes fc where fc.numero_id = c.numero_id and fc.telefone = c.telefone), 'em_conversa') in (${etapas})
    limit 200
  `);

  let enviados = 0;
  for (const c of candidatos) {
    // Marca antes: se o envio falhar, não tenta de novo a cada rodada (o cliente não recebe dois).
    const marcado = await db
      .insert(followupsEnviados)
      .values({ numeroId: c.numero_id, telefone: c.telefone, aposMensagemEm: new Date(c.cliente_em) })
      .onConflictDoNothing()
      .returning();
    if (marcado.length === 0) continue;
    try {
      await enviarMensagem(db, { telefone: c.telefone, numeroId: c.numero_id, texto: preencherNome(config.texto, c.nome) });
      enviados += 1;
    } catch (erro) {
      console.error(`[automacoes] follow-up para ${mascararTelefone(c.telefone)} não saiu:`, erro instanceof Error ? erro.message : erro);
    }
  }
  if (enviados > 0) console.log(`[automacoes] follow-up da unidade ${unidadeId}: ${enviados} enviado(s)`);
  return { enviados };
}

export async function rodarAutomacoes(db: Db, agora = new Date()): Promise<void> {
  const ativas = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.ativo, true));
  for (const { id } of ativas) {
    await rodarAniversario(db, id, agora).catch((erro) => console.error(`[automacoes] aniversário da unidade ${id} falhou:`, erro));
    await rodarFollowup(db, id).catch((erro) => console.error(`[automacoes] follow-up da unidade ${id} falhou:`, erro));
  }
}

export function iniciarAutomacoes(db: Db): void {
  const ligado = process.env.AUTOMACOES ? process.env.AUTOMACOES === "1" : process.env.NODE_ENV === "production";
  if (!ligado) return;
  const rodar = () => void rodarAutomacoes(db).catch((erro) => console.error("[automacoes] rodada falhou:", erro));
  setTimeout(rodar, 2 * 60_000).unref();
  setInterval(rodar, INTERVALO_MS).unref();
}
