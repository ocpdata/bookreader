ALTER TABLE `summaries`
    ADD COLUMN `upload_request_id` VARCHAR(36) NULL,
    ADD COLUMN `requested_sha256` CHAR(64) NULL,
    ADD COLUMN `upload_issued_at` DATETIME(3) NULL,
    ADD COLUMN `cancel_requested_at` DATETIME(3) NULL,
    ADD COLUMN `purge_claimed_at` DATETIME(3) NULL,
    ADD COLUMN `audio_sha256` CHAR(64) NULL,
    ADD COLUMN `hash_attempt_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `summaries_user_id_upload_request_id_key` ON `summaries`(`user_id`, `upload_request_id`);
CREATE INDEX `summaries_user_id_audio_sha256_idx` ON `summaries`(`user_id`, `audio_sha256`);
