ALTER TYPE "public"."tipo_mensagem" ADD VALUE 'video';--> statement-breakpoint
ALTER TYPE "public"."tipo_mensagem" ADD VALUE 'documento';--> statement-breakpoint
ALTER TABLE "respostas_clientes" ADD COLUMN "midia_nome" varchar(255);--> statement-breakpoint
ALTER TABLE "mensagens_saida" ADD COLUMN "midia_nome" varchar(255);