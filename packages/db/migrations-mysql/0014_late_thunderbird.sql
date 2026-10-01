ALTER TABLE `respostas_clientes` ADD `tipo` enum('texto','audio','figurinha') DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD `midia_url` varchar(500);--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD `midia_mime_type` varchar(100);--> statement-breakpoint
ALTER TABLE `mensagens_saida` ADD `tipo` enum('texto','audio','figurinha') DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE `mensagens_saida` ADD `midia_url` varchar(500);--> statement-breakpoint
ALTER TABLE `mensagens_saida` ADD `midia_mime_type` varchar(100);