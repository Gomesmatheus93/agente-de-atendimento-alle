CREATE TABLE "followups_enviados" (
	"numero_id" integer NOT NULL,
	"telefone" varchar(20) NOT NULL,
	"apos_mensagem_em" timestamp with time zone NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followups_enviados_mensagem" UNIQUE("numero_id","telefone","apos_mensagem_em")
);
--> statement-breakpoint
ALTER TABLE "contatos_unidade" ADD COLUMN "nascimento" date;--> statement-breakpoint
ALTER TABLE "followups_enviados" ADD CONSTRAINT "followups_enviados_numero_id_numeros_whatsapp_id_fk" FOREIGN KEY ("numero_id") REFERENCES "public"."numeros_whatsapp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups_enviados" ENABLE ROW LEVEL SECURITY;
