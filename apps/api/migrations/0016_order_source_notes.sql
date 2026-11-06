-- `orders.notes` already existed since 0006 (always NULL); only the source column is new.
ALTER TABLE `orders` ADD `source` text DEFAULT 'web' NOT NULL;
