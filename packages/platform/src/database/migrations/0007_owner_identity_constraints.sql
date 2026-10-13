ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_owner_id_uq" UNIQUE USING INDEX "knowledge_entries_owner_id_uq";--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_owner_id_uq" UNIQUE USING INDEX "source_versions_owner_id_uq";
