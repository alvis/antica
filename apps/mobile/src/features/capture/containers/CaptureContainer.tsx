import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { locationsQuery } from '../api/capture-queries';
import { CaptureActionLink } from '../components/CaptureActionLink';
import { CaptureComponentsStep } from '../components/CaptureComponentsStep';
import { CaptureDetailsStep } from '../components/CaptureDetailsStep';
import { CaptureKindStep } from '../components/CaptureKindStep';
import { CaptureMediaStep } from '../components/CaptureMediaStep';
import { CaptureSaveStep } from '../components/CaptureSaveStep';
import { CaptureVoiceStep } from '../components/CaptureVoiceStep';
import { describeActionLinkError, useActionLink } from '../hooks/useActionLink';
import { useCaptureDraft } from '../hooks/useCaptureDraft';
import { useCaptureJobs } from '../hooks/useCaptureJobs';
import { useCaptureMedia } from '../hooks/useCaptureMedia';
import { useCaptureObservation } from '../hooks/useCaptureObservation';
import { useCaptureRecord } from '../hooks/useCaptureRecord';
import { useCaptureSave } from '../hooks/useCaptureSave';
import { useEditDraft } from '../hooks/useEditDraft';
import { useVoiceNote } from '../hooks/useVoiceNote';

import type { FC } from 'react';

import type { CaptureRuntime } from '../hooks/useCaptureDraft';

/** step a resumed record opens at to add media */
const mediaStep = 2;

/** step a description answer opens at to type or speak the words */
const wordsStep = 4;

export const CaptureContainer: FC = () => {
  const router = useRouter();
  const { recordId, checkId, runId, actionId, mode } = useLocalSearchParams<{
    recordId?: string;
    checkId?: string;
    /** run and action being answered, when opened from an analysis action card */
    runId?: string;
    actionId?: string;
    /** `describe` opens the spoken or typed observation step instead of the media step */
    mode?: string;
  }>();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const draftState = useCaptureDraft();
  const { draft, setDraft, editedFields, step, setStep, update, editField } =
    draftState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runtime: CaptureRuntime = { api, t, busy, setBusy, setError };
  // specs queue mocked API responses in call order, so keep this hook order stable
  const voice = useVoiceNote({ setDraft, setError, t });
  const chooseMedia = useCaptureMedia({ setDraft, setError, t });
  const locations = useQuery(locationsQuery(api));
  const jobs = useCaptureJobs(runtime, draftState);
  const actionLink = useActionLink(api, {
    recordId,
    runId,
    actionId,
    queryClient,
  });
  // an action names its own check; the route's check only applies to a capture opened from a check
  const linkedCheckId = actionLink.linked ? actionLink.checkId : checkId;
  const observation = useCaptureObservation(runtime, {
    draft,
    update,
    jobs,
    checkId: linkedCheckId,
    queryClient,
  });
  const edit = useEditDraft(runtime, {
    ...draftState,
    jobs,
    confirmedObservationId: observation.confirmedObservationId,
  });
  const describing = mode === 'describe';
  const createDraft = useCaptureRecord(runtime, {
    ...draftState,
    recordId,
    resumeStep: describing ? wordsStep : mediaStep,
  });
  const { fileErrors, save } = useCaptureSave(runtime, {
    draft,
    editedFields,
    setStep,
    update,
    savedObservation: observation.savedObservation,
    locations: locations.data,
    checkId: linkedCheckId,
    actionLink,
    queryClient,
    router,
  });
  const confirmedObservationId = observation.confirmedObservationId;

  /**
   * supplies the action with the confirmed words and returns to its run
   * @param observationId confirmed observation answering the action
   */
  const finishDescription = async (observationId: string): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await actionLink.supply({ observationIds: [observationId] });
      router.replace(`/analysis/${runId}`);
    } catch (cause) {
      setError(describeActionLinkError(cause, t));
    } finally {
      setBusy(false);
    }
  };

  /**
   * confirms the spoken or typed words, after checking that a linked action may receive them
   */
  const confirmWords = async (): Promise<void> => {
    try {
      await actionLink.verify();
    } catch (cause) {
      setError(describeActionLinkError(cause, t));

      return;
    }
    await observation.confirmWords();
  };

  return (
    <Screen
      title={t('addItem')}
      subtitle={draft.record ? draft.record.code : t('privateCollection')}>
      <Text style={styles.secondary}>{step} / 6</Text>
      {actionLink.linked && (
        <CaptureActionLink
          action={actionLink.action}
          checkId={actionLink.checkId}
          problem={actionLink.problem}
          busy={busy}
          onFinish={
            describing && confirmedObservationId
              ? () => void finishDescription(confirmedObservationId)
              : undefined
          }
        />
      )}
      {step === 1 && (
        <CaptureKindStep
          busy={busy}
          onSelect={(kind) => void createDraft(kind)}
        />
      )}
      {step === 2 && (
        <CaptureMediaStep
          onChoose={(camera, video) => void chooseMedia(camera, video)}
          onContinue={draftState.next}
        />
      )}
      {step === 3 && (
        <CaptureComponentsStep
          kind={draft.kind}
          files={draft.files}
          onLabel={(fileId, componentLabel) =>
            update({
              files: draft.files.map((item) =>
                item.id === fileId ? { ...item, componentLabel } : item,
              ),
            })
          }
          onPhoto={() => void chooseMedia(true, false)}
          onContinue={draftState.next}
        />
      )}
      {step === 4 && (
        <CaptureVoiceStep
          draft={draft}
          update={update}
          busy={busy}
          recording={voice.recording}
          onRecord={() =>
            void (
              voice.recording ? voice.stopVoice() : voice.startVoice()
            ).catch((cause) => setError((cause as Error).message))
          }
          onImportVoice={() => void voice.importVoice()}
          onTranscribe={() => void jobs.prepareVoice()}
          transcriptionJobId={jobs.transcriptionJobId}
          transcription={jobs.transcription.data}
          transcriptionDetail={jobs.transcriptionDetail.data}
          savedObservation={observation.savedObservation}
          onWordsChanged={() => observation.setConfirmRequest(null)}
          onConfirmWords={() => void confirmWords()}
          onPrepareDescription={() => void edit.prepareDescription()}
          editJobId={jobs.editJobId}
          editDraft={jobs.editDraft.data}
          editDetail={jobs.editDetail.data}
          selectedProposalIds={edit.selectedProposalIds}
          onToggleProposal={edit.toggleProposal}
          onApply={() => void edit.applyEdit()}
          onContinue={draftState.next}
        />
      )}
      {step === 5 && (
        <CaptureDetailsStep
          draft={draft}
          locations={locations.data}
          editField={editField}
          update={update}
          onReceipt={() => void chooseMedia(false, false, 'receipt')}
          onContinue={draftState.next}
        />
      )}
      {step === 6 && (
        <CaptureSaveStep
          files={draft.files}
          fileErrors={fileErrors}
          busy={busy}
          onSave={() => void save()}
        />
      )}
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
