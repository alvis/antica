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

Run `pnpm install` at the workspace root; its install script bootstraps Presetter. `pnpm bootstrap` regenerates Presetter-owned configuration when needed. Copy [.env.example](.env.example) to `.env` and replace its synthetic phone and secrets before using persistent local data. Root lint checks ESLint and Prettier without rewriting files. The historical v5 snapshot passed install, migration, lint, types, build, 751 unit tests, 6 tooling tests, 5 UI tests, 218 native tests, 19 DOM tests, and 334 integration tests. All five then-owned DOM story sources reached 100% coverage. Strict 100% per-file workspace coverage remained incomplete. The delivery report preserves each run's source binding and separates scoped repairs from full acceptance.

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

Run the Maestro journeys with the development API and a running debug build: `pnpm e2e:android <sample.jpg>`. The runner requests an OTP (flow 01), reads the code from the API's development inbox (`apps/api/.antica-dev/otp-inbox.jsonl` unless `ANTICA_DEV_OTP_INBOX` says otherwise), signs in (02), replaces the emulator gallery with the sample image and waits until it is indexed, imports it and reopens the record (03), then photographs the emulator's virtual scene and waits for the upload (04). It needs `maestro` and `adb` on `PATH`, `ANTICA_OTP_DRIVER=development`, and a dedicated test emulator, because the gallery is cleared. Set `ANDROID_SERIAL` when several devices are attached, and `APP_ID`, `ANTICA_COLLECTOR_PHONE`, or `MEDIA_PICKER_ITEM` to override the defaults.

Better Auth permits one configured E.164 collector number. Set `ANTICA_OTP_DRIVER=development` and `ANTICA_DEV_OTP_INBOX` for local OTP delivery to a private JSONL file; production rejects that driver. Source config sets six digits, five-minute expiry, five attempts, and a server-side 60-second resend limit. Five PostgreSQL auth regressions pass, including public response privacy and OTP enforcement. Fresh-process HTTP login and private-route checks also pass; native session recovery after force-stop/reopen passed on the emulator.

The Settings screen contains account information, sign-out, and an English or Traditional Chinese language choice that persists in device secure storage. English interface copy uses US English. Both language choices persisted after native force-stop/reopen. Text-scaling and TalkBack checks remain open.

A sanitized 48.3-second Android demo shows the saved synthetic photo record, persisted observation, reopened development analysis, Accepted Description, and both Settings languages. The account value is masked throughout. This recording covers one single-photo development journey; complete native and live-provider acceptance remain open.

Shared React Native components have interactive React Native Web stories. Run `pnpm --filter @antica/ui storybook` on port 6006, or `pnpm --filter @antica/ui build:storybook` for a static build. The last bound static Storybook build indexed 26 entries across eight titles, including capture, record, and analysis containers. Later QueryState and Screen story expansion is not included in that bound index, so no current expanded-catalog count is claimed. Prior rendered checks verified edited-record persistence after refetch, an enabled Analyze action, accepted proposal state, query retry, and crop/rotation selection. Feature fixtures isolate authentication from the real API. This catalog uses isolated canvases; Docs is not enabled. Enabling simultaneous inline Docs canvases would require fixture isolation. Provider and route stories remain incomplete; complete rendered-browser and native Android acceptance remain open.

## Tests and evaluation

Root scripts declare `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int`, `pnpm test:coverage`, and `pnpm build`. Root tests include UNIT, coverage-tooling, shared UI, and mobile phases. Mobile separates native Jest tests from a real React Native Web DOM harness; the other packages use Presetter/Vitest 4.1.11. Root strict coverage uses the maintained Istanbul provider. The mobile coverage gate binds fresh collector receipts to the complete source inventory and requires 100% for every eligible file across the native and DOM scopes. Set `ANTICA_TEST_DATABASE_URL` to a loopback PostgreSQL URL whose database name contains an underscore-delimited `test` or `tests` token. The API and runner-managed Platform suites use its credentials to connect to the administrative `postgres` database, create uniquely named test databases, and clean up their owned resources after worker connections close. The configured test-name path is an identity marker and is never opened by those runners; the account needs CREATE/DROP DATABASE privileges. Other PostgreSQL fixtures retain their own isolated-database setup and connect through that URL, so full workspace runs need an existing disposable test database at the configured path. Never point test configuration at a production service.

`pnpm typecheck` first validates root configuration and tooling, then checks each package with its owning configuration. Presetter generates the root TypeScript scope separately from package sources; generated build-info files are ignored.

The historical v5 scoped native run passed 47 suites/218 tests, then failed strict coverage at 98.36% statements, 97.32% branches, 99.54% functions, and 98.31% lines. Its 19 DOM tests passed with all five then-assigned sources at 100%. The historical v5 combined root coverage run had 1,083 passing tests and two API startup-test failures; it emitted no coverage threshold report. The startup isolation repair preserved the timeout and assertions; the historical v6 copied-workspace rerun passed all 132 files/1,085 tests. Root coverage reported 99.47% statements, 99.40% branches, 99.86% functions, and 99.46% lines, so unchanged strict 100% per-file coverage still failed. Generated launcher and tool-resolution changes prevented aggregate dependency-binding clearance for that copied run. These receipts remain useful historical evidence, not current-source clearance.

Current bounded mobile retirement evidence covers 17 selected native cases—12 canonical plus 5 guard/lifetime cases—across the same 3 measured sources and 49 DOM cases across 8 owned sources, with all four metrics at 100%. Seven original component cases were retired with exact bytes and replacement mapping preserved. The common `finally` cleanup sensitivity remains accepted, while the injected-only cleanup survivor is a qualification rather than an additional cleanup oracle. Separately, five original UI component cases were retired with bytes and mapping preserved; 10 native UI tests passed at strict 100% for their measured files, and the unchanged 18-test DOM proof retains its separate binding. These receipts reused installed modules. Prior rendered checks ran, but complete rendered-browser, native-device, and provider acceptance remain open.

Before R7/R7a, an exact-body/source-bound ingestion proof ran 99 tests across the same 6 consumer files and emitted all 18 selected runtime sources at strict 100%. Six relocated sensitivity checks recorded 0/1/0 baseline, mutant, and restored exits, and a citation supplement executed parity for nine identifiers including the persisted citation and its writer/provider link. Because R7/R7a changed current production bytes, those runtime receipts are historical rather than current final-byte execution. The subsequent R7/R7a collector passed one 99-test run across the same 6 consumers and emitted all 18 runtime files at strict 100% per file, using the current source bytes. Its installation was copied and reused, with selected dependency checks rather than fresh-install or exhaustive parity evidence. The earlier sensitivity and citation receipts remain original-body evidence under the recorded change-impact review; they were not rerun or relabeled. Fresh independent R7 review passed all seven areas, closing the four remaining scoped findings and retaining ten earlier fixes (14 fixed, zero open or new). Global acceptance remains open; the current immutable gate results are recorded below.

Fresh immutable validation on the current 537-file candidate passed installation, Presetter bootstrap, root lint and typecheck, 823 root unit tests, build, and the shared UI collectors. An affected database run on native ARM64 PostgreSQL 16 passed all 356 integration tests. Its root coverage phase passed all 1,179 tests across 144 files, but the unchanged strict gate exited 1: 99.35% statements, 99.25% branches, 99.56% functions, and 99.34% lines across 166 sources, with 10 sources below 100%.

The separate immutable mobile collectors passed all 235 native tests and all 49 DOM tests. Native strict coverage failed in 12 of 33 sources; all four metrics reached 100% across all 8 DOM sources. The database rerun stopped at root strict coverage and did not repeat the UI/mobile collectors; their unchanged-source results retain separate execution bindings.

CLI child-process coverage and image-match identity changes passed their bounded independent source reviews. Global strict coverage, native geometry, complete rendered UI, live-provider acceptance, amendment, and push remain open. Read [implementation status](docs/implementation-status.md) for the literal scope and limits.

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

Database schema changes use [Prisma migrations](packages/platform/src/database/README.md).
Existing local databases from the Drizzle trial must be recreated before applying the Prisma baseline.
