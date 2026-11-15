-- CreateTable
CREATE TABLE `bookmarks` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `summary_id` VARCHAR(36) NOT NULL,
    `time_seconds` DOUBLE NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bookmarks_summary_id_idx`(`summary_id`),
    UNIQUE INDEX `bookmarks_user_id_summary_id_time_seconds_key`(`user_id`, `summary_id`, `time_seconds`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bookmarks` ADD CONSTRAINT `bookmarks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookmarks` ADD CONSTRAINT `bookmarks_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

