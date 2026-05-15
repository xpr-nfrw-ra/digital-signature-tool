-- Replace signature_log.public_key_fingerprint (TEXT) with public_key_id (INTEGER FK to public_keys.id).
-- signature_log has no production data yet, so we recreate the table rather than backfilling.

PRAGMA foreign_keys=off;

CREATE TABLE "new_signature_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "document_name" TEXT NOT NULL,
    "document_hash" TEXT NOT NULL,
    "public_key_id" INTEGER NOT NULL,
    "signed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signature_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "signature_log_public_key_id_fkey" FOREIGN KEY ("public_key_id") REFERENCES "public_keys" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

DROP TABLE "signature_log";
ALTER TABLE "new_signature_log" RENAME TO "signature_log";

PRAGMA foreign_keys=on;
