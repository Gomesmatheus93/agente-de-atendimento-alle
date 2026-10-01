CREATE TABLE "conversas_excluidas" (
	"numero_id" integer NOT NULL,
	"telefone" varchar(20) NOT NULL,
	"excluida_em" timestamp with time zone NOT NULL,
	CONSTRAINT "conversas_excluidas_numero_id_telefone_pk" PRIMARY KEY("numero_id","telefone")
);
--> statement-breakpoint
ALTER TABLE "conversas_excluidas" ADD CONSTRAINT "conversas_excluidas_numero_id_numeros_whatsapp_id_fk" FOREIGN KEY ("numero_id") REFERENCES "public"."numeros_whatsapp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversas_excluidas" ENABLE ROW LEVEL SECURITY;
