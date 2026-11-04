CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`label` text,
	`formatted_address` text NOT NULL,
	`locality` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`place_id` text,
	`between_streets` text,
	`unit` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_idx` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `delivery_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer NOT NULL,
	`shape` text NOT NULL,
	`radius_m` integer,
	`inner_radius_m` integer,
	`polygon` text,
	`pricing` text NOT NULL,
	`price_cents` integer,
	`base_cents` integer,
	`per_km_cents` integer,
	`min_shipping_cents` integer,
	`max_shipping_cents` integer,
	`min_order_cents` integer,
	`free_from_cents` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_zones_restaurant_sort_idx` ON `delivery_zones` (`restaurant_id`,`sort`);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_lat` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_lng` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_place_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_unit` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_between_streets` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_zone_id` text REFERENCES `delivery_zones`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_zone_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_distance_m` integer;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `delivery_mode` text DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `address` text;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `address_notes` text;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `place_id` text;