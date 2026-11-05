CREATE TABLE `restaurant_members` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`phone` text,
	`is_owner` integer DEFAULT false NOT NULL,
	`is_courier` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `restaurant_members_user_id_unique` ON `restaurant_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `restaurant_members_restaurant_active_idx` ON `restaurant_members` (`restaurant_id`,`active`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`restaurant_id` text NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_restaurant_name_unique` ON `roles` (`restaurant_id`,lower("name"));--> statement-breakpoint
-- Backfill (runs on the restaurants that already exist): every restaurant gets its system role
-- "Dueño" and its owner becomes a member with that role. The system role has no rows in
-- `role_permissions`: the owner check (`is_owner`) grants everything. Ids are random UUIDv4 strings,
-- the same format the app generates with `crypto.randomUUID()`.
INSERT INTO `roles` (`id`, `restaurant_id`, `name`, `is_system`, `active`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`id`, 'Dueño', 1, 1, `created_at`, `created_at`
FROM `restaurants`;--> statement-breakpoint
-- Backfill: the owner of each restaurant as a member. The first word of `user.name` is the first name
-- and the rest the last name (empty when the name is a single word); no phone.
INSERT INTO `restaurant_members` (`id`, `restaurant_id`, `user_id`, `role_id`, `first_name`, `last_name`, `phone`, `is_owner`, `is_courier`, `active`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`r`.`id`,
	`r`.`owner_id`,
	`ro`.`id`,
	CASE WHEN instr(`u`.`full_name`, ' ') > 0 THEN substr(`u`.`full_name`, 1, instr(`u`.`full_name`, ' ') - 1) ELSE `u`.`full_name` END,
	CASE WHEN instr(`u`.`full_name`, ' ') > 0 THEN trim(substr(`u`.`full_name`, instr(`u`.`full_name`, ' ') + 1)) ELSE '' END,
	NULL, 1, 0, 1, `r`.`created_at`, `r`.`created_at`
FROM `restaurants` AS `r`
INNER JOIN `roles` AS `ro` ON `ro`.`restaurant_id` = `r`.`id` AND `ro`.`is_system` = 1
INNER JOIN (SELECT `id`, COALESCE(NULLIF(trim(`name`), ''), `email`) AS `full_name` FROM `user`) AS `u` ON `u`.`id` = `r`.`owner_id`;
