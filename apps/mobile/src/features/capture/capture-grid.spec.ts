import { describe, expect, it } from '@jest/globals';

import { recordDetailSchema } from '@antica/contracts';

import {
  componentLabelsOf,
  gridFiles,
  isSelected,
  labelFile,
  selectedCount,
  summarizeRecord,
  toggleSelected,
  usedLabels,
  wholeRecord,
} from './capture-grid';

import type { LocalMedia } from '../../adapters/media-upload';

/**
 * builds a local draft file
 * @param id file identifier
 * @param overrides fields that differ from a local object photo
 * @returns the draft file
 */
function file(id: string, overrides: Partial<LocalMedia> = {}): LocalMedia {
  return {
    id,
    uri: `file:///${id}.jpg`,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    ...overrides,
  };
}

describe('fn:gridFiles', () => {
  it('should keep object files in capture order and leave receipts out', () => {
    const files = [
      file('a'),
      file('receipt', { purpose: 'receipt' }),
      file('b', { kind: 'video' }),
    ];

    expect(gridFiles(files).map(({ id }) => id)).toEqual(['a', 'b']);
  });
});

describe('fn:selectedCount', () => {
  it('should count selected object files only', () => {
    const files = [
      file('a'),
      file('b', { excluded: true }),
      file('receipt', { purpose: 'receipt' }),
    ];

    expect(selectedCount(files)).toBe(1);
  });
});

describe('fn:toggleSelected', () => {
  it('should deselect then reselect one file without removing it', () => {
    const files = [file('a'), file('b')];

    const deselected = toggleSelected(files, 'b');
    const reselected = toggleSelected(deselected, 'b');

    expect(deselected.map(isSelected)).toEqual([true, false]);
    expect(reselected.map(isSelected)).toEqual([true, true]);
    expect(reselected).toHaveLength(2);
  });

  it('should keep an uploaded file selected', () => {
    const files = [file('a', { state: 'uploaded', assetId: 'asset-a' })];

    expect(toggleSelected(files, 'a').map(isSelected)).toEqual([true]);
  });
});

describe('fn:labelFile', () => {
  it('should trim the label of the named file only', () => {
    const labelled = labelFile([file('a'), file('b')], 'b', '  Left vase ');

    expect(labelled.map(({ componentLabel }) => componentLabel)).toEqual([
      '',
      'Left vase',
    ]);
  });
});

describe('fn:usedLabels', () => {
  it('should offer record and draft component labels once, never the whole record or a shot type', () => {
    const files = [
      file('a', { componentLabel: 'Left vase', shotType: 'base' }),
      file('b', { componentLabel: ' Base ' }),
      file('c', { componentLabel: wholeRecord, shotType: 'set' }),
      file('d', { shotType: 'mark' }),
      file('receipt', { purpose: 'receipt', componentLabel: 'Receipt' }),
    ];

    expect(usedLabels(files, ['Left vase', 'Lid'])).toEqual([
      'Left vase',
      'Lid',
      'Base',
    ]);
  });
});

describe('fn:componentLabelsOf', () => {
  it('should name components only for selected files labelled with a component', () => {
    const files = [
      file('a', { componentLabel: wholeRecord }),
      file('b', { componentLabel: ' Left vase ' }),
      file('c', { componentLabel: 'Right vase', excluded: true }),
      file('d', { componentLabel: 'Left vase' }),
      file('e'),
    ];

    expect(componentLabelsOf(files)).toEqual(['Left vase']);
  });
});

describe('fn:summarizeRecord', () => {
  it('should name a draft that has no record yet as a new item', () => {
    expect(summarizeRecord(null, 'New item')).toEqual({
      name: 'New item',
      code: '',
      componentLabels: [],
    });
  });

  it('should use the record name, code and component labels', () => {
    const record = recordDetailSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      code: 'AC-0001',
      name: 'Pair of vases',
      unitKind: 'set',
      components: [
        { id: '00000000-0000-4000-8000-000000000002', label: 'Left vase' },
      ],
      pieceCount: 2,
      categoryIds: [],
      materialIds: [],
      period: null,
      dimensions: {},
      location: { locationId: null, detail: '' },
      acquisition: { receiptAssetIds: [] },
      tags: [],
      description: '',
      collectorJudgment: null,
      condition: null,
      recordRevision: 1,
      analysisInputVersion: 1,
      evidenceVersion: 1,
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:00.000Z',
      mediaIds: [],
      checkIds: [],
      latestRunId: null,
      analysisFreshness: 'unanalyzed',
    });

    expect(summarizeRecord(record, 'New item')).toEqual({
      name: 'Pair of vases',
      code: 'AC-0001',
      componentLabels: ['Left vase'],
    });
  });
});
