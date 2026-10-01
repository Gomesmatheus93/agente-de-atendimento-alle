CREATE TABLE `respostas_clientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mensagem_externa_id` varchar(191),
	`telefone` varchar(20) NOT NULL,
	`campanha_id` int,
	`destinatario_id` int,
	`texto` text NOT NULL,
	`recebida_em` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `respostas_clientes_id` PRIMARY KEY(`id`),
	CONSTRAINT `respostas_clientes_mensagem_externa_unique` UNIQUE(`mensagem_externa_id`)
);
--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `categoria` enum('marketing','utilidade','autenticacao','servico') DEFAULT 'marketing' NOT NULL;--> statement-breakpoint
ALTER TABLE `campanhas_disparo` ADD `custo_unitario` decimal(10,4);--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD CONSTRAINT `respostas_clientes_campanha_id_campanhas_disparo_id_fk` FOREIGN KEY (`campanha_id`) REFERENCES `campanhas_disparo`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD CONSTRAINT `respostas_clientes_destinatario_id_disparo_destinatarios_id_fk` FOREIGN KEY (`destinatario_id`) REFERENCES `disparo_destinatarios`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `respostas_clientes_campanha_idx` ON `respostas_clientes` (`campanha_id`);--> statement-breakpoint
CREATE INDEX `respostas_clientes_recebida_em_idx` ON `respostas_clientes` (`recebida_em`);