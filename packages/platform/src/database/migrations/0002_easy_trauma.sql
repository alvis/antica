ALTER TABLE "analysis_runs" ADD COLUMN "model_selection" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "run_suggested_methods" ADD COLUMN "owning_entry_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "run_suggested_methods" ADD COLUMN "title_zh_hant" text NOT NULL;