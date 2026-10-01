CREATE TABLE `contatos` (
	`telefone` varchar(20) NOT NULL,
	`nome_perfil` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contatos_telefone` PRIMARY KEY(`telefone`)
);
