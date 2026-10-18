import { randomUUID } from 'expo-crypto';
import { setItemAsync } from 'expo-secure-store';
import { useEffect, useState } from 'react';

import {
  editDraftRequestSchema,
  editDraftAcceptedSchema,
  editDraftApplySchema,
  editDraftAppliedSchema,
  recordDetailSchema,
} from '@antica/contracts';

import type { EditDraftApply } from '@antica/contracts';

import type { CaptureDraftState, CaptureRuntime } from './useCaptureDraft';
import type { CaptureJobs } from './useCaptureJobs';

/** description proposals the collector selects and applies to the record */
export interface CaptureEditDraft {
  selectedProposalIds: string[];
  toggleProposal: (id: string) => void;
  prepareDescription: () => Promise<void>;
  applyEdit: () => Promise<void>;
}

/**
 * prepares a description from the confirmed words and applies selected proposals
 * @param runtime API transport, translations, and shared busy/error status
 * @param context draft state, edit-draft jobs, and the confirmed observation
 * @param context.draft record, media, and words collected so far
 * @param context.setDraft capture draft updater
 * @param context.setEditedFields edited-field tracker
 * @param context.update capture draft patcher
 * @param context.jobs transcription and edit-draft jobs
 * @param context.confirmedObservationId observation holding the confirmed words
 * @returns proposal selection and the description actions
 */
export function useEditDraft(
  runtime: CaptureRuntime,
  {
    draft,
    setDraft,
    setEditedFields,
    update,
    jobs,
    confirmedObservationId,
  }: Pick<
    CaptureDraftState,
    'draft' | 'setDraft' | 'setEditedFields' | 'update'
  > & {
    jobs: Pick<
      CaptureJobs,
      'editDetail' | 'setEditJobId' | 'setEditResourceId'
    >;
    confirmedObservationId: string | null;
  },
): CaptureEditDraft {
  const { api, busy, setBusy, setError } = runtime;
  const { editDetail, setEditJobId, setEditResourceId } = jobs;
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const [applyRequest, setApplyRequest] = useState<EditDraftApply | null>(null);

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

  const toggleProposal = (id: string): void => {
    setApplyRequest(null);
    setSelectedProposalIds((current) =>
      current.includes(id)
        ? current.filter((selected) => selected !== id)
        : [...current, id],
    );
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

  return { selectedProposalIds, toggleProposal, prepareDescription, applyEdit };
}
