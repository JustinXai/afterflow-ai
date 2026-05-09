/*
  Warnings:

  - You are about to drop the `AiProcessingLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `aiSummary` on the `OrderAnalysis` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `OrderAnalysis` table. All the data in the column will be lost.
  - Added the required column `summary` to the `OrderAnalysis` table without a default value. This is not possible if the table is not empty.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AiProcessingLog";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "AiLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderAnalysis" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" TEXT NOT NULL,
    "originalNote" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_OrderAnalysis" ("createdAt", "id", "orderId", "originalNote", "tags", "urgency") SELECT "createdAt", "id", "orderId", "originalNote", "tags", "urgency" FROM "OrderAnalysis";
DROP TABLE "OrderAnalysis";
ALTER TABLE "new_OrderAnalysis" RENAME TO "OrderAnalysis";
CREATE UNIQUE INDEX "OrderAnalysis_orderId_key" ON "OrderAnalysis"("orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
