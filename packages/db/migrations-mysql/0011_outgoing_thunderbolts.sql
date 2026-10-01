CREATE TABLE `configuracoes` (
	`chave` varchar(60) NOT NULL,
	`valor` text NOT NULL,
	`secreto` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `configuracoes_chave` PRIMARY KEY(`chave`)
);
--> statement-breakpoint
CREATE TABLE `contas_whatsapp` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(120) NOT NULL,
	`waba_id` varchar(40) NOT NULL,
	`token_cifrado` text NOT NULL,
	`token_final` varchar(8) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contas_whatsapp_id` PRIMARY KEY(`id`),
	CONSTRAINT `contas_whatsapp_waba_id_unique` UNIQUE(`waba_id`)
);
--> statement-breakpoint
CREATE TABLE `numeros_whatsapp` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conta_id` int NOT NULL,
	`phone_number_id` varchar(40) NOT NULL,
	`numero_exibicao` varchar(32) NOT NULL,
	`nome_verificado` varchar(120),
	`qualidade` varchar(20),
	`ativo` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `numeros_whatsapp_id` PRIMARY KEY(`id`),
	CONSTRAINT `numeros_whatsapp_phone_number_id_unique` UNIQUE(`phone_number_id`)
);
--> statement-breakpoint
ALTER TABLE `numeros_whatsapp` ADD CONSTRAINT `numeros_whatsapp_conta_id_contas_whatsapp_id_fk` FOREIGN KEY (`conta_id`) REFERENCES `contas_whatsapp`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `numeros_whatsapp_conta` ON `numeros_whatsapp` (`conta_id`);