-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `summaries` (
    `id` VARCHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `author` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category_id` VARCHAR(36) NOT NULL,
    `s3_key` VARCHAR(255) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `content_type` VARCHAR(100) NOT NULL,
    `status` ENUM('PENDING', 'READY') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `summaries_s3_key_key`(`s3_key`),
    INDEX `summaries_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `summaries` ADD CONSTRAINT `summaries_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
