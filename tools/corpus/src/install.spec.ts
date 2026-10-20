import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { corpusFileSchema } from '@antica/contracts';

import { createCorpusContent } from '../../../packages/platform/src/database/repositories/corpus-content.js';
import { disposition } from '../../../packages/platform/src/database/repositories/corpus-plan.js';

import { createCorpusFixture } from './fixtures/corpus.js';

import {
  loadCorpusInstallRequest,
  runCorpusInstallCommand,
} from './install.js';

const requestArguments = [
  '--owner-id',
  'installer-test-owner',
  '--release',
  '1.0.1',
  '--request-key',
  randomUUID(),
];

describe('fn:loadCorpusInstallRequest', () => {
  it.each([
    [],
    ['--release', '1.0.1', '--request-key', randomUUID()],
    ['--owner-id', 'owner', '--request-key', randomUUID()],
    ['--owner-id', 'owner', '--release', '1.0.1'],
    ['--unknown'],
    ['--owner-id'],
  ])('should reject incomplete or unsupported arguments %j', (...args) => {
    expect(() => loadCorpusInstallRequest(args)).toThrow();
  });

  it('should load the real corpus as a validated explicit dry-run request', () => {
    const request = loadCorpusInstallRequest([
      ...requestArguments,
      '--dry-run',
    ]);
    expect(request).toMatchObject({
      ownerId: 'installer-test-owner',
      dryRun: true,
      release: { version: '1.0.1' },
    });
    expect(request.entries).toHaveLength(56);
    expect(request.sources).toHaveLength(67);
    expect(request.topics).toHaveLength(65);
  });

  it('should refuse a release not present in the corpus', () => {
    expect(() =>
      loadCorpusInstallRequest([
        '--owner-id',
        'owner',
        '--release',
        '9.9.9',
        '--request-key',
        randomUUID(),
      ]),
    ).toThrow();
  });
});

describe('cmd:corpus:install', () => {
  it('should refuse invalid corpus bytes before requiring a database connection', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const directory = mkdtempSync(join(tmpdir(), 'antica-kdb09-invalid-'));
    try {
      writeFileSync(join(directory, 'taxonomy.json'), '{');
      const stdout: string[] = [];
      const stderr: string[] = [];
      const result = await runCorpusInstallCommand(
        [...requestArguments, '--dir', directory],
        {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      );
      expect({ result, stdout, stderr }).toEqual({
        result: 1,
        stdout: [],
        stderr: [expect.stringContaining('taxonomy.json')],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should report the missing database URL after successful validation', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = await runCorpusInstallCommand(requestArguments, {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    expect({ result, stdout, stderr }).toEqual({
      result: 1,
      stdout: [],
      stderr: [expect.stringContaining('DATABASE_URL')],
    });
  });

  it('should use the default error output for invalid arguments', async () => {
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    expect(await runCorpusInstallCommand([])).toBe(1);
    expect(stderr.mock.calls).toEqual([[expect.stringContaining('Usage:')]]);
  });
});

describe('fn:createCorpusContent', () => {
  it('should preserve unspecific image rights, default locators and ordered claims in v2 envelopes', () => {
    const files = createCorpusFixture().map((document) =>
      corpusFileSchema.parse(JSON.parse(document.text)),
    );
    const source = files.find((file) => file.kind === 'source');
    const entry = files.find((file) => file.kind === 'entry');
    if (source?.kind !== 'source' || entry?.kind !== 'entry') {
      throw new Error('Missing source fixture');
    }
    const content = createCorpusContent('content-test-owner', [source]);
    const summary = entry.claims[0]!;
    const result = content.entry({
      ...entry,
      aliases: [{ language: 'en', text: 'Alternate label', kind: 'alias' }],
      imageIds: [source.images[0]!.id],
      claims: [
        summary,
        { ...summary, claimKey: 'later', section: 'history', ordinal: 1 },
        { ...summary, claimKey: 'earlier', section: 'history', ordinal: 0 },
      ],
    });
    expect(result.aliases).toEqual([
      { language: 'en', text: 'Alternate label' },
    ]);
    expect(result.sections.history.map((claim) => claim.claimKey)).toEqual([
      'earlier',
      'later',
    ]);
    expect(result.images).toEqual([
      expect.objectContaining({
        imageUrl: source.images[0]!.remoteUrl,
        locatorId: result.citations[0]!.locator.id,
      }),
    ]);
    expect(result.images[0]).not.toHaveProperty('observedRights');
    expect(content.snapshot(source).observedRights).toEqual([]);
  });
});

describe('fn:disposition', () => {
  const head = {
    id: 'entry',
    ownerId: 'owner',
    displayCode: 'code',
    contentId: 'content',
    currentRevision: 1,
    latestSavedRevision: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const previous = {
    installId: 'install',
    contentId: 'content',
    entryId: 'entry',
    revision: 1,
    contentHash: 'old',
    disposition: 'created' as const,
    createdAt: new Date(0),
  };

  it('should keep unchanged upstream content unchanged after a collector save', () => {
    expect(
      disposition(
        { ...head, currentRevision: 2, latestSavedRevision: 2 },
        previous,
        'old',
      ),
    ).toBe('unchanged');
  });

  it('should preserve saved installed heads and unresolved conflicts when upstream changes', () => {
    expect(
      disposition({ ...head, latestSavedRevision: 1 }, previous, 'new'),
    ).toBe('conflict');
    expect(
      disposition(head, { ...previous, disposition: 'conflict' }, 'old'),
    ).toBe('conflict');
    expect(
      disposition(
        { ...head, currentRevision: 2, latestSavedRevision: 1 },
        { ...previous, revision: 2 },
        'new',
      ),
    ).toBe('update_draft');
  });
});
