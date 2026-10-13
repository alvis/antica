import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import {
  corpusSchema,
  readCorpus,
  readSnapshot,
  snapshotSchema,
} from './dataset.js';

describe('fn:readSnapshot', () => {
  it('should reject a snapshot that omits selected evidence bytes before model invocation', async () => {
    const snapshot = await readSnapshot('synthetic-evidence-v1');
    expect(snapshotSchema.safeParse({ ...snapshot, images: [] }).success).toBe(
      false,
    );
    expect(
      snapshotSchema.safeParse({
        ...snapshot,
        images: [...snapshot.images, ...snapshot.images],
      }).success,
    ).toBe(false);
    expect(
      snapshotSchema.safeParse({ ...snapshot, citations: [] }).success,
    ).toBe(false);
    const id = '20000000-0000-4000-8000-000000000009';
    expect(
      snapshotSchema.safeParse({
        ...snapshot,
        input: { ...snapshot.input, checkIds: [id] },
        text: [...snapshot.text, { id, kind: 'check', content: '完成檢查' }],
      }).success,
    ).toBe(true);
  });

  it('should replay an external snapshot and reject malformed snapshot files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-evaluation-'));
    try {
      const path = join(directory, 'snapshot.json');
      const snapshot = await readSnapshot('synthetic-no-evidence-v1');
      await writeFile(path, JSON.stringify(snapshot));
      expect(await readSnapshot(path)).toEqual(snapshot);
      await writeFile(path, '{"input":null}');
      await expect(readSnapshot(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('fn:readCorpus', () => {
  it('should reject duplicate candidates and judgments outside the corpus', async () => {
    const corpus = await readCorpus();
    const first = corpus.documents[0];
    if (!first) {
      throw new Error('Fixture requires a candidate');
    }
    expect(
      corpusSchema.safeParse({ ...corpus, documents: [first, first] }).success,
    ).toBe(false);
    expect(
      corpusSchema.safeParse({
        ...corpus,
        queries: [{ id: 'foreign', text: 'query', relevance: { absent: 3 } }],
      }).success,
    ).toBe(false);
    const directory = await mkdtemp(join(tmpdir(), 'antica-corpus-'));
    try {
      const path = join(directory, 'corpus.json');
      await writeFile(path, JSON.stringify(corpus));
      expect(await readCorpus(path)).toEqual(corpus);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
