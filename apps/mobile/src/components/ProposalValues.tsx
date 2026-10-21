import { useKnowledgeTitles } from '../hooks/useKnowledgeTitles';
import { useLocale } from '../providers/LocaleProvider';

import { FieldValue } from './FieldValue';

import type { FC } from 'react';

import type { ProposedChange } from '@antica/contracts';

import type { FieldDisplayValue } from '../utils/field-value';

/** properties for the values a proposed change replaces and proposes */
export type ProposalValuesProps = { change: ProposedChange };

/**
 * shows a proposed change's previous and proposed values, naming the
 * knowledge entries a material change refers to instead of their identifiers
 * @param props change properties
 * @param props.change proposed change to show
 * @returns the previous value above the proposed one
 */
export const ProposalValues: FC<ProposalValuesProps> = ({ change }) => {
  const { t } = useLocale();
  const materials =
    change.field === 'materialIds' || change.field === 'categoryIds';
  const title = useKnowledgeTitles(
    change.field === 'materialIds' || change.field === 'categoryIds'
      ? [...change.before, ...change.proposed]
      : [],
  );
  const shown = (value: ProposedChange['before']): FieldDisplayValue =>
    materials ? (value as readonly string[]).map(title) : value;

  return (
    <>
      <FieldValue label={t('previous')} value={shown(change.before)} />
      <FieldValue label={t('proposed')} value={shown(change.proposed)} />
    </>
  );
};
