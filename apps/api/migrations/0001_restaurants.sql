CREATE TABLE `restaurants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`whatsapp` text NOT NULL,
	`delivery` integer NOT NULL,
	`takeaway` integer NOT NULL,
	`plan` text DEFAULT 'basic' NOT NULL,
	`status` text DEFAULT 'trial' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `restaurants_owner_id_unique` ON `restaurants` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `restaurants_slug_unique` ON `restaurants` (`slug`);