ALTER TABLE "outbox" ALTER COLUMN "schema_version" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "schema_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "media_derivatives" ADD COLUMN "parent_derivative_id" uuid;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "signed_session" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_version_assets" ADD COLUMN "presentation" jsonb;