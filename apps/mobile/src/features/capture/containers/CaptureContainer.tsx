import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { useAuth } from '../../../providers/AuthProvider';

import { locationsQuery } from '../api/capture-queries';
import { CaptureComponentsStep } from '../components/CaptureComponentsStep';
import { CaptureDetailsStep } from '../components/CaptureDetailsStep';
import { CaptureKindStep } from '../components/CaptureKindStep';
import { CaptureMediaStep } from '../components/CaptureMediaStep';
import { CaptureSaveStep } from '../components/CaptureSaveStep';
import { CaptureVoiceStep } from '../components/CaptureVoiceStep';
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

export const CaptureContainer: FC = () => {
  const router = useRouter();
  const { recordId, checkId } = useLocalSearchParams<{
    recordId?: string;
    checkId?: string;
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
  const observation = useCaptureObservation(runtime, {
    draft,
    update,
    jobs,
    checkId,
    queryClient,
  });
  const edit = useEditDraft(runtime, {
    ...draftState,
    jobs,
    confirmedObservationId: observation.confirmedObservationId,
  });
  const createDraft = useCaptureRecord(runtime, { ...draftState, recordId });
  const { fileErrors, save } = useCaptureSave(runtime, {
    draft,
    editedFields,
    setStep,
    update,
    savedObservation: observation.savedObservation,
    locations: locations.data,
    checkId,
    queryClient,
    router,
  });

  return (
    <Screen
      title={t('addItem')}
      subtitle={draft.record ? draft.record.code : t('privateCollection')}>
      <Text style={styles.secondary}>{step} / 6</Text>
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
          onConfirmWords={() => void observation.confirmWords()}
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
