ALTER TYPE "public"."tipo_mensagem" ADD VALUE 'imagem';--> statement-breakpoint
CREATE TABLE "midias_agente" (
	"chave" varchar(40) PRIMARY KEY NOT NULL,
	"descricao" varchar(200),
	"midia_url" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "midias_agente" ENABLE ROW LEVEL SECURITY;
