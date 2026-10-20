-- CreateEnum
CREATE TYPE "TopicFacet" AS ENUM ('category', 'material', 'object_type', 'period', 'region', 'kiln_maker', 'technique', 'motif', 'mark', 'surface', 'condition', 'repair_restoration', 'authentication_limit', 'provenance');

-- CreateEnum
CREATE TYPE "TopicLabelKind" AS ENUM ('preferred', 'alias', 'original');

-- CreateEnum
CREATE TYPE "TopicRelationKind" AS ENUM ('related');

-- CreateEnum
CREATE TYPE "AuthorityKind" AS ENUM ('wikidata', 'getty_aat', 'getty_ulan', 'getty_tgn');

-- CreateEnum
CREATE TYPE "AuthorityRelation" AS ENUM ('exact', 'close', 'broader', 'related');

-- CreateEnum
CREATE TYPE "KnowledgeReviewState" AS ENUM ('pending', 'reviewed', 'rejected');

-- CreateEnum
CREATE TYPE "KnowledgeEntryType" AS ENUM ('concept', 'method', 'object_example');

-- CreateEnum
CREATE TYPE "KnowledgeOrigin" AS ENUM ('curated_seed', 'open_import', 'book', 'research', 'collector');

-- CreateEnum
CREATE TYPE "TopicApplicability" AS ENUM ('general', 'specific');

-- CreateEnum
CREATE TYPE "CitedClaimSection" AS ENUM ('summary', 'history', 'features', 'applicability', 'limits');

-- CreateEnum
CREATE TYPE "ClaimStatementType" AS ENUM ('source_attribution', 'observation', 'interpretation', 'method', 'limitation');

-- CreateEnum
CREATE TYPE "ClaimSupportState" AS ENUM ('cited', 'needs_source');

-- CreateEnum
CREATE TYPE "LanguageVariantKind" AS ENUM ('original', 'translation');

-- CreateEnum
CREATE TYPE "TranslationMethod" AS ENUM ('original', 'human', 'machine');

-- CreateEnum
CREATE TYPE "ExternalObjectStatus" AS ENUM ('active', 'missing');

-- CreateEnum
CREATE TYPE "RemoteImageStatus" AS ENUM ('unchecked', 'available', 'unavailable', 'removed');

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('staged', 'unchanged', 'imported', 'failed');

-- CreateEnum
CREATE TYPE "ReviewDiffStatus" AS ENUM ('pending', 'accepted', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "CorpusReleaseStatus" AS ENUM ('draft', 'published', 'withdrawn');

-- CreateEnum
CREATE TYPE "CorpusInstallStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CorpusItemDisposition" AS ENUM ('created', 'unchanged', 'update_draft', 'conflict');

-- AlterTable
ALTER TABLE "edit_draft_runs" ADD COLUMN     "knowledge_context" JSONB;

-- AlterTable
ALTER TABLE "knowledge_entries" ADD COLUMN     "content_id" TEXT,
ADD COLUMN     "latest_saved_revision" INTEGER;

-- AlterTable
ALTER TABLE "knowledge_revisions" ADD COLUMN     "content_schema_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "editorial_reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "editorial_reviewed_by" TEXT,
ADD COLUMN     "entry_type" "KnowledgeEntryType",
ADD COLUMN     "origin" "KnowledgeOrigin",
ADD COLUMN     "upstream_base_hash" TEXT;

-- AlterTable
ALTER TABLE "record_messages" ADD COLUMN     "knowledge_evidence" JSONB;

-- AlterTable
ALTER TABLE "reference_images" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(6),
ADD COLUMN     "observed_rights" JSONB,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_image_id" TEXT,
ADD COLUMN     "remote_url_hash" TEXT,
ADD COLUMN     "source_page_url" TEXT,
ADD COLUMN     "status" "RemoteImageStatus" NOT NULL DEFAULT 'unchecked',
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "source_locators" ADD COLUMN     "field_path" TEXT,
ADD COLUMN     "object_id" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "value_hash" TEXT;

-- AlterTable
ALTER TABLE "source_versions" ADD COLUMN     "external_object_id" UUID,
ADD COLUMN     "observed_rights" JSONB,
ADD COLUMN     "payload_hash" TEXT,
ADD COLUMN     "provider_schema_version" TEXT,
ADD COLUMN     "structured_payload" JSONB;

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "facet" "TopicFacet" NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_labels" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "topic_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "kind" "TopicLabelKind" NOT NULL,
    "provenance_citation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_relations" (
    "owner_id" TEXT NOT NULL,
    "from_topic_id" UUID NOT NULL,
    "to_topic_id" UUID NOT NULL,
    "relation" "TopicRelationKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_relations_pkey" PRIMARY KEY ("from_topic_id","to_topic_id","relation")
);

-- CreateTable
CREATE TABLE "authority_mappings" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "topic_id" UUID NOT NULL,
    "authority" "AuthorityKind" NOT NULL,
    "authority_id" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "relation" "AuthorityRelation" NOT NULL,
    "authority_version" TEXT,
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL,
    "citation_id" UUID NOT NULL,
    "review_state" "KnowledgeReviewState" NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_revision_topics" (
    "owner_id" TEXT NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "topic_id" UUID NOT NULL,
    "applicability" "TopicApplicability" NOT NULL,
    "uncertainty" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_revision_topics_pkey" PRIMARY KEY ("entry_id","revision","topic_id")
);

-- CreateTable
CREATE TABLE "cited_claims" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "claim_key" TEXT NOT NULL,
    "section" "CitedClaimSection" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "original_text" TEXT NOT NULL,
    "original_language" TEXT NOT NULL,
    "statement_type" "ClaimStatementType" NOT NULL,
    "scope" JSONB NOT NULL,
    "qualifiers" JSONB NOT NULL,
    "uncertainty" TEXT,
    "support_state" "ClaimSupportState" NOT NULL,
    "review_state" "KnowledgeReviewState" NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cited_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cited_claim_citations" (
    "claim_id" UUID NOT NULL,
    "citation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cited_claim_citations_pkey" PRIMARY KEY ("claim_id","citation_id")
);

-- CreateTable
CREATE TABLE "language_variants" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "kind" "LanguageVariantKind" NOT NULL,
    "text" TEXT NOT NULL,
    "method" "TranslationMethod" NOT NULL,
    "translator" TEXT,
    "review_state" "KnowledgeReviewState" NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "translated_at" TIMESTAMPTZ(6),
    "source_text_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "language_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_objects" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "canonical_record_url" TEXT NOT NULL,
    "upstream_modified_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "ExternalObjectStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "query_hash" TEXT NOT NULL,
    "adapter_version" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "cursor" JSONB,
    "status" "ImportRunStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "input_hash" TEXT,
    "output_hash" TEXT,
    "counts" JSONB NOT NULL,
    "failure_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_items" (
    "run_id" UUID NOT NULL,
    "provider_object_id" TEXT NOT NULL,
    "payload_hash" TEXT,
    "status" "ImportItemStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "source_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_items_pkey" PRIMARY KEY ("run_id","provider_object_id")
);

-- CreateTable
CREATE TABLE "review_diffs" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "import_run_id" UUID,
    "entry_id" UUID NOT NULL,
    "base_revision" INTEGER,
    "candidate_revision" INTEGER NOT NULL,
    "old_source_version_id" UUID,
    "new_source_version_id" UUID,
    "base_content_hash" TEXT,
    "candidate_content_hash" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" "ReviewDiffStatus" NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_diffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corpus_releases" (
    "id" UUID NOT NULL,
    "corpus_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "manifest_hash" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "editorial_reviewer" TEXT,
    "status" "CorpusReleaseStatus" NOT NULL,
    "rights_notices" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corpus_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corpus_installs" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "release_id" UUID NOT NULL,
    "request_key" TEXT NOT NULL,
    "status" "CorpusInstallStatus" NOT NULL,
    "installed_at" TIMESTAMPTZ(6),
    "counts" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corpus_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corpus_install_items" (
    "install_id" UUID NOT NULL,
    "content_id" TEXT NOT NULL,
    "entry_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "disposition" "CorpusItemDisposition" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corpus_install_items_pkey" PRIMARY KEY ("install_id","content_id")
);

-- CreateIndex
CREATE INDEX "topics_browse_idx" ON "topics"("owner_id", "facet", "parent_id", "sort_order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_owner_content_uq" ON "topics"("owner_id", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_owner_id_uq" ON "topics"("owner_id", "id");

-- CreateIndex
CREATE INDEX "topic_labels_search_idx" ON "topic_labels"("owner_id", "normalized_text", "topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "topic_labels_identity_uq" ON "topic_labels"("topic_id", "language", "kind", "normalized_text");

-- CreateIndex
CREATE UNIQUE INDEX "topic_labels_preferred_uq" ON "topic_labels"("topic_id", "language") WHERE (kind = 'preferred'::"TopicLabelKind");

-- CreateIndex
CREATE INDEX "authority_mappings_lookup_idx" ON "authority_mappings"("owner_id", "authority", "authority_id");

-- CreateIndex
CREATE UNIQUE INDEX "authority_mappings_identity_uq" ON "authority_mappings"("topic_id", "authority", "authority_id", "relation");

-- CreateIndex
CREATE INDEX "knowledge_revision_topics_lookup_idx" ON "knowledge_revision_topics"("owner_id", "topic_id", "entry_id", "revision");

-- CreateIndex
CREATE INDEX "cited_claims_grounding_idx" ON "cited_claims"("owner_id", "entry_id", "revision", "support_state", "review_state");

-- CreateIndex
CREATE UNIQUE INDEX "cited_claims_key_uq" ON "cited_claims"("entry_id", "revision", "claim_key");

-- CreateIndex
CREATE UNIQUE INDEX "cited_claims_ordinal_uq" ON "cited_claims"("entry_id", "revision", "section", "ordinal");

-- CreateIndex
CREATE INDEX "cited_claim_citations_citation_idx" ON "cited_claim_citations"("citation_id", "claim_id");

-- CreateIndex
CREATE INDEX "language_variants_language_idx" ON "language_variants"("language", "claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "language_variants_identity_uq" ON "language_variants"("claim_id", "language", "kind");

-- CreateIndex
CREATE INDEX "external_objects_seen_idx" ON "external_objects"("owner_id", "provider", "last_seen_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "external_objects_identity_uq" ON "external_objects"("owner_id", "provider", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_objects_source_uq" ON "external_objects"("owner_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_objects_owner_source_id_uq" ON "external_objects"("owner_id", "source_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_job_id_key" ON "import_runs"("job_id");

-- CreateIndex
CREATE INDEX "import_runs_progress_idx" ON "import_runs"("owner_id", "provider", "status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_request_uq" ON "import_runs"("owner_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_owner_id_uq" ON "import_runs"("owner_id", "id");

-- CreateIndex
CREATE INDEX "import_items_progress_idx" ON "import_items"("run_id", "status", "provider_object_id");

-- CreateIndex
CREATE INDEX "review_diffs_queue_idx" ON "review_diffs"("owner_id", "status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_diffs_candidate_uq" ON "review_diffs"("entry_id", "candidate_revision");

-- CreateIndex
CREATE UNIQUE INDEX "corpus_releases_version_uq" ON "corpus_releases"("corpus_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "corpus_releases_hash_uq" ON "corpus_releases"("corpus_id", "manifest_hash");

-- CreateIndex
CREATE INDEX "corpus_installs_status_idx" ON "corpus_installs"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "corpus_installs_release_uq" ON "corpus_installs"("owner_id", "release_id");

-- CreateIndex
CREATE UNIQUE INDEX "corpus_installs_request_uq" ON "corpus_installs"("owner_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entries_owner_content_uq" ON "knowledge_entries"("owner_id", "content_id") WHERE (content_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "knowledge_revisions_status_revision_idx" ON "knowledge_revisions"("entry_id", "status", "revision" DESC);

-- CreateIndex
CREATE INDEX "reference_images_status_checked_idx" ON "reference_images"("status", "last_checked_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reference_images_remote_url_uq" ON "reference_images"("source_version_id", "remote_url_hash") WHERE (remote_url_hash IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "source_locators_structured_field_uq" ON "source_locators"("source_version_id", "field_path", "value_hash") WHERE (kind = 'structured'::text);

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_latest_saved_fk" FOREIGN KEY ("id", "latest_saved_revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_version_source_fk" FOREIGN KEY ("source_id", "source_version_id") REFERENCES "source_versions"("source_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_external_object_fk" FOREIGN KEY ("owner_id", "source_id", "external_object_id") REFERENCES "external_objects"("owner_id", "source_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topic_parent_fk" FOREIGN KEY ("owner_id", "parent_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_labels" ADD CONSTRAINT "topic_label_topic_fk" FOREIGN KEY ("owner_id", "topic_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_labels" ADD CONSTRAINT "topic_label_provenance_citation_fk" FOREIGN KEY ("provenance_citation_id") REFERENCES "citations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relation_from_topic_fk" FOREIGN KEY ("owner_id", "from_topic_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relation_to_topic_fk" FOREIGN KEY ("owner_id", "to_topic_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "authority_mappings" ADD CONSTRAINT "authority_mapping_topic_fk" FOREIGN KEY ("owner_id", "topic_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "authority_mappings" ADD CONSTRAINT "authority_mapping_citation_fk" FOREIGN KEY ("citation_id") REFERENCES "citations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "knowledge_revision_topics" ADD CONSTRAINT "knowledge_revision_topic_entry_fk" FOREIGN KEY ("owner_id", "entry_id") REFERENCES "knowledge_entries"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "knowledge_revision_topics" ADD CONSTRAINT "knowledge_revision_topic_entry_revision_fk" FOREIGN KEY ("entry_id", "revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "knowledge_revision_topics" ADD CONSTRAINT "knowledge_revision_topic_topic_fk" FOREIGN KEY ("owner_id", "topic_id") REFERENCES "topics"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cited_claims" ADD CONSTRAINT "cited_claim_entry_fk" FOREIGN KEY ("owner_id", "entry_id") REFERENCES "knowledge_entries"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cited_claims" ADD CONSTRAINT "cited_claim_entry_revision_fk" FOREIGN KEY ("entry_id", "revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cited_claim_citations" ADD CONSTRAINT "cited_claim_citation_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "cited_claims"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cited_claim_citations" ADD CONSTRAINT "cited_claim_citation_citation_fk" FOREIGN KEY ("citation_id") REFERENCES "citations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "language_variants" ADD CONSTRAINT "language_variant_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "cited_claims"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "external_objects" ADD CONSTRAINT "external_object_source_fk" FOREIGN KEY ("owner_id", "source_id") REFERENCES "sources"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_run_job_fk" FOREIGN KEY ("owner_id", "job_id") REFERENCES "jobs"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_item_run_fk" FOREIGN KEY ("run_id") REFERENCES "import_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_item_source_version_fk" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_import_run_fk" FOREIGN KEY ("owner_id", "import_run_id") REFERENCES "import_runs"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_old_source_version_fk" FOREIGN KEY ("owner_id", "old_source_version_id") REFERENCES "source_versions"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_new_source_version_fk" FOREIGN KEY ("owner_id", "new_source_version_id") REFERENCES "source_versions"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_entry_fk" FOREIGN KEY ("owner_id", "entry_id") REFERENCES "knowledge_entries"("owner_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_base_fk" FOREIGN KEY ("entry_id", "base_revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_diffs" ADD CONSTRAINT "review_diff_candidate_fk" FOREIGN KEY ("entry_id", "candidate_revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "corpus_installs" ADD CONSTRAINT "corpus_install_release_fk" FOREIGN KEY ("release_id") REFERENCES "corpus_releases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "corpus_install_items" ADD CONSTRAINT "corpus_install_item_install_fk" FOREIGN KEY ("install_id") REFERENCES "corpus_installs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "corpus_install_items" ADD CONSTRAINT "corpus_install_item_entry_revision_fk" FOREIGN KEY ("entry_id", "revision") REFERENCES "knowledge_revisions"("entry_id", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- allow atomic insertion of the saved pointer and its referenced revision;
-- status, save provenance and pointer eligibility are audited in migration D
ALTER TABLE "knowledge_entries" ALTER CONSTRAINT "knowledge_entries_latest_saved_fk" DEFERRABLE INITIALLY DEFERRED;

-- keep existing page/web validation while admitting structured metadata;
-- complete structured-location and support validation follows the legacy audit
ALTER TABLE "source_locators" DROP CONSTRAINT "source_locators_branch_ck";
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_branch_ck" CHECK (
  (kind = 'page' AND page_id IS NOT NULL AND canonical_view_id IS NOT NULL AND url IS NULL)
  OR (kind = 'web' AND url IS NOT NULL AND retrieved_at IS NOT NULL AND page_id IS NULL)
  OR kind = 'structured'
);

-- new taxonomy rows must preserve directed parent and undirected related identities
ALTER TABLE "topics" ADD CONSTRAINT "topics_no_self_parent_ck" CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relations_ordered_pair_ck" CHECK (from_topic_id < to_topic_id);
ALTER TABLE "authority_mappings" ADD CONSTRAINT "authority_mappings_review_ck" CHECK (
  review_state <> 'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
);

-- nullable extensions preserve legacy book-image rows; new remote identities cannot store derivatives
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_dimensions_ck" CHECK (
  (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
);
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_remote_metadata_ck" CHECK (
  remote_url_hash IS NULL OR (
    external_image_url IS NOT NULL AND provider IS NOT NULL AND source_page_url IS NOT NULL
    AND stored_derivative_id IS NULL
  )
);
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_attempt_count_ck" CHECK (attempt_count >= 0);
