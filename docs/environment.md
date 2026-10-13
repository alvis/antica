# Environment and external services

Copy the root [.env.example](../.env.example) to `.env` and replace its synthetic collector phone and secrets before using persistent local data. The API loads repository-root `.env` when present in `apps/api/src/main.ts`, then validates application and image settings in `apps/api/src/composition.ts`, model settings in `packages/platform/src/ai/config.ts`, knowledge settings in `packages/platform/src/parsing/config.ts`, and workflow settings in `packages/platform/src/workflow/runtime.ts`. Migration and seed read their own process environment rather than loading `.env`; export `DATABASE_URL` and `ANTICA_COLLECTOR_PHONE` in the shell for those separate commands. Expo reads its public API URL from `apps/mobile/src/auth.tsx`; set it in Expo's process/project environment when the root file is not loaded by Expo. Keep secrets out of Git, logs, and all `EXPO_PUBLIC_*` values.

## API startup

| Variable                                        | Requirement and behavior                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                      | Optional `development`, `test`, or `production`; defaults to `development`. Production rejects development OTP, local storage, and a non-HTTPS Better Auth URL. The development seed also refuses production. |
| `PORT`                                          | Optional HTTP port; integer 1–65535, defaults to 8080.                                                                                                                                                        |
| `HOST`                                          | Optional bind address; defaults to `0.0.0.0`.                                                                                                                                                                 |
| `DATABASE_URL`                                  | Required PostgreSQL URL for the API, migration, and seed. Compose declares `postgresql://antica:antica_dev_password@127.0.0.1:54329/antica` for local development.                                            |
| `BETTER_AUTH_URL`                               | Required public API origin used by Better Auth and local signed media URLs. Must be HTTPS in production and reachable by the handset for local media transfers.                                               |
| `BETTER_AUTH_SECRET`                            | Required Better Auth secret, at least 32 characters. Generate a distinct secret for each environment.                                                                                                         |
| `ANTICA_COLLECTOR_PHONE`                        | Required allowlisted collector E.164 number; also used by the illustrative seed. There is no public registration.                                                                                             |
| `ANTICA_ALLOWED_ORIGINS`                        | Optional comma-separated trusted origins for Better Auth and API CORS; defaults to `antica://`. Add only the client origins actually used.                                                                    |
| `ANTICA_OTP_DRIVER`                             | Required `development` or `whatsapp`. Production rejects `development`.                                                                                                                                       |
| `ANTICA_DEV_OTP_INBOX`                          | Required when OTP driver is `development`; path to a private local JSONL inbox. The sender creates the file with mode 0600.                                                                                   |
| `WHATSAPP_TOKEN`                                | Required when OTP driver is `whatsapp`; server-side WhatsApp Business token.                                                                                                                                  |
| `WHATSAPP_PHONE_NUMBER_ID`                      | Required with the WhatsApp driver; sending phone-number ID.                                                                                                                                                   |
| `WHATSAPP_TEMPLATE_NAME`                        | Required with the WhatsApp driver; approved authentication template name.                                                                                                                                     |
| `ANTICA_STORAGE_DRIVER`                         | Required `local` or `s3`. Production rejects `local`.                                                                                                                                                         |
| `ANTICA_STORAGE_LOCAL_ROOT`                     | Required with local storage; private directory for immutable originals and derivatives.                                                                                                                       |
| `ANTICA_STORAGE_SIGNING_SECRET`                 | Required with local storage; at least 32 characters for short-lived transfer tokens.                                                                                                                          |
| `ANTICA_S3_BUCKET`                              | Required with S3 storage; private bucket. The API does not create a production bucket.                                                                                                                        |
| `ANTICA_S3_REGION`                              | Optional S3 region; defaults to `us-east-1`.                                                                                                                                                                  |
| `ANTICA_S3_ENDPOINT`                            | Optional server-reachable S3-compatible endpoint, such as a local MinIO endpoint.                                                                                                                             |
| `ANTICA_S3_PUBLIC_ENDPOINT`                     | Optional phone-reachable endpoint used to sign handset transfer URLs. Supply it when the internal endpoint is not reachable from Android.                                                                     |
| `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` | Optional credentials for the selected S3 endpoint; both must be supplied together, or SDK credential resolution is used. Keep both on the server.                                                             |

For an Android emulator whose local signed media URLs use `http://127.0.0.1:8080`, run `adb -s emulator-5554 reverse tcp:8080 tcp:8080` before uploads. The verified demo used this forwarding with `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080`; a physical device instead needs a reachable `BETTER_AUTH_URL`. This requirement applies to signed transfer URLs as well as ordinary API requests.

API validation reports the names of invalid fields without printing secret values. The composition opens PostgreSQL, ensures the configured collector account, selects the OTP and media adapters, and creates the authenticated Hono application. Migrations remain an explicit operator action. Run `DATABASE_URL=<intended-database-url> pnpm --filter @antica/platform db:migrate` against the intended database. Migration `0008` recovers missing latest-result links to the newest owned completed or partial analysis with output, preserving existing links and record versions. The local upgrade and replay preserved all 644 rows across 102 tables. Local fresh-process startup and bounded Android photo/observation/accepted-result restart journeys pass; complete native and live-provider acceptance remains open.

## Separate command and client variables

| Variable                   | Used by                                               | Purpose                                                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTICA_TEST_DATABASE_URL` | PostgreSQL/API integration specs and root coverage    | Required isolated migrated acceptance database. Never use a production database.                                                                                                                                                                                            |
| `EXPO_PUBLIC_API_URL`      | Expo mobile auth/client                               | Required explicit HTTP(S) origin without credentials, path, query, or fragment. Non-development builds require HTTPS. An Android emulator can use `http://10.0.2.2:8080` in development; a physical phone needs a reachable address. Public, so it cannot contain a secret. |
| `AI_GATEWAY_API_KEY`       | API model config and live evaluator registry          | Required for selected live `gateway:` inference model IDs. The evaluator does not silently fall back to fixtures.                                                                                                                                                           |
| `OPENAI_API_KEY`           | API model config and registered transcription adapter | Required for selected live `openai:` transcription model. It is not a live inference evaluator key.                                                                                                                                                                         |

The API model configuration also binds:

| Variable                       | Requirement and behavior                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTICA_MODEL_DRIVER`          | Required `development` or `live`; production rejects `development`. Development selects labeled deterministic role IDs.                                                                              |
| `ANTICA_MODEL_PROFILES_JSON`   | Required for live mode: JSON array of unique registered profiles, each with `modelId`, `provider`, nullable `providerModelVersion`, `adapterKind: "live"`, `roles`, and declared `capabilities`.     |
| `ANTICA_MODEL_SELECTIONS_JSON` | Required for live mode: JSON object with `analysis`, `research`, `recordEditing`, and `transcription` selections. Each gives its matching role, registered `modelId`, and nonempty `profileVersion`. |

In live mode, analysis/research/record-editing IDs need a registered `gateway:` binding and `AI_GATEWAY_API_KEY`; transcription needs a registered `openai:` binding and `OPENAI_API_KEY`. All four role capabilities are checked before startup, with no implicit substitute model. The API composition passes analysis and research selections to their services and handlers; record-editing and transcription journeys need separate integrated verification.

`packages/platform/src/parsing/config.ts` separately reads these source-adapter settings. The API composition selects the parser, text retrieval, durable index writer, and public web adapter from them:

| Variable                                                                              | Required when selected                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ANTICA_PARSING_DRIVER`                                                               | Explicit `local` or `llama`; production rejects `local`.                                                                      |
| `ANTICA_TEXT_SEARCH_DRIVER`                                                           | Explicit `local` or `llama`; production rejects `local`.                                                                      |
| `LLAMA_CLOUD_API_KEY`                                                                 | Either driver uses `llama`.                                                                                                   |
| `LLAMA_PARSE_VERSION`                                                                 | Llama parsing; pin a version other than `latest`.                                                                             |
| `LLAMA_WEBHOOK_URL`, `LLAMA_WEBHOOK_SIGNING_SECRET`                                   | Optional paired LlamaParse callback settings; URL must be HTTPS. A callback setting alone does not establish remote delivery. |
| `LLAMA_CLOUD_INDEX_ID`, `LLAMA_CLOUD_SOURCE_DIRECTORY_ID`                             | Llama text search and its durable index writer.                                                                               |
| `LLAMA_TEXT_EMBEDDING_MODEL_ID`, `LLAMA_TEXT_DIMENSIONS`, `ANTICA_TEXT_INDEX_VERSION` | Llama text search; declare one compatible vector space and index version.                                                     |
| `EXA_API_KEY`                                                                         | Public web research in production; no key yields an explicit provider-unavailable result in development.                      |

The LlamaCloud Index v2 writer retains a checkpoint and maps provider chunks to canonical citations only after exact full-region text and metadata match. Split or transformed provider chunks require source review and remain unavailable; this path has no live credential run. The local PDF parser extracts selectable text and preserves photographed pages but does not run OCR or detect individual PDF figures. The LlamaParse adapter keeps provider figure/bounds data in the raw parse artifact until original-page mapping is verified; it does not fabricate image derivatives.

Image retrieval is selected independently in `apps/api/src/composition.ts`:

| Variable                                 | Requirement and behavior                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `ANTICA_IMAGE_SEARCH_DRIVER`             | Required `local` or `voyage-qdrant`; production rejects `local`.                 |
| `VOYAGE_API_KEY`                         | Required with `voyage-qdrant`; server-side image-embedding credential.           |
| `QDRANT_URL`, `QDRANT_COLLECTION`        | Required with `voyage-qdrant`; Qdrant endpoint and collection.                   |
| `QDRANT_API_KEY`                         | Optional Qdrant credential if the selected endpoint requires one.                |
| `IMAGE_EMBEDDING_MODEL_ID`               | Required with `voyage-qdrant`; `voyage-multimodal-3` or `voyage-multimodal-3.5`. |
| `IMAGE_EMBEDDING_DIMENSIONS`             | Required with `voyage-qdrant`; currently 1024.                                   |
| `IMAGE_INDEX_VERSION`, `IMAGE_CORPUS_ID` | Required with `voyage-qdrant`; explicit vector-space version and corpus scope.   |

The live image comparison adapter is selected with the research model and image index, but has no live credential run.

Workflow execution is selected separately from the API and AI providers:

| Variable                                   | Requirement and behavior                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTICA_WORKFLOW_DRIVER`                   | Required `local` or `inngest`; production requires `inngest`. Local development uses `pnpm jobs:drain` for one persisted outbox snapshot. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Both required with `inngest`; server-only event and request-signing credentials.                                                          |

With `inngest`, the API mounts signed `GET`/`POST`/`PUT` `/api/inngest` integration. Its registered function invokes the same leased drain once per minute or on `antica/jobs.drain`. The local drain has completed media, analysis, and PDF-upload batches; remote Inngest sync and event delivery remain unverified.

## Local and live service boundaries

Compose defines PostgreSQL 16 at localhost port 54329, MinIO S3 at 19000, and MinIO console at 19001. Its configuration passed a quiet parse, but the Docker daemon is unavailable on the current macOS host because privileged setup is required. An isolated native PostgreSQL 16.15 connection and migration passed; MinIO remains unrun. The local private file store is a development adapter only.

The evaluator defaults to deterministic development profiles. Live mode requires an explicit `--registry <JSON file>` and `--models` selection; registered IDs and capabilities are checked before invocation. Optional `--reviews <JSON file>` attaches reviewer identity, notes, and pending/pass/fail/not-applicable judgments bound to the exact snapshot digest, selected model, and digest of that model's output. A stale output digest leaves its judgment pending and reports a mismatch. Inference and retrieval reports remain separate; synthetic fixture scores do not establish authenticity or live-provider quality.

Production requires a private S3 bucket, WhatsApp Business authentication template and token, HTTPS API origin, persistent PostgreSQL, configured and evaluated AI/retrieval/document providers, Inngest credentials, and Fly staging checks. No production deployment, real WhatsApp message, or remote data mutation is part of this first draft.
