import type { ProposedChange } from '@antica/contracts';

import type { PlainMessageKey } from '../../i18n/messages';

/** localized labels for a field suggestion's confidence, independent of authenticity */
export const confidenceKeys = {
  high: 'confidenceHigh',
  medium: 'confidenceMedium',
  low: 'confidenceLow',
} as const satisfies Record<
  NonNullable<ProposedChange['confidence']>,
  PlainMessageKey
>;
