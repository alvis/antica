CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_send_cooldown" (
	"phone_number" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_acquisitions" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"acquired_on" text,
	"seller" text,
	"method" text,
	"amount" numeric(18, 2),
	"currency" text,
	"provenance_note" text,
	CONSTRAINT "record_acquisitions_amount_currency_ck" CHECK (("record_acquisitions"."amount" is null) = ("record_acquisitions"."currency" is null))
);
--> statement-breakpoint
CREATE TABLE "record_categories" (
	"record_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "record_categories_record_id_category_id_pk" PRIMARY KEY("record_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "record_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"record_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"label" text NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_materials" (
	"record_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	CONSTRAINT "record_materials_record_id_material_id_pk" PRIMARY KEY("record_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "record_measurements" (
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"component_id" uuid,
	"value" numeric(18, 6) NOT NULL,
	"unit" text NOT NULL,
	CONSTRAINT "record_measurements_record_id_kind_pk" PRIMARY KEY("record_id","kind"),
	CONSTRAINT "record_measurements_value_ck" CHECK ("record_measurements"."value" > 0),
	CONSTRAINT "record_measurements_unit_ck" CHECK (("record_measurements"."kind" = 'weight' and "record_measurements"."unit" in ('g', 'kg')) or ("record_measurements"."kind" in ('height', 'width', 'depth', 'diameter') and "record_measurements"."unit" in ('mm', 'cm', 'm')))
);
--> statement-breakpoint
CREATE TABLE "record_receipts" (
	"record_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "record_receipts_record_id_asset_id_pk" PRIMARY KEY("record_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "record_tags" (
	"record_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "record_tags_record_id_tag_pk" PRIMARY KEY("record_id","tag")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"unit_kind" text NOT NULL,
	"piece_count" integer,
	"period_label" text,
	"period_from_year" integer,
	"period_to_year" integer,
	"period_status" text,
	"location_id" uuid,
	"location_detail" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"collector_judgment" text,
	"record_revision" integer DEFAULT 1 NOT NULL,
	"analysis_input_version" integer DEFAULT 1 NOT NULL,
	"evidence_version" integer DEFAULT 1 NOT NULL,
	"latest_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_unit_kind_ck" CHECK ("records"."unit_kind" in ('single', 'set')),
	CONSTRAINT "records_piece_count_ck" CHECK ("records"."piece_count" is null or "records"."piece_count" > 0),
	CONSTRAINT "records_period_year_ck" CHECK ("records"."period_from_year" is null or "records"."period_to_year" is null or "records"."period_from_year" <= "records"."period_to_year")
);
--> statement-breakpoint
CREATE TABLE "canonical_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"derivative_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"coordinate_space" text NOT NULL,
	"transform_to_original" jsonb NOT NULL,
	CONSTRAINT "canonical_views_dimensions_ck" CHECK ("canonical_views"."width" > 0 and "canonical_views"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_asset_components" (
	"asset_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	CONSTRAINT "media_asset_components_asset_id_component_id_pk" PRIMARY KEY("asset_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid,
	"source_intake_id" uuid,
	"source_version_id" uuid,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"state" text NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"sha256" text NOT NULL,
	"duration_ms" numeric(20, 3),
	"verified_at" timestamp with time zone,
	"ready_version_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_owner_xor_ck" CHECK (num_nonnulls("media_assets"."record_id", "media_assets"."source_intake_id", "media_assets"."source_version_id") = 1),
	CONSTRAINT "media_assets_sha256_ck" CHECK ("media_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_assets_bytes_ck" CHECK ("media_assets"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_derivatives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"parent_view_id" uuid,
	"region" jsonb,
	"transform" jsonb,
	"stream_index" integer,
	"pts" numeric(20, 0),
	"timebase_numerator" integer,
	"timebase_denominator" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_intakes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_parts" (
	"asset_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"etag" text,
	"offset" bigint NOT NULL,
	"byte_length" bigint NOT NULL,
	CONSTRAINT "upload_parts_asset_id_part_number_pk" PRIMARY KEY("asset_id","part_number"),
	CONSTRAINT "upload_parts_length_ck" CHECK ("upload_parts"."byte_length" > 0 and "upload_parts"."offset" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"mode" text NOT NULL,
	"provider_upload_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anchor_components" (
	"anchor_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	CONSTRAINT "anchor_components_anchor_id_component_id_pk" PRIMARY KEY("anchor_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "check_anchors" (
	"check_id" uuid NOT NULL,
	"anchor_id" uuid NOT NULL,
	CONSTRAINT "check_anchors_check_id_anchor_id_pk" PRIMARY KEY("check_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "check_components" (
	"check_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	CONSTRAINT "check_components_check_id_component_id_pk" PRIMARY KEY("check_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "check_observations" (
	"check_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "check_observations_check_id_observation_id_pk" PRIMARY KEY("check_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_anchors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"canonical_view_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scope_kind" text NOT NULL,
	"region" jsonb,
	"crop_derivative_id" uuid,
	"frame_stream_index" integer,
	"frame_timebase_numerator" integer,
	"frame_timebase_denominator" integer,
	"frame_pts" text,
	"frame_derivative_id" uuid,
	"frame_display_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_anchor_scope_ck" CHECK (("evidence_anchors"."scope_kind" = 'whole' and "evidence_anchors"."region" is null) or ("evidence_anchors"."scope_kind" = 'region' and "evidence_anchors"."region" is not null))
);
--> statement-breakpoint
CREATE TABLE "observation_anchors" (
	"observation_id" uuid NOT NULL,
	"anchor_id" uuid NOT NULL,
	CONSTRAINT "observation_anchors_observation_id_anchor_id_pk" PRIMARY KEY("observation_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "observation_components" (
	"observation_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	CONSTRAINT "observation_components_observation_id_component_id_pk" PRIMARY KEY("observation_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"audio_asset_id" uuid,
	"transcription_id" uuid,
	"segment_id" uuid,
	"edit_draft_id" uuid,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"method_version_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"progress" text DEFAULT 'not_started' NOT NULL,
	"result_kind" text DEFAULT 'unrecorded' NOT NULL,
	"result_reason" text,
	"suggested_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_checks_reason_ck" CHECK (("record_checks"."result_kind" in ('undetermined', 'not_applicable') and nullif(trim("record_checks"."result_reason"), '') is not null) or ("record_checks"."result_kind" not in ('undetermined', 'not_applicable') and "record_checks"."result_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "idempotency_requests" (
	"owner_id" text NOT NULL,
	"operation" text NOT NULL,
	"key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_requests_owner_id_operation_key_pk" PRIMARY KEY("owner_id","operation","key")
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"job_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"result" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_steps_job_id_stage_key_pk" PRIMARY KEY("job_id","stage_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"state" text NOT NULL,
	"stage" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" jsonb,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"event_name" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"owner_id" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_completions" (
	"mapping_id" uuid PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"mapping_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "provider_job_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"correlation_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_counters" (
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sequence_counters_owner_id_kind_pk" PRIMARY KEY("owner_id","kind")
);
--> statement-breakpoint
CREATE TABLE "action_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"action_revision" integer NOT NULL,
	"record_revision" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"on_site_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_states" (
	"run_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"latest_resolution_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_states_run_id_action_id_pk" PRIMARY KEY("run_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "adoption_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"status" text NOT NULL,
	"record_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adoption_events_status_ck" CHECK ("adoption_events"."status" in ('accepted','skipped'))
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"retrieval_snapshot_id" uuid,
	"status" text NOT NULL,
	"requested_model_id" text,
	"effective_model_id" text,
	"profile_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"provider_version" text,
	"audit" jsonb,
	"raw_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analysis_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"record_revision" integer NOT NULL,
	"analysis_input_version" integer NOT NULL,
	"evidence_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_citations" (
	"claim_id" uuid NOT NULL,
	"citation_id" uuid NOT NULL,
	CONSTRAINT "claim_citations_claim_id_citation_id_pk" PRIMARY KEY("claim_id","citation_id")
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"claim_id" uuid NOT NULL,
	"anchor_id" uuid NOT NULL,
	CONSTRAINT "claim_evidence_claim_id_anchor_id_pk" PRIMARY KEY("claim_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "claim_observations" (
	"claim_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "claim_observations_claim_id_observation_id_pk" PRIMARY KEY("claim_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"relation" text NOT NULL,
	"certainty" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "next_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"instruction" text NOT NULL,
	"reason" text NOT NULL,
	"check_id" uuid
);
--> statement-breakpoint
CREATE TABLE "proposal_findings" (
	"proposal_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	CONSTRAINT "proposal_findings_proposal_id_claim_id_pk" PRIMARY KEY("proposal_id","claim_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_states" (
	"run_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"status" text NOT NULL,
	"latest_event_id" uuid,
	CONSTRAINT "proposal_states_run_id_proposal_id_pk" PRIMARY KEY("run_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before" jsonb NOT NULL,
	"proposed" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolution_checks" (
	"resolution_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	CONSTRAINT "resolution_checks_resolution_id_check_id_pk" PRIMARY KEY("resolution_id","check_id")
);
--> statement-breakpoint
CREATE TABLE "resolution_evidence" (
	"resolution_id" uuid NOT NULL,
	"anchor_id" uuid NOT NULL,
	CONSTRAINT "resolution_evidence_resolution_id_anchor_id_pk" PRIMARY KEY("resolution_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "resolution_observations" (
	"resolution_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "resolution_observations_resolution_id_observation_id_pk" PRIMARY KEY("resolution_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "resolution_references" (
	"resolution_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	CONSTRAINT "resolution_references_resolution_id_reference_id_pk" PRIMARY KEY("resolution_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "retrieval_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"index_version_id" uuid,
	"immutable_pack" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_suggested_methods" (
	"run_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"method_version_id" uuid NOT NULL,
	CONSTRAINT "run_suggested_methods_run_id_method_id_method_version_id_pk" PRIMARY KEY("run_id","method_id","method_version_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_assets" (
	"snapshot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "snapshot_assets_snapshot_id_asset_id_pk" PRIMARY KEY("snapshot_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_checks" (
	"snapshot_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	CONSTRAINT "snapshot_checks_snapshot_id_check_id_pk" PRIMARY KEY("snapshot_id","check_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_evidence" (
	"snapshot_id" uuid NOT NULL,
	"anchor_id" uuid NOT NULL,
	CONSTRAINT "snapshot_evidence_snapshot_id_anchor_id_pk" PRIMARY KEY("snapshot_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "snapshot_observations" (
	"snapshot_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "snapshot_observations_snapshot_id_observation_id_pk" PRIMARY KEY("snapshot_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"locator_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"availability" text NOT NULL,
	"verification" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_index_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"index_id" uuid NOT NULL,
	"reference_image_id" uuid,
	"original_asset_id" uuid,
	"derivative_id" uuid NOT NULL,
	CONSTRAINT "image_index_items_target_ck" CHECK (num_nonnulls("image_index_items"."reference_image_id", "image_index_items"."original_asset_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "index_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"embedding_model_id" text NOT NULL,
	"dimensions" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owning_entry_id" uuid NOT NULL,
	"current_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"display_code" text NOT NULL,
	"current_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_revision_aliases" (
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "knowledge_revision_aliases_entry_id_revision_alias_pk" PRIMARY KEY("entry_id","revision","alias")
);
--> statement-breakpoint
CREATE TABLE "knowledge_revision_citations" (
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"citation_id" uuid NOT NULL,
	CONSTRAINT "knowledge_revision_citations_entry_id_revision_citation_id_pk" PRIMARY KEY("entry_id","revision","citation_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_revision_kinds" (
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "knowledge_revision_kinds_entry_id_revision_kind_pk" PRIMARY KEY("entry_id","revision","kind")
);
--> statement-breakpoint
CREATE TABLE "knowledge_revision_methods" (
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"method_id" uuid NOT NULL,
	"method_version_id" uuid NOT NULL,
	CONSTRAINT "knowledge_revision_methods_entry_id_revision_method_id_pk" PRIMARY KEY("entry_id","revision","method_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_revisions" (
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"saved_by" text,
	"title_zh_hant" text NOT NULL,
	"summary_zh_hant" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_revisions_entry_id_revision_pk" PRIMARY KEY("entry_id","revision")
);
--> statement-breakpoint
CREATE TABLE "mapping_regions" (
	"mapping_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	CONSTRAINT "mapping_regions_mapping_id_region_id_pk" PRIMARY KEY("mapping_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "method_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"method_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_citations" (
	"note_id" uuid NOT NULL,
	"citation_id" uuid NOT NULL,
	CONSTRAINT "note_citations_note_id_citation_id_pk" PRIMARY KEY("note_id","citation_id")
);
--> statement-breakpoint
CREATE TABLE "note_paragraphs" (
	"note_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "note_paragraphs_note_id_ordinal_pk" PRIMARY KEY("note_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"research_id" uuid NOT NULL,
	"draft_revision" integer NOT NULL,
	"title" text NOT NULL,
	"record_id" uuid,
	"entry_id" uuid,
	"saved_by" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parse_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_version_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"raw_output_asset_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_version_id" uuid NOT NULL,
	"locator_id" uuid NOT NULL,
	"figure_region_id" uuid,
	"stored_derivative_id" uuid,
	"external_image_url" text,
	"caption_text" text,
	"caption_locator_id" uuid,
	"generated_description_zh_hant" text,
	"description_job_id" uuid,
	"caption_association" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"target_record_id" uuid NOT NULL,
	"target_check_id" uuid,
	"target_observation_id" uuid,
	"target_anchor_id" uuid,
	"subject_kind" text NOT NULL,
	"source_locator_id" uuid,
	"reference_image_id" uuid,
	"subject_record_id" uuid,
	"original_asset_id" uuid,
	"subject_anchor_id" uuid,
	"comparison_id" uuid,
	"note" text,
	"target_identity_key" text NOT NULL,
	"subject_identity_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_relations" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "region_relations_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "research_draft_revisions" (
	"research_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"immutable_content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_draft_revisions_research_id_revision_pk" PRIMARY KEY("research_id","revision")
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"record_id" uuid,
	"entry_id" uuid,
	"instruction" text NOT NULL,
	"scope" text NOT NULL,
	"prefer_named_authors" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"research_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	CONSTRAINT "research_sources_research_id_source_version_id_pk" PRIMARY KEY("research_id","source_version_id")
);
--> statement-breakpoint
CREATE TABLE "source_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"search_mapping" jsonb NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunk_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"index_id" uuid NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"provider_chunk_id" text NOT NULL,
	"provider_figure_id" text,
	"source_version_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_contributors" (
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"name_as_printed" text NOT NULL,
	"role" text NOT NULL,
	"attribution" text NOT NULL,
	CONSTRAINT "source_contributors_source_id_ordinal_pk" PRIMARY KEY("source_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "source_index_memberships" (
	"index_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "source_index_memberships_index_id_source_version_id_pk" PRIMARY KEY("index_id","source_version_id")
);
--> statement-breakpoint
CREATE TABLE "source_languages" (
	"source_id" uuid NOT NULL,
	"language" text NOT NULL,
	CONSTRAINT "source_languages_source_id_language_pk" PRIMARY KEY("source_id","language")
);
--> statement-breakpoint
CREATE TABLE "source_locators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"page_id" uuid,
	"page_index" integer,
	"printed_page_label" text,
	"canonical_view_id" uuid,
	"region_id" uuid,
	"geometry" jsonb,
	"block_id" uuid,
	"range_start" integer,
	"range_end" integer,
	"url" text,
	"retrieved_at" timestamp with time zone,
	"snapshot_asset_id" uuid,
	"excerpt_as_retrieved" text,
	CONSTRAINT "source_locators_branch_ck" CHECK (("source_locators"."kind" = 'page' and "source_locators"."page_id" is not null and "source_locators"."canonical_view_id" is not null and "source_locators"."url" is null) or ("source_locators"."kind" = 'web' and "source_locators"."url" is not null and "source_locators"."retrieved_at" is not null and "source_locators"."page_id" is null)),
	CONSTRAINT "source_locators_range_ck" CHECK (("source_locators"."range_start" is null and "source_locators"."range_end" is null) or ("source_locators"."block_id" is not null and "source_locators"."range_start" >= 0 and "source_locators"."range_end" > "source_locators"."range_start"))
);
--> statement-breakpoint
CREATE TABLE "source_page_parses" (
	"parse_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"search_text" text NOT NULL,
	"quality" text NOT NULL,
	CONSTRAINT "source_page_parses_parse_run_id_page_id_pk" PRIMARY KEY("parse_run_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "source_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_version_id" uuid NOT NULL,
	"page_index" integer NOT NULL,
	"printed_page_label" text,
	"original_asset_id" uuid NOT NULL,
	"pdf_page_index" integer,
	"canonical_view_id" uuid NOT NULL,
	CONSTRAINT "source_pages_index_ck" CHECK ("source_pages"."page_index" >= 0 and ("source_pages"."pdf_page_index" is null or "source_pages"."pdf_page_index" >= 0))
);
--> statement-breakpoint
CREATE TABLE "source_regions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_version_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"parse_run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"geometry" jsonb NOT NULL,
	"raw_text" text
);
--> statement-breakpoint
CREATE TABLE "source_version_assets" (
	"version_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"printed_label" text,
	CONSTRAINT "source_version_assets_version_id_asset_id_pk" PRIMARY KEY("version_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "source_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"metadata_snapshot" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone,
	"status" text NOT NULL,
	"text_index_status" text NOT NULL,
	"image_index_status" text NOT NULL,
	"active_parse_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"current_version_id" uuid,
	"title" text NOT NULL,
	"author_status" text NOT NULL,
	"edition_statement" text,
	"publisher" text,
	"publication_date_as_printed" text,
	"isbn" text,
	"canonical_url" text,
	"access" text NOT NULL,
	"rights_statement" text,
	"attribution_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_acquisitions" ADD CONSTRAINT "record_acquisitions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_categories" ADD CONSTRAINT "record_categories_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_components" ADD CONSTRAINT "record_components_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_materials" ADD CONSTRAINT "record_materials_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_measurements" ADD CONSTRAINT "record_measurements_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_measurements" ADD CONSTRAINT "record_measurements_component_id_record_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."record_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_receipts" ADD CONSTRAINT "record_receipts_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_views" ADD CONSTRAINT "canonical_views_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_views" ADD CONSTRAINT "canonical_views_derivative_id_media_derivatives_id_fk" FOREIGN KEY ("derivative_id") REFERENCES "public"."media_derivatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_components" ADD CONSTRAINT "media_asset_components_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_components" ADD CONSTRAINT "media_asset_components_component_id_record_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."record_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_intake_id_source_intakes_id_fk" FOREIGN KEY ("source_intake_id") REFERENCES "public"."source_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivatives" ADD CONSTRAINT "media_derivatives_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_components" ADD CONSTRAINT "anchor_components_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_components" ADD CONSTRAINT "anchor_components_component_id_record_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."record_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_anchors" ADD CONSTRAINT "check_anchors_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_anchors" ADD CONSTRAINT "check_anchors_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_components" ADD CONSTRAINT "check_components_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_components" ADD CONSTRAINT "check_components_component_id_record_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."record_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_observations" ADD CONSTRAINT "check_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_canonical_view_id_canonical_views_id_fk" FOREIGN KEY ("canonical_view_id") REFERENCES "public"."canonical_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_crop_derivative_id_media_derivatives_id_fk" FOREIGN KEY ("crop_derivative_id") REFERENCES "public"."media_derivatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_anchors" ADD CONSTRAINT "evidence_anchors_frame_derivative_id_media_derivatives_id_fk" FOREIGN KEY ("frame_derivative_id") REFERENCES "public"."media_derivatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_anchors" ADD CONSTRAINT "observation_anchors_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_anchors" ADD CONSTRAINT "observation_anchors_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_components" ADD CONSTRAINT "observation_components_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_components" ADD CONSTRAINT "observation_components_component_id_record_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."record_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_audio_asset_id_media_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_checks" ADD CONSTRAINT "record_checks_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_completions" ADD CONSTRAINT "provider_completions_mapping_id_provider_job_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."provider_job_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_mapping_id_provider_job_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."provider_job_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_job_mappings" ADD CONSTRAINT "provider_job_mappings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_resolutions" ADD CONSTRAINT "action_resolutions_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_resolutions" ADD CONSTRAINT "action_resolutions_action_id_next_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."next_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_states" ADD CONSTRAINT "action_states_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_states" ADD CONSTRAINT "action_states_action_id_next_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."next_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_states" ADD CONSTRAINT "action_states_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_events" ADD CONSTRAINT "adoption_events_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_events" ADD CONSTRAINT "adoption_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_retrieval_snapshot_id_retrieval_snapshots_id_fk" FOREIGN KEY ("retrieval_snapshot_id") REFERENCES "public"."retrieval_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_observations" ADD CONSTRAINT "claim_observations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_observations" ADD CONSTRAINT "claim_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_actions" ADD CONSTRAINT "next_actions_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_actions" ADD CONSTRAINT "next_actions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_actions" ADD CONSTRAINT "next_actions_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_findings" ADD CONSTRAINT "proposal_findings_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_findings" ADD CONSTRAINT "proposal_findings_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_states" ADD CONSTRAINT "proposal_states_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_states" ADD CONSTRAINT "proposal_states_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_checks" ADD CONSTRAINT "resolution_checks_resolution_id_action_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."action_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_checks" ADD CONSTRAINT "resolution_checks_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_resolution_id_action_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."action_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_observations" ADD CONSTRAINT "resolution_observations_resolution_id_action_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."action_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_observations" ADD CONSTRAINT "resolution_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_references" ADD CONSTRAINT "resolution_references_resolution_id_action_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."action_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_suggested_methods" ADD CONSTRAINT "run_suggested_methods_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_assets" ADD CONSTRAINT "snapshot_assets_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_assets" ADD CONSTRAINT "snapshot_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_checks" ADD CONSTRAINT "snapshot_checks_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_checks" ADD CONSTRAINT "snapshot_checks_check_id_record_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."record_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_evidence" ADD CONSTRAINT "snapshot_evidence_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_evidence" ADD CONSTRAINT "snapshot_evidence_anchor_id_evidence_anchors_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."evidence_anchors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_observations" ADD CONSTRAINT "snapshot_observations_snapshot_id_analysis_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."analysis_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_observations" ADD CONSTRAINT "snapshot_observations_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_locator_id_source_locators_id_fk" FOREIGN KEY ("locator_id") REFERENCES "public"."source_locators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_index_items" ADD CONSTRAINT "image_index_items_index_id_index_versions_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_index_items" ADD CONSTRAINT "image_index_items_reference_image_id_reference_images_id_fk" FOREIGN KEY ("reference_image_id") REFERENCES "public"."reference_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_index_items" ADD CONSTRAINT "image_index_items_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_index_items" ADD CONSTRAINT "image_index_items_derivative_id_media_derivatives_id_fk" FOREIGN KEY ("derivative_id") REFERENCES "public"."media_derivatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_methods" ADD CONSTRAINT "inspection_methods_owning_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("owning_entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_aliases" ADD CONSTRAINT "knowledge_revision_aliases_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_citations" ADD CONSTRAINT "knowledge_revision_citations_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_citations" ADD CONSTRAINT "knowledge_revision_citations_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_kinds" ADD CONSTRAINT "knowledge_revision_kinds_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_methods" ADD CONSTRAINT "knowledge_revision_methods_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_methods" ADD CONSTRAINT "knowledge_revision_methods_method_id_inspection_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."inspection_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision_methods" ADD CONSTRAINT "knowledge_revision_methods_method_version_id_method_versions_id_fk" FOREIGN KEY ("method_version_id") REFERENCES "public"."method_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revisions" ADD CONSTRAINT "knowledge_revisions_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_regions" ADD CONSTRAINT "mapping_regions_mapping_id_source_chunk_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."source_chunk_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_regions" ADD CONSTRAINT "mapping_regions_region_id_source_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."source_regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_versions" ADD CONSTRAINT "method_versions_method_id_inspection_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."inspection_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_citations" ADD CONSTRAINT "note_citations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_citations" ADD CONSTRAINT "note_citations_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_paragraphs" ADD CONSTRAINT "note_paragraphs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_research_id_research_runs_id_fk" FOREIGN KEY ("research_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD CONSTRAINT "parse_runs_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD CONSTRAINT "parse_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_runs" ADD CONSTRAINT "parse_runs_raw_output_asset_id_media_assets_id_fk" FOREIGN KEY ("raw_output_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_locator_id_source_locators_id_fk" FOREIGN KEY ("locator_id") REFERENCES "public"."source_locators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_figure_region_id_source_regions_id_fk" FOREIGN KEY ("figure_region_id") REFERENCES "public"."source_regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_stored_derivative_id_media_derivatives_id_fk" FOREIGN KEY ("stored_derivative_id") REFERENCES "public"."media_derivatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_caption_locator_id_source_locators_id_fk" FOREIGN KEY ("caption_locator_id") REFERENCES "public"."source_locators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_description_job_id_jobs_id_fk" FOREIGN KEY ("description_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_target_record_id_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_source_locator_id_source_locators_id_fk" FOREIGN KEY ("source_locator_id") REFERENCES "public"."source_locators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_reference_image_id_reference_images_id_fk" FOREIGN KEY ("reference_image_id") REFERENCES "public"."reference_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_subject_record_id_records_id_fk" FOREIGN KEY ("subject_record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_links" ADD CONSTRAINT "reference_links_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_relations" ADD CONSTRAINT "region_relations_from_id_source_regions_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."source_regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_relations" ADD CONSTRAINT "region_relations_to_id_source_regions_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."source_regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_draft_revisions" ADD CONSTRAINT "research_draft_revisions_research_id_research_runs_id_fk" FOREIGN KEY ("research_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_entry_id_knowledge_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_research_id_research_runs_id_fk" FOREIGN KEY ("research_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunk_mappings" ADD CONSTRAINT "source_chunk_mappings_index_id_index_versions_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunk_mappings" ADD CONSTRAINT "source_chunk_mappings_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunk_mappings" ADD CONSTRAINT "source_chunk_mappings_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_contributors" ADD CONSTRAINT "source_contributors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_index_memberships" ADD CONSTRAINT "source_index_memberships_index_id_index_versions_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_index_memberships" ADD CONSTRAINT "source_index_memberships_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_languages" ADD CONSTRAINT "source_languages_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_canonical_view_id_canonical_views_id_fk" FOREIGN KEY ("canonical_view_id") REFERENCES "public"."canonical_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_region_id_source_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."source_regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_block_id_source_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_locators" ADD CONSTRAINT "source_locators_snapshot_asset_id_media_assets_id_fk" FOREIGN KEY ("snapshot_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_page_parses" ADD CONSTRAINT "source_page_parses_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_page_parses" ADD CONSTRAINT "source_page_parses_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_original_asset_id_media_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_canonical_view_id_canonical_views_id_fk" FOREIGN KEY ("canonical_view_id") REFERENCES "public"."canonical_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_regions" ADD CONSTRAINT "source_regions_source_version_id_source_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_regions" ADD CONSTRAINT "source_regions_page_id_source_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."source_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_regions" ADD CONSTRAINT "source_regions_parse_run_id_parse_runs_id_fk" FOREIGN KEY ("parse_run_id") REFERENCES "public"."parse_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_version_assets" ADD CONSTRAINT "source_version_assets_version_id_source_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."source_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_version_assets" ADD CONSTRAINT "source_version_assets_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_send_cooldown_phone_uq" ON "otp_send_cooldown" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_owner_label_uq" ON "locations" USING btree ("owner_id","normalized_label");--> statement-breakpoint
CREATE INDEX "record_categories_category_idx" ON "record_categories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_components_record_ordinal_uq" ON "record_components" USING btree ("record_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "record_components_record_id_uq" ON "record_components" USING btree ("record_id","id");--> statement-breakpoint
CREATE INDEX "record_materials_material_idx" ON "record_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "record_tags_tag_idx" ON "record_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "records_owner_code_uq" ON "records" USING btree ("owner_id","code");--> statement-breakpoint
CREATE INDEX "records_owner_updated_idx" ON "records" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "records_owner_name_idx" ON "records" USING btree ("owner_id","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_views_derivative_uq" ON "canonical_views" USING btree ("derivative_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_object_key_uq" ON "media_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_assets_record_idx" ON "media_assets" USING btree ("owner_id","record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_derivatives_key_uq" ON "media_derivatives" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_derivatives_original_idx" ON "media_derivatives" USING btree ("original_asset_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_owner_request_uq" ON "upload_sessions" USING btree ("owner_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_anchors_owner_record_id_uq" ON "evidence_anchors" USING btree ("owner_id","record_id","id");--> statement-breakpoint
CREATE INDEX "evidence_anchors_record_idx" ON "evidence_anchors" USING btree ("owner_id","record_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_owner_record_id_uq" ON "observations" USING btree ("owner_id","record_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_supersedes_uq" ON "observations" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_superseded_by_uq" ON "observations" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "observations_current_idx" ON "observations" USING btree ("owner_id","record_id","created_at","id") WHERE "observations"."superseded_by_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_checks_scope_uq" ON "record_checks" USING btree ("record_id","method_version_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "record_checks_owner_record_id_uq" ON "record_checks" USING btree ("owner_id","record_id","id");--> statement-breakpoint
CREATE INDEX "record_checks_owner_progress_idx" ON "record_checks" USING btree ("owner_id","progress","created_at","id");--> statement-breakpoint
CREATE INDEX "job_steps_claim_idx" ON "job_steps" USING btree ("state","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_owner_id_uq" ON "jobs" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "jobs_owner_state_idx" ON "jobs" USING btree ("owner_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_uq" ON "outbox" USING btree ("event_name","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","event_id") WHERE "outbox"."delivered_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_job_mappings_provider_job_uq" ON "provider_job_mappings" USING btree ("provider","provider_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_job_mappings_token_uq" ON "provider_job_mappings" USING btree ("correlation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "action_resolutions_revision_uq" ON "action_resolutions" USING btree ("run_id","action_id","action_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_events_proposal_uq" ON "adoption_events" USING btree ("run_id","proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_job_uq" ON "analysis_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "analysis_runs_record_idx" ON "analysis_runs" USING btree ("owner_id","record_id","created_at","id");--> statement-breakpoint
CREATE INDEX "analysis_snapshots_record_idx" ON "analysis_snapshots" USING btree ("owner_id","record_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_run_id_uq" ON "claims" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "next_actions_run_id_uq" ON "next_actions" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_run_id_uq" ON "proposals" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "citations_locator_idx" ON "citations" USING btree ("locator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_owner_id_uq" ON "knowledge_entries" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_owner_code_uq" ON "knowledge_entries" USING btree ("owner_id","display_code");--> statement-breakpoint
CREATE INDEX "knowledge_revision_kinds_kind_idx" ON "knowledge_revision_kinds" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "knowledge_revisions_title_idx" ON "knowledge_revisions" USING btree ("title_zh_hant");--> statement-breakpoint
CREATE UNIQUE INDEX "method_versions_method_revision_uq" ON "method_versions" USING btree ("method_id","revision");--> statement-breakpoint
CREATE INDEX "reference_images_version_idx" ON "reference_images" USING btree ("source_version_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_links_identity_uq" ON "reference_links" USING btree ("owner_id","target_identity_key","subject_identity_key");--> statement-breakpoint
CREATE INDEX "reference_links_record_idx" ON "reference_links" USING btree ("owner_id","target_record_id","created_at","id");--> statement-breakpoint
CREATE INDEX "source_blocks_page_idx" ON "source_blocks" USING btree ("parse_run_id","page_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "source_chunk_mappings_provider_uq" ON "source_chunk_mappings" USING btree ("provider","index_id","provider_chunk_id");--> statement-breakpoint
CREATE INDEX "source_locators_version_idx" ON "source_locators" USING btree ("source_version_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "source_pages_version_index_uq" ON "source_pages" USING btree ("source_version_id","page_index");--> statement-breakpoint
CREATE UNIQUE INDEX "source_pages_version_id_uq" ON "source_pages" USING btree ("source_version_id","id");--> statement-breakpoint
CREATE INDEX "source_regions_page_idx" ON "source_regions" USING btree ("page_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "source_version_assets_ordinal_uq" ON "source_version_assets" USING btree ("version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "source_version_assets_asset_uq" ON "source_version_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_versions_owner_hash_uq" ON "source_versions" USING btree ("owner_id","source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "source_versions_source_id_uq" ON "source_versions" USING btree ("source_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_owner_id_uq" ON "sources" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "sources_owner_title_idx" ON "sources" USING btree ("owner_id","title","id");