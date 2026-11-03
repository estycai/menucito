CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text,
	`notes` text,
	`first_order_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_restaurant_phone_unique` ON `customers` (`restaurant_id`,`phone`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`options_json` text,
	`notes` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`customer_id` text,
	`number` integer NOT NULL,
	`client_token` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`fulfillment` text NOT NULL,
	`payment_method` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`delivery_address` text,
	`notes` text,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`promo_code_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_restaurant_number_unique` ON `orders` (`restaurant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_restaurant_token_unique` ON `orders` (`restaurant_id`,`client_token`);--> statement-breakpoint
CREATE INDEX `orders_restaurant_status_number_idx` ON `orders` (`restaurant_id`,`status`,`number`);--> statement-breakpoint
CREATE INDEX `orders_restaurant_created_idx` ON `orders` (`restaurant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `promo_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`min_order_cents` integer,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promo_codes_restaurant_code_unique` ON `promo_codes` (`restaurant_id`,lower("code"));--> statement-breakpoint
CREATE TABLE `restaurant_payment_methods` (
	`restaurant_id` text NOT NULL,
	`method` text NOT NULL,
	`enabled` integer NOT NULL,
	`alias` text,
	`holder_name` text,
	PRIMARY KEY(`restaurant_id`, `method`),
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `restaurant_settings` (
	`restaurant_id` text PRIMARY KEY NOT NULL,
	`accepting_orders` integer DEFAULT true NOT NULL,
	`min_order_cents` integer,
	`shipping_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Backfill: create store settings for existing restaurants (accepting orders, no min, shipping 0).
INSERT INTO `restaurant_settings` (`restaurant_id`, `accepting_orders`, `min_order_cents`, `shipping_cents`, `updated_at`)
SELECT `id`, 1, NULL, 0, `updated_at` FROM `restaurants`;--> statement-breakpoint
-- Backfill: create default payment methods for existing restaurants (cash enabled, transfer enabled without alias/holder).
INSERT INTO `restaurant_payment_methods` (`restaurant_id`, `method`, `enabled`, `alias`, `holder_name`)
SELECT `id`, 'cash', 1, NULL, NULL FROM `restaurants`;--> statement-breakpoint
INSERT INTO `restaurant_payment_methods` (`restaurant_id`, `method`, `enabled`, `alias`, `holder_name`)
SELECT `id`, 'transfer', 1, NULL, NULL FROM `restaurants`;
