import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import postgres from 'postgres';

import { createRecordService } from '@antica/application/server';

import { collectionQuerySchema, recordPageSchema } from '@antica/contracts';

import { createLocalMediaStore } from '@antica/platform';
import {
  createDatabase,
  migrateDatabase,
  createTransactionPort,
} from '@antica/platform/database';

import { verifyThumbnailPage } from './thumbnails.js';

import type { CollectionQuery } from '@antica/contracts';

const owner = 'antica-benchmark-synthetic-owner-v1';
const fixedTime = '2026-01-01T00:00:00.000Z';
const recordsCount = 5000;
const mediaCount = 100000;
const pageSize = 50;
const seedVersion = 'antica-pt20-thumbnail-v1';
const fixtureSecret = 'synthetic-benchmark-signing-secret-2026-only';
const fixtureBaseUrl = 'https://benchmark.invalid';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const id = (prefix: number, value: number): string =>
  `${prefix}0000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

/**
 * accepts only an explicitly selected isolated loopback benchmark database
 * @param value explicitly supplied benchmark URL
 * @returns validated URL restricted to a new local benchmark database
 */
export function validateBenchmarkUrl(value: string | undefined): URL {
  if (!value) {
    throw new Error(
      'ANTICA_BENCHMARK_DATABASE_URL is required; DATABASE_URL is never used',
    );
  }
  const url = new URL(value);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    process.env.NODE_ENV === 'production' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^antica_benchmark(?:_[a-z0-9_]+)?$/.test(name) ||
    name.length > 63 ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Benchmark requires an isolated loopback antica_benchmark[_suffix] database outside production',
    );
  }

  return url;
}

/**
 * creates a new isolated database; existing databases are never reset or reused
 * @param url
 */
async function createIsolatedDatabase(url: URL): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice(1));
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false });
  try {
    const existing =
      await admin`select datname from pg_database where datname = ${name}`;
    if (existing.length) {
      throw new Error(
        `Database ${name} already exists; choose a new isolated benchmark suffix`,
      );
    }
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

const seedSql = `
insert into locations(id,owner_id,label,normalized_label,created_at)
select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${owner}','櫃位 '||g,'location-'||g,'${fixedTime}'::timestamptz from generate_series(1,10) g;
insert into records(id,owner_id,code,name,unit_kind,piece_count,location_id,location_detail,description,created_at,updated_at)
select ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${owner}','AC-'||lpad(g::text,6,'0'),
case when g%11=0 then null else (case when g%3=0 then '青花' else '陶器' end)||lpad((g%100)::text,3,'0') end,
case when g%10=0 then 'set' else 'single' end,case when g%10=0 then 3 else 1 end,
case when g%5=0 then null else ('30000000-0000-4000-8000-'||lpad(((g-1)%10+1)::text,12,'0'))::uuid end,
'Synthetic fixture location',case when g%7=0 then '合成青花紋樣資料，並非古物鑑定。' else '合成測試資料，並非古物鑑定。' end,
'${fixedTime}'::timestamptz,'${fixedTime}'::timestamptz+(g/20)*interval '1 second' from generate_series(1,${recordsCount}) g;
insert into record_categories(record_id,category_id) select ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad((g%12+1)::text,12,'0'))::uuid from generate_series(1,${recordsCount}) g;
insert into record_materials(record_id,material_id) select ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('50000000-0000-4000-8000-'||lpad((g%8+1)::text,12,'0'))::uuid from generate_series(1,${recordsCount}) g;
insert into record_tags(record_id,tag) select ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'tag-'||(g%5) from generate_series(1,${recordsCount}) g;
insert into knowledge_entries(id,owner_id,display_code,current_revision,created_at,updated_at) values ('${id(7, 1)}','${owner}','BENCH-METHOD',1,'${fixedTime}','${fixedTime}');
insert into inspection_methods(id,owning_entry_id,current_version_id) values ('${id(7, 2)}','${id(7, 1)}','${id(7, 3)}');
insert into method_versions(id,method_id,revision,definition,content_hash,created_at) values ('${id(7, 3)}','${id(7, 2)}',1,'{"titleZhHant":"合成觀察方法","history":[],"featureEntryIds":[],"applicability":[],"observationModes":["in_person_visual"],"steps":[],"interpretationLimits":[],"exampleReferenceImageIds":[],"citations":[]}',repeat('0',64),'${fixedTime}');
insert into record_checks(id,owner_id,record_id,method_id,method_version_id,scope_key,progress,result_kind,created_at,updated_at)
select ('60000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${owner}',('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${id(7, 2)}','${id(7, 3)}','whole',case when g%4=0 then 'recorded' else 'not_started' end,case when g%4=0 then 'absent' else 'unrecorded' end,'${fixedTime}','${fixedTime}' from generate_series(1,${recordsCount}) g;
insert into media_assets(id,owner_id,record_id,kind,purpose,state,object_key,original_file_name,mime_type,byte_length,sha256,verified_at,ready_version_applied_at,created_at,updated_at)
select ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${owner}',('10000000-0000-4000-8000-'||lpad((((g-1)/20)+1)::text,12,'0'))::uuid,'photo','object','ready','synthetic-benchmark/'||g||'.jpg','synthetic-'||g||'.jpg','image/jpeg',5000000,lpad(to_hex(g),64,'0'),'${fixedTime}','${fixedTime}','${fixedTime}','${fixedTime}' from generate_series(1,${mediaCount}) g;

insert into media_derivatives(id,owner_id,original_asset_id,kind,object_key,mime_type,byte_length,sha256,width,height,created_at)
select ('80000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${owner}',('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'thumbnail','synthetic-benchmark/thumbnails/'||g||'.jpg','image/jpeg',12000,lpad(to_hex(g),64,'0'),320,240,'${fixedTime}' from generate_series(1,${mediaCount}) g where (((g-1)/20)+1)%5<>0;
-- Cross-owner derivative on the first original of record1 sorts before its valid derivative.
insert into media_derivatives(id,owner_id,original_asset_id,kind,object_key,mime_type,byte_length,sha256,width,height,created_at) values
('00000000-0000-4000-8000-000000000001','antica-benchmark-other-owner','${id(2, 1)}','thumbnail','foreign-decoy/record1.jpg','image/jpeg',12000,repeat('f',64),320,240,'${fixedTime}'),
-- Record5 must remain null: one foreign derivative and one foreign-owned original.
('00000000-0000-4000-8000-000000000002','antica-benchmark-other-owner','${id(2, 82)}','thumbnail','foreign-decoy/record5-derivative.jpg','image/jpeg',12000,repeat('f',64),320,240,'${fixedTime}'),
('00000000-0000-4000-8000-000000000003','${owner}','${id(2, 81)}','thumbnail','foreign-decoy/record5-asset.jpg','image/jpeg',12000,repeat('f',64),320,240,'${fixedTime}');
update media_assets set owner_id='antica-benchmark-other-owner' where id='${id(2, 81)}';
`;

type QueryTrace = { query: string; parameters: unknown[] };
type Scenario = { name: string; query: CollectionQuery; expected: number };

/** captures exact source and configuration identities without reading credentials */
async function captureSources(): Promise<Record<string, string>> {
  const files = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'presetter.config.ts',
    'tools/storage-benchmark/package.json',
    'tools/storage-benchmark/src/index.ts',
    'tools/storage-benchmark/src/runtime.ts',
    'tools/storage-benchmark/src/thumbnails.ts',
  ];
  for (const name of ['application', 'contracts', 'domain', 'platform']) {
    const directory = join(sourceRoot, 'packages', name, 'src');
    files.push(`packages/${name}/package.json`);
    for (const entry of await readdir(directory, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile()) {
        files.push(relative(sourceRoot, join(entry.parentPath, entry.name)));
      }
    }
  }
  const inventory: Record<string, string> = {};
  for (const file of files.toSorted()) {
    inventory[file] = createHash('sha256')
      .update(await readFile(join(sourceRoot, file)))
      .digest('hex');
  }

  return inventory;
}

/**
 * independent expected membership, including nullable names and deterministic ties
 * @param query
 */
function expectedCount(query: CollectionQuery): number {
  return Array.from({ length: recordsCount }, (_, i) => i + 1).filter((g) => {
    const name =
      g % 11 === 0
        ? ''
        : `${g % 3 === 0 ? '青花' : '陶器'}${String(g % 100).padStart(3, '0')}`;
    const description =
      g % 7 === 0
        ? '合成青花紋樣資料，並非古物鑑定。'
        : '合成測試資料，並非古物鑑定。';

    return (
      (!query.text ||
        [name, `AC-${String(g).padStart(6, '0')}`, description].some((value) =>
          value.includes(query.text!),
        )) &&
      (query.locationId === undefined ||
        query.locationId ===
          (g % 5 === 0 ? null : id(3, ((g - 1) % 10) + 1))) &&
      (!query.categoryIds?.length ||
        query.categoryIds.includes(id(4, (g % 12) + 1))) &&
      (!query.materialIds?.length ||
        query.materialIds.includes(id(5, (g % 8) + 1))) &&
      (!query.tags?.length || query.tags.includes(`tag-${g % 5}`)) &&
      (query.hasPendingChecks === undefined ||
        query.hasPendingChecks === (g % 4 !== 0))
    );
  }).length;
}

/**
 * records quantiles without replacing raw samples
 * @param samples
 */
export function summarize(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => ordered[Math.ceil(p * ordered.length) - 1]!;

  return {
    count: ordered.length,
    minMs: ordered[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: ordered.at(-1),
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

/**
 * executes the actual collection service while keeping trace and explain overhead outside timings
 * @param url
 * @param iterations
 * @param warmups
 * @param output
 * @param sources
 */
async function measure(
  url: URL,
  iterations: number,
  warmups: number,
  output: string,
  sources: Record<string, string>,
) {
  let verifiedSignedCovers = 0;
  let verifiedNullCovers = 0;
  const verifyCovers = (
    page: ReturnType<typeof recordPageSchema.parse>,
  ): void => {
    const verified = verifyThumbnailPage(page, fixtureSecret, fixtureBaseUrl);
    verifiedSignedCovers += verified.signed;
    verifiedNullCovers += verified.null;
  };
  const connection = createDatabase({ url: url.toString(), maxConnections: 1 });
  const client = connection.db.$client;
  let trace: QueryTrace[] | null = null;
  client.options.debug = (_connection, query, parameters) => {
    trace?.push({ query, parameters: [...parameters] });
  };
  const service = createRecordService(
    createTransactionPort(connection.db),
    { now: () => fixedTime },
    {
      create: () => {
        throw new Error('Listing must not generate identifiers');
      },
    },
    createLocalMediaStore({
      root: join(sourceRoot, 'unstored-media'),
      publicBaseUrl: fixtureBaseUrl,
      signingSecret: fixtureSecret,
    }),
  );
  const run = async (query: CollectionQuery, selectedOwner = owner) => {
    const result = await service.list(
      selectedOwner,
      collectionQuerySchema.parse(query),
    );
    if (!result.success) {
      throw new Error(JSON.stringify(result.error));
    }

    return recordPageSchema.parse(result.data);
  };
  try {
    const server =
      await client`select version() as version, current_database() as database, current_user as role`;
    const settings =
      await client`select name,setting,unit from pg_settings where name in ('shared_buffers','work_mem','effective_cache_size','max_connections','jit','random_page_cost') order by name`;
    const counts =
      await client`select (select count(*)::int from records) records,(select count(*)::int from media_assets) media,(select count(*)::int from record_checks) checks,(select count(*)::int from media_derivatives) derivatives`;
    if (
      counts[0]?.records !== recordsCount ||
      counts[0].media !== mediaCount ||
      counts[0].derivatives !== 80003
    ) {
      throw new Error('Unexpected benchmark cardinality');
    }
    const foreign = await run(
      { limit: pageSize },
      'antica-benchmark-other-owner',
    );
    if (foreign.items.length || foreign.nextCursor) {
      throw new Error('Owner isolation failed');
    }
    const traversal: unknown[] = [];
    const deepCursors: Record<string, string> = {};
    for (const sort of ['updated', 'code', 'name'] as const) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      let pages = 0;
      do {
        const page = await run({
          limit: pageSize,
          sort,
          ...(cursor ? { cursor } : {}),
        });
        verifyCovers(page);
        for (const item of page.items) {
          if (seen.has(item.id)) {
            throw new Error(`Duplicate ${sort} cursor item`);
          }
          seen.add(item.id);
        }
        pages++;
        if (pages % 20 === 0) {
          process.stderr.write(`traversal ${sort}: ${pages} pages\n`);
        }
        if (pages === 1 && page.nextCursor) {
          deepCursors[`${sort}_second`] = page.nextCursor;
        }
        if (pages === 94 && page.nextCursor) {
          deepCursors[`${sort}_deep`] = page.nextCursor;
        }
        cursor = page.nextCursor ?? undefined;
        if (pages > 101) {
          throw new Error('Unbounded pagination');
        }
      } while (cursor);
      if (seen.size !== recordsCount) {
        throw new Error(`Missing ${sort} cursor rows`);
      }
      traversal.push({ sort, pages, uniqueRecords: seen.size });
    }
    const baseScenarios: Array<[string, CollectionQuery]> = [
      ['updated-first', { sort: 'updated' }],
      ['updated-next', { sort: 'updated', cursor: deepCursors.updated_second }],
      ['code-first', { sort: 'code' }],
      ['code-deep', { sort: 'code', cursor: deepCursors.code_deep }],
      ['name-first', { sort: 'name' }],
      ['name-null-deep', { sort: 'name', cursor: deepCursors.name_deep }],
      ['search-chinese', { text: '青花' }],
      ['search-code', { text: 'AC-0001' }],
      ['filter-category', { categoryIds: [id(4, 1)] }],
      ['filter-material', { materialIds: [id(5, 1)] }],
      ['filter-unlocated', { locationId: null }],
      ['filter-location', { locationId: id(3, 1) }],
      ['filter-tags', { tags: ['tag-0'] }],
      ['filter-pending', { hasPendingChecks: true }],
      ['filter-unanalyzed', { freshness: 'unanalyzed' }],
      ['filter-combined', { categoryIds: [id(4, 1)], tags: ['tag-0'] }],
    ];
    const scenarios: Scenario[] = baseScenarios.map(([name, query]) => ({
      name,
      query: { ...query, limit: pageSize },
      expected: expectedCount(query),
    }));
    const raw: unknown[] = [];
    const reports: unknown[] = [];
    const plans: unknown[] = [];
    for (const scenario of scenarios) {
      const samples: number[] = [];
      let firstMs = 0;
      let responseBytes = 0;
      let thumbnailCount = 0;
      let representative: QueryTrace[] = [];
      for (let i = -warmups; i < iterations; i++) {
        const start = performance.now();
        const page = await run(scenario.query);
        const elapsedMs = performance.now() - start;
        if (i === -warmups) {
          firstMs = elapsedMs;
        }
        if (
          page.items.length > pageSize ||
          page.items.length !==
            Math.min(pageSize, scenario.query.cursor ? 300 : scenario.expected)
        ) {
          throw new Error(`Unexpected ${scenario.name} page cardinality`);
        }
        if (i >= 0) {
          samples.push(elapsedMs);
          raw.push({
            scenario: scenario.name,
            iteration: i,
            elapsedMs,
            returnedRows: page.items.length,
          });
        }
        if (i === 0) {
          responseBytes = Buffer.byteLength(JSON.stringify(page));
          thumbnailCount = page.items.filter(
            (item) => item.coverThumbnail !== null,
          ).length;
        }
      }
      trace = [];
      const verificationPage = await run(scenario.query);
      representative = trace;
      trace = null;
      verifyCovers(verificationPage);
      const unique = new Map(
        representative
          .filter((item) =>
            item.query.trimStart().toLowerCase().startsWith('select'),
          )
          .map((item) => [item.query, item]),
      );
      for (const statement of unique.values()) {
        const explained = await client.unsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
          statement.parameters as never[],
        );
        plans.push({ scenario: scenario.name, ...statement, plan: explained });
      }
      const stats = summarize(samples);
      process.stderr.write(
        `measured ${scenario.name}: p95=${stats.p95Ms.toFixed(2)}ms\n`,
      );
      reports.push({
        name: scenario.name,
        query: scenario.query,
        expectedTotal: scenario.expected,
        firstObservedMs: firstMs,
        ...stats,
        localServiceP95Within800ms: stats.p95Ms <= 800,
        responseBytes,
        nonNullThumbnails: thumbnailCount,
        statementsPerRequest: representative.length,
        selectStatementsPerRequest: representative.filter((item) =>
          item.query.trimStart().toLowerCase().startsWith('select'),
        ).length,
      });
    }
    const constraints =
      await client`select conname,contype,conrelid::regclass::text as relation,pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text in ('records','media_assets','media_derivatives','record_checks','locations') order by relation,conname`;
    const indexes =
      await client`select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('records','media_assets','media_derivatives','record_checks','locations','record_tags','record_categories','record_materials') order by tablename,indexname`;
    const datasetChecksums =
      await client`select 'records' as relation,md5(string_agg(row_to_json(r)::text,'' order by id)) as orderedRowMd5 from records r union all select 'media_assets',md5(string_agg(row_to_json(m)::text,'' order by id)) from media_assets m union all select 'media_derivatives',md5(string_agg(row_to_json(d)::text,'' order by id)) from media_derivatives d`;
    const migrations =
      await client`select id,hash,created_at from drizzle.__drizzle_migrations order by id`;
    const report = {
      kind: 'pt20-storage-service-benchmark',
      seedVersion,
      seedDigest: createHash('sha256').update(seedSql).digest('hex'),
      reportGeneratedAt: new Date().toISOString(),
      provenance: {
        sources,
        sourceDigest: createHash('sha256')
          .update(JSON.stringify(sources))
          .digest('hex'),
        sourcesUnchangedAtCompletion:
          JSON.stringify(sources) === JSON.stringify(await captureSources()),
        commandArguments: process.argv.slice(1),
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model,
        loadAverage: os.loadavg(),
        memoryBytes: os.totalmem(),
        server,
        settings,
        poolSize: 1,
        concurrency: 1,
        transport:
          'loopback PostgreSQL; no HTTP, mobile device or network emulation',
      },
      dataset: {
        counts,
        owner,
        mediaPerRecord: 20,
        mediaBytesStored: false,
        thumbnailFixture: {
          validDerivatives: 80000,
          recordsWithThumbnails: 4000,
          nullCoverRecords: 1000,
          ownerIsolationDecoyDerivatives: 3,
          foreignOwnedOriginals: 1,
          selection:
            'Earliest eligible original by createdAt then asset ID; derivative ID tie-break',
        },
        datasetChecksums,
        migrations,
      },
      methodology: {
        pageSize,
        warmups,
        iterations,
        quantile: 'nearest-rank',
        traceOutsideTiming: true,
        queryPlansOutsideTiming: true,
        fullTraversal: traversal,
        foreignOwnerReturnedRows: foreign.items.length,
        thumbnailVerification: {
          verifiedSignedCovers,
          verifiedNullCovers,
          independentHmac: true,
          expectedEarliestObjectKey: true,
          expiryFiveMinutes: true,
          verificationOutsideTiming: true,
        },
      },
      thresholds: {
        warmListApiP95Ms: 800,
        firstInteractiveScreenMs: 2500,
        network: '>=50Mbps down / >=10Mbps up / approximately100ms RTT',
      },
      scenarios: reports,
      constraints,
      indexes,
      limitations: [
        'Only service/storage duration measured; HTTP authentication/serialization/network and device rendering are unmeasured.',
        'No actual media objects or thumbnails are stored or downloaded; 100000 rows are deterministic metadata.',
        'All seeded records are unanalyzed; corpus distribution is synthetic with cross-owner decoy assets/derivatives.',
        'Real LocalMediaStore HMAC signing is included; derivative generation, media bytes, HTTP downloads and native-device performance are unmeasured.',
        '80 percent of records have thumbnail derivatives; this differs from earlier no-thumbnail benchmark fixtures and is not a controlled speedup comparison.',
        'Reported firstObservedMs is not a cold-cache or Fly wake-up measurement.',
        'PT20 end-to-end acceptance remains unmeasured; local p95 comparison is partial evidence only.',
      ],
    };
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, 'samples.jsonl'),
      raw.map((item) => JSON.stringify(item)).join('\n') + '\n',
    );
    await writeFile(
      join(output, 'query-plans.json'),
      JSON.stringify(plans, null, 2) + '\n',
    );
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );

    return report;
  } finally {
    await connection.close();
  }
}

/** runs an isolated synthetic collection benchmark from explicit CLI arguments */
export async function runStorageBenchmark(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: 'string', default: 'benchmark-results' },
      iterations: { type: 'string', default: '100' },
      warmups: { type: 'string', default: '10' },
    },
  });
  const iterations = Number(values.iterations);
  const warmups = Number(values.warmups);
  if (
    !Number.isInteger(iterations) ||
    iterations < 20 ||
    iterations > 1000 ||
    !Number.isInteger(warmups) ||
    warmups < 1 ||
    warmups > 100
  ) {
    throw new Error('iterations20..1000 and warmups1..100 required');
  }
  const url = validateBenchmarkUrl(process.env.ANTICA_BENCHMARK_DATABASE_URL);
  const sources = await captureSources();
  await mkdir(values.output);
  process.stderr.write(`creating isolated database ${url.pathname}\n`);
  await createIsolatedDatabase(url);
  await migrateDatabase({ url: url.toString() });
  const client = postgres(url.toString(), { max: 1, prepare: false });
  try {
    await client.begin(async (tx) => {
      await tx.unsafe(seedSql);
    });
    await client.unsafe('ANALYZE');
  } finally {
    await client.end();
  }
  process.stderr.write('seeded 5000 records and 100000 media rows\n');
  const report = await measure(
    url,
    iterations,
    warmups,
    values.output,
    sources,
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
