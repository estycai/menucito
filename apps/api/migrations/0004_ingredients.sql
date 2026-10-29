CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`included_qty` integer NOT NULL,
	`min_qty` integer NOT NULL,
	`max_qty` integer NOT NULL,
	`extra_price_cents` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ingredients_product_position_idx` ON `ingredients` (`product_id`,`position`);