ALTER TABLE `respostas_clientes` ADD `lida_em` timestamp;--> statement-breakpoint
CREATE INDEX `respostas_clientes_telefone_idx` ON `respostas_clientes` (`telefone`,`recebida_em`);--> statement-breakpoint
-- Mensagens anteriores ao recurso de conversas contam como lidas, para não aparecerem todas como novas.
UPDATE `respostas_clientes` SET `lida_em` = `recebida_em`;