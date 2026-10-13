import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { runStorageBenchmark, validateBenchmarkUrl } from './runtime.js';

interface BenchmarkReport {
  methodology: {
    thumbnailVerification: {
      verifiedSignedCovers: number;
      verifiedNullCovers: number;
    };
  };
  scenarios: Array<{ name: string; count: number; responseBytes: number }>;
}

interface BenchmarkSample {
  scenario: string;
  iteration: number;
  elapsedMs: number;
  returnedRows: number;
}

interface BenchmarkPlan {
  scenario: string;
  plan: unknown[];
}

const configuredUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!configuredUrl) {
  throw new Error('ANTICA_TEST_DATABASE_URL must identify local PostgreSQL');
}
const connectionUrl = new URL(configuredUrl);
connectionUrl.pathname = '/antica_benchmark_test';
validateBenchmarkUrl(connectionUrl.toString());

describe('fn:runStorageBenchmark', () => {
  it('should preserve a preexisting database and refuse to publish a report', async () => {
    const databaseName = `antica_benchmark_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(connectionUrl);
    url.pathname = `/${databaseName}`;
    const adminUrl = new URL(connectionUrl);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });
    const database = postgres(url.toString(), { max: 1 });
    const directory = await mkdtemp(join(tmpdir(), 'antica-benchmark-test-'));
    const output = join(directory, 'results');
    const previousArguments = process.argv;
    process.argv = [
      'node',
      'benchmark',
      '--iterations',
      '20',
      '--warmups',
      '1',
      '--output',
      output,
    ];
    vi.stubEnv('ANTICA_BENCHMARK_DATABASE_URL', url.toString());

    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      await database`create table preserved_evidence (value text)`;
      await database`insert into preserved_evidence values ('do not reset')`;

      await expect(runStorageBenchmark()).rejects.toThrow();

      expect(await database`select value from preserved_evidence`).toEqual([
        { value: 'do not reset' },
      ]);
      await expect(readFile(join(output, 'report.json'))).rejects.toMatchObject(
        { code: 'ENOENT' },
      );
    } finally {
      process.argv = previousArguments;
      await database.end();
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should persist reproducible traversal, samples and query plans from isolated storage', async () => {
    const databaseName = `antica_benchmark_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(connectionUrl);
    url.pathname = `/${databaseName}`;
    const adminUrl = new URL(connectionUrl);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });
    const directory = await mkdtemp(join(tmpdir(), 'antica-benchmark-test-'));
    const output = join(directory, 'results');
    vi.stubEnv('ANTICA_BENCHMARK_DATABASE_URL', url.toString());
    const previousArguments = process.argv;
    process.argv = [
      'node',
      'benchmark',
      '--iterations',
      '20',
      '--warmups',
      '1',
      '--output',
      output,
    ];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await runStorageBenchmark();

      const report = JSON.parse(
        await readFile(join(output, 'report.json'), 'utf8'),
      ) as BenchmarkReport;
      const samples = (await readFile(join(output, 'samples.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as BenchmarkSample);
      const plans = JSON.parse(
        await readFile(join(output, 'query-plans.json'), 'utf8'),
      ) as BenchmarkPlan[];
      expect(report).toMatchObject({
        dataset: {
          counts: [
            { records: 5000, media: 100000, checks: 5000, derivatives: 80003 },
          ],
          mediaBytesStored: false,
        },
        methodology: {
          iterations: 20,
          warmups: 1,
          foreignOwnerReturnedRows: 0,
          fullTraversal: [
            { sort: 'updated', pages: 100, uniqueRecords: 5000 },
            { sort: 'code', pages: 100, uniqueRecords: 5000 },
            { sort: 'name', pages: 100, uniqueRecords: 5000 },
          ],
          thumbnailVerification: {
            verifiedSignedCovers: expect.any(Number),
            verifiedNullCovers: expect.any(Number),
          },
        },
      });
      expect(
        report.methodology.thumbnailVerification.verifiedSignedCovers,
      ).toBeGreaterThan(12000);
      expect(
        report.methodology.thumbnailVerification.verifiedNullCovers,
      ).toBeGreaterThan(3000);
      expect(report.scenarios).toHaveLength(16);
      expect(samples).toHaveLength(320);
      for (const scenario of report.scenarios) {
        const measured = samples.filter(
          (sample) => sample.scenario === scenario.name,
        );
        expect(measured.map((sample) => sample.iteration)).toEqual(
          Array.from({ length: 20 }, (_, index) => index),
        );
        expect(
          measured.every(
            (sample) =>
              Number.isFinite(sample.elapsedMs) &&
              sample.elapsedMs >= 0 &&
              sample.returnedRows <= 50,
          ),
        ).toBe(true);
        expect(scenario).toMatchObject({
          count: 20,
          responseBytes: expect.any(Number),
        });
        expect(
          plans.some(
            (plan) => plan.scenario === scenario.name && plan.plan.length > 0,
          ),
        ).toBe(true);
      }
      expect(
        await admin`select pid from pg_stat_activity where datname = ${databaseName}`,
      ).toEqual([]);
    } finally {
      process.argv = previousArguments;
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
});
