import { emulatorUtcOffset } from '../fixtures.js';

import type { RecordFields } from '@antica/contracts';

import type { DemoRecordKey } from '../fixtures.js';

/** a photo angle mirrored from the design's CSS crop of the source image */
export interface PhotoAngle {
  /** angle caption, also the uploaded file name */
  readonly label: string;
  /** CSS object-position as fractions of the free space, defaulting to the center */
  readonly position?: { readonly x: number; readonly y: number };
  /** uniform CSS scale around the frame center */
  readonly scale?: number;
  /** clockwise CSS rotation */
  readonly rotation?: 'quarter' | 'half';
  /** whether CSS mirrors the image horizontally */
  readonly isMirrored?: boolean;
}

/** acquisition facts in the record contract, without receipt asset ids */
export type DemoAcquisition = Omit<
  RecordFields['acquisition'],
  'receiptAssetIds'
>;

/** one design object, its record fields and its photos */
export interface DemoRecord {
  readonly key: DemoRecordKey;
  readonly name: string;
  /** vocabulary title of the category */
  readonly category: string;
  /** vocabulary titles of the materials */
  readonly materials: readonly string[];
  readonly dimensions: RecordFields['dimensions'];
  /** `加入` time in the emulator's local time with its offset */
  readonly createdAt: string;
  /** shelf label, followed by the detail inside that place */
  readonly location: { readonly label: string; readonly detail: string };
  readonly acquisition: DemoAcquisition;
  /** whether the record carries one receipt photo */
  readonly hasReceipt: boolean;
  /** text of the record's 觀察 row */
  readonly description: string;
  readonly period: RecordFields['period'];
  /** source image under ./images without extension */
  readonly image: string;
  readonly angles: readonly PhotoAngle[];
}

const dishAngles: readonly PhotoAngle[] = [
  { label: '正面' },
  { label: '側面', position: { x: 0.5, y: 0.85 }, scale: 1.9 },
  { label: '口沿', position: { x: 0.12, y: 0.5 }, scale: 2.4 },
  { label: '開片細節', position: { x: 0.55, y: 0.4 }, scale: 3.2 },
  { label: '底足', scale: 1.4, rotation: 'half' },
  { label: '背面', scale: 1.2, rotation: 'quarter' },
];

const recordAngles: readonly PhotoAngle[] = [
  { label: '正面' },
  { label: '側面', scale: 1.5 },
  { label: '細部', scale: 2.4 },
  { label: '底部', scale: 1.3, rotation: 'half' },
  { label: '口沿', position: { x: 0.5, y: 0.15 }, scale: 2 },
  { label: '背面', isMirrored: true },
];

/** the five design objects, oldest first so record codes follow `加入` order */
export const demoRecords: readonly DemoRecord[] = [
  {
    key: 'bi',
    name: '穀紋玉璧',
    category: '玉器',
    materials: ['玉'],
    dimensions: { diameter: { value: 14.8, unit: 'cm' } },
    createdAt: `2026-10-12T16:40:00${emulatorUtcOffset}`,
    location: { label: '書房抽屜', detail: '' },
    acquisition: { method: '友人轉讓', provenanceNote: '2021年' },
    hasReceipt: false,
    description: '滿布穀紋，一面有沁色。',
    period: null,
    image: 'grain-bi',
    angles: recordAngles,
  },
  {
    key: 'cup',
    name: '斗彩嬰戲杯',
    category: '陶瓷',
    materials: ['瓷', '斗彩'],
    dimensions: { diameter: { value: 6.8, unit: 'cm' } },
    createdAt: `2026-10-17T11:20:00${emulatorUtcOffset}`,
    location: { label: '茶室櫃', detail: '' },
    acquisition: { method: '拍賣購入', provenanceNote: '2022年' },
    hasReceipt: false,
    description: '外壁嬰戲圖，底有青花六字款。',
    period: null,
    image: 'chenghua-cup',
    angles: recordAngles,
  },
  {
    key: 'jar',
    name: '青花纏枝蓮紋罐',
    category: '陶瓷',
    materials: ['瓷', '青花'],
    dimensions: { height: { value: 29, unit: 'cm' } },
    createdAt: `2026-10-18T15:10:00${emulatorUtcOffset}`,
    location: { label: '主陳列室', detail: '第一層' },
    acquisition: { method: '家族舊藏', provenanceNote: '2023年' },
    hasReceipt: false,
    description: '纏枝蓮紋，發色濃處有黑斑。',
    period: null,
    image: 'yuan-jar',
    angles: recordAngles,
  },
  {
    key: 'chair',
    name: '黃花梨圈椅',
    category: '家具',
    materials: ['紅木'],
    dimensions: { height: { value: 102, unit: 'cm' } },
    createdAt: `2026-10-19T18:30:00${emulatorUtcOffset}`,
    location: { label: '書房', detail: '窗邊' },
    acquisition: {
      acquiredOn: '2024-11-01',
      seller: '台北古董店',
      method: '購入',
    },
    hasReceipt: true,
    description: '椅背三彎，扶手出頭；背板素面無雕。',
    // the corpus period topic is labelled 清, which the related-knowledge match compares exactly
    period: { label: '清', status: 'collectorClaim' },
    image: 'lohan-chair',
    angles: recordAngles,
  },
  {
    key: 'dish',
    name: '青釉開片盤',
    category: '陶瓷',
    // the related-knowledge match needs a corpus material term; the analysis adds 青釉
    materials: ['炻器'],
    dimensions: { diameter: { value: 21.8, unit: 'cm' } },
    createdAt: `2026-10-20T10:05:00${emulatorUtcOffset}`,
    location: { label: '主陳列室玻璃櫃', detail: '第二層右上角' },
    acquisition: {
      acquiredOn: '2025-04-01',
      seller: '香港荷李活道',
      method: '購入',
    },
    hasReceipt: true,
    description: '釉色青灰，燈下可見通體開片；口沿露胎呈灰褐。',
    period: null,
    image: 'met-guan-dish',
    angles: dishAngles,
  },
];
