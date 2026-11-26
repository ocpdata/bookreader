-- CreateTable
CREATE TABLE `admin_user_actions` (
    `id` VARCHAR(36) NOT NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `target_id` VARCHAR(36) NOT NULL,
    `action` VARCHAR(30) NOT NULL,
    `detail` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_user_actions_actor_id_idx`(`actor_id`),
    INDEX `admin_user_actions_target_id_created_at_idx`(`target_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_created_at_idx` ON `users`(`created_at`);

-- CreateIndex
CREATE INDEX `users_last_login_at_idx` ON `users`(`last_login_at`);

-- AddForeignKey
ALTER TABLE `admin_user_actions` ADD CONSTRAINT `admin_user_actions_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_user_actions` ADD CONSTRAINT `admin_user_actions_target_id_fkey` FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
