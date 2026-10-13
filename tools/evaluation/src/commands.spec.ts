import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { readSnapshot } from './dataset.js';
import { digestSnapshot } from './digest.js';

const commands = [
  {
    name: 'inference',
    help: 'Inference:',
    load: async () => import('./main.js'),
  },
  {
    name: 'retrieval',
    help: 'Retrieval:',
    load: async () => import('./retrieval-main.js'),
  },
  {
    name: 'sensitivity',
    help: 'Sensitivity:',
    load: async () => import('./sensitivity-main.js'),
  },
];

/**
 * isolates public CLI arguments and exit status from the test runner process
 * @param args command-line arguments
 * @returns captured CLI output and an isolated process facade
 */
function captureCommand(args: readonly string[]) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const runtime = {
    ...process,
    argv: ['node', 'evaluation', ...args],
    stdout: { ...process.stdout, write: stdout },
    stderr: { ...process.stderr, write: stderr },
    exitCode: undefined as number | undefined,
  };
  vi.stubGlobal('process', runtime);

  return { runtime, stdout, stderr };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('./comparison.js');
  vi.doUnmock('@antica/platform/search');
});

describe('evaluation commands', () => {
  it('should preserve a snapshot-only retrieval failure and fail the command', async () => {
    vi.resetModules();
    vi.doMock('@antica/platform/search', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('@antica/platform/search')>();

      return {
        ...actual,
        createLocalTextRetrieval: (
          params: Parameters<typeof actual.createLocalTextRetrieval>[0],
        ) => ({
          ...actual.createLocalTextRetrieval(params),
          snapshot: async () => ({
            success: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'Snapshot failed',
              retryable: true,
            },
          }),
        }),
      };
    });
    const captured = captureCommand(['--output', '-']);
    await import('./retrieval-main.js');
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.text.evaluations[0]).toMatchObject({
      scores: null,
      snapshot: null,
      error: { message: 'Snapshot failed' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should preserve reference image identities in a returned image ranking', async () => {
    vi.resetModules();
    vi.doMock('@antica/platform/search', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@antica/platform/search')>()),
      createLocalImageRetrieval: () => ({
        search: async () => ({
          success: true,
          data: {
            items: [
              {
                ref: {
                  kind: 'reference',
                  sourceVersionId: '40000000-0000-4000-8000-000000000008',
                  referenceImageId: '40000000-0000-4000-8000-000000000002',
                },
              },
            ],
          },
        }),
      }),
    }));
    const captured = captureCommand(['--output', '-']);
    await import('./retrieval-main.js');
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.image.rankedIds).toEqual([
      '40000000-0000-4000-8000-000000000002',
    ]);
    expect(report.image.scores.recallAtK).toBe(1);
    expect(captured.runtime.exitCode).toBeUndefined();
  });

  it('should reject stale output annotations while persisting generated output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-cli-reviews-'));
    try {
      const path = join(directory, 'reviews.json');
      await writeFile(
        path,
        JSON.stringify({
          snapshotDigest: digestSnapshot(
            await readSnapshot('synthetic-evidence-v1'),
          ),
          reviews: {
            'development:evidence-v1': {
              outputDigest: '0'.repeat(64),
              annotations: {
                reviewer: 'Prior reviewer',
                notes: '',
                unsupportedClaims: 'pass',
                uncertaintyHandling: 'pass',
                sourceDisagreement: 'pass',
                traditionalChinese: 'pass',
                nextActionUsefulness: 'pass',
              },
            },
          },
        }),
      );
      vi.resetModules();
      const captured = captureCommand([
        '--models',
        'development:evidence-v1',
        '--reviews',
        path,
        '--output',
        '-',
      ]);
      await import('./main.js');
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report.evaluations[0]).toMatchObject({
        error: { code: 'REVIEW_OUTPUT_MISMATCH' },
        humanReview: { unsupportedClaims: 'pending' },
        output: { summary: expect.any(String) },
      });
      expect(captured.runtime.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should reject an explicitly registered incompatible model before any provider call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-cli-registry-'));
    try {
      const path = join(directory, 'registry.json');
      await writeFile(
        path,
        JSON.stringify({
          profiles: [
            {
              modelId: 'gateway:text-only',
              provider: 'gateway',
              providerModelVersion: null,
              adapterKind: 'live',
              roles: ['analysis'],
              capabilities: {
                textInput: true,
                imageInput: false,
                audioInput: false,
                structuredOutput: true,
                toolCalling: false,
              },
            },
          ],
        }),
      );
      vi.resetModules();
      const captured = captureCommand([
        '--models',
        'gateway:text-only',
        '--registry',
        path,
        '--output',
        '-',
      ]);
      await import('./main.js');
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report.evaluations[0]).toMatchObject({
        error: { code: 'MODEL_CAPABILITY_MISMATCH' },
        invocation: null,
      });
      expect(captured.runtime.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should fail the sensitivity command when a permissive validator falsely accepts invalid seeds', async () => {
    vi.resetModules();
    vi.doMock('./comparison.js', () => ({
      checkOutput: () => ({
        schemaValid: true,
        citationsValid: true,
        rejectedReferenceIds: [],
        schemaIssues: [],
      }),
    }));
    const captured = captureCommand(['--output', '-']);
    await import('./sensitivity-main.js');
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.falsePassCount).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should preserve image-provider failure and fail the retrieval command', async () => {
    vi.resetModules();
    vi.doMock('@antica/platform/search', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@antica/platform/search')>()),
      createLocalImageRetrieval: () => ({
        search: async () => ({
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Seeded image failure',
            retryable: true,
          },
        }),
      }),
    }));
    const captured = captureCommand(['--output', '-']);
    await import('./retrieval-main.js');
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.image).toMatchObject({
      scores: null,
      rankedIds: [],
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it.each(commands)(
    'should expose help for $name without creating reports',
    async (command) => {
      vi.resetModules();
      const captured = captureCommand(['--help']);
      await command.load();
      expect(captured.stdout).toHaveBeenCalledWith(
        expect.stringContaining(command.help),
      );
      expect(captured.stderr).not.toHaveBeenCalled();
      expect(captured.runtime.exitCode).toBeUndefined();
    },
  );

  it.each(commands)(
    'should produce an explicit JSON report for $name',
    async (command) => {
      vi.resetModules();
      const captured = captureCommand(['--output', '-']);
      await command.load();
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report).toEqual(expect.any(Object));
      expect(captured.stderr).not.toHaveBeenCalled();
      expect(captured.runtime.exitCode).toBeUndefined();
    },
  );

  it('should preserve unknown-model failure in the JSON report and exit unsuccessfully', async () => {
    vi.resetModules();
    const captured = captureCommand([
      '--models',
      'missing:model',
      '--output',
      '-',
    ]);
    await import('./main.js');
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.evaluations[0]).toMatchObject({
      requestedModelId: 'missing:model',
      error: { code: 'MODEL_UNKNOWN' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should report missing snapshot files through stderr and exit unsuccessfully', async () => {
    vi.resetModules();
    const captured = captureCommand([
      '--snapshot',
      '/missing-antica-evaluation-fixture.json',
      '--output',
      '-',
    ]);
    await import('./main.js');
    expect(captured.stderr).toHaveBeenCalledWith(
      expect.stringContaining('ENOENT'),
    );
    expect(captured.stdout).not.toHaveBeenCalled();
    expect(captured.runtime.exitCode).toBe(1);
  });
});
