-- Sessions can exist briefly before a user logs in, so user_id is now nullable.
-- Also cascade-delete sessions when a user is removed, and index expires_at for cleanup queries.

PRAGMA foreign_keys=off;

CREATE TABLE "new_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER,
    "session_data" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_sessions" ("id", "user_id", "session_data", "expires_at")
SELECT "id", "user_id", "session_data", "expires_at" FROM "sessions";

DROP TABLE "sessions";
ALTER TABLE "new_sessions" RENAME TO "sessions";

CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

PRAGMA foreign_keys=on;
