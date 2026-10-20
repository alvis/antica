import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { locationsQuery } from '../api/capture-queries';
import { labelFile, summarizeRecord, toggleSelected } from '../capture-grid';
import { CaptureActionLink } from '../components/CaptureActionLink';
import { CaptureDetailsStep } from '../components/CaptureDetailsStep';
import { CaptureGridStep } from '../components/CaptureGridStep';
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
import { useShotCleanup } from '../hooks/useShotCleanup';
import { useUploadJournal } from '../hooks/useUploadJournal';
import { useVideoThumbnails } from '../hooks/useVideoThumbnails';
import { useVoiceNote } from '../hooks/useVoiceNote';

import { CaptureCameraContainer } from './CaptureCameraContainer';

import type { FC } from 'react';

import type { CaptureRuntime } from '../hooks/useCaptureDraft';

/** step a resumed record opens at to add media */
const mediaStep = 2;

/** step a description answer opens at to type or speak the words */
const wordsStep = 4;

/** step that reviews and labels the photos and videos */
const gridStep = 3;

/** step that saves the record and shows each file's upload */
const saveStep = 6;

export const CaptureContainer: FC = () => {
  const router = useRouter();
  const { recordId, checkId, runId, actionId, mode, resume } =
    useLocalSearchParams<{
      recordId?: string;
      checkId?: string;
      /** run and action being answered, when opened from an analysis action card */
      runId?: string;
      actionId?: string;
      /** `describe` opens the spoken or typed observation step instead of the media step */
      mode?: string;
      /** `1` continues the record's unfinished uploads, as the restart prompt asks */
      resume?: string;
    }>();
  const { api, userId } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const draftState = useCaptureDraft();
  const { draft, setDraft, editedFields, step, setStep, update, editField } =
    draftState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
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
  const resuming = resume === '1' && Boolean(recordId);
  const createDraft = useCaptureRecord(runtime, {
    ...draftState,
    recordId,
    resumeStep: resuming ? saveStep : describing ? wordsStep : mediaStep,
  });
  const {
    fileErrors,
    attempted,
    save,
    retry,
    resume: resumeUploads,
  } = useCaptureSave(runtime, {
    draft,
    editedFields,
    setStep,
    setDraft,
    update,
    userId,
    savedObservation: observation.savedObservation,
    locations: locations.data,
    checkId: linkedCheckId,
    actionLink,
    queryClient,
    router,
  });
  const confirmedObservationId = observation.confirmedObservationId;
  const thumbnails = useVideoThumbnails(draft.files);
  useShotCleanup(draft.files);
  const restored = useUploadJournal({
    draft,
    setDraft,
    resume: resuming,
    attempted,
    userId,
  });
  const [resumed, setResumed] = useState(false);

  // Resume on the restart prompt is the collector's request, so the restored files upload now;
  // only the files upload, since the record's fields were saved before the app closed
  useEffect(() => {
    if (restored?.length && !resumed) {
      setResumed(true);
      void resumeUploads(restored);
    }
  }, [restored]);

  const failedIds = draft.files
    .filter((file) => file.state === 'failed' && !file.excluded)
    .map((file) => file.id);
  const retryFile = (fileId: string): void => void retry([fileId]);
  const summary = summarizeRecord(draft.record, t('newItem'));

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
      subtitle={draft.record ? draft.record.code : t('privateCollection')}
      askContext={{
        kind: 'capture',
        check:
          actionLink.action?.instruction ?? `${t('addItem')} · ${step} / 6`,
      }}>
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
          onChoose={(camera, video) =>
            camera && !video
              ? setCameraOpen(true)
              : void chooseMedia(camera, video)
          }
          onContinue={draftState.next}
        />
      )}
      {step === gridStep && (
        <CaptureGridStep
          kind={draft.kind}
          recordName={summary.name}
          recordCode={summary.code}
          files={draft.files}
          componentLabels={summary.componentLabels}
          thumbnails={thumbnails}
          busy={busy}
          onToggle={(fileId) =>
            setDraft((current) => ({
              ...current,
              files: toggleSelected(current.files, fileId),
            }))
          }
          onRetry={retryFile}
          onLabel={(fileId, componentLabel) =>
            setDraft((current) => ({
              ...current,
              files: labelFile(current.files, fileId, componentLabel),
            }))
          }
          onAddPhoto={() => setCameraOpen(true)}
          onAddVideo={() => void chooseMedia(true, true)}
          onBack={() => setStep(mediaStep)}
          onNext={draftState.next}
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
      {step === saveStep && (
        <CaptureSaveStep
          files={draft.files.filter((file) => !file.excluded)}
          fileErrors={fileErrors}
          busy={busy}
          onSave={() => void save()}
          onRetry={retryFile}
          onRetryAll={() => void retry(failedIds)}
        />
      )}
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {cameraOpen && (
        <CaptureCameraContainer
          recordName={summary.name}
          recordCode={summary.code}
          onShot={(file) =>
            setDraft((current) => ({
              ...current,
              files: [...current.files, file],
            }))
          }
          onImport={() => {
            setCameraOpen(false);
            void chooseMedia(false, false);
          }}
          onReview={() => {
            setCameraOpen(false);
            setStep(gridStep);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </Screen>
  );
};
