ALTER TABLE `categories`
    DROP INDEX `categories_name_key`,
    ADD COLUMN `user_id` VARCHAR(36) NULL,
    ADD COLUMN `shared_name` VARCHAR(100) NULL;

UPDATE `categories` SET `shared_name` = `name`;

ALTER TABLE `categories`
    ADD UNIQUE INDEX `categories_user_id_name_key` (`user_id`, `name`),
    ADD UNIQUE INDEX `categories_shared_name_key` (`shared_name`),
    ADD CONSTRAINT `categories_shared_name_check` CHECK (`shared_name` IS NULL OR `shared_name` = `name`),
    ADD CONSTRAINT `categories_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
