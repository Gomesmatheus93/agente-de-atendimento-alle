import { getTableName, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { funilClientes } from "./schema/funil.js";
import { numerosWhatsapp } from "./schema/whatsapp.js";

// Conversas, mensagens, funil e dúvidas não guardam a unidade: pertencem ao número, e o número à unidade.
// Este filtro é o que separa uma unidade da outra em toda consulta por número.
export function doNumeroDaUnidade(colunaNumeroId: PgColumn, unidadeId: number): SQL {
  return sql`${colunaNumeroId} in (select ${numerosWhatsapp.id} from ${numerosWhatsapp} where ${numerosWhatsapp.unidadeId} = ${unidadeId})`;
}

// No upsert do funil: a data da etapa só muda quando a etapa muda de fato (mesma etapa reanalisada mantém
// a data de quando chegou nela). Usar só quando a etapa faz parte da atualização.
export const etapaDesdeAoAtualizar: SQL = sql`case when ${funilClientes.etapa} is distinct from excluded.etapa then now() else ${funilClientes.etapaDesde} end`;

// Coluna com o nome da tabela na frente ("tabela"."coluna"). Necessário em subconsulta dentro dos campos
// de um select de uma tabela só: ali o Drizzle escreve só "coluna", e numa subconsulta isso passa a
// apontar para a tabela de dentro (ex.: "telefone" = "telefone" compara a tabela com ela mesma).
export function qualificada(coluna: PgColumn): SQL {
  return sql`${sql.identifier(getTableName(coluna.table))}.${sql.identifier(coluna.name)}`;
}
