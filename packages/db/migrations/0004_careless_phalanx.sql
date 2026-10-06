ALTER TABLE "conversas_config" DROP CONSTRAINT "conversas_config_pkey";--> statement-breakpoint
ALTER TABLE "conversas_config" ALTER COLUMN "numero_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversas_config" ADD CONSTRAINT "conversas_config_numero_id_telefone_pk" PRIMARY KEY("numero_id","telefone");--> statement-breakpoint
ALTER TABLE "conversas_config" ADD COLUMN "ia_desligada_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversas_config" ADD COLUMN "humano_pedido_em" timestamp with time zone;