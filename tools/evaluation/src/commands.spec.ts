import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readSnapshot } from './dataset.js';
import { digestSnapshot } from './digest.js';
import { readEditingDataset } from './editing-dataset.js';
import { runEditingCommand } from './editing-main.js';
import { runInferenceCommand } from './main.js';
import { runRetrievalCommand } from './retrieval-main.js';
import { runSensitivityCommand } from './sensitivity-main.js';

import type {
  createLocalImageRetrieval,
  createLocalTextRetrieval,
} from '@antica/platform/search';

import type { checkOutput } from './comparison.js';

const textAdapter = vi.hoisted(
  () =>
    ({
      snapshot:
        vi.fn<ReturnType<typeof createLocalTextRetrieval>['snapshot']>(),
    }) satisfies Partial<ReturnType<typeof createLocalTextRetrieval>>,
);
const imageAdapter = vi.hoisted(
  () =>
    ({
      search: vi.fn<ReturnType<typeof createLocalImageRetrieval>['search']>(),
    }) satisfies Partial<ReturnType<typeof createLocalImageRetrieval>>,
);
const outputChecker = vi.hoisted(
  () =>
    ({ checkOutput: vi.fn<typeof checkOutput>() }) satisfies Partial<
      typeof import('./comparison.js')
    >,
);

vi.mock('@antica/platform/search', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@antica/platform/search')>();

  return {
    ...actual,
    createLocalTextRetrieval: (
      params: Parameters<typeof actual.createLocalTextRetrieval>[0],
    ) => {
      const adapter = actual.createLocalTextRetrieval(params);

      return {
        ...adapter,
        snapshot: async (...args: Parameters<typeof adapter.snapshot>) =>
          textAdapter.snapshot.getMockImplementation()
            ? textAdapter.snapshot(...args)
            : adapter.snapshot(...args),
      };
    },
    createLocalImageRetrieval: (
      params: Parameters<typeof actual.createLocalImageRetrieval>[0],
    ) => {
      const adapter = actual.createLocalImageRetrieval(params);

      return {
        ...adapter,
        search: async (...args: Parameters<typeof adapter.search>) =>
          imageAdapter.search.getMockImplementation()
            ? imageAdapter.search(...args)
            : adapter.search(...args),
      };
    },
  } satisfies Partial<typeof import('@antica/platform/search')>;
});

vi.mock('./comparison.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./comparison.js')>();

  return {
    ...actual,
    checkOutput: (...args: Parameters<typeof actual.checkOutput>) =>
      outputChecker.checkOutput.getMockImplementation()
        ? outputChecker.checkOutput(...args)
        : actual.checkOutput(...args),
  } satisfies Partial<typeof import('./comparison.js')>;
});

const commands = [
  {
    name: 'inference',
    help: 'Inference:',
    run: runInferenceCommand,
  },
  {
    name: 'retrieval',
    help: 'Retrieval:',
    run: runRetrievalCommand,
  },
  {
    name: 'sensitivity',
    help: 'Sensitivity:',
    run: runSensitivityCommand,
  },
  {
    name: 'editing',
    help: 'Editing:',
    run: runEditingCommand,
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

describe('evaluation commands', () => {
  it('should preserve a snapshot-only retrieval failure and fail the command', async () => {
    textAdapter.snapshot.mockResolvedValue({
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Snapshot failed',
        retryable: true,
      },
    });
    const captured = captureCommand(['--output', '-']);
    await runRetrievalCommand();
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.text.evaluations[0]).toMatchObject({
      scores: null,
      snapshot: null,
      error: { message: 'Snapshot failed' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should preserve reference image identities in a returned image ranking', async () => {
    const captured = captureCommand(['--output', '-']);
    await runRetrievalCommand();
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
      const captured = captureCommand([
        '--models',
        'development:evidence-v1',
        '--reviews',
        path,
        '--output',
        '-',
      ]);
      await runInferenceCommand();
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
      const captured = captureCommand([
        '--models',
        'gateway:text-only',
        '--registry',
        path,
        '--output',
        '-',
      ]);
      await runInferenceCommand();
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

  it('should report a live editing model without a gateway key as inconclusive instead of falling back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-cli-editing-'));
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    try {
      const path = join(directory, 'registry.json');
      await writeFile(
        path,
        JSON.stringify({
          profiles: [
            {
              modelId: 'gateway:editing',
              provider: 'gateway',
              providerModelVersion: null,
              adapterKind: 'live',
              roles: ['recordEditing'],
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
      const captured = captureCommand([
        '--models',
        'gateway:editing',
        '--registry',
        path,
        '--output',
        '-',
      ]);
      await runEditingCommand();
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report.evaluations[0]).toMatchObject({
        passedCases: 0,
        assumptionA8: { verdict: 'inconclusive', runsPerCase: 1 },
        cases: expect.arrayContaining([
          expect.objectContaining({
            output: null,
            error: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
          }),
        ]),
      });
      expect(captured.runtime.exitCode).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should fail the editing command for an unknown model', async () => {
    const captured = captureCommand([
      '--models',
      'missing:model',
      '--output',
      '-',
    ]);
    await runEditingCommand();
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.evaluations[0]).toMatchObject({
      error: { code: 'MODEL_UNKNOWN' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should fail the editing command when a development case fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-cli-editing-'));
    try {
      const fixture = await readEditingDataset('editing-v1');
      const path = join(directory, 'dataset.json');
      await writeFile(
        path,
        JSON.stringify({
          ...fixture,
          cases: [{ ...fixture.cases[4], expectedFields: ['tags'] }],
        }),
      );
      const captured = captureCommand(['--snapshot', path, '--output', '-']);
      await runEditingCommand();
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report.evaluations[0]).toMatchObject({ passedCases: 0 });
      expect(captured.runtime.exitCode).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should fail the sensitivity command when a permissive validator falsely accepts invalid seeds', async () => {
    outputChecker.checkOutput.mockReturnValue({
      schemaValid: true,
      citationsValid: true,
      rejectedReferenceIds: [],
      schemaIssues: [],
    });
    const captured = captureCommand(['--output', '-']);
    await runSensitivityCommand();
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.falsePassCount).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should preserve image-provider failure and fail the retrieval command', async () => {
    imageAdapter.search.mockResolvedValue({
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Seeded image failure',
        retryable: true,
      },
    });
    const captured = captureCommand(['--output', '-']);
    await runRetrievalCommand();
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
      const captured = captureCommand(['--help']);
      await command.run();
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
      const captured = captureCommand(['--output', '-']);
      await command.run();
      const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
      expect(report).toEqual(expect.any(Object));
      expect(captured.stderr).not.toHaveBeenCalled();
      expect(captured.runtime.exitCode).toBeUndefined();
    },
  );

  it('should preserve unknown-model failure in the JSON report and exit unsuccessfully', async () => {
    const captured = captureCommand([
      '--models',
      'missing:model',
      '--output',
      '-',
    ]);
    await runInferenceCommand();
    const report = JSON.parse(String(captured.stdout.mock.calls[0]?.[0]));
    expect(report.evaluations[0]).toMatchObject({
      requestedModelId: 'missing:model',
      error: { code: 'MODEL_UNKNOWN' },
    });
    expect(captured.runtime.exitCode).toBe(1);
  });

  it('should report missing snapshot files through stderr and exit unsuccessfully', async () => {
    const captured = captureCommand([
      '--snapshot',
      '/missing-antica-evaluation-fixture.json',
      '--output',
      '-',
    ]);
    await runInferenceCommand();
    expect(captured.stderr).toHaveBeenCalledWith(
      expect.stringContaining('ENOENT'),
    );
    expect(captured.stdout).not.toHaveBeenCalled();
    expect(captured.runtime.exitCode).toBe(1);
  });
});
