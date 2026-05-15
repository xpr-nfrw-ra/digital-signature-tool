-- Per-user crypto/UI preferences. Replaces the in-memory `appSettings` object on the client.
CREATE TABLE "user_settings" (
    "user_id" INTEGER NOT NULL PRIMARY KEY,
    "hash_algorithm" TEXT NOT NULL DEFAULT 'sha256',
    "signature_algorithm" TEXT NOT NULL DEFAULT 'rsa',
    "key_size" INTEGER NOT NULL DEFAULT 2048,
    "default_public_key_id" INTEGER,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_settings_default_public_key_id_fkey" FOREIGN KEY ("default_public_key_id") REFERENCES "public_keys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Backfill defaults for any users that pre-date this migration.
INSERT INTO "user_settings" ("user_id", "hash_algorithm", "signature_algorithm", "key_size", "updated_at")
SELECT "id", 'sha256', 'rsa', 2048, CURRENT_TIMESTAMP FROM "users";
