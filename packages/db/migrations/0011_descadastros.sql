CREATE TYPE "public"."origem_descadastro" AS ENUM('cliente', 'equipe', 'meta');--> statement-breakpoint
CREATE TABLE "descadastros" (
	"unidade_id" integer NOT NULL,
	"telefone" varchar(20) NOT NULL,
	"origem" "origem_descadastro" NOT NULL,
	"motivo" varchar(300),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "descadastros_unidade_id_telefone_pk" PRIMARY KEY("unidade_id","telefone")
);
--> statement-breakpoint
ALTER TABLE "descadastros" ADD CONSTRAINT "descadastros_unidade_id_unidades_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descadastros" ENABLE ROW LEVEL SECURITY;
