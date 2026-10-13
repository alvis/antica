# Antica

Antica is an Android-first private antiques collection and evidence research app for one collector. It keeps records, original media, source locations, observations, research drafts, and proposed edits separate so the collector can inspect evidence before adopting a conclusion.

This first working draft has working local flows and incomplete acceptance coverage. The [delivery report](docs/delivery-report.md) records the repository, run commands, verification, model switching, and ranked remaining work. [Implementation status](docs/implementation-status.md) distinguishes source present from checks actually run; [known limitations](docs/known-limitations.md) describes current product and operational bounds. Product authority: [Requirements](https://app.notion.com/p/3f7b2572f788812db92ae890b424de5a), [Reference](https://app.notion.com/p/3f7b2572f788812caf6eeb3886e03401), [Dev Notes](https://app.notion.com/p/3f7b2572f78881cea7c9d7b23fd90c1d), and [Deployment Notes](https://app.notion.com/p/3f7b2572f788812db736d267b2b1ad30).

## Quick start

Use Node.js 24 or newer, pnpm 11.6.0, and PostgreSQL 16. FFmpeg and FFprobe must be on `PATH` for video frames. On a Docker-ready host, this starts the declared local database and API:

```sh
pnpm install
cp .env.example .env
docker compose up -d postgres minio
DATABASE_URL='postgresql://antica:antica_dev_password@127.0.0.1:54329/antica' pnpm --filter @antica/platform db:migrate
pnpm --filter @antica/api dev
```

The example `.env` contains synthetic local secrets and a test E.164 number; replace them before storing personal data. The API loads root `.env`, while migration and seed commands read exported shell variables. For native Android work, install Android Studio, the SDK, and an emulator or device. Live providers need their server-side credentials.

## Architecture

The pnpm workspace has an Expo app in `apps/mobile`, a Hono API in `apps/api`, portable domain/contracts/application/client/UI packages, and server-only PostgreSQL, media, AI, parsing, and retrieval adapters in `packages/platform`. `tools/evaluation` compares fixed snapshots; `tools/storage-benchmark` measures seeded collection queries. Mobile uses portable contracts; the API composes application use cases with platform adapters. See [architecture decisions](docs/architecture-decisions.md) for the runtime, index, and evidence boundaries.

## Local setup

Run `pnpm install` at the workspace root; its install script bootstraps Presetter. `pnpm bootstrap` regenerates Presetter-owned configuration when needed. Copy [.env.example](.env.example) to `.env` and replace its synthetic phone and secrets before using persistent local data. Root lint checks ESLint and Prettier without rewriting files. The fresh v5 snapshot passes install, migration, lint, types, build, 751 unit tests, 6 tooling tests, 5 UI tests, 218 native tests, 19 DOM tests, and 334 integration tests. All five DOM-owned story sources reach 100% coverage. Strict 100% per-file workspace coverage remains incomplete. The delivery report preserves each run's source binding and separates scoped repairs from full acceptance.

Compose declares PostgreSQL at `127.0.0.1:54329` with development URL `postgresql://antica:antica_dev_password@127.0.0.1:54329/antica`, and MinIO at `127.0.0.1:19000` (console `19001`). On a Docker-ready host, `docker compose up -d postgres minio` starts those declared services. Docker requires privileged macOS setup on the current host, so this Compose runtime has not been tested there. An isolated native PostgreSQL 16.15 instance on port 54329 passed a connection query and migration.

Set `DATABASE_URL` to the intended development database. The API loads root `.env`, but the migration and seed commands read exported shell variables. For the Compose database:

```sh
export DATABASE_URL='postgresql://antica:antica_dev_password@127.0.0.1:54329/antica'
export ANTICA_COLLECTOR_PHONE='+15550100001' # replace for your collector
pnpm --filter @antica/platform db:migrate
pnpm --filter @antica/platform db:seed
```

The seed creates a visibly synthetic collector, location, and ceramic bowl and is disabled when `NODE_ENV=production`. Use a separate migrated database for integration tests.

The development-only local file store signs private API transfers and verifies original bytes. The S3 adapter signs bounded uploads/reads and verifies stored metadata and content. The API composition selects them with `ANTICA_STORAGE_DRIVER` and validates the corresponding local or S3 settings; see the [environment guide](docs/environment.md).

## Run the API and Android app

The API package declares `pnpm --filter @antica/api dev` as `tsx watch src/main.ts` and `pnpm --filter @antica/api start` as `tsx src/main.ts`. The entry point loads the repository-root `.env` when present, validates API, model, parsing, retrieval, and workflow configuration, composes the application, and listens on `HOST`/`PORT`. `pnpm jobs:drain` processes one persisted outbox snapshot. Local HTTP and drain smoke checks passed against PostgreSQL; see [implementation status](docs/implementation-status.md) for the tested scope. The Hono application defines `/healthz`, Better Auth paths under `/api/auth`, and private routes under `/v1`. With `ANTICA_WORKFLOW_DRIVER=inngest`, it also mounts `/api/inngest`; local development can use `ANTICA_WORKFLOW_DRIVER=local` and the explicit drain command.

The mobile package declares `pnpm --filter @antica/mobile dev` for Expo and `pnpm --filter @antica/mobile android` for native Android. Set the required `EXPO_PUBLIC_API_URL` explicitly to a phone-reachable API origin; non-development builds require HTTPS. For local Android emulators, use `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 pnpm --filter @antica/mobile dev`. A physical device needs a reachable host address. A clean Android Hermes export passed with an explicit synthetic HTTPS origin (1,581 modules, 4.1 MB). The Android SDK, JDK 17, and an API 36 arm64 emulator are installed locally. The durable Expo config plugin generated a debug APK that built and installed on the API 36 arm64 emulator. Development OTP login, authenticated Collection/Settings, both interface languages, language and session persistence after force-stop/reopen, and sign-out passed. The missing authenticated locations API was repaired. A synthetic emulator-camera photo now saves with its metadata/location, completes verified original upload and processing, renders as Ready, and survives force-stop/reopen. When local signed URLs use localhost, forward API port 8080 to the emulator with `adb -s emulator-5554 reverse tcp:8080 tcp:8080`. Three clean cold cycles produced no new development state-update warning. A typed observation and selective adoption of a development analysis Description also persist; the existing result reopens after API and app restarts with one owned run. Migration `0008` safely recovers missing latest-result links while preserving existing pointers, record versions, and immutable output. Microphone, TalkBack, and device performance remain unverified.

Better Auth permits one configured E.164 collector number. Set `ANTICA_OTP_DRIVER=development` and `ANTICA_DEV_OTP_INBOX` for local OTP delivery to a private JSONL file; production rejects that driver. Source config sets six digits, five-minute expiry, five attempts, and a server-side 60-second resend limit. Five PostgreSQL auth regressions pass, including public response privacy and OTP enforcement. Fresh-process HTTP login and private-route checks also pass; native session recovery after force-stop/reopen passed on the emulator.

The Settings screen contains account information, sign-out, and an English or Traditional Chinese language choice that persists in device secure storage. English interface copy uses US English. Both language choices persisted after native force-stop/reopen. Text-scaling and TalkBack checks remain open.

A sanitized 48.3-second Android demo shows the saved synthetic photo record, persisted observation, reopened development analysis, Accepted Description, and both Settings languages. The account value is masked throughout. This recording covers one single-photo development journey; complete native and live-provider acceptance remain open.

Shared React Native components have interactive React Native Web stories. Run `pnpm --filter @antica/ui storybook` on port 6006, or `pnpm --filter @antica/ui build:storybook` for a static build. The current catalog has 26 states across eight titles, including capture, record, and analysis containers. Rendered checks verify edited-record persistence after refetch, an enabled Analyze action, accepted proposal state, query retry, and crop/rotation selection. Feature fixtures isolate authentication from the real API. This catalog uses isolated canvases; Docs is not enabled. Enabling simultaneous inline Docs canvases would require fixture isolation. Provider and route stories remain incomplete; web checks and native Android acceptance are separate.

## Tests and evaluation

Root scripts declare `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm test:coverage`, and `pnpm build`. Root tests include UNIT, coverage-tooling, shared UI, and mobile phases. Mobile separates native Jest tests from a real React Native Web DOM harness; the other packages use Presetter/Vitest 4.1.11. Root strict coverage uses the maintained Istanbul provider. The mobile coverage gate binds fresh collector receipts to the complete source inventory and requires 100% for every eligible file across the native and DOM scopes. `ANTICA_TEST_DATABASE_URL` must name an isolated migrated acceptance database for PostgreSQL checks.

`pnpm typecheck` first validates root configuration and tooling, then checks each package with its owning configuration. Presetter generates the root TypeScript scope separately from package sources; generated build-info files are ignored.

The current scoped native run passes 47 suites/218 tests, then fails strict coverage at 98.36% statements, 97.32% branches, 99.54% functions, and 98.31% lines. Nineteen DOM tests pass with all five assigned sources at 100%. The fresh v5 combined root coverage run has 1,083 passing tests and two API startup-test failures; it emits no coverage threshold report. The startup isolation repair preserves the timeout and assertions; its isolated combined rerun passes all 132 files/1,085 tests. Root coverage is 99.47% statements, 99.40% branches, 99.86% functions, and 99.46% lines, so strict 100% per-file coverage still fails. Generated launcher and tool-resolution changes prevent aggregate dependency-binding clearance for that copied run. Full workspace and native/provider acceptance remain open. Read [implementation status](docs/implementation-status.md) for the literal scope and limits.

The evaluation package declares `start` (inference), `retrieval`, and `sensitivity` scripts. Example invocations:

```sh
pnpm --filter @antica/evaluation start -- --snapshot synthetic-evidence-v1 --models development:evidence-v1 development:evidence-v2 --output inference-results.json
pnpm --filter @antica/evaluation retrieval -- --limit 1 --output retrieval-results.json
pnpm --filter @antica/evaluation sensitivity -- --output sensitivity-results.json
```

Inference reports preserve a snapshot digest, requested/resolved model data, schema and citation checks, and latency/usage where known. The CLI accepts `--reviews <JSON file>` for explicit reviewer identity, notes, and pending/pass/fail/not-applicable judgments on unsupported claims, uncertainty, source disagreement, Traditional Chinese, and next actions. Each review binds the snapshot, selected model, and exact generated output digest; a stale output leaves judgment pending and reports a mismatch. Retrieval uses a separate authored synthetic corpus. Fixture scores are not authenticity judgments or cloud-provider quality measures.

## Live models and providers

Roles are `analysis`, `research`, `recordEditing`, and `transcription`. Set `ANTICA_MODEL_DRIVER=development` for labeled local adapters. Live mode requires `ANTICA_MODEL_PROFILES_JSON` and `ANTICA_MODEL_SELECTIONS_JSON` with all four registered, capability-compatible roles. Changing one already registered compatible model ID in selections does not require changing the application use case; unknown or incompatible IDs fail before execution. Gateway inference uses server-side `AI_GATEWAY_API_KEY`; registered OpenAI transcription uses `OPENAI_API_KEY`. Missing live bindings fail explicitly, with no development fallback. The evaluation CLI separately accepts `--registry <JSON file>` and `--models` IDs.

Local PDF parsing extracts text and preserves photographed pages but has no OCR or individual PDF-figure extraction; pages without usable text are marked for review. The API composition selects local or LlamaParse parsing, local or LlamaCloud Index v2 text retrieval, Exa public research, and local or Voyage/Qdrant image retrieval. Llama text indexing retains canonical region identity and only maps returned provider chunks when complete region text and metadata match; split or transformed chunks remain unavailable for source review. Live credentials and acceptance runs are still needed to establish operational behavior.

## 🧰 Support Matrix

Legend: `| ✅ Supported | ⚠️ Partial (see note) | ❌ Unsupported | 🔜 Planned |`

| Runtime or provider                        | Status                | Evidence and boundary                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local API, PostgreSQL, and file store      | ⚠️ Partial (see note) | Fresh-process HTTP checks pass login, collection, media, analysis/adoption, saved knowledge/research, and signed current/historical source reads. Full acceptance remains incomplete.                                                                 |
| Expo Android                               | ⚠️ Partial (see note) | Hermes export and debug APK build/install passed; English login rendered with the proven host fix. Durable-source development login, bilingual Settings, force-stop/reopen persistence, and sign-out passed; complete device journeys remain partial. |
| Development AI and evaluator               | ✅ Supported          | Deterministic authored fixtures and focused CLI/tests passed; no authenticity or live quality claim.                                                                                                                                                  |
| Local PDF parser                           | ⚠️ Partial (see note) | Selectable text and photographed pages; individual PDF figures and OCR are unavailable.                                                                                                                                                               |
| Live WhatsApp, S3, AI, parsing, and search | ⚠️ Partial (see note) | Adapters and configuration exist; credential-backed acceptance has not run.                                                                                                                                                                           |
| Inngest workflow                           | ⚠️ Partial (see note) | Signed route and scheduler source/tests exist; remote event delivery is unverified.                                                                                                                                                                   |
| Local OCR                                  | ❌ Unsupported        | No local OCR adapter is configured.                                                                                                                                                                                                                   |

## Known limits

See [known limitations](docs/known-limitations.md) for product and operational bounds, and [implementation status](docs/implementation-status.md) for the acceptance evidence still needed.
