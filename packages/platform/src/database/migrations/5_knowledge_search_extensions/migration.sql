-- optional hosted acceleration; migration B remains extension-free
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateIndex
CREATE INDEX "knowledge_search_documents_compact_trigram_idx" ON "knowledge_search_documents" USING GIN ("normalized_title_aliases_marks" gin_trgm_ops);

