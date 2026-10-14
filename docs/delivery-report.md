# First working draft delivery

Antica now has a runnable Expo Android app, a Hono API, real PostgreSQL persistence, private signed media transfers, explicit analysis and research workflows, and English/Traditional Chinese Settings. This is a development draft with incomplete acceptance coverage. The [requirements matrix](implementation-status.md) records each FR and PT; [known limitations](known-limitations.md) separates product boundaries from execution results. The authoritative [Code Specification](https://app.notion.com/p/3f7b2572f78881a39becf965abbf9f2a) remains external.

## Built features and boundaries

- One-collector Better Auth login with a private local OTP inbox or a configured WhatsApp Business adapter.
- Single and set collection records, components, locations, filters, observations, immutable original media, signed uploads/reads, derived previews, EXIF mapping, and variable-frame video extraction.
- Explicit analysis requests with immutable snapshots, schema-validated cited output, separate failed-invocation audit history, proposed edits, inspection actions, selective adoption, revision conflicts, and replay handling.
- Audio/transcription and record-edit drafts with explicit confirmation rather than automatic changes to the collector's record.
- Versioned knowledge/source records, local or LlamaParse ingestion, PDF pages, optional book-page crop/rotation views, original-source navigation, research drafts, saved references, and local or live text/image retrieval.
- Persisted outbox/job execution with an explicit local drain or an Inngest integration; separate inference and retrieval evaluation tools.
- US English interface copy, Traditional Chinese localization, secure-storage language preference, and a Settings screen.

Fresh-process HTTP checks against real PostgreSQL exercise login/private-route denial, record/set creation, signed uploads and media drain, observations, analysis/snapshot reuse/action/adoption, saved knowledge/research, and current/historical signed source reads. These server checks do not establish complete Android photo, audio, citation, or restart journeys. Development inference is deterministic and labeled; its output is not an authenticity assessment.

## Repository changes

The monorepo follows the Core precedent with pnpm 11.6.0, Node.js 24, Presetter 9.1.0, TypeScript 6, Vitest, Jest, and separate portable/server-only packages.

```text
apps
  api                   # Hono composition, authenticated routes, jobs and startup
  mobile                # Expo Router journeys, localization and Settings
packages
  application           # Use cases and consumer-owned ports
  client                # Portable API client
  contracts             # Strict shared Zod contracts
  domain                # Pure collection/evidence semantics
  platform              # PostgreSQL, auth, storage, media, models and providers
  ui                    # Shared React Native controls and Storybook
tools
  evaluation            # Frozen inference/retrieval reports and sensitivity checks
  storage-benchmark     # Seeded scale/thumbnail measurements
tooling                 # Shared configuration helpers
docs                    # Runbook, architecture, coverage and limitations
```

Nine additive migration steps, `0000` through `0008`, define persistent data; `0006_analysis_failure_audits.sql` adds separate failure history and preserved all 13 existing analysis rows during the runtime check. Migration `0007` promotes the existing owner/id unique indexes to native constraints so fresh generated DDL can create composite foreign keys. Its local upgrade preserved all 610 existing rows, 168 foreign-key identities, and both unique-index identities. Migration `0008` backfills only missing latest-result pointers to the newest owned completed or partial run with output. Its local application preserved all 102 table counts, 644 rows, record versions, existing pointers, and historical data; three eligible null pointers were recovered, and replay changed nothing. Root configuration includes `presetter.config.ts`, `pnpm-workspace.yaml`, CI, Compose, Docker, and Fly files. The mobile config plugin explicitly enables React development support in debug builds and preserves release behavior. The initial publication captures this working draft on `main`; the verification limits below remain part of the delivery.

## Run locally

Use PostgreSQL 16, Node.js 24 or newer, pnpm 11.6.0, and FFmpeg/FFprobe. Installation, Presetter bootstrap, migration, API startup, local job drain, Storybook build, and Android build/export have executed successfully on this host. Compose is provided for a Docker-ready host; its runtime has not been exercised here because the Docker daemon requires host setup.

```sh
pnpm install
cp .env.example .env
```

Set the collector phone and development secrets in `.env`. Start PostgreSQL using the supplied Compose configuration or an existing local PostgreSQL instance. Then export the database URL for commands that do not load `.env`:

```sh
export DATABASE_URL='postgresql://antica:antica_dev_password@127.0.0.1:54329/antica'
pnpm --filter @antica/platform db:migrate
pnpm --filter @antica/api start
```

Start the app in a separate terminal with an explicit emulator-reachable API URL. The working native Metro run used LAN hosting:

```sh
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 pnpm --filter @antica/mobile exec expo start --dev-client --host lan
```

Use `pnpm --filter @antica/mobile android` to build/run through Expo on a configured Android SDK/JDK 17 host. A physical handset needs a reachable host address instead of `10.0.2.2`. Non-development builds require an HTTPS API origin. The API's `BETTER_AUTH_URL` must also be reachable for auth and signed transfers.

For local login, keep `ANTICA_OTP_DRIVER=development` and set `ANTICA_DEV_OTP_INBOX`. Request a code in the app, read the latest matching code from that private JSONL file, and enter it on the verification screen. There is no fixed universal OTP and no WhatsApp message in this mode. Production rejects the development driver. `pnpm jobs:drain` processes one persisted outbox snapshot in local workflow mode.

## Verification

Current repairs have separate source-bound receipts: the schema/source/index scope passes 14 tests and 14 mutation groups with strict 100% coverage; search passes 142 tests and 29 mutation proofs, with one retained image-dimensions guard below 100%; analysis/evidence passes 20 tests with three new guard sensitivity proofs, while three analysis invariants remain uncovered. AI adapters and evaluation pass 119 tests across 18 runtime files at strict 100%.

Current bounded mobile retirement evidence covers 17 selected native cases—12 canonical plus 5 guard/lifetime cases—across the same 3 measured sources and 49 DOM cases across 8 owned sources, with every metric at 100%. Seven original component cases were retired with exact bytes and replacement mapping preserved. The common `finally` cleanup sensitivity remains accepted, while the injected-only cleanup survivor remains a qualification rather than an additional cleanup oracle. Separately, five original UI component cases were retired with bytes and mapping preserved; 10 native UI tests passed at strict 100% for their measured files, and the unchanged 18-test DOM proof retains its separate binding. The last bound static Storybook build exited 0 with 26 indexed entries; later QueryState and Screen story expansion is not included in that count. Prior rendered checks ran, but complete rendered-browser, native-device, and provider acceptance remain open.

Before R7/R7a, an exact-body/source-bound ingestion proof ran 99 tests across the same 6 consumer files and emitted all 18 selected runtime sources at strict 100%. Six relocated sensitivity checks recorded 0/1/0 baseline, mutant, and restored exits, and a citation supplement executed parity for nine identifiers including the persisted citation and its writer/provider link. These receipts are historical for the pre-R7 bodies, not current final-byte execution. The subsequent R7/R7a collector passed one 99-test run across the same 6 consumers and emitted all 18 runtime files at strict 100% per file, using the current source bytes. Its installation was copied and reused, with selected dependency checks rather than fresh-install or exhaustive parity evidence. The earlier sensitivity and citation receipts remain original-body evidence under the recorded change-impact review; they were not rerun or relabeled. Fresh independent R7 review passed all seven areas, closing the four remaining scoped findings and retaining ten earlier fixes (14 fixed, zero open or new). Global acceptance remains open; the current immutable gate results are recorded below.

The historical v5 mobile native scope passed 47 suites/218 tests with unchanged source hashes, then failed strict coverage at 98.36% statements, 97.32% branches, 99.54% functions, and 98.31% lines. The historical v5 DOM scope passed 19 tests and strict 100% in all five assigned sources; eleven seeded defects failed the intended cases and passed after restoration. The historical source/receipt binding gate had six passing tests. The historical v5 snapshot passed install, bootstrap, owned database migration, lint (0 errors/2,025 warnings), tooling-first typecheck, build, and the complete root test command: 751 UNIT, 6 tooling, 5 UI, 218 native, and 19 DOM tests. Integration passed 47 files/334 tests. Its code/config/test manifest is `853e9ba0da8dd099069680b846a7e844cb87ad3ef59aed890312bd1609caae5a` (480 files; 486 durable inputs). Historical root strict coverage exited 1 with 1,083 passing tests and two API startup-test failures: a 30-second timeout followed by duplicate startup logging. It emitted no root coverage report or threshold results. UI coverage passed all four metrics at 100%; DOM passed all five sources at 100%. Native tests passed, but 13 of 34 measured files missed the unchanged 100% per-file thresholds; unified verification was blocked with no exit status. The startup isolation repair passed 14 focused tests, strict 100% entry-point coverage, types, lint, and formatting. The 30-second timeout and assertions remained unchanged. The historical isolated v6 copied-workspace rerun passed all 132 files/1,085 tests, including all 14 startup cases. Official Istanbul reported 99.47% statements, 99.40% branches, 99.86% functions, and 99.46% lines; ten measured files still missed the unchanged 100% per-file thresholds, so the command exited 1. The API entry point reached 100% across all four metrics. V6 changed only the startup test in the code manifest and copied the v5 installed dependencies. Its final audit detected regenerated package launchers, including three changed executable resolutions and a changed esbuild resolution for Vitest and Istanbul; aggregate dependency binding was not cleared (`gatesCurrentForLiveCode=false`). The 1,085 passing tests and coverage report remain executed diagnostic evidence bound to that historical run. Unchanged source/configuration and independent collector evidence retained their own v5 bindings. V5 remains preserved as historical evidence. These results do not establish full acceptance.

Fresh immutable validation on the current 537-file candidate passed installation, Presetter bootstrap, root lint and typecheck, 823 root unit tests, build, and the shared UI collectors. An affected database run on native ARM64 PostgreSQL 16 passed all 356 integration tests. Its root coverage phase passed all 1,179 tests across 144 files, but the unchanged strict gate exited 1: 99.35% statements, 99.25% branches, 99.56% functions, and 99.34% lines across 166 sources, with 10 sources below 100%.

The separate immutable mobile collectors passed all 235 native tests and all 49 DOM tests. Native strict coverage failed in 12 of 33 sources; all four metrics reached 100% across all 8 DOM sources. The database rerun stopped at root strict coverage and did not repeat the UI/mobile collectors; their unchanged-source results retain separate execution bindings.

CLI child-process coverage and image-match identity changes passed their bounded independent source reviews. Global strict coverage, native geometry, complete rendered UI, live-provider acceptance, amendment, and push remain open. These results do not establish full acceptance.

The sanitized 48.3-second Android recording shows Collection, the Ready photo and persisted observation, the completed development result with Accepted Description, and English/Traditional Chinese Settings. It was recorded after migration `0008` and the API restart proof. The account value is masked in all retained Settings frames. Settings now contains account, sign-out, and language controls; Environment and Privacy sections have been removed in both languages. The recording predates that Settings simplification. The emulator remains on authenticated English Collection. This is a synthetic single-photo journey, with complete native/provider acceptance still open.

### Historical v3

The immutable v3 snapshot contains 537 files, digest `30dfca2cc81a19e7c173df609e0844bfb70816e2da0e744413372933b8bc8db7`. Fresh install, migration, root lint, declared workspace typecheck, and build pass. Lint has zero errors and 2,004 warnings. The backend unit phase passes 81 files/705 tests; integration passes 27 files/179 tests against a fresh PostgreSQL database. All 108 files/884 tests in the combined coverage run pass, then unchanged strict 100% per-file thresholds fail. Earlier failed receipts remain intact.

| Executed command or phase                                                                               | Result                                                                                 |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (including Presetter bootstrap)                                        | Pass on v3                                                                             |
| `pnpm bootstrap`                                                                                        | Passed in earlier setup; unchanged Presetter helper also passed bootstrap after repair |
| `pnpm --filter @antica/platform run db:migrate`                                                         | Pass on fresh v3 database                                                              |
| `pnpm lint`                                                                                             | Pass: 0 errors, 2,004 warnings                                                         |
| `pnpm typecheck` and `pnpm build`                                                                       | Pass on v3                                                                             |
| `pnpm exec vitest run --passWithNoTests --configLoader runner --project='*:UNIT'`                       | Pass: 705 tests                                                                        |
| `pnpm test:int` with isolated database variables                                                        | Pass: 179 tests                                                                        |
| `pnpm --filter @antica/mobile test`                                                                     | Pass: 42 suites/190 tests; unchanged-input finaldelta evidence                         |
| `pnpm --filter @antica/ui test:coverage`                                                                | Pass: two suites/five tests; unchanged-input v2 evidence                               |
| Combined Vitest UNIT/INT coverage phase of `pnpm test:coverage`, with explicit 100% per-file thresholds | Fail on thresholds; 884 tests pass                                                     |
| `pnpm --filter @antica/mobile test:coverage`                                                            | Fail on thresholds; 190 tests pass                                                     |
| `pnpm --filter @antica/ui build:storybook`                                                              | Pass; unchanged-input finaldelta evidence                                              |

At v3, the root `pnpm test` script combined UNIT with mobile and UI tests. Those constituent phases have the historical source-bound passes above; this is not a claim that one fresh aggregate invocation ran on v3. The current root script also runs coverage-tooling tests, and mobile now runs separate native and DOM phases. The coverage phases were executed separately to retain both failures. Mobile aggregate coverage is 95.64% statements, 95.03% branches, 95.24% functions, and 95.59% lines. The earlier Android Hermes export and repository scanner retain their historical v2 bindings; they are not fresh v3 checks. The later native APK and browser receipts bind their own runtime sources.

The bounded preview/fixture repair passes 33 tests. Three isolated mutations fail the intended cases and pass after restoration. Preview coverage is 100% statements, 97.61% branches, 100% functions, and 100% lines; its strict gate still fails. No thresholds or supported guards were removed. Browser checks establish query retry, preserved original images, and an actual transformed 4×4 crop preview from an 8×4 original. The corrected web preview passes a trusted pointer click, an explicit off-center DOM event, and keyboard center selection, with no NaN coordinates.

An Android debug APK generated through the durable Expo plugin built and installed, rendered English login, and authenticated against the local API using development OTP. Authenticated Settings switched to Traditional Chinese and back to English; each language and the authenticated session persisted after force-stop/reopen. Sign-out returned to English login. APK SHA-256: `07c304f7f429e347bf9355f4b29951dbf51708dc04454b1b8f561eef4d2ce1a5`. The missing authenticated `GET/POST /v1/locations` routes were repaired and passed nine PostgreSQL route tests. The same native single-photo draft now saves its name, measurements and location (revision 2). Runtime `adb reverse tcp:8080 tcp:8080` makes localhost signed transfers reachable from the emulator; retrying the photo completed verified upload and one successful media-processing job. The stored original byte length and SHA-256 matched database metadata. Record and Ready photo reopened after force-stop, and all three clean cold cycles reached authenticated Collection without a new development state-update warning. Microphone, TalkBack, 200% text scaling, and device performance remain unverified.

The frozen 5,000-record/100,000-media benchmark executed 800 samples across 16 scenarios, with p95 180.10–610.55 ms and four SELECTs per request. It checks signed/null covers, ownership, and complete traversal. These are service/storage timings on a contended host, without handset/network or image-generation timing claims.

## Requirements and deviations

All 14 functional requirements and 29 PT scenarios have explicit rows in the [implementation matrix](implementation-status.md). They remain partial or implemented but unverified because the full named native, real-corpus, provider, recovery, and strict coverage checks have not all passed. Bounded HTTP, database, component, evaluator, and native-login proofs are recorded without promoting them to complete scenario acceptance.

The local PDF parser has no OCR or individual figure extraction. Live LlamaCloud mappings require exact canonical text/metadata; transformed or split provider chunks remain unavailable for review. Thirty Notion mockup images could not be inspected through the available signed-in surface, so visual fidelity is unverified. The last bound static Storybook build indexed 26 shared/mobile entries across eight titles, including capture, record, and analysis containers. Later QueryState and Screen story expansion is not included in that bound index. Rendered edit/refetch and selective proposal acceptance pass with isolated authentication fixtures. Provider and route stories remain incomplete. The catalog supports isolated canvases; simultaneous inline Docs would require fixture isolation before enabling the Docs addon.

## Model switching

`packages/platform/src/ai/config.ts` reads `ANTICA_MODEL_PROFILES_JSON` and `ANTICA_MODEL_SELECTIONS_JSON`. Live selections independently configure `analysis`, `research`, `recordEditing`, and `transcription`; each uses a registered, compatible `modelId` and pinned `profileVersion`. To switch the analysis model, change only `analysis.modelId` to another registered gateway model with text/image input and structured-output capabilities, update its profile version, and restart the API. The application/domain use cases do not change. Unknown or incompatible selections fail before invocation, with no automatic development fallback.

The executed local comparison demonstrates two compatible development models on one frozen snapshot:

```sh
pnpm --filter @antica/evaluation start -- --snapshot synthetic-evidence-v1 --models development:evidence-v1 development:evidence-v2 --output inference-results.json
```

Reports bind requested/resolved model IDs, snapshot and output digests, schema/citation checks, and known latency/usage. Human judgments remain separate. Live mode requires registered `gateway:` inference bindings plus `AI_GATEWAY_API_KEY`, and an `openai:` transcription binding plus `OPENAI_API_KEY`; synthetic scores do not establish provider quality.

## External prerequisites

Production needs persistent PostgreSQL, a private S3 bucket and credentials, an HTTPS API origin, a WhatsApp Business authentication template/token/phone ID, AI Gateway/OpenAI credentials, LlamaParse/LlamaCloud configuration, Exa, Voyage/Qdrant corpus/index configuration, and Inngest keys. Fly deployment needs account/infrastructure setup and suspend/resume recovery checks. Real antiques photos, book/PDF sources, and Mandarin/Cantonese evaluation material are needed for quality acceptance. See the [environment guide](environment.md) for exact variables. No live provider call, real message, deployment, or Notion write is claimed.

## Ranked remaining work

1. Extend the passing single-record/photo/observation/accepted-result restart proof to the six-photo component-labeled set; complete voice, standalone analysis actions, source-to-knowledge, recovery, and accessibility journeys.
2. Close strict per-file runtime coverage and remaining code-quality warnings with meaningful tests and bounded refactors; finish remaining provider and route stories.
3. Validate real private storage, WhatsApp, models, parsing/retrieval, callbacks, and Inngest in staging; measure Fly suspend/resume and failed dispatch recovery.
4. Evaluate citation fidelity, source disagreement, uncertainty, Traditional Chinese, Mandarin/Cantonese transcription, and image comparisons against real authored corpora.
5. Complete supported PDF/OCR/figure and index-migration acceptance, then verify handset/network performance and mockup fidelity.
