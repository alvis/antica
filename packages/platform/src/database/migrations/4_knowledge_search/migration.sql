-- CreateTable
CREATE TABLE "knowledge_search_documents" (
    "owner_id" TEXT NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "tokenizer_version" TEXT NOT NULL,
    "corpus_generation" BIGINT NOT NULL,
    "title_tokens" TEXT NOT NULL,
    "alias_tokens" TEXT NOT NULL,
    "topic_tokens" TEXT NOT NULL,
    "claim_tokens" TEXT NOT NULL,
    "source_tokens" TEXT NOT NULL,
    "normalized_title_aliases_marks" TEXT NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, title_tokens || ' ' || alias_tokens), 'A')
        || setweight(to_tsvector('simple'::regconfig, topic_tokens), 'B')
        || setweight(to_tsvector('simple'::regconfig, claim_tokens), 'C')
        || setweight(to_tsvector('simple'::regconfig, source_tokens), 'D')
    ) STORED NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_search_documents_pkey" PRIMARY KEY ("owner_id","entry_id","revision","language")
);

-- CreateIndex
CREATE INDEX "knowledge_search_documents_entry_idx" ON "knowledge_search_documents"("owner_id", "entry_id", "revision");

-- CreateIndex
CREATE INDEX "knowledge_search_documents_language_idx" ON "knowledge_search_documents"("owner_id", "language", "entry_id", "revision");

-- CreateIndex
CREATE INDEX "knowledge_search_documents_vector_idx" ON "knowledge_search_documents" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "knowledge_entries_saved_pointer_idx" ON "knowledge_entries"("owner_id", "latest_saved_revision", "id");

-- CreateIndex
CREATE INDEX "knowledge_revisions_entry_type_idx" ON "knowledge_revisions"("entry_type", "entry_id", "revision");

-- CreateIndex
CREATE INDEX "source_languages_filter_idx" ON "source_languages"("language", "source_id");

-- AddForeignKey
ALTER TABLE "knowledge_search_documents" ADD CONSTRAINT "knowledge_search_documents_entry_fk" FOREIGN KEY ("owner_id", "entry_id") REFERENCES "knowledge_entries"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "knowledge_search_documents" ADD CONSTRAINT "knowledge_search_documents_revision_fk" FOREIGN KEY ("entry_id", "revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

