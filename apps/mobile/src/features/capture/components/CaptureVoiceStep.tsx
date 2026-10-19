import { Text, View } from 'react-native';

import { ActionButton, TextField, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeProposalField, localizeStatus } from '../../../i18n/messages';

import type { FC } from 'react';

import type {
  EditDraftDetail,
  JobEnvelope,
  TranscriptionDetail,
} from '@antica/contracts';

import type { CaptureDraft } from '../hooks/useCaptureDraft';

export type CaptureVoiceStepProps = {
  draft: CaptureDraft;
  update: (patch: Partial<CaptureDraft>) => void;
  busy: boolean;
  recording: boolean;
  onRecord: () => void;
  onImportVoice: () => void;
  onTranscribe: () => void;
  transcriptionJobId: string | null;
  transcription: JobEnvelope | undefined;
  transcriptionDetail: TranscriptionDetail | undefined;
  savedObservation: boolean;
  onWordsChanged: () => void;
  onConfirmWords: () => void;
  onPrepareDescription: () => void;
  editJobId: string | null;
  editDraft: JobEnvelope | undefined;
  editDetail: EditDraftDetail | undefined;
  selectedProposalIds: string[];
  onToggleProposal: (id: string) => void;
  onApply: () => void;
  onContinue: () => void;
};

export const CaptureVoiceStep: FC<CaptureVoiceStepProps> = ({
  draft,
  update,
  busy,
  recording,
  onRecord,
  onImportVoice,
  onTranscribe,
  transcriptionJobId,
  transcription,
  transcriptionDetail,
  savedObservation,
  onWordsChanged,
  onConfirmWords,
  onPrepareDescription,
  editJobId,
  editDraft,
  editDetail,
  selectedProposalIds,
  onToggleProposal,
  onApply,
  onContinue,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>
        {t('audio')} / {t('description')}
      </Text>
      <ActionButton
        label={recording ? t('stopRecording') : t('startRecording')}
        onPress={onRecord}
        secondary
      />
      <ActionButton
        label={t('importAudio')}
        onPress={onImportVoice}
        secondary
      />
      {draft.files.some((file) => file.purpose === 'voice_note') && (
        <ActionButton
          label={t('transcribe')}
          onPress={onTranscribe}
          disabled={
            busy ||
            (Boolean(transcriptionJobId) &&
              transcription?.state.kind !== 'failed')
          }
          secondary
        />
      )}
      {transcription && (
        <Text style={styles.secondary}>
          {t('transcribe')}: {localizeStatus(transcription.state.kind, t)}
        </Text>
      )}
      {transcription?.state.kind === 'failed' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {transcription.state.error.message}
        </Text>
      )}
      {transcriptionDetail?.result && (
        <Text style={styles.secondary}>
          {t('originalTranscript')}: {transcriptionDetail.result.originalText}
        </Text>
      )}
      <TextField
        label={t('originalWords')}
        value={draft.originalWords}
        onChangeText={(value) => {
          update({ originalWords: value });
          onWordsChanged();
        }}
        editable={!savedObservation}
        multiline
      />
      {Boolean(draft.originalWords.trim()) && (
        <ActionButton
          label={savedObservation ? t('confirmedWords') : t('confirmWords')}
          onPress={onConfirmWords}
          disabled={busy || savedObservation}
          secondary
        />
      )}
      {savedObservation && draft.transcriptionId && (
        <ActionButton
          label={t('prepareDescription')}
          onPress={onPrepareDescription}
          disabled={
            busy || (Boolean(editJobId) && editDraft?.state.kind !== 'failed')
          }
          secondary
        />
      )}
      {editDraft && (
        <Text style={styles.secondary}>
          {t('prepareDescription')}: {localizeStatus(editDraft.state.kind, t)}
        </Text>
      )}
      {editDraft?.state.kind === 'failed' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {editDraft.state.error.message}
        </Text>
      )}
      {editDetail?.result?.proposedChanges.map((change) => (
        <View key={change.id} style={styles.card}>
          <Text style={styles.heading}>
            {localizeProposalField(change.field, t)}
          </Text>
          <Text style={styles.secondary}>
            {t('previous')}: {JSON.stringify(change.before)}
          </Text>
          <Text style={styles.body}>
            {t('proposed')}: {JSON.stringify(change.proposed)}
          </Text>
          <ActionButton
            label={
              selectedProposalIds.includes(change.id)
                ? t('selectedProposal')
                : t('selectProposal')
            }
            onPress={() => onToggleProposal(change.id)}
            secondary
          />
        </View>
      ))}
      {selectedProposalIds.length > 0 && (
        <ActionButton
          label={`${t('applySelected')} (${selectedProposalIds.length})`}
          onPress={onApply}
          disabled={busy}
        />
      )}
      <TextField
        label={t('preparedDescription')}
        value={draft.preparedDescription}
        onChangeText={(value) => update({ preparedDescription: value })}
        multiline
      />
      <ActionButton
        label={draft.adoptedDescription ? t('adopted') : t('adoptDescription')}
        onPress={() => update({ adoptedDescription: true })}
        disabled={!draft.preparedDescription.trim() || draft.adoptedDescription}
        secondary
      />
      <ActionButton label={t('continue')} onPress={onContinue} />
    </View>
  );
};
