-- CreateTable
CREATE TABLE `tags` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tags_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `summary_tags` (
    `summary_id` VARCHAR(36) NOT NULL,
    `tag_id` VARCHAR(36) NOT NULL,

    INDEX `summary_tags_tag_id_idx`(`tag_id`),
    PRIMARY KEY (`summary_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `favorites` (
    `user_id` VARCHAR(36) NOT NULL,
    `summary_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `favorites_summary_id_idx`(`summary_id`),
    PRIMARY KEY (`user_id`, `summary_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tags` ADD CONSTRAINT `tags_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `summary_tags` ADD CONSTRAINT `summary_tags_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `summary_tags` ADD CONSTRAINT `summary_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
