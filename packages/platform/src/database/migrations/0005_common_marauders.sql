CREATE TABLE "provider_webhook_inbox" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"provider_job_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "provider_webhook_inbox_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "comparison_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"query" jsonb NOT NULL,
	"error" jsonb NOT NULL,
	"audit" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"invocation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_draft_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"request" jsonb NOT NULL,
	"model_selection" jsonb NOT NULL,
	"result" jsonb,
	"invocation" jsonb,
	"applied_proposal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "edit_draft_runs_status_ck" CHECK ("edit_draft_runs"."status" in ('pending','ready','partially_applied','applied'))
);
--> statement-breakpoint
CREATE TABLE "transcription_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"audio_asset_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"request" jsonb NOT NULL,
	"model_selection" jsonb NOT NULL,
	"result" jsonb,
	"invocation" jsonb,
	"confirmed_observation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transcription_runs_status_ck" CHECK ("transcription_runs"."status" in ('pending','ready','confirmed'))
);
--> statement-breakpoint
ALTER TABLE "canonical_views" ALTER COLUMN "derivative_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edit_draft_runs" ADD CONSTRAINT "edit_draft_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_draft_runs" ADD CONSTRAINT "edit_draft_runs_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_runs" ADD CONSTRAINT "transcription_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_runs" ADD CONSTRAINT "transcription_runs_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_runs" ADD CONSTRAINT "transcription_runs_audio_asset_id_media_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_webhook_inbox_pending_idx" ON "provider_webhook_inbox" USING btree ("provider","created_at") WHERE "provider_webhook_inbox"."delivered_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_failures_owner_id_uq" ON "comparison_failures" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_results_owner_id_uq" ON "comparison_results" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_draft_runs_owner_id_uq" ON "edit_draft_runs" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_draft_runs_job_uq" ON "edit_draft_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "edit_draft_runs_record_idx" ON "edit_draft_runs" USING btree ("owner_id","record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_runs_owner_id_uq" ON "transcription_runs" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_runs_job_uq" ON "transcription_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "transcription_runs_record_idx" ON "transcription_runs" USING btree ("owner_id","record_id","created_at");