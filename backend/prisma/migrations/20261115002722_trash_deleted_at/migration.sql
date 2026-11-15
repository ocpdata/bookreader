-- AlterTable
ALTER TABLE `summaries` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `summaries_user_id_deleted_at_idx` ON `summaries`(`user_id`, `deleted_at`);

-- CreateIndex
CREATE INDEX `summaries_status_created_at_idx` ON `summaries`(`status`, `created_at`);
