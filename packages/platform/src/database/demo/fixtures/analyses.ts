import { emulatorUtcOffset } from '../fixtures.js';

import type { NextAction, RecordFields } from '@antica/contracts';

import type { DemoRecordKey } from '../fixtures.js';

/** a finding of a seeded analysis, referencing photo angles and corpus citations */
export interface DemoFinding {
  readonly key: string;
  readonly kind: 'visualObservation' | 'sourceStatement' | 'hypothesis';
  readonly text: string;
  /** photo angle labels whose whole-image evidence anchors support the finding */
  readonly evidenceAngles: readonly string[];
  /** corpus citations, as `<content id>#<claim key>` */
  readonly citations: readonly string[];
  readonly relation: 'supports' | 'contradicts' | 'context';
  readonly certainty: 'observed' | 'reported' | 'tentative' | 'undetermined';
}

/** field change proposed by a seeded analysis; `before` is resolved against the record */
export type DemoProposal = {
  readonly key: string;
  readonly findingKeys: readonly string[];
  readonly confidence?: 'high' | 'medium' | 'low';
} & (
  | { readonly field: 'materialIds'; readonly proposedTerms: readonly string[] }
  | { readonly field: 'period'; readonly proposed: RecordFields['period'] }
  | { readonly field: 'categoryIds'; readonly proposedTerms: readonly string[] }
  | { readonly field: 'surface'; readonly proposed: string }
  | { readonly field: 'description'; readonly appendedText: string }
  | {
      readonly field: 'dimensions';
      /** measurements the proposal was made against, before the collector measured the piece */
      readonly staleBefore: RecordFields['dimensions'];
      readonly proposed: RecordFields['dimensions'];
    }
  | {
      readonly field: 'name';
      /** value the proposal was made against, which no longer matches the record */
      readonly staleBefore: string | null;
      readonly proposed: string;
    }
);

/** latest analysis run of a record, with the result the design shows */
export interface DemoAnalysis {
  readonly record: DemoRecordKey;
  readonly status: 'completed' | 'partial';
  /** completion time in the emulator's local time with its offset */
  readonly completedAt: string;
  readonly summary: string;
  readonly uncertainties: readonly string[];
  readonly findings: readonly DemoFinding[];
  readonly proposals: readonly DemoProposal[];
  readonly nextActions: ReadonlyArray<
    Pick<NextAction, 'kind' | 'instruction' | 'reason'> & { key: string }
  >;
}

const ruBodyGlaze = 'antica:entry:ceramics:ru-body-glaze';
const metGuanDish = 'antica:entry:ceramics:met-guan-dish';

/** analysis results of the dish and jar; the other records stay unanalyzed */
export const demoAnalyses: readonly DemoAnalysis[] = [
  {
    record: 'jar',
    status: 'completed',
    completedAt: `2026-10-18T15:40:00${emulatorUtcOffset}`,
    summary: '纏枝蓮紋青花罐；目前的照片看不到底足與款識，無法比對館藏實例。',
    uncertainties: ['缺少清楚的底足與款識照片，年代與窯口都無從比對。'],
    findings: [
      {
        key: 'jar-decoration',
        kind: 'visualObservation',
        text: '正面可見纏枝蓮紋，青花發色濃處聚成黑斑。',
        evidenceAngles: ['正面'],
        citations: [],
        relation: 'context',
        certainty: 'observed',
      },
    ],
    proposals: [],
    nextActions: [
      {
        key: 'jar-foot-mark',
        kind: 'capturePhoto',
        instruction: '補拍底足與款識',
        reason: '請拍底足與款識，我好比對館藏實例。',
      },
    ],
  },
  {
    record: 'dish',
    status: 'completed',
    completedAt: `2026-10-20T14:46:00${emulatorUtcOffset}`,
    summary:
      '釉色青灰、通體開片的圈足盤，外觀接近館藏的宋元青釉例；外觀不能定年，需要底足與支釘痕照片。',
    uncertainties: [
      '外觀不能定年；需要底足與支釘痕照片。',
      '口徑是目測推估，照片裡沒有尺。',
    ],
    findings: [
      {
        key: 'dish-form',
        kind: 'visualObservation',
        text: '釉色青灰、通體開片；淺腹、圈足，屬盤形。',
        evidenceAngles: ['正面', '開片細節'],
        citations: [`${metGuanDish}#catalogue-identity`],
        relation: 'supports',
        certainty: 'observed',
      },
      {
        key: 'dish-profile',
        kind: 'visualObservation',
        text: '側面輪廓淺而平，底有圈足。',
        evidenceAngles: ['側面'],
        citations: [],
        relation: 'supports',
        certainty: 'observed',
      },
      {
        key: 'dish-material',
        kind: 'sourceStatement',
        text: '口沿露胎呈灰褐；大都會把相近的盤著錄為帶開片青釉的炻器。',
        evidenceAngles: ['口沿'],
        citations: [`${metGuanDish}#catalogue-medium`],
        relation: 'supports',
        certainty: 'reported',
      },
      {
        key: 'dish-period',
        kind: 'hypothesis',
        text: '外觀接近 12–13 世紀的館藏例，但外觀不能定年；需要底足與支釘痕照片。',
        evidenceAngles: ['正面', '側面'],
        citations: [`${ruBodyGlaze}#features-evidence`],
        relation: 'context',
        certainty: 'tentative',
      },
      {
        key: 'dish-surface',
        kind: 'visualObservation',
        text: '開片細節照可見大小交錯的冰裂紋。',
        evidenceAngles: ['開片細節'],
        citations: [],
        relation: 'supports',
        certainty: 'observed',
      },
    ],
    proposals: [
      {
        key: 'dish-name',
        confidence: 'high',
        field: 'name',
        findingKeys: ['dish-form'],
        staleBefore: null,
        proposed: '青釉開片盤',
      },
      {
        key: 'dish-type',
        confidence: 'high',
        field: 'categoryIds',
        findingKeys: ['dish-profile'],
        proposedTerms: ['盤', '圈足'],
      },
      {
        key: 'dish-materials',
        confidence: 'medium',
        field: 'materialIds',
        findingKeys: ['dish-material'],
        proposedTerms: ['炻器', '青釉'],
      },
      {
        key: 'dish-period',
        confidence: 'low',
        field: 'period',
        findingKeys: ['dish-period'],
        proposed: { label: '宋至元風格（待查證）', status: 'unconfirmed' },
      },
      {
        key: 'dish-surface',
        confidence: 'medium',
        field: 'surface',
        findingKeys: ['dish-surface'],
        proposed: '冰裂紋開片，釉面溫潤',
      },
      {
        // estimated from the photos; the collector then measured 21.8, so the design shows it 已過時
        key: 'dish-size',
        confidence: 'medium',
        field: 'dimensions',
        findingKeys: ['dish-profile'],
        staleBefore: {},
        proposed: { diameter: { value: 21.5, unit: 'cm' } },
      },
    ],
    nextActions: [
      {
        key: 'dish-foot',
        kind: 'capturePhoto',
        instruction: '拍攝底足與支釘痕',
        reason:
          '克里夫蘭館方以「芝麻粒般細小的支釘痕」描述汝窯底部。補拍後可再判斷年代。',
      },
      {
        key: 'dish-ruler',
        kind: 'capturePhoto',
        instruction: '放一把尺，重拍正面',
        reason: '讓口徑從推估變成量得的數字。',
      },
    ],
  },
];
