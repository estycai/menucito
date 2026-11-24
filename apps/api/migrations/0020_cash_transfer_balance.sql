ALTER TABLE `cash_sessions` ADD `opening_transfer_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `counted_transfer_cents` integer;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `expected_transfer_cents` integer;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `transfer_difference_cents` integer;