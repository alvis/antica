import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { IconName } from '@antica/ui';

import type { RecordAnalysisState } from '../record-analysis-state';
import type { RecordPrimary } from '../record-hub';

/** properties for the record hub's one first action and the line under it */
export type RecordPrimaryActionProps = {
  primary: RecordPrimary;
  /** the analysis state, named in the automation identifier */
  analysisState: RecordAnalysisState;
  /** what the line under the button says, such as when the analysis finished */
  status?: string;
  /** whether the record has the evidence an analysis needs */
  canAnalyse: boolean;
  /** whether a start request or a reload of the run is running */
  busy: boolean;
  /** localized failure of the last start request */
  error?: string;
  onPress: () => void;
};

const layout = StyleSheet.create({
  status: {
    marginTop: theme.space[6],
    ...theme.type.small,
    color: theme.color.text.tertiary,
    textAlign: 'center',
  },
  error: {
    marginTop: theme.space[6],
    ...theme.type.small,
    color: theme.color.input.errorText,
    textAlign: 'center',
  },
});

/** the label, icon and identifier of each kind of first action */
interface Presentation {
  readonly label: string;
  readonly icon?: IconName;
  readonly testID: string;
  readonly secondary?: boolean;
}

/**
 * the hub's adaptive primary: one button for what waits on the collector, with a status line;
 * it only opens the screen where they decide, so it never applies anything itself
 * @param root0 action properties
 * @param root0.primary the chosen first action
 * @param root0.analysisState analysis state for the automation identifier
 * @param root0.status the line under the button
 * @param root0.canAnalyse whether analysis can start
 * @param root0.busy whether a request is running
 * @param root0.error failure of the last start request
 * @param root0.onPress takes the action
 * @returns the button and its status line
 */
export const RecordPrimaryAction: FC<RecordPrimaryActionProps> = ({
  primary,
  analysisState,
  status,
  canAnalyse,
  busy,
  error,
  onPress,
}) => {
  const { t } = useLocale();
  const presentation = present(primary, t);

  return (
    <View testID={`record-analysis-status-${analysisState}`}>
      <ActionButton
        testID={presentation.testID}
        label={presentation.label}
        icon={presentation.icon}
        secondary={presentation.secondary}
        loading={busy || primary.kind === 'running'}
        disabled={primary.kind === 'analyse' && !canAnalyse}
        onPress={onPress}
      />
      {status && (
        <Text accessibilityLiveRegion="polite" style={layout.status}>
          {status}
        </Text>
      )}
      {error && (
        <Text
          testID="record-analyse-error"
          accessibilityRole="alert"
          style={layout.error}>
          {error}
        </Text>
      )}
    </View>
  );
};

/**
 * names the button for a first action
 * @param primary the chosen first action
 * @param t translator
 * @returns its label, icon, identifier and emphasis
 */
function present(
  primary: RecordPrimary,
  t: ReturnType<typeof useLocale>['t'],
): Presentation {
  switch (primary.kind) {
    case 'review':
      return {
        label: t('recordReview', { count: primary.count }),
        icon: 'spark',
        testID: 'record-review-suggestions',
      };
    case 'confirmEdits':
      return {
        label: t('recordConfirmEdits', { count: primary.count }),
        icon: 'chat',
        testID: 'record-confirm-edits',
      };
    case 'capture':
      return {
        label: primary.action.instruction,
        icon: 'camera',
        testID: 'record-capture-request',
      };
    case 'analyse':
      return {
        label: t(
          primary.state === 'unanalysed'
            ? 'recordStartAnalysis'
            : 'analyzeAgain',
        ),
        icon: 'spark',
        testID: 'record-analyse',
      };
    case 'running':
      return { label: t('analysisRunning'), testID: 'record-analysis-running' };
    case 'unknown':
      return { label: t('retry'), testID: 'record-analysis-retry' };
    default:
      return {
        label: t('viewAnalysis'),
        testID: 'record-open-run',
        secondary: true,
      };
  }
}
