import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { apagarArquivo } from "./armazenamento.js";
import type { Db } from "./client.js";
import { notasConversa } from "./schema/atendimento.js";
import { contatosUnidade } from "./schema/baseContatos.js";
import { campanhasDisparo } from "./schema/campanhasDisparo.js";
import { contatos } from "./schema/contatos.js";
import { conversasConfig, conversasExcluidas } from "./schema/conversasConfig.js";
import { disparoDestinatarios } from "./schema/disparoDestinatarios.js";
import { duvidasIa, funilClientes } from "./schema/funil.js";
import { contasInstagram, conversasInstagram, mensagensInstagram } from "./schema/instagram.js";
import { mensagensSaida } from "./schema/mensagensSaida.js";
import { respostasClientes } from "./schema/respostasClientes.js";
import { sugestoesIa } from "./schema/sugestoesIa.js";
import { midiasAgente, numerosWhatsapp } from "./schema/whatsapp.js";
import { templatesWhatsapp } from "./schema/templatesWhatsapp.js";

// Exclusão de dados de um cliente (LGPD): diferente de "Excluir conversa" (que só esconde o histórico), aqui
// tudo o que a unidade guarda daquele telefone é apagado de verdade — mensagens, arquivos, notas, funil,
// dúvidas, contato e etiquetas, e o registro dele nos disparos. Fica só o "não quero receber" (se houver):
// é o que garante que ele não volte a receber campanha.

export interface ResultadoExclusao {
  mensagens: number;
  arquivos: number;
}

// Arquivo que ainda aparece em outro lugar (imagem do agente, cabeçalho de template, outra mensagem) fica.
async function apagarArquivosSemUso(db: Db, urls: string[]): Promise<number> {
  let apagados = 0;
  for (const url of new Set(urls)) {
    const [emUso] = await db.execute<{ ok: number }>(sql`
      select 1 as ok where
        exists (select 1 from ${respostasClientes} where ${respostasClientes.midiaUrl} = ${url})
        or exists (select 1 from ${mensagensSaida} where ${mensagensSaida.midiaUrl} = ${url})
        or exists (select 1 from ${mensagensInstagram} where ${mensagensInstagram.midiaUrl} = ${url})
        or exists (select 1 from ${midiasAgente} where ${midiasAgente.midiaUrl} = ${url})
        or exists (select 1 from ${templatesWhatsapp} where ${templatesWhatsapp.cabecalhoImagemUrl} = ${url})
    `);
    if (emUso) continue;
    try {
      await apagarArquivo(url);
      apagados += 1;
    } catch (erro) {
      console.error(`[lgpd] não foi possível apagar o arquivo ${url}:`, erro);
    }
  }
  return apagados;
}

export async function apagarDadosDoCliente(db: Db, unidadeId: number, telefone: string): Promise<ResultadoExclusao> {
  const numeros = (await db.select({ id: numerosWhatsapp.id }).from(numerosWhatsapp).where(eq(numerosWhatsapp.unidadeId, unidadeId))).map((n) => n.id);
  const campanhas = db.select({ id: campanhasDisparo.id }).from(campanhasDisparo).where(eq(campanhasDisparo.unidadeId, unidadeId));
  const urls: string[] = [];
  let mensagens = 0;

  await db.transaction(async (tx) => {
    if (numeros.length > 0) {
      const recebidas = await tx
        .delete(respostasClientes)
        .where(and(eq(respostasClientes.telefone, telefone), inArray(respostasClientes.numeroId, numeros)))
        .returning({ midiaUrl: respostasClientes.midiaUrl });
      const enviadas = await tx
        .delete(mensagensSaida)
        .where(and(eq(mensagensSaida.telefone, telefone), inArray(mensagensSaida.numeroId, numeros)))
        .returning({ midiaUrl: mensagensSaida.midiaUrl });
      mensagens = recebidas.length + enviadas.length;
      for (const { midiaUrl } of [...recebidas, ...enviadas]) if (midiaUrl) urls.push(midiaUrl);

      await tx.delete(notasConversa).where(and(eq(notasConversa.telefone, telefone), inArray(notasConversa.numeroId, numeros)));
      await tx.delete(sugestoesIa).where(and(eq(sugestoesIa.telefone, telefone), inArray(sugestoesIa.numeroId, numeros)));
      await tx.delete(funilClientes).where(and(eq(funilClientes.telefone, telefone), inArray(funilClientes.numeroId, numeros)));
      await tx.delete(duvidasIa).where(and(eq(duvidasIa.telefone, telefone), inArray(duvidasIa.numeroId, numeros)));
      await tx.delete(conversasConfig).where(and(eq(conversasConfig.telefone, telefone), inArray(conversasConfig.numeroId, numeros)));
      await tx.delete(conversasExcluidas).where(and(eq(conversasExcluidas.telefone, telefone), inArray(conversasExcluidas.numeroId, numeros)));
    }
    // Os disparos que ele recebeu (telefone e nome usados no template) saem das campanhas da unidade.
    await tx.delete(disparoDestinatarios).where(and(eq(disparoDestinatarios.telefone, telefone), inArray(disparoDestinatarios.campanhaId, campanhas)));
    await tx.delete(contatosUnidade).where(and(eq(contatosUnidade.unidadeId, unidadeId), eq(contatosUnidade.telefone, telefone)));
    // O nome do perfil do WhatsApp é guardado uma vez por telefone; sai quando nenhuma unidade tem mais conversa com ele.
    await tx
      .delete(contatos)
      .where(and(eq(contatos.telefone, telefone), sql`not exists (select 1 from ${respostasClientes} where ${respostasClientes.telefone} = ${telefone})`));
  });

  return { mensagens, arquivos: await apagarArquivosSemUso(db, urls) };
}

export async function apagarDadosDoInstagram(db: Db, conversaId: number): Promise<ResultadoExclusao> {
  const mensagens = await db
    .select({ midiaUrl: mensagensInstagram.midiaUrl })
    .from(mensagensInstagram)
    .where(eq(mensagensInstagram.conversaId, conversaId));
  // As mensagens saem junto (cascade).
  await db.delete(conversasInstagram).where(eq(conversasInstagram.id, conversaId));
  const urls = mensagens.flatMap((m) => (m.midiaUrl ? [m.midiaUrl] : []));
  return { mensagens: mensagens.length, arquivos: await apagarArquivosSemUso(db, urls) };
}

// Retenção: conversas sem nenhuma mensagem (recebida ou enviada) há mais de N meses são apagadas por
// inteiro. Ligada por RETENCAO_CONVERSAS_MESES (sem a variável, nada é apagado automaticamente).
export async function aplicarRetencao(db: Db, meses: number): Promise<{ conversas: number; dms: number }> {
  const limite = new Date();
  limite.setMonth(limite.getMonth() - meses);
  const antigas = await db.execute<{ unidade_id: number; telefone: string }>(sql`
    select n.unidade_id, c.telefone from (
      select numero_id, telefone, max(em) as ultima from (
        select ${respostasClientes.numeroId} as numero_id, ${respostasClientes.telefone} as telefone, ${respostasClientes.recebidaEm} as em from ${respostasClientes}
        union all
        select ${mensagensSaida.numeroId}, ${mensagensSaida.telefone}, ${mensagensSaida.createdAt} from ${mensagensSaida} where ${isNotNull(mensagensSaida.numeroId)}
      ) todas group by numero_id, telefone
    ) c
    join ${numerosWhatsapp} n on n.id = c.numero_id
    group by n.unidade_id, c.telefone
    having max(c.ultima) < ${limite.toISOString()}::timestamptz
    limit 500
  `);
  for (const linha of antigas) await apagarDadosDoCliente(db, linha.unidade_id, linha.telefone);

  const dms = await db
    .select({ id: conversasInstagram.id })
    .from(conversasInstagram)
    .innerJoin(contasInstagram, eq(contasInstagram.id, conversasInstagram.contaId))
    .where(lt(conversasInstagram.ultimaMensagemEm, limite))
    .limit(500);
  for (const { id } of dms) await apagarDadosDoInstagram(db, id);
  return { conversas: antigas.length, dms: dms.length };
}
