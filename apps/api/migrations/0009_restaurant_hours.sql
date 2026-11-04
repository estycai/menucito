CREATE TABLE `restaurant_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`fulfillment` text NOT NULL,
	`sort` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `restaurant_hours_restaurant_weekday_sort_idx` ON `restaurant_hours` (`restaurant_id`,`weekday`,`sort`);--> statement-breakpoint
ALTER TABLE `restaurant_settings` ADD `accept_orders_outside_hours` integer DEFAULT false NOT NULL;