CREATE TABLE `restaurant_appearance` (
	`restaurant_id` text PRIMARY KEY NOT NULL,
	`logo_url` text,
	`cover_url` text,
	`description` text DEFAULT '' NOT NULL,
	`bg_color` text,
	`primary_color` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `is_featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_one_featured_per_restaurant` ON `categories` (`restaurant_id`) WHERE "categories"."is_featured" = 1;--> statement-breakpoint
-- Backfill: one appearance row per existing restaurant, carrying over its logo. It must run before the column is dropped.
INSERT INTO `restaurant_appearance` (`restaurant_id`, `logo_url`, `updated_at`) SELECT `id`, `logo_url`, `updated_at` FROM `restaurants`;--> statement-breakpoint
ALTER TABLE `restaurants` DROP COLUMN `logo_url`;