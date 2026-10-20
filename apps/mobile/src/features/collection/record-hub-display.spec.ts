import { describe, expect, it, jest } from '@jest/globals';

import { translator } from '../../i18n/translate.spec.fixtures';

import {
  filledRecord,
  materialId,
  objectTypeId,
  otherMaterialId,
} from './record-edit.spec.fixtures';
import { periodName, recordFacts, recordMeta } from './record-hub-display';

import type { FieldLabels } from './record-edit-display';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

/**
 * label lookups that name the fixture's object type
 * @param category the object type's title
 * @returns the lookups
 */
const labelsFor = (category: string): FieldLabels => ({
  knowledge: (id) =>
    ({
      [objectTypeId]: category,
      [materialId]: '炻器',
      [otherMaterialId]: '青釉',
    })[id] ?? id,
  location: (id) => id,
  media: (id) => id,
});

const zh = translator('zh-Hant');
const vessel = {
  ...filledRecord,
  materialIds: [materialId, otherMaterialId],
  dimensions: { diameter: { value: 21.8, unit: 'cm' as const } },
};

describe('fn:recordMeta', () => {
  it('should word a vessel diameter as 口徑 in 公分 between 間隔號 dots, as the design meta line does', () => {
    expect(recordMeta(vessel, labelsFor('陶瓷'), zh, 'zh-Hant')).toMatch(
      /^陶瓷·口徑 21\.8 公分·.+ 加入$/u,
    );
  });

  it('should call a disc diameter 徑 and a height 高', () => {
    expect(recordMeta(vessel, labelsFor('玉器'), zh, 'zh-Hant')).toContain(
      '徑 21.8 公分',
    );
    expect(
      recordMeta(
        { ...vessel, dimensions: { height: { value: 102, unit: 'cm' } } },
        labelsFor('家具'),
        zh,
        'zh-Hant',
      ),
    ).toContain('家具·高 102 公分');
  });
});

describe('fn:recordFacts', () => {
  it('should list materials with a full-width comma and size the tile like the meta line', () => {
    const facts = recordFacts(
      vessel,
      labelsFor('陶瓷'),
      new Map(),
      zh,
      'zh-Hant',
    );

    expect(facts.find((fact) => fact.key === 'material')?.value).toBe(
      '炻器，青釉',
    );
    expect(facts.find((fact) => fact.key === 'size')?.value).toBe(
      '口徑 21.8 公分',
    );
  });
});

describe('fn:periodName', () => {
  it('should read a one-character dynasty with 代 in Chinese and leave other labels as saved', () => {
    expect(periodName('清', 'zh-Hant')).toBe('清代');
    expect(periodName('北宋', 'zh-Hant')).toBe('北宋');
    expect(periodName('宋至元風格（待查證）', 'zh-Hant')).toBe(
      '宋至元風格（待查證）',
    );
    expect(periodName('清', 'en')).toBe('清');
  });
});
