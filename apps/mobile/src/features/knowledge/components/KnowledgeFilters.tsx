import { Text, View } from 'react-native';

import { knowledgeFacetSchema } from '@antica/contracts';
import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgeChoice } from './KnowledgeChoice';
import { TopicBrowse } from './TopicBrowse';

import type { FC } from 'react';

import type {
  KnowledgeSearchQuery,
  KnowledgeSearchPage,
  KnowledgeTopicSummary,
} from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** localized headings for the shared backend facet vocabulary */
const labels: Record<
  (typeof knowledgeFacetSchema.options)[number],
  MessageKey
> = {
  category: 'knowledgeFacetCategory',
  material: 'knowledgeFacetMaterial',
  object_type: 'knowledgeFacetObjectType',
  period: 'knowledgeFacetPeriod',
  region: 'knowledgeFacetRegion',
  kiln_maker: 'knowledgeFacetMaker',
  technique: 'knowledgeFacetTechnique',
  motif: 'knowledgeFacetMotif',
  mark: 'knowledgeFacetMarks',
  surface: 'knowledgeFacetSurface',
  condition: 'knowledgeFacetCondition',
  repair_restoration: 'knowledgeFacetRestoration',
  authentication_limit: 'knowledgeFacetAuthentication',
  provenance: 'knowledgeFacetProvenance',
};
/** facet controls use shared search contracts for selection and counts */
export type KnowledgeFiltersProps = {
  options: KnowledgeTopicSummary[][];
  selection: KnowledgeSearchQuery;
  facets: KnowledgeSearchPage['facets'];
  onTopic: (topic: KnowledgeTopicSummary) => void;
  onValue: (
    key: 'providers' | 'languages' | 'entryTypes',
    value: string,
  ) => void;
  onClear: () => void;
};

/**
 * renders OR choices within each labelled AND group
 * @param root0 component properties
 * @param root0.options options property
 * @param root0.selection selection property
 * @param root0.facets facets property
 * @param root0.onTopic onTopic property
 * @param root0.onValue onValue property
 * @param root0.onClear onClear property
 * @returns rendered knowledge content
 */
export const KnowledgeFilters: FC<KnowledgeFiltersProps> = ({
  options,
  selection,
  facets,
  onTopic,
  onValue,
  onClear,
}) => {
  const { t } = useLocale();

  return (
    <View testID="knowledge-filters" style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('knowledgeFilters')}
      </Text>
      <Text style={styles.body}>{t('knowledgeFilterHelp')}</Text>
      <ActionButton
        testID="knowledge-clear-filters"
        label={t('knowledgeClearFilters')}
        onPress={onClear}
        secondary
      />
      {knowledgeFacetSchema.options.map((facet, index) => (
        <View key={facet} testID={`knowledge-facet-${facet}`}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t(labels[facet])}
          </Text>
          <TopicBrowse
            filter
            topics={options[index] ?? []}
            selected={selection.topics?.[facet] ?? []}
            onSelect={onTopic}
          />
          {!options[index]?.length && (
            <Text style={styles.secondary}>{t('knowledgeNoFacetOptions')}</Text>
          )}
        </View>
      ))}
      {(['provider', 'language', 'entryType'] as const).map((facet) => (
        <KnowledgeValueFacet
          key={facet}
          facet={facet}
          selection={selection}
          facets={facets}
          onValue={onValue}
        />
      ))}
    </View>
  );
};

/**
 * displays explicit institution, language or entry-kind alternatives
 * @param props facet counts and selection
 * @param props.facet backend value facet
 * @param props.selection current selection
 * @param props.facets response counts
 * @param props.onValue selection action
 * @returns accessible facet choices
 */
const KnowledgeValueFacet: FC<
  Pick<KnowledgeFiltersProps, 'selection' | 'facets' | 'onValue'> & {
    facet: 'provider' | 'language' | 'entryType';
  }
> = ({ facet, selection, facets, onValue }) => {
  const { t } = useLocale();
  const key =
    facet === 'provider'
      ? 'providers'
      : facet === 'language'
        ? 'languages'
        : 'entryTypes';
  const selected: readonly string[] = selection[key] ?? [];
  const values = [
    ...new Set([
      ...facets.filter((item) => item.facet === facet).map((item) => item.id),
      ...selected,
    ]),
  ];

  return (
    <View key={facet} testID={`knowledge-facet-${facet}`}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t(
          facet === 'provider'
            ? 'knowledgeFilterInstitution'
            : facet === 'language'
              ? 'knowledgeFilterLanguage'
              : 'knowledgeFilterKind',
        )}
      </Text>
      {values.map((value) => (
        <KnowledgeChoice
          key={value}
          selected={selected.includes(value)}
          label={`${facet === 'entryType' ? t(value === 'object_example' ? 'knowledgeExample' : value === 'method' ? 'knowledgeKindMethod' : 'knowledgeKindConcept') : value} (${facets.find((item) => item.facet === facet && item.id === value)?.count ?? 0})`}
          onPress={() => onValue(key, value)}
        />
      ))}
    </View>
  );
};
