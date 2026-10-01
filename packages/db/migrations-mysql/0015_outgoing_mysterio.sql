ALTER TABLE `templates_whatsapp` ADD `cabecalho_texto` varchar(255);--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `rodape` varchar(255);--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `meta_id` varchar(40);--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `status` varchar(20) DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates_whatsapp` ADD `motivo_status` varchar(500);