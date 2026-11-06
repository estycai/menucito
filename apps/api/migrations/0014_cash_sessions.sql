CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`comment` text,
	`group_id` text NOT NULL,
	`order_id` text,
	`courier_member_id` text,
	`created_at` integer NOT NULL,
	`created_by_member_id` text,
	`created_by_name` text NOT NULL,
	`edited_by_name` text,
	`edited_at` integer,
	`voided_by_name` text,
	`voided_at` integer,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`courier_member_id`) REFERENCES `restaurant_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `restaurant_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cash_movements_session_created_idx` ON `cash_movements` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `cash_movements_group_idx` ON `cash_movements` (`group_id`);--> statement-breakpoint
CREATE INDEX `cash_movements_order_idx` ON `cash_movements` (`order_id`);--> statement-breakpoint
CREATE TABLE `cash_session_totals` (
	`session_id` text NOT NULL,
	`method` text NOT NULL,
	`sales_count` integer NOT NULL,
	`sales_cents` integer NOT NULL,
	`income_count` integer NOT NULL,
	`income_cents` integer NOT NULL,
	`expense_count` integer NOT NULL,
	`expense_cents` integer NOT NULL,
	`tip_count` integer NOT NULL,
	`tip_cents` integer NOT NULL,
	PRIMARY KEY(`session_id`, `method`),
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`opening_cash_cents` integer NOT NULL,
	`closed_at` integer,
	`counted_cash_cents` integer,
	`expected_cash_cents` integer,
	`difference_cents` integer,
	`close_note` text,
	`opened_by_member_id` text,
	`opened_by_name` text NOT NULL,
	`closed_by_member_id` text,
	`closed_by_name` text,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opened_by_member_id`) REFERENCES `restaurant_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_member_id`) REFERENCES `restaurant_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_one_open_per_restaurant` ON `cash_sessions` (`restaurant_id`) WHERE "cash_sessions"."closed_at" is null;--> statement-breakpoint
CREATE INDEX `cash_sessions_restaurant_opened_idx` ON `cash_sessions` (`restaurant_id`,`opened_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `cash_session_id` text REFERENCES cash_sessions(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `settled_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `settled_by_member_id` text REFERENCES restaurant_members(id);--> statement-breakpoint
CREATE INDEX `orders_restaurant_cash_session_idx` ON `orders` (`restaurant_id`,`cash_session_id`);--> statement-breakpoint
CREATE INDEX `orders_restaurant_settled_idx` ON `orders` (`restaurant_id`,`settled_at`);