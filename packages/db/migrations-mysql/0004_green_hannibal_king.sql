CREATE TABLE `mensagens_saida` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`texto` text NOT NULL,
	`status_envio` enum('pendente','enviado','falhou') NOT NULL DEFAULT 'pendente',
	`tentativas` int NOT NULL DEFAULT 0,
	`erro_detalhe` text,
	`mensagem_externa_id` varchar(191),
	`enviado_em` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mensagens_saida_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mensagens_saida_telefone_idx` ON `mensagens_saida` (`telefone`,`created_at`);