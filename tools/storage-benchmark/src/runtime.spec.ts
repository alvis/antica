import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runStorageBenchmark,
  summarize,
  validateBenchmarkUrl,
} from './runtime.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fn:validateBenchmarkUrl', () => {
  it('should accept explicitly isolated loopback PostgreSQL destinations', () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const value = `postgresql://antica@${host}:54329/antica_benchmark_thumbnail`;
      expect(validateBenchmarkUrl(value).toString()).toBe(value);
    }
  });

  it('should reject missing, remote, production and ambiguous destinations', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => validateBenchmarkUrl(undefined)).toThrow(
      'ANTICA_BENCHMARK_DATABASE_URL is required',
    );
    for (const value of [
      'https://localhost/antica_benchmark',
      'postgresql://remote.invalid/antica_benchmark',
      'postgresql://localhost/antica',
      'postgresql://localhost/antica_acceptance',
      'postgresql://localhost/antica_benchmark?options=unsafe',
      'postgresql://localhost/antica_benchmark#fragment',
      `postgresql://localhost/antica_benchmark_${'x'.repeat(63)}`,
    ]) {
      expect(() => validateBenchmarkUrl(value)).toThrow(
        'Benchmark requires an isolated loopback',
      );
    }
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      validateBenchmarkUrl('postgresql://localhost/antica_benchmark'),
    ).toThrow('outside production');
  });
});

describe('fn:summarize', () => {
  it('should retain nearest-rank tails without mutating raw sample order', () => {
    const samples = Array.from({ length: 20 }, (_, index) => 20 - index);
    expect(summarize(samples)).toEqual({
      count: 20,
      minMs: 1,
      p50Ms: 10,
      p95Ms: 19,
      p99Ms: 20,
      maxMs: 20,
      meanMs: 10.5,
    });
    expect(samples[0]).toBe(20);
  });
});

describe('fn:runStorageBenchmark', () => {
  it('should reject unsafe sample arguments before accessing a database', async () => {
    const previous = process.argv;
    try {
      for (const args of [
        ['--iterations', '0'],
        ['--iterations', '1001'],
        ['--iterations', '1.5'],
        ['--warmups', '0'],
        ['--warmups', '101'],
        ['--warmups', '1.5'],
      ]) {
        process.argv = ['node', 'benchmark', ...args];
        await expect(runStorageBenchmark()).rejects.toThrow(
          'iterations20..1000 and warmups1..100 required',
        );
      }
      process.argv = ['node', 'benchmark'];
      vi.stubEnv('ANTICA_BENCHMARK_DATABASE_URL', undefined);
      await expect(runStorageBenchmark()).rejects.toThrow(
        'ANTICA_BENCHMARK_DATABASE_URL is required',
      );
    } finally {
      process.argv = previous;
    }
  });
});
