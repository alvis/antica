CREATE TABLE "record_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"edit_draft_id" uuid NOT NULL,
	"request_key" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "record_messages_author_ck" CHECK ("record_messages"."author" in ('collector','assistant')),
	CONSTRAINT "record_messages_request_key_ck" CHECK ("record_messages"."author" <> 'collector' or "record_messages"."request_key" is not null),
	CONSTRAINT "record_messages_body_ck" CHECK ("record_messages"."body" ~ '\S')
);


ALTER TABLE "record_messages" ADD CONSTRAINT "record_messages_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "record_messages" ADD CONSTRAINT "record_messages_edit_draft_id_edit_draft_runs_id_fk" FOREIGN KEY ("edit_draft_id") REFERENCES "public"."edit_draft_runs"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "record_messages_owner_id_uq" ON "record_messages" USING btree ("owner_id","id");

CREATE UNIQUE INDEX "record_messages_owner_request_uq" ON "record_messages" USING btree ("owner_id","request_key");

CREATE UNIQUE INDEX "record_messages_assistant_reply_uq" ON "record_messages" USING btree ("edit_draft_id") WHERE "record_messages"."author" = 'assistant';

CREATE INDEX "record_messages_record_idx" ON "record_messages" USING btree ("record_id","created_at","id");
