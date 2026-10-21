/** stable key of one of the five design objects */
export type DemoRecordKey = 'dish' | 'chair' | 'jar' | 'cup' | 'bi';

/** collector vocabulary entry that a record's category or material selection points at */
export interface VocabularyTerm {
  /** displayed term, which the app shows for the selection */
  readonly title: string;
  /** alternative spellings that the related-knowledge match also uses */
  readonly aliases: readonly string[];
  /** record field the term serves */
  readonly kind: 'object_type' | 'material';
}

/** owner the demo seed writes; the API must run with this phone */
export const demoOwnerPhone = '+15550100002';

/** owner the Maestro flows use; the demo seed refuses it */
export const endToEndOwnerPhone = '+15550100001';

/** UTC offset of the emulator's Europe/London clock (BST) on every seeded date */
export const emulatorUtcOffset = '+01:00';

/** collector vocabulary created through the knowledge API, one entry per selectable term */
export const vocabularyTerms: readonly VocabularyTerm[] = [
  { title: '陶瓷', aliases: [], kind: 'object_type' },
  { title: '家具', aliases: [], kind: 'object_type' },
  { title: '玉器', aliases: [], kind: 'object_type' },
  { title: '炻器', aliases: [], kind: 'material' },
  { title: '青釉', aliases: [], kind: 'material' },
  { title: '紅木', aliases: [], kind: 'material' },
  { title: '黃花梨（未經木材鑑定）', aliases: ['黃花梨'], kind: 'material' },
  { title: '瓷', aliases: [], kind: 'material' },
  { title: '青花', aliases: [], kind: 'material' },
  { title: '斗彩', aliases: [], kind: 'material' },
  { title: '玉', aliases: ['玉材', '軟玉'], kind: 'material' },
];

/**
 * corpus entries the demo owner reviews and saves; of the stoneware (炻器) entries only the three the
 * design shows for the dish are saved, since the related-knowledge match ranks equal scores by id
 */
export const savedCorpusEntries: readonly string[] = [
  'antica:entry:ceramics:ru-body-glaze',
  'antica:entry:ceramics:met-guan-dish',
  'antica:entry:ceramics:ru-washer',
  'antica:entry:furniture:huanghuali-material',
  'antica:entry:furniture:mortise-tenon',
  'antica:entry:furniture:lohan-chair',
  'antica:entry:furniture:kang-table',
  'antica:entry:ceramics:cobalt-and-context',
  'antica:entry:ceramics:yuan-jar',
  'antica:entry:ceramics:doucai-process',
  'antica:entry:ceramics:chenghua-cup',
  'antica:entry:jades:grain-and-later-text',
  'antica:entry:jades:grain-bi',
  'antica:entry:jades:nephrite-and-appearance',
];
