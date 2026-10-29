-- CreateIndex
CREATE INDEX "signature_log_user_id_idx" ON "signature_log"("user_id");

-- CreateIndex
CREATE INDEX "signature_log_document_hash_idx" ON "signature_log"("document_hash");
