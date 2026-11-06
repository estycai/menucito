CREATE TABLE `order_message_templates` (
	`restaurant_id` text NOT NULL,
	`fulfillment` text NOT NULL,
	`target_status` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`restaurant_id`, `fulfillment`, `target_status`),
	FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
