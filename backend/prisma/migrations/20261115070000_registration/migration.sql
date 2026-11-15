-- AlterTable
ALTER TABLE `users` ADD COLUMN `email_verified_at` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'PENDING', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `terms_accepted_at` DATETIME(3) NULL,
    ADD COLUMN `terms_version` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `email_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `purpose` ENUM('VERIFY_EMAIL', 'RESET_PASSWORD') NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_tokens_token_hash_key`(`token_hash`),
    INDEX `email_tokens_user_id_purpose_idx`(`user_id`, `purpose`),
    INDEX `email_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` VARCHAR(36) NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `email` VARCHAR(255) NULL,
    `max_uses` INTEGER NOT NULL DEFAULT 1,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NULL,
    `note` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invitations_code_hash_key`(`code_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `email_tokens` ADD CONSTRAINT `email_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Las cuentas existentes las creó el administrador: se consideran verificadas.
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `email` IS NOT NULL;

