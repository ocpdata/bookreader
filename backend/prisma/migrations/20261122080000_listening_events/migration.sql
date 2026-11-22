CREATE TABLE `listening_events` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `summary_id` VARCHAR(36) NOT NULL,
  `duration_ms` INTEGER NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `listening_events_user_id_occurred_at_idx` (`user_id`, `occurred_at`),
  INDEX `listening_events_occurred_at_user_id_idx` (`occurred_at`, `user_id`),
  INDEX `listening_events_summary_id_idx` (`summary_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `listening_events` ADD CONSTRAINT `listening_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `listening_events` ADD CONSTRAINT `listening_events_summary_id_fkey`
  FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
