CREATE TABLE `duvidas_ia` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`numero_id` int NOT NULL,
	`tema` varchar(120) NOT NULL,
	`pergunta` varchar(500) NOT NULL,
	`sanada` boolean NOT NULL,
	`perguntada_em` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `duvidas_ia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `funil_clientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telefone` varchar(20) NOT NULL,
	`numero_id` int NOT NULL,
	`etapa` enum('em_conversa','interessado','fechando','fechou','nao_fechou') NOT NULL DEFAULT 'em_conversa',
	`etapa_origem` enum('ia','manual') NOT NULL DEFAULT 'ia',
	`motivo_perda` enum('preco','fidelidade','localizacao','horario','sem_interesse','sumiu','ja_aluno','outro'),
	`motivo_detalhe` varchar(500),
	`resumo` varchar(1000),
	`proximo_passo` varchar(300),
	`analisado_em` timestamp,
	`ultima_mensagem_analisada` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `funil_clientes_id` PRIMARY KEY(`id`),
	CONSTRAINT `funil_clientes_conversa` UNIQUE(`numero_id`,`telefone`)
);
--> statement-breakpoint
ALTER TABLE `duvidas_ia` ADD CONSTRAINT `duvidas_ia_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `funil_clientes` ADD CONSTRAINT `funil_clientes_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `duvidas_ia_conversa` ON `duvidas_ia` (`numero_id`,`telefone`);--> statement-breakpoint
CREATE INDEX `duvidas_ia_periodo` ON `duvidas_ia` (`perguntada_em`);