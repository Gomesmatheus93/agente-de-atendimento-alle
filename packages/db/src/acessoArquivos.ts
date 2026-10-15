import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

// O arquivo "/uploads/<nome>" pertence a esta unidade? Ele aparece em alguma mensagem, template ou imagem
// do agente de um número/conta dela. O nome é um UUID (não dá para adivinhar), mas uma URL vazada não deve
// abrir o arquivo para quem é de outra unidade.
export async function arquivoDaUnidade(db: Db, url: string, unidadeId: number): Promise<boolean> {
  const linhas = await db.execute<{ ok: number }>(sql`
    select 1 as ok where
      exists (select 1 from respostas_clientes r join numeros_whatsapp n on n.id = r.numero_id where r.midia_url = ${url} and n.unidade_id = ${unidadeId})
      or exists (select 1 from mensagens_saida s join numeros_whatsapp n on n.id = s.numero_id where s.midia_url = ${url} and n.unidade_id = ${unidadeId})
      or exists (
        select 1 from mensagens_instagram m
        join conversas_instagram c on c.id = m.conversa_id
        join contas_instagram ci on ci.id = c.conta_id
        where m.midia_url = ${url} and ci.unidade_id = ${unidadeId}
      )
      or exists (select 1 from templates_whatsapp t where t.cabecalho_imagem_url = ${url} and t.unidade_id = ${unidadeId})
      or exists (select 1 from midias_agente a where a.midia_url = ${url} and a.unidade_id = ${unidadeId})
  `);
  return linhas.length > 0;
}
