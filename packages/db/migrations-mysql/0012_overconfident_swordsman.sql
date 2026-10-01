ALTER TABLE `templates_whatsapp` ADD `conta_id` int;--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `cabecalho_formato` varchar(20);--> statement-breakpoint
ALTER TABLE `campanhas_disparo` ADD `numero_id` int;--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD `numero_id` int;--> statement-breakpoint
ALTER TABLE `mensagens_saida` ADD `numero_id` int;--> statement-breakpoint
ALTER TABLE `conversas_config` ADD `numero_id` int;--> statement-breakpoint
ALTER TABLE `sugestoes_ia` ADD `numero_id` int;--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD CONSTRAINT `templates_whatsapp_conta_id_contas_whatsapp_id_fk` FOREIGN KEY (`conta_id`) REFERENCES `contas_whatsapp`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campanhas_disparo` ADD CONSTRAINT `campanhas_disparo_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `respostas_clientes` ADD CONSTRAINT `respostas_clientes_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mensagens_saida` ADD CONSTRAINT `mensagens_saida_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversas_config` ADD CONSTRAINT `conversas_config_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sugestoes_ia` ADD CONSTRAINT `sugestoes_ia_numero_id_numeros_whatsapp_id_fk` FOREIGN KEY (`numero_id`) REFERENCES `numeros_whatsapp`(`id`) ON DELETE no action ON UPDATE no action;