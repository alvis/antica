import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { ActionCard } from './ActionCard';

import type { FC } from 'react';

import type {
  ActionState,
  AnalysisRunDetail,
  Finding,
} from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** the kinds of reference a finding cites */
export type ReferenceKind = 'evidence' | 'observation' | 'citation';

/** button label of each kind of finding reference, followed by a short ID */
const referenceLabelKeys = {
  evidence: 'evidenceWithId',
  observation: 'observationWithId',
  citation: 'citationWithId',
} as const satisfies Record<ReferenceKind, MessageKey>;

/** properties for the analysis details under the suggestions */
export type AnalysisDetailsProps = {
  run: AnalysisRunDetail;
  /** each action's note while the collector writes it */
  actionText: Readonly<Record<string, string>>;
  onActionTextChange: (actionId: string, text: string) => void;
  busy: boolean;
  /** whether the record is read, which resolving an action needs */
  canResolve: boolean;
  onReference: (kind: ReferenceKind, id: string) => void;
  onStartCheck: (methodId: string, methodVersionId: string) => void;
  onViewMethod: (owningEntryId: string, methodVersionId: string) => void;
  onCapture: (actionId: string) => void;
  onDescribe: (actionId: string) => void;
  onOpenCheck: (checkId: string) => void;
  onResolve: (
    actionId: string,
    state: ActionState,
    status: 'supplied' | 'dismissed',
  ) => void;
};

/**
 * the whole analysis behind the suggestions: the summary, every finding with its references, what
 * stays uncertain, suggested checks and each requested action with its resolution
 * @param props details properties
 * @param props.run the analysis run
 * @param props.actionText each action's note
 * @param props.onActionTextChange edits an action's note
 * @param props.busy whether a save is in flight
 * @param props.canResolve whether an action can be resolved now
 * @param props.onReference opens a finding's reference
 * @param props.onStartCheck starts a suggested check
 * @param props.onViewMethod opens a check's method
 * @param props.onCapture photographs for an action
 * @param props.onDescribe describes for an action
 * @param props.onOpenCheck opens an action's check
 * @param props.onResolve supplies or dismisses an action
 * @returns the details
 */
export const AnalysisDetails: FC<AnalysisDetailsProps> = ({
  run,
  actionText,
  onActionTextChange,
  busy,
  canResolve,
  onReference,
  onStartCheck,
  onViewMethod,
  onCapture,
  onDescribe,
  onOpenCheck,
  onResolve,
}) => {
  const { t } = useLocale();
  const output = run.result.output;
  if (!output) {
    return null;
  }
  const groups = [
    ['photoClues', 'visualObservation'],
    ['collectorObservations', 'collectorObservation'],
    ['sourceClaims', 'sourceStatement'],
    ['hypothesesPendingResearch', 'hypothesis'],
  ] as const;

  return (
    <View testID="analysis-details" style={{ gap: 24 }}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('summary')}</Text>
        <Text style={styles.body}>{output.summary}</Text>
      </View>
      {groups.map(([title, kind]) => (
        <FindingGroup
          key={kind}
          title={t(title)}
          findings={output.findings.filter((finding) => finding.kind === kind)}
          onReference={onReference}
        />
      ))}
      {output.uncertainties.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('uncertainties')}</Text>
          {output.uncertainties.map((value, index) => (
            <Text key={index} style={styles.body}>
              {value}
            </Text>
          ))}
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.heading}>{t('tasks')}</Text>
        {run.suggestedMethods.map((method) => (
          <View key={method.methodId} style={styles.card}>
            <Text style={styles.body}>{method.titleZhHant}</Text>
            <ActionButton
              label={t('startCheck')}
              onPress={() =>
                onStartCheck(method.methodId, method.methodVersionId)
              }
              disabled={busy}
              secondary
            />
            <ActionButton
              label={t('viewMethod')}
              onPress={() =>
                onViewMethod(method.owningEntryId, method.methodVersionId)
              }
              secondary
            />
          </View>
        ))}
        {output.nextActions.map((action) => {
          const state = run.result.actionStates.find(
            (item) => item.actionId === action.id,
          );

          return (
            <ActionCard
              key={action.id}
              action={action}
              status={state?.status ?? 'pending'}
              note={actionText[action.id] ?? ''}
              onNoteChange={(value) => onActionTextChange(action.id, value)}
              busy={busy}
              canResolve={canResolve}
              onCapture={() => onCapture(action.id)}
              onDescribe={() => onDescribe(action.id)}
              onOpenCheck={() => action.checkId && onOpenCheck(action.checkId)}
              onResolve={
                state
                  ? (status) => onResolve(action.id, state, status)
                  : undefined
              }
            />
          );
        })}
      </View>
    </View>
  );
};

type FindingGroupProps = {
  title: string;
  findings: Finding[];
  onReference: (kind: ReferenceKind, id: string) => void;
};

/**
 * lists one kind of finding with its certainty, relation and references
 * @param props group properties
 * @param props.title the group's heading
 * @param props.findings findings of one kind
 * @param props.onReference opens a reference
 * @returns the group card
 */
const FindingGroup: FC<FindingGroupProps> = ({
  title,
  findings,
  onReference,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      {findings.map((finding) => (
        <View key={finding.id} style={styles.card}>
          <Text style={styles.body}>{finding.text}</Text>
          <Text style={styles.secondary}>
            {t(finding.certainty)} · {t(finding.relation)}
          </Text>
          {[
            ...finding.evidenceIds.map((id) => ({
              id,
              kind: 'evidence' as const,
            })),
            ...finding.observationIds.map((id) => ({
              id,
              kind: 'observation' as const,
            })),
            ...finding.citationIds.map((id) => ({
              id,
              kind: 'citation' as const,
            })),
          ].map(({ id, kind }) => (
            <ActionButton
              key={`${kind}:${id}`}
              label={t(referenceLabelKeys[kind], { id: id.slice(0, 8) })}
              onPress={() => onReference(kind, id)}
              secondary
            />
          ))}
        </View>
      ))}
      {findings.length === 0 && <Text style={styles.secondary}>—</Text>}
    </View>
  );
};
