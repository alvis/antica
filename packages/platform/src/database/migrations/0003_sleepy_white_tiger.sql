CREATE TABLE "source_artifacts" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_version_id" uuid NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_knowledge_drafts" (
	"owner_id" text NOT NULL,
	"source_version_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	CONSTRAINT "source_knowledge_drafts_source_version_id_entry_id_pk" PRIMARY KEY("source_version_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "note_paragraphs" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "reference_links" ADD COLUMN "versions" jsonb;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "request_key" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "source_versions_owner_id_uq" ON "source_versions" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_owner_id_source_version_id_source_versions_owner_id_id_fk" FOREIGN KEY ("owner_id","source_version_id") REFERENCES "public"."source_versions"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_knowledge_drafts" ADD CONSTRAINT "source_knowledge_drafts_owner_id_source_version_id_source_versions_owner_id_id_fk" FOREIGN KEY ("owner_id","source_version_id") REFERENCES "public"."source_versions"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_knowledge_drafts" ADD CONSTRAINT "source_knowledge_drafts_owner_id_entry_id_knowledge_entries_owner_id_id_fk" FOREIGN KEY ("owner_id","entry_id") REFERENCES "public"."knowledge_entries"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_artifacts_parse_run_idx" ON "source_artifacts" USING btree ("parse_run_id","kind");--> statement-breakpoint
CREATE INDEX "source_knowledge_drafts_entry_idx" ON "source_knowledge_drafts" USING btree ("entry_id");
