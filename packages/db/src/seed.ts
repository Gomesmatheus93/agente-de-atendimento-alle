import { count } from "drizzle-orm";
import { createDbClient } from "./client.js";
import { templatesWhatsapp } from "./schema/index.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada");

  const db = createDbClient(databaseUrl);

  const [{ total }] = await db.select({ total: count() }).from(templatesWhatsapp);
  if (total > 0) {
    console.log(`[seed] templates_whatsapp já tem ${total} registro(s), nada a fazer`);
    return;
  }

  await db.insert(templatesWhatsapp).values([
    {
      nome: "boas_vindas",
      conteudo: "Olá {{nome}}, tudo bem? Aqui é da academia. Passando para desejar boas-vindas!",
      categoria: "utilidade",
    },
    {
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
