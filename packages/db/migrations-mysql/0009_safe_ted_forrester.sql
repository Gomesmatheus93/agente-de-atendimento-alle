CREATE TABLE `sugestoes_ia` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`texto` text NOT NULL,
	`status` enum('pendente','enviada','descartada') NOT NULL DEFAULT 'pendente',
	`resposta_cliente_id` int,
	`modelo` varchar(64) NOT NULL,
	`tokens_entrada` int NOT NULL DEFAULT 0,
	`tokens_saida` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sugestoes_ia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversas_config` ADD `precisa_humano` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversas_config` ADD `motivo_humano` varchar(500);--> statement-breakpoint
CREATE INDEX `sugestoes_ia_telefone_status` ON `sugestoes_ia` (`telefone`,`status`);