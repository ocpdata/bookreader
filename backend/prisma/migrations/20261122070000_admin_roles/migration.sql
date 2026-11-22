ALTER TABLE `users` ADD COLUMN `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER';

UPDATE `users` SET `role` = 'ADMIN' WHERE `id` = '00000000-0000-4000-8000-000000000001';

CREATE TABLE `admin_role_changes` (
    `id` VARCHAR(36) NOT NULL,
    `actor_id` VARCHAR(36) NOT NULL,
    `target_id` VARCHAR(36) NOT NULL,
    `previous_role` ENUM('USER', 'ADMIN') NOT NULL,
    `new_role` ENUM('USER', 'ADMIN') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_role_changes_actor_id_idx`(`actor_id`),
    INDEX `admin_role_changes_target_id_created_at_idx`(`target_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `admin_role_changes` ADD CONSTRAINT `admin_role_changes_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `admin_role_changes` ADD CONSTRAINT `admin_role_changes_target_id_fkey` FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
