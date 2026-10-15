CREATE INDEX "respostas_clientes_midia_idx" ON "respostas_clientes" USING btree ("midia_url");--> statement-breakpoint
CREATE INDEX "mensagens_saida_midia_idx" ON "mensagens_saida" USING btree ("midia_url");--> statement-breakpoint
CREATE INDEX "mensagens_instagram_midia" ON "mensagens_instagram" USING btree ("midia_url");