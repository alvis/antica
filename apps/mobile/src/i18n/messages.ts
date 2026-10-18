import type { KnowledgeSummary } from '@antica/contracts';

import type { zhHant } from './locales/zh-Hant';

export type { Locale } from './resources';

type Dictionary = typeof zhHant;

type DictionaryKey = keyof Dictionary;

/** plural forms the dictionaries carry; Chinese uses only the `other` form */
type PluralSuffix = 'one' | 'other';

/** base name of a plural message, which is translated with a `count` value */
type PluralKey = DictionaryKey extends infer Key
  ? Key extends `${infer Base}_${PluralSuffix}`
    ? Base
    : never
  : never;

/** key for a localized mobile message; plural messages are named without their suffix */
export type MessageKey =
  Exclude<DictionaryKey, `${string}_${PluralSuffix}`> | PluralKey;

/** Traditional Chinese template of a message, which names its interpolation values */
type Template<Key extends MessageKey> = Key extends DictionaryKey
  ? Dictionary[Key]
  : Dictionary[`${Key}_other` & DictionaryKey];

/** names of the `{{value}}` placeholders in a template */
type Placeholders<Text> = Text extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** values a message interpolates, keyed by placeholder name */
export type MessageValues<Key extends MessageKey> = Readonly<
  Record<Placeholders<Template<Key>>, string | number>
>;

/** key for a message whose text has no interpolation values */
export type PlainMessageKey = {
  [Key in MessageKey]: [Placeholders<Template<Key>>] extends [never]
    ? Key
    : never;
}[MessageKey];

/** translates a message key, requiring exactly the values its text interpolates */
export type Translate = <Key extends MessageKey>(
  key: Key,
  ...values: Key extends PlainMessageKey ? [] : [values: MessageValues<Key>]
) => string;

const knowledgeKindKeys = {
  material: 'material',
  manufacture: 'kindManufacture',
  motif: 'kindMotif',
  mark: 'kindMark',
  surface: 'kindSurface',
  condition: 'kindCondition',
  damage: 'kindDamage',
  repair: 'kindRepair',
  restoration: 'kindRestoration',
  inspection: 'kindInspection',
  period: 'period',
  object_type: 'type',
  other: 'kindOther',
} as const satisfies Record<KnowledgeSummary['kinds'][number], PlainMessageKey>;

/**
 * localizes knowledge category metadata without changing authored content
 * @param kind category stored with the knowledge entry
 * @param t translation function for message keys
 * @returns localized category label
 */
export function localizeKnowledgeKind(
  kind: KnowledgeSummary['kinds'][number],
  t: Translate,
): string {
  return t(knowledgeKindKeys[kind]);
}

const proposalFieldKeys = {
  name: 'name',
  description: 'description',
  materialIds: 'material',
  period: 'period',
  tags: 'tags',
  collectorJudgment: 'collectorJudgment',
} as const satisfies Record<string, PlainMessageKey>;

/**
 * localizes a proposal field name
 * @param field proposal field to display
 * @param t translation function for message keys
 * @returns localized field name
 */
export function localizeProposalField(
  field: keyof typeof proposalFieldKeys,
  t: Translate,
): string {
  return t(proposalFieldKeys[field]);
}

const statusKeys = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'succeeded',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  ready: 'ready',
  registered: 'registered',
  usable: 'usable',
  unusable: 'unusable',
  pending: 'pending',
  accepted: 'accepted',
  skipped: 'skipped',
  dismissed: 'dismissed',
  in_progress: 'inProgress',
  recorded: 'recorded',
  not_started: 'notChecked',
  draft: 'draft',
  saved: 'saved',
  uploaded: 'uploaded',
  uploading: 'uploading',
  local: 'local',
  awaiting_upload: 'awaitingUpload',
  processing: 'processing',
  partial: 'partial',
  needs_review: 'sourceNeedsReview',
  link_only: 'linkOnly',
  not_applicable: 'notApplicable',
} as const satisfies Record<string, PlainMessageKey>;

/**
 * localizes a known status or formats its fallback label
 * @param value status returned by the API
 * @param t translation function for message keys
 * @returns localized or fallback status label
 */
export function localizeStatus(value: string, t: Translate): string {
  const key = (statusKeys as Partial<Record<string, PlainMessageKey>>)[value];

  return key ? t(key) : value.replaceAll('_', ' ');
}
