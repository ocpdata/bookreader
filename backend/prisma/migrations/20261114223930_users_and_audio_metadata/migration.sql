-- AlterTable
ALTER TABLE `summaries` ADD COLUMN `duration_seconds` INTEGER NULL,
    ADD COLUMN `narrator` VARCHAR(200) NULL,
    ADD COLUMN `summary_title` VARCHAR(200) NULL,
    ADD COLUMN `user_id` VARCHAR(36) NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Usuario único hasta que exista el login. Debe existir antes de crear la clave foránea,
-- porque las filas actuales de summaries usan este id como valor por defecto.
INSERT INTO `users` (`id`, `name`) VALUES ('00000000-0000-4000-8000-000000000001', 'Propietario');

-- CreateIndex
CREATE INDEX `summaries_user_id_created_at_idx` ON `summaries`(`user_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `summaries` ADD CONSTRAINT `summaries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
