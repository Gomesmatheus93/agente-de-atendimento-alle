import { asc, count } from "drizzle-orm";
import { createDbClient } from "./client.js";
import { templatesWhatsapp, unidades } from "./schema/index.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada");

  const db = createDbClient(databaseUrl);

  const [{ total }] = await db.select({ total: count() }).from(templatesWhatsapp);
  if (total > 0) {
    console.log(`[seed] templates_whatsapp já tem ${total} registro(s), nada a fazer`);
    return;
  }

  // Os exemplos ficam na primeira unidade (criada aqui se ainda não houver nenhuma).
  let [unidade] = await db.select({ id: unidades.id }).from(unidades).orderBy(asc(unidades.id)).limit(1);
  if (!unidade) [unidade] = await db.insert(unidades).values({ nome: "Unidade de exemplo" }).returning({ id: unidades.id });
  const unidadeId = unidade!.id;

  await db.insert(templatesWhatsapp).values([
    {
      unidadeId,
      nome: "boas_vindas",
      conteudo: "Olá {{nome}}, tudo bem? Aqui é da academia. Passando para desejar boas-vindas!",
      categoria: "utilidade",
    },
    {
      unidadeId,
      nome: "promo",
      conteudo: "Oi {{nome}}! Esta semana você tem {{desconto}} de desconto na renovação do seu plano.",
      categoria: "marketing",
    },
  ]);

  console.log("[seed] 2 templates de exemplo inseridos");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] falhou:", err);
    process.exit(1);
  });
