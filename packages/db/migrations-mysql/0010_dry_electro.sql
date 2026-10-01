CREATE TABLE `sessoes` (
	`token` varchar(64) NOT NULL,
	`usuario_id` int NOT NULL,
	`expira_em` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessoes_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(120) NOT NULL,
	`email` varchar(255) NOT NULL,
	`senha_hash` varchar(255) NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usuarios_id` PRIMARY KEY(`id`),
	CONSTRAINT `usuarios_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `sessoes` ADD CONSTRAINT `sessoes_usuario_id_usuarios_id_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sessoes_usuario` ON `sessoes` (`usuario_id`);