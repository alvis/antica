import { Text, View } from 'react-native';

import { ActionButton, colors, styles } from '@antica/ui';

import { BusyButton } from '../../../components/BusyButton';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { MessageKey } from '../../../i18n/messages';

import type { RecordAnalysisState } from '../record-analysis-state';

/** properties for a saved record's analysis state and actions */
export type RecordAnalysisStatusProps = {
  state: RecordAnalysisState;
  /** whether the record has the evidence an analysis needs */
  canAnalyse: boolean;
  /** whether a start request is running */
  starting: boolean;
  onAnalyse: () => void;
  /** opens the latest run; absent before the first run */
  onOpenRun?: () => void;
  /** loads the latest run again after it could not be read */
  onRetryRun: () => void;
  /** whether the latest run is loading again */
  retryingRun: boolean;
  /** localized failure of the last start request, shown beside Analyse */
  error: string;
};

const presentation = {
  unanalysed: { badge: 'notAnalyzed', hint: 'savedNotAnalysedHint' },
  running: { badge: 'analysisRunning', hint: 'analysisRunningHint' },
  analysed: { badge: 'analysisDone', hint: null },
  partial: { badge: 'analysisPartialDone', hint: null },
  failed: { badge: 'analysisFailedBadge', hint: 'analysisFailed' },
  outdated: { badge: 'newEvidence', hint: 'newEvidenceHint' },
  unknown: {
    badge: 'analysisStatusUnknown',
    hint: 'analysisStatusUnknownHint',
  },
} as const satisfies Record<
  RecordAnalysisState,
  { badge: MessageKey; hint: MessageKey | null }
>;

/** states shown as needing attention */
const warningStates = new Set<RecordAnalysisState>([
  'failed',
  'outdated',
  'unknown',
]);

/** states that offer a new analysis of the record's current input */
const analysableStates = new Set<RecordAnalysisState>([
  'unanalysed',
  'failed',
  'outdated',
]);

const badgeStyle = {
  minHeight: 36,
  borderRadius: 18,
  paddingHorizontal: 14,
  justifyContent: 'center',
} as const;

/**
 * shows the saved badge beside the analysis badge, announced together
 * @param props badge properties
 * @param props.state how the record stands against analysis
 * @returns the badge row
 */
const StatusBadges: FC<{ state: RecordAnalysisState }> = ({ state }) => {
  const { t } = useLocale();
  const { badge } = presentation[state];
  const warning = warningStates.has(state);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${t('recordSaved')}, ${t(badge)}`}
      accessibilityLiveRegion="polite"
      style={styles.row}>
      <View
        testID="record-saved-badge"
        style={[badgeStyle, { backgroundColor: colors.jade }]}>
        <Text style={[styles.label, { color: colors.card }]}>
          ✓ {t('recordSaved')}
        </Text>
      </View>
      <View
        testID="record-analysis-badge"
        style={[
          badgeStyle,
          {
            borderWidth: 1,
            borderColor: warning ? colors.warning : colors.border,
          },
        ]}>
        <Text
          style={[
            styles.label,
            { color: warning ? colors.warning : colors.muted },
          ]}>
          {t(badge)}
        </Text>
      </View>
    </View>
  );
};

/**
 * shows "Saved" with the analysis state, the Analyse action, and the link to the latest run (B06, C05)
 * @param props status properties
 * @param props.state how the record stands against analysis
 * @param props.canAnalyse whether the record has evidence to analyse
 * @param props.starting whether a start request is running
 * @param props.onAnalyse starts one analysis of the record
 * @param props.onOpenRun opens the latest run, when one exists
 * @param props.onRetryRun loads the latest run again
 * @param props.retryingRun whether the latest run is loading again
 * @param props.error failure of the last start request
 * @returns the status badges, hint, and actions
 */
export const RecordAnalysisStatus: FC<RecordAnalysisStatusProps> = ({
  state,
  canAnalyse,
  starting,
  onAnalyse,
  onOpenRun,
  onRetryRun,
  retryingRun,
  error,
}) => {
  const { t } = useLocale();
  const { hint } = presentation[state];

  return (
    <View testID={`record-analysis-status-${state}`} style={{ gap: 12 }}>
      <StatusBadges state={state} />
      {analysableStates.has(state) && (
        <BusyButton
          testID="record-analyse"
          label={t(state === 'unanalysed' ? 'analyze' : 'analyzeAgain')}
          onPress={onAnalyse}
          busy={starting}
          disabled={!canAnalyse}
        />
      )}
      {Boolean(error) && (
        <Text
          testID="record-analyse-error"
          accessibilityRole="alert"
          style={styles.error}>
          {error}
        </Text>
      )}
      {hint && (
        <Text style={[styles.secondary, { textAlign: 'center' }]}>
          {t(hint)}
        </Text>
      )}
      {state === 'unknown' && (
        <BusyButton
          testID="record-analysis-retry"
          label={t('retry')}
          onPress={onRetryRun}
          busy={retryingRun}
        />
      )}
      {onOpenRun && (
        <ActionButton
          testID="record-open-run"
          label={t('viewAnalysis')}
          onPress={onOpenRun}
          secondary
        />
      )}
    </View>
  );
};
