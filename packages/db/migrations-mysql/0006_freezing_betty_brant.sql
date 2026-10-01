ALTER TABLE `campanhas_disparo` MODIFY COLUMN `status` enum('agendada','enviando','concluida') NOT NULL DEFAULT 'enviando';--> statement-breakpoint
ALTER TABLE `campanhas_disparo` MODIFY COLUMN `etapa_manual` enum('agendada','na-fila','enviando','concluida','com-falhas','falhou');--> statement-breakpoint
ALTER TABLE `campanhas_disparo` ADD `disparo_em` timestamp DEFAULT (now()) NOT NULL;
--> statement-breakpoint
-- Campanhas já enviadas dispararam quando foram criadas.
UPDATE `campanhas_disparo` SET `disparo_em` = `created_at`;
