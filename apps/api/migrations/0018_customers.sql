CREATE TABLE `customer_tag_links` (
	`customer_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`restaurant_id` text NOT NULL,
	PRIMARY KEY(`customer_id`, `tag_id`),
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `customer_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_tag_links_tag_idx` ON `customer_tag_links` (`tag_id`);--> statement-breakpoint
CREATE TABLE `customer_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_tags_restaurant_name_unique` ON `customer_tags` (`restaurant_id`,lower("name"));--> statement-breakpoint
ALTER TABLE `customers` ADD `whatsapp_opt_in_at` integer;--> statement-breakpoint
ALTER TABLE `customers` ADD `whatsapp_opt_in_source` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `whatsapp_opt_out` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_restaurant_customer_created_idx` ON `orders` (`restaurant_id`,`customer_id`,`created_at`);--> statement-breakpoint
-- 17a: the "ghost customer" (manual orders without phone) is unlinked and removed. Its orders stay
-- for the reports. Existing customers keep no WhatsApp permission until their next opted-in order.
UPDATE `orders` SET `customer_id` = NULL
 WHERE `customer_id` IN (SELECT `id` FROM `customers` WHERE `phone` = '');--> statement-breakpoint
DELETE FROM `customers` WHERE `phone` = '';
