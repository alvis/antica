import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { editableFields } from '@antica/platform/ai';

import {
  editingDatasetSchema,
  editingFieldSchema,
  readEditingDataset,
} from './editing-dataset.js';

const dataset = await readEditingDataset('editing-v1');

describe('editing dataset', () => {
  it('should cover every editing behaviour with at least twelve cases over two or three records', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(12);
    expect(dataset.records.length).toBeGreaterThanOrEqual(2);
    expect(dataset.records.length).toBeLessThanOrEqual(3);
    expect(new Set(dataset.cases.map((item) => item.kind))).toEqual(
      new Set([
        'ask',
        'edit',
        'mixed',
        'correction',
        'injection',
        'restricted',
      ]),
    );
  });

  it('should expect only fields the editing prompt allows', () => {
    expect(editingFieldSchema.options).toEqual(editableFields);
  });

  it('should read an explicit dataset file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-editing-'));
    try {
      const path = join(directory, 'dataset.json');
      await writeFile(path, JSON.stringify(dataset));

      expect(await readEditingDataset(path)).toEqual(dataset);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.for([
    [
      'duplicate case IDs',
      { ...dataset, cases: [dataset.cases[0], dataset.cases[0]] },
    ],
    [
      'an unknown record',
      { ...dataset, cases: [{ ...dataset.cases[4], record: 'missing' }] },
    ],
    [
      'overlapping expected and permitted fields',
      {
        ...dataset,
        cases: [{ ...dataset.cases[4], permittedFields: ['name'] }],
      },
    ],
    [
      'a question that expects a proposal',
      {
        ...dataset,
        cases: [{ ...dataset.cases[0], expectedFields: ['name'] }],
      },
    ],
    [
      'an edit that expects no proposal',
      { ...dataset, cases: [{ ...dataset.cases[4], expectedFields: [] }] },
    ],
  ])('should reject %s', ([, candidate]) => {
    expect(editingDatasetSchema.safeParse(candidate).success).toBe(false);
  });
});
