ALTER TABLE `orders` ADD `tip_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `courier_member_id` text REFERENCES restaurant_members(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivered_at` integer;--> statement-breakpoint
CREATE INDEX `orders_restaurant_courier_status_idx` ON `orders` (`restaurant_id`,`courier_member_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_restaurant_delivered_idx` ON `orders` (`restaurant_id`,`delivered_at`);--> statement-breakpoint
-- Backfill (runs on the orders that already exist): an approximate delivery time from `updated_at`,
-- which is what the board used before this migration to list "delivered today". A later change (for
-- example marking the payment) already moved it, so old orders may fall on another day. `sent_at` and
-- the courier stay NULL for orders placed before this migration.
UPDATE `orders` SET `delivered_at` = `updated_at` WHERE `status` = 'delivered';