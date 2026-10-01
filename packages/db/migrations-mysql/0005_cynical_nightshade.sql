CREATE TABLE `conversas_config` (
	`telefone` varchar(20) NOT NULL,
	`ia_ativa` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversas_config_telefone` PRIMARY KEY(`telefone`)
);
