-- PostgreSQL baseline matching main migrations 0000–0008.
-- CHECK constraints and all index predicates are retained as native SQL.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path = public;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.action_resolutions (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    action_id uuid NOT NULL,
    action_revision integer NOT NULL,
    record_revision integer NOT NULL,
    status text NOT NULL,
    reason text,
    on_site_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.action_states (
    run_id uuid NOT NULL,
    action_id uuid NOT NULL,
    record_id uuid NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    latest_resolution_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.adoption_events (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    status text NOT NULL,
    record_revision integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT adoption_events_status_ck CHECK ((status = ANY (ARRAY['accepted'::text, 'skipped'::text])))
);



CREATE TABLE public.analysis_runs (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid NOT NULL,
    job_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    retrieval_snapshot_id uuid,
    status text NOT NULL,
    requested_model_id text,
    effective_model_id text,
    profile_version text NOT NULL,
    prompt_version text NOT NULL,
    schema_version text NOT NULL,
    provider_version text,
    audit jsonb,
    raw_output jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    model_selection jsonb NOT NULL,
    input jsonb,
    failure_audits jsonb DEFAULT '[]'::jsonb NOT NULL
);



CREATE TABLE public.analysis_snapshots (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid NOT NULL,
    record_revision integer NOT NULL,
    analysis_input_version integer NOT NULL,
    evidence_version integer NOT NULL,
    content jsonb NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.anchor_components (
    anchor_id uuid NOT NULL,
    component_id uuid NOT NULL
);



CREATE TABLE public.canonical_views (
    id uuid NOT NULL,
    original_asset_id uuid NOT NULL,
    derivative_id uuid,
    width integer NOT NULL,
    height integer NOT NULL,
    coordinate_space text NOT NULL,
    transform_to_original jsonb NOT NULL,
    CONSTRAINT canonical_views_dimensions_ck CHECK (((width > 0) AND (height > 0)))
);



CREATE TABLE public.check_anchors (
    check_id uuid NOT NULL,
    anchor_id uuid NOT NULL
);



CREATE TABLE public.check_components (
    check_id uuid NOT NULL,
    component_id uuid NOT NULL
);



CREATE TABLE public.check_observations (
    check_id uuid NOT NULL,
    observation_id uuid NOT NULL
);



CREATE TABLE public.citations (
    id uuid NOT NULL,
    locator_id uuid NOT NULL,
    relation text NOT NULL,
    availability text NOT NULL,
    verification text NOT NULL
);



CREATE TABLE public.claim_citations (
    claim_id uuid NOT NULL,
    citation_id uuid NOT NULL
);



CREATE TABLE public.claim_evidence (
    claim_id uuid NOT NULL,
    anchor_id uuid NOT NULL
);



CREATE TABLE public.claim_observations (
    claim_id uuid NOT NULL,
    observation_id uuid NOT NULL
);



CREATE TABLE public.claims (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    kind text NOT NULL,
    text text NOT NULL,
    relation text NOT NULL,
    certainty text NOT NULL
);



CREATE TABLE public.comparison_failures (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    query jsonb NOT NULL,
    error jsonb NOT NULL,
    audit jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.comparison_results (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    value jsonb NOT NULL,
    invocation jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.edit_draft_runs (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    job_id uuid NOT NULL,
    record_id uuid NOT NULL,
    revision integer NOT NULL,
    status text NOT NULL,
    snapshot jsonb NOT NULL,
    request jsonb NOT NULL,
    model_selection jsonb NOT NULL,
    result jsonb,
    invocation jsonb,
    applied_proposal_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT edit_draft_runs_status_ck CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'partially_applied'::text, 'applied'::text])))
);



CREATE TABLE public.evidence_anchors (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid NOT NULL,
    original_asset_id uuid NOT NULL,
    canonical_view_id uuid NOT NULL,
    kind text NOT NULL,
    scope_kind text NOT NULL,
    region jsonb,
    crop_derivative_id uuid,
    frame_stream_index integer,
    frame_timebase_numerator integer,
    frame_timebase_denominator integer,
    frame_pts text,
    frame_derivative_id uuid,
    frame_display_time_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_anchor_scope_ck CHECK ((((scope_kind = 'whole'::text) AND (region IS NULL)) OR ((scope_kind = 'region'::text) AND (region IS NOT NULL))))
);



CREATE TABLE public.idempotency_requests (
    owner_id text NOT NULL,
    operation text NOT NULL,
    key uuid NOT NULL,
    fingerprint text NOT NULL,
    status text NOT NULL,
    response_status integer,
    response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.image_index_items (
    id uuid NOT NULL,
    index_id uuid NOT NULL,
    reference_image_id uuid,
    original_asset_id uuid,
    derivative_id uuid NOT NULL,
    CONSTRAINT image_index_items_target_ck CHECK ((num_nonnulls(reference_image_id, original_asset_id) = 1))
);



CREATE TABLE public.index_versions (
    id uuid NOT NULL,
    kind text NOT NULL,
    embedding_model_id text NOT NULL,
    dimensions integer NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.inspection_methods (
    id uuid NOT NULL,
    owning_entry_id uuid NOT NULL,
    current_version_id uuid
);



CREATE TABLE public.job_steps (
    job_id uuid NOT NULL,
    stage_key text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    state text NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    attempt integer DEFAULT 0 NOT NULL,
    checkpoint jsonb,
    result jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.jobs (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    resource_id uuid NOT NULL,
    state text NOT NULL,
    stage text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error jsonb,
    result jsonb
);



CREATE TABLE public.knowledge_entries (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    display_code text NOT NULL,
    current_revision integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.knowledge_revision_aliases (
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    alias text NOT NULL
);



CREATE TABLE public.knowledge_revision_citations (
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    citation_id uuid NOT NULL
);



CREATE TABLE public.knowledge_revision_kinds (
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    kind text NOT NULL
);



CREATE TABLE public.knowledge_revision_methods (
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    method_id uuid NOT NULL,
    method_version_id uuid NOT NULL
);



CREATE TABLE public.knowledge_revisions (
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    status text NOT NULL,
    saved_by text,
    title_zh_hant text NOT NULL,
    summary_zh_hant text NOT NULL,
    content jsonb NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.locations (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    label text NOT NULL,
    normalized_label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.mapping_regions (
    mapping_id uuid NOT NULL,
    region_id uuid NOT NULL
);



CREATE TABLE public.media_asset_components (
    asset_id uuid NOT NULL,
    component_id uuid NOT NULL
);



CREATE TABLE public.media_assets (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid,
    source_intake_id uuid,
    source_version_id uuid,
    kind text NOT NULL,
    purpose text NOT NULL,
    state text NOT NULL,
    object_key text NOT NULL,
    original_file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_length bigint NOT NULL,
    sha256 text NOT NULL,
    duration_ms numeric(20,3),
    verified_at timestamp with time zone,
    ready_version_applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_assets_bytes_ck CHECK ((byte_length > 0)),
    CONSTRAINT media_assets_owner_xor_ck CHECK ((num_nonnulls(record_id, source_intake_id, source_version_id) = 1)),
    CONSTRAINT media_assets_sha256_ck CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);



CREATE TABLE public.media_derivatives (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    original_asset_id uuid NOT NULL,
    kind text NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    byte_length bigint NOT NULL,
    sha256 text NOT NULL,
    width integer,
    height integer,
    parent_view_id uuid,
    region jsonb,
    transform jsonb,
    stream_index integer,
    pts numeric(20,0),
    timebase_numerator integer,
    timebase_denominator integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_derivative_id uuid,
    display_time_ms numeric(20,3)
);



CREATE TABLE public.method_versions (
    id uuid NOT NULL,
    method_id uuid NOT NULL,
    revision integer NOT NULL,
    definition jsonb NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.next_actions (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    record_id uuid NOT NULL,
    kind text NOT NULL,
    instruction text NOT NULL,
    reason text NOT NULL,
    check_id uuid
);



CREATE TABLE public.note_citations (
    note_id uuid NOT NULL,
    citation_id uuid NOT NULL
);



CREATE TABLE public.note_paragraphs (
    note_id uuid NOT NULL,
    ordinal integer NOT NULL,
    text text NOT NULL,
    content jsonb
);



CREATE TABLE public.notes (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    research_id uuid NOT NULL,
    draft_revision integer NOT NULL,
    title text NOT NULL,
    record_id uuid,
    entry_id uuid,
    saved_by text NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.observation_anchors (
    observation_id uuid NOT NULL,
    anchor_id uuid NOT NULL
);



CREATE TABLE public.observation_components (
    observation_id uuid NOT NULL,
    component_id uuid NOT NULL
);



CREATE TABLE public.observations (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid NOT NULL,
    channel text NOT NULL,
    text text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    audio_asset_id uuid,
    transcription_id uuid,
    segment_id uuid,
    edit_draft_id uuid,
    supersedes_id uuid,
    superseded_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.otp_send_cooldown (
    phone_number text NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.outbox (
    event_id uuid NOT NULL,
    job_id uuid,
    event_name text NOT NULL,
    schema_version text NOT NULL,
    owner_id text NOT NULL,
    resource_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.parse_runs (
    id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    job_id uuid NOT NULL,
    provider text NOT NULL,
    raw_output_asset_id uuid,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.proposal_findings (
    proposal_id uuid NOT NULL,
    claim_id uuid NOT NULL
);



CREATE TABLE public.proposal_states (
    run_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    status text NOT NULL,
    latest_event_id uuid
);



CREATE TABLE public.proposals (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    field text NOT NULL,
    before jsonb NOT NULL,
    proposed jsonb NOT NULL
);



CREATE TABLE public.provider_completions (
    mapping_id uuid NOT NULL,
    result jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.provider_events (
    provider text NOT NULL,
    event_id text NOT NULL,
    mapping_id uuid NOT NULL,
    payload_hash text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.provider_job_mappings (
    id uuid NOT NULL,
    provider text NOT NULL,
    provider_job_id text NOT NULL,
    job_id uuid NOT NULL,
    stage_key text NOT NULL,
    correlation_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.provider_webhook_inbox (
    provider text NOT NULL,
    event_id text NOT NULL,
    provider_job_id text NOT NULL,
    event_type text NOT NULL,
    signed_at timestamp with time zone NOT NULL,
    payload_hash text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone
);



CREATE TABLE public.record_acquisitions (
    record_id uuid NOT NULL,
    acquired_on text,
    seller text,
    method text,
    amount numeric(18,2),
    currency text,
    provenance_note text,
    CONSTRAINT record_acquisitions_amount_currency_ck CHECK (((amount IS NULL) = (currency IS NULL)))
);



CREATE TABLE public.record_categories (
    record_id uuid NOT NULL,
    category_id uuid NOT NULL
);



CREATE TABLE public.record_checks (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    record_id uuid NOT NULL,
    method_id uuid NOT NULL,
    method_version_id uuid NOT NULL,
    scope_key text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    progress text DEFAULT 'not_started'::text NOT NULL,
    result_kind text DEFAULT 'unrecorded'::text NOT NULL,
    result_reason text,
    suggested_by_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT record_checks_reason_ck CHECK ((((result_kind = ANY (ARRAY['undetermined'::text, 'not_applicable'::text])) AND (NULLIF(TRIM(BOTH FROM result_reason), ''::text) IS NOT NULL)) OR ((result_kind <> ALL (ARRAY['undetermined'::text, 'not_applicable'::text])) AND (result_reason IS NULL))))
);



CREATE TABLE public.record_components (
    id uuid NOT NULL,
    record_id uuid NOT NULL,
    owner_id text NOT NULL,
    label text NOT NULL,
    ordinal integer NOT NULL
);



CREATE TABLE public.record_materials (
    record_id uuid NOT NULL,
    material_id uuid NOT NULL
);



CREATE TABLE public.record_measurements (
    record_id uuid NOT NULL,
    kind text NOT NULL,
    component_id uuid,
    value numeric(18,6) NOT NULL,
    unit text NOT NULL,
    CONSTRAINT record_measurements_unit_ck CHECK ((((kind = 'weight'::text) AND (unit = ANY (ARRAY['g'::text, 'kg'::text]))) OR ((kind = ANY (ARRAY['height'::text, 'width'::text, 'depth'::text, 'diameter'::text])) AND (unit = ANY (ARRAY['mm'::text, 'cm'::text, 'm'::text]))))),
    CONSTRAINT record_measurements_value_ck CHECK ((value > (0)::numeric))
);



CREATE TABLE public.record_receipts (
    record_id uuid NOT NULL,
    asset_id uuid NOT NULL
);



CREATE TABLE public.record_tags (
    record_id uuid NOT NULL,
    tag text NOT NULL
);



CREATE TABLE public.records (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    code text NOT NULL,
    name text,
    unit_kind text NOT NULL,
    piece_count integer,
    period_label text,
    period_from_year integer,
    period_to_year integer,
    period_status text,
    location_id uuid,
    location_detail text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    collector_judgment text,
    record_revision integer DEFAULT 1 NOT NULL,
    analysis_input_version integer DEFAULT 1 NOT NULL,
    evidence_version integer DEFAULT 1 NOT NULL,
    latest_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT records_period_year_ck CHECK (((period_from_year IS NULL) OR (period_to_year IS NULL) OR (period_from_year <= period_to_year))),
    CONSTRAINT records_piece_count_ck CHECK (((piece_count IS NULL) OR (piece_count > 0))),
    CONSTRAINT records_unit_kind_ck CHECK ((unit_kind = ANY (ARRAY['single'::text, 'set'::text])))
);



CREATE TABLE public.reference_images (
    id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    locator_id uuid NOT NULL,
    figure_region_id uuid,
    stored_derivative_id uuid,
    external_image_url text,
    caption_text text,
    caption_locator_id uuid,
    generated_description_zh_hant text,
    description_job_id uuid,
    caption_association text NOT NULL
);



CREATE TABLE public.reference_links (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    target_record_id uuid NOT NULL,
    target_check_id uuid,
    target_observation_id uuid,
    target_anchor_id uuid,
    subject_kind text NOT NULL,
    source_locator_id uuid,
    reference_image_id uuid,
    subject_record_id uuid,
    original_asset_id uuid,
    subject_anchor_id uuid,
    comparison_id uuid,
    note text,
    target_identity_key text NOT NULL,
    subject_identity_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    versions jsonb
);



CREATE TABLE public.region_relations (
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    kind text NOT NULL
);



CREATE TABLE public.research_draft_revisions (
    research_id uuid NOT NULL,
    revision integer NOT NULL,
    immutable_content jsonb NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.research_runs (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    job_id uuid NOT NULL,
    record_id uuid,
    entry_id uuid,
    instruction text NOT NULL,
    scope text NOT NULL,
    prefer_named_authors text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_key uuid NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL
);



CREATE TABLE public.research_sources (
    research_id uuid NOT NULL,
    source_version_id uuid NOT NULL
);



CREATE TABLE public.resolution_checks (
    resolution_id uuid NOT NULL,
    check_id uuid NOT NULL
);



CREATE TABLE public.resolution_evidence (
    resolution_id uuid NOT NULL,
    anchor_id uuid NOT NULL
);



CREATE TABLE public.resolution_observations (
    resolution_id uuid NOT NULL,
    observation_id uuid NOT NULL
);



CREATE TABLE public.resolution_references (
    resolution_id uuid NOT NULL,
    reference_id uuid NOT NULL
);



CREATE TABLE public.retrieval_snapshots (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    index_version_id uuid,
    immutable_pack jsonb NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.run_suggested_methods (
    run_id uuid NOT NULL,
    method_id uuid NOT NULL,
    method_version_id uuid NOT NULL,
    owning_entry_id uuid NOT NULL,
    title_zh_hant text NOT NULL
);



CREATE TABLE public.sequence_counters (
    owner_id text NOT NULL,
    kind text NOT NULL,
    next_value integer DEFAULT 1 NOT NULL
);



CREATE TABLE public.session (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL
);



CREATE TABLE public.snapshot_assets (
    snapshot_id uuid NOT NULL,
    asset_id uuid NOT NULL
);



CREATE TABLE public.snapshot_checks (
    snapshot_id uuid NOT NULL,
    check_id uuid NOT NULL
);



CREATE TABLE public.snapshot_evidence (
    snapshot_id uuid NOT NULL,
    anchor_id uuid NOT NULL
);



CREATE TABLE public.snapshot_observations (
    snapshot_id uuid NOT NULL,
    observation_id uuid NOT NULL
);



CREATE TABLE public.source_artifacts (
    asset_id uuid NOT NULL,
    owner_id text NOT NULL,
    source_version_id uuid NOT NULL,
    parse_run_id uuid NOT NULL,
    kind text NOT NULL
);



CREATE TABLE public.source_blocks (
    id uuid NOT NULL,
    parse_run_id uuid NOT NULL,
    page_id uuid NOT NULL,
    raw_text text NOT NULL,
    search_mapping jsonb NOT NULL,
    ordinal integer NOT NULL
);



CREATE TABLE public.source_chunk_mappings (
    id uuid NOT NULL,
    provider text NOT NULL,
    index_id uuid NOT NULL,
    parse_run_id uuid NOT NULL,
    provider_chunk_id text NOT NULL,
    provider_figure_id text,
    source_version_id uuid NOT NULL
);



CREATE TABLE public.source_contributors (
    source_id uuid NOT NULL,
    ordinal integer NOT NULL,
    name_as_printed text NOT NULL,
    role text NOT NULL,
    attribution text NOT NULL
);



CREATE TABLE public.source_index_memberships (
    index_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    status text NOT NULL
);



CREATE TABLE public.source_intakes (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.source_knowledge_drafts (
    owner_id text NOT NULL,
    source_version_id uuid NOT NULL,
    entry_id uuid NOT NULL
);



CREATE TABLE public.source_languages (
    source_id uuid NOT NULL,
    language text NOT NULL
);



CREATE TABLE public.source_locators (
    id uuid NOT NULL,
    source_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    kind text NOT NULL,
    page_id uuid,
    page_index integer,
    printed_page_label text,
    canonical_view_id uuid,
    region_id uuid,
    geometry jsonb,
    block_id uuid,
    range_start integer,
    range_end integer,
    url text,
    retrieved_at timestamp with time zone,
    snapshot_asset_id uuid,
    excerpt_as_retrieved text,
    CONSTRAINT source_locators_branch_ck CHECK ((((kind = 'page'::text) AND (page_id IS NOT NULL) AND (canonical_view_id IS NOT NULL) AND (url IS NULL)) OR ((kind = 'web'::text) AND (url IS NOT NULL) AND (retrieved_at IS NOT NULL) AND (page_id IS NULL)))),
    CONSTRAINT source_locators_range_ck CHECK ((((range_start IS NULL) AND (range_end IS NULL)) OR ((block_id IS NOT NULL) AND (range_start >= 0) AND (range_end > range_start))))
);



CREATE TABLE public.source_page_parses (
    parse_run_id uuid NOT NULL,
    page_id uuid NOT NULL,
    raw_text text NOT NULL,
    search_text text NOT NULL,
    quality text NOT NULL
);



CREATE TABLE public.source_pages (
    id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    page_index integer NOT NULL,
    printed_page_label text,
    original_asset_id uuid NOT NULL,
    pdf_page_index integer,
    canonical_view_id uuid NOT NULL,
    CONSTRAINT source_pages_index_ck CHECK (((page_index >= 0) AND ((pdf_page_index IS NULL) OR (pdf_page_index >= 0))))
);



CREATE TABLE public.source_regions (
    id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    page_id uuid NOT NULL,
    parse_run_id uuid NOT NULL,
    kind text NOT NULL,
    geometry jsonb NOT NULL,
    raw_text text
);



CREATE TABLE public.source_version_assets (
    version_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    ordinal integer NOT NULL,
    printed_label text,
    presentation jsonb
);



CREATE TABLE public.source_versions (
    id uuid NOT NULL,
    source_id uuid NOT NULL,
    owner_id text NOT NULL,
    source_hash text NOT NULL,
    metadata_snapshot jsonb NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    retrieved_at timestamp with time zone,
    status text NOT NULL,
    text_index_status text NOT NULL,
    image_index_status text NOT NULL,
    active_parse_run_id uuid
);



CREATE TABLE public.sources (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    current_version_id uuid,
    title text NOT NULL,
    author_status text NOT NULL,
    edition_statement text,
    publisher text,
    publication_date_as_printed text,
    isbn text,
    canonical_url text,
    access text NOT NULL,
    rights_statement text,
    attribution_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.transcription_runs (
    id uuid NOT NULL,
    owner_id text NOT NULL,
    job_id uuid NOT NULL,
    record_id uuid NOT NULL,
    audio_asset_id uuid NOT NULL,
    revision integer NOT NULL,
    status text NOT NULL,
    snapshot jsonb NOT NULL,
    request jsonb NOT NULL,
    model_selection jsonb NOT NULL,
    result jsonb,
    invocation jsonb,
    confirmed_observation_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT transcription_runs_status_ck CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'confirmed'::text])))
);



CREATE TABLE public.upload_parts (
    asset_id uuid NOT NULL,
    part_number integer NOT NULL,
    etag text,
    "offset" bigint NOT NULL,
    byte_length bigint NOT NULL,
    CONSTRAINT upload_parts_length_ck CHECK (((byte_length > 0) AND ("offset" >= 0)))
);



CREATE TABLE public.upload_sessions (
    asset_id uuid NOT NULL,
    owner_id text NOT NULL,
    request_key uuid NOT NULL,
    fingerprint text NOT NULL,
    mode text NOT NULL,
    provider_upload_id text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_session jsonb NOT NULL
);



CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    phone_number text,
    phone_number_verified boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.action_resolutions
    ADD CONSTRAINT action_resolutions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.action_states
    ADD CONSTRAINT action_states_run_id_action_id_pk PRIMARY KEY (run_id, action_id);



ALTER TABLE ONLY public.adoption_events
    ADD CONSTRAINT adoption_events_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.analysis_runs
    ADD CONSTRAINT analysis_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.analysis_snapshots
    ADD CONSTRAINT analysis_snapshots_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.anchor_components
    ADD CONSTRAINT anchor_components_anchor_id_component_id_pk PRIMARY KEY (anchor_id, component_id);



ALTER TABLE ONLY public.canonical_views
    ADD CONSTRAINT canonical_views_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.check_anchors
    ADD CONSTRAINT check_anchors_check_id_anchor_id_pk PRIMARY KEY (check_id, anchor_id);



ALTER TABLE ONLY public.check_components
    ADD CONSTRAINT check_components_check_id_component_id_pk PRIMARY KEY (check_id, component_id);



ALTER TABLE ONLY public.check_observations
    ADD CONSTRAINT check_observations_check_id_observation_id_pk PRIMARY KEY (check_id, observation_id);



ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.claim_citations
    ADD CONSTRAINT claim_citations_claim_id_citation_id_pk PRIMARY KEY (claim_id, citation_id);



ALTER TABLE ONLY public.claim_evidence
    ADD CONSTRAINT claim_evidence_claim_id_anchor_id_pk PRIMARY KEY (claim_id, anchor_id);



ALTER TABLE ONLY public.claim_observations
    ADD CONSTRAINT claim_observations_claim_id_observation_id_pk PRIMARY KEY (claim_id, observation_id);



ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.comparison_failures
    ADD CONSTRAINT comparison_failures_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.comparison_results
    ADD CONSTRAINT comparison_results_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.edit_draft_runs
    ADD CONSTRAINT edit_draft_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.idempotency_requests
    ADD CONSTRAINT idempotency_requests_owner_id_operation_key_pk PRIMARY KEY (owner_id, operation, key);



ALTER TABLE ONLY public.image_index_items
    ADD CONSTRAINT image_index_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.index_versions
    ADD CONSTRAINT index_versions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.inspection_methods
    ADD CONSTRAINT inspection_methods_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.job_steps
    ADD CONSTRAINT job_steps_job_id_stage_key_pk PRIMARY KEY (job_id, stage_key);



ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_owner_id_uq UNIQUE (owner_id, id);



ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.knowledge_revision_aliases
    ADD CONSTRAINT knowledge_revision_aliases_entry_id_revision_alias_pk PRIMARY KEY (entry_id, revision, alias);



ALTER TABLE ONLY public.knowledge_revision_citations
    ADD CONSTRAINT knowledge_revision_citations_entry_id_revision_citation_id_pk PRIMARY KEY (entry_id, revision, citation_id);



ALTER TABLE ONLY public.knowledge_revision_kinds
    ADD CONSTRAINT knowledge_revision_kinds_entry_id_revision_kind_pk PRIMARY KEY (entry_id, revision, kind);



ALTER TABLE ONLY public.knowledge_revision_methods
    ADD CONSTRAINT knowledge_revision_methods_entry_id_revision_method_id_pk PRIMARY KEY (entry_id, revision, method_id);



ALTER TABLE ONLY public.knowledge_revisions
    ADD CONSTRAINT knowledge_revisions_entry_id_revision_pk PRIMARY KEY (entry_id, revision);



ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.mapping_regions
    ADD CONSTRAINT mapping_regions_mapping_id_region_id_pk PRIMARY KEY (mapping_id, region_id);



ALTER TABLE ONLY public.media_asset_components
    ADD CONSTRAINT media_asset_components_asset_id_component_id_pk PRIMARY KEY (asset_id, component_id);



ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.method_versions
    ADD CONSTRAINT method_versions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.note_citations
    ADD CONSTRAINT note_citations_note_id_citation_id_pk PRIMARY KEY (note_id, citation_id);



ALTER TABLE ONLY public.note_paragraphs
    ADD CONSTRAINT note_paragraphs_note_id_ordinal_pk PRIMARY KEY (note_id, ordinal);



ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.observation_anchors
    ADD CONSTRAINT observation_anchors_observation_id_anchor_id_pk PRIMARY KEY (observation_id, anchor_id);



ALTER TABLE ONLY public.observation_components
    ADD CONSTRAINT observation_components_observation_id_component_id_pk PRIMARY KEY (observation_id, component_id);



ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.otp_send_cooldown
    ADD CONSTRAINT otp_send_cooldown_pkey PRIMARY KEY (phone_number);



ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (event_id);



ALTER TABLE ONLY public.parse_runs
    ADD CONSTRAINT parse_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.proposal_findings
    ADD CONSTRAINT proposal_findings_proposal_id_claim_id_pk PRIMARY KEY (proposal_id, claim_id);



ALTER TABLE ONLY public.proposal_states
    ADD CONSTRAINT proposal_states_run_id_proposal_id_pk PRIMARY KEY (run_id, proposal_id);



ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.provider_completions
    ADD CONSTRAINT provider_completions_pkey PRIMARY KEY (mapping_id);



ALTER TABLE ONLY public.provider_events
    ADD CONSTRAINT provider_events_provider_event_id_pk PRIMARY KEY (provider, event_id);



ALTER TABLE ONLY public.provider_job_mappings
    ADD CONSTRAINT provider_job_mappings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.provider_webhook_inbox
    ADD CONSTRAINT provider_webhook_inbox_provider_event_id_pk PRIMARY KEY (provider, event_id);



ALTER TABLE ONLY public.record_acquisitions
    ADD CONSTRAINT record_acquisitions_pkey PRIMARY KEY (record_id);



ALTER TABLE ONLY public.record_categories
    ADD CONSTRAINT record_categories_record_id_category_id_pk PRIMARY KEY (record_id, category_id);



ALTER TABLE ONLY public.record_checks
    ADD CONSTRAINT record_checks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.record_components
    ADD CONSTRAINT record_components_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.record_materials
    ADD CONSTRAINT record_materials_record_id_material_id_pk PRIMARY KEY (record_id, material_id);



ALTER TABLE ONLY public.record_measurements
    ADD CONSTRAINT record_measurements_record_id_kind_pk PRIMARY KEY (record_id, kind);



ALTER TABLE ONLY public.record_receipts
    ADD CONSTRAINT record_receipts_record_id_asset_id_pk PRIMARY KEY (record_id, asset_id);



ALTER TABLE ONLY public.record_tags
    ADD CONSTRAINT record_tags_record_id_tag_pk PRIMARY KEY (record_id, tag);



ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.region_relations
    ADD CONSTRAINT region_relations_from_id_to_id_kind_pk PRIMARY KEY (from_id, to_id, kind);



ALTER TABLE ONLY public.research_draft_revisions
    ADD CONSTRAINT research_draft_revisions_research_id_revision_pk PRIMARY KEY (research_id, revision);



ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.research_sources
    ADD CONSTRAINT research_sources_research_id_source_version_id_pk PRIMARY KEY (research_id, source_version_id);



ALTER TABLE ONLY public.resolution_checks
    ADD CONSTRAINT resolution_checks_resolution_id_check_id_pk PRIMARY KEY (resolution_id, check_id);



ALTER TABLE ONLY public.resolution_evidence
    ADD CONSTRAINT resolution_evidence_resolution_id_anchor_id_pk PRIMARY KEY (resolution_id, anchor_id);



ALTER TABLE ONLY public.resolution_observations
    ADD CONSTRAINT resolution_observations_resolution_id_observation_id_pk PRIMARY KEY (resolution_id, observation_id);



ALTER TABLE ONLY public.resolution_references
    ADD CONSTRAINT resolution_references_resolution_id_reference_id_pk PRIMARY KEY (resolution_id, reference_id);



ALTER TABLE ONLY public.retrieval_snapshots
    ADD CONSTRAINT retrieval_snapshots_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.run_suggested_methods
    ADD CONSTRAINT run_suggested_methods_run_id_method_id_method_version_id_pk PRIMARY KEY (run_id, method_id, method_version_id);



ALTER TABLE ONLY public.sequence_counters
    ADD CONSTRAINT sequence_counters_owner_id_kind_pk PRIMARY KEY (owner_id, kind);



ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);



ALTER TABLE ONLY public.snapshot_assets
    ADD CONSTRAINT snapshot_assets_snapshot_id_asset_id_pk PRIMARY KEY (snapshot_id, asset_id);



ALTER TABLE ONLY public.snapshot_checks
    ADD CONSTRAINT snapshot_checks_snapshot_id_check_id_pk PRIMARY KEY (snapshot_id, check_id);



ALTER TABLE ONLY public.snapshot_evidence
    ADD CONSTRAINT snapshot_evidence_snapshot_id_anchor_id_pk PRIMARY KEY (snapshot_id, anchor_id);



ALTER TABLE ONLY public.snapshot_observations
    ADD CONSTRAINT snapshot_observations_snapshot_id_observation_id_pk PRIMARY KEY (snapshot_id, observation_id);



ALTER TABLE ONLY public.source_artifacts
    ADD CONSTRAINT source_artifacts_pkey PRIMARY KEY (asset_id);



ALTER TABLE ONLY public.source_blocks
    ADD CONSTRAINT source_blocks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_chunk_mappings
    ADD CONSTRAINT source_chunk_mappings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_contributors
    ADD CONSTRAINT source_contributors_source_id_ordinal_pk PRIMARY KEY (source_id, ordinal);



ALTER TABLE ONLY public.source_index_memberships
    ADD CONSTRAINT source_index_memberships_index_id_source_version_id_pk PRIMARY KEY (index_id, source_version_id);



ALTER TABLE ONLY public.source_intakes
    ADD CONSTRAINT source_intakes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_knowledge_drafts
    ADD CONSTRAINT source_knowledge_drafts_source_version_id_entry_id_pk PRIMARY KEY (source_version_id, entry_id);



ALTER TABLE ONLY public.source_languages
    ADD CONSTRAINT source_languages_source_id_language_pk PRIMARY KEY (source_id, language);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_page_parses
    ADD CONSTRAINT source_page_parses_parse_run_id_page_id_pk PRIMARY KEY (parse_run_id, page_id);



ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_regions
    ADD CONSTRAINT source_regions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.source_version_assets
    ADD CONSTRAINT source_version_assets_version_id_asset_id_pk PRIMARY KEY (version_id, asset_id);



ALTER TABLE ONLY public.source_versions
    ADD CONSTRAINT source_versions_owner_id_uq UNIQUE (owner_id, id);



ALTER TABLE ONLY public.source_versions
    ADD CONSTRAINT source_versions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.upload_parts
    ADD CONSTRAINT upload_parts_asset_id_part_number_pk PRIMARY KEY (asset_id, part_number);



ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (asset_id);



ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);



ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_phone_number_unique UNIQUE (phone_number);



ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);



CREATE INDEX account_user_id_idx ON public.account USING btree (user_id);



CREATE UNIQUE INDEX action_resolutions_revision_uq ON public.action_resolutions USING btree (run_id, action_id, action_revision);



CREATE UNIQUE INDEX adoption_events_proposal_uq ON public.adoption_events USING btree (run_id, proposal_id);



CREATE UNIQUE INDEX analysis_runs_job_uq ON public.analysis_runs USING btree (job_id);



CREATE INDEX analysis_runs_record_idx ON public.analysis_runs USING btree (owner_id, record_id, created_at, id);



CREATE INDEX analysis_snapshots_record_idx ON public.analysis_snapshots USING btree (owner_id, record_id, created_at);



CREATE UNIQUE INDEX canonical_views_derivative_uq ON public.canonical_views USING btree (derivative_id);



CREATE INDEX citations_locator_idx ON public.citations USING btree (locator_id);



CREATE UNIQUE INDEX claims_run_id_uq ON public.claims USING btree (run_id, id);



CREATE UNIQUE INDEX comparison_failures_owner_id_uq ON public.comparison_failures USING btree (owner_id, id);



CREATE UNIQUE INDEX comparison_results_owner_id_uq ON public.comparison_results USING btree (owner_id, id);



CREATE UNIQUE INDEX edit_draft_runs_job_uq ON public.edit_draft_runs USING btree (job_id);



CREATE UNIQUE INDEX edit_draft_runs_owner_id_uq ON public.edit_draft_runs USING btree (owner_id, id);



CREATE INDEX edit_draft_runs_record_idx ON public.edit_draft_runs USING btree (owner_id, record_id, created_at);



CREATE UNIQUE INDEX evidence_anchors_owner_record_id_uq ON public.evidence_anchors USING btree (owner_id, record_id, id);



CREATE INDEX evidence_anchors_record_idx ON public.evidence_anchors USING btree (owner_id, record_id, created_at, id);



CREATE INDEX job_steps_claim_idx ON public.job_steps USING btree (state, lease_until);



CREATE UNIQUE INDEX jobs_owner_id_uq ON public.jobs USING btree (owner_id, id);



CREATE INDEX jobs_owner_state_idx ON public.jobs USING btree (owner_id, state, created_at);



CREATE UNIQUE INDEX knowledge_entries_owner_code_uq ON public.knowledge_entries USING btree (owner_id, display_code);



CREATE INDEX knowledge_revision_kinds_kind_idx ON public.knowledge_revision_kinds USING btree (kind);



CREATE INDEX knowledge_revisions_title_idx ON public.knowledge_revisions USING btree (title_zh_hant);



CREATE UNIQUE INDEX locations_owner_label_uq ON public.locations USING btree (owner_id, normalized_label);



CREATE UNIQUE INDEX media_assets_object_key_uq ON public.media_assets USING btree (object_key);



CREATE INDEX media_assets_record_idx ON public.media_assets USING btree (owner_id, record_id, created_at);



CREATE UNIQUE INDEX media_derivatives_key_uq ON public.media_derivatives USING btree (object_key);



CREATE INDEX media_derivatives_original_idx ON public.media_derivatives USING btree (original_asset_id, kind);



CREATE UNIQUE INDEX method_versions_method_revision_uq ON public.method_versions USING btree (method_id, revision);



CREATE UNIQUE INDEX next_actions_run_id_uq ON public.next_actions USING btree (run_id, id);



CREATE INDEX observations_current_idx ON public.observations USING btree (owner_id, record_id, created_at, id) WHERE (superseded_by_id IS NULL);



CREATE UNIQUE INDEX observations_owner_record_id_uq ON public.observations USING btree (owner_id, record_id, id);



CREATE UNIQUE INDEX observations_superseded_by_uq ON public.observations USING btree (superseded_by_id);



CREATE UNIQUE INDEX observations_supersedes_uq ON public.observations USING btree (supersedes_id);



CREATE UNIQUE INDEX otp_send_cooldown_phone_uq ON public.otp_send_cooldown USING btree (phone_number);



CREATE UNIQUE INDEX outbox_idempotency_uq ON public.outbox USING btree (event_name, idempotency_key);



CREATE INDEX outbox_pending_idx ON public.outbox USING btree (available_at, event_id) WHERE (delivered_at IS NULL);



CREATE UNIQUE INDEX proposals_run_id_uq ON public.proposals USING btree (run_id, id);



CREATE UNIQUE INDEX provider_job_mappings_provider_job_uq ON public.provider_job_mappings USING btree (provider, provider_job_id);



CREATE UNIQUE INDEX provider_job_mappings_token_uq ON public.provider_job_mappings USING btree (correlation_token);



CREATE INDEX provider_webhook_inbox_pending_idx ON public.provider_webhook_inbox USING btree (provider, created_at) WHERE (delivered_at IS NULL);



CREATE INDEX record_categories_category_idx ON public.record_categories USING btree (category_id);



CREATE INDEX record_checks_owner_progress_idx ON public.record_checks USING btree (owner_id, progress, created_at, id);



CREATE UNIQUE INDEX record_checks_owner_record_id_uq ON public.record_checks USING btree (owner_id, record_id, id);



CREATE UNIQUE INDEX record_checks_scope_uq ON public.record_checks USING btree (record_id, method_version_id, scope_key);



CREATE UNIQUE INDEX record_components_record_id_uq ON public.record_components USING btree (record_id, id);



CREATE UNIQUE INDEX record_components_record_ordinal_uq ON public.record_components USING btree (record_id, ordinal);



CREATE INDEX record_materials_material_idx ON public.record_materials USING btree (material_id);



CREATE INDEX record_tags_tag_idx ON public.record_tags USING btree (tag);



CREATE UNIQUE INDEX records_owner_code_uq ON public.records USING btree (owner_id, code);



CREATE INDEX records_owner_name_idx ON public.records USING btree (owner_id, name, id);



CREATE INDEX records_owner_updated_idx ON public.records USING btree (owner_id, updated_at, id);



CREATE INDEX reference_images_version_idx ON public.reference_images USING btree (source_version_id, id);



CREATE UNIQUE INDEX reference_links_identity_uq ON public.reference_links USING btree (owner_id, target_identity_key, subject_identity_key);



CREATE INDEX reference_links_record_idx ON public.reference_links USING btree (owner_id, target_record_id, created_at, id);



CREATE INDEX session_user_id_idx ON public.session USING btree (user_id);



CREATE INDEX source_artifacts_parse_run_idx ON public.source_artifacts USING btree (parse_run_id, kind);



CREATE INDEX source_blocks_page_idx ON public.source_blocks USING btree (parse_run_id, page_id, ordinal);



CREATE UNIQUE INDEX source_chunk_mappings_provider_uq ON public.source_chunk_mappings USING btree (provider, index_id, provider_chunk_id);



CREATE INDEX source_knowledge_drafts_entry_idx ON public.source_knowledge_drafts USING btree (entry_id);



CREATE INDEX source_locators_version_idx ON public.source_locators USING btree (source_version_id, kind);



CREATE UNIQUE INDEX source_pages_version_id_uq ON public.source_pages USING btree (source_version_id, id);



CREATE UNIQUE INDEX source_pages_version_index_uq ON public.source_pages USING btree (source_version_id, page_index);



CREATE INDEX source_regions_page_idx ON public.source_regions USING btree (page_id, kind);



CREATE UNIQUE INDEX source_version_assets_asset_uq ON public.source_version_assets USING btree (asset_id);



CREATE UNIQUE INDEX source_version_assets_ordinal_uq ON public.source_version_assets USING btree (version_id, ordinal);



CREATE UNIQUE INDEX source_versions_owner_hash_uq ON public.source_versions USING btree (owner_id, source_hash);



CREATE UNIQUE INDEX source_versions_source_id_uq ON public.source_versions USING btree (source_id, id);



CREATE UNIQUE INDEX sources_owner_id_uq ON public.sources USING btree (owner_id, id);



CREATE INDEX sources_owner_title_idx ON public.sources USING btree (owner_id, title, id);



CREATE UNIQUE INDEX transcription_runs_job_uq ON public.transcription_runs USING btree (job_id);



CREATE UNIQUE INDEX transcription_runs_owner_id_uq ON public.transcription_runs USING btree (owner_id, id);



CREATE INDEX transcription_runs_record_idx ON public.transcription_runs USING btree (owner_id, record_id, created_at);



CREATE UNIQUE INDEX upload_sessions_owner_request_uq ON public.upload_sessions USING btree (owner_id, request_key);



CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);



ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.action_resolutions
    ADD CONSTRAINT action_resolutions_action_id_next_actions_id_fk FOREIGN KEY (action_id) REFERENCES public.next_actions(id);



ALTER TABLE ONLY public.action_resolutions
    ADD CONSTRAINT action_resolutions_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.action_states
    ADD CONSTRAINT action_states_action_id_next_actions_id_fk FOREIGN KEY (action_id) REFERENCES public.next_actions(id);



ALTER TABLE ONLY public.action_states
    ADD CONSTRAINT action_states_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.action_states
    ADD CONSTRAINT action_states_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.adoption_events
    ADD CONSTRAINT adoption_events_proposal_id_proposals_id_fk FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);



ALTER TABLE ONLY public.adoption_events
    ADD CONSTRAINT adoption_events_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.analysis_runs
    ADD CONSTRAINT analysis_runs_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.analysis_runs
    ADD CONSTRAINT analysis_runs_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.analysis_runs
    ADD CONSTRAINT analysis_runs_retrieval_snapshot_id_retrieval_snapshots_id_fk FOREIGN KEY (retrieval_snapshot_id) REFERENCES public.retrieval_snapshots(id);



ALTER TABLE ONLY public.analysis_runs
    ADD CONSTRAINT analysis_runs_snapshot_id_analysis_snapshots_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.analysis_snapshots(id);



ALTER TABLE ONLY public.analysis_snapshots
    ADD CONSTRAINT analysis_snapshots_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.anchor_components
    ADD CONSTRAINT anchor_components_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.anchor_components
    ADD CONSTRAINT anchor_components_component_id_record_components_id_fk FOREIGN KEY (component_id) REFERENCES public.record_components(id);



ALTER TABLE ONLY public.canonical_views
    ADD CONSTRAINT canonical_views_derivative_id_media_derivatives_id_fk FOREIGN KEY (derivative_id) REFERENCES public.media_derivatives(id);



ALTER TABLE ONLY public.canonical_views
    ADD CONSTRAINT canonical_views_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.check_anchors
    ADD CONSTRAINT check_anchors_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.check_anchors
    ADD CONSTRAINT check_anchors_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.check_components
    ADD CONSTRAINT check_components_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.check_components
    ADD CONSTRAINT check_components_component_id_record_components_id_fk FOREIGN KEY (component_id) REFERENCES public.record_components(id);



ALTER TABLE ONLY public.check_observations
    ADD CONSTRAINT check_observations_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.check_observations
    ADD CONSTRAINT check_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_locator_id_source_locators_id_fk FOREIGN KEY (locator_id) REFERENCES public.source_locators(id);



ALTER TABLE ONLY public.claim_citations
    ADD CONSTRAINT claim_citations_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id);



ALTER TABLE ONLY public.claim_evidence
    ADD CONSTRAINT claim_evidence_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.claim_evidence
    ADD CONSTRAINT claim_evidence_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id);



ALTER TABLE ONLY public.claim_observations
    ADD CONSTRAINT claim_observations_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id);



ALTER TABLE ONLY public.claim_observations
    ADD CONSTRAINT claim_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.edit_draft_runs
    ADD CONSTRAINT edit_draft_runs_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.edit_draft_runs
    ADD CONSTRAINT edit_draft_runs_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_canonical_view_id_canonical_views_id_fk FOREIGN KEY (canonical_view_id) REFERENCES public.canonical_views(id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_crop_derivative_id_media_derivatives_id_fk FOREIGN KEY (crop_derivative_id) REFERENCES public.media_derivatives(id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_frame_derivative_id_media_derivatives_id_fk FOREIGN KEY (frame_derivative_id) REFERENCES public.media_derivatives(id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.evidence_anchors
    ADD CONSTRAINT evidence_anchors_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.image_index_items
    ADD CONSTRAINT image_index_items_derivative_id_media_derivatives_id_fk FOREIGN KEY (derivative_id) REFERENCES public.media_derivatives(id);



ALTER TABLE ONLY public.image_index_items
    ADD CONSTRAINT image_index_items_index_id_index_versions_id_fk FOREIGN KEY (index_id) REFERENCES public.index_versions(id);



ALTER TABLE ONLY public.image_index_items
    ADD CONSTRAINT image_index_items_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.image_index_items
    ADD CONSTRAINT image_index_items_reference_image_id_reference_images_id_fk FOREIGN KEY (reference_image_id) REFERENCES public.reference_images(id);



ALTER TABLE ONLY public.inspection_methods
    ADD CONSTRAINT inspection_methods_owning_entry_id_knowledge_entries_id_fk FOREIGN KEY (owning_entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.job_steps
    ADD CONSTRAINT job_steps_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.knowledge_revision_aliases
    ADD CONSTRAINT knowledge_revision_aliases_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.knowledge_revision_citations
    ADD CONSTRAINT knowledge_revision_citations_citation_id_citations_id_fk FOREIGN KEY (citation_id) REFERENCES public.citations(id);



ALTER TABLE ONLY public.knowledge_revision_citations
    ADD CONSTRAINT knowledge_revision_citations_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.knowledge_revision_kinds
    ADD CONSTRAINT knowledge_revision_kinds_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.knowledge_revision_methods
    ADD CONSTRAINT knowledge_revision_methods_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.knowledge_revision_methods
    ADD CONSTRAINT knowledge_revision_methods_method_id_inspection_methods_id_fk FOREIGN KEY (method_id) REFERENCES public.inspection_methods(id);



ALTER TABLE ONLY public.knowledge_revision_methods
    ADD CONSTRAINT knowledge_revision_methods_method_version_id_method_versions_id FOREIGN KEY (method_version_id) REFERENCES public.method_versions(id);



ALTER TABLE ONLY public.knowledge_revisions
    ADD CONSTRAINT knowledge_revisions_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.mapping_regions
    ADD CONSTRAINT mapping_regions_mapping_id_source_chunk_mappings_id_fk FOREIGN KEY (mapping_id) REFERENCES public.source_chunk_mappings(id);



ALTER TABLE ONLY public.mapping_regions
    ADD CONSTRAINT mapping_regions_region_id_source_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.source_regions(id);



ALTER TABLE ONLY public.media_asset_components
    ADD CONSTRAINT media_asset_components_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.media_asset_components
    ADD CONSTRAINT media_asset_components_component_id_record_components_id_fk FOREIGN KEY (component_id) REFERENCES public.record_components(id);



ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_source_intake_id_source_intakes_id_fk FOREIGN KEY (source_intake_id) REFERENCES public.source_intakes(id);



ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.method_versions
    ADD CONSTRAINT method_versions_method_id_inspection_methods_id_fk FOREIGN KEY (method_id) REFERENCES public.inspection_methods(id);



ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.note_citations
    ADD CONSTRAINT note_citations_citation_id_citations_id_fk FOREIGN KEY (citation_id) REFERENCES public.citations(id);



ALTER TABLE ONLY public.note_citations
    ADD CONSTRAINT note_citations_note_id_notes_id_fk FOREIGN KEY (note_id) REFERENCES public.notes(id);



ALTER TABLE ONLY public.note_paragraphs
    ADD CONSTRAINT note_paragraphs_note_id_notes_id_fk FOREIGN KEY (note_id) REFERENCES public.notes(id);



ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_research_id_research_runs_id_fk FOREIGN KEY (research_id) REFERENCES public.research_runs(id);



ALTER TABLE ONLY public.observation_anchors
    ADD CONSTRAINT observation_anchors_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.observation_anchors
    ADD CONSTRAINT observation_anchors_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.observation_components
    ADD CONSTRAINT observation_components_component_id_record_components_id_fk FOREIGN KEY (component_id) REFERENCES public.record_components(id);



ALTER TABLE ONLY public.observation_components
    ADD CONSTRAINT observation_components_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_audio_asset_id_media_assets_id_fk FOREIGN KEY (audio_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.observations
    ADD CONSTRAINT observations_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.parse_runs
    ADD CONSTRAINT parse_runs_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.parse_runs
    ADD CONSTRAINT parse_runs_raw_output_asset_id_media_assets_id_fk FOREIGN KEY (raw_output_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.parse_runs
    ADD CONSTRAINT parse_runs_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.proposal_findings
    ADD CONSTRAINT proposal_findings_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id);



ALTER TABLE ONLY public.proposal_findings
    ADD CONSTRAINT proposal_findings_proposal_id_proposals_id_fk FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);



ALTER TABLE ONLY public.proposal_states
    ADD CONSTRAINT proposal_states_proposal_id_proposals_id_fk FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);



ALTER TABLE ONLY public.proposal_states
    ADD CONSTRAINT proposal_states_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.provider_completions
    ADD CONSTRAINT provider_completions_mapping_id_provider_job_mappings_id_fk FOREIGN KEY (mapping_id) REFERENCES public.provider_job_mappings(id);



ALTER TABLE ONLY public.provider_events
    ADD CONSTRAINT provider_events_mapping_id_provider_job_mappings_id_fk FOREIGN KEY (mapping_id) REFERENCES public.provider_job_mappings(id);



ALTER TABLE ONLY public.provider_job_mappings
    ADD CONSTRAINT provider_job_mappings_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.record_acquisitions
    ADD CONSTRAINT record_acquisitions_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_categories
    ADD CONSTRAINT record_categories_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_checks
    ADD CONSTRAINT record_checks_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_components
    ADD CONSTRAINT record_components_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_materials
    ADD CONSTRAINT record_materials_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_measurements
    ADD CONSTRAINT record_measurements_component_id_record_components_id_fk FOREIGN KEY (component_id) REFERENCES public.record_components(id);



ALTER TABLE ONLY public.record_measurements
    ADD CONSTRAINT record_measurements_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_receipts
    ADD CONSTRAINT record_receipts_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.record_tags
    ADD CONSTRAINT record_tags_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_caption_locator_id_source_locators_id_fk FOREIGN KEY (caption_locator_id) REFERENCES public.source_locators(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_description_job_id_jobs_id_fk FOREIGN KEY (description_job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_figure_region_id_source_regions_id_fk FOREIGN KEY (figure_region_id) REFERENCES public.source_regions(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_locator_id_source_locators_id_fk FOREIGN KEY (locator_id) REFERENCES public.source_locators(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.reference_images
    ADD CONSTRAINT reference_images_stored_derivative_id_media_derivatives_id_fk FOREIGN KEY (stored_derivative_id) REFERENCES public.media_derivatives(id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_reference_image_id_reference_images_id_fk FOREIGN KEY (reference_image_id) REFERENCES public.reference_images(id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_source_locator_id_source_locators_id_fk FOREIGN KEY (source_locator_id) REFERENCES public.source_locators(id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_subject_record_id_records_id_fk FOREIGN KEY (subject_record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.reference_links
    ADD CONSTRAINT reference_links_target_record_id_records_id_fk FOREIGN KEY (target_record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.region_relations
    ADD CONSTRAINT region_relations_from_id_source_regions_id_fk FOREIGN KEY (from_id) REFERENCES public.source_regions(id);



ALTER TABLE ONLY public.region_relations
    ADD CONSTRAINT region_relations_to_id_source_regions_id_fk FOREIGN KEY (to_id) REFERENCES public.source_regions(id);



ALTER TABLE ONLY public.research_draft_revisions
    ADD CONSTRAINT research_draft_revisions_research_id_research_runs_id_fk FOREIGN KEY (research_id) REFERENCES public.research_runs(id);



ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_entry_id_knowledge_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id);



ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.research_sources
    ADD CONSTRAINT research_sources_research_id_research_runs_id_fk FOREIGN KEY (research_id) REFERENCES public.research_runs(id);



ALTER TABLE ONLY public.research_sources
    ADD CONSTRAINT research_sources_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.resolution_checks
    ADD CONSTRAINT resolution_checks_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.resolution_checks
    ADD CONSTRAINT resolution_checks_resolution_id_action_resolutions_id_fk FOREIGN KEY (resolution_id) REFERENCES public.action_resolutions(id);



ALTER TABLE ONLY public.resolution_evidence
    ADD CONSTRAINT resolution_evidence_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.resolution_evidence
    ADD CONSTRAINT resolution_evidence_resolution_id_action_resolutions_id_fk FOREIGN KEY (resolution_id) REFERENCES public.action_resolutions(id);



ALTER TABLE ONLY public.resolution_observations
    ADD CONSTRAINT resolution_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.resolution_observations
    ADD CONSTRAINT resolution_observations_resolution_id_action_resolutions_id_fk FOREIGN KEY (resolution_id) REFERENCES public.action_resolutions(id);



ALTER TABLE ONLY public.resolution_references
    ADD CONSTRAINT resolution_references_resolution_id_action_resolutions_id_fk FOREIGN KEY (resolution_id) REFERENCES public.action_resolutions(id);



ALTER TABLE ONLY public.run_suggested_methods
    ADD CONSTRAINT run_suggested_methods_run_id_analysis_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.analysis_runs(id);



ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.snapshot_assets
    ADD CONSTRAINT snapshot_assets_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.snapshot_assets
    ADD CONSTRAINT snapshot_assets_snapshot_id_analysis_snapshots_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.analysis_snapshots(id);



ALTER TABLE ONLY public.snapshot_checks
    ADD CONSTRAINT snapshot_checks_check_id_record_checks_id_fk FOREIGN KEY (check_id) REFERENCES public.record_checks(id);



ALTER TABLE ONLY public.snapshot_checks
    ADD CONSTRAINT snapshot_checks_snapshot_id_analysis_snapshots_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.analysis_snapshots(id);



ALTER TABLE ONLY public.snapshot_evidence
    ADD CONSTRAINT snapshot_evidence_anchor_id_evidence_anchors_id_fk FOREIGN KEY (anchor_id) REFERENCES public.evidence_anchors(id);



ALTER TABLE ONLY public.snapshot_evidence
    ADD CONSTRAINT snapshot_evidence_snapshot_id_analysis_snapshots_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.analysis_snapshots(id);



ALTER TABLE ONLY public.snapshot_observations
    ADD CONSTRAINT snapshot_observations_observation_id_observations_id_fk FOREIGN KEY (observation_id) REFERENCES public.observations(id);



ALTER TABLE ONLY public.snapshot_observations
    ADD CONSTRAINT snapshot_observations_snapshot_id_analysis_snapshots_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.analysis_snapshots(id);



ALTER TABLE ONLY public.source_artifacts
    ADD CONSTRAINT source_artifacts_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.source_artifacts
    ADD CONSTRAINT source_artifacts_owner_id_source_version_id_source_versions_own FOREIGN KEY (owner_id, source_version_id) REFERENCES public.source_versions(owner_id, id);



ALTER TABLE ONLY public.source_blocks
    ADD CONSTRAINT source_blocks_page_id_source_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.source_pages(id);



ALTER TABLE ONLY public.source_blocks
    ADD CONSTRAINT source_blocks_parse_run_id_parse_runs_id_fk FOREIGN KEY (parse_run_id) REFERENCES public.parse_runs(id);



ALTER TABLE ONLY public.source_chunk_mappings
    ADD CONSTRAINT source_chunk_mappings_index_id_index_versions_id_fk FOREIGN KEY (index_id) REFERENCES public.index_versions(id);



ALTER TABLE ONLY public.source_chunk_mappings
    ADD CONSTRAINT source_chunk_mappings_parse_run_id_parse_runs_id_fk FOREIGN KEY (parse_run_id) REFERENCES public.parse_runs(id);



ALTER TABLE ONLY public.source_chunk_mappings
    ADD CONSTRAINT source_chunk_mappings_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_contributors
    ADD CONSTRAINT source_contributors_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);



ALTER TABLE ONLY public.source_index_memberships
    ADD CONSTRAINT source_index_memberships_index_id_index_versions_id_fk FOREIGN KEY (index_id) REFERENCES public.index_versions(id);



ALTER TABLE ONLY public.source_index_memberships
    ADD CONSTRAINT source_index_memberships_source_version_id_source_versions_id_f FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_knowledge_drafts
    ADD CONSTRAINT source_knowledge_drafts_owner_id_entry_id_knowledge_entries_own FOREIGN KEY (owner_id, entry_id) REFERENCES public.knowledge_entries(owner_id, id);



ALTER TABLE ONLY public.source_knowledge_drafts
    ADD CONSTRAINT source_knowledge_drafts_owner_id_source_version_id_source_versi FOREIGN KEY (owner_id, source_version_id) REFERENCES public.source_versions(owner_id, id);



ALTER TABLE ONLY public.source_languages
    ADD CONSTRAINT source_languages_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_block_id_source_blocks_id_fk FOREIGN KEY (block_id) REFERENCES public.source_blocks(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_canonical_view_id_canonical_views_id_fk FOREIGN KEY (canonical_view_id) REFERENCES public.canonical_views(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_page_id_source_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.source_pages(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_region_id_source_regions_id_fk FOREIGN KEY (region_id) REFERENCES public.source_regions(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_snapshot_asset_id_media_assets_id_fk FOREIGN KEY (snapshot_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);



ALTER TABLE ONLY public.source_locators
    ADD CONSTRAINT source_locators_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_page_parses
    ADD CONSTRAINT source_page_parses_page_id_source_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.source_pages(id);



ALTER TABLE ONLY public.source_page_parses
    ADD CONSTRAINT source_page_parses_parse_run_id_parse_runs_id_fk FOREIGN KEY (parse_run_id) REFERENCES public.parse_runs(id);



ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_canonical_view_id_canonical_views_id_fk FOREIGN KEY (canonical_view_id) REFERENCES public.canonical_views(id);



ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_original_asset_id_media_assets_id_fk FOREIGN KEY (original_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_regions
    ADD CONSTRAINT source_regions_page_id_source_pages_id_fk FOREIGN KEY (page_id) REFERENCES public.source_pages(id);



ALTER TABLE ONLY public.source_regions
    ADD CONSTRAINT source_regions_parse_run_id_parse_runs_id_fk FOREIGN KEY (parse_run_id) REFERENCES public.parse_runs(id);



ALTER TABLE ONLY public.source_regions
    ADD CONSTRAINT source_regions_source_version_id_source_versions_id_fk FOREIGN KEY (source_version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_version_assets
    ADD CONSTRAINT source_version_assets_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.source_version_assets
    ADD CONSTRAINT source_version_assets_version_id_source_versions_id_fk FOREIGN KEY (version_id) REFERENCES public.source_versions(id);



ALTER TABLE ONLY public.source_versions
    ADD CONSTRAINT source_versions_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES public.sources(id);



ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_audio_asset_id_media_assets_id_fk FOREIGN KEY (audio_asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_job_id_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id);



ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES public.records(id);



ALTER TABLE ONLY public.upload_parts
    ADD CONSTRAINT upload_parts_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);



ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_asset_id_media_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.media_assets(id);





-- Preserve the idempotent legacy data repair for any populated baseline adoption.
UPDATE "records" AS record
SET "latest_run_id" = latest.id
FROM (
  SELECT DISTINCT ON ("owner_id", "record_id")
    "id", "owner_id", "record_id"
  FROM "analysis_runs"
  WHERE "status" IN ('completed', 'partial')
    AND "raw_output" IS NOT NULL
  ORDER BY "owner_id", "record_id", "created_at" DESC, "id" DESC
) AS latest
WHERE record."id" = latest.record_id
  AND record."owner_id" = latest.owner_id
  AND record."latest_run_id" IS NULL;
