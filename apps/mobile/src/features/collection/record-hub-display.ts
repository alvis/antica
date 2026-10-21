import { formatDate, formatDateTime } from '../../utils/calendar';
import { formatFieldValue } from '../../utils/field-value';
import { quoteFields } from '../../utils/quote-fields';

import { proposalFieldTestId } from './proposal-field-test-id';
import { displayValue, editFieldName } from './record-edit-display';
import { draftFromRecord, recordEditFields } from './record-edit-draft';
import { headlineDimension } from './record-hub';

import type { RecordDetail } from '@antica/contracts';

import type { LocaleState } from '../../providers/LocaleProvider';

import type { RecordDataRow } from './components/RecordDataRows';
import type { RecordFact } from './components/RecordFactTiles';
import type { RecordHub } from './hooks/useRecordHub';
import type { FieldLabels } from './record-edit-display';
import type { RecordEditField } from './record-edit-draft';
import type { RecordPrimary, fieldBadges } from './record-hub';

/** fields 收藏資料 shows in its own rows, or the tiles and title already show */
const summarisedFields = new Set<RecordEditField>([
  'name',
  'locationId',
  'locationDetail',
  'description',
  'acquiredOn',
  'seller',
  'method',
  'receiptAssetIds',
  'provenanceNote',
]);

/** how the hub names each headline dimension; a vessel's diameter is its mouth (口徑) */
const dimensionLabelKeys = {
  diameter: 'recordDimensionDiameter',
  height: 'recordDimensionHeight',
  width: 'recordDimensionWidth',
  depth: 'recordDimensionDepth',
} as const;

/** length units spelled out the way the hub reads them (公分 in Traditional Chinese) */
const lengthUnitKeys = {
  mm: 'recordLengthMm',
  cm: 'recordLengthCm',
  m: 'recordLengthM',
} as const;

/** object types whose diameter is measured across the mouth */
const vesselCategories = new Set(['陶瓷', 'Ceramics']);

/**
 * words the headline dimension for the meta line and the 尺寸 tile, such as 口徑 21.8 公分
 * @param record the record
 * @param labels label lookups
 * @param t translator
 * @param locale interface locale
 * @returns the dimension with its label and unit, or undefined without one
 */
function hubDimension(
  record: RecordDetail,
  labels: FieldLabels,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): string | undefined {
  const dimension = headlineDimension(record.dimensions);
  if (!dimension) {
    return undefined;
  }
  const category = record.categoryIds.at(0);
  const vessel =
    category !== undefined && vesselCategories.has(labels.knowledge(category));
  const label =
    dimension.field === 'diameter' && vessel
      ? t('recordDimensionMouth')
      : t(dimensionLabelKeys[dimension.field]);
  const { measurement } = dimension;
  const value =
    'unit' in measurement && measurement.unit in lengthUnitKeys
      ? t(lengthUnitKeys[measurement.unit], {
          value: new Intl.NumberFormat(locale, {
            maximumFractionDigits: 6,
          }).format(measurement.value),
        })
      : formatFieldValue(measurement, locale, t);

  return `${label} ${value}`;
}

/**
 * the line under the title: object type, headline dimension and the day it was added
 * @param record the record
 * @param labels label lookups
 * @param t translator
 * @param locale interface locale
 * @returns the meta line
 */
export function recordMeta(
  record: RecordDetail,
  labels: FieldLabels,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): string {
  return [
    record.categoryIds[0] && labels.knowledge(record.categoryIds[0]),
    hubDimension(record, labels, t, locale),
    t('recordAdded', { date: formatDate(record.createdAt, locale) }),
  ]
    .filter(Boolean)
    .join(t('metaSeparator'));
}

/**
 * the line under the first action: when the analysis finished and how much of it is decided
 * @param primary the first action
 * @param hub the hub's reads
 * @param t translator
 * @param locale interface locale
 * @returns the status line, or nothing
 */
export function primaryStatus(
  primary: RecordPrimary,
  hub: RecordHub,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): string | undefined {
  const finished =
    hub.runCompletedAt &&
    t('recordAnalysedAt', { when: formatDateTime(hub.runCompletedAt, locale) });
  switch (primary.kind) {
    case 'review': {
      const total = hub.run.data?.result.output?.proposedChanges.length ?? 0;
      const progress = primary.untouched
        ? t('recordUntouched')
        : t('recordDecidedSome', {
            decided: total - primary.count,
            count: primary.count,
          });

      return [finished, progress].filter(Boolean).join(t('metaSeparator'));
    }
    case 'confirmEdits':
      return t('recordEditsWaiting', {
        fields: quoteFields(
          [...new Set(hub.editChanges.map((change) => change.field))].map(
            (field) => editFieldName(field, t),
          ),
          t,
        ),
      });
    case 'capture':
      return primary.action.reason;
    case 'analyse':
      return t(
        primary.state === 'unanalysed'
          ? 'savedNotAnalysedHint'
          : primary.state === 'outdated'
            ? 'newEvidenceHint'
            : 'analysisFailed',
      );
    case 'running':
      return t('analysisRunningHint');
    case 'unknown':
      return t('analysisStatusUnknownHint');
    default:
      return finished || undefined;
  }
}

/**
 * names a period for its tile: in Chinese a one-character dynasty takes 代 (清 reads 清代), as a
 * dynasty is spoken; longer labels such as 北宋 or 宋至元風格 already read in full
 * @param label the stored period label, kept as saved so knowledge matching still finds it
 * @param locale interface locale
 * @returns the label as the tile shows it
 */
export function periodName(
  label: string,
  locale: LocaleState['locale'],
): string {
  return locale === 'zh-Hant' && /^\p{Script=Han}$/u.test(label)
    ? `${label}代`
    : label;
}

/**
 * the tiles under 資料: period, materials, the headline dimension and tags, each marked when
 * a suggestion or edit card waits on it
 * @param record the record
 * @param labels label lookups
 * @param badges what waits on each field
 * @param t translator
 * @param locale interface locale
 * @returns the facts, without their press targets
 */
export function recordFacts(
  record: RecordDetail,
  labels: FieldLabels,
  badges: ReturnType<typeof fieldBadges>,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): Array<Omit<RecordFact, 'onPress'>> {
  // the design lists values with a full-width comma, as in 炻器，青釉
  const list = (values: readonly string[]): string | undefined =>
    values.length ? values.join(locale === 'en' ? ', ' : '，') : undefined;

  return [
    {
      key: 'period',
      label: t('period'),
      value: record.period
        ? t(
            record.period.status === 'collectorClaim'
              ? 'periodTileCollectorClaim'
              : 'periodTileUnconfirmed',
            { period: periodName(record.period.label, locale) },
          )
        : undefined,
      badge: badges.get('period'),
    },
    {
      key: 'material',
      label: t('material'),
      value: list(record.materialIds.map(labels.knowledge)),
      badge: badges.get('materialIds'),
    },
    {
      key: 'size',
      label: t('recordFactSize'),
      value: hubDimension(record, labels, t, locale),
    },
    {
      key: 'tags',
      label: t('tags'),
      value: list(record.tags),
      badge: badges.get('tags'),
    },
  ];
}

/**
 * 收藏資料's rows: where the piece is kept, where it came from, and the collector's notes
 * @param record the record
 * @param labels label lookups
 * @param t translator
 * @param locale interface locale
 * @param onEdit opens the editor
 * @returns the rows in display order
 */
export function collectionRows(
  record: RecordDetail,
  labels: FieldLabels,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
  onEdit: () => void,
): RecordDataRow[] {
  const { location, acquisition, description } = record;
  const empty = [{ text: t('recordFactEmpty') }];
  const place = [
    location.locationId && {
      text: labels.location(location.locationId),
      testID: 'record-field-location-id',
    },
    location.detail && {
      text: location.detail,
      testID: 'record-field-location-detail',
    },
  ].filter((part) => Boolean(part)) as RecordDataRow['parts'];
  const acquired = acquisition.acquiredOn
    ? formatMonth(acquisition.acquiredOn, locale)
    : undefined;
  const origin =
    acquisition.seller || acquisition.method
      ? t('recordSourceLine', {
          place: acquisition.seller ?? '',
          method: acquisition.method ?? '',
        }).trim()
      : undefined;
  const source = [acquired, origin, acquisition.provenanceNote]
    .filter((part): part is string => Boolean(part))
    .map((text) => ({ text }));
  const receipts = acquisition.receiptAssetIds.length;

  return [
    {
      key: 'location',
      label: t('location'),
      parts: place.length ? place : empty,
      onPress: onEdit,
    },
    {
      key: 'source',
      label: t('recordRowSource'),
      parts: source.length ? source : empty,
      sub: receipts ? t('recordReceipts', { count: receipts }) : undefined,
    },
    {
      key: 'notes',
      label: t('recordRowObservation'),
      parts: description
        ? [{ text: description, testID: 'record-field-description' }]
        : empty,
    },
  ];
}

/**
 * every other known field, shown once the collector asks for all of them
 * @param record the record
 * @param labels label lookups
 * @param t translator
 * @param locale interface locale
 * @returns one row per known field the rows above leave out
 */
export function otherFieldRows(
  record: RecordDetail,
  labels: FieldLabels,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): RecordDataRow[] {
  const draft = draftFromRecord(record);

  return recordEditFields
    .filter((field) => !summarisedFields.has(field))
    .flatMap((field) => {
      const value = displayValue(draft, field, labels);
      const unknown =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && !value.length);

      return unknown
        ? []
        : [
            {
              key: field,
              label: editFieldName(field, t),
              wide: true,
              parts: [
                {
                  text: formatFieldValue(value, locale, t),
                  testID: `record-field-${proposalFieldTestId(field)}`,
                },
              ],
            },
          ];
    });
}

/**
 * formats a calendar date as its month, such as 2025年4月; acquisition days are often the 1st
 * standing in for a month the collector remembers
 * @param isoDate the date, as YYYY-MM-DD
 * @param locale interface locale
 * @returns the year and month
 */
function formatMonth(isoDate: string, locale: LocaleState['locale']): string {
  // a date without a zone reads as local time; noon keeps it on the same day everywhere
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(new Date(`${isoDate}T12:00:00`));
}
