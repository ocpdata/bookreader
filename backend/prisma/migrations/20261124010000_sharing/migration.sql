CREATE TABLE `shares` (
    `id` VARCHAR(36) NOT NULL,
    `owner_id` VARCHAR(36) NOT NULL,
    `recipient_id` VARCHAR(36) NULL,
    -- Exactitud de dirección: no confundir correos diferentes por acentos.
    `email` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `scope` ENUM('LIBRARY', 'ITEMS') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `delivered_at` DATETIME(3) NULL,
    `active_key` CHAR(64) NULL,
    UNIQUE INDEX `shares_active_key_key`(`active_key`),
    INDEX `shares_owner_id_created_at_idx`(`owner_id`, `created_at`),
    INDEX `shares_owner_id_status_expires_at_idx`(`owner_id`, `status`, `expires_at`),
    INDEX `shares_email_status_idx`(`email`, `status`),
    INDEX `shares_recipient_id_status_idx`(`recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `share_items` (
    `share_id` VARCHAR(36) NOT NULL,
    `summary_id` VARCHAR(36) NOT NULL,
    INDEX `share_items_summary_id_idx`(`summary_id`),
    PRIMARY KEY (`share_id`, `summary_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shares` ADD CONSTRAINT `shares_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `shares` ADD CONSTRAINT `shares_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `share_items` ADD CONSTRAINT `share_items_share_id_fkey` FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `share_items` ADD CONSTRAINT `share_items_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `share_mail_attempts` (
    `id` VARCHAR(36) NOT NULL,
    `share_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `share_mail_attempts_share_id_created_at_idx`(`share_id`, `created_at`),
    INDEX `share_mail_attempts_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `share_mail_attempts` ADD CONSTRAINT `share_mail_attempts_share_id_fkey` FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
