ALTER TABLE "funil_clientes" ADD COLUMN "etapa_desde" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "funil_clientes_etapa_desde" ON "funil_clientes" USING btree ("etapa","etapa_desde");--> statement-breakpoint
-- Cards que já existiam: a melhor estimativa de quando chegaram na etapa é a última mensagem que a análise leu.
UPDATE "funil_clientes" SET "etapa_desde" = coalesce("ultima_mensagem_analisada", "analisado_em", "updated_at");
