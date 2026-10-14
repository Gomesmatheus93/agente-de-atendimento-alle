import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { descadastros, ORIGENS_DESCADASTRO } from "./schema/descadastros.js";

// Telefones brasileiros chegam às vezes sem o nono dígito: as duas formas valem como o mesmo cliente.
export function variantesDoTelefone(telefone: string): string[] {
  const digitos = telefone.replace(/\D/g, "");
  const variantes = new Set([digitos]);
  if (digitos.startsWith("55") && digitos.length === 13 && digitos[4] === "9") variantes.add(digitos.slice(0, 4) + digitos.slice(5));
  if (digitos.startsWith("55") && digitos.length === 12) variantes.add(`${digitos.slice(0, 4)}9${digitos.slice(4)}`);
  return [...variantes];
}

const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Mensagem inteira (curta) pedindo para sair ou voltar. Só a mensagem inteira conta: "não quero sair da
// academia" ou "quero cancelar o plano" não são pedido de descadastro.
const PEDIDOS_DE_SAIR = new Set([
  "sair",
  "parar",
  "pare",
  "stop",
  "descadastrar",
  "descadastro",
  "remover",
  "parar promocoes",
  "parar de receber",
  "nao quero receber",
  "nao quero mais receber",
  "nao quero receber mais",
  "nao quero mais mensagens",
  "nao enviar mais",
  "nao me mande mais mensagens",
  "nao tenho interesse em receber",
]);
const PEDIDOS_DE_VOLTAR = new Set(["voltar", "quero voltar a receber", "receber novamente", "voltar a receber"]);

export function pedidoDeDescadastro(texto: string): "sair" | "voltar" | null {
  const limpo = normalizar(texto);
  if (limpo.length > 40) return null;
  if (PEDIDOS_DE_SAIR.has(limpo)) return "sair";
  if (PEDIDOS_DE_VOLTAR.has(limpo)) return "voltar";
  return null;
}

export type OrigemDescadastro = (typeof ORIGENS_DESCADASTRO)[number];

export async function descadastrar(db: Db, unidadeId: number, telefone: string, origem: OrigemDescadastro, motivo?: string | null): Promise<void> {
  await db
    .insert(descadastros)
    .values({ unidadeId, telefone, origem, motivo: motivo?.slice(0, 300) ?? null })
    .onConflictDoNothing();
}

export async function recadastrar(db: Db, unidadeId: number, telefone: string): Promise<void> {
  await db.delete(descadastros).where(and(eq(descadastros.unidadeId, unidadeId), inArray(descadastros.telefone, variantesDoTelefone(telefone))));
}

export async function situacaoDeDescadastro(db: Db, unidadeId: number, telefone: string) {
  const [linha] = await db
    .select()
    .from(descadastros)
    .where(and(eq(descadastros.unidadeId, unidadeId), inArray(descadastros.telefone, variantesDoTelefone(telefone))))
    .limit(1);
  return linha ?? null;
}

// Dos telefones de uma campanha, quais pediram para sair (comparando com e sem o nono dígito).
export async function telefonesDescadastrados(db: Db, unidadeId: number, telefones: string[]): Promise<Set<string>> {
  if (telefones.length === 0) return new Set();
  const porVariante = new Map<string, string>();
  for (const telefone of telefones) for (const variante of variantesDoTelefone(telefone)) porVariante.set(variante, telefone);
  const linhas: Array<{ telefone: string }> = [];
  const todas = [...porVariante.keys()];
  // Em blocos: campanhas grandes não estouram o limite de parâmetros do Postgres.
  for (let inicio = 0; inicio < todas.length; inicio += 5000) {
    linhas.push(
      ...(await db
        .select({ telefone: descadastros.telefone })
        .from(descadastros)
        .where(and(eq(descadastros.unidadeId, unidadeId), inArray(descadastros.telefone, todas.slice(inicio, inicio + 5000))))),
    );
  }
  return new Set(linhas.map((linha) => porVariante.get(linha.telefone)!).filter(Boolean));
}
