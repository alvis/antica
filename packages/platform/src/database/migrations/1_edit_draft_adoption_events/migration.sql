CREATE TABLE "edit_draft_adoption_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"edit_draft_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" text NOT NULL,
	"record_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_draft_adoption_events_status_ck" CHECK ("edit_draft_adoption_events"."status" in ('accepted','skipped'))
);


ALTER TABLE "edit_draft_runs" ADD CONSTRAINT "edit_draft_runs_owner_id_uq" UNIQUE USING INDEX "edit_draft_runs_owner_id_uq";

ALTER TABLE "edit_draft_adoption_events" ADD CONSTRAINT "edit_draft_adoption_events_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "edit_draft_adoption_events" ADD CONSTRAINT "edit_draft_adoption_events_owner_draft_fk" FOREIGN KEY ("owner_id","edit_draft_id") REFERENCES "public"."edit_draft_runs"("owner_id","id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "edit_draft_adoption_events_proposal_uq" ON "edit_draft_adoption_events" USING btree ("edit_draft_id","proposal_id");

CREATE INDEX "edit_draft_adoption_events_record_idx" ON "edit_draft_adoption_events" USING btree ("owner_id","record_id","created_at","id");
