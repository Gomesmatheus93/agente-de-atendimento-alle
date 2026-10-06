ALTER TABLE "disparo_destinatarios" ADD COLUMN "mensagem_externa_id" varchar(191);--> statement-breakpoint
ALTER TABLE "disparo_destinatarios" ADD COLUMN "entregue_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disparo_destinatarios" ADD COLUMN "lida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mensagens_saida" ADD COLUMN "entregue_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mensagens_saida" ADD COLUMN "lida_em" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "disparo_destinatarios_mensagem_externa_idx" ON "disparo_destinatarios" USING btree ("mensagem_externa_id");--> statement-breakpoint
CREATE INDEX "mensagens_saida_mensagem_externa_idx" ON "mensagens_saida" USING btree ("mensagem_externa_id");