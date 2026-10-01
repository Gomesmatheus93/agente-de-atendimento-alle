-- O Supabase publica as tabelas do schema "public" pela API REST dele (chaves anon/authenticated).
-- O Allp Chat não usa essa API: conecta direto no Postgres como dono das tabelas, que ignora RLS.
-- Ligar RLS sem nenhuma policy fecha a API pública para todas as tabelas.
ALTER TABLE "campanhas_disparo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "configuracoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contas_whatsapp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contatos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversas_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "disparo_destinatarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duvidas_ia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funil_clientes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mensagens_saida" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "numeros_whatsapp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "respostas_clientes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sugestoes_ia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates_whatsapp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
