CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`local_part` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `mailboxes_address_ended_at_idx` ON `mailboxes` (`address`,`ended_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_active_address_idx` ON `mailboxes` (`address`) WHERE "mailboxes"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `mailboxes_expires_at_idx` ON `mailboxes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`mailtrap_message_id` text NOT NULL,
	`from_address` text,
	`recipients_json` text NOT NULL,
	`subject` text,
	`text_body` text,
	`html_body` text,
	`received_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_mailbox_mailtrap_message_idx` ON `messages` (`mailbox_id`,`mailtrap_message_id`);--> statement-breakpoint
CREATE INDEX `messages_mailbox_received_at_idx` ON `messages` (`mailbox_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
	`event_id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`mailtrap_message_id` text NOT NULL,
	`outcome` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_receipts_processed_at_idx` ON `webhook_receipts` (`processed_at`);