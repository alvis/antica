# PostgreSQL persistence

The platform uses Prisma ORM **7.10.1** (`prisma`, `@prisma/client`, and
`@prisma/adapter-pg`, pinned together). This is the newest matched stable release
verified for this migration. At implementation time the registry's Prisma CLI
`latest` tag pointed to an 8.0.0 release candidate without matching client or
adapter packages. PostgreSQL connections use the driver adapter and the
TypeScript `prisma-client` generator with ESM output.

`schema.prisma` describes all 104 tables. Field and model mappings preserve the
existing PostgreSQL names. `prisma.config.ts` in the package selects the schema,
migrations, seed command, and `DATABASE_URL`. The generated client lives in
`generated/`, is ignored by Git, and is regenerated during installation and the
platform typecheck. Do not commit generated client files. Presetter excludes this
generated directory from source linting. Targeted pnpm overrides omit Better
Auth's optional Drizzle ORM/CLI peers; authentication uses only its Prisma adapter.

From the repository root, with `DATABASE_URL` exported:

```sh
pnpm --filter @antica/platform db:generate # regenerate the TypeScript client
pnpm --filter @antica/platform db:dev --name describe_change # develop a migration
pnpm --filter @antica/platform db:migrate # deploy committed migrations
ANTICA_COLLECTOR_PHONE='+447700900123' pnpm --filter @antica/platform db:seed
```

The seed is development-only. Prisma generation does not require a running
database or a configured connection URL.

## Demo seed

`pnpm seed:demo` (root alias of `@antica/platform seed:demo`) fills the demo
collector's catalogue with the five objects of the approved mobile design: the
records and their six angle photos, the dish's analysis with five undecided
suggestions, the jar's retake request, the chair's edit card and the saved
knowledge entries. It resets that collector's record-side rows first, so a rerun
recreates the same state. It is development-only, and it refuses the end-to-end
owner and every phone but the demo owner `+15550100002`.

It writes through a running API, so start one first against a migrated database
with the corpus installed:

```sh
export DATABASE_URL=postgresql://… # the demo database
export ANTICA_COLLECTOR_PHONE=+15550100002 # the API binds one collector per database
export ANTICA_OTP_DRIVER=development ANTICA_DEV_OTP_INBOX=/path/to/otp.jsonl
pnpm --filter @antica/api dev # serves the API, by default on port 8080
pnpm seed:demo # set ANTICA_SEED_API_URL when the API is not at http://127.0.0.1:8080
```

The seed uploads the photos and waits for them to be processed, so while it runs,
rerun `pnpm jobs:drain` against the same database in another shell.

The photos and their licence notes live in `demo/images/`.

## Native SQL and baseline

`migrations/0_init/migration.sql` reproduces main's schema from migrations 0000–0008: 102 tables, 20 check constraints and 168 foreign keys. `1_edit_draft_adoption_events/migration.sql` adds adoption history and its owner-scoped draft identity; `2_record_messages/migration.sql` adds record messages, bringing the chain to 104 tables, 24 checks and 172 foreign keys. Native SQL retains partial indexes, composite owner identities, cascading authentication ownership, defaults and foreign keys.
Prisma's partial-index support is enabled by introspection; check constraints
remain native SQL in the migration. The actual schema contains no generated
columns, extensions, or triggers. The previous `generated.spec.int.ts` tests
referred to generated migration DDL rather than generated PostgreSQL columns.

Parameterized `$queryRaw`/`$executeRaw` statements preserve PostgreSQL-specific
queries and semantics, including transaction time, full-text search, lateral
projections, and conflict targets using partial indexes. Bind all application
values through tagged templates or `Prisma.sql`. Never interpolate an unchecked
identifier or use an unsafe raw-query call with user input.

The idempotent repair for missing latest-analysis pointers is retained at the
end of the baseline. It does nothing on a fresh database. Deploying the complete migration chain reproduces the previous final database; it does not upgrade an existing Drizzle-managed database. There are no deployed databases to upgrade.

Database `now()` defaults are represented as `@default(dbgenerated())`. Their
expressions remain in the baseline SQL. This preserves PostgreSQL transaction
time; this Prisma client evaluates `@default(now())` on the application clock.
Writing `dbgenerated("now()")` produces a false migration diff against Prisma's
normalized database default. Native constraint/default changes must be reviewed
in SQL as well as in the Prisma schema.

Connections explicitly select UTC because the PostgreSQL adapter decodes raw
`timestamptz` values as UTC. Interactive transactions preserve rollback and
outbox atomicity, and normalize Prisma unique violations to the existing
`23505` error contract. Closing a connection permanently disables its adapter,
matching the previous pool's behavior.

## Equivalence verification

The split chain was deployed with Prisma to a throwaway PostgreSQL 16 database and compared with ORM01's original post-0010 `0_init`. Schema-only `pg_dump --no-owner --no-privileges` outputs were identical: **zero differing lines**, with 104 application tables, 24 checks and 172 foreign keys. The stage-01 baseline independently matched main's migrations 0000–0008 at `012f1504e730`, with 102 tables, 20 checks and 168 foreign keys.

For the comparison, omit only the `drizzle` bookkeeping schema and
`public._prisma_migrations`, then discard pg_dump comments and its random
`\restrict`/`\unrestrict` tokens. Do not normalize application DDL. Retrieve the historical SQL from main at `012f1504e730` and the original feature tip `015dd9a982005b4b832532a91470f69d4952b92f` to repeat the proof; it is intentionally
absent from the Prisma migration directory.

The generated-schema integration suite independently runs `prisma migrate diff`
from the committed migration directory to `schema.prisma`, requires an empty
diff, verifies that a temporary extra model causes exit code 2, then repeats the
unchanged baseline comparison.

## Recreate a development database

Local databases using the previous migration history must be recreated. Stop
only your own API process, choose a disposable development database name, and
create it through `createdb` or your PostgreSQL administration tool. Point
`DATABASE_URL` at the new database, run `db:migrate`, then `db:seed`. Switch your
API to that URL. Drop an old development database only after confirming it
contains no data you need. Do not use `migrate reset` against shared databases.

Integration suites require `ANTICA_TEST_DATABASE_URL` to identify a loopback
PostgreSQL test database with permission to create/drop databases. Fixtures
provision unique databases and close their pools before dropping them; the
platform runner does not migrate or truncate the supplied administrative
database. API acceptance suites also use that isolated base directly: migrate
it explicitly with `DATABASE_URL="$ANTICA_TEST_DATABASE_URL" pnpm --filter
@antica/platform db:migrate` before running API integration tests. The strict
migration-refusal fixture requires PostgreSQL 16. API integration cases allow
30 seconds for migration subprocess startup and database-backed workflows. The migration drift test uses
an independently owned shadow database and `prisma migrate diff` to compare the
committed migrations with the Prisma schema.

Documentation consulted:

- https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client
- https://www.prisma.io/docs/orm/reference/prisma-config-reference
- https://www.prisma.io/docs/orm/overview/databases/postgresql
- https://www.better-auth.com/docs/adapters/prisma
