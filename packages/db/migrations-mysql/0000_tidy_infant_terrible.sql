CREATE TABLE `templates_whatsapp` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(255) NOT NULL,
	`conteudo` text NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `templates_whatsapp_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campanhas_disparo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(255) NOT NULL,
	`template_id` int NOT NULL,
	`status` enum('enviando','concluida') NOT NULL DEFAULT 'enviando',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campanhas_disparo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `disparo_destinatarios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campanha_id` int NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`parametros` json NOT NULL,
	`status_envio` enum('pendente','enviado','falhou') NOT NULL DEFAULT 'pendente',
	`tentativas` int NOT NULL DEFAULT 0,
	`erro_detalhe` text,
	`enviado_em` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `disparo_destinatarios_id` PRIMARY KEY(`id`),
	CONSTRAINT `disparo_destinatarios_campanha_telefone_unique` UNIQUE(`campanha_id`,`telefone`)
);
--> statement-breakpoint
ALTER TABLE `campanhas_disparo` ADD CONSTRAINT `campanhas_disparo_template_id_templates_whatsapp_id_fk` FOREIGN KEY (`template_id`) REFERENCES `templates_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `disparo_destinatarios` ADD CONSTRAINT `disparo_destinatarios_campanha_id_campanhas_disparo_id_fk` FOREIGN KEY (`campanha_id`) REFERENCES `campanhas_disparo`(`id`) ON DELETE no action ON UPDATE no action;