import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';

import {
  editDraftRequestSchema,
  editDraftAcceptedSchema,
  editDraftApplySchema,
  editDraftAppliedSchema,
  editDraftDetailSchema,
  evidenceCreationSchema,
  jobStatusEnvelopeSchema,
  locationsSchema,
  locationSchema,
  mediaDetailSchema,
  observationInputSchema,
  observationSchema,
  recordDetailSchema,
  recordPatchSchema,
  transcriptionSubmitSchema,
  transcriptionAcceptedSchema,
  transcriptionConfirmSchema,
  transcriptionConfirmedSchema,
  transcriptionDetailSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { useAuth } from '../../auth';
import { Screen } from '../../components/Screen';
import { localizeProposalField, localizeStatus, useLocale } from '../../locale';

import { uploadMedia } from './media-upload';

import type { FC } from 'react';

import type {
  EditDraftApply,
  RecordDetail,
  TranscriptionConfirm,
} from '@antica/contracts';

import type { LocalMedia } from './media-upload';

interface CaptureDraft {
  record: RecordDetail | null;
  kind: 'single' | 'set';
  files: LocalMedia[];
  originalWords: string;
  preparedDescription: string;
  adoptedDescription: boolean;
  transcriptionId: string | null;
  name: string;
  category: string;
  height: string;
  heightUnit: 'mm' | 'cm';
  locationLabel: string;
  locationDetail: string;
}

type EditableField =
  'name' | 'category' | 'height' | 'locationLabel' | 'locationDetail';

type EditedFields = Record<EditableField, boolean>;

const initialEditedFields: EditedFields = {
  name: false,
  category: false,
  height: false,
  locationLabel: false,
  locationDetail: false,
};

const initialDraft: CaptureDraft = {
  record: null,
  kind: 'single',
  files: [],
  originalWords: '',
  preparedDescription: '',
  adoptedDescription: false,
  transcriptionId: null,
  name: '',
  category: '',
  height: '',
  heightUnit: 'cm',
  locationLabel: '',
  locationDetail: '',
};

export const CaptureContainer: FC = () => {
  const router = useRouter();
  const { recordId, checkId } = useLocalSearchParams<{
    recordId?: string;
    checkId?: string;
  }>();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [draft, setDraft] = useState<CaptureDraft>(initialDraft);
  const [editedFields, setEditedFields] =
    useState<EditedFields>(initialEditedFields);
  const [step, setStep] = useState(1);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [savedFields, setSavedFields] = useState(false);
  const [savedObservation, setSavedObservation] = useState(false);
  const [observationKey] = useState(randomUUID);
  const [observationTime] = useState(() => new Date().toISOString());
  const [transcriptionJobId, setTranscriptionJobId] = useState<string | null>(
    null,
  );
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [transcriptionResourceId, setTranscriptionResourceId] = useState<
    string | null
  >(null);
  const [editResourceId, setEditResourceId] = useState<string | null>(null);
  const [confirmedObservationId, setConfirmedObservationId] = useState<
    string | null
  >(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const [confirmRequest, setConfirmRequest] =
    useState<TranscriptionConfirm | null>(null);
  const [applyRequest, setApplyRequest] = useState<EditDraftApply | null>(null);
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: async ({ signal }) =>
      api.get('/v1/locations', locationsSchema, signal),
  });
  const transcription = useQuery({
    queryKey: ['job', transcriptionJobId],
    enabled: Boolean(transcriptionJobId),
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/jobs/${transcriptionJobId}`,
        jobStatusEnvelopeSchema,
        signal,
      ),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting'].includes(
        query.state.data?.state.kind ?? '',
      )
        ? 3000
        : false,
  });
  const editDraft = useQuery({
    queryKey: ['job', editJobId],
    enabled: Boolean(editJobId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/jobs/${editJobId}`, jobStatusEnvelopeSchema, signal),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting'].includes(
        query.state.data?.state.kind ?? '',
      )
        ? 3000
        : false,
  });
  const transcriptionDetail = useQuery({
    queryKey: ['transcription', transcriptionResourceId],
    enabled:
      Boolean(transcriptionResourceId) &&
      ['succeeded', 'partial'].includes(transcription.data?.state.kind ?? ''),
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/transcriptions/${transcriptionResourceId}`,
        transcriptionDetailSchema,
        signal,
      ),
  });
  const editDetail = useQuery({
    queryKey: ['edit-draft', editResourceId],
    enabled:
      Boolean(editResourceId) &&
      ['succeeded', 'partial'].includes(editDraft.data?.state.kind ?? ''),
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/edit-drafts/${editResourceId}`,
        editDraftDetailSchema,
        signal,
      ),
  });

  useEffect(() => {
    const id = draft.record?.id;
    if (!id) {
      return;
    }
    let active = true;
    void Promise.all([
      getItemAsync(`antica.transcriptionJob.${id}`),
      getItemAsync(`antica.editJob.${id}`),
      getItemAsync(`antica.transcription.${id}`),
      getItemAsync(`antica.editDraft.${id}`),
    ])
      .then(([transcriptionId, editingId, transcriptId, draftId]) => {
        if (!active) {
          return;
        }
        if (transcriptionId) {
          setTranscriptionJobId((current) => current ?? transcriptionId);
        }
        if (editingId) {
          setEditJobId((current) => current ?? editingId);
        }
        if (transcriptId) {
          setTranscriptionResourceId((current) => current ?? transcriptId);
        }
        if (draftId) {
          setEditResourceId((current) => current ?? draftId);
        }
      })
      .catch((cause: unknown) => {
        setError((cause as Error).message);
      });

    return () => {
      active = false;
    };
  }, [draft.record?.id]);

  useEffect(() => {
    const result = transcriptionDetail.data?.result;
    if (result) {
      setDraft((current) => ({
        ...current,
        transcriptionId: result.transcriptionId,
        originalWords:
          current.originalWords ||
          result.readingTextZhHant ||
          result.originalText,
      }));
    }
  }, [transcriptionDetail.data?.result]);

  useEffect(() => {
    const id = transcriptionDetail.data?.confirmedObservationId;
    if (id) {
      setConfirmedObservationId(id);
      setSavedObservation(true);
    }
  }, [transcriptionDetail.data?.confirmedObservationId]);

  useEffect(() => {
    const result = editDetail.data?.result;
    if (result) {
      setDraft((current) => ({
        ...current,
        preparedDescription:
          current.preparedDescription || result.suggestedDescriptionZhHant,
      }));
    }
  }, [editDetail.data?.result]);

  useEffect(() => {
    if (!recordId) {
      return;
    }
    let active = true;
    void api
      .get(`/v1/records/${recordId}`, recordDetailSchema)
      .then((record) => {
        if (active) {
          setDraft((current) => ({
            ...current,
            record,
            kind: record.unitKind,
            name: record.name ?? '',
            preparedDescription: record.description,
            locationDetail: record.location.detail,
          }));
          setStep(2);
        }
      })
      .catch((cause) => {
        if (active) {
          setError((cause as Error).message);
        }
      });

    return () => {
      active = false;
    };
  }, [api, recordId]);

  const update = (patch: Partial<CaptureDraft>): void =>
    setDraft((current) => ({ ...current, ...patch }));

  const editField = (field: EditableField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setEditedFields((current) => ({ ...current, [field]: true }));
  };

  const createDraft = async (kind: 'single' | 'set'): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const record = await api.post('/v1/records', recordDetailSchema, {
        body: { unitKind: kind },
        idempotencyKey: randomUUID(),
      });
      update({ record, kind });
      setStep(2);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseMedia = async (
    camera: boolean,
    video: boolean,
    purpose: LocalMedia['purpose'] = 'object',
  ): Promise<void> => {
    setError('');
    try {
      if (camera && !(await requestCameraPermissionsAsync()).granted) {
        setError(t('permissionDenied'));

        return;
      }
      const options = {
        mediaTypes: video ? ('videos' as const) : ('images' as const),
        quality: 1 as const,
      };
      const selection = camera
        ? await launchCameraAsync(options)
        : await launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
          });
      if (selection.canceled) {
        return;
      }
      const files = selection.assets.map((asset) => ({
        id: randomUUID(),
        uri: asset.uri,
        name: asset.fileName ?? `antica-${Date.now()}.${video ? 'mp4' : 'jpg'}`,
        mimeType: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        kind: video ? ('video' as const) : ('photo' as const),
        purpose,
        componentLabel: '',
        state: 'local' as const,
        assetId: null,
        checkRequestKey: randomUUID(),
      }));
      setDraft((current) => ({
        ...current,
        files: [...current.files, ...files],
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const startVoice = async (): Promise<void> => {
    if (!(await requestRecordingPermissionsAsync()).granted) {
      setError(t('permissionDenied'));

      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const stopVoice = async (): Promise<void> => {
    await recorder.stop();
    setRecording(false);
    if (recorder.uri) {
      const uri = recorder.uri;
      const file = new File(uri);
      setDraft((current) => ({
        ...current,
        files: [
          ...current.files,
          {
            id: randomUUID(),
            uri,
            name: file.name || 'voice.m4a',
            mimeType: 'audio/mp4',
            kind: 'audio',
            purpose: 'voice_note',
            componentLabel: '',
            state: 'local',
            assetId: null,
          },
        ],
      }));
    }
  };

  const importVoice = async (): Promise<void> => {
    setError('');
    try {
      const selection = await File.pickFileAsync({ mimeTypes: 'audio/*' });
      if (selection.canceled) {
        return;
      }
      const file = selection.result;
      setDraft((current) => ({
        ...current,
        files: [
          ...current.files,
          {
            id: randomUUID(),
            uri: file.uri,
            name: file.name || 'voice.m4a',
            mimeType: file.type || 'audio/mp4',
            kind: 'audio',
            purpose: 'voice_note',
            componentLabel: '',
            state: 'local',
            assetId: null,
          },
        ],
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const prepareVoice = async (): Promise<void> => {
    const audio = draft.files.find((file) => file.purpose === 'voice_note');
    if (!audio || !draft.record || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const assetId =
        audio.assetId ??
        (await uploadMedia(
          api,
          audio,
          { kind: 'record', id: draft.record.id },
          [],
        ));
      update({
        files: draft.files.map((file) =>
          file.id === audio.id ? { ...file, assetId, state: 'uploaded' } : file,
        ),
      });
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      update({ record: current });
      const request = transcriptionSubmitSchema.parse({
        requestKey: randomUUID(),
        recordId: current.id,
        expectedRecordRevision: current.recordRevision,
        audioAssetId: assetId,
        vocabularyHints: [],
      });
      const accepted = await api.post(
        '/v1/transcriptions',
        transcriptionAcceptedSchema,
        { body: request, idempotencyKey: request.requestKey },
      );
      setTranscriptionJobId(accepted.jobId);
      setTranscriptionResourceId(accepted.transcriptionId);
      void Promise.all([
        setItemAsync(`antica.transcriptionJob.${current.id}`, accepted.jobId),
        setItemAsync(
          `antica.transcription.${current.id}`,
          accepted.transcriptionId,
        ),
      ]).catch((cause: unknown) => {
        setError((cause as Error).message);
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prepareDescription = async (): Promise<void> => {
    if (
      !draft.record ||
      !draft.transcriptionId ||
      !confirmedObservationId ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      update({ record: current });
      const request = editDraftRequestSchema.parse({
        requestKey: randomUUID(),
        recordId: current.id,
        expectedRecordRevision: current.recordRevision,
        transcriptionIds: [draft.transcriptionId],
        observationIds: [confirmedObservationId],
        instructionZhHant:
          'Organize the original words into a concise description; preserve uncertainty and source distinctions.',
      });
      const accepted = await api.post(
        '/v1/edit-drafts',
        editDraftAcceptedSchema,
        { body: request, idempotencyKey: request.requestKey },
      );
      setEditJobId(accepted.jobId);
      setEditResourceId(accepted.editDraftId);
      void Promise.all([
        setItemAsync(`antica.editJob.${current.id}`, accepted.jobId),
        setItemAsync(`antica.editDraft.${current.id}`, accepted.editDraftId),
      ]).catch((cause: unknown) => {
        setError((cause as Error).message);
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmWords = async (): Promise<void> => {
    if (
      !draft.record ||
      !draft.originalWords.trim() ||
      savedObservation ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      if (transcriptionResourceId) {
        const detail = transcriptionDetail.data;
        if (!detail || detail.status !== 'ready') {
          throw new Error(t('processing'));
        }
        const request =
          confirmRequest ??
          transcriptionConfirmSchema.parse({
            requestKey: randomUUID(),
            expectedRevision: detail.revision,
            expectedRecordRevision: current.recordRevision,
            adoptedTextZhHant: draft.originalWords.trim(),
            componentIds: [],
            evidenceAnchorIds: [],
            checkIds: checkId ? [checkId] : [],
            observedAt: observationTime,
          });
        setConfirmRequest(request);
        const confirmed = await api.post(
          `/v1/transcriptions/${transcriptionResourceId}/confirm`,
          transcriptionConfirmedSchema,
          { body: request, idempotencyKey: request.requestKey },
        );
        setConfirmedObservationId(confirmed.observation.id);
        await transcriptionDetail.refetch();
      } else {
        const observation = observationInputSchema.parse({
          recordId: current.id,
          componentIds: [],
          channel: 'typed',
          text: draft.originalWords.trim(),
          evidenceAnchorIds: [],
          checkIds: checkId ? [checkId] : [],
          observedAt: observationTime,
          voice: null,
          editDraftId: null,
          supersedesObservationId: null,
        });
        const created = await api.post('/v1/observations', observationSchema, {
          body: observation,
          idempotencyKey: observationKey,
        });
        setConfirmedObservationId(created.id);
      }
      setSavedObservation(true);

      await queryClient.invalidateQueries({
        queryKey: ['observations', current.id],
      });
      update({
        record: await api.get(`/v1/records/${current.id}`, recordDetailSchema),
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyEdit = async (): Promise<void> => {
    const detail = editDetail.data;
    if (!draft.record || !detail || selectedProposalIds.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const current = await api.get(
        `/v1/records/${draft.record.id}`,
        recordDetailSchema,
      );
      const request =
        applyRequest ??
        editDraftApplySchema.parse({
          requestKey: randomUUID(),
          expectedDraftRevision: detail.revision,
          expectedRecordRevision: current.recordRevision,
          selectedProposalIds,
        });
      setApplyRequest(request);
      const applied = await api.post(
        `/v1/edit-drafts/${detail.editDraftId}/apply`,
        editDraftAppliedSchema,
        { body: request, idempotencyKey: request.requestKey },
      );
      const selectedFields = new Set(
        detail.result?.proposedChanges
          .filter((change) => selectedProposalIds.includes(change.id))
          .map((change) => change.field),
      );
      setDraft((previous) => ({
        ...previous,
        record: applied.record,
        name: selectedFields.has('name')
          ? (applied.record.name ?? '')
          : previous.name,
        category: selectedFields.has('tags')
          ? (applied.record.tags[0] ?? '')
          : previous.category,
        preparedDescription: applied.record.description,
        adoptedDescription: true,
      }));
      setEditedFields((previous) => ({
        ...previous,
        name: selectedFields.has('name') ? false : previous.name,
        category: selectedFields.has('tags') ? false : previous.category,
      }));
      setSelectedProposalIds([]);
      setApplyRequest(null);
      await editDetail.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!draft.record || busy) {
      return;
    }
    if (draft.originalWords.trim() && !savedObservation) {
      setStep(4);
      setError(t('confirmOriginalWords'));

      return;
    }

    setBusy(true);
    setError('');
    try {
      const labels = [
        ...new Set(
          draft.files.map((file) => file.componentLabel.trim()).filter(Boolean),
        ),
      ];
      const components = [
        ...draft.record.components,
        ...labels
          .filter(
            (label) =>
              !draft.record?.components.some(
                (component) => component.label === label,
              ),
          )
          .map((label) => ({ id: randomUUID(), label })),
      ];
      let record = draft.record;
      if (!savedFields) {
        const matched = editedFields.locationLabel
          ? locations.data?.find(
              (location) => location.label === draft.locationLabel.trim(),
            )
          : undefined;
        const location =
          editedFields.locationLabel && draft.locationLabel.trim() && !matched
            ? await api.post('/v1/locations', locationSchema, {
                body: { label: draft.locationLabel.trim() },
              })
            : matched;
        const fields = {
          name: editedFields.name
            ? draft.name.trim() || null
            : draft.record.name,
          unitKind: draft.kind,
          components,
          pieceCount: draft.kind === 'set' ? Math.max(components.length, 2) : 1,
          location: {
            locationId: location?.id ?? draft.record.location.locationId,
            detail: editedFields.locationDetail
              ? draft.locationDetail
              : draft.record.location.detail,
          },
          description: draft.adoptedDescription
            ? draft.preparedDescription
            : draft.record.description,
          tags: editedFields.category
            ? draft.category.trim()
              ? [draft.category.trim()]
              : []
            : draft.record.tags,
          dimensions:
            editedFields.height && draft.height
              ? {
                  ...draft.record.dimensions,
                  height: {
                    value: Number(draft.height),
                    unit: draft.heightUnit,
                  },
                }
              : draft.record.dimensions,
        };
        const patch = recordPatchSchema.parse({
          expectedRevision: draft.record.recordRevision,
          fields,
        });
        record = await api.patch(
          `/v1/records/${draft.record.id}`,
          recordDetailSchema,
          { body: patch, idempotencyKey: randomUUID() },
        );
      }
      update({ record });
      setSavedFields(true);
      const nextFiles = [...draft.files];
      const failures: Record<string, string> = {};
      for (const [index, file] of nextFiles.entries()) {
        const component = components.find(
          (item) => item.label === file.componentLabel.trim(),
        );
        if (file.state !== 'uploaded') {
          nextFiles[index] = { ...file, state: 'uploading' };
          update({ files: [...nextFiles] });
          try {
            const assetId = await uploadMedia(
              api,
              file,
              { kind: 'record', id: record.id },
              component ? [component.id] : [],
            );
            nextFiles[index] = { ...file, state: 'uploaded', assetId };
          } catch (cause) {
            nextFiles[index] = { ...file, state: 'failed' };
            failures[file.id] = (cause as Error).message;
            update({ files: [...nextFiles] });
            continue;
          }
        }
        if (
          checkId &&
          file.kind === 'photo' &&
          !nextFiles[index]?.checkLinked
        ) {
          try {
            const assetId = nextFiles[index]?.assetId;
            if (!assetId) {
              throw new Error(t('uploadFailed'));
            }
            const detail = await api.get(
              `/v1/media/${assetId}`,
              mediaDetailSchema,
            );
            const view = detail.asset.views[0];
            await api.post('/v1/evidence', evidenceCreationSchema, {
              body: {
                requestKey: file.checkRequestKey ?? file.id,
                mode: 'create',
                checkId,
                evidence: {
                  kind: 'image',
                  recordId: record.id,
                  componentIds: component ? [component.id] : [],
                  originalAssetId: assetId,
                  canonicalViewId: view.id,
                  scope: { kind: 'whole' },
                },
              },
              idempotencyKey: file.checkRequestKey ?? file.id,
            });
            nextFiles[index] = { ...nextFiles[index], checkLinked: true };
          } catch (cause) {
            failures[file.id] = (cause as Error).message;
          }
        }
        update({ files: [...nextFiles] });
      }
      setFileErrors(failures);
      if (Object.keys(failures).length > 0) {
        setError(t('uploadFailed'));
        setStep(6);

        return;
      }
      if (
        !nextFiles.some(
          (file) => file.state === 'uploaded' && file.purpose === 'object',
        )
      ) {
        setError(t('photoRequired'));
        setStep(6);

        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['record', record.id] }),
        queryClient.invalidateQueries({
          queryKey: ['observations', record.id],
        }),
      ]);
      const query = checkId ? `?checkId=${checkId}` : '';
      router.replace(`/collection/${record.id}${query}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const next = (): void => setStep((value) => Math.min(6, value + 1));

  return (
    <Screen
      title={t('addItem')}
      subtitle={draft.record ? draft.record.code : t('privateCollection')}>
      <Text style={styles.secondary}>{step} / 6</Text>
      {step === 1 && (
        <View style={styles.card}>
          <Text style={styles.heading}>
            {t('single')} / {t('set')}
          </Text>
          <ActionButton
            label={t('single')}
            onPress={() => void createDraft('single')}
            disabled={busy}
          />
          <ActionButton
            label={t('set')}
            onPress={() => void createDraft('set')}
            disabled={busy}
            secondary
          />
        </View>
      )}
      {step === 2 && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('capture')}</Text>
          <ActionButton
            label={t('photo')}
            onPress={() => void chooseMedia(true, false)}
          />
          <ActionButton
            label={t('video')}
            onPress={() => void chooseMedia(true, true)}
            secondary
          />
          <ActionButton
            label={t('import')}
            onPress={() => void chooseMedia(false, false)}
            secondary
          />
          <ActionButton label={t('continue')} onPress={next} secondary />
        </View>
      )}
      {step === 3 && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('component')}</Text>
          {draft.files
            .filter((file) => file.purpose === 'object')
            .map((file) => (
              <View key={file.id} style={styles.card}>
                {file.kind === 'photo' && (
                  <Image
                    source={{ uri: file.uri }}
                    style={{ height: 160, width: '100%' }}
                    resizeMode="contain"
                    accessibilityLabel={file.name}
                  />
                )}
                <Text style={styles.secondary}>{file.name}</Text>
                {draft.kind === 'set' && (
                  <TextField
                    label={t('component')}
                    value={file.componentLabel}
                    onChangeText={(value) =>
                      update({
                        files: draft.files.map((item) =>
                          item.id === file.id
                            ? { ...item, componentLabel: value }
                            : item,
                        ),
                      })
                    }
                  />
                )}
              </View>
            ))}
          <ActionButton
            label={t('photo')}
            onPress={() => void chooseMedia(true, false)}
            secondary
          />
          <ActionButton label={t('continue')} onPress={next} />
        </View>
      )}
      {step === 4 && (
        <View style={styles.card}>
          <Text style={styles.heading}>
            {t('audio')} / {t('description')}
          </Text>
          <ActionButton
            label={recording ? t('stopRecording') : t('startRecording')}
            onPress={() =>
              void (recording ? stopVoice() : startVoice()).catch((cause) =>
                setError((cause as Error).message),
              )
            }
            secondary
          />
          <ActionButton
            label={t('importAudio')}
            onPress={() => void importVoice()}
            secondary
          />
          {draft.files.some((file) => file.purpose === 'voice_note') && (
            <ActionButton
              label={t('transcribe')}
              onPress={() => void prepareVoice()}
              disabled={
                busy ||
                (Boolean(transcriptionJobId) &&
                  transcription.data?.state.kind !== 'failed')
              }
              secondary
            />
          )}
          {transcription.data && (
            <Text style={styles.secondary}>
              {t('transcribe')}:{' '}
              {localizeStatus(transcription.data.state.kind, t)}
            </Text>
          )}
          {transcription.data?.state.kind === 'failed' && (
            <Text accessibilityRole="alert" style={styles.error}>
              {transcription.data.state.error.message}
            </Text>
          )}
          {transcriptionDetail.data?.result && (
            <Text style={styles.secondary}>
              {t('originalTranscript')}:{' '}
              {transcriptionDetail.data.result.originalText}
            </Text>
          )}
          <TextField
            label={t('originalWords')}
            value={draft.originalWords}
            onChangeText={(value) => {
              update({ originalWords: value });
              setConfirmRequest(null);
            }}
            editable={!savedObservation}
            multiline
          />
          {Boolean(draft.originalWords.trim()) && (
            <ActionButton
              label={savedObservation ? t('confirmedWords') : t('confirmWords')}
              onPress={() => void confirmWords()}
              disabled={busy || savedObservation}
              secondary
            />
          )}
          {savedObservation && draft.transcriptionId && (
            <ActionButton
              label={t('prepareDescription')}
              onPress={() => void prepareDescription()}
              disabled={
                busy ||
                (Boolean(editJobId) && editDraft.data?.state.kind !== 'failed')
              }
              secondary
            />
          )}
          {editDraft.data && (
            <Text style={styles.secondary}>
              {t('prepareDescription')}:{' '}
              {localizeStatus(editDraft.data.state.kind, t)}
            </Text>
          )}
          {editDraft.data?.state.kind === 'failed' && (
            <Text accessibilityRole="alert" style={styles.error}>
              {editDraft.data.state.error.message}
            </Text>
          )}
          {editDetail.data?.result?.proposedChanges.map((change) => (
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
                onPress={() => {
                  setApplyRequest(null);
                  setSelectedProposalIds((current) =>
                    current.includes(change.id)
                      ? current.filter((id) => id !== change.id)
                      : [...current, change.id],
                  );
                }}
                secondary
              />
            </View>
          ))}
          {selectedProposalIds.length > 0 && (
            <ActionButton
              label={`${t('applySelected')} (${selectedProposalIds.length})`}
              onPress={() => void applyEdit()}
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
            label={
              draft.adoptedDescription ? t('adopted') : t('adoptDescription')
            }
            onPress={() => update({ adoptedDescription: true })}
            disabled={
              !draft.preparedDescription.trim() || draft.adoptedDescription
            }
            secondary
          />
          <ActionButton label={t('continue')} onPress={next} />
        </View>
      )}
      {step === 5 && (
        <View style={styles.card}>
          <Text style={styles.heading}>
            {t('name')} / {t('location')}
          </Text>
          <TextField
            label={t('name')}
            value={draft.name}
            onChangeText={(value) => editField('name', value)}
          />
          <TextField
            label={t('typeTag')}
            value={draft.category}
            onChangeText={(value) => editField('category', value)}
          />
          <TextField
            label={`${t('height')} (${draft.heightUnit})`}
            value={draft.height}
            onChangeText={(value) => editField('height', value)}
            keyboardType="decimal-pad"
          />
          <View style={styles.row}>
            <ActionButton
              label="cm"
              onPress={() => update({ heightUnit: 'cm' })}
              secondary
            />
            <ActionButton
              label="mm"
              onPress={() => update({ heightUnit: 'mm' })}
              secondary
            />
          </View>
          <TextField
            label={t('location')}
            value={draft.locationLabel}
            onChangeText={(value) => editField('locationLabel', value)}
          />
          <View style={styles.row}>
            {locations.data?.map((location) => (
              <ActionButton
                key={location.id}
                label={location.label}
                onPress={() => editField('locationLabel', location.label)}
                secondary
              />
            ))}
          </View>
          <TextField
            label={t('locationDetail')}
            value={draft.locationDetail}
            onChangeText={(value) => editField('locationDetail', value)}
          />
          <ActionButton
            label={t('receipt')}
            onPress={() => void chooseMedia(false, false, 'receipt')}
            secondary
          />
          <ActionButton label={t('continue')} onPress={next} />
        </View>
      )}
      {step === 6 && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('save')}</Text>
          {draft.files.map((file) => (
            <Text
              key={file.id}
              style={file.state === 'failed' ? styles.error : styles.secondary}>
              {file.name}: {localizeStatus(file.state, t)}
              {fileErrors[file.id] ? ` — ${fileErrors[file.id]}` : ''}
            </Text>
          ))}
          <ActionButton
            label={busy ? t('processing') : t('save')}
            onPress={() => void save()}
            disabled={busy}
          />
          <Text style={styles.secondary}>{t('notAnalyzed')}</Text>
        </View>
      )}
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
