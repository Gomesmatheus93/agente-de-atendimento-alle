ALTER TABLE "conversas_config" DROP CONSTRAINT "conversas_config_atendente_id_usuarios_id_fk";
--> statement-breakpoint
DROP INDEX "conversas_config_atendente";--> statement-breakpoint
ALTER TABLE "conversas_config" DROP COLUMN "atendente_id";--> statement-breakpoint
ALTER TABLE "conversas_config" DROP COLUMN "atendimento_desde";--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "disponivel";--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "disponivel_desde";--> statement-breakpoint
ALTER TABLE "usuarios" DROP COLUMN "ultima_atribuicao_em";