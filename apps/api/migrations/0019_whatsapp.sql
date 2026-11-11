CREATE TABLE `order_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`target_status` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`wa_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_notifications_order_target_unique` ON `order_notifications` (`order_id`,`target_status`);--> statement-breakpoint
CREATE INDEX `order_notifications_restaurant_status_idx` ON `order_notifications` (`restaurant_id`,`status`);--> statement-breakpoint
CREATE INDEX `order_notifications_wa_message_idx` ON `order_notifications` (`wa_message_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_connections` (
	`restaurant_id` text PRIMARY KEY NOT NULL,
	`waba_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`display_phone` text NOT NULL,
	`display_name` text NOT NULL,
	`access_token_enc` text,
	`token_expires_at` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`status_detail` text,
	`business_verified` integer DEFAULT false NOT NULL,
	`coexistence` integer DEFAULT false NOT NULL,
	`auto_send` integer DEFAULT true NOT NULL,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_connections_phone_number_id_unique` ON `whatsapp_connections` (`phone_number_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `wa_last_inbound_at` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `wa_bsuid` text;--> statement-breakpoint
CREATE INDEX `customers_restaurant_bsuid_idx` ON `customers` (`restaurant_id`,`wa_bsuid`);