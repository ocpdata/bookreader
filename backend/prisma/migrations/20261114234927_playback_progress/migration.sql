-- CreateTable
CREATE TABLE `playback_progress` (
    `user_id` VARCHAR(36) NOT NULL,
    `summary_id` VARCHAR(36) NOT NULL,
    `position_seconds` INTEGER NOT NULL DEFAULT 0,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `playback_progress_user_id_updated_at_idx`(`user_id`, `updated_at`),
    PRIMARY KEY (`user_id`, `summary_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `playback_progress` ADD CONSTRAINT `playback_progress_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `playback_progress` ADD CONSTRAINT `playback_progress_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
