-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summaries" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,
    "status" "SummaryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "summaries_s3_key_key" ON "summaries"("s3_key");

-- CreateIndex
CREATE INDEX "summaries_category_id_idx" ON "summaries"("category_id");

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
