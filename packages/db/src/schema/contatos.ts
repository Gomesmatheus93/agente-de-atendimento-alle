import { pgTable, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";

// O que sabemos sobre cada telefone, independente de campanha. Hoje só o nome do perfil do WhatsApp,
// que a Meta manda em `contacts[].profile.name` junto de toda mensagem recebida — ou seja, só existe
// para quem já nos escreveu; de quem apenas recebeu um disparo o WhatsApp não revela o nome.
export const contatos = pgTable("contatos", {
  telefone: varchar("telefone", { length: 20 }).primaryKey(),
  nomePerfil: varchar("nome_perfil", { length: 255 }),
  ...timestamps(),
});
