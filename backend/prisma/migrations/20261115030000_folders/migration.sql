-- AlterTable
ALTER TABLE `summaries` ADD COLUMN `folder_id` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `folders` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `parent_id` VARCHAR(36) NULL,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `folders_parent_id_idx`(`parent_id`),
    UNIQUE INDEX `folders_user_id_parent_id_name_key`(`user_id`, `parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `summaries_folder_id_idx` ON `summaries`(`folder_id`);

-- AddForeignKey
ALTER TABLE `summaries` ADD CONSTRAINT `summaries_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

